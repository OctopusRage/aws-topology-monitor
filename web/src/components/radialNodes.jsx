import { Handle, Position } from 'reactflow';

// Central ELB with source handles on all four sides so spokes can leave from
// whichever side faces each surrounding target group.
export function ElbRadialNode({ data }) {
  const { lb, tgCount } = data;
  return (
    <div className="node elb-node radial-elb">
      <div className="node-icon elb-icon">⑆</div>
      <div className="node-body">
        <div className="node-kicker">{lb.type?.toUpperCase()} LOAD BALANCER</div>
        <div className="node-title">{lb.name}</div>
        <div className="node-tags">
          <span
            className={`tag ${lb.scheme === 'internet-facing' ? 'tag-public' : 'tag-internal'}`}
          >
            {lb.scheme}
          </span>
          <span className="tag tag-state">{lb.state}</span>
          <span className="tag">{tgCount} target groups</span>
        </div>
      </div>
      <Handle id="top" type="source" position={Position.Top} className="rf-handle" />
      <Handle id="right" type="source" position={Position.Right} className="rf-handle" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="rf-handle" />
      <Handle id="left" type="source" position={Position.Left} className="rf-handle" />
    </div>
  );
}

// Same container as the grid target group (servers live inside as children),
// but the inbound handle sits on the side facing the central ELB.
export function TargetGroupRadialNode({ data }) {
  const { tg, healthy, total, onClick, handlePos, buttons, onEditButtons } = data;
  const empty = total === 0;
  const allHealthy = !empty && healthy === total;
  return (
    <div className="node tg-node">
      <Handle
        id="in"
        type="target"
        position={handlePos || Position.Top}
        className="rf-handle"
      />
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

export const radialNodeTypes = {
  elbRadial: ElbRadialNode,
  tgRadial: TargetGroupRadialNode,
};
