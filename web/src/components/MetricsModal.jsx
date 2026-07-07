import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { api } from '../api.js';

const RANGES = ['15m', '1h', '6h', '24h'];

const PANELS = [
  { key: 'cpu', label: 'CPU', unit: '%', color: '#ff6d5a', max: 100 },
  { key: 'ram', label: 'Memory', unit: '%', color: '#7b6cff', max: 100 },
  { key: 'storage', label: 'Storage', unit: '%', color: '#38d39f', max: 100 },
  { key: 'requests', label: 'Request Count', unit: '/s', color: '#ffb547' },
];

function latest(series) {
  if (!series || series.length === 0) return null;
  return series[series.length - 1].v;
}

function fmtTime(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Panel({ panel, series, badge }) {
  const val = latest(series);
  const pct = panel.max ? Math.min(100, (val / panel.max) * 100) : null;
  return (
    <div className="metric-panel">
      <div className="metric-head">
        <span className="metric-label">
          <span className="metric-dot" style={{ background: panel.color }} />
          {panel.label}
          {badge && <span className={`panel-src ${badge}`}>{badge}</span>}
        </span>
        <span className="metric-value" style={{ color: panel.color }}>
          {val == null ? '—' : val.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          <small>{panel.unit}</small>
        </span>
      </div>
      {pct != null && (
        <div className="metric-bar">
          <span style={{ width: `${pct}%`, background: panel.color }} />
        </div>
      )}
      <div className="metric-chart">
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={series || []} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id={`g-${panel.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={panel.color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={panel.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#2a2d3e" vertical={false} />
            <XAxis
              dataKey="t"
              tickFormatter={fmtTime}
              tick={{ fill: '#8a8fa3', fontSize: 10 }}
              minTickGap={40}
              stroke="#2a2d3e"
            />
            <YAxis
              tick={{ fill: '#8a8fa3', fontSize: 10 }}
              domain={panel.max ? [0, panel.max] : ['auto', 'auto']}
              stroke="#2a2d3e"
              width={38}
            />
            <Tooltip
              contentStyle={{
                background: '#1c1f2e',
                border: '1px solid #2a2d3e',
                borderRadius: 8,
                color: '#e8e9f0',
                fontSize: 12,
              }}
              labelFormatter={(t) => new Date(t).toLocaleTimeString()}
              formatter={(v) => [
                `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}${panel.unit}`,
                panel.label,
              ]}
            />
            <Area
              type="monotone"
              dataKey="v"
              stroke={panel.color}
              strokeWidth={2}
              fill={`url(#g-${panel.key})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function MetricsModal({ targetGroup, lbArn, onClose }) {
  const [range, setRange] = useState('1h');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.targetGroupMetrics(targetGroup.arn, range, lbArn);
      setData(res);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [targetGroup.arn, range, lbArn]);

  useEffect(() => {
    load();
  }, [load]);

  // live refresh every 15s
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
              {data && (
                <span className={`source-badge ${data.source}`}>
                  {data.source === 'prometheus' ? 'live · prometheus' : data.source}
                </span>
              )}
            </div>
          </div>
          <div className="modal-actions">
            <div className="range-switch">
              {RANGES.map((r) => (
                <button
                  key={r}
                  className={r === range ? 'active' : ''}
                  onClick={() => setRange(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        {error && <div className="modal-error">⚠ {error}</div>}
        {data?.error && (
          <div className="modal-warn">
            Prometheus unavailable ({data.error}) — showing sample data.
          </div>
        )}

        <div className="metric-grid" style={{ opacity: loading && !data ? 0.4 : 1 }}>
          {PANELS.map((p) => (
            <Panel
              key={p.key}
              panel={p}
              series={data?.series?.[p.key]}
              badge={
                p.key === 'requests' && data?.requestsSource
                  ? data.requestsSource === 'cloudwatch'
                    ? 'cloudwatch'
                    : data.requestsSource === 'cloudwatch-fallback'
                    ? 'cw-fallback'
                    : null
                  : null
              }
            />
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
