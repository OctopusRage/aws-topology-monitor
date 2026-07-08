import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ConnectionMode,
  useNodesState,
  useEdgesState,
  getRectOfNodes,
  getTransformForBounds,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { toSvg } from 'html-to-image';
import DeletableEdge from './components/DeletableEdge.jsx';
import { api } from './api.js';
import { buildGraph, buildNeuralGraph, buildRadialGraph } from './layout.js';
import { nodeTypes as gridNodeTypes } from './components/nodes.jsx';
import { neuralNodeTypes } from './components/neuralNodes.jsx';
import { radialNodeTypes } from './components/radialNodes.jsx';
import MetricsModal from './components/MetricsModal.jsx';
import AlbRulesModal from './components/AlbRulesModal.jsx';
import NodeButtonsModal from './components/NodeButtonsModal.jsx';
import InstanceGroupModal from './components/InstanceGroupModal.jsx';
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
    dataGroups: o.dataGroups || [],
    connections: o.connections || [],
    instanceGroups: o.instanceGroups || [],
    standaloneTGs: o.standaloneTGs || [],
    annotations: o.annotations || [],
    nodePositions: o.nodePositions || {},
    customButtons: o.customButtons || {},
  });
const EMPTY_OVERLAY_SIG = overlaySignature();

// Does a React Flow node's box contain the point (cx, cy) in canvas coords?
const rectHas = (n, cx, cy) => {
  const p = n.positionAbsolute || n.position || { x: 0, y: 0 };
  const w = n.width || 0;
  const h = n.height || 0;
  return cx >= p.x && cx <= p.x + w && cy >= p.y && cy <= p.y + h;
};

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

const edgeTypes = { deletable: DeletableEdge };

