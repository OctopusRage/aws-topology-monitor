import NodeButtons from './NodeButtons.jsx';
// Standalone instance groups — EC2 instances (e.g. workers) that aren't behind
// a target group. Rendered as a container holding clickable instance nodes.
import ConnectHandles from './ConnectHandles.jsx';

const stateColor = {
  running: '#38d39f',
  stopped: '#ff5a5a',
  stopping: '#ffb547',
  pending: '#ffb547',
  terminated: '#8a8fa3',
};

export function InstanceGroupNode({ data }) {
  const { name, count, onRemove, buttons, onEditButtons } = data;
  return (
    <div className="ig-node">
      <ConnectHandles />
      <div className="ig-header">
        <div className="ig-header-left">
          <span className="node-icon ig-icon">🖥</span>
          <div>
            <div className="node-kicker">INSTANCE GROUP</div>
            <div className="node-title">{name}</div>
          </div>
        </div>
        <span className="ig-count">{count}</span>
      </div>
      <NodeButtons buttons={buttons} onEdit={onEditButtons} />
      <button
        className="dp-remove ig-remove"
        title="Remove group"
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

export function InstanceNode({ data }) {
  const { inst, onOpen, buttons, onEditButtons } = data;
  const color = stateColor[inst.state] || '#8a8fa3';
  return (
    <div className="inst-node" onClick={onOpen} title="Click to view resource usage">
      <ConnectHandles />
      <span className="inst-status" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      <div className="inst-body">
        <div className="inst-name">{inst.name}</div>
        <div className="inst-meta">
          <span>{inst.id}</span>
        </div>
        <div className="inst-meta subtle">
          <span>{inst.privateIp || '—'}</span>
          <span>{inst.type || inst.state}</span>
        </div>
      </div>
    </div>
  );
}

export const instanceNodeTypes = {
  instanceGroup: InstanceGroupNode,
  instanceNode: InstanceNode,
};
