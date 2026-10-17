'use strict';

const NODE_WIDTH = 224;
const NODE_PORT_Y = 54;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
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
let positions = new Map();
let viewport = { x: 0, y: 0, scale: 1 };
let history = [];
let historyIndex = -1;
let interaction;
let connection;
let layoutTimer;
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
    return [node.id, { x: 80 + depth * 270, y: 110 + row * 150 }];
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
}

function screenToWorld(clientX, clientY) {
  const rect = byId('canvas').getBoundingClientRect();
  return {
    x: (clientX - rect.left - viewport.x) / viewport.scale,
    y: (clientY - rect.top - viewport.y) / viewport.scale
  };
}

function edgePath(from, to) {
  const startX = from.x + NODE_WIDTH;
  const startY = from.y + NODE_PORT_Y;
  const endX = to.x;
  const endY = to.y + NODE_PORT_Y;
  const bend = Math.max(55, Math.abs(endX - startX) * 0.42);
  return `M${startX} ${startY} C${startX + bend} ${startY},${endX - bend} ${endY},${endX} ${endY}`;
}

function loopBounds(loopGroup) {
  const points = loopGroup.nodeIds.map((nodeId) => positions.get(nodeId)).filter(Boolean);
  if (!points.length) return null;
  const padding = 44;
  const left = Math.min(...points.map((point) => point.x)) - padding;
  const top = Math.min(...points.map((point) => point.y)) - padding;
  const right = Math.max(...points.map((point) => point.x + NODE_WIDTH)) + padding;
  const bottom = Math.max(...points.map((point) => point.y + 108)) + padding;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function renderLoopGroups() {
  const container = scenePart('.loop-groups');
  container.innerHTML = '';
  for (const loopGroup of draft?.loopGroups || []) {
    const bounds = loopBounds(loopGroup);
    if (!bounds) continue;
    const runtime = catalog.live?.loopGroups?.[loopGroup.id];
    const element = document.createElement('section');
    element.className = `loop-group ${runtime?.status?.toLowerCase() || 'draft'}`;
    element.style.left = `${bounds.left}px`;
    element.style.top = `${bounds.top}px`;
    element.style.width = `${bounds.width}px`;
    element.style.height = `${bounds.height}px`;
    element.innerHTML = `
      <header>
        <span><b>${escapeHtml(loopGroup.displayName)}</b><small>ITERATION ${escapeHtml(runtime?.iteration || 1)} / ${escapeHtml(loopGroup.maxIterations)}</small></span>
      </header>
    `;
    container.append(element);
  }
}

function edgeLoopLabel(edge) {
  const loopGroup = (draft.loopGroups || []).find((candidate) =>
    candidate.decisionNodeId === edge.from && candidate.exitTargetId === edge.to
  );
  return loopGroup ? loopGroup.exitLabel : '';
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

function renderEdges() {
  const group = scenePart('.edge-paths');
  const controls = scenePart('.edge-controls');
  const preview = scenePart('.preview-edge');
  group.innerHTML = '';
  controls.innerHTML = '';
  if (preview?.style && preview !== byId('scene')) preview.setAttribute?.('d', preview.getAttribute?.('d') || '');
  if (!draft) return;
  draft.edges.forEach((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', edgePath(from, to));
    const state = graphStateClass(catalog.live?.edges?.find((candidate) => candidate.id === edge.id)?.state);
    path.setAttribute(
      'class',
      `edge edge-${state}${selectedEdgeId === edge.id ? ' selected' : ''}`
    );
    path.setAttribute('marker-end', 'url(#arrow)');
    path.dataset.edgeId = edge.id;
    group.append(path);
    const midpoint = {
      x: (from.x + NODE_WIDTH + to.x) / 2,
      y: (from.y + to.y) / 2 + NODE_PORT_Y
    };
    const control = document.createElement('button');
    control.className = `edge-delete${selectedEdgeId === edge.id ? ' selected' : ''}`;
    control.dataset.edgeId = edge.id;
    control.style.left = `${midpoint.x}px`;
    control.style.top = `${midpoint.y}px`;
    control.title = `${displayName(draft.nodes.find((node) => node.id === edge.from))} → ${displayName(draft.nodes.find((node) => node.id === edge.to))}`;
    control.setAttribute('aria-label', `Delete connection ${control.title}`);
    control.textContent = '×';
    control.onclick = (event) => {
      event.stopPropagation();
      deleteEdge(edge.id);
    };
    controls.append(control);
    const label = edgeLoopLabel(edge);
    if (label) {
      const badge = document.createElement('span');
      badge.className = 'edge-label';
      badge.style.left = `${midpoint.x}px`;
      badge.style.top = `${midpoint.y - 22}px`;
      badge.textContent = label;
      controls.append(badge);
    }
  });
}

function nodeMarkup(node, index) {
  const runtimeNode = catalog.live?.nodes?.[node.id];
  return `
    <button class="port port-in" aria-label="Input for ${escapeHtml(node.id)}" tabindex="-1"></button>
    <small>${escapeHtml(stageLabel(node, index))} / ${escapeHtml(node.type.toUpperCase())}</small>
    <span class="node-title">${escapeHtml(displayName(node))}</span>
    <span class="technical-id">${escapeHtml(node.id)}</span>
    <span class="status">● ${escapeHtml(runtimeNode?.status || 'READY')}</span>
    <button class="port port-out" aria-label="Connect from ${escapeHtml(node.id)}" tabindex="-1"></button>
  `;
}

function renderGraph() {
  if (!draft) return;
  ensurePositions();
  renderLoopGroups();
  const container = byId('nodes');
  if (!container) return;
  container.innerHTML = '';
  draft.nodes.forEach((node, index) => {
    const position = positions.get(node.id);
    const runtimeNode = catalog.live?.nodes?.[node.id];
    const element = document.createElement('article');
    element.dataset.nodeId = node.id;
    element.className = `node ${graphStateClass(runtimeNode?.status)} ${selectedIds.has(node.id) ? 'selected' : ''}`;
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    element.innerHTML = nodeMarkup(node, index);
    element.addEventListener('pointerdown', beginNodeInteraction);
    element.querySelector('.port-out')?.addEventListener('pointerdown', beginConnection);
    container.append(element);
  });
  renderEdges();
  applyViewport();
}

function updateSelection() {
  document.querySelectorAll?.('.node')?.forEach?.((element) => {
    element.classList.toggle('selected', selectedIds.has(element.dataset.nodeId));
  });
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
  if (!draft || from === to) return false;
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

function repointEdge(id, from, to) {
  const edge = draft?.edges.find((candidate) => candidate.id === id);
  if (!edge) return false;
  edge.from = from;
  edge.to = to;
  syncDependencies();
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
    origins: new Map([...selectedIds].map((id) => [id, { ...positions.get(id) }]))
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
    const from = positions.get(connection.sourceId);
    const preview = scenePart('.preview-edge');
    if (from && preview?.setAttribute) {
      const target = screenToWorld(event.clientX, event.clientY);
      const start = { x: from.x + NODE_WIDTH, y: from.y + NODE_PORT_Y };
      const bend = Math.max(55, Math.abs(target.x - start.x) * 0.42);
      preview.style.display = 'block';
      preview.setAttribute('d', `M${start.x} ${start.y} C${start.x + bend} ${start.y},${target.x - bend} ${target.y},${target.x} ${target.y}`);
    }
    return;
  }
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  if (interaction.type === 'node') {
    const world = screenToWorld(event.clientX, event.clientY);
    const position = { x: world.x - interaction.offsetX, y: world.y - interaction.offsetY };
    const origin = interaction.origins.get(interaction.nodeId);
    const delta = { x: position.x - origin.x, y: position.y - origin.y };
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
  interaction = null;
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

function finishConnection(event) {
  const sourceId = connection.sourceId;
  connection = null;
  const preview = scenePart('.preview-edge');
  if (preview?.style) preview.style.display = 'none';
  const targetElement = document.elementFromPoint?.(event.clientX, event.clientY)?.closest?.('.node');
  const targetId = targetElement?.dataset.nodeId;
  if (!targetId || targetId === sourceId) return;
  if (draft.edges.some((edge) => edge.from === sourceId && edge.to === targetId)) return notify('Nodes are already connected.');
  if (transitivelyDependsOn(sourceId, targetId)) return notify('Connection rejected: it would create a cycle.');
  addEdge(sourceId, targetId);
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
  event.preventDefault();
  zoomAt(viewport.scale * (event.deltaY < 0 ? 1.08 : 0.92), event.clientX, event.clientY);
}

function autoLayout({ record = true } = {}) {
  positions = defaultGraphPositions();
  renderGraph();
  if (record) captureHistory();
  saveLayoutSoon();
}

function fitView() {
  if (!draft?.nodes.length) return;
  ensurePositions();
  const canvas = byId('canvas').getBoundingClientRect();
  const xs = draft.nodes.map((node) => positions.get(node.id).x);
  const ys = draft.nodes.map((node) => positions.get(node.id).y);
  const width = Math.max(...xs) - Math.min(...xs) + NODE_WIDTH + 160;
  const height = Math.max(...ys) - Math.min(...ys) + 200;
  viewport.scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(canvas.width / width, canvas.height / height)));
  viewport.x = (canvas.width - width * viewport.scale) / 2 - Math.min(...xs) * viewport.scale + 40;
  viewport.y = (canvas.height - height * viewport.scale) / 2 - Math.min(...ys) * viewport.scale + 40;
  applyViewport();
  saveLayoutSoon();
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
  if (byId('undo')) byId('undo').disabled = historyIndex <= 0;
  if (byId('redo')) byId('redo').disabled = historyIndex >= history.length - 1;
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
  if (byId('undo')) byId('undo').disabled = historyIndex <= 0;
  if (byId('redo')) byId('redo').disabled = historyIndex >= history.length - 1;
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

async function validateDraft() {
  const sequence = ++validationSequence;
  try {
    const result = await api('/api/validate', {
      method: 'POST',
      body: JSON.stringify({ recipe: draft, baseRecipeId: loadedRecipeId })
    });
    if (sequence !== validationSequence) return result;
    const hash = result.plans[0].graphHash;
    byId('integrity').textContent = `VALID / ${hash.slice(0, 8)}…${hash.slice(-4)}`;
    byId('integrity').className = 'valid';
    byId('review').disabled = false;
    byId('review-data').textContent = JSON.stringify({
      recipe: draft.id,
      version: draft.version,
      modes: result.plans.map((plan) => plan.mode),
      nodes: draft.nodes.length,
      graphHashes: result.plans.map((plan) => plan.graphHash)
    }, null, 2);
    return result;
  } catch (error) {
    if (sequence !== validationSequence) return null;
    byId('integrity').textContent = `INVALID / ${error.message}`;
    byId('integrity').className = 'invalid';
    byId('review').disabled = true;
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
          <span>${escapeHtml(run.status)} · ${escapeHtml(new Date(run.updatedAt).toLocaleString())}</span>
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

function heartbeatAge(iso) {
  if (!iso) return 'no heartbeat';
  const age = Math.max(0, Date.now() - Date.parse(iso));
  if (!Number.isFinite(age)) return 'no heartbeat';
  if (age < 2000) return 'just now';
  if (age < 60000) return `${Math.round(age / 1000)}s ago`;
  return `${Math.round(age / 60000)}m ago`;
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
  });
}

function renderLive() {
  const live = catalog.live;
  const summary = byId('run-summary');
  const rail = byId('stage-rail');
  const journey = byId('run-journey');
  const meta = byId('live-view')?.querySelector?.('.live-meta');
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
    summary.textContent = `${run.displayName || run.runId || 'run'} · ${run.state || ''} · ${heartbeatAge(presence.lastHeartbeatAt)}`;
  }
  if (rail) {
    rail.innerHTML = STAGES.map((stage) => {
      const current = stage.id === stageId;
      return `<li class="${current ? 'active' : 'pending'}">${escapeHtml(stage.label)}</li>`;
    }).join('');
  }
  const artifacts = live.artifacts || liveArtifacts;
  const guard = artifacts['artifact.guard'] || {};
  const drift = artifacts['artifact.drift'] || {};
  const receipt = artifacts['artifact.receipt'] || {};
  if (meta) {
    meta.innerHTML = `
      <span>${escapeHtml(run.tier?.current || run.mode || '')}</span>
      <span>iter ${escapeHtml(String(run.iteration ?? '—'))}</span>
      <span>${escapeHtml(String(live.budget?.spentThisRun ?? 0))} / ${escapeHtml(String(live.budget?.perRunTokenLimit ?? 0))} tokens</span>
      <span class="chip">${escapeHtml(String(guard.warn || 0))} warn · ${escapeHtml(String(guard.block || 0))} block</span>
      <span class="chip">drift ${escapeHtml(String(drift.outOfMapCount || 0))}</span>
      <span class="chip">${receipt.verified ? 'receipt ok' : 'receipt pending'}</span>
    `;
  }
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
    `<li class="event">${escapeHtml(String(event.at || '').slice(11, 19))} · ${escapeHtml(event.type)} · ${escapeHtml(event.message || '')}</li>`
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
  selectedId = null;
  selectedIds.clear();
  selectedEdgeId = null;
  positions = new Map(Object.entries(saved.layout?.positions || {}));
  ensurePositions();
  viewport = saved.layout?.viewport || { x: 0, y: 0, scale: 1 };
  renderGraph();
  if (!saved.layout || (draft.nodes.length <= 12 && viewport.scale < 0.45)) fitView();
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

function bindCanvas() {
  const canvas = byId('canvas');
  canvas.addEventListener('pointerdown', (event) => {
    if (event.target === canvas || event.target === byId('scene') || event.target === byId('nodes') || event.target === byId('edges')) {
      selectedId = null;
      if (!event.shiftKey) selectedIds.clear();
      updateSelection();
      if (event.button === 1 || spacePressed) beginPan(event);
    }
  });
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', finishPointer);
  canvas.addEventListener('pointercancel', finishPointer);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  byId('auto-layout').onclick = () => autoLayout();
  byId('fit-view').onclick = fitView;
  byId('undo').onclick = () => restoreHistory(historyIndex - 1);
  byId('redo').onclick = () => restoreHistory(historyIndex + 1);
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
  } else if (modifier && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    restoreHistory(historyIndex + 1);
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId) {
    event.preventDefault();
    deleteEdge(selectedEdgeId);
  }
});
document.addEventListener('keyup', (event) => {
  if (event.code === 'Space') spacePressed = false;
});

byId('review').onclick = () => {
  if (byId('review').disabled) return;
  byId('confirm').showModal();
};
byId('install').onclick = async () => {
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
