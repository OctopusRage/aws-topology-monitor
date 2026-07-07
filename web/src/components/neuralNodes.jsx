import { Handle, Position } from 'reactflow';

const healthColor = {
  healthy: '#38d39f',
  unhealthy: '#ff5a5a',
  draining: '#ffb547',
  initial: '#8a8fa3',
  unused: '#8a8fa3',
};

export function ElbNeuralNode({ data }) {
  const { lb } = data;
  return (
    <div className="nn-elb">
      <span className="nn-elb-dot">⑆</span>
      <div className="nn-elb-label">
        <div className="nn-elb-name">{lb.name}</div>
        <div className="nn-elb-sub">{lb.scheme}</div>
      </div>
      <Handle type="source" position={Position.Right} className="nn-handle" />
    </div>
  );
}

export function TgNeuralNode({ data }) {
  const { tg, healthy, total, onClick } = data;
  const empty = total === 0;
  const ok = !empty && healthy === total;
  return (
    <div className="nn-tg-wrap" onClick={onClick} title="Click for metrics">
      <Handle type="target" position={Position.Left} className="nn-handle" />
      <div className={`nn-tg-circle ${empty ? 'empty' : ok ? 'ok' : 'warn'}`}>
        <span>{total}</span>
      </div>
      <div className="nn-tg-name">{tg.name}</div>
      <div className="nn-tg-sub">
        {empty ? 'no targets' : `${healthy}/${total} healthy`}
      </div>
      <Handle type="source" position={Position.Right} className="nn-handle" />
    </div>
  );
}

export function ServerNeuralNode({ data }) {
  const { srv } = data;
  const c = healthColor[srv.health] || '#8a8fa3';
  return (
    <div className="nn-srv-wrap">
      <Handle type="target" position={Position.Left} className="nn-handle" />
      <span
        className="nn-srv-dot"
        style={{ background: c, boxShadow: `0 0 10px ${c}` }}
      />
      <div className="nn-srv-label">
        <div className="nn-srv-name">{srv.name}</div>
        <div className="nn-srv-ip">{srv.privateIp || srv.id}</div>
      </div>
    </div>
  );
}

export const neuralNodeTypes = {
  elbN: ElbNeuralNode,
  tgN: TgNeuralNode,
  serverN: ServerNeuralNode,
};
