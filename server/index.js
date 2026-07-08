import express from 'express';
import cors from 'cors';
import { join } from 'node:path';
import { config } from './config.js';
import { mockProvider } from './providers/mockProvider.js';
import { getTargetGroupMetrics } from './prometheus.js';
import { getAlbTargetGroupMetrics } from './cloudwatch.js';
import { getDatapointMetrics } from './datapoints.js';
import { makeAuthMiddleware } from './auth.js';
import * as users from './users.js'; // also triggers db init + admin seed
import * as viewStore from './views.js';

const { requireAuth, requireAdmin } = makeAuthMiddleware(users.getUserByToken);

// Pick the data source. AWS provider is imported lazily so the app boots even
// without the AWS SDK installed / credentials configured when USE_AWS=false.
let provider = mockProvider;
if (config.useAws) {
  const { awsProvider } = await import('./providers/awsProvider.js');
  provider = awsProvider;
}

const app = express();

// When deployed under a sub-path (e.g. https://host/_stellar/) whose gateway
// forwards the prefix instead of stripping it, set BASE_PATH=/_stellar so the
// server still matches /api/... and serves static assets. No-op when unset.
const basePath = (process.env.BASE_PATH || '').replace(/\/+$/, '');
if (basePath) {
  app.use((req, _res, next) => {
    if (req.url === basePath) req.url = '/';
    else if (req.url.startsWith(basePath + '/')) req.url = req.url.slice(basePath.length);
    next();
  });
}

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    source: config.useAws ? 'aws' : 'mock',
    region: config.awsRegion,
    metrics: config.mockMetrics ? 'mock' : config.prometheus.url,
    requests: config.cloudwatch.useForRequests ? 'cloudwatch' : 'node_exporter',
  });
});

// ── Auth ────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const result = users.login(username, password);
  if (!result) return res.status(401).json({ error: 'invalid credentials' });
  res.json(result);
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = (req.headers.authorization || '').slice(7);
  users.logout(token);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// Per-user startup view: { type: 'saved'|'base', ref } or null to clear.
app.put('/api/auth/default-view', requireAuth, (req, res) => {
  const { defaultView } = req.body || {};
  users.setDefaultView(req.user.id, defaultView || null);
  res.json({ ok: true });
});

