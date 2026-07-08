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
import Login from './components/Login.jsx';
import UsersModal from './components/UsersModal.jsx';
import AccountModal from './components/AccountModal.jsx';
import { datapointNodeTypes } from './components/datapointNode.jsx';
import { instanceNodeTypes } from './components/instanceNodes.jsx';
import { standaloneTgNodeTypes } from './components/standaloneTgNode.jsx';
import { annotationNodeTypes } from './components/annotationNodes.jsx';
import AddDataPointModal from './components/AddDataPointModal.jsx';
import AddInstancesModal from './components/AddInstancesModal.jsx';
import AddTargetGroupModal from './components/AddTargetGroupModal.jsx';
import DatapointMetricsModal from './components/DatapointMetricsModal.jsx';
import { useAuth } from './auth.jsx';

const TG_TYPES = ['targetGroup', 'tgN', 'tgRadial'];
const SRV_TYPES = ['server', 'serverN'];
const ELB_TYPES = ['elb', 'elbN', 'elbRadial'];

// Serialize the user-editable overlay (everything a saved view stores) so we can
// detect unsaved work by comparing against the last saved/loaded snapshot.
const overlaySignature = (o = {}) =>
  JSON.stringify({
    datapoints: o.datapoints || [],
    dpGroupPos: o.dpGroupPos || null,
    connections: o.connections || [],
    instanceGroups: o.instanceGroups || [],
    standaloneTGs: o.standaloneTGs || [],
    annotations: o.annotations || [],
  });
const EMPTY_OVERLAY_SIG = overlaySignature();

// stable merged map so React Flow doesn't warn / rebuild
const nodeTypes = {
  ...gridNodeTypes,
  ...neuralNodeTypes,
  ...radialNodeTypes,
  ...datapointNodeTypes,
  ...instanceNodeTypes,
  ...standaloneTgNodeTypes,
  ...annotationNodeTypes,
};

