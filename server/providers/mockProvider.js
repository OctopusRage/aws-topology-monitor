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

  async getListenerRules(lbArn) {
    const lb = LOAD_BALANCERS.find((l) => l.arn === lbArn);
    const tgs = lb?.targetGroups || [];
    const first = tgs[0]?.name || 'web-tg';
    const second = tgs[1]?.name || first;
    return {
      lbArn,
      listeners: [
        {
          listenerArn: `${lbArn}/listener/443`,
          protocol: 'HTTPS',
          port: 443,
          rules: [
            {
              priority: '1',
              isDefault: false,
              conditions: [{ field: 'Path', values: ['/api/*'] }],
              actions: [{ type: 'forward', targets: [{ name: first }] }],
            },
            {
              priority: '2',
              isDefault: false,
              conditions: [{ field: 'Host', values: ['admin.example.com'] }],
              actions: [{ type: 'forward', targets: [{ name: second }] }],
            },
            {
              priority: 'default',
              isDefault: true,
              conditions: [],
              actions: [{ type: 'forward', targets: [{ name: first }] }],
            },
          ],
        },
        {
          listenerArn: `${lbArn}/listener/80`,
          protocol: 'HTTP',
          port: 80,
          rules: [
            {
              priority: 'default',
              isDefault: true,
              conditions: [],
              actions: [{ type: 'redirect', detail: 'HTTPS://#{host}:443/#{path} (HTTP_301)' }],
            },
          ],
        },
      ],
    };
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
      elasticache: [
        { id: 'session-cache', engine: 'redis', nodeType: 'cache.r6g.large', status: 'available' },
        { id: 'rate-limiter', engine: 'redis', nodeType: 'cache.t4g.medium', status: 'available' },
        { id: 'page-cache', engine: 'memcached', nodeType: 'cache.r6g.xlarge', status: 'available' },
      ],
    };
  },

  async getRdsTopQueries() {
    return {
      enabled: true,
      engine: 'postgres',
      queries: [
        { sql: 'SELECT * FROM messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT $2', id: 'A1B2', load: 2.14, calls: 18200 },
        { sql: 'UPDATE user_sessions SET last_seen = now() WHERE user_id = $1', id: 'C3D4', load: 1.02, calls: 54000 },
        { sql: 'INSERT INTO events (type, payload, created_at) VALUES ($1, $2, $3)', id: 'E5F6', load: 0.88, calls: 31200 },
        { sql: 'SELECT count(*) FROM subscriptions WHERE status = $1 AND expires_at > now()', id: 'G7H8', load: 0.45, calls: 6400 },
        { sql: 'SELECT u.* FROM users u JOIN guild_members gm ON gm.user_id = u.id WHERE gm.guild_id = $1', id: 'I9J0', load: 0.31, calls: 2100 },
      ],
    };
  },

  async listEc2Instances() {
    const states = ['running', 'running', 'running', 'stopped'];
    return Array.from({ length: 24 }, (_, i) => ({
      id: `i-0${(1000 + i).toString(16)}worker`,
      name: `worker-${String(i + 1).padStart(2, '0')}`,
      type: i % 3 === 0 ? 'c6g.xlarge' : 't3.medium',
      state: states[i % states.length],
      privateIp: `10.30.${20 + (i % 5)}.${30 + i}`,
      az: `ap-southeast-3${['a', 'b', 'c'][i % 3]}`,
    }));
  },

  async listTargetGroups() {
    const out = [];
    for (const lb of LOAD_BALANCERS) {
      for (const tg of lb.targetGroups) {
        out.push({
          arn: tg.arn,
          name: tg.name,
          protocol: tg.protocol,
          port: tg.port,
          targetType: tg.targetType,
          lbArn: lb.arn,
        });
      }
    }
    return out;
  },

  async getStandaloneTargetGroup(tgArn) {
    for (const lb of LOAD_BALANCERS) {
      const tg = lb.targetGroups.find((t) => t.arn === tgArn);
      if (tg) return { ...tg, lbArn: lb.arn };
    }
    return null;
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
