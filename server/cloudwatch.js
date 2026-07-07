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
