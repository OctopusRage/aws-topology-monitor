import { useState } from 'react';

// Admin editor for a node's custom link buttons.
export default function NodeButtonsModal({ title, buttons, onSave, onClose }) {
  const [rows, setRows] = useState((buttons || []).map((b) => ({ ...b })));

  const add = () =>
    setRows((r) => [...r, { id: crypto.randomUUID(), label: '', url: '' }]);
  const update = (id, patch) =>
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id) => setRows((r) => r.filter((x) => x.id !== id));

  const save = () => {
    const clean = rows
      .map((r) => ({ id: r.id, label: (r.label || '').trim(), url: (r.url || '').trim() }))
      .filter((r) => r.url);
    onSave(clean);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal btns-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="node-kicker">CUSTOM LINKS</div>
            <h2>{title || 'Custom links'}</h2>
            <div className="modal-sub">Buttons that open an external URL in a new tab</div>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="btns-body">
          {rows.length === 0 && <div className="modal-sub">No links yet — add one below.</div>}
          {rows.map((r) => (
            <div key={r.id} className="btn-row">
              <input
                className="btn-row-label"
                placeholder="Label (e.g. Loki logs)"
                value={r.label}
                onChange={(e) => update(r.id, { label: e.target.value })}
              />
              <input
                className="btn-row-url"
                placeholder="https://loki.qiscus.com/target-group-a"
                value={r.url}
                onChange={(e) => update(r.id, { url: e.target.value })}
              />
              <button className="del-btn" title="Remove" onClick={() => remove(r.id)}>✕</button>
            </div>
          ))}
          <button className="pw-gen" onClick={add}>＋ Add link</button>
        </div>

        <div className="btns-actions">
          <button className="del-btn" onClick={onClose}>Cancel</button>
          <button className="pw-apply" onClick={save}>Save links</button>
        </div>
      </div>
    </div>
  );
}
