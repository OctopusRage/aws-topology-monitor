import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../api.js';
import { DP_TYPES } from './datapointNode.jsx';
import MetricPanel from './MetricPanel.jsx';
import NodeButtons from './NodeButtons.jsx';

const RANGES = ['15m', '1h', '6h', '24h'];
const SOURCES = [
  { key: 'cloudwatch', label: 'CloudWatch' },
  { key: 'prometheus', label: 'node_exporter' },
];

// Copy text to the clipboard, falling back to execCommand for non-secure
// (http) contexts where navigator.clipboard is unavailable.
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function TopSql({ dbInstanceId, range }) {
  const [tq, setTq] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  useEffect(() => {
    let alive = true;
    setTq(null);
    api
      .rdsTopQueries(dbInstanceId, range)
      .then((r) => alive && setTq(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [dbInstanceId, range]);

  const onCopy = useCallback(async (key, sql) => {
    if (await copyText(sql)) {
      setCopiedId(key);
      setTimeout(() => setCopiedId((c) => (c === key ? null : c)), 1400);
    }
  }, []);

  if (!tq) return <div className="topsql"><div className="node-kicker">TOP SQL BY DB LOAD · loading…</div></div>;
  const queries = tq.queries || [];
  const maxLoad = Math.max(0.001, ...queries.map((q) => q.load || 0));
  const hasCalls = queries.some((q) => q.calls != null);

  return (
    <div className="topsql">
      <div className="node-kicker">
        TOP SQL BY DB LOAD
        <span className={`source-badge ${tq.source === 'performance-insights' ? 'prometheus' : 'mock'}`}>
          {tq.source === 'performance-insights' ? 'live · performance insights' : 'sample'}
        </span>
      </div>
      {tq.enabled === false && tq.reason && (
        <div className="modal-warn">{tq.reason} — showing sample.</div>
      )}
      <table className="topsql-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Statement</th>
            <th className="num">DB load (AAS)</th>
            {hasCalls && <th className="num">Calls</th>}
          </tr>
        </thead>
        <tbody>
          {queries.map((q, i) => {
            const key = q.id || i;
            const copied = copiedId === key;
            return (
            <tr key={key}>
              <td className="rank">{i + 1}</td>
              <td
                className={`sql${copied ? ' copied' : ''}`}
                onClick={() => onCopy(key, q.sql)}
                title="Click to copy the full query"
              >
                <code>{q.sql}</code>
                <span className="sql-copy">{copied ? '✓ copied' : '⧉ copy'}</span>
              </td>
              <td className="num load">
                <span className="load-bar" style={{ width: `${(q.load / maxLoad) * 100}%` }} />
                <span className="load-val">{q.load}</span>
              </td>
              {hasCalls && <td className="num">{q.calls != null ? q.calls.toLocaleString() : '—'}</td>}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DatapointMetricsModal({ datapoint, buttons, onEditButtons, onClose }) {
  const [range, setRange] = useState('1h');
  // EC2 instances can be viewed via CloudWatch or node_exporter (privateIp:9100)
  const supportsToggle = datapoint.type === 'ec2';
  const [source, setSource] = useState(datapoint.source || 'cloudwatch');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const meta = DP_TYPES[datapoint.type] || DP_TYPES.custom;

  // node_exporter target is derived from the instance's private IP.
  const effectiveDp = useMemo(
    () => ({
      ...datapoint,
      source,
      config: {
        ...datapoint.config,
        instance:
          source === 'prometheus' && datapoint.config?.privateIp
            ? `${datapoint.config.privateIp}:9100`
            : datapoint.config?.instance,
      },
    }),
    [datapoint, source]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.datapointMetrics(effectiveDp, range));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [effectiveDp, range]);

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
            <div className="node-kicker">
              {meta.icon} {meta.label} · RESOURCE USAGE
            </div>
            <h2>{datapoint.label}</h2>
            <div className="modal-sub">
              {datapoint.config?.dbInstanceId ||
                datapoint.config?.domainName ||
                datapoint.config?.instance}
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
            {supportsToggle && (
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
            )}
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

        {datapoint.type === 'rds' && datapoint.config?.dbInstanceId && (
          <TopSql dbInstanceId={datapoint.config.dbInstanceId} range={range} />
        )}
      </div>
    </div>
  );
}
