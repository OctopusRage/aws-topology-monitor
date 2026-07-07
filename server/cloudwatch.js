// Request Count from CloudWatch — ALB publishes RequestCount to the
// AWS/ApplicationELB namespace, broken down per TargetGroup. This is the
// authoritative source for per-target-group request volume (node_exporter
// has no equivalent). Opt-in via USE_CLOUDWATCH_REQUESTS=true.
import {
  CloudWatchClient,
  GetMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import { config } from './config.js';

let client = null;
function cw() {
  if (!client) client = new CloudWatchClient({ region: config.awsRegion });
  return client;
}

const RANGE = {
  '15m': { seconds: 15 * 60, period: 60 },
  '1h': { seconds: 60 * 60, period: 60 },
  '6h': { seconds: 6 * 60 * 60, period: 300 },
  '24h': { seconds: 24 * 60 * 60, period: 900 },
};

// CloudWatch dimension values are the ARN suffixes:
//   loadbalancer -> "app/<name>/<id>"
//   targetgroup  -> "targetgroup/<name>/<id>"
function dimensions(lbArn, tgArn) {
  const lb = lbArn.split(':loadbalancer/')[1];
  const tgTail = tgArn.split(':targetgroup/')[1];
  if (!lb || !tgTail) throw new Error('cannot derive CloudWatch dimensions from ARNs');
  return { lb, tg: `targetgroup/${tgTail}` };
}

// Returns [{ t, v }] where v is requests/second (Sum over the period ÷ period),
// so it lines up with the other rate-style panels.
export async function getRequestCount(lbArn, tgArn, range = '1h') {
  const preset = RANGE[range] || RANGE['1h'];
  const { period, seconds } = preset;
  const { lb, tg } = dimensions(lbArn, tgArn);

  const end = new Date();
  const start = new Date(end.getTime() - seconds * 1000);

  const out = await cw().send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      ScanBy: 'TimestampAscending',
      MetricDataQueries: [
        {
          Id: 'reqcount',
          ReturnData: true,
          MetricStat: {
            Metric: {
              Namespace: 'AWS/ApplicationELB',
              MetricName: 'RequestCount',
              Dimensions: [
                { Name: 'LoadBalancer', Value: lb },
                { Name: 'TargetGroup', Value: tg },
              ],
            },
            Period: period,
            Stat: 'Sum',
          },
        },
      ],
    })
  );

  const r = out.MetricDataResults?.[0];
  const times = r?.Timestamps || [];
  const values = r?.Values || [];
  return times.map((t, i) => ({
    t: t instanceof Date ? t.getTime() : new Date(t).getTime(),
    v: Number((values[i] / period).toFixed(2)), // Sum/period => req/s
  }));
}

// Sample ALB panels — used when CloudWatch is unreachable / unauthorized so the
// modal still renders (mirrors the data-point fallback behaviour).
let _albSeed = 91;
function albRand() {
  _albSeed = (_albSeed * 1103515245 + 12345) & 0x7fffffff;
  return _albSeed / 0x7fffffff;
}
function albMock(range, base, amp, floor = 0, ceil = Infinity) {
  const { seconds, period } = RANGE[range] || RANGE['1h'];
  const points = Math.max(2, Math.floor(seconds / period));
  const end = Date.now();
  let v = base;
  const out = [];
  for (let i = points; i >= 0; i--) {
    v += (albRand() - 0.5) * amp;
    v = Math.min(ceil, Math.max(floor, v));
    out.push({ t: end - i * period * 1000, v: Number(v.toFixed(2)) });
  }
  return out;
}
function sampleAlbPanels(range) {
  return [
    { key: 'req', label: 'Request Count', unit: '/s', color: '#ffb547', series: albMock(range, 4, 2, 0) },
    { key: 'rt', label: 'Response Time', unit: 'ms', color: '#ff6d5a', series: albMock(range, 45, 15, 1) },
    { key: 'e5xx', label: '5XX Errors', unit: '/s', color: '#ff5a5a', series: albMock(range, 0.2, 0.15, 0) },
    { key: 'hosts', label: 'Healthy Hosts', unit: '', color: '#38d39f', series: albMock(range, 2, 0, 2, 2) },
  ];
}

