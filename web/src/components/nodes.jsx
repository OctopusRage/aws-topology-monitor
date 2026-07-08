import { Handle, Position } from 'reactflow';

const healthColor = {
  healthy: '#38d39f',
  unhealthy: '#ff5a5a',
  draining: '#ffb547',
  initial: '#8a8fa3',
  unused: '#8a8fa3',
};

export function ElbNode({ data }) {
  const { lb, tgCount } = data;
  return (
    <div className="node elb-node">
      <div className="node-icon elb-icon">⑆</div>
      <div className="node-body">
        <div className="node-kicker">{lb.type?.toUpperCase()} LOAD BALANCER</div>
        <div className="node-title">{lb.name}</div>
        <div className="node-sub">{lb.dnsName}</div>
        <div className="node-tags">
          <span className={`tag ${lb.scheme === 'internet-facing' ? 'tag-public' : 'tag-internal'}`}>
            {lb.scheme}
          </span>
          <span className="tag tag-state">{lb.state}</span>
          <span className="tag">{tgCount} target groups</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="rf-handle" />
    </div>
  );
}

export function TargetGroupNode({ data }) {
  const { tg, healthy, total, onClick, buttons, onEditButtons } = data;
  const empty = total === 0;
  const allHealthy = !empty && healthy === total;
  return (
    <div className="node tg-node">
      <Handle type="target" position={Position.Top} className="rf-handle" />
      <div
        className="tg-header"
        onClick={onClick}
        title="Click to open monitoring metrics"
      >
        <div className="tg-header-left">
          <div className="node-icon tg-icon">⊟</div>
          <div className="tg-text">
            <div className="node-kicker">TARGET GROUP · {tg.protocol}:{tg.port}</div>
            <div className="node-title tg-title">{tg.name}</div>
          </div>
        </div>
        <div className="tg-header-right">
          <span
            className={`health-pill ${empty ? 'empty' : allHealthy ? 'ok' : 'warn'}`}
          >
            {empty ? 'no targets' : `${healthy}/${total} healthy`}
          </span>
          <span className="metrics-cta">📊 metrics</span>
        </div>
      </div>
      {empty && <div className="tg-empty">no registered targets</div>}
    </div>
  );
}

export function ServerNode({ data }) {
  const { srv } = data;
  const color = healthColor[srv.health] || '#8a8fa3';
  return (
    <div className="node server-node">
      <span className="server-status" style={{ background: color }} />
      <div className="server-body">
        <div className="server-name">{srv.name}</div>
        <div className="server-meta">
          <span>{srv.id}</span>
        </div>
        <div className="server-meta subtle">
          <span>{srv.privateIp || '—'}</span>
          <span>{srv.instanceType || srv.az || ''}</span>
        </div>
      </div>
    </div>
  );
}

export const nodeTypes = {
  elb: ElbNode,
  targetGroup: TargetGroupNode,
  server: ServerNode,
};
