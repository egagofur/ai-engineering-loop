'use strict';

const NODE_WIDTH = 104;
const NODE_PORT_Y = 52;
const NODE_BLOCK_HEIGHT = 152;
const FIT_PADDING = 48;
const PANEL_WIDTH = 480;
const TOOLTIP_DELAY_MS = 250;
const MINIMAP_WIDTH = 180;
const MINIMAP_HEIGHT = 110;
const LABEL_BLEED = 36;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const COLUMN_PITCH = 188;
const ROW_PITCH = 200;
const DISPLAY_NAME_MAX = 80;
const STAGES = [
  { id: 'goal', label: 'goal', types: ['goal-contract'] },
  { id: 'maker', label: 'maker', types: ['maker'] },
  { id: 'verify', label: 'verify', types: ['verification'] },
  { id: 'review', label: 'review', types: ['devil-advocate'] },
  { id: 'judge', label: 'judge', types: ['judge'] },
  { id: 'deliver', label: 'deliver', types: ['delivery', 'approval', 'report'] }
];
const TERMINAL_RUN_STATES = new Set(['DELIVERED', 'REPORTED', 'ESCALATED', 'CANCELLED']);
const GRAPH_STATES = Object.freeze(['active', 'passed', 'failed', 'skipped', 'waiting', 'idle']);

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(
  /[&<>"']/g,
  (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
);

function formField(name) {
  return byId(name) || document.querySelector?.(`[name="${name}"]`) || { value: '', disabled: false, hidden: false };
}

function scenePart(selector) {
  const scene = byId('scene');
  if (!scene?.querySelector) return { innerHTML: '', style: {}, append() {}, setAttribute() {}, querySelector() { return null; } };
  return scene.querySelector(selector) || scene;
}

let catalog = { recipes: [], live: null, root: '', watchMode: 'watch' };
let draft;
let source;
let loadedRecipeId;
let selectedId;
let selectedIds = new Set();
let selectedEdgeId;
let validationSequence = 0;
let validationState = { status: 'pending', hash: '', issues: [], extraCodes: [] };
let invalidEdgeIds = new Set();
let edgeIssues = new Map();
let loadedEdges = [];
let loadedEdgeSignature = '';
let positions = new Map();
let viewport = { x: 0, y: 0, scale: 1 };
let history = [];
let historyIndex = -1;
let interaction;
let connection;
let layoutTimer;
let hasFitted = false;
let resizeFitTimer;
let edgeHideTimer;
let spacePressed = false;
let runs = [];
let goal = { text: '', version: 1, frozen: false, draftRevision: 0, draftHash: null };
let activeRunId;
let hydratedGoalKey;
let selectedCheckoutRun;
let lifecycleEvents = [];
let agentPresence = { status: 'UNKNOWN', lastHeartbeatAt: null };
let handoffCopiedRunId;
let onboardingDismissed = false;
let workspace = 'live';
let pinnedRunId = null;
let lastEventSeq = 0;
let eventAbort;
let eventsReady = false;
let liveArtifacts = {};
let liveRenderScheduled = false;
let reconnectTimer = null;
let reconnectAttempt = 0;
let resumeFallbackUsed = false;
let panelNodeId = null;
let panelTab = 'overview';
let panelRequest = 0;
let panelView = { status: 'empty' };
let tooltipTimer = null;
let suppressNodeClick = false;
let zoomInButton = null;
let zoomLevelOutput = null;
let nodeTooltip = null;
let minimap = null;
const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 5000];

function graphStateClass(value) {
  const normalized = String(value || 'idle').toLowerCase();
  if (normalized === 'running' || normalized === 'in_progress' || normalized === 'working') return 'active';
  return GRAPH_STATES.includes(normalized) ? normalized : 'idle';
}

function displayName(item) {
  return item?.displayName || item?.name || item?.id || 'Untitled';
}

function edgeId(from, to, index = 0) {
  const suffix = index ? `-${index + 1}` : '';
  const base = `edge-${from}-${to}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return `${base.slice(0, 64 - suffix.length)}${suffix}`;
}

function uniqueEdgeId(from, to) {
  let index = 0;
  let candidate = edgeId(from, to, index);
  const occupied = new Set((draft?.edges || []).map((edge) => edge.id));
  while (occupied.has(candidate)) candidate = edgeId(from, to, ++index);
  return candidate;
}

function normalizeDraftGraph(recipe) {
  recipe.nodes = (recipe.nodes || []).map((node) => ({
    ...node,
    displayName: displayName(node)
  }));
  if (!Array.isArray(recipe.edges)) {
    recipe.edges = [];
    recipe.nodes.forEach((node) => {
      (node.dependsOn || []).forEach((from, index) => {
        recipe.edges.push({ id: edgeId(from, node.id, index), from, to: node.id });
      });
    });
  }
  const used = new Set();
  recipe.edges = recipe.edges.map((edge, index) => {
    let id = edge.id || edgeId(edge.from, edge.to, index);
    while (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    return { ...edge, id };
  });
  recipe.loopGroups = Array.isArray(recipe.loopGroups) ? recipe.loopGroups : [];
  syncDependencies(recipe);
  return recipe;
}

function syncDependencies(recipe = draft) {
  if (!recipe) return;
  recipe.nodes.forEach((node) => {
    node.dependsOn = recipe.edges
      .filter((edge) => edge.to === node.id)
      .map((edge) => edge.from);
  });
}

function authoringRecipe(recipe = draft) {
  const exported = structuredClone(recipe);
  exported.nodes.forEach((node) => delete node.dependsOn);
  return exported;
}

function applyDisplayName() {
  return false;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error || payload.validation?.errors?.join('; ') || 'Request failed');
    error.payload = payload;
    throw error;
  }
  return payload;
}

function layoutPayload() {
  return { viewport: { ...viewport }, positions: Object.fromEntries(positions) };
}

function defaultGraphPositions() {
  const depths = new Map();
  const visiting = new Set();
  const depthFor = (node) => {
    if (depths.has(node.id)) return depths.get(node.id);
    if (visiting.has(node.id)) return 0;
    visiting.add(node.id);
    const depth = (node.dependsOn || []).reduce((maximum, dependencyId) => {
      const dependency = draft.nodes.find((candidate) => candidate.id === dependencyId);
      return Math.max(maximum, dependency ? depthFor(dependency) + 1 : 0);
    }, 0);
    visiting.delete(node.id);
    depths.set(node.id, depth);
    return depth;
  };
  const rows = new Map();
  return new Map(draft.nodes.map((node) => {
    const depth = depthFor(node);
    const row = rows.get(depth) || 0;
    rows.set(depth, row + 1);
    return [node.id, { x: 48 + depth * COLUMN_PITCH, y: 56 + row * ROW_PITCH }];
  }));
}

function ensurePositions() {
  const defaults = defaultGraphPositions();
  const ids = new Set(draft.nodes.map((node) => node.id));
  for (const id of positions.keys()) {
    if (!ids.has(id)) positions.delete(id);
  }
  for (const node of draft.nodes) {
    if (!positions.has(node.id)) positions.set(node.id, defaults.get(node.id));
  }
}

function applyViewport() {
  const scene = byId('scene');
  const canvas = byId('canvas');
  if (scene?.style) scene.style.transform = `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.scale})`;
  if (canvas?.style) {
    canvas.style.backgroundPosition = `${viewport.x}px ${viewport.y}px`;
    canvas.style.backgroundSize = `${32 * viewport.scale}px ${32 * viewport.scale}px`;
  }
  updateZoomLabel();
  renderMinimap();
}

function screenToWorld(clientX, clientY) {
  const rect = byId('canvas').getBoundingClientRect();
  return {
    x: (clientX - rect.left - viewport.x) / viewport.scale,
    y: (clientY - rect.top - viewport.y) / viewport.scale
  };
}

function curveBend(x1, x2) {
  return Math.max(48, Math.abs(x2 - x1) * 0.45);
}

function curvePath(x1, y1, x2, y2) {
  const bend = curveBend(x1, x2);
  return `M${x1} ${y1} C${x1 + bend} ${y1},${x2 - bend} ${y2},${x2} ${y2}`;
}

function pointOnCurve(x1, y1, x2, y2, t) {
  const bend = curveBend(x1, x2);
  const u = 1 - t;
  return {
    x: u * u * u * x1 + 3 * u * u * t * (x1 + bend) + 3 * u * t * t * (x2 - bend) + t * t * t * x2,
    y: u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2
  };
}

function edgePath(from, to) {
  return curvePath(from.x + NODE_WIDTH, from.y + NODE_PORT_Y, to.x, to.y + NODE_PORT_Y);
}

function edgeEndpoints(from, to) {
  return {
    x1: from.x + NODE_WIDTH,
    y1: from.y + NODE_PORT_Y,
    x2: to.x,
    y2: to.y + NODE_PORT_Y
  };
}

function loopBounds(loopGroup) {
  const points = loopGroup.nodeIds.map((nodeId) => positions.get(nodeId)).filter(Boolean);
  if (!points.length) return null;
  const padX = 46;
  const padTop = 58;
  const padBottom = 28;
  const left = Math.min(...points.map((point) => point.x)) - padX;
  const top = Math.min(...points.map((point) => point.y)) - padTop;
  const right = Math.max(...points.map((point) => point.x + NODE_WIDTH)) + padX;
  const bottom = Math.max(...points.map((point) => point.y + NODE_BLOCK_HEIGHT)) + padBottom;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function loopLabelText(loopGroup, runtime) {
  const iteration = runtime?.iteration ?? 1;
  return `${loopGroup.displayName} · iteration ${iteration} / ${loopGroup.maxIterations}`;
}

function loopLabelOverlapsEdge(rect) {
  for (const edge of draft?.edges || []) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const { x1, y1, x2, y2 } = edgeEndpoints(from, to);
    for (let step = 0; step <= 8; step += 1) {
      const point = pointOnCurve(x1, y1, x2, y2, step / 8);
      if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) {
        return true;
      }
    }
  }
  return false;
}

function placeLoopLabel(bounds, label) {
  const height = 26;
  const width = Math.min(Math.max(bounds.width - 24, 80), 16 + String(label).length * 7.1);
  const centerLeft = bounds.left + (bounds.width - width) / 2;
  const candidates = [
    { left: centerLeft, top: bounds.top - height / 2 },
    { left: centerLeft, top: bounds.top - height - 10 },
    { left: bounds.left + 12, top: bounds.top - height - 10 },
    { left: bounds.right - width - 12, top: bounds.top - height - 10 },
    { left: centerLeft, top: bounds.bottom + 10 }
  ];
  for (const candidate of candidates) {
    const rect = {
      left: candidate.left,
      top: candidate.top,
      right: candidate.left + width,
      bottom: candidate.top + height
    };
    if (!loopLabelOverlapsEdge(rect)) return rect;
  }
  const fallback = candidates[1];
  return {
    left: fallback.left,
    top: fallback.top,
    right: fallback.left + width,
    bottom: fallback.top + height
  };
}

function renderLoopGroups() {
  const container = scenePart('.loop-groups');
  container.innerHTML = '';
  for (const loopGroup of draft?.loopGroups || []) {
    const bounds = loopBounds(loopGroup);
    if (!bounds) continue;
    const runtime = catalog.live?.loopGroups?.[loopGroup.id];
    const label = loopLabelText(loopGroup, runtime);
    const rect = placeLoopLabel(bounds, label);
    const element = document.createElement('section');
    element.className = `loop-group ${runtime?.status?.toLowerCase() || 'draft'}`;
    element.style.left = `${bounds.left}px`;
    element.style.top = `${bounds.top}px`;
    element.style.width = `${bounds.width}px`;
    element.style.height = `${bounds.height}px`;
    // CSP style-src 'self' blocks inline style attributes; position the pill through the CSSOM.
    const pill = document.createElement('header');
    pill.className = 'loop-pill';
    pill.textContent = label;
    if (pill.style) {
      pill.style.left = `${rect.left - bounds.left}px`;
      pill.style.top = `${rect.top - bounds.top}px`;
      pill.style.width = `${Math.max(0, rect.right - rect.left)}px`;
    }
    element.replaceChildren?.(pill);
    if (!element.replaceChildren) element.innerHTML = `<header class="loop-pill">${escapeHtml(label)}</header>`;
    container.append(element);
  }
}

function stageLabel(node, index) {
  const stages = {
    'goal-contract': 'STAGE 01',
    maker: 'STAGES 02–04',
    verification: 'STAGE 05',
    'devil-advocate': 'STAGE 06',
    judge: 'STAGE 07',
    approval: 'STAGE 08 GATE',
    delivery: 'STAGE 08',
    report: 'REPORT'
  };
  return stages[node.type] || `STEP ${String(index + 1).padStart(2, '0')}`;
}

function edgeClassName(edge) {
  const state = graphStateClass(catalog.live?.edges?.find((candidate) => candidate.id === edge.id)?.state);
  const intoRunning = graphStateClass(catalog.live?.nodes?.[edge.to]?.status) === 'active';
  const active = state === 'active' || intoRunning;
  const invalid = invalidEdgeIds.has(edge.id) ? ' edge-invalid' : '';
  return `edge edge-${state}${active ? ' edge-active' : ''}${selectedEdgeId === edge.id ? ' selected' : ''}${invalid}`;
}

function edgeDeleteClass(edge) {
  return `edge-delete${selectedEdgeId === edge.id ? ' selected' : ''}`;
}

function bindEdgeAffordance(path, control, handles, edgeId) {
  const show = () => {
    clearTimeout(edgeHideTimer);
    control.classList.add('visible');
    control.setAttribute('aria-hidden', 'false');
    handles.forEach((handle) => handle.classList.add('visible'));
  };
  const scheduleHide = () => {
    clearTimeout(edgeHideTimer);
    edgeHideTimer = setTimeout(() => {
      if (selectedEdgeId !== edgeId) {
        control.classList.remove('visible');
        control.setAttribute('aria-hidden', 'true');
        handles.forEach((handle) => handle.classList.remove('visible'));
      }
    }, 160);
  };
  path.addEventListener('pointerenter', show);
  path.addEventListener('pointerleave', scheduleHide);
  control.addEventListener('pointerenter', show);
  control.addEventListener('pointerleave', scheduleHide);
  handles.forEach((handle) => {
    handle.addEventListener('pointerenter', show);
    handle.addEventListener('pointerleave', scheduleHide);
  });
  path.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    selectedEdgeId = edgeId;
    selectedId = null;
    selectedIds = new Set();
    updateSelection();
    renderEdges();
  });
}

function renderEdges() {
  const group = scenePart('.edge-paths');
  const controls = scenePart('.edge-controls');
  const preview = scenePart('.preview-edge');
  group.innerHTML = '';
  controls.innerHTML = '';
  if (preview?.style && preview !== byId('scene')) preview.setAttribute?.('d', preview.getAttribute?.('d') || '');
  if (!draft) return;
  clearTimeout(edgeHideTimer);
  draft.edges.forEach((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', edgePath(from, to));
    path.setAttribute('class', edgeClassName(edge));
    path.setAttribute('marker-end', 'url(#arrow)');
    path.dataset.edgeId = edge.id;
    group.append(path);
    const ends = edgeEndpoints(from, to);
    const midpoint = pointOnCurve(ends.x1, ends.y1, ends.x2, ends.y2, 0.5);
    const control = document.createElement('button');
    control.type = 'button';
    control.className = edgeDeleteClass(edge);
    control.dataset.edgeId = edge.id;
    control.style.left = `${midpoint.x}px`;
    control.style.top = `${midpoint.y}px`;
    control.tabIndex = -1;
    control.title = `${displayName(draft.nodes.find((node) => node.id === edge.from))} → ${displayName(draft.nodes.find((node) => node.id === edge.to))}`;
    control.setAttribute('aria-label', `Delete connection ${control.title}`);
    control.setAttribute('aria-hidden', selectedEdgeId === edge.id ? 'false' : 'true');
    control.textContent = '×';
    control.onclick = (event) => {
      event.stopPropagation();
      deleteEdge(edge.id);
    };
    const handles = [
      edgeHandle(edge, 'from', ends.x1, ends.y1),
      edgeHandle(edge, 'to', ends.x2, ends.y2)
    ];
    bindEdgeAffordance(path, control, handles, edge.id);
    controls.append(control, ...handles);
    const issue = edgeIssueText(edge.id);
    if (issue) {
      const note = document.createElement('p');
      note.className = 'edge-error';
      note.textContent = issue;
      if (note.style) {
        note.style.left = `${midpoint.x}px`;
        note.style.top = `${midpoint.y}px`;
      }
      controls.append(note);
    }
  });
  renderMinimap();
}

function edgeHandle(edge, end, x, y) {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = `edge-end edge-end-${end}${selectedEdgeId === edge.id ? ' visible' : ''}`;
  handle.dataset.edgeId = edge.id;
  handle.dataset.end = end;
  handle.tabIndex = -1;
  handle.setAttribute('aria-label', end === 'to'
    ? `Reposition end of ${edge.from} to ${edge.to}`
    : `Reposition start of ${edge.from} to ${edge.to}`);
  if (handle.style) {
    handle.style.left = `${x}px`;
    handle.style.top = `${y}px`;
  }
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectedEdgeId = edge.id;
    selectedId = null;
    selectedIds = new Set();
    connection = {
      pointerId: event.pointerId,
      edgeId: edge.id,
      end,
      sourceId: end === 'to' ? edge.from : null,
      fixedId: end === 'to' ? edge.from : edge.to
    };
    const preview = scenePart('.preview-edge');
    if (preview?.style) preview.style.display = 'block';
    handle.setPointerCapture?.(event.pointerId);
  });
  return handle;
}

function edgeIssueText(edgeId) {
  return (edgeIssues.get(edgeId) || []).map(issueText).filter(Boolean).join('; ');
}

const NODE_ICONS = {
  'goal-contract': '<circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  maker: '<path d="M9 7 4 12l5 5M15 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  verification: '<rect x="6" y="3.8" width="12" height="16.4" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 12.2 11.2 14.4 15.2 10.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  'devil-advocate': '<path d="M12 3.2 19.2 6v5.4c0 4.3-2.9 7.2-7.2 8.8-4.3-1.6-7.2-4.5-7.2-8.8V6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 8.2v4.4M12 15.4v.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  judge: '<path d="M12 3.5v16.5M6.5 20h11M3.5 8h17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.5 8 1.8 14h4.2ZM20.5 8l1.7 6h-4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  approval: '<circle cx="12" cy="8" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.2 19.2c.9-3.5 3.2-5.2 6.8-5.2s5.9 1.7 6.8 5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  delivery: '<path d="M12 4v10.2M8 10.2 12 14.4l4-4.2M5 19.8h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  report: '<path d="M7 3.2h7.2L18.2 7.2V20.8H7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3.2V7.4h4.2M9.2 12h6M9.2 15.8h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  agent: '<rect x="4.8" y="7" width="14.4" height="10.6" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9.4" cy="12.2" r="1.1" fill="currentColor"/><circle cx="14.6" cy="12.2" r="1.1" fill="currentColor"/><path d="M12 7V4.2M8 17.6v1.6M16 17.6v1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  command: '<rect x="3.2" y="4.6" width="17.6" height="14.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 9.6 9.8 12.2 7 14.8M12 14.8h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  generic: '<rect x="5" y="5" width="14" height="14" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/>'
};

function nodeIcon(type) {
  const body = NODE_ICONS[type] || NODE_ICONS.generic;
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds <= 0) return '';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function parsedTime(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
}

function padTime(value) {
  return String(value).padStart(2, '0');
}

function clockTime(date, withSeconds = false) {
  const clock = `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
  return withSeconds ? `${clock}:${padTime(date.getSeconds())}` : clock;
}

