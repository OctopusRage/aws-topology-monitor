// Standalone target group — a real target group (e.g. an ASG-autoscaled worker
// pool) dropped on the canvas, NOT wired to the viewed ELB. Its instances are
// fetched live so ASG scaling reflects automatically. Server children reuse the
// grid 'server' node type.
import ConnectHandles from './ConnectHandles.jsx';

export function StandaloneTgNode({ data }) {
  const { tg, healthy, total, onOpen, onRemove } = data;
  const empty = total === 0;
  const ok = !empty && healthy === total;
  return (
    <div className="stg-node">
      <ConnectHandles />
      <div className="stg-header" onClick={onOpen} title="Click to open monitoring metrics">
        <div className="stg-header-left">
          <div className="node-icon stg-icon">⊟</div>
          <div className="tg-text">
            <div className="node-kicker">
              TARGET GROUP · ASG · {tg.protocol}:{tg.port}
            </div>
            <div className="node-title tg-title">{tg.name}</div>
          </div>
        </div>
        <span className={`health-pill ${empty ? 'empty' : ok ? 'ok' : 'warn'}`}>
          {empty ? 'no targets' : `${healthy}/${total} healthy`}
        </span>
      </div>
      {empty && <div className="tg-empty">no registered targets</div>}
      <button
        className="dp-remove stg-remove"
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

export const standaloneTgNodeTypes = { standaloneTg: StandaloneTgNode };
