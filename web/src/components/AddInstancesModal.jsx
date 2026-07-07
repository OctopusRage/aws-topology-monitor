import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

export default function AddInstancesModal({ groups, onAdd, onClose }) {
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [q, setQ] = useState('');
  const [picked, setPicked] = useState({}); // id -> instance
  const [target, setTarget] = useState('__new__');
  const [newName, setNewName] = useState('');

  useEffect(() => {
    setLoading(true);
    api
      .listEc2()
      .then(setAll)
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? all.filter(
          (i) =>
            i.name.toLowerCase().includes(term) ||
            i.id.toLowerCase().includes(term) ||
            (i.privateIp || '').includes(term)
        )
      : all;
    return list.slice(0, 200);
  }, [all, q]);

  const toggle = (inst) =>
    setPicked((p) => {
      const next = { ...p };
      if (next[inst.id]) delete next[inst.id];
      else next[inst.id] = inst;
      return next;
    });

  const pickedList = Object.values(picked);

  const submit = (e) => {
    e.preventDefault();
    if (pickedList.length === 0) return setError('pick at least one instance');
    if (target === '__new__' && !newName.trim())
      return setError('name the new instance group');
    onAdd({
      groupId: target === '__new__' ? null : target,
      groupName: target === '__new__' ? newName.trim() : null,
      instances: pickedList.map((i) => ({
        id: i.id,
        name: i.name,
        type: i.type,
        state: i.state,
        privateIp: i.privateIp,
        az: i.az,
      })),
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ins-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="node-kicker">CANVAS</div>
            <h2>Add instances</h2>
            <div className="modal-sub">
              Standalone EC2 instances (e.g. workers) — not connected to a target group
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <form className="ins-form" onSubmit={submit}>
          <div className="ins-group-row">
            <label className="login-field">
              <span>Instance group</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="__new__">＋ New group…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.instances.length})
                  </option>
                ))}
              </select>
            </label>
            {target === '__new__' && (
              <label className="login-field grow">
                <span>Group name</span>
                <input
                  placeholder="e.g. Workers"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
            )}
          </div>

          <div className="ins-pick">
            <input
              className="ins-search"
              placeholder={loading ? 'discovering EC2…' : `Search ${all.length} instances by name / id / ip`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="ins-list">
              {filtered.map((i) => (
                <button
                  type="button"
                  key={i.id}
                  className={`ins-row ${picked[i.id] ? 'on' : ''}`}
                  onClick={() => toggle(i)}
                >
                  <span className={`ins-check ${picked[i.id] ? 'on' : ''}`}>
                    {picked[i.id] ? '✓' : ''}
                  </span>
                  <span className={`ins-dot ${i.state}`} />
                  <span className="ins-row-name">{i.name}</span>
                  <span className="ins-row-meta">{i.id} · {i.type} · {i.state}</span>
                </button>
              ))}
              {!loading && filtered.length === 0 && (
                <div className="ins-empty">no instances match “{q}”</div>
              )}
            </div>
          </div>

          {error && <div className="login-error">⚠ {error}</div>}

          <button className="login-btn">
            Add {pickedList.length || ''} instance{pickedList.length === 1 ? '' : 's'}
          </button>
        </form>
      </div>
    </div>
  );
}
