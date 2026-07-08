import ConnectHandles from './ConnectHandles.jsx';

export const DP_TYPES = {
  rds: { label: 'RDS', icon: '🛢', accent: '#4a90e2' },
  opensearch: { label: 'OpenSearch', icon: '🔎', accent: '#38d39f' },
  clickhouse: { label: 'ClickHouse', icon: '⚡', accent: '#ffb547' },
  custom: { label: 'Custom', icon: '📦', accent: '#7b6cff' },
  ec2: { label: 'EC2', icon: '🖥', accent: '#ff9900' },
  elasticache: { label: 'ElastiCache', icon: '🧊', accent: '#00b8d9' },
};

export function DatapointNode({ data }) {
  const { dp, onOpen, onRemove } = data;
  const meta = DP_TYPES[dp.type] || DP_TYPES.custom;
  return (
    <div
      className="dp-node"
      style={{ borderColor: meta.accent, boxShadow: `0 0 22px ${meta.accent}44` }}
      onClick={onOpen}
      title="Click to view resource usage"
    >
      <ConnectHandles />
      <div className="dp-icon" style={{ background: `${meta.accent}22`, color: meta.accent }}>
        {meta.icon}
      </div>
      <div className="dp-body">
        <div className="dp-kicker" style={{ color: meta.accent }}>
          {meta.label} · {dp.source}
        </div>
        <div className="dp-label">{dp.label}</div>
      </div>
      <button
        className="dp-remove"
        title="Remove from view"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ✕
      </button>
    </div>
  );
}

// Background container that visually groups the auto-arranged data points.
export function DatapointGroupNode({ data }) {
  return (
    <div className="dp-group">
      {/* connection handles so the whole group can be wired to other nodes */}
      <ConnectHandles className="dp-group-conn" />
      <div className="dp-group-label">{data?.name || 'DATA POINTS'}</div>
      {data?.onRemove && (
        <button
          className="dp-group-remove"
          title="Remove all data points in this group"
          onClick={(e) => {
            e.stopPropagation();
            data.onRemove();
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export const datapointNodeTypes = {
  datapoint: DatapointNode,
  dpGroup: DatapointGroupNode,
};
