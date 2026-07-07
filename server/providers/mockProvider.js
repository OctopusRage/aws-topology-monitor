// Mock data provider — mirrors the shape returned by the AWS provider so the
// two are interchangeable. Structured as: LoadBalancer -> TargetGroups -> Targets(instances).

let seed = 1337;
function rand() {
  // deterministic PRNG so mock topology is stable across requests
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
}

function ip(a, b) {
  return `10.0.${a}.${b}`;
}

const HEALTH = ['healthy', 'healthy', 'healthy', 'unhealthy', 'draining'];

function makeInstance(prefix, idx, azSuffix) {
  const octet = 20 + idx;
  return {
    id: `i-0${prefix}${String(idx).padStart(3, '0')}abc`,
    name: `${prefix}-node-${idx + 1}`,
    port: 8080,
    health: HEALTH[Math.floor(rand() * HEALTH.length)],
    az: `ap-southeast-1${azSuffix}`,
    privateIp: ip(prefix.length, octet),
    instanceType: idx % 2 === 0 ? 't3.medium' : 't3.large',
  };
}

function makeTargetGroup(lbId, name, port, count, tgIdx) {
  const azs = ['a', 'b', 'c'];
  const targets = Array.from({ length: count }, (_, i) =>
    makeInstance(name, i, azs[i % azs.length])
  );
  return {
    arn: `arn:aws:elasticloadbalancing:ap-southeast-1:123456789012:targetgroup/${name}/${lbId}${tgIdx}`,
    name,
    protocol: 'HTTP',
    port,
    targetType: 'instance',
    healthyThreshold: 3,
    targets,
  };
}

const LOAD_BALANCERS = [
  {
    arn: 'arn:aws:elasticloadbalancing:ap-southeast-1:123456789012:loadbalancer/app/prod-public-alb/abc123',
    name: 'prod-public-alb',
    dnsName: 'prod-public-alb-1234567890.ap-southeast-1.elb.amazonaws.com',
    type: 'application',
    scheme: 'internet-facing',
    state: 'active',
    targetGroups: [
      makeTargetGroup('abc123', 'web-frontend', 80, 4, 1),
      makeTargetGroup('abc123', 'api-gateway', 8080, 3, 2),
      makeTargetGroup('abc123', 'auth-service', 9000, 2, 3),
    ],
  },
  {
    arn: 'arn:aws:elasticloadbalancing:ap-southeast-1:123456789012:loadbalancer/app/internal-services-alb/def456',
    name: 'internal-services-alb',
    dnsName: 'internal-internal-services-alb-9876543210.ap-southeast-1.elb.amazonaws.com',
    type: 'application',
    scheme: 'internal',
    state: 'active',
    targetGroups: [
      makeTargetGroup('def456', 'billing-worker', 8080, 3, 1),
      makeTargetGroup('def456', 'notification-svc', 8081, 2, 2),
      makeTargetGroup('def456', 'search-indexer', 9200, 5, 3),
      makeTargetGroup('def456', 'reporting-svc', 8082, 2, 4),
    ],
  },
];

export const mockProvider = {
  async listLoadBalancers() {
    return LOAD_BALANCERS.map(({ targetGroups, ...lb }) => lb);
  },

  async getTopology(lbArn) {
    const lb = LOAD_BALANCERS.find((l) => l.arn === lbArn);
    if (!lb) return null;
    const { targetGroups, ...loadBalancer } = lb;
    return { loadBalancer, targetGroups };
  },

  async getAccountId() {
    return '123456789012';
  },

  // Discoverable AWS resources to drop onto the canvas as data points.
  async listDataSources() {
    return {
      rds: [
        { id: 'qismo-prod-mysql', engine: 'mysql', class: 'db.r6g.xlarge', status: 'available' },
        { id: 'billing-postgres', engine: 'postgres', class: 'db.r6g.large', status: 'available' },
        { id: 'analytics-aurora', engine: 'aurora-mysql', class: 'db.r6g.2xlarge', status: 'available' },
      ],
      opensearch: [
        { domain: 'logs-prod', engine: 'OpenSearch_2.11', status: 'active' },
        { domain: 'search-catalog', engine: 'OpenSearch_2.11', status: 'active' },
      ],
    };
  },

  // Resolve a target group ARN to its member instances (used by metrics layer).
  async getTargetGroupTargets(tgArn) {
    for (const lb of LOAD_BALANCERS) {
      const tg = lb.targetGroups.find((t) => t.arn === tgArn);
      if (tg) return tg.targets;
    }
    return null;
  },
};
