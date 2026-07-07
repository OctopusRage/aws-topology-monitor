// Turns a topology payload into React Flow nodes + edges laid out like an
// n8n canvas: the ELB up top, target-group "container" nodes arranged in a
// balanced GRID below it (wrapping to multiple rows so it never stretches into
// one super-wide strip), each holding its server nodes in a grid.

const SERVER_W = 158;
const SERVER_H = 62;
const SERVER_GAP = 14;
const GROUP_PAD_X = 16;
const GROUP_HEADER = 88; // room for kicker + up to 2-line title
const GROUP_PAD_BOTTOM = 16;
const GROUP_GAP_X = 48; // horizontal gap between groups
const GROUP_GAP_Y = 56; // vertical gap between group rows
const ELB_W = 300;
const ELB_Y = 0;
const TG_Y = 250; // top of the first group row
const MAX_SERVER_COLS = 2; // keep each group narrow → more uniform grid
const MIN_GROUP_WIDTH = 300; // so headers always have room for the name

function groupDims(count) {
  const cols = Math.min(MAX_SERVER_COLS, Math.max(1, count));
  const rows = Math.ceil(count / cols); // 0 when the group is empty
  const rawWidth = GROUP_PAD_X * 2 + cols * SERVER_W + (cols - 1) * SERVER_GAP;
  const width = Math.max(rawWidth, MIN_GROUP_WIDTH);
  const serverArea =
    rows > 0 ? rows * SERVER_H + (rows - 1) * SERVER_GAP : 22; // empty hint
  const height = GROUP_HEADER + serverArea + GROUP_PAD_BOTTOM;
  return { cols: Math.max(cols, 1), rows, width, height };
}

// How many groups per row — aim for a roughly landscape, balanced grid so
// fitView can show everything at a comfortable zoom.
function groupsPerRow(n) {
  return Math.min(5, Math.max(2, Math.ceil(Math.sqrt(n))));
}

// ── Radial layout ──────────────────────────────────────────────────────────
// ELB at the center; target-group CONTAINERS (servers grouped inside, same as
// grid) arranged on a ring around it, with straight spoke edges.
export function buildRadialGraph(topology, onGroupClick) {
  if (!topology) return { nodes: [], edges: [] };
  const { loadBalancer, targetGroups } = topology;

  const measured = targetGroups.map((tg) => ({
    tg,
    dims: groupDims(tg.targets.length),
  }));
  const N = measured.length;
  const maxW = Math.max(...measured.map((m) => m.dims.width), 200);
  const maxH = Math.max(...measured.map((m) => m.dims.height), 120);

  const gap = 90;
  const circR = (N * (maxW + gap)) / (2 * Math.PI); // avoid neighbor overlap
  const clearR = Math.hypot(maxW, maxH) / 2 + 240; // keep ring clear of the ELB
  const R = Math.max(circR, clearR, 460);

  const ELB_W = 300;
  const ELB_H = 150;
  const cx = 0;
  const cy = 0;

  const nodes = [];
  const edges = [];

  nodes.push({
    id: loadBalancer.arn,
    type: 'elbRadial',
    position: { x: cx - ELB_W / 2, y: cy - ELB_H / 2 },
    data: { lb: loadBalancer, tgCount: N },
    draggable: true,
  });

  measured.forEach(({ tg, dims }, i) => {
    const theta = -Math.PI / 2 + (i * 2 * Math.PI) / N; // start at top, clockwise
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const gx = cx + R * c - dims.width / 2;
    const gy = cy + R * s - dims.height / 2;

    // Which side of the group faces the center → inbound handle;
    // which side of the ELB faces the group → outbound handle.
    let handlePos, srcHandle;
    if (Math.abs(c) > Math.abs(s)) {
      handlePos = c > 0 ? 'left' : 'right';
      srcHandle = c > 0 ? 'right' : 'left';
    } else {
      handlePos = s > 0 ? 'top' : 'bottom';
      srcHandle = s > 0 ? 'bottom' : 'top';
    }

    const healthy = tg.targets.filter((t) => t.health === 'healthy').length;

    nodes.push({
      id: tg.arn,
      type: 'tgRadial',
      position: { x: gx, y: gy },
      style: { width: dims.width, height: dims.height },
      data: {
        tg,
        healthy,
        total: tg.targets.length,
        onClick: () => onGroupClick(tg),
        handlePos,
      },
      draggable: true,
    });

    edges.push({
      id: `${loadBalancer.arn}->${tg.arn}`,
      source: loadBalancer.arn,
      target: tg.arn,
      sourceHandle: srcHandle,
      targetHandle: 'in',
      type: 'default',
      className: 'nn-edge-elb',
      style: { stroke: '#ff6d5a', strokeWidth: 1.6, opacity: 0.5 },
    });

    tg.targets.forEach((srv, j) => {
      const col = j % dims.cols;
      const row = Math.floor(j / dims.cols);
      nodes.push({
        id: `${tg.arn}::${srv.id}::${j}`,
        type: 'server',
        parentId: tg.arn,
        extent: 'parent',
        draggable: false,
        selectable: false,
        position: {
          x: GROUP_PAD_X + col * (SERVER_W + SERVER_GAP),
          y: GROUP_HEADER + row * (SERVER_H + SERVER_GAP),
        },
        data: { srv },
      });
    });
  });

  return { nodes, edges };
}

