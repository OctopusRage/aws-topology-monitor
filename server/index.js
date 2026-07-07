import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { mockProvider } from './providers/mockProvider.js';
import { getTargetGroupMetrics } from './prometheus.js';
import { getRequestCount } from './cloudwatch.js';
import { makeAuthMiddleware } from './auth.js';
import * as users from './users.js'; // also triggers db init + admin seed

const { requireAuth, requireAdmin } = makeAuthMiddleware(users.getUserByToken);

// Pick the data source. AWS provider is imported lazily so the app boots even
// without the AWS SDK installed / credentials configured when USE_AWS=false.
let provider = mockProvider;
if (config.useAws) {
  const { awsProvider } = await import('./providers/awsProvider.js');
  provider = awsProvider;
}

const app = express();
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
app.get('/api/metrics/target-group', requireAuth, async (req, res) => {
  const tgArn = req.query.tgArn;
  const lbArn = req.query.lbArn;
  const range = req.query.range || '1h';
  if (!tgArn) return res.status(400).json({ error: 'tgArn is required' });
  try {
    const targets = await provider.getTargetGroupTargets(tgArn);
    if (!targets) return res.status(404).json({ error: 'target group not found' });

    // CPU / RAM / Storage (+ proxy requests) from Prometheus/node_exporter.
    const metrics = await getTargetGroupMetrics(targets, range);
    metrics.requestsSource = metrics.source;

    // Override the Request Count panel with CloudWatch's native ALB metric.
    if (config.cloudwatch.useForRequests && lbArn) {
      try {
        metrics.series.requests = await getRequestCount(lbArn, tgArn, range);
        metrics.requestsSource = 'cloudwatch';
      } catch (err) {
        metrics.requestsSource = 'cloudwatch-fallback';
        metrics.requestsError = String(err.message || err);
      }
    }

    res.json({ tgArn, targetCount: targets.length, ...metrics });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(config.port, () => {
  console.log(
    `[aws-topology-monitor] server on :${config.port}  source=${
      config.useAws ? 'aws' : 'mock'
    }  metrics=${config.mockMetrics ? 'mock' : config.prometheus.url}`
  );
});
