import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { mockProvider } from './providers/mockProvider.js';
import { getTargetGroupMetrics } from './prometheus.js';
import { getRequestCount } from './cloudwatch.js';

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

// 1) List ELBs to choose from.
app.get('/api/elbs', async (_req, res) => {
  try {
    res.json(await provider.listLoadBalancers());
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// 2+3) Topology for a chosen ELB: target groups, each with its servers.
app.get('/api/topology', async (req, res) => {
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
app.get('/api/metrics/target-group', async (req, res) => {
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