function monthDay(date, withYear) {
  const base = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return withYear ? `${base}, ${date.getFullYear()}` : base;
}

function calendarDayStart(ms) {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function timeZoneName(date) {
  try {
    if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') return '';
    const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(date);
    return parts.find((part) => part.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

function humanizeTime(value, now = Date.now()) {
  const ms = parsedTime(value);
  if (ms == null) return '';
  const age = Math.max(0, now - ms);
  const date = new Date(ms);
  if (age < 5000) return 'just now';
  if (age < 60000) return `${Math.round(age / 1000)}s ago`;
  if (age < 3600000) return `${Math.round(age / 60000)} min ago`;
  const dayDiff = Math.round((calendarDayStart(now) - calendarDayStart(ms)) / 86400000);
  const hours = Math.floor(age / 3600000);
  if (dayDiff <= 0 && hours < 24) return `${Math.max(hours, 1)} h ago`;
  const absolute = `${monthDay(date, date.getFullYear() !== new Date(now).getFullYear())}, ${clockTime(date)}`;
  if (dayDiff === 1) return `yesterday · ${monthDay(date, false)}, ${clockTime(date)}`;
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff} days ago · ${monthDay(date, false)}, ${clockTime(date)}`;
  return absolute;
}

function exactTimeLabel(value) {
  const ms = parsedTime(value);
  if (ms == null) return '';
  const date = new Date(ms);
  const zone = timeZoneName(date);
  return `${monthDay(date, true)} ${clockTime(date, true)}${zone ? ` ${zone}` : ''}`;
}

function datetimeAttr(value) {
  const ms = parsedTime(value);
  if (ms == null) return '';
  const date = new Date(ms);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${date.getFullYear()}-${padTime(date.getMonth() + 1)}-${padTime(date.getDate())}T${clockTime(date, true)}${sign}${padTime(Math.floor(abs / 60))}:${padTime(abs % 60)}`;
}

function timeTag(value, now = Date.now()) {
  const label = humanizeTime(value, now);
  if (!label) return '';
  return `<time datetime="${escapeHtml(datetimeAttr(value))}" title="${escapeHtml(exactTimeLabel(value))}">${escapeHtml(label)}</time>`;
}

function looksLikeIso(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(value || ''));
}

function legacyDurationMs(runtime) {
  if (!runtime || typeof runtime !== 'object') return null;
  if (runtime.durationMs != null && runtime.durationMs !== '') {
    const explicit = Number(runtime.durationMs);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  }
  const started = Date.parse(runtime.startedAt);
  if (!Number.isFinite(started)) return null;
  const completed = Date.parse(runtime.completedAt);
  if (Number.isFinite(completed)) return Math.max(0, completed - started);
  if (graphStateClass(runtime.status) === 'active') return Math.max(0, Date.now() - started);
  return null;
}

function dependencyIds(nodeId, recipe) {
  const ids = new Set();
  for (const edge of recipe?.edges || []) {
    if (edge?.to === nodeId && edge.from) ids.add(edge.from);
  }
  const node = (recipe?.nodes || []).find((item) => item?.id === nodeId);
  for (const id of node?.dependsOn || []) {
    if (id) ids.add(id);
  }
  return [...ids];
}

function nodeDurationMs(nodeId, live, recipe) {
  if (!nodeId || !live || !recipe) return null;
  const runtime = live.nodes?.[nodeId];
  if (!runtime) return null;
  const status = String(runtime.status || '').toUpperCase();
  const finished = status === 'PASSED' || status === 'FAILED';
  const running = status === 'RUNNING' || status === 'IN_PROGRESS' || status === 'WORKING';
  if (!finished && !running) return null;
  const dependencies = dependencyIds(nodeId, recipe);
  let start = NaN;
  if (!dependencies.length) {
    start = Date.parse(live.run?.createdAt);
  } else {
    const times = dependencies
      .map((id) => Date.parse(live.nodes?.[id]?.updatedAt))
      .filter(Number.isFinite);
    if (times.length) start = Math.max(...times);
  }
  if (!Number.isFinite(start)) return null;
  const end = finished ? Date.parse(runtime.updatedAt) : Date.now();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function statusWord(status) {
  if (status == null || status === '') return 'Pending';
  const normalized = String(status).toLowerCase();
  if (normalized === 'blocked') return 'Blocked';
  const state = graphStateClass(status);
  if (state === 'active') return 'Running';
  if (state === 'passed') return 'Passed';
  if (state === 'failed') return 'Failed';
  if (state === 'skipped') return 'Skipped';
  if (state === 'waiting') return 'Waiting';
  if (normalized === 'ready') return 'Ready';
  if (normalized === 'idle' || normalized === 'pending') return 'Pending';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function nodeStatusLine(runtime) {
  const word = statusWord(runtime?.status);
  const duration = formatDuration(legacyDurationMs(runtime));
  return duration ? `${word} · ${duration}` : word;
}

function liveStatusText(node) {
  if (!node) return 'Pending';
  const runtime = runtimeFor(node);
  const word = statusWord(runtime?.status);
  const duration = formatDuration(nodeDurationMs(node.id, catalog.live, draft));
  return duration ? `${word} · ${duration}` : word;
}

function nodeMarkup(node, index) {
  const title = `${stageLabel(node, index)} · ${node.type}`;
  return `
    <button class="port port-in" aria-label="Input for ${escapeHtml(node.id)}" tabindex="-1"></button>
    <div class="node-tile" title="${escapeHtml(title)}">
      <span class="node-icon">${nodeIcon(node.type)}</span>
      <span class="node-mark" aria-hidden="true"></span>
    </div>
    <span class="node-name">${escapeHtml(displayName(node))}</span>
    <span class="node-status">${escapeHtml(liveStatusText(node))}</span>
    <button class="port port-out" aria-label="Connect from ${escapeHtml(node.id)}" tabindex="-1"></button>
  `;
}

function nodeFrame(node, index) {
  const runtime = catalog.live?.nodes?.[node.id];
  return {
    status: graphStateClass(runtime?.status),
    nodeType: node.type,
    title: `${stageLabel(node, index)} · ${node.type}`,
    html: nodeMarkup(node, index)
  };
}

function renderGraph({ live = false } = {}) {
  if (!draft) return;
  hideTooltip();
  ensurePositions();
  renderLoopGroups();
  const container = byId('nodes');
  if (!container) return;
  container.innerHTML = '';
  draft.nodes.forEach((node, index) => {
    const position = positions.get(node.id);
    const frame = nodeFrame(node, index);
    const element = document.createElement('article');
    element.dataset.nodeId = node.id;
    element.dataset.status = frame.status;
    element.dataset.nodeType = frame.nodeType;
    element.title = frame.title;
    element.className = `node${selectedIds.has(node.id) ? ' selected' : ''}`;
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', `${displayName(node)}, ${statusWord(runtimeFor(node)?.status)}`);
    element.setAttribute('aria-describedby', 'node-tooltip');
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    element.innerHTML = frame.html;
    element.addEventListener('pointerdown', beginNodeInteraction);
    element.addEventListener('pointerenter', () => scheduleTooltip(element));
    element.addEventListener('pointerleave', hideTooltip);
    element.addEventListener('focus', () => scheduleTooltip(element));
    element.addEventListener('blur', hideTooltip);
    element.addEventListener('click', onNodeClick);
    element.querySelector('.port-out')?.addEventListener('pointerdown', beginConnection);
    container.append(element);
  });
  renderEdges();
  applyViewport();
  if (!live && !hasFitted) hasFitted = fitView();
  if (!live && panelNodeId) renderNodePanel();
}

function nodeElements() {
  return Array.from(byId('nodes')?.children || []);
}

function updateSelection() {
  for (const element of nodeElements()) {
    const selected = selectedIds.has(element.dataset.nodeId);
    element.classList.toggle('selected', selected);
    const names = String(element.className || '').split(/\s+/).filter((name) => name && name !== 'selected');
    if (selected) names.push('selected');
    element.className = names.join(' ');
  }
}

function selectNode(nodeId, { additive = false } = {}) {
  if (additive) {
    if (selectedIds.has(nodeId)) selectedIds.delete(nodeId);
    else selectedIds.add(nodeId);
  } else {
    selectedIds = new Set([nodeId]);
  }
  selectedId = nodeId;
  selectedEdgeId = null;
  updateSelection();
  renderEdges();
}

function deleteEdge(id) {
  if (!draft) return;
  const before = draft.edges.length;
  draft.edges = draft.edges.filter((edge) => edge.id !== id);
  if (draft.edges.length === before) return;
  syncDependencies();
  selectedEdgeId = null;
  captureHistory();
  renderGraph();
  validateDraft();
}

function addEdge(from, to) {
  if (!draft || !from || !to || from === to) return false;
  if (draft.edges.some((edge) => edge.from === from && edge.to === to)) return false;
  if (transitivelyDependsOn(from, to)) return false;
  if (!draft.nodes.some((node) => node.id === from) || !draft.nodes.some((node) => node.id === to)) return false;
  draft.edges.push({ id: uniqueEdgeId(from, to), from, to });
  syncDependencies();
  captureHistory();
  renderGraph();
  validateDraft();
  return true;
}

function dependsOnTarget(nodeId, targetId, ignoreEdgeId, seen = new Set()) {
  if (!nodeId || !targetId) return false;
  if (nodeId === targetId) return true;
  if (seen.has(nodeId)) return false;
  seen.add(nodeId);
  const upstream = (draft?.edges || [])
    .filter((edge) => edge.to === nodeId && edge.id !== ignoreEdgeId)
    .map((edge) => edge.from);
  return upstream.some((from) => dependsOnTarget(from, targetId, ignoreEdgeId, seen));
}

function repointEdge(id, from, to) {
  const edge = draft?.edges.find((candidate) => candidate.id === id);
  if (!edge || !from || !to || from === to) return false;
  if (edge.from === from && edge.to === to) return true;
  if (!draft.nodes.some((node) => node.id === from) || !draft.nodes.some((node) => node.id === to)) return false;
  if (draft.edges.some((candidate) => candidate.id !== id && candidate.from === from && candidate.to === to)) return false;
  if (dependsOnTarget(from, to, id)) return false;
  edge.from = from;
  edge.to = to;
  syncDependencies();
  selectedEdgeId = id;
  captureHistory();
  renderGraph();
  validateDraft();
  return true;
}

function beginNodeInteraction(event) {
  if (event.button !== 0 || event.target.closest?.('.port')) return;
  event.stopPropagation();
  const element = event.currentTarget;
  const nodeId = element.dataset.nodeId;
  if (event.shiftKey) {
    selectNode(nodeId, { additive: true });
    return;
  }
  if (!selectedIds.has(nodeId)) selectNode(nodeId);
  element.focus?.();
  if (spacePressed) return beginPan(event);
  const world = screenToWorld(event.clientX, event.clientY);
  const position = positions.get(nodeId);
  interaction = {
    type: 'node',
    pointerId: event.pointerId,
    nodeId,
    element,
    offsetX: world.x - position.x,
    offsetY: world.y - position.y,
    origins: new Map([...selectedIds].map((id) => [id, { ...positions.get(id) }])),
    moved: false
  };
  element.classList.add('dragging');
  element.setPointerCapture?.(event.pointerId);
}

function beginPan(event) {
  if (event.button !== 0 && event.button !== 1) return;
  event.preventDefault();
  interaction = {
    type: 'pan',
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    viewportX: viewport.x,
    viewportY: viewport.y
  };
  byId('canvas').setPointerCapture?.(event.pointerId);
}

function handlePointerMove(event) {
  if (connection) {
    const preview = scenePart('.preview-edge');
    const cursor = screenToWorld(event.clientX, event.clientY);
    let x1;
    let y1;
    let x2;
    let y2;
    if (connection.edgeId && connection.end === 'from') {
      const target = positions.get(connection.fixedId);
      if (!target || !preview?.setAttribute) return;
      x1 = cursor.x;
      y1 = cursor.y;
      x2 = target.x;
      y2 = target.y + NODE_PORT_Y;
    } else {
      const source = positions.get(connection.sourceId || connection.fixedId);
      if (!source || !preview?.setAttribute) return;
      x1 = source.x + NODE_WIDTH;
      y1 = source.y + NODE_PORT_Y;
      x2 = cursor.x;
      y2 = cursor.y;
    }
    preview.style.display = 'block';
    preview.setAttribute('d', curvePath(x1, y1, x2, y2));
    return;
  }
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  if (interaction.type === 'minimap') {
    panFromMinimapEvent(event);
    return;
  }
  if (interaction.type === 'node') {
    const world = screenToWorld(event.clientX, event.clientY);
    const position = { x: world.x - interaction.offsetX, y: world.y - interaction.offsetY };
    const origin = interaction.origins.get(interaction.nodeId);
    const delta = { x: position.x - origin.x, y: position.y - origin.y };
    if (Math.hypot(delta.x, delta.y) > 3) interaction.moved = true;
    interaction.origins.forEach((start, id) => {
      const next = { x: start.x + delta.x, y: start.y + delta.y };
      positions.set(id, next);
      const nodeElement = document.querySelector?.(`.node[data-node-id="${CSS.escape(id)}"]`);
      if (nodeElement) {
        nodeElement.style.left = `${next.x}px`;
        nodeElement.style.top = `${next.y}px`;
      }
    });
    renderEdges();
  } else {
    viewport.x = interaction.viewportX + event.clientX - interaction.startX;
    viewport.y = interaction.viewportY + event.clientY - interaction.startY;
    applyViewport();
  }
}

function finishPointer(event) {
  if (connection && connection.pointerId === event.pointerId) return finishConnection(event);
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  if (interaction.type === 'node') interaction.element.classList.remove('dragging');
  const moved = interaction.type === 'node' && interaction.moved;
  interaction = null;
  if (moved) {
    suppressNodeClick = true;
    setTimeout(() => { suppressNodeClick = false; }, 0);
  }
  saveLayoutSoon();
}

function beginConnection(event) {
  event.preventDefault();
  event.stopPropagation();
  const sourceId = event.currentTarget.closest('.node').dataset.nodeId;
  connection = { sourceId, pointerId: event.pointerId };
  const preview = scenePart('.preview-edge');
  if (preview?.style) preview.style.display = 'block';
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function transitivelyDependsOn(nodeId, targetId, seen = new Set()) {
  if (nodeId === targetId) return true;
  if (seen.has(nodeId)) return false;
  seen.add(nodeId);
  const node = draft.nodes.find((candidate) => candidate.id === nodeId);
  return (node?.dependsOn || []).some((dependencyId) => transitivelyDependsOn(dependencyId, targetId, seen));
}

function nodeIdFromPort(hit, selector) {
  const port = hit?.closest?.(selector);
  const node = port?.closest?.('.node');
  return node?.dataset?.nodeId || null;
}

function finishConnection(event) {
  const pending = connection;
  connection = null;
  const preview = scenePart('.preview-edge');
  if (preview?.style) preview.style.display = 'none';
  if (!pending || !draft) return;
  const hit = document.elementFromPoint?.(event.clientX, event.clientY);
  if (pending.edgeId) {
    const edge = draft.edges.find((item) => item.id === pending.edgeId);
    if (!edge) return;
    if (pending.end === 'from') {
      const sourceId = nodeIdFromPort(hit, '.port-out');
      if (!sourceId) return;
      if (!repointEdge(edge.id, sourceId, edge.to)) notify('Connection rejected.');
      return;
    }
    const targetId = nodeIdFromPort(hit, '.port-in');
    if (!targetId) return;
    if (!repointEdge(edge.id, edge.from, targetId)) notify('Connection rejected.');
    return;
  }
  const targetId = nodeIdFromPort(hit, '.port-in');
  if (!targetId || targetId === pending.sourceId) {
    if (targetId && targetId === pending.sourceId) notify('A node cannot connect to itself.');
    return;
  }
  if (addEdge(pending.sourceId, targetId)) return;
  if (draft.edges.some((edge) => edge.from === pending.sourceId && edge.to === targetId)) {
    notify('Nodes are already connected.');
    return;
  }
  notify('Connection rejected: it would create a cycle.');
}

function zoomAt(nextScale, clientX, clientY) {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextScale));
  const pivot = clientX == null ? worldAtCanvasCenter() : screenToWorld(clientX, clientY);
  const rect = byId('canvas').getBoundingClientRect();
  const next = clientX == null
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : { x: clientX, y: clientY };
  viewport.scale = scale;
  const world = screenToWorld(next.x, next.y);
  viewport.x += (world.x - pivot.x) * scale;
  viewport.y += (world.y - pivot.y) * scale;
  applyViewport();
  saveLayoutSoon();
}

function worldAtCanvasCenter() {
  const rect = byId('canvas').getBoundingClientRect();
  return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function handleWheel(event) {
  if (closestReal(event.target, '#node-panel')) return;
  event.preventDefault();
  if (event.ctrlKey) {
    zoomAt(viewport.scale * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
    return;
  }
  zoomAt(viewport.scale * (event.deltaY < 0 ? 1.08 : 0.92), event.clientX, event.clientY);
}

function autoLayout({ record = true } = {}) {
  positions = defaultGraphPositions();
  hasFitted = false;
  renderGraph();
  if (record) captureHistory();
  saveLayoutSoon();
}

function graphBounds() {
  const points = (draft?.nodes || []).map((node) => positions.get(node.id)).filter(Boolean);
  if (!points.length) return null;
  const minX = Math.min(...points.map((point) => point.x)) - LABEL_BLEED;
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x + NODE_WIDTH)) + LABEL_BLEED;
  const maxY = Math.max(...points.map((point) => point.y + NODE_BLOCK_HEIGHT));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function computeFit(bounds, canvasWidth, canvasHeight, padding = FIT_PADDING) {
  const availableW = Math.max(1, canvasWidth - padding * 2);
  const availableH = Math.max(1, canvasHeight - padding * 2);
  const scale = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min(availableW / Math.max(bounds.width, 1), availableH / Math.max(bounds.height, 1)))
  );
  return {
    scale,
    x: padding + (availableW - bounds.width * scale) / 2 - bounds.minX * scale,
    y: padding + (availableH - bounds.height * scale) / 2 - bounds.minY * scale
  };
}

function panelInset() {
  const panel = byId('node-panel');
  if (!panel || panel.hidden) return 0;
  const width = panel.getBoundingClientRect?.().width || 0;
  const canvasWidth = byId('canvas')?.getBoundingClientRect?.().width || 0;
  if (width >= 2 && canvasWidth >= 2 && width < canvasWidth - 1) return width;
  return PANEL_WIDTH;
}

function fitView() {
  if (!draft?.nodes?.length) return false;
  ensurePositions();
  const rect = byId('canvas')?.getBoundingClientRect?.() || { width: 0, height: 0 };
  const width = Math.max(0, rect.width - panelInset());
  if (width < 2 || rect.height < 2) return false;
  const bounds = graphBounds();
  if (!bounds) return false;
  const next = computeFit(bounds, width, rect.height);
  viewport.scale = next.scale;
  viewport.x = next.x;
  viewport.y = next.y;
  applyViewport();
  saveLayoutSoon();
  return true;
}

function scheduleFitView() {
  clearTimeout(resizeFitTimer);
  resizeFitTimer = setTimeout(() => {
    if (draft?.nodes?.length) fitView();
  }, 150);
}

function captureHistory({ reset = false } = {}) {
  const snapshot = JSON.stringify({ draft, positions: Object.fromEntries(positions) });
  if (reset) {
    history = [snapshot];
    historyIndex = 0;
  } else if (history[historyIndex] !== snapshot) {
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot);
    historyIndex = history.length - 1;
  }
  renderWiringBar();
}

function restoreHistory(index) {
  if (index < 0 || index >= history.length) return;
  historyIndex = index;
  const snapshot = JSON.parse(history[index]);
  draft = snapshot.draft;
  positions = new Map(Object.entries(snapshot.positions));
  if (!draft.nodes.some((node) => node.id === selectedId)) selectedId = null;
  renderGraph();
  validateDraft();
  saveLayoutSoon();
  renderWiringBar();
}

function saveLayoutSoon() {
  clearTimeout(layoutTimer);
  if (!loadedRecipeId || draft.id !== loadedRecipeId) return;
  layoutTimer = setTimeout(async () => {
    try {
      await api('/api/layout', {
        method: 'PUT',
        body: JSON.stringify({ recipeId: loadedRecipeId, layout: layoutPayload() })
      });
    } catch {
      // Canvas work remains in memory and install still submits the layout.
    }
  }, 350);
}

function edgeSignature(recipe) {
  return (recipe?.edges || [])
    .map((edge) => `${edge.from}->${edge.to}`)
    .sort()
    .join('|');
}

function rememberLoadedWiring() {
  loadedEdges = structuredClone(draft?.edges || []);
  loadedEdgeSignature = edgeSignature({ edges: loadedEdges });
}

function wiringChangeCount() {
  const loaded = new Set(loadedEdgeSignature ? loadedEdgeSignature.split('|').filter(Boolean) : []);
  const current = new Set((draft?.edges || []).map((edge) => `${edge.from}->${edge.to}`));
  let count = 0;
  for (const edge of current) if (!loaded.has(edge)) count += 1;
  for (const edge of loaded) if (!current.has(edge)) count += 1;
  return count;
}

function issueText(issue) {
  const code = issue?.code ? String(issue.code) : '';
  const message = issue?.message ? String(issue.message) : '';
  if (code && message) return `${code}: ${message}`;
  return code || message;
}

function validationSummary(state = validationState) {
  const parts = (state.issues || []).map(issueText).filter(Boolean);
  for (const code of state.extraCodes || []) {
    if (code && !parts.some((part) => part.includes(code))) parts.push(code);
  }
  return parts.join('; ');
}

function issuesFromPayload(payload) {
  const validation = payload?.validation;
  const messages = Array.isArray(validation?.errors) ? validation.errors.map(String) : [];
  const codes = Array.isArray(validation?.codes) ? validation.codes.filter(Boolean).map(String) : [];
  if (!messages.length) {
    if (payload?.error || payload?.code) {
      return {
        issues: [{ message: String(payload.error || ''), code: String(payload.code || '') }],
        extraCodes: []
      };
    }
    return { issues: [{ message: 'Validation failed', code: '' }], extraCodes: [] };
  }
  if (codes.length === messages.length) {
    return {
      issues: messages.map((message, index) => ({ message, code: codes[index] || '' })),
      extraCodes: []
    };
  }
  return { issues: messages.map((message) => ({ message, code: '' })), extraCodes: codes };
}

function assignInvalidEdges(issues) {
  edgeIssues = new Map();
  const loaded = new Set(loadedEdgeSignature ? loadedEdgeSignature.split('|').filter(Boolean) : []);
  const dirtyIds = (draft?.edges || [])
    .filter((edge) => !loaded.has(`${edge.from}->${edge.to}`))
    .map((edge) => edge.id);
  const remember = (edgeId, issue) => {
    if (!edgeId) return;
    if (!edgeIssues.has(edgeId)) edgeIssues.set(edgeId, []);
    const list = edgeIssues.get(edgeId);
    if (!list.some((item) => item.code === issue.code && item.message === issue.message)) list.push(issue);
  };
  for (const issue of issues) {
    const message = issue.message || '';
    let matched = false;
    for (const edge of draft?.edges || []) {
      if ((edge.id && message.includes(edge.id)) || message.includes(`${edge.from} -> ${edge.to}`)) {
        remember(edge.id, issue);
        matched = true;
      }
    }
    const typed = message.match(/^([a-z0-9-]+) must depend on ([a-z0-9-]+)/);
    if (typed) {
      const dependents = new Set((draft?.nodes || []).filter((node) => node.type === typed[1]).map((node) => node.id));
      const dependencies = new Set((draft?.nodes || []).filter((node) => node.type === typed[2]).map((node) => node.id));
      for (const edgeId of dirtyIds) {
        const edge = draft.edges.find((item) => item.id === edgeId);
        if (!edge) continue;
        if (dependents.has(edge.to) || dependents.has(edge.from) || dependencies.has(edge.to) || dependencies.has(edge.from)) {
          remember(edge.id, issue);
          matched = true;
        }
      }
    }
    if (/must be a terminal node/.test(message)) {
      const token = message.split(' ')[0];
      const ids = new Set((draft?.nodes || []).filter((node) => node.type === token || node.id === token).map((node) => node.id));
      for (const edge of draft?.edges || []) {
        if (ids.has(edge.from)) {
          remember(edge.id, issue);
          matched = true;
        }
      }
    }
    if (!matched && dirtyIds.length === 1) remember(dirtyIds[0], issue);
  }
  invalidEdgeIds = new Set(edgeIssues.keys());
}

function renderWiringBar() {
  const changes = draft ? wiringChangeCount() : 0;
  const bar = byId('wiring-bar');
  if (bar) bar.hidden = changes === 0;
  const count = byId('wiring-count');
  if (count) count.textContent = `${changes} wiring change${changes === 1 ? '' : 's'}`;
  const pill = byId('wiring-pill');
  if (pill) {
    const short = validationState.hash ? String(validationState.hash).slice(0, 8) : '';
    const status = validationState.status;
    pill.className = `wiring-pill ${status === 'valid' ? 'valid' : status === 'invalid' ? 'invalid' : 'pending'}`;
    if (status === 'valid') pill.textContent = short ? `Valid ${short}` : 'Valid';
    else if (status === 'invalid') pill.textContent = short ? `Invalid ${short}` : 'Invalid';
    else pill.textContent = 'Checking';
  }
  const error = byId('wiring-error');
  if (error) {
    // CSS clamps this to two lines; the full compiler output stays in the tooltip.
    const full = validationState.status === 'invalid' ? validationSummary() : '';
    error.textContent = full;
    if (error.setAttribute) error.setAttribute('title', full);
  }
  const save = byId('save-wiring');
  if (save) save.disabled = changes === 0 || validationState.status !== 'valid';
  const undo = byId('undo');
  const redo = byId('redo');
  if (undo) undo.disabled = historyIndex <= 0;
  if (redo) redo.disabled = historyIndex >= history.length - 1;
}

function discardWiring() {
  if (!draft) return;
  draft.edges = structuredClone(loadedEdges);
  syncDependencies();
  selectedEdgeId = null;
  invalidEdgeIds = new Set();
  edgeIssues = new Map();
  captureHistory();
  renderGraph();
  validateDraft();
}

function clearInvalidEdges() {
  invalidEdgeIds = new Set();
  edgeIssues = new Map();
}

async function validateDraft() {
  const sequence = ++validationSequence;
  validationState = { status: 'pending', hash: '', issues: [], extraCodes: [] };
  renderWiringBar();
  try {
    const result = await api('/api/validate', {
      method: 'POST',
      body: JSON.stringify({ recipe: draft, baseRecipeId: loadedRecipeId })
    });
    if (sequence !== validationSequence) return result;
    const hash = result.plans[0].graphHash;
    validationState = { status: 'valid', hash, issues: [], extraCodes: [] };
    clearInvalidEdges();
    byId('review-data').textContent = JSON.stringify({
      recipe: draft.id,
      version: draft.version,
      modes: result.plans.map((plan) => plan.mode),
      nodes: draft.nodes.length,
      graphHashes: result.plans.map((plan) => plan.graphHash)
    }, null, 2);
    renderWiringBar();
    renderEdges();
    return result;
  } catch (error) {
    if (sequence !== validationSequence) return null;
    const parsed = issuesFromPayload(error.payload);
    validationState = { status: 'invalid', hash: '', issues: parsed.issues, extraCodes: parsed.extraCodes };
    assignInvalidEdges(parsed.issues);
    renderWiringBar();
    renderEdges();
    return null;
  }
}

function parseGoalCriteria(value) {
  return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [statement, evidenceRequired, ...failures] = line.split('|').map((part) => part.trim());
    return {
      id: `AC-${index + 1}`,
      statement,
      evidenceRequired,
      failureCases: failures.filter(Boolean)
    };
  });
}