function Dashboard() {
  const { user, logout, patchUser } = useAuth();
  const [showUsers, setShowUsers] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [hoveredTg, setHoveredTg] = useState(null);
  const hoverClear = useRef(null);
  const [elbs, setElbs] = useState([]);
  const [selected, setSelected] = useState('');
  const [topology, setTopology] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTg, setActiveTg] = useState(null);
  const [viewMode, setViewMode] = useState('neural'); // 'neural' | 'radial' | 'grid'
  const [modeUnlocked, setModeUnlocked] = useState(false); // override a saved view's layout lock

  // data points + saved views
  const [datapoints, setDatapoints] = useState([]);
  const [dpGroupPos, setDpGroupPos] = useState(null); // data-point group top-left
  const [connections, setConnections] = useState([]);
  const [instanceGroups, setInstanceGroups] = useState([]);
  const [showAddInstances, setShowAddInstances] = useState(false);
  const [standaloneTGs, setStandaloneTGs] = useState([]); // [{tgArn,name,position}]
  const [standaloneTgData, setStandaloneTgData] = useState({}); // tgArn -> live tg
  // Canvas annotations to organize a big view: grouping frames + text labels.
  const [annotations, setAnnotations] = useState([]);
  const [showAddTG, setShowAddTG] = useState(false);
  const [views, setViews] = useState([]);
  const [currentView, setCurrentView] = useState(null); // {id,name,createdBy}
  const [showAddDp, setShowAddDp] = useState(false);
  const [activeDp, setActiveDp] = useState(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const rf = useRef(null);

  // Signature of the overlay as last saved/loaded — anything different is
  // unsaved work. Initialized to the empty overlay (a fresh base view is clean).
  const savedOverlayRef = useRef(EMPTY_OVERLAY_SIG);
  const currentOverlaySig = () =>
    overlaySignature({ datapoints, dpGroupPos, connections, instanceGroups, standaloneTGs, annotations });
  // Switching a saved view's layout (once unlocked) is also unsaved work.
  const modeChanged = () => !!currentView?.viewMode && currentView.viewMode !== viewMode;
  const hasUnsavedWork = () => currentOverlaySig() !== savedOverlayRef.current || modeChanged();

  const openMetrics = useCallback(
    (tg, lbArn = null, defaultSource = 'cloudwatch') =>
      setActiveTg({ tg, lbArn, defaultSource }),
    []
  );

  const addStandaloneTGs = useCallback((items) => {
    setStandaloneTGs((prev) => {
      const seen = new Set(prev.map((s) => s.tgArn));
      return [...prev, ...items.filter((i) => !seen.has(i.tgArn)).map((i) => ({ ...i, position: null }))];
    });
    setShowAddTG(false);
  }, []);

  const removeStandaloneTG = useCallback((tgArn) => {
    setStandaloneTGs((prev) => prev.filter((s) => s.tgArn !== tgArn));
  }, []);

  // ── Canvas annotations (grouping frames + text labels) ──
  const addAnnotation = useCallback((kind) => {
    const base =
      kind === 'box'
        ? { kind: 'box', width: 320, height: 200, dashed: true, text: '' }
        : { kind: 'label', width: 160, height: 44, text: 'Label' };

    // Spawn at the center of what's currently on screen, converted to canvas
    // coordinates (accounts for pan/zoom). Fall back to the origin if unavailable.
    let center = { x: 0, y: 0 };
    const inst = rf.current;
    const paneEl = document.querySelector('.react-flow');
    if (inst && paneEl) {
      const r = paneEl.getBoundingClientRect();
      const screenMid = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      if (inst.screenToFlowPosition) center = inst.screenToFlowPosition(screenMid);
      else if (inst.project) center = inst.project({ x: r.width / 2, y: r.height / 2 });
    }

    setAnnotations((prev) => {
      // Slight stagger so repeated adds don't land exactly on top of each other.
      const off = (prev.length % 6) * 18;
      const position = {
        x: center.x - base.width / 2 + off,
        y: center.y - base.height / 2 + off,
      };
      return [...prev, { id: crypto.randomUUID(), position, ...base }];
    });
  }, []);

  const updateAnnotation = useCallback((id, patch) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const removeAnnotation = useCallback((id) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const removeDatapoint = useCallback((id) => {
    setDatapoints((dps) => dps.filter((d) => d.id !== id));
    setConnections((cs) =>
      cs.filter((c) => c.source !== `dp:${id}` && c.target !== `dp:${id}`)
    );
  }, []);

  const addDatapoint = useCallback((dp) => {
    setDatapoints((prev) => [
      ...prev,
      { ...dp, position: dp.position || { x: -440, y: -240 + prev.length * 110 } },
    ]);
    setShowAddDp(false);
  }, []);

  // ── instance groups (standalone EC2, not connected to a target group) ──
  const addInstances = useCallback(({ groupId, groupName, instances }) => {
    setInstanceGroups((prev) => {
      if (groupId) {
        return prev.map((g) =>
          g.id === groupId
            ? {
                ...g,
                instances: [
                  ...g.instances,
                  ...instances.filter((i) => !g.instances.some((x) => x.id === i.id)),
                ],
              }
            : g
        );
      }
      return [
        ...prev,
        { id: crypto.randomUUID(), name: groupName, instances, position: null },
      ];
    });
    setShowAddInstances(false);
  }, []);

  const removeInstanceGroup = useCallback((id) => {
    setInstanceGroups((prev) => prev.filter((g) => g.id !== id));
  }, []);

  // Persist a dragged position (data points pin; instance groups move as a unit).
  const onNodeDragStop = useCallback((_, node) => {
    if (node.id === 'dp-group') {
      // Move the whole data-point group as a unit (children follow automatically).
      setDpGroupPos(node.position);
    } else if (String(node.id).startsWith('dp:')) {
      const id = node.id.slice(3);
      // A child dragged out pins in place — use absolute coords since its
      // position is relative to the (parented) group while it's inside.
      const pos = node.positionAbsolute || node.position;
      setDatapoints((dps) =>
        dps.map((d) =>
          d.id === id ? { ...d, position: pos, pinned: true } : d
        )
      );
    } else if (String(node.id).startsWith('ig:')) {
      const id = node.id.slice(3);
      setInstanceGroups((gs) =>
        gs.map((g) => (g.id === id ? { ...g, position: node.position } : g))
      );
    } else if (String(node.id).startsWith('stg:')) {
      const arn = node.id.slice(4);
      setStandaloneTGs((gs) =>
        gs.map((g) => (g.tgArn === arn ? { ...g, position: node.position } : g))
      );
    } else if (String(node.id).startsWith('anno:')) {
      const id = node.id.slice(5);
      setAnnotations((as) =>
        as.map((a) => (a.id === id ? { ...a, position: node.position } : a))
      );
    }
  }, []);

  // Optional manual connection — at least one end must be a user-added node
  // (data point / instance / instance group), so base topology edges are left alone.
  const onConnect = useCallback((params) => {
    if (!params.source || !params.target || params.source === params.target) return;
    const addable = (id) =>
      id.startsWith('dp:') || id.startsWith('ig:') || id.startsWith('stg:');
    if (!addable(params.source) && !addable(params.target)) return;
    setConnections((cs) =>
      cs.some((c) => c.source === params.source && c.target === params.target)
        ? cs
        : [...cs, { source: params.source, target: params.target }]
    );
  }, []);

  // Delete a manual connection (select the edge + press Backspace/Delete).
  const onEdgesDelete = useCallback((deleted) => {
    const keys = new Set(deleted.map((e) => `${e.source}->${e.target}`));
    setConnections((cs) => cs.filter((c) => !keys.has(`${c.source}->${c.target}`)));
  }, []);

  // ── saved views ──
  const loadViewsList = useCallback(
    () => api.listViews().then(setViews).catch(() => {}),
    []
  );

  const loadView = useCallback(async (id) => {
    if (!id) {
      setCurrentView(null);
      setDatapoints([]);
      setDpGroupPos(null);
      setConnections([]);
      setInstanceGroups([]);
      setStandaloneTGs([]);
      setAnnotations([]);
      savedOverlayRef.current = EMPTY_OVERLAY_SIG;
      setModeUnlocked(false);
      return;
    }
    try {
      const v = await api.getView(Number(id));
      setSelected(v.baseLbArn);
      if (v.data?.viewMode) setViewMode(v.data.viewMode);
      setDatapoints(v.data?.datapoints || []);
      setDpGroupPos(v.data?.datapointGroupPos || null);
      setConnections(v.data?.connections || []);
      setInstanceGroups(v.data?.instanceGroups || []);
      setStandaloneTGs(v.data?.standaloneTargetGroups || []);
      setAnnotations(v.data?.annotations || []);
      setCurrentView({ id: v.id, name: v.name, createdBy: v.createdBy, viewMode: v.data?.viewMode || null });
      setModeUnlocked(false); // each opened view starts locked to its layout
      // Baseline = what we just loaded, so it isn't flagged as unsaved work.
      savedOverlayRef.current = overlaySignature({
        datapoints: v.data?.datapoints,
        dpGroupPos: v.data?.datapointGroupPos,
        connections: v.data?.connections,
        instanceGroups: v.data?.instanceGroups,
        standaloneTGs: v.data?.standaloneTargetGroups,
        annotations: v.data?.annotations,
      });
    } catch (e) {
      setError(String(e.message || e));
    }
  }, []);

  // Switch the base ELB, discarding the current overlay (its additions belong to
  // the view we're leaving, not the new one).
  const switchBaseView = useCallback((arn) => {
    setSelected(arn);
    setCurrentView(null);
    setDatapoints([]);
    setDpGroupPos(null);
    setConnections([]);
    setInstanceGroups([]);
    setStandaloneTGs([]);
    setAnnotations([]);
    savedOverlayRef.current = EMPTY_OVERLAY_SIG;
    setModeUnlocked(false);
  }, []);

  const saveView = useCallback(async () => {
    try {
      const data = {
        viewMode,
        datapoints,
        datapointGroupPos: dpGroupPos,
        connections,
        instanceGroups,
        standaloneTargetGroups: standaloneTGs.map(({ tgArn, name, position }) => ({
          tgArn,
          name,
          position,
        })),
        annotations,
      };
      if (currentView?.id) {
        await api.updateView(currentView.id, {
          name: currentView.name,
          baseLbArn: selected,
          data,
        });
        setCurrentView((cv) => (cv ? { ...cv, viewMode } : cv));
      } else {
        const name = window.prompt('Save this view as:', 'My view');
        if (!name) return;
        const created = await api.createView({ name, baseLbArn: selected, data });
        setCurrentView({ id: created.id, name: created.name, createdBy: created.createdBy, viewMode });
      }
      // Everything is now persisted — this becomes the clean baseline; the saved
      // mode is the current one, so re-lock the layout.
      savedOverlayRef.current = currentOverlaySig();
      setModeUnlocked(false);
      await loadViewsList();
    } catch (e) {
      setError(String(e.message || e));
    }
  }, [currentView, selected, viewMode, datapoints, dpGroupPos, connections, instanceGroups, standaloneTGs, annotations, loadViewsList]);

  // Which view is "active" right now — a saved view, or just the base ELB.
  const activeRef = currentView?.id
    ? { type: 'saved', ref: currentView.id }
    : { type: 'base', ref: selected };
  const isDefault =
    !!user?.defaultView &&
    user.defaultView.type === activeRef.type &&
    user.defaultView.ref === activeRef.ref;

  const toggleDefault = useCallback(async () => {
    const next = isDefault ? null : activeRef;
    try {
      await api.setDefaultView(next);
      patchUser({ defaultView: next });
    } catch (e) {
      setError(String(e.message || e));
    }
  }, [isDefault, activeRef, patchUser]);

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
  }, []);

  // Warn on tab close / reload while there's unsaved overlay work. No deps: it
  // must re-bind each render to close over the latest state for hasUnsavedWork().
  useEffect(() => {
    const handler = (e) => {
      if (hasUnsavedWork()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  });

  // On mount: load ELBs + saved views, then open the user's startup view.
  const initedRef = useRef(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [list, vs] = await Promise.all([
        api.listElbs().catch(() => []),
        api.listViews().catch(() => []),
      ]);
      if (!alive) return;
      setElbs(list);
      setViews(vs);
      if (initedRef.current) return;
      initedRef.current = true;

      const dv = user?.defaultView;
      if (dv?.type === 'saved' && vs.some((v) => v.id === dv.ref)) {
        loadView(dv.ref);
      } else if (dv?.type === 'base' && list.some((e) => e.arn === dv.ref)) {
        setSelected(dv.ref);
      } else if (list.length) {
        setSelected(list[0].arn);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user, loadView]);

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

  // Silently re-fetch topology every 30s so ASG scaling (instances joining/
  // leaving target groups) reflects on the canvas without a reload.
  useEffect(() => {
    if (!selected) return;
    const id = setInterval(() => {
      api.topology(selected).then(setTopology).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [selected]);

  // Standalone target groups: fetch live instances (+ poll so ASG reflects).
  const refreshStandaloneTGs = useCallback(async () => {
    const arns = standaloneTGs.map((s) => s.tgArn);
    if (!arns.length) return;
    const results = await Promise.all(
      arns.map((a) => api.getTargetGroup(a).then((d) => [a, d]).catch(() => [a, null]))
    );
    setStandaloneTgData((prev) => {
      const next = {};
      for (const [a, d] of results) next[a] = d || prev[a] || null;
      return next;
    });
  }, [standaloneTGs]);

  useEffect(() => {
    refreshStandaloneTGs();
  }, [refreshStandaloneTGs]);
  useEffect(() => {
    if (!standaloneTGs.length) return;
    const id = setInterval(refreshStandaloneTGs, 30000);
    return () => clearInterval(id);
  }, [refreshStandaloneTGs, standaloneTGs.length]);

  const graph = useMemo(() => {
    let base;
    if (viewMode === 'neural') base = buildNeuralGraph(topology, openMetrics);
    else if (viewMode === 'radial') base = buildRadialGraph(topology, openMetrics);
    else base = buildGraph(topology, openMetrics);

    // Data points auto-arrange into a labeled group; ones the user drags out
    // become "pinned" and keep their own position outside the group.
    const DP_COLS = 2, CW = 206, CH = 74, PAD = 16, HEAD = 28;
    const groupPos = dpGroupPos || { x: -486, y: -278 };
    const autoCount = datapoints.filter((d) => !d.pinned).length;
    const dpNodes = [];
    if (autoCount > 0) {
      const cols = Math.min(DP_COLS, autoCount);
      const rows = Math.ceil(autoCount / DP_COLS);
      dpNodes.push({
        id: 'dp-group',
        type: 'dpGroup',
        position: groupPos,
        style: {
          width: cols * 190 + (cols - 1) * 16 + PAD * 2,
          height: rows * 58 + (rows - 1) * 16 + HEAD + PAD,
        },
        className: 'dp-group-node',
        draggable: true,
        selectable: true,
        data: {},
      });
    }
    let ai = 0;
    for (const dp of datapoints) {
      const node = {
        id: `dp:${dp.id}`,
        type: 'datapoint',
        data: { dp, onOpen: () => setActiveDp(dp), onRemove: () => removeDatapoint(dp.id) },
        draggable: true,
      };
      if (dp.pinned && dp.position) {
        // Standalone (dragged out of the group) — absolute canvas position.
        node.position = dp.position;
      } else {
        // Auto-arranged — a child of the group so it moves with it, but with no
        // `extent` so the user can still drag it out to pin it.
        node.parentId = 'dp-group';
        node.position = {
          x: PAD + (ai % DP_COLS) * CW,
          y: HEAD + Math.floor(ai / DP_COLS) * CH,
        };
        ai++;
      }
      dpNodes.push(node);
    }
    const connEdges = connections.map((c, i) => ({
      id: `conn:${i}:${c.source}->${c.target}`,
      source: c.source,
      target: c.target,
      type: 'default',
      className: 'dp-conn',
      deletable: true,
      markerEnd: { type: 'arrowclosed', color: '#8a8fa3', width: 16, height: 16 },
      style: { stroke: '#8a8fa3', strokeWidth: 1.6, strokeDasharray: '5 5', opacity: 0.7 },
    }));

    // Standalone instance groups (EC2 workers, not connected to any target group).
    const IW = 158, IH = 62, IGAP = 14, IPADX = 16, IHEAD = 58, IPADB = 16, ICOLS = 2;
    const igNodes = [];
    let igY = 40;
    for (const g of instanceGroups) {
      const n = g.instances.length;
      const cols = Math.min(ICOLS, Math.max(1, n));
      const rows = Math.ceil(n / cols) || 1;
      const width = IPADX * 2 + cols * IW + (cols - 1) * IGAP;
      const height = IHEAD + rows * IH + (rows - 1) * IGAP + IPADB;
      const pos = g.position || { x: -470, y: igY };
      igY += height + 40;

      igNodes.push({
        id: `ig:${g.id}`,
        type: 'instanceGroup',
        position: pos,
        style: { width, height },
        data: { name: g.name, count: n, onRemove: () => removeInstanceGroup(g.id) },
        draggable: true,
      });
      g.instances.forEach((inst, i) => {
        igNodes.push({
          id: `ig:${g.id}::${inst.id}::${i}`,
          type: 'instanceNode',
          parentId: `ig:${g.id}`,
          extent: 'parent',
          draggable: false,
          position: {
            x: IPADX + (i % ICOLS) * (IW + IGAP),
            y: IHEAD + Math.floor(i / ICOLS) * (IH + IGAP),
          },
          data: {
            inst,
            onOpen: () =>
              setActiveDp({
                type: 'ec2',
                label: inst.name,
                source: 'cloudwatch',
                config: { instanceId: inst.id, privateIp: inst.privateIp },
              }),
          },
        });
      });
    }

    // Standalone target groups (ASG worker pools) — live instances, not wired
    // to the ELB. Reuse the grid 'server' node for children. Continue the same
    // left-column cursor (igY) so groups stack without overlapping.
    const stgNodes = [];
    for (const s of standaloneTGs) {
      const tg = standaloneTgData[s.tgArn];
      if (!tg) continue;
      const targets = tg.targets || [];
      const n = targets.length;
      const cols = Math.min(ICOLS, Math.max(1, n));
      const rows = Math.ceil(n / cols) || 1;
      const width = Math.max(IPADX * 2 + cols * IW + (cols - 1) * IGAP, 260);
      const height = IHEAD + (n ? rows * IH + (rows - 1) * IGAP : 20) + IPADB;
      const pos = s.position || { x: -490, y: igY };
      igY += height + 40;
      const healthy = targets.filter((t) => t.health === 'healthy').length;

      stgNodes.push({
        id: `stg:${s.tgArn}`,
        type: 'standaloneTg',
        position: pos,
        style: { width, height },
        data: {
          tg,
          healthy,
          total: n,
          onOpen: () => openMetrics(tg, tg.lbArn, tg.lbArn ? 'cloudwatch' : 'prometheus'),
          onRemove: () => removeStandaloneTG(s.tgArn),
        },
        draggable: true,
      });
      targets.forEach((srv, i) => {
        stgNodes.push({
          id: `stg:${s.tgArn}::${srv.id}::${i}`,
          type: 'server',
          parentId: `stg:${s.tgArn}`,
          extent: 'parent',
          draggable: false,
          selectable: false,
          position: {
            x: IPADX + (i % ICOLS) * (IW + IGAP),
            y: IHEAD + Math.floor(i / ICOLS) * (IH + IGAP),
          },
          data: { srv },
        });
      });
    }

    // Annotation frames (behind everything) and text labels (on top).
    const annoBoxes = [];
    const annoLabels = [];
    for (const a of annotations) {
      if (a.kind === 'box') {
        annoBoxes.push({
          id: `anno:${a.id}`,
          type: 'annoBox',
          position: a.position,
          style: { width: a.width || 320, height: a.height || 200 },
          className: 'anno-box-node',
          zIndex: 0,
          data: {
            text: a.text || '',
            dashed: a.dashed !== false,
            onRename: (text) => updateAnnotation(a.id, { text }),
            onToggleDash: () => updateAnnotation(a.id, { dashed: !(a.dashed !== false) }),
            onResize: (dims) => updateAnnotation(a.id, dims),
            onRemove: () => removeAnnotation(a.id),
          },
        });
      } else {
        annoLabels.push({
          id: `anno:${a.id}`,
          type: 'annoLabel',
          position: a.position,
          style: { width: a.width || 160, height: a.height || 44 },
          className: 'anno-label-node',
          zIndex: 6,
          data: {
            text: a.text || '',
            height: a.height || 44,
            onRename: (text) => updateAnnotation(a.id, { text }),
            onResize: (dims) => updateAnnotation(a.id, dims),
            onRemove: () => removeAnnotation(a.id),
          },
        });
      }
    }

    return {
      // frames first so they render behind the topology; labels last, on top
      nodes: [...annoBoxes, ...base.nodes, ...dpNodes, ...igNodes, ...stgNodes, ...annoLabels],
      // base topology edges aren't user-deletable; only manual connections are
      edges: [...base.edges.map((e) => ({ ...e, deletable: false })), ...connEdges],
    };
  }, [
    topology,
    openMetrics,
    viewMode,
    annotations,
    updateAnnotation,
    removeAnnotation,
    datapoints,
    dpGroupPos,
    connections,
    removeDatapoint,
    instanceGroups,
    removeInstanceGroup,
    standaloneTGs,
    standaloneTgData,
    removeStandaloneTG,
  ]);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setNodes, setEdges]);

  // Fit the view once per selection/mode (when the graph first populates), and
  // when the user adds data points / instances — but NOT on background topology
  // refreshes, so ASG changes update the canvas without stealing the user's
  // pan/zoom.
  const fittedRef = useRef(false);
  useEffect(() => {
    fittedRef.current = false;
  }, [selected, viewMode]);

  useEffect(() => {
    if (graph.nodes.length === 0 || fittedRef.current) return;
    fittedRef.current = true;
    const id = setTimeout(
      () => rf.current && rf.current.fitView({ padding: 0.18, duration: 300 }),
      220
    );
    return () => clearTimeout(id);
  }, [graph.nodes.length, viewMode]);

  useEffect(() => {
    if (graph.nodes.length === 0) return;
    const id = setTimeout(
      () => rf.current && rf.current.fitView({ padding: 0.18, duration: 300 }),
      120
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datapoints.length, instanceGroups.length]);

  // ── Hover highlight ──
  const onNodeEnter = useCallback((_, node) => {
    clearTimeout(hoverClear.current);
    let tgId = null;
    if (TG_TYPES.includes(node.type)) tgId = node.id;
    else if (SRV_TYPES.includes(node.type))
      tgId = node.parentId || String(node.id).split('::')[0];
    if (tgId) setHoveredTg(tgId);
  }, []);

  const onNodeLeave = useCallback(() => {
    clearTimeout(hoverClear.current);
    hoverClear.current = setTimeout(() => setHoveredTg(null), 60);
  }, []);

  // Apply dim/highlight classes to nodes + edges based on the hovered group.
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        if (
          ['datapoint', 'dpGroup', 'instanceGroup', 'instanceNode', 'standaloneTg', 'annoBox', 'annoLabel'].includes(n.type) ||
          String(n.id).startsWith('stg:')
        )
          return n; // never dim data points / instances / standalone TGs / annotations
        const cls = !hoveredTg
          ? undefined
          : n.id === hoveredTg ||
            ELB_TYPES.includes(n.type) ||
            n.parentId === hoveredTg ||
            String(n.id).startsWith(hoveredTg + '::')
          ? 'hl'
          : 'dimmed';
        return n.className === cls ? n : { ...n, className: cls };
      })
    );
    setEdges((eds) =>
      eds.map((e) => {
        const base = (e.className || '').replace(/\s*(hl|dimmed)\b/g, '').trim();
        const cls = !hoveredTg
          ? base || undefined
          : `${base} ${e.source === hoveredTg || e.target === hoveredTg ? 'hl' : 'dimmed'}`.trim();
        return e.className === cls ? e : { ...e, className: cls };
      })
    );
  }, [hoveredTg, setNodes, setEdges]);

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
            {[
              { key: 'neural', label: '⌘ Neural' },
              { key: 'radial', label: '◎ Radial' },
              { key: 'grid', label: '▦ Grid' },
            ].map(({ key, label }) => {
              // A saved view locks its layout to its saved mode — unless the user
              // opens the lock (🔒) to change it and re-save.
              const layoutLocked = !!currentView?.viewMode && !modeUnlocked;
              const locked = layoutLocked && viewMode !== key;
              return (
                <button
                  key={key}
                  className={viewMode === key ? 'active' : ''}
                  disabled={locked}
                  title={locked ? `Locked to "${viewMode}" — click 🔒 to change` : undefined}
                  onClick={() => setViewMode(key)}
                >
                  {label}
                </button>
              );
            })}
            {!!currentView?.viewMode && (
              <button
                className={`view-lock ${modeUnlocked ? 'open' : ''}`}
                onClick={() => setModeUnlocked((v) => !v)}
                title={
                  modeUnlocked
                    ? 'Layout unlocked — switch mode, then Save to keep it'
                    : 'Layout locked to this saved view — click to change'
                }
              >
                {modeUnlocked ? '🔓' : '🔒'}
              </button>
            )}
          </div>

          <label className="select-wrap">
            <span>Base view · ELB</span>
            <select
              value={selected}
              onChange={(e) => {
                const next = e.target.value;
                if (next === selected) return;
                if (
                  hasUnsavedWork() &&
                  !window.confirm(
                    'There is unsaved work in this view (data points / instance groups / connections). ' +
                      'Switching the base ELB will discard it. Continue?'
                  )
                )
                  return; // controlled select snaps back to the current value
                switchBaseView(next);
              }}
            >
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

          <div className="user-menu">
            {user?.role === 'admin' && (
              <button className="users-btn" onClick={() => setShowUsers(true)}>
                ⚙ Users
              </button>
            )}
            <button
              className="user-chip"
              onClick={() => setShowAccount(true)}
              title="Account settings"
            >
              <span className="user-avatar">{user?.username?.[0]?.toUpperCase()}</span>
              <div className="user-meta">
                <span className="user-name">{user?.username}</span>
                <span className={`role-badge ${user?.role}`}>{user?.role}</span>
              </div>
            </button>
            <button className="logout-btn" onClick={logout} title="Sign out">
              ⎋
            </button>
          </div>
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
          <div className="summary-item live-badge" title="Topology auto-refreshes every 30s (reflects ASG scaling)">
            <span className="live-dot" /> live
          </div>
          {datapoints.length > 0 && (
            <div className="summary-item">
              <b>{datapoints.length}</b> data point{datapoints.length > 1 ? 's' : ''}
            </div>
          )}
          {instanceGroups.length > 0 && (
            <div className="summary-item">
              <b>{instanceGroups.reduce((n, g) => n + g.instances.length, 0)}</b> instance
              {' '}in <b>{instanceGroups.length}</b> group{instanceGroups.length > 1 ? 's' : ''}
            </div>
          )}

          <div className="views-bar">
            <div className="views-group">
              <span className="views-label">Saved view</span>
              <select
                className="views-select"
                value={currentView?.id || ''}
                onChange={(e) => {
                  if (
                    hasUnsavedWork() &&
                    !window.confirm(
                      'There is unsaved work in this view. Loading another view will discard it. Continue?'
                    )
                  )
                    return; // controlled select snaps back to the current value
                  loadView(e.target.value);
                }}
                title="Shared saved views"
              >
                <option value="">— None (base only) —</option>
                {views.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.createdByName || 'unknown'}
                  </option>
                ))}
              </select>
            </div>
            <button
              className={`view-action star ${isDefault ? 'on' : ''}`}
              onClick={toggleDefault}
              title={
                isDefault
                  ? 'This loads on login — click to unset'
                  : 'Load this view on login'
              }
            >
              {isDefault ? '★' : '☆'} Default
            </button>
            <button className="view-action" onClick={() => setShowAddDp(true)}>
              ＋ Data point
            </button>
            <button className="view-action" onClick={() => setShowAddInstances(true)}>
              ＋ Instances
            </button>
            <button className="view-action" onClick={() => setShowAddTG(true)}>
              ＋ Target group
            </button>
            <button className="view-action" onClick={() => addAnnotation('box')} title="Add a grouping frame">
              ＋ Frame
            </button>
            <button className="view-action" onClick={() => addAnnotation('label')} title="Add a text label">
              ＋ Label
            </button>
            <button className="view-action save" onClick={saveView}>
              💾 {currentView?.id ? 'Save' : 'Save as…'}
            </button>
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
          onNodeMouseEnter={onNodeEnter}
          onNodeMouseLeave={onNodeLeave}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          nodeTypes={nodeTypes}
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
          targetGroup={activeTg.tg}
          lbArn={activeTg.lbArn ?? selected}
          defaultSource={activeTg.defaultSource}
          onClose={() => setActiveTg(null)}
        />
      )}

      {showUsers && <UsersModal onClose={() => setShowUsers(false)} />}
      {showAccount && <AccountModal onClose={() => setShowAccount(false)} />}
      {showAddDp && (
        <AddDataPointModal onAdd={addDatapoint} onClose={() => setShowAddDp(false)} />
      )}
      {showAddInstances && (
        <AddInstancesModal
          groups={instanceGroups}
          onAdd={addInstances}
          onClose={() => setShowAddInstances(false)}
        />
      )}
      {showAddTG && (
        <AddTargetGroupModal
          existing={standaloneTGs}
          onAdd={addStandaloneTGs}
          onClose={() => setShowAddTG(false)}
        />
      )}
      {activeDp && (
        <DatapointMetricsModal datapoint={activeDp} onClose={() => setActiveDp(null)} />
      )}
    </div>
  );
}

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="boot">Loading…</div>;
  if (!user) return <Login />;
  return <Dashboard />;
}
