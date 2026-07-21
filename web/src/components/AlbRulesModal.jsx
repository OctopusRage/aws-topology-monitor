import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { downloadFile, slug, stamp } from '../download.js';

function ActionText({ action }) {
  if (action.type === 'forward') {
    return (
      <span className="rule-action">
        forward →{' '}
        {(action.targets || []).map((t, i) => (
          <span key={i} className="rule-tg">
            {t.name}
            {t.weight != null && (action.targets.length > 1 ? ` (${t.weight})` : '')}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="rule-action">
      {action.type}
      {action.detail ? ` · ${action.detail}` : ''}
    </span>
  );
}

export default function AlbRulesModal({ lbArn, name, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .elbRules(lbArn)
      .then((r) => alive && setData(r))
      .catch((e) => alive && setError(String(e.message || e)));
    return () => {
      alive = false;
    };
  }, [lbArn]);

  const listeners = data?.listeners || [];

  // JSON keeps the nested listener → rules → conditions/actions shape intact,
  // so the export stays faithful and is easy to diff / review.
  const exportJson = () => {
    const payload = {
      loadBalancer: { name: name || null, arn: lbArn },
      exportedAt: new Date().toISOString(),
      listeners: listeners.map((l) => ({
        listenerArn: l.listenerArn,
        protocol: l.protocol,
        port: l.port,
        rules: (l.rules || []).map((r) => ({
          priority: r.priority,
          isDefault: r.isDefault,
          conditions: r.conditions,
          actions: r.actions,
        })),
      })),
    };
    downloadFile(
      `elb-rules-${slug(name || 'load-balancer')}-${stamp()}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal rules-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="node-kicker">LOAD BALANCER</div>
            <h2>{name || 'Listener rules'}</h2>
            <div className="modal-sub">Listener rules & routing</div>
          </div>
          <div className="modal-header-actions">
            <button
              className="export-btn"
              onClick={exportJson}
              disabled={!listeners.length}
              title="Download all listener rules as JSON"
            >
              ⬇ Export JSON
            </button>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="rules-body">
          {error && <div className="modal-error">⚠ {error}</div>}
          {!data && !error && <div className="canvas-loading">Loading rules…</div>}

          {listeners.map((l) => (
            <div key={l.listenerArn} className="rules-listener">
              <div className="rules-listener-head">
                <span className="rules-proto">{l.protocol}</span>
                <span className="rules-port">:{l.port}</span>
                <span className="rules-count">{l.rules.length} rule{l.rules.length !== 1 ? 's' : ''}</span>
              </div>
              <table className="rules-table">
                <thead>
                  <tr>
                    <th className="rule-prio">#</th>
                    <th>IF (conditions)</th>
                    <th>THEN (action)</th>
                  </tr>
                </thead>
                <tbody>
                  {l.rules.map((r, i) => (
                    <tr key={i} className={r.isDefault ? 'rule-default' : ''}>
                      <td className="rule-prio">{r.isDefault ? 'default' : r.priority}</td>
                      <td>
                        {r.conditions.length === 0 ? (
                          <span className="rule-any">any request</span>
                        ) : (
                          r.conditions.map((c, j) => (
                            <div key={j} className="rule-cond">
                              <span className="rule-field">{c.field}</span>
                              <span className="rule-vals">{(c.values || []).join(', ')}</span>
                            </div>
                          ))
                        )}
                      </td>
                      <td>
                        {r.actions.map((a, k) => (
                          <ActionText key={k} action={a} />
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {data && listeners.length === 0 && (
            <div className="modal-sub">No listeners found on this load balancer.</div>
          )}
        </div>
      </div>
    </div>
  );
}
