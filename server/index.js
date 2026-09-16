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

const { requireAuth, requireAdmin } = makeAuthMiddleware(users.getUserByToken, {
  apiKey: config.apiKey,
});

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

// Admin resets another user's password.
app.put('/api/users/:id/password', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { newPassword } = req.body || {};
  try {
    users.adminSetPassword(id, newPassword);
    res.json({ ok: true });
  } catch (err) {
    const code = /not found/.test(err.message) ? 404 : 400;
    res.status(code).json({ error: String(err.message || err) });
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

// ── Saved views — admins author them; everyone loads them (read-only) ─────────
app.get('/api/views', requireAuth, (req, res) => res.json(viewStore.listViews(req.user)));

app.get('/api/views/:id', requireAuth, (req, res) => {
  const v = viewStore.getView(Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'view not found' });
  // Non-admins may only load admin-authored views.
  if (req.user.role !== 'admin' && v.creatorRole !== 'admin')
    return res.status(404).json({ error: 'view not found' });
  res.json(v);
});

app.post('/api/views', requireAuth, requireAdmin, (req, res) => {
  try {
    res.status(201).json(viewStore.createView(req.user, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.put('/api/views/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    res.json(viewStore.updateView(Number(req.params.id), req.user, req.body || {}));
  } catch (err) {
    const code = /not found/.test(err.message) ? 404 : 403;
    res.status(code).json({ error: String(err.message || err) });
  }
});

app.delete('/api/views/:id', requireAuth, requireAdmin, (req, res) => {
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

// Every ELB → its target groups → registered instances with IPs. Built for
// scripts (e.g. "give me the IPs behind target group X so I can SSH in").
//   ?lb=<name|arn>       only this load balancer
//   ?tg=<name|arn>       only this target group
//   ?health=healthy      only targets in this health state
//   ?format=text         one IP per line instead of JSON (for shell loops)
//   ?ip=public|private   which IP the text format prints (default private)
app.get('/api/elb/targets', requireAuth, async (req, res) => {
  const { lb, tg, health, format, ip: ipKind } = req.query;
  try {
    let lbs = await provider.listElbTargets(lb || undefined);
    if (tg) {
      lbs = lbs
        .map((l) => ({ ...l, targetGroups: l.targetGroups.filter((t) => t.name === tg || t.arn === tg) }))
        .filter((l) => l.targetGroups.length > 0);
    }
    if (health) {
      lbs = lbs.map((l) => ({
        ...l,
        targetGroups: l.targetGroups.map((t) => ({
          ...t,
          targets: t.targets.filter((x) => x.health === health),
        })),
      }));
    }
    if ((lb || tg) && lbs.length === 0)
      return res.status(404).json({ error: 'no matching load balancer / target group' });

    if (format === 'text') {
      const key = ipKind === 'public' ? 'publicIp' : 'privateIp';
      const ips = new Set();
      for (const l of lbs)
        for (const t of l.targetGroups)
          for (const x of t.targets) if (x[key]) ips.add(x[key]);
      return res.type('text/plain').send([...ips].join('\n') + (ips.size ? '\n' : ''));
    }
    res.json({ region: config.awsRegion, loadBalancers: lbs });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Everything a jump picker can start from: load balancers + saved views.
// (Saved views visible to the caller: admin-authored ones for non-admins.)
app.get('/api/sources', requireAuth, async (req, res) => {
  try {
    const [loadBalancers, views] = await Promise.all([
      provider.listLoadBalancers(),
      Promise.resolve(viewStore.listViews(req.user)),
    ]);
    const lbName = new Map(loadBalancers.map((l) => [l.arn, l.name]));
    res.json({
      loadBalancers,
      views: views.map((v) => ({ ...v, baseLbName: lbName.get(v.baseLbArn) || null })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// A saved view resolved LIVE into the same shape as /api/elb/targets: its
// base ELB's target groups, any standalone target groups added to the view,
// and its instance groups — each as a "target group" with targets + IPs.
// :ref is the view id or its name.
app.get('/api/views/:ref/targets', requireAuth, async (req, res) => {
  const v = viewStore.findView(req.params.ref, req.user);
  if (!v) return res.status(404).json({ error: 'view not found' });
  try {
    const targetGroups = [];
    const lbs = await provider.listElbTargets(v.baseLbArn);
    const base = lbs[0] || null;
    for (const tg of base?.targetGroups || []) targetGroups.push({ ...tg, kind: 'elb', via: base.name });

    for (const s of v.data?.standaloneTargetGroups || []) {
      if (targetGroups.some((t) => t.arn === s.tgArn)) continue;
      const tg = await provider.getStandaloneTargetGroup(s.tgArn);
      if (tg) targetGroups.push({ ...tg, kind: 'standalone' });
      else targetGroups.push({ arn: s.tgArn, name: s.name, kind: 'standalone', targets: [], error: 'target group not found' });
    }

    for (const g of v.data?.instanceGroups || []) {
      const saved = g.instances || [];
      const live = await provider.getInstances(saved.map((i) => i.id));
      targetGroups.push({
        arn: `view:${v.id}/instance-group/${g.id}`,
        name: g.name,
        kind: 'instance-group',
        protocol: null,
        port: null,
        targets: saved.map((i, idx) => {
          const l = live[idx] || {};
          return {
            id: i.id,
            name: l.name || i.name || i.id,
            port: null,
            health: l.state || i.state || null,
            state: l.state || i.state || null,
            az: l.az || i.az || null,
            privateIp: l.privateIp || i.privateIp || null,
            publicIp: l.publicIp ?? null,
            instanceType: l.instanceType || l.type || i.type || null,
          };
        }),
      });
    }

    res.json({
      view: { id: v.id, name: v.name, baseLbArn: v.baseLbArn, baseLbName: base?.name || null, updatedAt: v.updatedAt },
      name: v.name,
      loadBalancer: base ? { arn: base.arn, name: base.name, dnsName: base.dnsName, scheme: base.scheme } : null,
      targetGroups,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Listener rules for a load balancer (shown when the ELB node is clicked).
app.get('/api/elb/rules', requireAuth, async (req, res) => {
  const lbArn = req.query.lbArn;
  if (!lbArn) return res.status(400).json({ error: 'lbArn is required' });
  try {
    res.json(await provider.getListenerRules(lbArn));
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
