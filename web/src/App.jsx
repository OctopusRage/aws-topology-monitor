import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from './api.js';
import { buildGraph, buildNeuralGraph, buildRadialGraph } from './layout.js';
import { nodeTypes as gridNodeTypes } from './components/nodes.jsx';
import { neuralNodeTypes } from './components/neuralNodes.jsx';
import { radialNodeTypes } from './components/radialNodes.jsx';
import MetricsModal from './components/MetricsModal.jsx';

// stable merged map so React Flow doesn't warn / rebuild
const nodeTypes = { ...gridNodeTypes, ...neuralNodeTypes, ...radialNodeTypes };

export default function App() {
  const [elbs, setElbs] = useState([]);
  const [selected, setSelected] = useState('');
  const [topology, setTopology] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTg, setActiveTg] = useState(null);
  const [viewMode, setViewMode] = useState('neural'); // 'neural' | 'grid'

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const rf = useRef(null);

  const openMetrics = useCallback((tg) => setActiveTg(tg), []);

  // load ELB list + health on mount
  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
    api
      .listElbs()
      .then((list) => {
        setElbs(list);
        if (list.length) setSelected(list[0].arn);
      })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  // load topology when selection changes
  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    api
      .topology(selected)
      .then(setTopology)
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, [selected]);

  const graph = useMemo(() => {
    if (viewMode === 'neural') return buildNeuralGraph(topology, openMetrics);
    if (viewMode === 'radial') return buildRadialGraph(topology, openMetrics);
    return buildGraph(topology, openMetrics);
  }, [topology, openMetrics, viewMode]);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setNodes, setEdges]);

  // Re-center after the fresh canvas has mounted + measured the new nodes.
  useEffect(() => {
    if (graph.nodes.length === 0) return;
    const id = setTimeout(
      () => rf.current && rf.current.fitView({ padding: 0.18, duration: 300 }),
      220
    );
    return () => clearTimeout(id);
  }, [viewMode, selected, graph.nodes.length]);

  const selectedElb = elbs.find((e) => e.arn === selected);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <div>
            <div className="brand-title">AWS Topology Monitor</div>
            <div className="brand-sub">ELB → Target Groups → Servers</div>
          </div>
        </div>

        <div className="controls">
          <div className="view-switch">
            <button
              className={viewMode === 'neural' ? 'active' : ''}
              onClick={() => setViewMode('neural')}
            >
              ⌘ Neural
            </button>
            <button
              className={viewMode === 'radial' ? 'active' : ''}
              onClick={() => setViewMode('radial')}
            >
              ◎ Radial
            </button>
            <button
              className={viewMode === 'grid' ? 'active' : ''}
              onClick={() => setViewMode('grid')}
            >
              ▦ Grid
            </button>
          </div>

          <label className="select-wrap">
            <span>Load Balancer</span>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {elbs.length === 0 && <option value="">No ELBs found</option>}
              {elbs.map((e) => (
                <option key={e.arn} value={e.arn}>
                  {e.name} ({e.scheme})
                </option>
              ))}
            </select>
          </label>

          {health && (
            <div className="env-badges">
              <span className={`env-badge ${health.source}`}>
                data: {health.source}
              </span>
              <span className="env-badge metrics">
                metrics: {health.metrics === 'mock' ? 'mock' : 'prometheus'}
              </span>
            </div>
          )}
        </div>
      </header>

      {selectedElb && topology && (
        <div className="summary-strip">
          <div className="summary-item">
            <b>{topology.targetGroups.length}</b> target groups
          </div>
          <div className="summary-item">
            <b>
              {topology.targetGroups.reduce((n, t) => n + t.targets.length, 0)}
            </b>{' '}
            servers
          </div>
          <div className="summary-item dns">{selectedElb.dnsName}</div>
          <div className="summary-hint">
            Click a target group {viewMode === 'grid' ? 'header' : 'node'} to view metrics →
          </div>
        </div>
      )}

      {error && <div className="banner error">⚠ {error}</div>}

      <div className="canvas">
        {loading && <div className="canvas-loading">Loading topology…</div>}
        <ReactFlow
          key={viewMode}
          onInit={(inst) => (rf.current = inst)}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.75}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#2a2d3e" gap={22} size={1.5} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) =>
              n.type === 'elb' || n.type === 'elbN'
                ? '#ff6d5a'
                : n.type === 'targetGroup' || n.type === 'tgN'
                ? '#7b6cff'
                : '#38d39f'
            }
            maskColor="rgba(12,13,20,0.7)"
            style={{ background: '#12131c' }}
          />
        </ReactFlow>
      </div>

      {activeTg && (
        <MetricsModal
          targetGroup={activeTg}
          lbArn={selected}
          onClose={() => setActiveTg(null)}
        />
      )}
    </div>
  );
}
