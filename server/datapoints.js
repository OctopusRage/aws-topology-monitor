// Resource-usage metrics for standalone data points (RDS, OpenSearch,
// ClickHouse/custom). Returns a generic `panels` array the frontend renders
// as-is, so each resource type can expose its own relevant metrics.
import { getMetricSeries } from './cloudwatch.js';
import { getInstanceSeries } from './prometheus.js';

const GB = 1024 * 1024 * 1024;

// ---- mock series (used when a source is unreachable / not configured) ----
let mseed = 7;
function mrand() {
  mseed = (mseed * 1103515245 + 12345) & 0x7fffffff;
  return mseed / 0x7fffffff;
}
function mockSeries(range, base, amp, floor = 0, ceil = 100) {
  const points = range === '24h' ? 96 : range === '6h' ? 72 : 60;
  const stepMs = range === '24h' ? 15 * 60000 : range === '6h' ? 5 * 60000 : 60000;
  const end = Date.now();
  const out = [];
  let v = base;
  for (let i = points; i >= 0; i--) {
    v += (mrand() - 0.5) * amp;
    v = Math.min(ceil, Math.max(floor, v));
    out.push({ t: end - i * stepMs, v: Number(v.toFixed(2)) });
  }
  return out;
}

// Panel specs per resource type. Each has a CloudWatch/Prometheus mapping and a
// mock definition so it always renders.
function rdsPanels(cfg, range, real) {
  const dims = [{ Name: 'DBInstanceIdentifier', Value: cfg.dbInstanceId }];
  return [
    { key: 'cpu', label: 'CPU', unit: '%', color: '#ff6d5a', max: 100,
      cw: { namespace: 'AWS/RDS', metricName: 'CPUUtilization', dimensions: dims, stat: 'Average' },
      mock: () => mockSeries(range, 35, 10) },
    { key: 'mem', label: 'Freeable Mem', unit: 'GB', color: '#7b6cff',
      cw: { namespace: 'AWS/RDS', metricName: 'FreeableMemory', dimensions: dims, stat: 'Average', transform: (b) => b / GB },
      mock: () => mockSeries(range, 6, 0.6, 0, 16) },
    { key: 'storage', label: 'Free Storage', unit: 'GB', color: '#38d39f',
      cw: { namespace: 'AWS/RDS', metricName: 'FreeStorageSpace', dimensions: dims, stat: 'Average', transform: (b) => b / GB },
      mock: () => mockSeries(range, 120, 2, 0, 500) },
    { key: 'conns', label: 'Connections', unit: '', color: '#ffb547',
      cw: { namespace: 'AWS/RDS', metricName: 'DatabaseConnections', dimensions: dims, stat: 'Average' },
      mock: () => mockSeries(range, 40, 12, 0, 500) },
  ];
}

function opensearchPanels(cfg, range) {
  const dims = [
    { Name: 'DomainName', Value: cfg.domainName },
    { Name: 'ClientId', Value: cfg.accountId },
  ];
  return [
    { key: 'cpu', label: 'CPU', unit: '%', color: '#ff6d5a', max: 100,
      cw: { namespace: 'AWS/ES', metricName: 'CPUUtilization', dimensions: dims, stat: 'Average' },
      mock: () => mockSeries(range, 40, 12) },
    { key: 'jvm', label: 'JVM Pressure', unit: '%', color: '#7b6cff', max: 100,
      cw: { namespace: 'AWS/ES', metricName: 'JVMMemoryPressure', dimensions: dims, stat: 'Average' },
      mock: () => mockSeries(range, 55, 8) },
    { key: 'storage', label: 'Free Storage', unit: 'GB', color: '#38d39f',
      cw: { namespace: 'AWS/ES', metricName: 'FreeStorageSpace', dimensions: dims, stat: 'Average', transform: (mb) => mb / 1024 },
      mock: () => mockSeries(range, 200, 3, 0, 1000) },
    { key: 'search', label: 'Search Rate', unit: '/min', color: '#ffb547',
      cw: { namespace: 'AWS/ES', metricName: 'SearchRate', dimensions: dims, stat: 'Average' },
      mock: () => mockSeries(range, 800, 200, 0, 4000) },
  ];
}