function Dashboard() {
  const { user, logout, patchUser } = useAuth();
  const isAdmin = user?.role === 'admin'; // only admins author/save views
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
  const [activeElb, setActiveElb] = useState(null); // { lbArn, name } for the rules modal
  const [activeIg, setActiveIg] = useState(null); // instance-group id for its detail modal
  const [viewMode, setViewMode] = useState('neural'); // 'neural' | 'radial' | 'grid'
  const [modeUnlocked, setModeUnlocked] = useState(false); // override a saved view's layout lock

  // data points + saved views
  const [datapoints, setDatapoints] = useState([]);
  const [dataGroups, setDataGroups] = useState([]); // [{id, name, position}] — data-point groups
  const [connections, setConnections] = useState([]);
  const [instanceGroups, setInstanceGroups] = useState([]);
  const [showAddInstances, setShowAddInstances] = useState(false);
  const [standaloneTGs, setStandaloneTGs] = useState([]); // [{tgArn,name,position}]
  const [standaloneTgData, setStandaloneTgData] = useState({}); // tgArn -> live tg
  // Canvas annotations to organize a big view: grouping frames + text labels.
  const [annotations, setAnnotations] = useState([]);
  // User-moved positions for base topology nodes (ELB/TG/servers), keyed by id,
  // so a dragged target group stays put across topology auto-refreshes.
  const [nodePositions, setNodePositions] = useState({});
  // Admin-defined custom link buttons per node, keyed by a stable btnKey.
  const [customButtons, setCustomButtons] = useState({});
  const [buttonEditor, setButtonEditor] = useState(null); // { key, title }
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
    overlaySignature({ datapoints, dataGroups, connections, instanceGroups, standaloneTGs, annotations, nodePositions, customButtons });
  // Switching a saved view's layout (once unlocked) is also unsaved work.
  const modeChanged = () => !!currentView?.viewMode && currentView.viewMode !== viewMode;
  // Only admins can save, so only they get the "unsaved work" guards; a regular
  // user's dragging is always throwaway and shouldn't warn them.
  const hasUnsavedWork = () =>
    isAdmin && (currentOverlaySig() !== savedOverlayRef.current || modeChanged());

  const openMetrics = useCallback(
    (tg, lbArn = null, defaultSource = 'cloudwatch') =>
      setActiveTg({ tg, lbArn, defaultSource }),
    []
  );

  // Center of what's currently on screen, in canvas coords (accounts for
  // pan/zoom). New nodes spawn here so they land in view, not off in a corner.
  const viewportCenter = useCallback(() => {
    const inst = rf.current;
    const paneEl = document.querySelector('.react-flow');
    if (inst && paneEl) {
      const r = paneEl.getBoundingClientRect();
      const screenMid = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      if (inst.screenToFlowPosition) return inst.screenToFlowPosition(screenMid);
      if (inst.project) return inst.project({ x: r.width / 2, y: r.height / 2 });
    }
    return { x: 0, y: 0 };
  }, []);

  const addStandaloneTGs = useCallback((items) => {
    const c = viewportCenter();
    setStandaloneTGs((prev) => {
      const seen = new Set(prev.map((s) => s.tgArn));
      const fresh = items.filter((i) => !seen.has(i.tgArn));
      return [
        ...prev,
        ...fresh.map((i, k) => ({
          ...i,
          position: { x: c.x - 180 + k * 32, y: c.y - 110 + k * 32 },
        })),
      ];
    });
    setShowAddTG(false);
  }, [viewportCenter]);

  const removeStandaloneTG = useCallback((tgArn) => {
    setStandaloneTGs((prev) => prev.filter((s) => s.tgArn !== tgArn));
  }, []);

  // Custom link buttons: open the editor for a node, and save its buttons.
  const openButtonEditor = useCallback((key, title) => setButtonEditor({ key, title }), []);
  // Props for rendering a node's custom links inside its monitoring modal.
  const buttonProps = useCallback(
    (key, title) => ({
      buttons: customButtons[key] || [],
      onEditButtons: isAdmin ? () => openButtonEditor(key, title) : undefined,
    }),
    [customButtons, isAdmin, openButtonEditor]
  );
  const saveButtons = useCallback((key, list) => {
    setCustomButtons((prev) => {
      const next = { ...prev };
      if (list && list.length) next[key] = list;
      else delete next[key];
      return next;
    });
    setButtonEditor(null);
  }, []);

  // ── Canvas annotations (grouping frames + text labels) ──
  const addAnnotation = useCallback((kind) => {
    const base =
      kind === 'box'
        ? { kind: 'box', width: 320, height: 200, dashed: true, text: '' }
        : { kind: 'label', width: 160, height: 44, text: 'Label' };

    const center = viewportCenter();

    setAnnotations((prev) => {
      // Slight stagger so repeated adds don't land exactly on top of each other.
      const off = (prev.length % 6) * 18;
      const position = {
        x: center.x - base.width / 2 + off,
        y: center.y - base.height / 2 + off,
      };
      return [...prev, { id: crypto.randomUUID(), position, ...base }];
    });
  }, [viewportCenter]);

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

  // Delete a data group: removes its grouped (non-pinned) data points, keeping
  // any that were dragged out to stand on their own.
  const removeDataGroup = useCallback((gid) => {
    setDatapoints((dps) => {
      const removed = dps
        .filter((d) => d.groupId === gid && !d.pinned)
        .map((d) => `dp:${d.id}`);
      if (removed.length) {
        setConnections((cs) =>
          cs.filter((c) => !removed.includes(c.source) && !removed.includes(c.target))
        );
      }
      return dps.filter((d) => !(d.groupId === gid && !d.pinned));
    });
    setDataGroups((gs) => gs.filter((g) => g.id !== gid));
    setConnections((cs) => cs.filter((c) => c.source !== `dpg:${gid}` && c.target !== `dpg:${gid}`));
  }, []);

  // Add a data point to a chosen group — an existing one ({groupId}) or a new
  // group ({newGroupName}); a new group is created and the point assigned to it.
  const addDatapoint = useCallback((dp, group) => {
    let gid = group?.groupId || null;
    if (!gid) {
      gid = crypto.randomUUID();
      const name = group?.newGroupName?.trim();
      const c = viewportCenter();
      setDataGroups((gs) => [
        ...gs,
        {
          id: gid,
          name: name || `Data points ${gs.length + 1}`,
          // roughly centered on the current view (offset ≈ half a small group)
          position: { x: c.x - 110 + gs.length * 28, y: c.y - 60 + gs.length * 28 },
        },
      ]);
    }
    setDatapoints((prev) => [...prev, { ...dp, groupId: gid, pinned: false }]);
    setShowAddDp(false);
  }, [viewportCenter]);

  // Drop groups that no longer have any (non-pinned) members.
  useEffect(() => {
    setDataGroups((gs) => {
      const used = new Set(
        datapoints.filter((d) => !d.pinned && d.groupId).map((d) => d.groupId)
      );
      const next = gs.filter((g) => used.has(g.id));
      return next.length === gs.length ? gs : next;
    });
  }, [datapoints]);

  // ── instance groups (standalone EC2, not connected to a target group) ──
  const addInstances = useCallback(({ groupId, groupName, instances }) => {
    const c = viewportCenter();
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
        {
          id: crypto.randomUUID(),
          name: groupName,
          instances,
          position: { x: c.x - 180, y: c.y - 110 },
        },
      ];
    });
    setShowAddInstances(false);
  }, [viewportCenter]);

  const removeInstanceGroup = useCallback((id) => {
    setInstanceGroups((prev) => prev.filter((g) => g.id !== id));
  }, []);

  // Move an instance out of its group: into another group (targetGid), or — when
  // dropped on empty canvas (targetGid null) — into a new group of its own.
  const moveInstanceBetweenGroups = useCallback((srcGid, instId, targetGid, absPos) => {
    if (targetGid === srcGid) return; // dropped back on itself → snap into place
    setInstanceGroups((prev) => {
      const src = prev.find((g) => g.id === srcGid);
      const inst = src?.instances.find((i) => i.id === instId);
      if (!inst) return prev;
      if (targetGid && prev.find((g) => g.id === targetGid)?.instances.some((i) => i.id === instId))
        return prev; // already in the target
      let next = prev.map((g) =>
        g.id === srcGid ? { ...g, instances: g.instances.filter((i) => i.id !== instId) } : g
      );
      if (targetGid) {
        next = next.map((g) =>
          g.id === targetGid ? { ...g, instances: [...g.instances, inst] } : g
        );
      } else {
        next = [
          ...next,
          {
            id: crypto.randomUUID(),
            name: inst.name || inst.id || 'Instance',
            instances: [inst],
            position: absPos,
          },
        ];
      }
      return next.filter((g) => g.instances.length > 0); // drop emptied groups
    });
  }, []);

  // Persist a dragged position, and support dragging members between groups.
  const onNodeDragStop = useCallback(
    (_, node) => {
      const id = String(node.id);
      const abs = node.positionAbsolute || node.position;
      const cx = abs.x + (node.width || 160) / 2;
      const cy = abs.y + (node.height || 60) / 2;
      const allNodes = rf.current?.getNodes?.() || [];

      if (id.startsWith('dpg:')) {
        // Move a whole data-point group as a unit (children follow along).
        const gid = id.slice(4);
        setDataGroups((gs) => gs.map((g) => (g.id === gid ? { ...g, position: node.position } : g)));
      } else if (id.startsWith('dp:')) {
        // Dropped onto a data group → join it (un-pin); else pin standalone.
        const dpId = id.slice(3);
        const target = allNodes.find((n) => n.type === 'dpGroup' && rectHas(n, cx, cy));
        setDatapoints((dps) =>
          dps.map((d) =>
            d.id === dpId
              ? target
                ? { ...d, groupId: target.id.slice(4), pinned: false }
                : { ...d, position: abs, pinned: true }
              : d
          )
        );
      } else if (id.startsWith('ig:') && id.includes('::')) {
        // An instance was dragged: move it to whatever group it was dropped on,
        // or out to a new group of its own when dropped on empty canvas.
        const [srcGid, instId] = id.slice(3).split('::');
        const target = allNodes.find((n) => n.type === 'instanceGroup' && rectHas(n, cx, cy));
        moveInstanceBetweenGroups(srcGid, instId, target ? target.id.slice(3) : null, abs);
      } else if (id.startsWith('ig:')) {
        const gid = id.slice(3);
        setInstanceGroups((gs) =>
          gs.map((g) => (g.id === gid ? { ...g, position: node.position } : g))
        );
      } else if (id.startsWith('stg:')) {
        const arn = id.slice(4);
        setStandaloneTGs((gs) =>
          gs.map((g) => (g.tgArn === arn ? { ...g, position: node.position } : g))
        );
      } else if (id.startsWith('anno:')) {
        const aid = id.slice(5);
        setAnnotations((as) =>
          as.map((a) => (a.id === aid ? { ...a, position: node.position } : a))
        );
      } else {
        // A base topology node (ELB / target group / server) was moved — remember
        // it so the layout / auto-refresh doesn't snap it back to the default.
        setNodePositions((prev) => ({ ...prev, [id]: node.position }));
      }
    },
    [moveInstanceBetweenGroups]
  );

  // Optional manual connection — at least one end must be a user-added node
  // (data point / instance / instance group), so base topology edges are left alone.
  const onConnect = useCallback((params) => {
    if (!params.source || !params.target || params.source === params.target) return;
    const addable = (id) =>
      id.startsWith('dpg:') ||
      id.startsWith('dp:') ||
      id.startsWith('ig:') ||
      id.startsWith('stg:') ||
      id.startsWith('anno:');
    if (!addable(params.source) && !addable(params.target)) return;
    const sh = params.sourceHandle || null;
    const th = params.targetHandle || null;
    setConnections((cs) =>
      // Allow several wires between the same pair (as long as the handles differ),
      // so connecting two nodes more than once works.
      cs.some(
        (c) =>
          c.source === params.source &&
          c.target === params.target &&
          (c.sourceHandle || null) === sh &&
          (c.targetHandle || null) === th
      )
        ? cs
        : [...cs, { source: params.source, target: params.target, sourceHandle: sh, targetHandle: th }]
    );
  }, []);

  // Delete a manual connection (via the ✕ on the edge, or select + Delete key).
  const onEdgesDelete = useCallback((deleted) => {
    const keys = new Set(deleted.map((e) => `${e.source}->${e.target}`));
    setConnections((cs) => cs.filter((c) => !keys.has(`${c.source}->${c.target}`)));
  }, []);

  const removeConnection = useCallback((conn) => {
    setConnections((cs) =>
      cs.filter(
        (c) =>
          !(
            c.source === conn.source &&
            c.target === conn.target &&
            (c.sourceHandle || null) === (conn.sourceHandle || null) &&
            (c.targetHandle || null) === (conn.targetHandle || null)
          )
      )
    );
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
      setDataGroups([]);
      setConnections([]);
      setInstanceGroups([]);
      setStandaloneTGs([]);
      setAnnotations([]);
      setNodePositions({});
      setCustomButtons({});
      savedOverlayRef.current = EMPTY_OVERLAY_SIG;
      setModeUnlocked(false);
      return;
    }
    try {
      const v = await api.getView(Number(id));
      // Migrate legacy views (single group via datapointGroupPos) → dataGroups.
      let dps = v.data?.datapoints || [];
      let dgs = v.data?.dataGroups;
      if (!dgs) {
        if (dps.some((d) => !d.pinned)) {
          const gid = 'g-legacy';
          dgs = [
            { id: gid, name: 'Data points', position: v.data?.datapointGroupPos || { x: -486, y: -278 } },
          ];
          dps = dps.map((d) => (d.pinned ? d : { ...d, groupId: d.groupId || gid }));
        } else {
          dgs = [];
        }
      }
      setSelected(v.baseLbArn);
      if (v.data?.viewMode) setViewMode(v.data.viewMode);
      setDatapoints(dps);
      setDataGroups(dgs);
      setConnections(v.data?.connections || []);
      setInstanceGroups(v.data?.instanceGroups || []);
      setStandaloneTGs(v.data?.standaloneTargetGroups || []);
      setAnnotations(v.data?.annotations || []);
      setNodePositions(v.data?.nodePositions || {});
      setCustomButtons(v.data?.customButtons || {});
      setCurrentView({ id: v.id, name: v.name, createdBy: v.createdBy, viewMode: v.data?.viewMode || null });
      setModeUnlocked(false); // each opened view starts locked to its layout
      // Baseline = what we just loaded (migrated), so it isn't flagged as dirty.
      savedOverlayRef.current = overlaySignature({
        datapoints: dps,
        dataGroups: dgs,
        connections: v.data?.connections,
        instanceGroups: v.data?.instanceGroups,
        standaloneTGs: v.data?.standaloneTargetGroups,
        annotations: v.data?.annotations,
        nodePositions: v.data?.nodePositions,
        customButtons: v.data?.customButtons,
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
    setDataGroups([]);
    setConnections([]);
    setInstanceGroups([]);
    setStandaloneTGs([]);
    setAnnotations([]);
    setNodePositions({});
    setCustomButtons({});
    savedOverlayRef.current = EMPTY_OVERLAY_SIG;
    setModeUnlocked(false);
  }, []);

  const saveView = useCallback(async () => {
    try {
      const data = {
        viewMode,
        datapoints,
        dataGroups,
        connections,
        instanceGroups,
        standaloneTargetGroups: standaloneTGs.map(({ tgArn, name, position }) => ({
          tgArn,
          name,
          position,
        })),
        annotations,
        nodePositions,
        customButtons,
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
  }, [currentView, selected, viewMode, datapoints, dataGroups, connections, instanceGroups, standaloneTGs, annotations, nodePositions, customButtons, loadViewsList]);

  // Export the whole canvas (fit to all nodes) as a downloadable SVG.
  const [exporting, setExporting] = useState(false);
  const exportSvg = useCallback(async () => {
    const vp = document.querySelector('.react-flow__viewport');
    if (!vp || nodes.length === 0) return;
    setExporting(true);
    try {
      const PAD = 60;
      const bounds = getRectOfNodes(nodes);
      const w = Math.round(Math.min(6000, Math.max(800, bounds.width + PAD * 2)));
      const h = Math.round(Math.min(6000, Math.max(600, bounds.height + PAD * 2)));
      const [x, y, zoom] = getTransformForBounds(bounds, w, h, 0.2, 2);
      const dataUrl = await toSvg(vp, {
        backgroundColor: '#0c0d14',
        width: w,
        height: h,
        style: {
          width: `${w}px`,
          height: `${h}px`,
          transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        },
        // don't bake in hover-only affordances (edge ✕, resize handles)
        filter: (el) =>
          !(el.classList &&
            (el.classList.contains('edge-delete') ||
              el.classList.contains('react-flow__resize-control'))),
      });
      const base = (currentView?.name || 'topology')
        .replace(/[^\w.-]+/g, '-')
        .toLowerCase();
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${base}.svg`;
      a.click();
    } catch (e) {
      setError(`SVG export failed: ${String(e.message || e)}`);
    } finally {
      setExporting(false);
    }
  }, [nodes, currentView]);

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

    // Apply any user-moved positions so dragged base nodes survive re-layout.
    if (Object.keys(nodePositions).length) {
      base.nodes = base.nodes.map((n) =>
        nodePositions[n.id] ? { ...n, position: nodePositions[n.id] } : n
      );
    }

    // Data points live in one or more named groups; a point dragged out becomes
    // "pinned" and stands alone. Each group renders a container + its members.
    const DP_COLS = 2, CW = 206, CH = 74, PAD = 16, HEAD = 28;
    const dpNodes = [];
    const dpNode = (dp) => ({
      id: `dp:${dp.id}`,
      type: 'datapoint',
      draggable: true,
      data: { dp, onOpen: () => setActiveDp(dp), onRemove: () => removeDatapoint(dp.id) },
    });

    const groupIds = new Set(dataGroups.map((g) => g.id));
    const membersOf = (gid) => datapoints.filter((d) => !d.pinned && d.groupId === gid);

    for (const g of dataGroups) {
      const members = membersOf(g.id);
      if (!members.length) continue;
      const cols = Math.min(DP_COLS, members.length);
      const rows = Math.ceil(members.length / DP_COLS);
      dpNodes.push({
        id: `dpg:${g.id}`,
        type: 'dpGroup',
        position: g.position || { x: -486, y: -278 },
        style: {
          width: cols * 190 + (cols - 1) * 16 + PAD * 2,
          height: rows * 58 + (rows - 1) * 16 + HEAD + PAD,
        },
        className: 'dp-group-node',
        draggable: true,
        selectable: true,
        data: { name: g.name, onRemove: () => removeDataGroup(g.id) },
      });
      members.forEach((dp, i) => {
        dpNodes.push({
          ...dpNode(dp),
          parentId: `dpg:${g.id}`, // move with the group; no `extent` so it can be pulled out
          position: { x: PAD + (i % DP_COLS) * CW, y: HEAD + Math.floor(i / DP_COLS) * CH },
        });
      });
    }

    // Pinned points, plus any orphaned by a missing group, stand alone.
    for (const dp of datapoints) {
      if (!dp.pinned && groupIds.has(dp.groupId)) continue;
      dpNodes.push({ ...dpNode(dp), position: dp.position || { x: -440, y: -240 } });
    }
    const connEdges = connections.map((c, i) => ({
      id: `conn:${i}:${c.source}:${c.sourceHandle || ''}->${c.target}:${c.targetHandle || ''}`,
      source: c.source,
      target: c.target,
      sourceHandle: c.sourceHandle || undefined,
      targetHandle: c.targetHandle || undefined,
      type: 'deletable',
      className: 'dp-conn',
      deletable: true,
      data: { onDelete: () => removeConnection(c) },
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
        data: {
          name: g.name,
          count: n,
          onRemove: () => removeInstanceGroup(g.id),
          onOpen: () => setActiveIg(g.id),
        },
        draggable: true,
      });
      g.instances.forEach((inst, i) => {
        igNodes.push({
          id: `ig:${g.id}::${inst.id}::${i}`,
          type: 'instanceNode',
          parentId: `ig:${g.id}`,
          // draggable + no `extent` so an instance can be pulled out of the group
          // or dropped into another one (handled in onNodeDragStop).
          draggable: true,
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
    nodePositions,
    datapoints,
    dataGroups,
    connections,
    removeConnection,
    removeDatapoint,
    removeDataGroup,
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

  // (No fit-on-add: new nodes now spawn at the current viewport center, so the
  // view should stay put instead of reframing to fit everything.)

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

  // Click the ELB node → show its listener rules.
  const onNodeClick = useCallback(
    (_, node) => {
      if (ELB_TYPES.includes(node.type)) {
        const name = elbs.find((e) => e.arn === node.id)?.name || topology?.loadBalancer?.name;
        setActiveElb({ lbArn: node.id, name });
      }
    },
    [elbs, topology]
  );

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
            <button
              className="view-action"
              onClick={exportSvg}
              disabled={exporting}
              title="Download the current canvas as an SVG"
            >
              {exporting ? '⏳ Exporting…' : '⭳ Export SVG'}
            </button>
            {isAdmin && (
              <>
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
              </>
            )}
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
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
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
          {...buttonProps(`tg:${activeTg.tg.arn}`, activeTg.tg.name)}
          onClose={() => setActiveTg(null)}
        />
      )}

      {activeElb && (
        <AlbRulesModal
          lbArn={activeElb.lbArn}
          name={activeElb.name}
          onClose={() => setActiveElb(null)}
        />
      )}

      {activeIg &&
        (() => {
          const g = instanceGroups.find((x) => x.id === activeIg);
          if (!g) return null;
          return (
            <InstanceGroupModal
              group={g}
              {...buttonProps(`ig:${g.id}`, g.name)}
              onOpenInstance={(inst) =>
                setActiveDp({
                  type: 'ec2',
                  label: inst.name,
                  source: 'cloudwatch',
                  config: { instanceId: inst.id, privateIp: inst.privateIp },
                })
              }
              onClose={() => setActiveIg(null)}
            />
          );
        })()}

      {buttonEditor && (
        <NodeButtonsModal
          title={buttonEditor.title}
          buttons={customButtons[buttonEditor.key] || []}
          onSave={(list) => saveButtons(buttonEditor.key, list)}
          onClose={() => setButtonEditor(null)}
        />
      )}

      {showUsers && <UsersModal onClose={() => setShowUsers(false)} />}
      {showAccount && <AccountModal onClose={() => setShowAccount(false)} />}
      {showAddDp && (
        <AddDataPointModal
          groups={dataGroups}
          onAdd={addDatapoint}
          onClose={() => setShowAddDp(false)}
        />
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
        <DatapointMetricsModal
          datapoint={activeDp}
          {...(activeDp.type === 'ec2' && activeDp.config?.instanceId
            ? buttonProps(`inst:${activeDp.config.instanceId}`, activeDp.label)
            : {})}
          onClose={() => setActiveDp(null)}
        />
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
