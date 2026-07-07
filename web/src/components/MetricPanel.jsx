import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export function fmtTime(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Renders one metric panel from a generic { key,label,unit,color,max?,series } spec.
export default function MetricPanel({ panel, badge }) {
  const series = panel.series || [];
  const val = series.length ? series[series.length - 1].v : null;
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
          <AreaChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id={`mp-${panel.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={panel.color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={panel.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#2a2d3e" vertical={false} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tick={{ fill: '#8a8fa3', fontSize: 10 }} minTickGap={40} stroke="#2a2d3e" />
            <YAxis tick={{ fill: '#8a8fa3', fontSize: 10 }} domain={panel.max ? [0, panel.max] : ['auto', 'auto']} stroke="#2a2d3e" width={40} />
            <Tooltip
              contentStyle={{ background: '#1c1f2e', border: '1px solid #2a2d3e', borderRadius: 8, color: '#e8e9f0', fontSize: 12 }}
              labelFormatter={(t) => new Date(t).toLocaleTimeString()}
              formatter={(v) => [`${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}${panel.unit}`, panel.label]}
            />
            <Area type="monotone" dataKey="v" stroke={panel.color} strokeWidth={2} fill={`url(#mp-${panel.key})`} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