function goalContractFromForm(runId) {
  return {
    schemaVersion: 1,
    runId,
    objective: byId('goal-text').value.trim(),
    acceptanceCriteria: parseGoalCriteria(byId('goal-criteria').value)
  };
}

function validateGoalForm(contract) {
  if (!byId('goal-task').value.trim()) return 'Task is required.';
  if (!contract.objective) return 'Goal objective is required.';
  if (!contract.acceptanceCriteria.length) return 'Add at least one acceptance failure-table row.';
  for (const criterion of contract.acceptanceCriteria) {
    if (!criterion.statement || !criterion.evidenceRequired || !criterion.failureCases.length) {
      return `${criterion.id} must contain statement | evidence required | failure case.`;
    }
  }
  return '';
}

async function ensureStudioRun() {
  if (activeRunId && catalog.live?.run && !TERMINAL_RUN_STATES.has(catalog.live.run.state)) {
    return activeRunId;
  }
  const task = byId('goal-task').value.trim();
  const request = {
    task,
    constraints: formField('goal-constraints').value.trim(),
    displayName: formField('goal-run-name').value.trim(),
    recipeId: loadedRecipeId,
    mode: draft.compatibleModes.includes('ASSISTED') ? 'ASSISTED' : draft.compatibleModes[0]
  };
  let created;
  try {
    created = await api('/api/runs', {
      method: 'POST',
      body: JSON.stringify(request)
    });
  } catch (error) {
    if (error.payload?.code !== 'ACTIVE_RUN' || !error.payload.activeRun) throw error;
    const action = await resolveActiveRunConflict(error.payload.activeRun);
    if (action !== 'replace') return null;
    await api(`/api/runs/${encodeURIComponent(error.payload.activeRun.runId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({
        actor: 'human',
        reason: 'Ended in Studio before creating a new Goal'
      })
    });
    created = await api('/api/runs', {
      method: 'POST',
      body: JSON.stringify(request)
    });
  }
  activeRunId = created.run.runId;
  renderHandoffState();
  await loadLive(activeRunId);
  await loadRuns();
  return activeRunId;
}

function resolveActiveRunConflict(run) {
  return new Promise((resolve) => {
    const dialog = byId('active-run-dialog');
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    byId('active-run-message').textContent = `${run.displayName || run.runId} · ${run.state}`;
    byId('continue-active-run').onclick = async () => {
      activeRunId = run.runId;
      selectedCheckoutRun = run.runId;
      pinnedRunId = run.runId;
      renderHandoffState();
      byId('goal-dialog').close();
      showWorkspace('live');
      await loadLive(run.runId);
      finish('continue');
      dialog.close();
    };
    byId('cancel-active-run-conflict').onclick = () => {
      dialog.close();
    };
    byId('replace-active-run').onclick = () => {
      finish('replace');
      dialog.close();
    };
    dialog.addEventListener('close', () => finish('cancel'), { once: true });
    dialog.showModal();
  });
}

async function saveGoalFromForm() {
  try {
    const task = byId('goal-task').value.trim();
    if (!byId('goal-text').value.trim()) byId('goal-text').value = task;
    if (!byId('goal-criteria').value.trim()) {
      byId('goal-criteria').value = [
        'Requested outcome works in its real workflow | Tests and Run-bound evidence demonstrate the result | The requested outcome is unavailable or misleading',
        'Existing behavior remains reliable | Compatibility checks pass | A supported existing workflow regresses'
      ].join('\n');
    }
    const provisional = goalContractFromForm(activeRunId || 'pending');
    const error = validateGoalForm(provisional);
    if (error) {
      byId('goal-validation').textContent = error;
      return null;
    }
    const runId = await ensureStudioRun();
    if (!runId) return null;
    const contract = goalContractFromForm(runId);
    const saved = await api(`/api/runs/${encodeURIComponent(runId)}/goal`, {
      method: 'PUT',
      body: JSON.stringify({
        goal: contract,
        actor: 'studio-user',
        expectedRevision: goal.draftRevision
      })
    });
    goal = {
      text: contract.objective,
      criteria: contract.acceptanceCriteria,
      version: goal.version,
      frozen: false,
      draftRevision: saved.draft.metadata.revision,
      draftHash: saved.draft.metadata.contentHash
    };
    byId('goal-validation').textContent = '';
    notify('Goal draft saved. It is not frozen yet.');
    byId('goal-dialog').close();
    return contract;
  } catch (error) {
    byId('goal-validation').textContent = error.message;
    return null;
  }
}

function renderGoalState() {
  const state = byId('goal-state');
  state.className = `goal-state ${goal.frozen ? 'frozen' : 'draft'}`;
  state.textContent = goal.frozen
    ? `Frozen · version ${goal.version} · editing locked`
    : `Draft · version ${goal.version} · editing allowed`;
  byId('goal-text').disabled = goal.frozen;
  byId('goal-criteria').disabled = goal.frozen;
  byId('goal-task').disabled = goal.frozen;
  formField('goal-constraints').disabled = goal.frozen;
  formField('goal-run-name').disabled = goal.frozen;
  byId('save-goal').hidden = goal.frozen;
  byId('review-goal').hidden = goal.frozen;
  byId('confirm-freeze').hidden = true;
  byId('unfreeze-goal').hidden = !goal.frozen;
}

async function reviewGoal() {
  const contract = await saveGoalFromForm();
  if (!contract) return;
  byId('goal-dialog').showModal();
  byId('goal-advanced').open = true;
  byId('goal-review').hidden = false;
  byId('goal-review').innerHTML = `
    <strong>${escapeHtml(contract.objective)}</strong>
    <p class="mono">Revision ${escapeHtml(String(goal.draftRevision))} · ${escapeHtml(goal.draftHash)}</p>
    <details>
      <summary>Review all ${contract.acceptanceCriteria.length} criteria</summary>
      <ol>${contract.acceptanceCriteria.map((criterion) => `
        <li>
          <strong>${escapeHtml(criterion.id)} · ${escapeHtml(criterion.statement)}</strong>
          <p>Evidence: ${escapeHtml(criterion.evidenceRequired)}</p>
          <p>Failure cases: ${criterion.failureCases.map(escapeHtml).join(' · ')}</p>
        </li>
      `).join('')}</ol>
    </details>
  `;
  byId('confirm-freeze').hidden = false;
}

async function freezeGoalFromForm() {
  try {
    const result = await api(`/api/runs/${encodeURIComponent(activeRunId)}/goal/freeze`, {
      method: 'POST',
      body: JSON.stringify({
        actor: 'studio-user',
        expectedRevision: goal.draftRevision,
        expectedHash: goal.draftHash
      })
    });
    catalog.live = catalog.live || {};
    catalog.live.run = result.run;
    goal = {
      text: byId('goal-text').value.trim(),
      criteria: parseGoalCriteria(byId('goal-criteria').value),
      version: result.run.goal.version,
      frozen: true
    };
    renderGoalState();
    renderGraph();
    notify('Goal frozen with an integrity-bound version.');
    byId('goal-dialog').close();
  } catch (error) {
    byId('goal-validation').textContent = error.message;
  }
}

async function unfreezeGoalFromForm() {
  const reason = byId('unfreeze-reason');
  if (reason.hidden) {
    reason.hidden = false;
    reason.focus?.();
    return;
  }
  try {
    const result = await api(`/api/runs/${encodeURIComponent(activeRunId)}/goal/unfreeze`, {
      method: 'POST',
      body: JSON.stringify({ actor: 'studio-user', reason: reason.value })
    });
    goal.frozen = false;
    goal.version = result.run.goal.version;
    reason.hidden = true;
    renderGoalState();
    renderGraph();
    notify('Goal unfrozen. Previous evidence remains bound to its prior version.');
    byId('goal-dialog').close();
  } catch (error) {
    byId('goal-validation').textContent = error.message;
  }
}

function syncGoalFromLive() {
  const liveGoal = catalog.live?.run?.goal;
  const nextRunId = catalog.live?.run?.runId || null;
  if (activeRunId !== nextRunId) {
    goal = { text: '', version: 1, frozen: false, draftRevision: 0, draftHash: null };
    hydratedGoalKey = null;
  }
  activeRunId = nextRunId;
  renderHandoffState();
  if (liveGoal) {
    goal.version = liveGoal.version || goal.version;
    goal.frozen = Boolean(liveGoal.frozen);
  }
  renderGoalState();
}

async function copyAgentHandoff(runId = activeRunId) {
  const created = runId || await ensureStudioRun();
  if (!created) return;
  try {
    const result = await api(`/api/runs/${encodeURIComponent(created)}/agent-handoff`);
    const text = result.handoff?.prompt || result.handoff?.brief || JSON.stringify(result.handoff, null, 2);
    await navigator.clipboard.writeText(text);
    handoffCopiedRunId = created;
    renderHandoffState();
    notify('Agent handoff copied.');
  } catch (error) {
    notify(error.message);
  }
}

function renderHandoffState() {
  const copied = Boolean(handoffCopiedRunId && handoffCopiedRunId === activeRunId);
  byId('agent-handoff-state').hidden = !copied;
  byId('agent-handoff-instructions').textContent = copied
    ? 'Paste it once into your current AI Agent terminal, then keep Studio open to follow persisted progress.'
    : '';
  byId('start-agent').textContent = copied ? 'Copy again' : 'Start with AI Agent';
}

function showWorkspace(section) {
  if (section === 'workflows') section = 'wiring';
  workspace = section;
  const live = section === 'live';
  const showingRuns = section === 'runs';
  const wiring = section === 'wiring';
  byId('live-view').hidden = !live;
  byId('runs-view').hidden = !showingRuns;
  byId('canvas').hidden = !wiring;
  byId('show-live').classList.toggle('active', live);
  byId('show-runs').classList.toggle('active', showingRuns);
  byId('show-wiring').classList.toggle('active', wiring);
  byId('show-live').setAttribute('aria-current', live ? 'page' : 'false');
  byId('show-runs').setAttribute('aria-current', showingRuns ? 'page' : 'false');
  byId('show-wiring').setAttribute('aria-current', wiring ? 'page' : 'false');
  if (showingRuns) loadRuns();
  if (wiring) renderGraph();
}

async function loadRuns() {
  const query = byId('run-search')?.value.trim() || '';
  try {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    const result = await api(`/api/runs${params.size ? `?${params}` : ''}`);
    runs = result.runs;
    const list = byId('run-list');
    if (!runs.length) {
      list.innerHTML = '<div class="empty-state"><h2>No runs found</h2><p>Create a task from the Goal sheet.</p></div>';
    } else {
      const active = runs.find((run) => !TERMINAL_RUN_STATES.has(run.status));
      const historyRuns = runs.filter((run) => run.runId !== active?.runId);
      const row = (run, isActive = false) => `
        <button class="run-row${isActive ? ' active-run-row' : ''}" data-run-id="${escapeHtml(run.runId)}">
          <strong>${escapeHtml(run.displayName)}</strong>
          <span>${escapeHtml(run.status)} · ${timeTag(run.updatedAt) || '—'}</span>
          <small>${escapeHtml(run.task)}</small>
        </button>`;
      list.innerHTML = [
        active ? `<div class="run-list-label"><i></i>Active now</div>${row(active, true)}` : '',
        `<div class="run-list-label history-label">History</div>`,
        historyRuns.length
          ? historyRuns.map((run) => row(run)).join('')
          : '<p class="muted run-list-empty">Completed Runs will stay here.</p>'
      ].join('');
      list.querySelectorAll('.run-row').forEach((button) => {
        button.onclick = () => {
          pinnedRunId = button.dataset.runId;
          selectedCheckoutRun = pinnedRunId;
          showWorkspace('live');
          loadLive(pinnedRunId);
        };
      });
    }
    if (result.corrupt.length) {
      list.insertAdjacentHTML('beforeend', `<p class="validation-message">${result.corrupt.length} corrupt run record(s) were isolated.</p>`);
    }
  } catch (error) {
    byId('run-list').innerHTML = `<p class="validation-message">${escapeHtml(error.message)}</p>`;
  }
}

function heartbeatAge(iso, now = Date.now()) {
  if (!iso) return 'no heartbeat';
  return humanizeTime(iso, now) || 'no heartbeat';
}

function currentStageId(live) {
  const nodes = live?.nodes || {};
  const running = Object.entries(nodes).find(([, node]) => node?.status === 'RUNNING');
  if (running) {
    const type = live.plan?.nodes?.find((node) => node.id === running[0])?.type;
    const stage = STAGES.find((item) => item.types.includes(type));
    if (stage) return stage.id;
  }
  const journey = live?.journey?.current;
  if (journey) {
    const match = STAGES.find((item) => item.id === String(journey).toLowerCase()
      || item.label === String(journey).toLowerCase());
    if (match) return match.id;
  }
  return STAGES[0].id;
}

function scheduleLiveRender() {
  if (liveRenderScheduled) return;
  liveRenderScheduled = true;
  const schedule = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame.bind(window)
    : (callback) => setTimeout(callback, 16);
  schedule(() => {
    liveRenderScheduled = false;
    renderLive();
    refreshWiringLive();
  });
}

function textOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function shown(value) {
  return value == null || value === '' ? '—' : String(value);
}

function summaryFact(label, value) {
  return `<div class="summary-fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(shown(value))}</strong></div>`;
}

function deliveryDestination(live) {
  const artifacts = live?.artifacts || {};
  const delivery = (live?.plan?.nodes || []).find((node) => node.type === 'delivery');
  const runtime = delivery ? live.nodes?.[delivery.id] : null;
  return textOrNull(live?.run?.destination)
    || textOrNull(live?.run?.delivery?.destination)
    || textOrNull(artifacts['artifact.delivery']?.destination)
    || textOrNull(runtime?.destination)
    || textOrNull(runtime?.output?.destination);
}

function approverName(live) {
  const artifacts = live?.artifacts || {};
  const approval = (live?.plan?.nodes || []).find((node) => node.type === 'approval');
  const runtime = approval ? live.nodes?.[approval.id] : null;
  return textOrNull(runtime?.approvedBy)
    || textOrNull(live?.run?.approvedBy)
    || textOrNull(live?.run?.approver)
    || textOrNull(artifacts['artifact.delivery']?.approvedBy)
    || textOrNull(artifacts['artifact.verdict']?.approvedBy);
}

function completedRunDurationMs(live) {
  const start = Date.parse(live?.run?.createdAt);
  if (!Number.isFinite(start)) return null;
  const nodeTimes = Object.values(live?.nodes || {})
    .map((node) => Date.parse(node?.updatedAt))
    .filter(Number.isFinite);
  const lastNode = nodeTimes.length ? Math.max(...nodeTimes) : NaN;
  const delivery = [
    live?.run?.deliveredAt,
    live?.run?.deliveryAt,
    live?.run?.delivery?.at,
    live?.artifacts?.['artifact.delivery']?.at
  ].map((value) => Date.parse(value)).find(Number.isFinite);
  const end = Number.isFinite(delivery) ? delivery : lastNode;
  if (!Number.isFinite(end)) {
    const updated = Date.parse(live?.run?.updatedAt);
    if (!Number.isFinite(updated)) return null;
    return Math.max(0, updated - start);
  }
  return Math.max(0, end - start);
}

function verificationLabel(summary) {
  if (!summary || typeof summary !== 'object') return null;
  const failed = Number(summary.failed);
  const total = Number(summary.commandCount);
  if (!Number.isFinite(failed) || !Number.isFinite(total)) return null;
  return `${Math.max(0, total - failed)} passed / ${failed} failed`;
}

function findingsLabel(summary) {
  if (!summary || typeof summary !== 'object') return null;
  if (summary.count == null && summary.blocking == null) return null;
  return `${summary.count ?? '—'} / ${summary.blocking ?? '—'}`;
}

function driftLabel(summary) {
  if (!summary || typeof summary !== 'object' || summary.outOfMapCount == null) return null;
  const count = Number(summary.outOfMapCount);
  if (!Number.isFinite(count)) return null;
  return count === 0 ? 'none' : `${count} out of map`;
}

function receiptLabel(summary) {
  if (!summary || summary.present === false) return 'missing';
  if (summary.verified === true && !(summary.problems || []).length) return 'verified';
  if (Array.isArray(summary.problems) && summary.problems.length) return 'problems';
  if (summary.verified === false) return 'problems';
  return 'missing';
}

function tokenLabel(live) {
  const raw = live?.budget?.totalTokens ?? live?.budget?.spentThisRun ?? live?.run?.totalTokens ?? live?.run?.tokens;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 'unknown';
  return String(value);
}

function tokenBudgetLabel(live) {
  const tokens = tokenLabel(live);
  const limit = Number(live?.budget?.perRunTokenLimit);
  if (Number.isFinite(limit) && limit > 0) return `${tokens} / ${limit}`;
  return tokens;
}

function guardChipValue(summary) {
  if (!summary || typeof summary !== 'object') return 'unknown';
  if (summary.warn == null && summary.block == null) return 'unknown';
  return `${summary.warn || 0} warn · ${summary.block || 0} block`;
}

function receiptChipValue(live) {
  const receipt = live?.artifacts?.['artifact.receipt'];
  const terminal = live?.run?.state === 'DELIVERED' || live?.run?.state === 'REPORTED';
  if (receipt?.verified === true && !(receipt.problems || []).length) {
    return { value: 'verified', title: 'receipt recorded' };
  }
  if (receipt && Array.isArray(receipt.problems) && receipt.problems.length) {
    return { value: 'problems', title: receipt.problems.join(', ') };
  }
  if (terminal && (!receipt || receipt.present === false)) {
    return { value: 'missing', title: 'no receipt: run predates receipts' };
  }
  return { value: 'pending', title: 'receipt pending' };
}

function labeledChip(label, value, title) {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<span class="chip"${titleAttr}><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></span>`;
}

function liveMetaHtml(live) {
  const run = live?.run || {};
  const artifacts = live?.artifacts || {};
  const tokens = tokenLabel(live);
  const receipt = receiptChipValue(live);
  return [
    labeledChip('Tier', run.tier?.current || run.mode || '—'),
    labeledChip('Iteration', run.iteration ?? '—'),
    labeledChip('Tokens', tokenBudgetLabel(live), tokens === 'unknown' ? 'host reports no usage' : ''),
    labeledChip('Guard', guardChipValue(artifacts['artifact.guard'])),
    labeledChip('Drift', driftLabel(artifacts['artifact.drift']) || 'unknown'),
    labeledChip('Receipt', receipt.value, receipt.title)
  ].join('');
}

function renderRunSummary() {
  const card = byId('run-summary-card');
  if (!card) return;
  const live = catalog.live;
  const state = live?.run?.state;
  if (!live?.run || !TERMINAL_RUN_STATES.has(state)) {
    card.hidden = true;
    card.innerHTML = '';
    return;
  }
  const artifacts = live.artifacts || liveArtifacts || {};
  const duration = formatDuration(completedRunDurationMs(live));
  card.hidden = false;
  card.innerHTML = `<div class="summary-facts">${[
    summaryFact('State', state),
    summaryFact('Destination', deliveryDestination(live)),
    summaryFact('Verdict', textOrNull(artifacts['artifact.verdict']?.verdict) || textOrNull(live.run?.verdict)),
    summaryFact('Approver', approverName(live)),
    summaryFact('Duration', duration || null),
    summaryFact('Tests', verificationLabel(artifacts['artifact.verification'])),
    summaryFact('Findings', findingsLabel(artifacts['artifact.findings'])),
    summaryFact('Drift', driftLabel(artifacts['artifact.drift'])),
    summaryFact('Receipt', receiptLabel(artifacts['artifact.receipt'])),
    summaryFact('Tokens', tokenLabel(live))
  ].join('')}</div>`;
}

function refreshWiringLive() {
  if (workspace !== 'wiring' || !draft || interaction || connection) return;
  renderGraph({ live: true });
}

function renderLive() {
  renderRunSummary();
  const live = catalog.live;
  const summary = byId('run-summary');
  const rail = byId('stage-rail');
  const journey = byId('run-journey');
  const meta = byId('live-meta');
  const banner = byId('live-view')?.querySelector?.('.pending-banner');
  if (!live) {
    if (summary) summary.textContent = 'No active run';
    if (rail) {
      rail.innerHTML = STAGES.map((stage) => `<li class="pending">${escapeHtml(stage.label)}</li>`).join('');
    }
    if (meta) meta.innerHTML = '';
    if (banner) {
      banner.hidden = true;
      banner.innerHTML = '';
    }
    if (journey) journey.innerHTML = '';
    return;
  }
  const stageId = currentStageId(live);
  const run = live.run || {};
  const presence = live.presence || agentPresence;
  if (summary) {
    const beat = presence?.lastHeartbeatAt
      ? timeTag(presence.lastHeartbeatAt)
      : escapeHtml(heartbeatAge(presence.lastHeartbeatAt));
    summary.innerHTML = `${escapeHtml(run.displayName || run.runId || 'run')} · ${escapeHtml(run.state || '')} · ${beat || escapeHtml(heartbeatAge(presence.lastHeartbeatAt))}`;
  }
  if (rail) {
    rail.innerHTML = STAGES.map((stage) => {
      const current = stage.id === stageId;
      return `<li class="${current ? 'active' : 'pending'}">${escapeHtml(stage.label)}</li>`;
    }).join('');
  }
  if (meta) meta.innerHTML = liveMetaHtml(live);
  const pending = live.interactions?.pending || [];
  if (banner) {
    banner.hidden = pending.length === 0;
    banner.innerHTML = pending.map((question) =>
      `<p><strong>Q${escapeHtml(String(question.number))}</strong> ${escapeHtml(question.message)}</p>`
    ).join('');
  }
  const journeyStatuses = new Set(['pending', 'active', 'complete']);
  const degradedSources = live.journey?.degradedSources || [];
  const timeline = (live.journey?.steps || []).map((step) => {
    const status = String(step?.status || '').toLowerCase();
    const safeStatus = journeyStatuses.has(status) ? status : 'unknown';
    const label = String(step?.id || '').replaceAll('_', ' ');
    const suffix = safeStatus === 'unknown' ? ' (status unavailable)' : '';
    const blocked = step?.blocked
      ? (live.journey?.pendingQuestions == null
          ? ' · unanswered count unavailable'
          : ` · ${Number(live.journey.pendingQuestions)} unanswered`)
      : '';
    return `<li class="${safeStatus}">${escapeHtml(label + suffix + blocked)}</li>`;
  }).join('');
  const eventsHtml = (lifecycleEvents.slice(-8).reverse().map((event) =>
    `<li class="event">${timeTag(event.at) || '—'} · ${escapeHtml(event.type)} · ${escapeHtml(event.message || '')}</li>`
  ).join(''));
  if (journey) {
    journey.innerHTML = timeline + eventsHtml + (degradedSources.length
      ? `<li class="unknown">${escapeHtml(`${degradedSources.join(' and ')} unavailable — journey may be incomplete`)}</li>`
      : '');
  }
}

function maybeOpenOnboarding() {
  const dialog = byId('goal-dialog');
  if (!eventsReady || catalog.live || dialog.open || onboardingDismissed) return;
  dialog.showModal();
}

function setConnectionLost(lost, message) {
  byId('live-connection-state').hidden = !lost;
  byId('live-connection-message').textContent = lost
    ? (message || 'Studio connection lost. Your last valid Run view is preserved.')
    : '';
}

function followedRunId() {
  return pinnedRunId || catalog.currentRunId || catalog.live?.run?.runId || null;
}

function eventTouchesFollowed(event) {
  const followed = followedRunId();
  if (!followed) return true;
  if (!event.runId) return true;
  return event.runId === followed;
}

async function loadLive(runId) {
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : '';
  const result = await api(`/api/live${query}`);
  catalog.live = result.live;
  liveArtifacts = result.live?.artifacts || {};
  lifecycleEvents = result.live?.lifecycle?.events || lifecycleEvents;
  agentPresence = result.live?.presence || agentPresence;
  syncGoalFromLive();
  renderLive();
  if (workspace === 'wiring') renderGraph();
  return result.live;
}

function applyEvent(event) {
  if (!event || event.type === 'hello') return;
  if (event.type === 'resync') {
    resync();
    return;
  }
  lastEventSeq = Math.max(lastEventSeq, Number(event.seq) || 0);
  if (event.type === 'current.changed') {
    catalog.currentRunId = event.payload?.runId || event.runId;
    if (!pinnedRunId) loadLive(catalog.currentRunId).then(() => maybeOpenOnboarding()).catch(() => {});
    return;
  }
  if (!eventTouchesFollowed(event) && event.type !== 'run.created') return;
  if (event.type === 'run.created' || event.type === 'run.state') {
    if (catalog.live?.run && event.runId === catalog.live.run.runId) {
      Object.assign(catalog.live.run, event.payload || {});
    }
    if (event.type === 'run.created' && !catalog.live) loadLive(event.runId).catch(() => {});
  } else if (event.type === 'lifecycle') {
    const incoming = event.payload?.events || [];
    lifecycleEvents = lifecycleEvents.concat(incoming).slice(-100);
    if (event.payload?.presence) agentPresence = event.payload;
    else if (catalog.live) catalog.live.lifecycle = event.payload;
    applyLifecycleNodes(incoming);
  } else if (event.type === 'presence') {
    agentPresence = event.payload || agentPresence;
    if (catalog.live) catalog.live.presence = agentPresence;
  } else if (String(event.type).startsWith('artifact.')) {
    liveArtifacts[event.type] = event.payload;
    if (catalog.live) {
      catalog.live.artifacts = catalog.live.artifacts || {};
      catalog.live.artifacts[event.type] = event.payload;
    }
  }
  scheduleLiveRender();
}

const LIVE_NODE_STATUSES = new Set(['PENDING', 'READY', 'RUNNING', 'PASSED', 'FAILED', 'SKIPPED', 'BLOCKED', 'WAITING']);

function applyLifecycleNodes(events) {
  if (!catalog.live) return;
  catalog.live.nodes = catalog.live.nodes || {};
  for (const item of events || []) {
    const status = String(item?.status || '').toUpperCase();
    if (!item?.nodeId || !LIVE_NODE_STATUSES.has(status)) continue;
    const current = catalog.live.nodes[item.nodeId] || {};
    catalog.live.nodes[item.nodeId] = {
      ...current,
      status,
      ...(item.at ? { updatedAt: item.at } : {})
    };
  }
}

function parseSseBlock(block) {
  let type = 'message';
  let data = '';
  let id = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
    else if (line.startsWith('id:')) id = line.slice(3).trim();
  }
  if (!data) return { type, event: null, id };
  try {
    return { type, event: JSON.parse(data), id };
  } catch {
    return { type, event: null, id };
  }
}

function dispatchSse(buffer) {
  const parts = buffer.split('\n\n');
  const rest = parts.pop();
  for (const block of parts) {
    if (!block.trim()) continue;
    const parsed = parseSseBlock(block);
    if (parsed.type === 'hello' && parsed.event) {
      catalog.watchMode = parsed.event.mode || catalog.watchMode;
      catalog.root = parsed.event.root || catalog.root;
      catalog.currentRunId = parsed.event.currentRunId;
      lastEventSeq = parsed.event.seq || lastEventSeq;
      eventsReady = true;
      reconnectAttempt = 0;
      resumeFallbackUsed = false;
      clearReconnectTimer();
      setConnectionLost(false);
      updateChrome();
      maybeOpenOnboarding();
      continue;
    }
    if (parsed.event) applyEvent(parsed.event);
  }
  return rest;
}

async function consumeEvents(signal) {
  const params = lastEventSeq > 0 ? `?after=${encodeURIComponent(lastEventSeq)}` : '';
  const headers = lastEventSeq > 0 ? { 'Last-Event-ID': String(lastEventSeq) } : {};
  const response = await fetch(`/api/events${params}`, { signal, headers });
  if (!response.ok) {
    const error = new Error('Studio event stream failed');
    error.code = lastEventSeq > 0 ? 'EVENT_RESUME_FAILED' : 'EVENT_STREAM_FAILED';
    throw error;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = dispatchSse(buffer);
  }
  throw new Error('event stream ended');
}

function clearReconnectTimer() {
  if (reconnectTimer == null) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect() {
  if (reconnectTimer != null) return;
  setConnectionLost(true);
  const delay = RECONNECT_BACKOFF_MS[Math.min(reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startEventStream();
  }, delay);
  reconnectTimer?.unref?.();
}

function startEventStream() {
  if (typeof AbortController !== 'function') {
    setConnectionLost(true, 'Studio connection lost. Your last valid Run view is preserved.');
    return;
  }
  if (eventAbort) eventAbort.abort();
  eventAbort = new AbortController();
  consumeEvents(eventAbort.signal).catch((error) => {
    if (error?.name === 'AbortError') return;
    if (error?.code === 'EVENT_RESUME_FAILED' && !resumeFallbackUsed) {
      resumeFallbackUsed = true;
      resync();
      return;
    }
    scheduleReconnect();
  });
}

async function resync() {
  clearReconnectTimer();
  reconnectAttempt = 0;
  try {
    const result = await api('/api/bootstrap');
    catalog = { ...catalog, ...result };
    liveArtifacts = result.live?.artifacts || liveArtifacts;
    lifecycleEvents = result.live?.lifecycle?.events || lifecycleEvents;
    agentPresence = result.live?.presence || agentPresence;
    lastEventSeq = result.eventSeq || lastEventSeq;
    eventsReady = true;
    setConnectionLost(false);
    updateChrome();
    syncGoalFromLive();
    renderLive();
    maybeOpenOnboarding();
    startEventStream();
    return true;
  } catch {
    setConnectionLost(true);
    scheduleReconnect();
    return false;
  }
}

function updateChrome() {
  if (byId('watched-root')) byId('watched-root').textContent = catalog.root || '—';
  if (byId('live-mode')) byId('live-mode').textContent = `live: ${catalog.watchMode || 'watch'}`;
}

async function loadRecipe() {
  const id = byId('recipe').value;
  const [result, saved] = await Promise.all([
    api(`/api/recipe?id=${encodeURIComponent(id)}`),
    api(`/api/layout?id=${encodeURIComponent(id)}`)
  ]);
  draft = normalizeDraftGraph(structuredClone(result.recipe));
  source = result.source;
  loadedRecipeId = draft.id;
  rememberLoadedWiring();
  selectedId = null;
  selectedIds.clear();
  selectedEdgeId = null;
  positions = new Map(Object.entries(saved.layout?.positions || {}));
  ensurePositions();
  viewport = saved.layout?.viewport || { x: 0, y: 0, scale: 1 };
  hasFitted = false;
  renderGraph();
  captureHistory({ reset: true });
  await validateDraft();
}

async function refreshCatalog(selectedRecipe) {
  const result = await api('/api/bootstrap');
  catalog = { ...catalog, ...result };
  updateChrome();
  const selector = byId('recipe');
  selector.innerHTML = catalog.recipes.map((recipe) => (
    `<option value="${escapeHtml(recipe.id)}">${escapeHtml(recipe.id)} · v${escapeHtml(recipe.version)}</option>`
  )).join('');
  if (selectedRecipe && catalog.recipes.some((recipe) => recipe.id === selectedRecipe)) selector.value = selectedRecipe;
  syncGoalFromLive();
  renderLive();
}

function closestReal(element, selector) {
  const node = element?.closest ? element : element?.parentElement;
  if (typeof node?.closest !== 'function') return null;
  const found = node.closest(selector);
  if (!found || typeof found.matches !== 'function' || !found.matches(selector)) return null;
  return found;
}

function runtimeFor(node) {
  if (!node) return null;
  return catalog.live?.nodes?.[node.id] || null;
}

function nodeSummary(node) {
  const runtime = runtimeFor(node) || {};
  const raw = runtime.activity || runtime.summary || node.summary || node.description || '';
  const line = String(raw).replace(/\s+/g, ' ').trim();
  if (!line) return '';
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

function nodeDepths() {
  const depths = new Map();
  const visiting = new Set();
  const depthFor = (node) => {
    if (!node) return 0;
    if (depths.has(node.id)) return depths.get(node.id);
    if (visiting.has(node.id)) return 0;
    visiting.add(node.id);
    const depth = (node.dependsOn || []).reduce((maximum, dependencyId) => {
      const dependency = draft.nodes.find((candidate) => candidate.id === dependencyId);
      return Math.max(maximum, dependency ? depthFor(dependency) + 1 : 0);
    }, 0);
    visiting.delete(node.id);
    depths.set(node.id, depth);
    return depth;
  };
  for (const node of draft?.nodes || []) depthFor(node);
  return depths;
}

function columnsByDepth() {
  const depths = nodeDepths();
  const columns = new Map();
  for (const node of draft?.nodes || []) {
    const depth = depths.get(node.id) || 0;
    if (!columns.has(depth)) columns.set(depth, []);
    columns.get(depth).push(node.id);
  }
  for (const column of columns.values()) {
    column.sort((left, right) => (positions.get(left)?.y ?? 0) - (positions.get(right)?.y ?? 0)
      || String(left).localeCompare(String(right)));
  }
  return columns;
}

function focusNode(nodeId) {
  nodeElements().find((element) => element.dataset.nodeId === nodeId)?.focus?.();
}

function clearSelection() {
  selectedId = null;
  selectedIds = new Set();
  selectedEdgeId = null;
  updateSelection();
  renderEdges();
}

function moveSelection(direction) {
  if (!draft?.nodes?.length) return null;
  const columns = columnsByDepth();
  const depths = [...columns.keys()].sort((left, right) => left - right);
  if (!depths.length) return null;
  const known = selectedId && draft.nodes.some((node) => node.id === selectedId);
  if (!known) {
    const first = columns.get(depths[0])[0];
    selectNode(first);
    focusNode(first);
    return first;
  }
  const depth = nodeDepths().get(selectedId) || 0;
  const column = columns.get(depth) || [];
  const row = Math.max(0, column.indexOf(selectedId));
  let next = null;
  if (direction === 'up') next = column[row - 1] || null;
  else if (direction === 'down') next = column[row + 1] || null;
  else {
    const depthIndex = depths.indexOf(depth);
    const neighborDepth = depths[depthIndex + (direction === 'right' ? 1 : -1)];
    if (neighborDepth == null) return selectedId;
    const neighbor = columns.get(neighborDepth) || [];
    next = neighbor[Math.min(row, neighbor.length - 1)] || null;
  }
  if (!next || next === selectedId) return selectedId;
  selectNode(next);
  focusNode(next);
  return next;
}

function scheduleTooltip(element) {
  clearTimeout(tooltipTimer);
  const nodeId = element?.dataset?.nodeId;
  tooltipTimer = setTimeout(() => {
    tooltipTimer = null;
    if (!nodeId || !draft?.nodes?.some((node) => node.id === nodeId)) return;
    const current = nodeElements().find((item) => item.dataset.nodeId === nodeId) || element;
    showTooltip(current);
  }, TOOLTIP_DELAY_MS);
}

function hideTooltip() {
  clearTimeout(tooltipTimer);
  tooltipTimer = null;
  if (nodeTooltip) nodeTooltip.hidden = true;
}

function showTooltip(element) {
  const node = draft?.nodes?.find((item) => item.id === element?.dataset?.nodeId);
  if (!node || !nodeTooltip) return;
  const index = draft.nodes.indexOf(node);
  const summary = nodeSummary(node);
  const lines = [
    `<strong>${escapeHtml(displayName(node))}</strong>`,
    `<span class="tooltip-type">${escapeHtml(node.type)} · ${escapeHtml(stageLabel(node, index))}</span>`,
    `<span class="tooltip-status">${escapeHtml(liveStatusText(node))}</span>`
  ];
  if (summary) lines.push(`<span class="tooltip-summary">${escapeHtml(summary)}</span>`);
  nodeTooltip.innerHTML = lines.join('');
  const canvasRect = byId('canvas')?.getBoundingClientRect?.() || { left: 0, top: 0, width: 0 };
  const rect = element.getBoundingClientRect?.() || { left: 0, bottom: 0 };
  const width = 240;
  const left = Math.max(8, Math.min(rect.left - canvasRect.left, Math.max(8, canvasRect.width - width - 8)));
  nodeTooltip.style.left = `${left}px`;
  nodeTooltip.style.top = `${rect.bottom - canvasRect.top + 8}px`;
  nodeTooltip.hidden = false;
}

function onNodeClick(event) {
  if (closestReal(event.target, '.port')) return;
  if (event.shiftKey || spacePressed || suppressNodeClick) {
    suppressNodeClick = false;
    return;
  }
  openNodePanel(event.currentTarget?.dataset?.nodeId);
}

function headerDuration(node, io) {
  if (io?.durationMs != null && io.durationMs !== '') {
    const formatted = formatDuration(Number(io.durationMs));
    if (formatted) return formatted;
  }
  const derived = formatDuration(nodeDurationMs(node?.id, catalog.live, draft));
  if (derived) return derived;
  const state = graphStateClass(runtimeFor(node)?.status);
  if (state !== 'passed' && state !== 'failed' && state !== 'active') return '';
  return formatDuration(legacyDurationMs(runtimeFor(node)));
}

function tabButton(id, label, badge = 0) {
  const selected = panelTab === id;
  const count = Number(badge) > 0 ? `<span class="tab-count">${escapeHtml(String(badge))}</span>` : '';
  return `<button type="button" role="tab" id="node-tab-${id}" class="io-tab" data-tab="${id}" aria-selected="${selected ? 'true' : 'false'}" aria-controls="node-pane-${id}" tabindex="${selected ? '0' : '-1'}">${label}${count}</button>`;
}

function evidenceCount(view) {
  const recorded = Number(view?.io?.nodeEvidence?.count);
  if (Number.isFinite(recorded) && recorded > 0) return recorded;
  const cards = view?.io?.nodeEvidence?.cards;
  return Array.isArray(cards) ? cards.length : 0;
}

function nodeLoopGroup(node) {
  if (!node) return null;
  return (draft?.loopGroups || []).find((group) =>
    (group?.nodeIds || []).includes(node.id)
    || group?.entryNodeId === node.id
    || group?.decisionNodeId === node.id
  ) || null;
}

function loopChipValue(node, io) {
  const group = nodeLoopGroup(node);
  const groupId = io?.output?.loopGroupId || group?.id;
  if (!groupId) return '';
  const iteration = io?.output?.loopIteration ?? io?.loopIteration;
  const max = group?.maxIterations;
  if (iteration == null && max == null) return groupId;
  const step = iteration == null ? '—' : String(iteration);
  return max ? `${groupId} · ${step}/${max}` : `${groupId} · ${step}`;
}

function attemptCount(io) {
  const groups = io?.timelineGroups;
  if (!Array.isArray(groups) || !groups.length) return null;
  return Math.max(...groups.map((group) => Number(group.attempt) || 1));
}

function nodeChip(label, valueHtml) {
  return `<span class="node-chip"><span class="chip-label">${escapeHtml(label)}</span><strong>${valueHtml}</strong></span>`;
}

function panelSubtitle(node, index) {
  const stage = stageLabel(node, index).toLowerCase().replace(/(^|\s)\w/g, (letter) => letter.toUpperCase());
  const recipe = draft?.id ? `${draft.id}${draft.version != null ? ` v${draft.version}` : ''}` : '';
  return [stage, node.type, recipe].filter(Boolean).join(' · ');
}

function nodeChipRow(node, io, runtime) {
  const status = runtime?.status || io?.output?.status;
  const state = graphStateClass(status);
  const chips = [nodeChip('Status', `<span class="status-text status-${state}">${escapeHtml(statusWord(status))}</span>`)];
  const duration = headerDuration(node, io);
  if (duration) chips.push(nodeChip('Duration', escapeHtml(duration)));
  if (io?.finishedAt) {
    const finished = timeTag(io.finishedAt);
    if (finished) chips.push(nodeChip('Finished', finished));
  }
  const loop = loopChipValue(node, io);
  if (loop) chips.push(nodeChip('Loop', escapeHtml(loop)));
  const attempts = attemptCount(io);
  if (attempts) chips.push(nodeChip('Attempts', escapeHtml(String(attempts))));
  const reason = io?.output?.reason || runtime?.reason;
  if (reason && (state === 'failed' || String(status || '').toLowerCase() === 'blocked')) {
    chips.push(nodeChip('Reason', escapeHtml(reason)));
  }
  return `<div class="node-chip-row">${chips.join('')}</div>`;
}

function jsonBlock(value) {
  if (value == null || value === '') return '<p class="muted">None</p>';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return `<pre>${escapeHtml(text)}</pre>`;
}

function artifactPreview(artifact) {
  if (!artifact || artifact.unavailable) return '';
  const preview = artifact.preview || artifact;
  if (!preview.content) return '';
  const path = preview.path || artifact.descriptor?.path || '';
  return `${path ? `<p class="artifact-path">${escapeHtml(path)}</p>` : ''}<pre>${escapeHtml(preview.content)}</pre>`;
}

function fileChipRow(files) {
  const list = (files || []).filter((file) => file && (file.name || file.path));
  if (!list.length) return '';
  return `<div class="artifact-chips">${list.map((file) => {
    const name = escapeHtml(file.name || file.path);
    if (!file.path || file.state === 'rejected') return `<span class="artifact-chip">${name}</span>`;
    return `<button type="button" class="artifact-chip" data-artifact-path="${escapeHtml(file.path)}">${name}</button>`;
  }).join('')}</div>`;
}

function previewBlock(preview) {
  if (!preview) return '';
  if (preview.error) {
    return `<p class="validation-message">${escapeHtml(preview.path || 'Artifact')}: ${escapeHtml(preview.error)}</p>`;
  }
  const content = preview.content || '';
  if (!content && !preview.path) return '';
  return `<article class="evidence-card"><p class="artifact-path">${escapeHtml(preview.path || '')}</p>${content ? `<pre>${escapeHtml(content)}</pre>` : '<p class="muted">No preview.</p>'}</article>`;
}

function renderEvidenceCard(card) {
  const lines = (card.lines || []).map((line) => {
    const raw = line.value == null ? '' : String(line.value);
    const value = looksLikeIso(raw) ? (timeTag(raw) || escapeHtml(raw)) : escapeHtml(raw);
    const duration = formatDuration(Number(line.durationMs));
    const extra = [line.detail, duration].filter(Boolean).join(' · ');
    return `<li class="evidence-line"><span class="evidence-label">${escapeHtml(line.label || '')}</span><span class="evidence-value">${value}</span>${extra ? `<span class="evidence-detail">${escapeHtml(extra)}</span>` : ''}</li>`;
  }).join('');
  return `<article class="evidence-card"><h3>${escapeHtml(card.title || 'Evidence')}</h3>${lines ? `<ul class="evidence-lines">${lines}</ul>` : ''}${card.note ? `<p class="evidence-note">${escapeHtml(card.note)}</p>` : ''}</article>`;
}

function evidenceBody(evidence) {
  const changed = evidence?.status === 'changed' || evidence?.status === 'rejected';
  const cards = evidence?.cards || [];
  if (!evidence || (!changed && !cards.length)) {
    return `<p class="muted">${escapeHtml(evidence?.summary || 'No evidence recorded for this node yet.')}</p>${fileChipRow(evidence?.files)}`;
  }
  const banner = changed
    ? `<p class="validation-message">${escapeHtml(evidence.message || 'artifact changed')}</p>`
    : '';
  return banner + cards.map(renderEvidenceCard).join('') + fileChipRow(evidence.files);
}

function inputPane(io) {
  const input = io?.input || {};
  const dependencies = (input.dependencies || []).map((item) =>
    `<li><strong>${escapeHtml(item.nodeId)}</strong> <span class="muted">${escapeHtml(item.status || '')}</span></li>`
  ).join('');
  return `
    ${input.task ? `<h3>Task</h3><p>${escapeHtml(input.task)}</p>` : '<p class="muted">This node reads its input from upstream nodes.</p>'}
    ${input.constraints ? `<h3>Constraints</h3><p>${escapeHtml(input.constraints)}</p>` : ''}
    ${input.goal ? `<h3>Goal</h3>${jsonBlock(input.goal)}` : ''}
    <h3>Upstream</h3>
    ${dependencies ? `<ul>${dependencies}</ul>` : '<p class="muted">No upstream nodes.</p>'}
  `;
}

function outputPane(view) {
  const io = view?.io || {};
  const summary = io.nodeEvidence?.summary || io.output?.summary || 'No evidence recorded for this node yet.';
  return `<p class="node-summary">${escapeHtml(summary)}</p>${fileChipRow(io.nodeEvidence?.files)}${artifactPreview(io.output?.artifact)}${previewBlock(view?.preview)}`;
}

function evidencePane(view) {
  if (view.io?.nodeEvidence) return evidenceBody(view.io.nodeEvidence) + previewBlock(view.preview);
  const fetched = view.artifacts || [];
  if (fetched.length) {
    return fetched.map((artifact) => artifact.error
      ? `<p class="validation-message">${escapeHtml(artifact.path || 'Artifact')}: ${escapeHtml(artifact.error)}</p>`
      : `<article class="evidence-card"><p class="artifact-path">${escapeHtml(artifact.path || '')}</p><pre>${escapeHtml(artifact.content || '')}</pre></article>`
    ).join('') + previewBlock(view.preview);
  }
  return `<p class="muted">No evidence recorded for this node yet.</p>${previewBlock(view.preview)}`;
}

function renderTimelineGroups(groups) {
  if (!groups.length) return '<p class="muted">No lifecycle events for this node yet.</p>';
  return groups.map((group) => `
    <section class="timeline-group">
      <h3>${escapeHtml(group.label || 'Step')}</h3>
      <ul class="panel-timeline">${(group.events || []).map((event) => `
        <li>
          ${timeTag(event.at) || '<span class="muted">—</span>'}
          <strong>${escapeHtml(event.label || event.type || 'event')}</strong>
        </li>`).join('')}</ul>
    </section>`).join('');
}

function timelinePane(view) {
  if (Array.isArray(view.io?.timelineGroups)) return renderTimelineGroups(view.io.timelineGroups);
  const node = draft?.nodes?.find((item) => item.id === panelNodeId);
  const gate = node?.legacyGate;
  const events = (view.events || []).filter((event) => event?.nodeId === panelNodeId || (gate && event?.gate === gate));
  return renderTimelineGroups(events.length ? [{
    label: 'This node',
    events: events.map((event) => ({
      at: event.at,
      label: event.message || String(event.type || 'event').replaceAll('_', ' ').toLowerCase()
    }))
  }] : []);
}

function paneBody(view) {
  if (view.status === 'empty') {
    return '<div class="empty-state"><h3>No run to inspect</h3><p>Start a run from the Goal sheet, or open a past run, to see this node\'s input, output, evidence, and timeline.</p></div>';
  }
  if (view.status === 'loading') return '<p class="muted">Loading node details…</p>';
  if (view.status === 'error') return `<p class="validation-message">${escapeHtml(view.message || 'Could not load this node.')}</p>`;
  if (panelTab === 'output') return outputPane(view);
  if (panelTab === 'evidence') return evidencePane(view);
  if (panelTab === 'timeline') return timelinePane(view);
  return inputPane(view.io);
}

function renderNodePanel(next) {
  if (next) panelView = next;
  const panel = byId('node-panel');
  const node = draft?.nodes?.find((item) => item.id === panelNodeId);
  if (!panel || !node) return;
  const index = draft.nodes.indexOf(node);
  const runtime = runtimeFor(node);
  panel.innerHTML = `
    <div class="node-panel-frame">
      <header class="node-panel-head">
        <span class="node-icon panel-type-icon">${nodeIcon(node.type)}</span>
        <div class="node-panel-titles">
          <h2>${escapeHtml(displayName(node))}</h2>
          <p>${escapeHtml(panelSubtitle(node, index))}</p>
        </div>
        <button type="button" class="node-panel-close" aria-label="Close node panel">×</button>
      </header>
      ${nodeChipRow(node, panelView.io, runtime)}
      <div class="io-tabs" role="tablist" aria-label="Node details">
        ${tabButton('overview', 'Overview')}
        ${tabButton('output', 'Output')}
        ${tabButton('evidence', 'Evidence', evidenceCount(panelView))}
        ${tabButton('timeline', 'Timeline')}
      </div>
      <div class="node-panel-body" role="tabpanel" id="node-pane-${panelTab}" aria-labelledby="node-tab-${panelTab}">
        ${paneBody(panelView)}
      </div>
    </div>
  `;
}

function collectArtifactPaths(io) {
  const paths = [];
  const push = (artifact) => {
    if (!artifact || artifact.unavailable) return;
    const path = artifact.preview?.path || artifact.descriptor?.path || artifact.path;
    if (path && !paths.includes(path)) paths.push(path);
  };
  push(io?.evidence);
  push(io?.output?.artifact);
  return paths.slice(0, 6);
}

async function loadPanel(nodeId) {
  const request = ++panelRequest;
  const runId = followedRunId();
  if (!runId) {
    renderNodePanel({ status: 'empty' });
    return;
  }
  try {
    const [ioResult, lifeResult] = await Promise.all([
      api(`/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}`),
      api(`/api/runs/${encodeURIComponent(runId)}/lifecycle?after=0&limit=100`)
    ]);
    if (request !== panelRequest || panelNodeId !== nodeId) return;
    const io = ioResult.io;
    const artifacts = [];
    for (const path of collectArtifactPaths(io)) {
      try {
        const result = await api(`/api/runs/${encodeURIComponent(runId)}/artifacts?path=${encodeURIComponent(path)}`);
        artifacts.push(result.artifact);
      } catch (error) {
        artifacts.push({ path, error: error.message });
      }
    }
    if (request !== panelRequest || panelNodeId !== nodeId) return;
    renderNodePanel({
      status: 'ready',
      io,
      events: lifeResult.lifecycle?.events || [],
      artifacts
    });
  } catch (error) {
    if (request !== panelRequest || panelNodeId !== nodeId) return;
    renderNodePanel({ status: 'error', message: error.message });
  }
}

function openNodePanel(nodeId) {
  if (!nodeId || !draft?.nodes?.some((node) => node.id === nodeId)) return;
  const alreadyOpen = panelIsOpen();
  if (panelNodeId !== nodeId) panelTab = 'overview';
  panelNodeId = nodeId;
  selectNode(nodeId);
  focusNode(nodeId);
  const panel = byId('node-panel');
  if (!panel) return;
  panel.hidden = false;
  byId('canvas')?.classList.add('panel-open');
  const runId = followedRunId();
  renderNodePanel(runId ? { status: 'loading' } : { status: 'empty' });
  if (!alreadyOpen) fitView();
  if (runId) loadPanel(nodeId);
}

function closeNodePanel() {
  panelNodeId = null;
  panelRequest += 1;
  panelView = { status: 'empty' };
  const panel = byId('node-panel');
  if (panel) {
    panel.hidden = true;
    panel.innerHTML = '';
  }
  byId('canvas')?.classList.remove('panel-open');
  hideTooltip();
  if (workspace === 'wiring' && draft?.nodes?.length) fitView();
}

function panelIsOpen() {
  const panel = byId('node-panel');
  return Boolean(panelNodeId && panel && !panel.hidden);
}

async function loadArtifactPreview(artifactPath) {
  const runId = followedRunId();
  if (!runId || !artifactPath) return;
  const request = panelRequest;
  try {
    const result = await api(`/api/runs/${encodeURIComponent(runId)}/artifacts?path=${encodeURIComponent(artifactPath)}`);
    if (request !== panelRequest) return;
    panelView = { ...panelView, preview: result.artifact };
  } catch (error) {
    if (request !== panelRequest) return;
    panelView = { ...panelView, preview: { path: artifactPath, error: error.message } };
  }
  renderNodePanel();
}

function onPanelClick(event) {
  if (closestReal(event.target, '.node-panel-close')) {
    closeNodePanel();
    return;
  }
  const artifact = closestReal(event.target, '[data-artifact-path]');
  if (artifact?.dataset?.artifactPath) {
    loadArtifactPreview(artifact.dataset.artifactPath);
    return;
  }
  const tab = closestReal(event.target, '[role="tab"]');
  if (!tab?.dataset?.tab) return;
  panelTab = tab.dataset.tab;
  renderNodePanel();
  byId('node-panel')?.querySelector?.(`[data-tab="${panelTab}"]`)?.focus?.();
}

function onPanelKeydown(event) {
  const tab = closestReal(event.target, '[role="tab"]');
  if (!tab) return;
  const tabs = Array.from(byId('node-panel')?.querySelectorAll?.('[role="tab"]') || []);
  const index = tabs.indexOf(tab);
  if (index < 0) return;
  let next = index;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else return;
  event.preventDefault();
  event.stopPropagation();
  panelTab = tabs[next].dataset.tab;
  renderNodePanel();
  byId('node-panel')?.querySelector?.(`[data-tab="${panelTab}"]`)?.focus?.();
}

function updateZoomLabel() {
  if (!zoomLevelOutput) return;
  zoomLevelOutput.textContent = `${Math.round(viewport.scale * 100)}%`;
}

const ZOOM_ICONS = {
  in: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 12h12M12 6v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 12h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fit: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  layout: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="5" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="14" y="13" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 8h3v8h3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
};

function zoomButton(label, icon, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'zoom-button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  button.onclick = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    action();
  };
  return button;
}

function mountCanvasChrome() {
  const canvas = byId('canvas');
  if (!canvas || zoomInButton) return;
  const bar = document.createElement('div');
  bar.className = 'zoom-controls';
  zoomInButton = zoomButton('Zoom in', ZOOM_ICONS.in, () => zoomAt(viewport.scale * 1.08));
  const zoomOutButton = zoomButton('Zoom out', ZOOM_ICONS.out, () => zoomAt(viewport.scale * 0.92));
  const zoomFitButton = zoomButton('Fit to view', ZOOM_ICONS.fit, () => fitView());
  const zoomLayoutButton = zoomButton('Auto-layout', ZOOM_ICONS.layout, () => autoLayout());
  zoomLevelOutput = document.createElement('output');
  zoomLevelOutput.className = 'zoom-level';
  zoomLevelOutput.setAttribute('aria-label', 'Zoom level');
  const sep = () => {
    const element = document.createElement('span');
    element.className = 'zoom-sep';
    element.setAttribute('aria-hidden', 'true');
    return element;
  };
  bar.append(zoomInButton, sep(), zoomOutButton, sep(), zoomFitButton, sep(), zoomLayoutButton, zoomLevelOutput);
  canvas.append(bar);

  nodeTooltip = document.createElement('div');
  nodeTooltip.id = 'node-tooltip';
  nodeTooltip.className = 'node-tooltip';
  nodeTooltip.setAttribute('role', 'tooltip');
  nodeTooltip.hidden = true;
  canvas.append(nodeTooltip);

  minimap = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  minimap.setAttribute('class', 'minimap');
  minimap.setAttribute('aria-label', 'Workflow minimap');
  minimap.setAttribute('viewBox', `0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`);
  minimap.setAttribute('width', String(MINIMAP_WIDTH));
  minimap.setAttribute('height', String(MINIMAP_HEIGHT));
  minimap.addEventListener('pointerdown', onMinimapPointerDown);
  canvas.append(minimap);

  const panel = byId('node-panel');
  if (panel) {
    panel.hidden = true;
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('keydown', onPanelKeydown);
  }
  updateZoomLabel();
}

function minimapMetrics() {
  const bounds = graphBounds();
  if (!bounds) return null;
  const pad = 10;
  const innerW = MINIMAP_WIDTH - pad * 2;
  const innerH = MINIMAP_HEIGHT - pad * 2;
  const scale = Math.min(innerW / Math.max(bounds.width, 1), innerH / Math.max(bounds.height, 1));
  return {
    bounds,
    scale,
    offsetX: pad + (innerW - bounds.width * scale) / 2,
    offsetY: pad + (innerH - bounds.height * scale) / 2,
    width: MINIMAP_WIDTH,
    height: MINIMAP_HEIGHT
  };
}

function renderMinimap() {
  if (!minimap) return;
  minimap.innerHTML = '';
  const metrics = minimapMetrics();
  if (!metrics || !draft?.nodes?.length) return;
  for (const node of draft.nodes) {
    const position = positions.get(node.id);
    if (!position) continue;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const status = graphStateClass(runtimeFor(node)?.status);
    rect.setAttribute('class', `minimap-node minimap-${status}`);
    rect.setAttribute('x', String(metrics.offsetX + (position.x - metrics.bounds.minX) * metrics.scale));
    rect.setAttribute('y', String(metrics.offsetY + (position.y - metrics.bounds.minY) * metrics.scale));
    rect.setAttribute('width', String(Math.max(3, NODE_WIDTH * metrics.scale)));
    rect.setAttribute('height', String(Math.max(3, NODE_BLOCK_HEIGHT * metrics.scale)));
    rect.setAttribute('rx', '2');
    minimap.append(rect);
  }
  const canvasRect = byId('canvas')?.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
  const viewW = Math.max(1, canvasRect.width - panelInset());
  const viewH = Math.max(1, canvasRect.height);
  const origin = screenToWorld(canvasRect.left, canvasRect.top);
  const viewportRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  viewportRect.setAttribute('class', 'minimap-viewport');
  viewportRect.setAttribute('x', String(metrics.offsetX + (origin.x - metrics.bounds.minX) * metrics.scale));
  viewportRect.setAttribute('y', String(metrics.offsetY + (origin.y - metrics.bounds.minY) * metrics.scale));
  viewportRect.setAttribute('width', String(Math.max(4, (viewW / viewport.scale) * metrics.scale)));
  viewportRect.setAttribute('height', String(Math.max(4, (viewH / viewport.scale) * metrics.scale)));
  viewportRect.setAttribute('rx', '3');
  minimap.append(viewportRect);
}

function centerOnWorld(worldX, worldY) {
  const rect = byId('canvas')?.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
  const inset = panelInset();
  viewport.x = (rect.width - inset) / 2 - worldX * viewport.scale;
  viewport.y = rect.height / 2 - worldY * viewport.scale;
  applyViewport();
  saveLayoutSoon();
}

function panFromMinimapEvent(event) {
  const metrics = minimapMetrics();
  if (!metrics || !minimap?.getBoundingClientRect) return;
  const rect = minimap.getBoundingClientRect();
  const localX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * metrics.width;
  const localY = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * metrics.height;
  const worldX = metrics.bounds.minX + (localX - metrics.offsetX) / metrics.scale;
  const worldY = metrics.bounds.minY + (localY - metrics.offsetY) / metrics.scale;
  centerOnWorld(worldX, worldY);
}

function onMinimapPointerDown(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  interaction = { type: 'minimap', pointerId: event.pointerId };
  panFromMinimapEvent(event);
  minimap?.setPointerCapture?.(event.pointerId);
}

function canvasShortcutTarget(target) {
  if (!target || editableTarget(target)) return false;
  if (workspace !== 'wiring' || byId('canvas')?.hidden) return false;
  if (target.id === 'canvas' || target === byId('canvas')) return true;
  if (target.dataset?.nodeId) return true;
  return String(target.className || '').split(/\s+/).includes('node');
}

function toggleShortcutSheet() {
  const dialog = byId('shortcut-sheet');
  if (!dialog) return;
  if (dialog.open) dialog.close();
  else dialog.showModal();
}

function bindCanvas() {
  const canvas = byId('canvas');
  mountCanvasChrome();
  canvas.addEventListener('pointerdown', (event) => {
    if (closestReal(event.target, '#node-panel, .zoom-controls, .minimap')) return;
    if (event.target === canvas || event.target === byId('scene') || event.target === byId('nodes') || event.target === byId('edges')) {
      selectedId = null;
      selectedEdgeId = null;
      if (!event.shiftKey) selectedIds.clear();
      updateSelection();
      renderEdges();
      if (event.button === 1 || spacePressed) beginPan(event);
    }
  });
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', finishPointer);
  canvas.addEventListener('pointercancel', finishPointer);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
}

function editableTarget(target) {
  return target.matches?.('input,textarea,select,[contenteditable="true"]');
}

document.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && !editableTarget(event.target)) {
    spacePressed = true;
    event.preventDefault();
  }
  if (editableTarget(event.target)) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    restoreHistory(historyIndex + (event.shiftKey ? 1 : -1));
    return;
  }
  if (modifier && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    restoreHistory(historyIndex + 1);
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId && !panelIsOpen()) {
    event.preventDefault();
    deleteEdge(selectedEdgeId);
    return;
  }
  if (event.key === 'Escape') {
    if (byId('shortcut-sheet')?.open) {
      event.preventDefault();
      byId('shortcut-sheet').close();
      return;
    }
    if (panelIsOpen()) {
      event.preventDefault();
      closeNodePanel();
      return;
    }
    if (canvasShortcutTarget(event.target)) {
      event.preventDefault();
      clearSelection();
    }
    return;
  }
  const shortcutQuestion = event.key === '?' || (event.key === '/' && event.shiftKey);
  if (shortcutQuestion && (byId('shortcut-sheet')?.open || canvasShortcutTarget(event.target))) {
    event.preventDefault();
    toggleShortcutSheet();
    return;
  }
  if (!canvasShortcutTarget(event.target)) return;
  if (modifier || event.altKey) return;
  const key = event.key;
  if (key === '+' || key === '=') {
    event.preventDefault();
    zoomAt(viewport.scale * 1.08);
    return;
  }
  if (key === '-' || key === '_') {
    event.preventDefault();
    zoomAt(viewport.scale * 0.92);
    return;
  }
  if (event.shiftKey) return;
  if (key === 'f' || key === 'F') {
    event.preventDefault();
    fitView();
  } else if (key === 'l' || key === 'L') {
    event.preventDefault();
    autoLayout();
  } else if (key === '0') {
    event.preventDefault();
    zoomAt(1);
  } else if (key === 'ArrowLeft') {
    event.preventDefault();
    moveSelection('left');
  } else if (key === 'ArrowRight') {
    event.preventDefault();
    moveSelection('right');
  } else if (key === 'ArrowUp') {
    event.preventDefault();
    moveSelection('up');
  } else if (key === 'ArrowDown') {
    event.preventDefault();
    moveSelection('down');
  } else if (key === 'Enter' && selectedId) {
    event.preventDefault();
    openNodePanel(selectedId);
  }
});
document.addEventListener('keyup', (event) => {
  if (event.code === 'Space') spacePressed = false;
});
if (typeof window !== 'undefined') window.addEventListener('resize', scheduleFitView);

byId('undo').onclick = () => restoreHistory(historyIndex - 1);
byId('redo').onclick = () => restoreHistory(historyIndex + 1);
byId('discard-wiring').onclick = discardWiring;
byId('save-wiring').onclick = () => {
  if (byId('save-wiring').disabled) return;
  byId('confirm').showModal();
};
byId('install').onclick = async () => {
  if (validationState.status !== 'valid') {
    notify(validationSummary() || 'Wiring is invalid.');
    return;
  }
  try {
    const recipe = authoringRecipe();
    const exists = catalog.recipes.some((item) => item.id === recipe.id && item.source !== 'builtin');
    if (source === 'builtin') {
      recipe.id = `${recipe.id}-local`;
      recipe.version = 1;
    } else if (exists) {
      recipe.version = Number(recipe.version) + 1;
    }
    const replacing = catalog.recipes.some((item) => item.id === recipe.id && item.source !== 'builtin');
    await api('/api/install', {
      method: 'POST',
      body: JSON.stringify({
        recipe,
        layout: layoutPayload(),
        replace: replacing,
        baseRecipeId: loadedRecipeId
      })
    });
    byId('confirm').close();
    notify('Wiring installed. The compiler accepted the graph.');
    await refreshCatalog(recipe.id);
    await loadRecipe();
  } catch (error) {
    notify(error.message);
  }
};

function notify(text) {
  const message = byId('message');
  message.textContent = text;
  message.style.display = 'block';
  setTimeout(() => { message.style.display = 'none'; }, 4000);
}

async function initialize() {
  byId('recipe').onchange = loadRecipe;
  bindCanvas();
  byId('show-live').onclick = () => showWorkspace('live');
  byId('show-runs').onclick = () => showWorkspace('runs');
  byId('show-wiring').onclick = () => showWorkspace('wiring');
  byId('run-search').oninput = loadRuns;
  byId('open-goal').onclick = () => {
    renderGoalState();
    byId('goal-dialog').showModal();
  };
  byId('save-goal').onclick = saveGoalFromForm;
  byId('start-agent').onclick = () => copyAgentHandoff();
  byId('review-goal').onclick = reviewGoal;
  byId('confirm-freeze').onclick = freezeGoalFromForm;
  byId('unfreeze-goal').onclick = unfreezeGoalFromForm;
  byId('retry-live-connection').onclick = resync;
  document.querySelectorAll?.('[data-close]')?.forEach?.((button) => {
    button.onclick = () => byId(button.dataset.close).close();
  });
  document.querySelectorAll?.('.dialog-maximize')?.forEach?.((button) => {
    button.onclick = () => button.closest('dialog').classList.toggle('maximized');
  });
  byId('goal-dialog').addEventListener('close', () => {
    onboardingDismissed = true;
  });
  showWorkspace('live');
  await refreshCatalog('default');
  await loadRecipe();
  startEventStream();
}

initialize().catch((error) => notify(error.message));
