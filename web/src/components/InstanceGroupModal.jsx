import NodeButtons from './NodeButtons.jsx';

// Instance groups have no aggregate metrics, so this modal is a hub: the member
// instances (each drills into its own EC2 metrics) plus the group's custom links.
export default function InstanceGroupModal({ group, buttons, onEditButtons, onOpenInstance, onClose }) {
  const instances = group?.instances || [];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ig-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="node-kicker">INSTANCE GROUP</div>
            <h2>{group?.name}</h2>
            <div className="modal-sub">
              {instances.length} instance{instances.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="server-list">
          <div className="node-kicker">INSTANCES IN THIS GROUP</div>
          <div className="ig-modal-list">
            {instances.map((inst) => (
              <button
                key={inst.id}
                className="ig-modal-inst"
                onClick={() => onOpenInstance(inst)}
                title="View this instance's metrics"
              >
                <span className="ig-modal-inst-main">
                  <b>{inst.name}</b>
                  <span className="ig-modal-inst-id">{inst.id}</span>
                </span>
                <span className="ig-modal-inst-ip">
                  {inst.privateIp || '—'} <span className="ig-modal-cta">📊 metrics</span>
                </span>
              </button>
            ))}
            {instances.length === 0 && <div className="modal-sub">No instances.</div>}
          </div>
        </div>

        {(buttons?.length > 0 || onEditButtons) && (
          <div className="modal-links">
            <div className="node-kicker">CUSTOM LINKS</div>
            <NodeButtons buttons={buttons} onEdit={onEditButtons} />
          </div>
        )}
      </div>
    </div>
  );
}