app.post('/api/auth/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  try {
    users.changePassword(req.user.id, currentPassword, newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// ── User management (admin only) ─────────────────────────────────────────────
app.get('/api/users', requireAuth, requireAdmin, (_req, res) => {
  res.json(users.listUsers());
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  try {
    res.status(201).json(users.createUser(username, password, role));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id)
    return res.status(400).json({ error: 'cannot delete your own account' });
  const target = users.listUsers().find((u) => u.id === id);
  if (!target) return res.status(404).json({ error: 'user not found' });
  if (target.role === 'admin' && users.countAdmins() <= 1)
    return res.status(400).json({ error: 'cannot delete the last admin' });
  users.deleteUser(id);
  res.json({ ok: true });
});

// ── Discoverable data sources (RDS / OpenSearch) ─────────────────────────────
app.get('/api/datasources', requireAuth, async (_req, res) => {
  try {
    res.json(await provider.listDataSources());
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// EC2 instances for the "add instances" picker (search happens client-side).
app.get('/api/ec2/instances', requireAuth, async (_req, res) => {
  try {
    res.json(await provider.listEc2Instances());
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// All target groups (for the "add target group" picker).
app.get('/api/target-groups', requireAuth, async (_req, res) => {
  try {
    res.json(await provider.listTargetGroups());
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// A single target group with its LIVE registered instances (reflects ASG).
app.get('/api/target-group', requireAuth, async (req, res) => {
  const tgArn = req.query.tgArn;
  if (!tgArn) return res.status(400).json({ error: 'tgArn is required' });
  try {
    const tg = await provider.getStandaloneTargetGroup(tgArn);
    if (!tg) return res.status(404).json({ error: 'target group not found' });
    res.json(tg);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── RDS Top SQL (Performance Insights) ───────────────────────────────────────
app.get('/api/rds/top-queries', requireAuth, async (req, res) => {
  const dbInstanceId = req.query.dbInstanceId;
  const range = req.query.range || '1h';
  if (!dbInstanceId) return res.status(400).json({ error: 'dbInstanceId is required' });
  try {
    const result = await provider.getRdsTopQueries(dbInstanceId, range);
    res.json({ source: 'performance-insights', ...result });
  } catch (err) {
    // Fall back to sample data (e.g. missing pi:* permission) so the UI renders.
    const sample = await mockProvider.getRdsTopQueries();
    res.json({ source: 'sample', error: String(err.message || err), ...sample });
  }
});

// ── Saved views (shared) ─────────────────────────────────────────────────────
app.get('/api/views', requireAuth, (_req, res) => res.json(viewStore.listViews()));

app.get('/api/views/:id', requireAuth, (req, res) => {
  const v = viewStore.getView(Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'view not found' });
  res.json(v);
});

app.post('/api/views', requireAuth, (req, res) => {
  try {
    res.status(201).json(viewStore.createView(req.user, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.put('/api/views/:id', requireAuth, (req, res) => {
  try {
    res.json(viewStore.updateView(Number(req.params.id), req.user, req.body || {}));
  } catch (err) {
    const code = /not found/.test(err.message) ? 404 : 403;
    res.status(code).json({ error: String(err.message || err) });
  }
});

app.delete('/api/views/:id', requireAuth, (req, res) => {
  try {
    viewStore.deleteView(Number(req.params.id), req.user);
    res.json({ ok: true });
  } catch (err) {
    const code = /not found/.test(err.message) ? 404 : 403;
    res.status(code).json({ error: String(err.message || err) });
  }
});

// ── Data-point resource metrics (RDS/OpenSearch via CloudWatch, else Prometheus)
app.post('/api/metrics/datapoint', requireAuth, async (req, res) => {
  const { datapoint, range = '1h' } = req.body || {};
  if (!datapoint?.type) return res.status(400).json({ error: 'datapoint is required' });
  try {
    // OpenSearch needs the account id for the CloudWatch ClientId dimension.
    if (datapoint.type === 'opensearch' && !datapoint.config?.accountId) {
      datapoint.config = { ...datapoint.config, accountId: await provider.getAccountId() };
    }
    res.json(await getDatapointMetrics(datapoint, range));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Topology + metrics (any authenticated user) ──────────────────────────────
// 1) List ELBs to choose from.
app.get('/api/elbs', requireAuth, async (_req, res) => {
  try {
    res.json(await provider.listLoadBalancers());
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// 2+3) Topology for a chosen ELB: target groups, each with its servers.
app.get('/api/topology', requireAuth, async (req, res) => {
  const lbArn = req.query.lbArn;
  if (!lbArn) return res.status(400).json({ error: 'lbArn is required' });
  try {
    const topo = await provider.getTopology(lbArn);
    if (!topo) return res.status(404).json({ error: 'load balancer not found' });
    res.json(topo);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// 4) Monitoring metrics for a target group (from node_exporter via Prometheus).
// Metrics for a target group. Like data points, the source is selectable:
//   source=cloudwatch → ALB metrics (request count, response time, 5XX, hosts)
//   source=prometheus → node_exporter CPU / RAM / Storage across its instances
app.get('/api/metrics/target-group', requireAuth, async (req, res) => {
  const tgArn = req.query.tgArn;
  const lbArn = req.query.lbArn;
  const range = req.query.range || '1h';
  const source = req.query.source || 'cloudwatch';
  if (!tgArn) return res.status(400).json({ error: 'tgArn is required' });

  try {
    if (source === 'cloudwatch') {
      if (!lbArn) return res.status(400).json({ error: 'lbArn is required for cloudwatch' });
      return res.json(await getAlbTargetGroupMetrics(lbArn, tgArn, range));
    }

    // prometheus / node_exporter
    const targets = await provider.getTargetGroupTargets(tgArn);
    if (!targets) return res.status(404).json({ error: 'target group not found' });
    const m = await getTargetGroupMetrics(targets, range);
    const panels = [
      { key: 'cpu', label: 'CPU', unit: '%', color: '#ff6d5a', max: 100, series: m.series.cpu },
      { key: 'ram', label: 'Memory', unit: '%', color: '#7b6cff', max: 100, series: m.series.ram },
      { key: 'storage', label: 'Storage', unit: '%', color: '#38d39f', max: 100, series: m.series.storage },
    ];
    res.json({ source: m.source, range, error: m.error, panels });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Single-container deploy: also serve the built frontend (STATIC_DIR set in the
// combined image), so one port serves both UI and API (same-origin, no nginx).
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  app.use(express.static(staticDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(join(staticDir, 'index.html'));
  });
}

app.listen(config.port, () => {
  console.log(
    `[aws-topology-monitor] server on :${config.port}  source=${
      config.useAws ? 'aws' : 'mock'
    }  metrics=${config.mockMetrics ? 'mock' : config.prometheus.url}`
  );
});