// EC2 instance metrics (AWS/EC2). Basic monitoring is 5-min, so period 300.
function ec2Panels(cfg, range) {
  const dims = [{ Name: 'InstanceId', Value: cfg.instanceId }];
  const P = 300;
  return [
    { key: 'cpu', label: 'CPU', unit: '%', color: '#ff6d5a', max: 100,
      cw: { namespace: 'AWS/EC2', metricName: 'CPUUtilization', dimensions: dims, stat: 'Average', period: P },
      mock: () => mockSeries(range, 35, 12) },
    { key: 'netin', label: 'Net In', unit: 'MB/s', color: '#7b6cff',
      cw: { namespace: 'AWS/EC2', metricName: 'NetworkIn', dimensions: dims, stat: 'Sum', period: P, perSecond: true, transform: (b) => b / 1048576 },
      mock: () => mockSeries(range, 3, 1.2, 0, 60) },
    { key: 'netout', label: 'Net Out', unit: 'MB/s', color: '#38d39f',
      cw: { namespace: 'AWS/EC2', metricName: 'NetworkOut', dimensions: dims, stat: 'Sum', period: P, perSecond: true, transform: (b) => b / 1048576 },
      mock: () => mockSeries(range, 2, 1, 0, 60) },
    { key: 'disk', label: 'Disk Read', unit: 'MB/s', color: '#ffb547',
      cw: { namespace: 'AWS/EC2', metricName: 'DiskReadBytes', dimensions: dims, stat: 'Sum', period: P, perSecond: true, transform: (b) => b / 1048576 },
      mock: () => mockSeries(range, 0.8, 0.5, 0, 20) },
  ];
}

export async function getDatapointMetrics(dp, range = '1h') {
  const cfg = dp.config || {};

  // ClickHouse / custom → Prometheus / node_exporter on the given instance.
  if (dp.type === 'clickhouse' || dp.source === 'prometheus') {
    const res = await getInstanceSeries(cfg.instance, range);
    const panels = [
      { key: 'cpu', label: 'CPU', unit: '%', color: '#ff6d5a', max: 100, series: res.series.cpu },
      { key: 'ram', label: 'Memory', unit: '%', color: '#7b6cff', max: 100, series: res.series.ram },
      { key: 'storage', label: 'Storage', unit: '%', color: '#38d39f', max: 100, series: res.series.storage },
    ];
    return { source: res.source, range, error: res.error, panels };
  }

  // RDS / OpenSearch / EC2 → CloudWatch.
  const specs =
    dp.type === 'opensearch'
      ? opensearchPanels(cfg, range)
      : dp.type === 'ec2'
      ? ec2Panels(cfg, range)
      : rdsPanels(cfg, range);

  // If CloudWatch isn't usable (mock mode or missing ids), return mock panels.
  const canQuery =
    dp.type === 'opensearch'
      ? cfg.domainName && cfg.accountId
      : dp.type === 'ec2'
      ? cfg.instanceId
      : cfg.dbInstanceId;

  if (!canQuery) {
    return {
      source: 'mock',
      range,
      panels: specs.map(({ key, label, unit, color, max, mock }) => ({
        key, label, unit, color, max, series: mock(),
      })),
    };
  }

  let source = 'cloudwatch';
  const panels = await Promise.all(
    specs.map(async ({ key, label, unit, color, max, cw, mock }) => {
      try {
        const series = await getMetricSeries({ ...cw, range });
        return { key, label, unit, color, max, series: series.length ? series : mock() };
      } catch (err) {
        source = 'cloudwatch-fallback';
        return { key, label, unit, color, max, series: mock() };
      }
    })
  );
  return { source, range, panels };
}
