import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

export default function AddTargetGroupModal({ existing, onAdd, onClose }) {
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState({}); // arn -> tg

  useEffect(() => {
    setLoading(true);
    api
      .listTargetGroups()
      .then(setAll)
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, []);

  const has = useMemo(() => new Set(existing.map((s) => s.tgArn)), [existing]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? all.filter((t) => t.name.toLowerCase().includes(term))
      : all;
    return list.slice(0, 200);
  }, [all, q]);

  const toggle = (tg) =>
    setPicked((p) => {
      const next = { ...p };
      if (next[tg.arn]) delete next[tg.arn];
      else next[tg.arn] = tg;
      return next;
    });

  const pickedList = Object.values(picked);

  const submit = (e) => {
    e.preventDefault();
    if (pickedList.length === 0) return setError('pick at least one target group');
    onAdd(pickedList.map((t) => ({ tgArn: t.arn, name: t.name })));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ins-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="node-kicker">CANVAS</div>
            <h2>Add target group</h2>
            <div className="modal-sub">
              A standalone target group (e.g. an ASG worker pool) — instances update live
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <form className="ins-form" onSubmit={submit}>
          <input
            className="ins-search"
            placeholder={loading ? 'discovering target groups…' : `Search ${all.length} target groups`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="ins-list">
            {filtered.map((t) => {
              const already = has.has(t.arn);
              return (
                <button
                  type="button"
                  key={t.arn}
                  className={`ins-row ${picked[t.arn] ? 'on' : ''}`}
                  disabled={already}
                  onClick={() => !already && toggle(t)}
                >
                  <span className={`ins-check ${picked[t.arn] ? 'on' : ''}`}>
                    {picked[t.arn] ? '✓' : ''}
                  </span>
                  <span className="ins-row-name">{t.name}</span>
                  <span className="ins-row-meta">
                    {t.protocol}:{t.port} · {t.lbArn ? 'behind LB' : 'ASG only'}
                    {already ? ' · added' : ''}
                  </span>
                </button>
              );
            })}
            {!loading && filtered.length === 0 && (
              <div className="ins-empty">no target groups match “{q}”</div>
            )}
          </div>

          {error && <div className="login-error">⚠ {error}</div>}

          <button className="login-btn">
            Add {pickedList.length || ''} target group{pickedList.length === 1 ? '' : 's'}
          </button>
        </form>
      </div>
    </div>
  );
}