// ── Neural-network tree layout ─────────────────────────────────────────────
// Left→right layered graph: ELB (input) → target groups (hidden layer) →
// servers (output), with glowing circular nodes and curved edges.
const NN_SLOT = 48; // vertical space per server
const NN_ELB_X = 40;
const NN_TG_X = 560;
const NN_SRV_X = 1040;
const NN_MIN_BAND = 112; // min vertical band per target group (room for labels)

export function buildNeuralGraph(topology, onGroupClick) {
  if (!topology) return { nodes: [], edges: [] };
  const { loadBalancer, targetGroups } = topology;

  // Each target group gets a vertical "band" sized to its server count so
  // nothing overlaps; the group sits at the band's center.
  const bands = targetGroups.map((tg) =>
    Math.max(Math.max(tg.targets.length, 1) * NN_SLOT, NN_MIN_BAND)
  );
  const totalH = bands.reduce((a, b) => a + b, 0);

  const nodes = [];
  const edges = [];

  nodes.push({
    id: loadBalancer.arn,
    type: 'elbN',
    position: { x: NN_ELB_X, y: totalH / 2 - 28 },
    data: { lb: loadBalancer, tgCount: targetGroups.length },
    draggable: true,
  });

  let y = 0;
  targetGroups.forEach((tg, i) => {
    const bandH = bands[i];
    const tgCenterY = y + bandH / 2;
    const healthy = tg.targets.filter((t) => t.health === 'healthy').length;

    nodes.push({
      id: tg.arn,
      type: 'tgN',
      position: { x: NN_TG_X, y: tgCenterY - 23 },
      data: {
        tg,
        healthy,
        total: tg.targets.length,
        onClick: () => onGroupClick(tg),
      },
      draggable: true,
    });

    edges.push({
      id: `${loadBalancer.arn}->${tg.arn}`,
      source: loadBalancer.arn,
      target: tg.arn,
      type: 'default',
      className: 'nn-edge-elb',
      style: { stroke: '#ff6d5a', strokeWidth: 1.6, opacity: 0.55 },
    });

    const k = Math.max(tg.targets.length, 1);
    tg.targets.forEach((srv, j) => {
      const sy = y + (bandH * (j + 0.5)) / k;
      const sid = `${tg.arn}::${srv.id}::${j}`;
      nodes.push({
        id: sid,
        type: 'serverN',
        position: { x: NN_SRV_X, y: sy - 12 },
        data: { srv },
        draggable: false,
        selectable: false,
      });
      edges.push({
        id: `${tg.arn}->${sid}`,
        source: tg.arn,
        target: sid,
        type: 'default',
        className: 'nn-edge-srv',
        style: { stroke: '#7b6cff', strokeWidth: 1.2, opacity: 0.35 },
      });
    });

    y += bandH;
  });

  return { nodes, edges };
}

export function buildGraph(topology, onGroupClick) {
  if (!topology) return { nodes: [], edges: [] };
  const { loadBalancer, targetGroups } = topology;

  const measured = targetGroups.map((tg) => ({
    tg,
    dims: groupDims(tg.targets.length),
  }));

  const perRow = groupsPerRow(measured.length);
  const colWidth = Math.max(...measured.map((m) => m.dims.width), ELB_W);
  const gridWidth = perRow * colWidth + (perRow - 1) * GROUP_GAP_X;

  const nodes = [];
  const edges = [];

  // ELB centered over the whole grid.
  const elbX = gridWidth / 2 - ELB_W / 2;
  nodes.push({
    id: loadBalancer.arn,
    type: 'elb',
    position: { x: elbX, y: ELB_Y },
    data: { lb: loadBalancer, tgCount: targetGroups.length },
    draggable: true,
  });

  // Walk the groups row by row, tracking the tallest group per row for spacing.
  let rowY = TG_Y;
  for (let i = 0; i < measured.length; i += perRow) {
    const row = measured.slice(i, i + perRow);
    const rowHeight = Math.max(...row.map((m) => m.dims.height));

    row.forEach(({ tg, dims }, c) => {
      const colX = c * (colWidth + GROUP_GAP_X);
      // center narrower groups within their uniform column
      const x = colX + (colWidth - dims.width) / 2;
      const healthy = tg.targets.filter((t) => t.health === 'healthy').length;

      nodes.push({
        id: tg.arn,
        type: 'targetGroup',
        position: { x, y: rowY },
        style: { width: dims.width, height: dims.height },
        data: {
          tg,
          healthy,
          total: tg.targets.length,
          onClick: () => onGroupClick(tg),
        },
        draggable: true,
      });

      edges.push({
        id: `${loadBalancer.arn}->${tg.arn}`,
        source: loadBalancer.arn,
        target: tg.arn,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#ff6d5a', strokeWidth: 1.5, opacity: 0.35 },
      });

      tg.targets.forEach((srv, si) => {
        const scol = si % dims.cols;
        const srow = Math.floor(si / dims.cols);
        nodes.push({
          id: `${tg.arn}::${srv.id}::${si}`,
          type: 'server',
          parentId: tg.arn,
          extent: 'parent',
          draggable: false,
          selectable: false,
          position: {
            x: GROUP_PAD_X + scol * (SERVER_W + SERVER_GAP),
            y: GROUP_HEADER + srow * (SERVER_H + SERVER_GAP),
          },
          data: { srv },
        });
      });
    });

    rowY += rowHeight + GROUP_GAP_Y;
  }

  return { nodes, edges };
}
