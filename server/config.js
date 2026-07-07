import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 4000),

  // Toggle between mock data and live AWS SDK.
  // Set USE_AWS=true (and provide AWS credentials in the environment) to read
  // real ELBs / target groups / instances.
  useAws: String(process.env.USE_AWS || 'false').toLowerCase() === 'true',
  awsRegion: process.env.AWS_REGION || 'ap-southeast-1',

  // Prometheus that scrapes node_exporter on your instances.
  prometheus: {
    url: process.env.PROMETHEUS_URL || 'http://localhost:9090',
    // How node_exporter's `instance` label maps to a target. Usually
    // "<private-ip>:9100". We match targets to series by private IP.
    exporterPort: process.env.NODE_EXPORTER_PORT || '9100',
    // Filesystem mountpoint used for the Storage metric.
    rootMount: process.env.ROOT_MOUNT || '/',
  },

  // When Prometheus is unreachable (or you just want a demo), synthesize
  // realistic-looking metric series instead of failing.
  mockMetrics: String(process.env.MOCK_METRICS || 'true').toLowerCase() === 'true',

  // Pull the Request Count panel from CloudWatch (ALB's native RequestCount
  // metric, per target group) instead of the node_exporter network proxy.
  // Needs AWS credentials + real LB/target-group ARNs. CPU/RAM/Storage still
  // come from Prometheus/node_exporter.
  cloudwatch: {
    useForRequests:
      String(process.env.USE_CLOUDWATCH_REQUESTS || 'false').toLowerCase() === 'true',
  },

  // Default admin seeded on first run (only used when the users table is empty).
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },
};
