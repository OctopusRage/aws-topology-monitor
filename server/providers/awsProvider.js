// Live AWS provider — reads real ELBs, target groups and instances via the
// AWS SDK v3. Enabled when USE_AWS=true. Returns the SAME shape as mockProvider.
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import {
  OpenSearchClient,
  ListDomainNamesCommand,
} from '@aws-sdk/client-opensearch';
import { PIClient, DescribeDimensionKeysCommand } from '@aws-sdk/client-pi';
import {
  ElastiCacheClient,
  DescribeCacheClustersCommand,
} from '@aws-sdk/client-elasticache';
import { config } from '../config.js';

const elbv2 = new ElasticLoadBalancingV2Client({ region: config.awsRegion });
const ec2 = new EC2Client({ region: config.awsRegion });
const rds = new RDSClient({ region: config.awsRegion });
const opensearch = new OpenSearchClient({ region: config.awsRegion });
const pi = new PIClient({ region: config.awsRegion });
const elasticache = new ElastiCacheClient({ region: config.awsRegion });

const RANGE_SECONDS = { '15m': 900, '1h': 3600, '6h': 21600, '24h': 86400 };

let _accountId = null;

function mapLb(lb) {
  return {
    arn: lb.LoadBalancerArn,
    name: lb.LoadBalancerName,
    dnsName: lb.DNSName,
    type: lb.Type,
    scheme: lb.Scheme,
    state: lb.State?.Code,
  };
}

// Batch-resolve EC2 instance metadata (Name tag, private IP, AZ, type).
async function describeInstances(instanceIds) {
  const meta = new Map();
  if (instanceIds.length === 0) return meta;
  const out = await ec2.send(
    new DescribeInstancesCommand({ InstanceIds: instanceIds })
  );
  for (const res of out.Reservations || []) {
    for (const inst of res.Instances || []) {
      const nameTag = (inst.Tags || []).find((t) => t.Key === 'Name');
      meta.set(inst.InstanceId, {
        name: nameTag?.Value || inst.InstanceId,
        privateIp: inst.PrivateIpAddress,
        az: inst.Placement?.AvailabilityZone,
        instanceType: inst.InstanceType,
      });
    }
  }
  return meta;
}

async function targetGroupsForLb(lbArn) {
  const out = await elbv2.send(
    new DescribeTargetGroupsCommand({ LoadBalancerArn: lbArn })
  );
  return out.TargetGroups || [];
}

async function buildTargetGroup(tg) {
  const health = await elbv2.send(
    new DescribeTargetHealthCommand({ TargetGroupArn: tg.TargetGroupArn })
  );
  const descriptions = health.TargetHealthDescriptions || [];
  const instanceIds = descriptions
    .map((d) => d.Target?.Id)
    .filter((id) => id && id.startsWith('i-'));
  const meta = await describeInstances(instanceIds);

  const targets = descriptions.map((d) => {
    const id = d.Target?.Id;
    const m = meta.get(id) || {};
    return {
      id,
      name: m.name || id,
      port: d.Target?.Port,
      health: d.TargetHealth?.State,
      az: m.az || d.Target?.AvailabilityZone,
      privateIp: m.privateIp,
      instanceType: m.instanceType,
    };
  });

  return {
    arn: tg.TargetGroupArn,
    name: tg.TargetGroupName,
    protocol: tg.Protocol,
    port: tg.Port,
    targetType: tg.TargetType,
    healthyThreshold: tg.HealthyThresholdCount,
    targets,
  };
}

