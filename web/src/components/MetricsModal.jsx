import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import MetricPanel from './MetricPanel.jsx';
import NodeButtons from './NodeButtons.jsx';

const RANGES = ['15m', '1h', '6h', '24h'];
const SOURCES = [
  { key: 'cloudwatch', label: 'CloudWatch (ALB)' },
  { key: 'prometheus', label: 'node_exporter' },
];

export default function MetricsModal({ targetGroup, lbArn, defaultSource, buttons, onEditButtons, onClose }) {
  const [range, setRange] = useState('1h');
  const [source, setSource] = useState(defaultSource || 'cloudwatch');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.targetGroupMetrics(targetGroup.arn, range, lbArn, source);
      setData(res);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [targetGroup.arn, range, lbArn, source]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  useEffect(() => {
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="node-kicker">TARGET GROUP MONITORING</div>
            <h2>{targetGroup.name}</h2>
            <div className="modal-sub">
              {targetGroup.targets.length} servers · {targetGroup.protocol}:{targetGroup.port}
              {data &&
                (() => {
                  const live = data.source === 'cloudwatch' || data.source === 'prometheus';
                  return (
                    <span className={`source-badge ${live ? data.source : 'mock'}`}>
                      {live ? `live · ${data.source}` : 'sample'}
                    </span>
                  );
                })()}
            </div>
          </div>
          <div className="modal-actions">
            <div className="range-switch source-switch">
              {SOURCES.map((s) => (
                <button
                  key={s.key}
                  className={s.key === source ? 'active' : ''}
                  onClick={() => setSource(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="range-switch">
              {RANGES.map((r) => (
                <button key={r} className={r === range ? 'active' : ''} onClick={() => setRange(r)}>
                  {r}
                </button>
              ))}
            </div>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        {(buttons?.length > 0 || onEditButtons) && (
          <div className="modal-links-bare">
            <NodeButtons buttons={buttons} onEdit={onEditButtons} />
          </div>
        )}

        {error && <div className="modal-error">⚠ {error}</div>}
        {data?.error && (
          <div className="modal-warn">Source unavailable ({data.error}) — showing sample data.</div>
        )}

        <div className="metric-grid" style={{ opacity: loading && !data ? 0.4 : 1 }}>
          {(data?.panels || []).map((p) => (
            <MetricPanel key={p.key} panel={p} />
          ))}
        </div>

        <div className="server-list">
          <div className="node-kicker">SERVERS IN THIS GROUP</div>
          <div className="server-chips">
            {targetGroup.targets.map((s) => (
              <span key={s.id} className={`chip ${s.health}`}>
                <b>{s.name}</b> {s.privateIp || s.id}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