// ALB target-group metrics from CloudWatch (AWS/ApplicationELB) as generic
// panels — request count, response time, 5XX errors, healthy hosts.
// Falls back to sample panels if CloudWatch is unavailable.
export async function getAlbTargetGroupMetrics(lbArn, tgArn, range = '1h') {
 try {
  const { period, seconds } = RANGE[range] || RANGE['1h'];
  const { lb, tg } = dimensions(lbArn, tgArn);
  const dims = [
    { Name: 'LoadBalancer', Value: lb },
    { Name: 'TargetGroup', Value: tg },
  ];
  const end = new Date();
  const start = new Date(end.getTime() - seconds * 1000);

  const specs = [
    { id: 'req', metric: 'RequestCount', stat: 'Sum', label: 'Request Count', unit: '/s', color: '#ffb547', div: period },
    { id: 'rt', metric: 'TargetResponseTime', stat: 'Average', label: 'Response Time', unit: 'ms', color: '#ff6d5a', mul: 1000 },
    { id: 'e5xx', metric: 'HTTPCode_Target_5XX_Count', stat: 'Sum', label: '5XX Errors', unit: '/s', color: '#ff5a5a', div: period },
    { id: 'hosts', metric: 'HealthyHostCount', stat: 'Average', label: 'Healthy Hosts', unit: '', color: '#38d39f' },
  ];

  const out = await cw().send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      ScanBy: 'TimestampAscending',
      MetricDataQueries: specs.map((s) => ({
        Id: s.id,
        ReturnData: true,
        MetricStat: {
          Metric: { Namespace: 'AWS/ApplicationELB', MetricName: s.metric, Dimensions: dims },
          Period: period,
          Stat: s.stat,
        },
      })),
    })
  );

  const byId = Object.fromEntries((out.MetricDataResults || []).map((r) => [r.Id, r]));
  const panels = specs.map((s) => {
    const r = byId[s.id] || {};
    const times = r.Timestamps || [];
    const values = r.Values || [];
    const series = times.map((t, i) => {
      let v = values[i];
      if (s.div) v = v / s.div;
      if (s.mul) v = v * s.mul;
      return {
        t: t instanceof Date ? t.getTime() : new Date(t).getTime(),
        v: Number(v.toFixed(2)),
      };
    });
    return { key: s.id, label: s.label, unit: s.unit, color: s.color, series };
  });

  return { source: 'cloudwatch', range, panels };
 } catch (err) {
  return {
    source: 'cloudwatch-fallback',
    range,
    error: String(err.message || err),
    panels: sampleAlbPanels(range),
  };
 }
}

// Generic single-metric range query. `dimensions` is [{Name,Value}]; `transform`
// optionally maps each raw value (e.g. bytes → GB). Returns [{t, v}] ascending.
export async function getMetricSeries({
  namespace,
  metricName,
  dimensions,
  stat = 'Average',
  range = '1h',
  period: periodOverride, // EC2 basic monitoring only has 5-min data → pass 300
  perSecond = false, // divide by the period (e.g. NetworkIn bytes → bytes/s)
  transform,
}) {
  const preset = RANGE[range] || RANGE['1h'];
  const period = periodOverride || preset.period;
  const { seconds } = preset;
  const end = new Date();
  const start = new Date(end.getTime() - seconds * 1000);

  const out = await cw().send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      ScanBy: 'TimestampAscending',
      MetricDataQueries: [
        {
          Id: 'm',
          ReturnData: true,
          MetricStat: {
            Metric: { Namespace: namespace, MetricName: metricName, Dimensions: dimensions },
            Period: period,
            Stat: stat,
          },
        },
      ],
    })
  );

  const r = out.MetricDataResults?.[0];
  const times = r?.Timestamps || [];
  const values = r?.Values || [];
  return times.map((t, i) => {
    let v = values[i];
    if (perSecond) v = v / period;
    if (transform) v = transform(v);
    return { t: t instanceof Date ? t.getTime() : new Date(t).getTime(), v: Number(v.toFixed(2)) };
  });
}
