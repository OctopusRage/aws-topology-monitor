import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { DP_TYPES } from './datapointNode.jsx';

// EC2 is added via "Add instances", not here.
const ADDABLE = ['rds', 'opensearch', 'elasticache', 'clickhouse', 'custom'];
const AWS_LABEL = {
  rds: 'RDS instance',
  opensearch: 'OpenSearch domain',
  elasticache: 'ElastiCache cluster',
};

export default function AddDataPointModal({ onAdd, onClose }) {
  const [type, setType] = useState('rds');
  const [sources, setSources] = useState({ rds: [], opensearch: [], elasticache: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // selections
  const [selected, setSelected] = useState(''); // rds id / opensearch domain
  const [label, setLabel] = useState('');
  const [instance, setInstance] = useState(''); // clickhouse/custom prometheus instance

  useEffect(() => {
    setLoading(true);
    api
      .listDatasources()
      .then(setSources)
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, []);

  const isAws = type === 'rds' || type === 'opensearch' || type === 'elasticache';
  const options = sources[type] || [];

  const add = (e) => {
    e.preventDefault();
    let dp;
    if (type === 'rds') {
      if (!selected) return setError('pick an RDS instance');
      dp = {
        type: 'rds',
        source: 'cloudwatch',
        label: label || selected,
        config: { dbInstanceId: selected },
      };
    } else if (type === 'opensearch') {
      if (!selected) return setError('pick an OpenSearch domain');
      dp = {
        type: 'opensearch',
        source: 'cloudwatch',
        label: label || selected,
        config: { domainName: selected },
      };
    } else if (type === 'elasticache') {
      if (!selected) return setError('pick an ElastiCache cluster');
      dp = {
        type: 'elasticache',
        source: 'cloudwatch',
        label: label || selected,
        config: { cacheClusterId: selected },
      };
    } else {
      if (!instance) return setError('enter the node_exporter instance (host:port)');
      dp = {
        type,
        source: 'prometheus',
        label: label || instance,
        config: { instance },
      };
    }
    dp.id = crypto.randomUUID();
    onAdd(dp);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal dp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="node-kicker">CANVAS</div>
            <h2>Add data point</h2>
            <div className="modal-sub">A standalone resource with its own metrics</div>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <form className="dp-form" onSubmit={add}>
          <div className="dp-type-grid dp-type-grid-5">
            {ADDABLE.map((k) => {
              const m = DP_TYPES[k];
              return (
                <button
                  type="button"
                  key={k}
                  className={`dp-type ${type === k ? 'active' : ''}`}
                  onClick={() => {
                    setType(k);
                    setSelected('');
                    setError(null);
                  }}
                  style={type === k ? { borderColor: m.accent } : undefined}
                >
                  <span className="dp-type-icon">{m.icon}</span>
                  {m.label}
                </button>
              );
            })}
          </div>

          {isAws ? (
            <label className="login-field">
              <span>
                {AWS_LABEL[type]}
                {loading ? ' · discovering…' : ` · ${options.length} found`}
              </span>
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">— select —</option>
                {options.map((o) => {
                  const val = type === 'opensearch' ? o.domain : o.id;
                  const extra =
                    type === 'rds'
                      ? `${o.engine}, ${o.class}`
                      : type === 'elasticache'
                      ? `${o.engine}, ${o.nodeType}`
                      : o.engine;
                  return (
                    <option key={val} value={val}>
                      {val}
                      {extra ? ` (${extra})` : ''}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : (
            <label className="login-field">
              <span>node_exporter instance (host:port)</span>
              <input
                placeholder="10.30.1.50:9100"
                value={instance}
                onChange={(e) => setInstance(e.target.value)}
              />
            </label>
          )}

          <label className="login-field">
            <span>Label (optional)</span>
            <input
              placeholder="shown on the canvas"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>

          {error && <div className="login-error">⚠ {error}</div>}

          <button className="login-btn">Add to canvas</button>
        </form>
      </div>
    </div>
  );
}