export const awsProvider = {
  async listLoadBalancers() {
    const out = await elbv2.send(new DescribeLoadBalancersCommand({}));
    return (out.LoadBalancers || []).map(mapLb);
  },

  async getTopology(lbArn) {
    const out = await elbv2.send(
      new DescribeLoadBalancersCommand({ LoadBalancerArns: [lbArn] })
    );
    const raw = out.LoadBalancers?.[0];
    if (!raw) return null;
    const tgs = await targetGroupsForLb(lbArn);
    const targetGroups = await Promise.all(tgs.map(buildTargetGroup));
    return { loadBalancer: mapLb(raw), targetGroups };
  },

  // Account id is embedded in every ELB ARN — cache it (needed for the
  // OpenSearch CloudWatch ClientId dimension).
  async getAccountId() {
    if (_accountId) return _accountId;
    const out = await elbv2.send(new DescribeLoadBalancersCommand({}));
    _accountId = out.LoadBalancers?.[0]?.LoadBalancerArn?.split(':')[4] || null;
    return _accountId;
  },

  // Discover RDS + OpenSearch + ElastiCache to offer as data points.
  async listDataSources() {
    const [rdsOut, esOut, ecOut] = await Promise.all([
      rds.send(new DescribeDBInstancesCommand({})).catch(() => ({ DBInstances: [] })),
      opensearch.send(new ListDomainNamesCommand({})).catch(() => ({ DomainNames: [] })),
      elasticache
        .send(new DescribeCacheClustersCommand({}))
        .catch(() => ({ CacheClusters: [] })),
    ]);
    return {
      rds: (rdsOut.DBInstances || []).map((d) => ({
        id: d.DBInstanceIdentifier,
        engine: d.Engine,
        class: d.DBInstanceClass,
        status: d.DBInstanceStatus,
      })),
      opensearch: (esOut.DomainNames || []).map((d) => ({
        domain: d.DomainName,
        engine: d.EngineType,
        status: 'active',
      })),
      elasticache: (ecOut.CacheClusters || []).map((c) => ({
        id: c.CacheClusterId,
        engine: c.Engine,
        nodeType: c.CacheNodeType,
        status: c.CacheClusterStatus,
      })),
    };
  },

  // Top SQL by DB load, from RDS Performance Insights (like the PI dashboard).
  async getRdsTopQueries(dbInstanceId, range = '1h') {
    const out = await rds.send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: dbInstanceId })
    );
    const db = out.DBInstances?.[0];
    if (!db) return { enabled: false, reason: 'instance not found' };
    if (!db.PerformanceInsightsEnabled)
      return { enabled: false, reason: 'Performance Insights is not enabled on this instance' };

    const seconds = RANGE_SECONDS[range] || 3600;
    const end = new Date();
    const start = new Date(end.getTime() - seconds * 1000);

    const res = await pi.send(
      new DescribeDimensionKeysCommand({
        ServiceType: 'RDS',
        Identifier: db.DbiResourceId,
        StartTime: start,
        EndTime: end,
        Metric: 'db.load.avg',
        GroupBy: {
          Group: 'db.sql_tokenized',
          Dimensions: ['db.sql_tokenized.statement', 'db.sql_tokenized.id'],
          Limit: 10,
        },
      })
    );

    const queries = (res.Keys || [])
      .map((k) => ({
        sql: k.Dimensions?.['db.sql_tokenized.statement'] || '(unknown)',
        id: k.Dimensions?.['db.sql_tokenized.id'],
        load: Number((k.Total || 0).toFixed(3)),
      }))
      .sort((a, b) => b.load - a.load);

    return { enabled: true, engine: db.Engine, queries };
  },

  // All EC2 instances (for the "add instances" picker). Paginated + mapped.
  async listEc2Instances() {
    const instances = [];
    let token;
    do {
      const out = await ec2.send(
        new DescribeInstancesCommand({ NextToken: token, MaxResults: 1000 })
      );
      for (const res of out.Reservations || []) {
        for (const inst of res.Instances || []) {
          const nameTag = (inst.Tags || []).find((t) => t.Key === 'Name');
          instances.push({
            id: inst.InstanceId,
            name: nameTag?.Value || inst.InstanceId,
            type: inst.InstanceType,
            state: inst.State?.Name,
            privateIp: inst.PrivateIpAddress,
            az: inst.Placement?.AvailabilityZone,
          });
        }
      }
      token = out.NextToken;
    } while (token);
    return instances.sort((a, b) => a.name.localeCompare(b.name));
  },

  async getTargetGroupTargets(tgArn) {
    const health = await elbv2.send(
      new DescribeTargetHealthCommand({ TargetGroupArn: tgArn })
    );
    const descriptions = health.TargetHealthDescriptions || [];
    const instanceIds = descriptions
      .map((d) => d.Target?.Id)
      .filter((id) => id && id.startsWith('i-'));
    const meta = await describeInstances(instanceIds);
    return descriptions.map((d) => {
      const m = meta.get(d.Target?.Id) || {};
      return {
        id: d.Target?.Id,
        name: m.name || d.Target?.Id,
        port: d.Target?.Port,
        health: d.TargetHealth?.State,
        privateIp: m.privateIp,
        az: m.az,
      };
    });
  },
};
