import { Handle, Position } from 'reactflow';

export const DP_TYPES = {
  rds: { label: 'RDS', icon: '🛢', accent: '#4a90e2' },
  opensearch: { label: 'OpenSearch', icon: '🔎', accent: '#38d39f' },
  clickhouse: { label: 'ClickHouse', icon: '⚡', accent: '#ffb547' },
  custom: { label: 'Custom', icon: '📦', accent: '#7b6cff' },
  ec2: { label: 'EC2', icon: '🖥', accent: '#ff9900' },
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
      {/* optional connection handles (standalone by default) */}
      <Handle type="target" position={Position.Left} className="rf-handle dp-handle" />
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
      <Handle type="source" position={Position.Right} className="rf-handle dp-handle" />
    </div>
  );
}

// Background container that visually groups the auto-arranged data points.
export function DatapointGroupNode() {
  return (
    <div className="dp-group">
      <div className="dp-group-label">DATA POINTS</div>
    </div>
  );
}

export const datapointNodeTypes = {
  datapoint: DatapointNode,
  dpGroup: DatapointGroupNode,
};
