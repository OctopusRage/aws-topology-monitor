// Metrics layer — queries Prometheus (which scrapes node_exporter on each
// instance) for CPU / RAM / Storage / Request Count, per target group.
//
// Instances are matched to Prometheus series by private IP: node_exporter's
// `instance` label is expected to look like "<privateIp>:<exporterPort>".
import { config } from './config.js';

const RANGE_PRESETS = {
  '15m': { seconds: 15 * 60, step: '30s' },
  '1h': { seconds: 60 * 60, step: '1m' },
  '6h': { seconds: 6 * 60 * 60, step: '5m' },
  '24h': { seconds: 24 * 60 * 60, step: '15m' },
};

// PromQL builders. `sel` is an instance-label selector fragment, e.g.
// instance=~"10.0.1.20:9100|10.0.1.21:9100"
function queries(sel) {
  const mount = config.prometheus.rootMount;
  return {
    // CPU utilization %
    cpu: `avg(100 - (rate(node_cpu_seconds_total{mode="idle",${sel}}[5m]) * 100))`,
    // Memory utilization %
    ram: `avg((1 - (node_memory_MemAvailable_bytes{${sel}} / node_memory_MemTotal_bytes{${sel}})) * 100)`,
    // Root filesystem utilization %
    storage: `avg((1 - (node_filesystem_avail_bytes{mountpoint="${mount}",${sel}} / node_filesystem_size_bytes{mountpoint="${mount}",${sel}})) * 100)`,
    // Request Count — approximated from network packets received per second.
    // If you run an app exporter (nginx/http), swap this for its request metric.
    requests: `sum(rate(node_network_receive_packets_total{${sel}}[5m]))`,
  };
}

function instanceSelector(targets) {
  const port = config.prometheus.exporterPort;
  const ips = targets
    .filter((t) => t.privateIp)
    .map((t) => `${t.privateIp}:${port}`);
  if (ips.length === 0) return null;
  return `instance=~"${ips.map((i) => i.replace(/\./g, '\\\\.')).join('|')}"`;
}

async function promRangeQuery(query, seconds, step) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - seconds;
  const url = new URL('/api/v1/query_range', config.prometheus.url);
  url.searchParams.set('query', query);
  url.searchParams.set('start', String(start));
  url.searchParams.set('end', String(end));
  url.searchParams.set('step', step);

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Prometheus ${res.status}`);
  const body = await res.json();
  const result = body?.data?.result?.[0]?.values || [];
  return result.map(([t, v]) => ({ t: t * 1000, v: Number(v) }));
}

// ---- Mock series generator (used when Prometheus is unreachable) ----
let mseed = 42;
function mrand() {
  mseed = (mseed * 1103515245 + 12345) & 0x7fffffff;
  return mseed / 0x7fffffff;
}
function mockSeries(seconds, step, base, amplitude, floor = 0, ceil = 100) {
  const stepSec = step.endsWith('m')
    ? Number(step.replace('m', '')) * 60
    : Number(step.replace('s', ''));
  const points = Math.max(2, Math.floor(seconds / stepSec));
  const end = Date.now();
  const out = [];
  let val = base;
  for (let i = points; i >= 0; i--) {
    val += (mrand() - 0.5) * amplitude;
    val = Math.min(ceil, Math.max(floor, val));
    out.push({ t: end - i * stepSec * 1000, v: Number(val.toFixed(2)) });
  }
  return out;
}

function mockMetricSet(seconds, step) {
  return {
    cpu: mockSeries(seconds, step, 45, 12),
    ram: mockSeries(seconds, step, 60, 6),
    storage: mockSeries(seconds, step, 55, 1.5),
    requests: mockSeries(seconds, step, 1200, 400, 0, 5000),
  };
}

export async function getTargetGroupMetrics(targets, range = '1h') {
  const preset = RANGE_PRESETS[range] || RANGE_PRESETS['1h'];
  const { seconds, step } = preset;

  const sel = instanceSelector(targets);
  const useMock = config.mockMetrics || !sel;

  if (useMock) {
    return { source: 'mock', range, series: mockMetricSet(seconds, step) };
  }

  try {
    const q = queries(sel);
    const [cpu, ram, storage, requests] = await Promise.all([
      promRangeQuery(q.cpu, seconds, step),
      promRangeQuery(q.ram, seconds, step),
      promRangeQuery(q.storage, seconds, step),
      promRangeQuery(q.requests, seconds, step),
    ]);
    return { source: 'prometheus', range, series: { cpu, ram, storage, requests } };
  } catch (err) {
    // Graceful fallback so the dashboard still renders.
    return {
      source: 'mock-fallback',
      range,
      error: String(err.message || err),
      series: mockMetricSet(seconds, step),
    };
  }
}
