'use strict';

const NODE_WIDTH = 224;
const NODE_PORT_Y = 54;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(
  /[&<>"']/g,
  (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
);

let catalog;
let draft;
let source;
let loadedRecipeId;
let selectedId;
let liveTimer;
let validationSequence = 0;
let positions = new Map();
let viewport = { x: 0, y: 0, scale: 1 };
let history = [];
let historyIndex = -1;
let interaction;
let connection;
let layoutTimer;
let spacePressed = false;

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

function recipeSummary() {
  return catalog.recipes.find((recipe) => recipe.id === draft.id);
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
  byId('scene').style.transform = `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.scale})`;
  byId('canvas').style.backgroundPosition = `${viewport.x}px ${viewport.y}px`;
  byId('canvas').style.backgroundSize = `${32 * viewport.scale}px ${32 * viewport.scale}px`;
  byId('zoom-level').textContent = `${Math.round(viewport.scale * 100)}%`;
}

function screenToWorld(clientX, clientY) {
  const rect = byId('canvas').getBoundingClientRect();
  return {
    x: (clientX - rect.left - viewport.x) / viewport.scale,
    y: (clientY - rect.top - viewport.y) / viewport.scale
  };
}

function worldAtCanvasCenter() {
  const rect = byId('canvas').getBoundingClientRect();
  return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function edgePath(from, to) {
  const startX = from.x + NODE_WIDTH;
  const startY = from.y + NODE_PORT_Y;
  const endX = to.x;
  const endY = to.y + NODE_PORT_Y;
  const bend = Math.max(55, Math.abs(endX - startX) * 0.42);
  return `M${startX} ${startY} C${startX + bend} ${startY},${endX - bend} ${endY},${endX} ${endY}`;
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
  return stages[node.type] || `CUSTOM ${String(index + 1).padStart(2, '0')}`;
}

function renderEdges() {
  const group = byId('edge-paths');
  group.innerHTML = '';
  if (!draft) return;
  draft.nodes.forEach((node) => {
    for (const dependencyId of node.dependsOn || []) {
      const from = positions.get(dependencyId);
      const to = positions.get(node.id);
      if (!from || !to) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', edgePath(from, to));
      path.setAttribute('class', catalog.live?.nodes?.[dependencyId]?.status === 'RUNNING' ? 'edge active' : 'edge');
      path.setAttribute('marker-end', 'url(#arrow)');
      group.append(path);
    }
  });
}

function nodeMarkup(node, index) {
  const runtimeNode = catalog.live?.nodes?.[node.id];
  return `
    <button class="port port-in" aria-label="Input for ${escapeHtml(node.id)}" tabindex="-1"></button>
    <small>${escapeHtml(stageLabel(node, index))} / ${escapeHtml(node.type.toUpperCase())}</small>
    <h3>${escapeHtml(node.id)}</h3>
    <span class="status">● ${escapeHtml(runtimeNode?.status || 'DRAFT')}</span>
    ${runtimeNode?.activity ? `<p class="node-activity">${escapeHtml(runtimeNode.activity)}</p>` : ''}
    <button class="port port-out" aria-label="Connect from ${escapeHtml(node.id)}" tabindex="-1"></button>
  `;
}

function renderGraph() {
  ensurePositions();
  const container = byId('nodes');
  container.innerHTML = '';
  draft.nodes.forEach((node, index) => {
    const position = positions.get(node.id);
    const runtimeNode = catalog.live?.nodes?.[node.id];
    const element = document.createElement('article');
    element.dataset.nodeId = node.id;
    element.className = `node ${runtimeNode?.status.toLowerCase() || ''} ${selectedId === node.id ? 'selected' : ''}`;
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    element.innerHTML = nodeMarkup(node, index);
    element.addEventListener('pointerdown', beginNodeInteraction);
    element.querySelector('.port-out').addEventListener('pointerdown', beginConnection);
    container.append(element);
  });
  renderEdges();
  applyViewport();
}

function updateRuntimePresentation() {
  if (!draft) return;
  for (const element of document.querySelectorAll('.node')) {
    const nodeId = element.dataset.nodeId;
    const runtimeNode = catalog.live?.nodes?.[nodeId];
    element.classList.remove('running', 'passed', 'failed', 'blocked', 'ready', 'pending', 'skipped');
    if (runtimeNode?.status) element.classList.add(runtimeNode.status.toLowerCase());
    element.querySelector('.status').textContent = `● ${runtimeNode?.status || 'DRAFT'}`;
    const existingActivity = element.querySelector('.node-activity');
    if (runtimeNode?.activity) {
      if (existingActivity) existingActivity.textContent = runtimeNode.activity;
      else element.querySelector('.status').insertAdjacentHTML('afterend', `<p class="node-activity">${escapeHtml(runtimeNode.activity)}</p>`);
    } else {
      existingActivity?.remove();
    }
  }
  renderEdges();
}

function updateSelection() {
  document.querySelectorAll('.node').forEach((element) => {
    element.classList.toggle('selected', element.dataset.nodeId === selectedId);
  });
}

function renderRecipeDetails() {
  const existing = recipeSummary();
  byId('inspector-label').textContent = 'WORKFLOW';
  byId('inspector-title').textContent = draft.id;
  byId('details').innerHTML = `
    <div class="source-line"><span>${escapeHtml(source.toUpperCase())}</span><span>${draft.nodes.length} NODES</span></div>
    <label for="recipe-id">Name</label><input id="recipe-id" value="${escapeHtml(draft.id)}">
    <label for="recipe-description">Description</label><textarea id="recipe-description">${escapeHtml(draft.description)}</textarea>
    ${existing?.source === 'builtin' ? '<p class="hint">Saving creates a project copy. The built-in remains unchanged.</p>' : ''}
    <details>
      <summary>Advanced settings</summary>
      <div class="settings-body">
        <label for="recipe-version">Version</label><input id="recipe-version" type="number" min="1" value="${escapeHtml(draft.version)}">
        <label for="recipe-modes">Run modes</label>
        <select id="recipe-modes" multiple>
          ${['REPORT_ONLY', 'ASSISTED', 'UNATTENDED'].map((mode) => `<option ${draft.compatibleModes.includes(mode) ? 'selected' : ''}>${mode}</option>`).join('')}
        </select>
      </div>
    </details>
    <button id="apply-recipe">Apply changes</button>
  `;
  byId('apply-recipe').onclick = applyRecipeDetails;
}

function selectNode(nodeId) {
  const node = draft.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return;
  selectedId = nodeId;
  updateSelection();
  const runtimeNode = catalog.live?.nodes?.[nodeId];
  byId('inspector-label').textContent = 'NODE';
  byId('inspector-title').textContent = node.id;
  byId('inspector-panel').classList.add('open');
  byId('details').innerHTML = `
    <div class="source-line"><span>${escapeHtml(node.type.toUpperCase())}</span><span>${escapeHtml(runtimeNode?.status || 'DRAFT')}</span></div>
    <label for="node-id">Name</label><input id="node-id" value="${escapeHtml(node.id)}">
    ${node.type === 'delivery' ? deliveryAdapterControls() : ''}
    <details>
      <summary>Settings</summary>
      <div class="settings-body">
        <label>Type</label><input value="${escapeHtml(node.type)}" disabled>
        <label for="node-dependencies">Inputs</label>
        <input id="node-dependencies" value="${escapeHtml((node.dependsOn || []).join(', '))}" placeholder="Connect nodes on the canvas">
        ${node.type === 'agent' ? `
          <label for="node-extra">Role</label><input id="node-extra" value="${escapeHtml(node.role || '')}">
          <label for="node-tokens">Token limit</label><input id="node-tokens" type="number" min="1" value="${escapeHtml(node.context?.maxTokens || '')}">
        ` : node.type === 'approval' ? `
          <label for="node-extra">Approval message</label><textarea id="node-extra">${escapeHtml(node.message || '')}</textarea>
        ` : node.type === 'condition' ? `
          <label for="condition-field">Field</label>
          <select id="condition-field">${['run.mode', 'run.state', 'run.iteration', 'run.task'].map((field) => `<option ${node.expression?.field === field ? 'selected' : ''}>${field}</option>`).join('')}</select>
          <label for="condition-operator">Rule</label>
          <select id="condition-operator">${['equals', 'notEquals', 'contains', 'exists', 'isEmpty', 'greaterThan', 'lessThan'].map((operator) => `<option ${node.expression?.operator === operator ? 'selected' : ''}>${operator}</option>`).join('')}</select>
          <label for="condition-value">Value</label><input id="condition-value" value="${escapeHtml(node.expression?.value ?? '')}">
        ` : ''}
      </div>
    </details>
    <div class="button-row"><button id="apply-node">Apply</button>${catalog.nodeTypes.find((type) => type.type === node.type)?.builtIn ? '' : '<button id="duplicate-node">Duplicate</button>'}<button id="delete-node" class="danger">Delete</button></div>
    ${runtimeControls(node, runtimeNode)}
  `;
  byId('apply-node').onclick = applyNodeDetails;
  if (byId('duplicate-node')) byId('duplicate-node').onclick = duplicateSelectedNode;
  byId('delete-node').onclick = deleteSelectedNode;
  if (byId('select-adapter')) byId('select-adapter').onclick = selectDeliveryAdapter;
  if (byId('generate-adapter')) byId('generate-adapter').onclick = copyAdapterBuilderPrompt;
  bindRuntimeControls(node);
}

function deliveryAdapterControls() {
  const current = catalog.adapters.current;
  const options = [...catalog.adapters.types];
  if (current && !options.includes(current)) options.push(current);
  return `
    <section class="adapter-controls">
      <label for="delivery-adapter">Delivery adapter</label>
      <select id="delivery-adapter">
        ${options.map((type) => `<option ${type === (current || catalog.adapters.recommended) ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}
      </select>
      <p class="hint">${current
        ? `${escapeHtml(current)} is active for this project.`
        : `Recommended: ${escapeHtml(catalog.adapters.recommended)}.`}</p>
      <div class="button-row"><button id="select-adapter">Use adapter</button><button id="generate-adapter">Create custom</button></div>
    </section>
  `;
}

async function selectDeliveryAdapter() {
  const type = byId('delivery-adapter').value;
  if (!catalog.adapters.types.includes(type)) {
    return notify('Custom adapters are changed through the guarded AI adapter builder.');
  }
  try {
    await api('/api/adapter/select', { method: 'POST', body: JSON.stringify({ type }) });
    catalog.adapters.current = type;
    selectNode(selectedId);
    notify(`${type} is now the project Stage 8 adapter.`);
  } catch (error) {
    notify(error.message);
  }
}

async function copyAdapterBuilderPrompt() {
  const prompt = [
    'Use the ai-engineering-loop generate-adapter skill for this repository.',
    'Ask Q1-Q5 before writing. Build a custom Stage 8 delivery adapter only.',
    'Preserve Stages 0-7, require Judge PASS, never store credentials, and use explicit approval for remote side effects.',
    'After validation, write .ai-engineering-loop/adapter.md so Workflow Studio discovers it.'
  ].join(' ');
  try {
    await navigator.clipboard.writeText(prompt);
    notify('Guarded custom-adapter prompt copied for your AI agent.');
  } catch (error) {
    notify(error.message);
  }
}

function runtimeControls(node, runtimeNode) {
  if (!catalog.live || !runtimeNode) return '';
  const approve = node.type === 'approval' && runtimeNode.status === 'READY' ? '<button id="approve-node">APPROVE</button>' : '';
  const retry = ['FAILED', 'RUNNING'].includes(runtimeNode.status) ? '<button id="retry-node">RETRY</button>' : '';
  const activity = runtimeNode.status === 'RUNNING'
    ? '<label for="runtime-activity">SAFE ACTIVITY UPDATE</label><input id="runtime-activity" maxlength="240"><button id="send-activity">REPORT ACTIVITY</button>'
    : '';
  return approve || retry || activity
    ? `<section class="runtime-controls"><label>RUNTIME CONTROL</label>${activity}<div class="button-row">${approve}${retry}</div></section>`
    : '';
}

function bindRuntimeControls(node) {
  const runId = catalog.live?.run?.runId;
  if (byId('approve-node')) byId('approve-node').onclick = () => mutateNode('/api/node/approve', { runId, nodeId: node.id });
  if (byId('retry-node')) byId('retry-node').onclick = () => mutateNode('/api/node/retry', { runId, nodeId: node.id });
  if (byId('send-activity')) {
    byId('send-activity').onclick = () => mutateNode('/api/node/activity', {
      runId, nodeId: node.id, message: byId('runtime-activity').value
    });
  }
}

async function mutateNode(endpoint, body) {
  try {
    await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
    await refreshLive();
    if (selectedId) selectNode(selectedId);
  } catch (error) {
    notify(error.message);
  }
}

function applyRecipeDetails() {
  draft.id = byId('recipe-id').value.trim();
  draft.version = Number(byId('recipe-version').value);
  draft.description = byId('recipe-description').value.trim();
  draft.compatibleModes = [...byId('recipe-modes').selectedOptions].map((option) => option.value);
  captureHistory();
  renderGraph();
  renderRecipeDetails();
  validateDraft();
}

function applyNodeDetails() {
  const node = draft.nodes.find((candidate) => candidate.id === selectedId);
  if (!node) return;
  const previousId = node.id;
  node.id = byId('node-id').value.trim();
  node.dependsOn = byId('node-dependencies').value.split(',').map((value) => value.trim()).filter(Boolean);
  draft.nodes.forEach((candidate) => {
    candidate.dependsOn = (candidate.dependsOn || []).map((dependency) => dependency === previousId ? node.id : dependency);
  });
  if (node.type === 'agent') {
    node.role = byId('node-extra').value.trim();
    node.context = { ...(node.context || {}), maxTokens: Number(byId('node-tokens').value) };
  } else if (node.type === 'approval') {
    node.message = byId('node-extra').value.trim();
  } else if (node.type === 'condition') {
    const field = byId('condition-field').value;
    const operator = byId('condition-operator').value;
    const rawValue = byId('condition-value').value.trim();
    node.expression = { field, operator };
    if (!['exists', 'isEmpty'].includes(operator)) {
      node.expression.value = field === 'run.iteration' || ['greaterThan', 'lessThan'].includes(operator) ? Number(rawValue) : rawValue;
    }
  }
  if (previousId !== node.id && positions.has(previousId)) {
    positions.set(node.id, positions.get(previousId));
    positions.delete(previousId);
  }
  selectedId = node.id;
  captureHistory();
  renderGraph();
  selectNode(node.id);
  validateDraft();
  saveLayoutSoon();
}

function deleteSelectedNode() {
  if (!selectedId) return;
  const removedId = selectedId;
  draft.nodes = draft.nodes.filter((node) => node.id !== removedId);
  draft.nodes.forEach((node) => {
    node.dependsOn = (node.dependsOn || []).filter((dependency) => dependency !== removedId);
  });
  positions.delete(removedId);
  selectedId = null;
  captureHistory();
  renderGraph();
  renderRecipeDetails();
  byId('inspector-panel').classList.remove('open');
  validateDraft();
  saveLayoutSoon();
}

function uniqueNodeId(type) {
  let suffix = draft.nodes.length + 1;
  while (draft.nodes.some((node) => node.id === `${type}-${suffix}`)) suffix += 1;
  return `${type}-${suffix}`;
}

function createNode(type, id = uniqueNodeId(type)) {
  const node = { id, type, dependsOn: [] };
  if (type === 'agent') {
    Object.assign(node, {
      role: 'analyst',
      context: { maxFiles: 10, maxTokens: 4000 },
      output: { artifact: `${id}-output`, schema: 'schemas/report.schema.json' }
    });
  } else if (type === 'approval') {
    node.message = 'Approve continuation.';
  } else if (type === 'condition') {
    node.expression = { field: 'run.mode', operator: 'equals', value: 'ASSISTED' };
  }
  return node;
}

function addNode(type, position = worldAtCanvasCenter()) {
  const node = createNode(type);
  draft.nodes.push(node);
  positions.set(node.id, { x: position.x - NODE_WIDTH / 2, y: position.y - NODE_PORT_Y });
  captureHistory();
  renderGraph();
  selectNode(node.id);
  byId('library-panel').classList.remove('open');
  validateDraft();
}

function duplicateSelectedNode() {
  const original = draft.nodes.find((node) => node.id === selectedId);
  if (!original) return;
  const clone = structuredClone(original);
  clone.id = uniqueNodeId(original.type);
  if (clone.output?.artifact) clone.output.artifact = `${clone.id}-output`;
  draft.nodes.push(clone);
  const originalPosition = positions.get(original.id);
  positions.set(clone.id, { x: originalPosition.x + 36, y: originalPosition.y + 132 });
  captureHistory();
  renderGraph();
  selectNode(clone.id);
  validateDraft();
}

function renderPalette() {
  byId('palette').innerHTML = catalog.nodeTypes.filter((node) => node.executable).map((node) => `
    <button class="palette-item" draggable="true" data-node-type="${escapeHtml(node.type)}">
      <b>${escapeHtml(node.label)}</b><small>${escapeHtml(node.category.toUpperCase())}</small>
    </button>
  `).join('');
  document.querySelectorAll('[data-node-type]').forEach((button) => {
    button.onclick = () => addNode(button.dataset.nodeType);
    button.ondragstart = (event) => {
      event.dataTransfer.setData('application/x-ael-node-type', button.dataset.nodeType);
      event.dataTransfer.effectAllowed = 'copy';
    };
  });
}

function beginNodeInteraction(event) {
  if (event.button !== 0 || event.target.closest('.port')) return;
  event.stopPropagation();
  const element = event.currentTarget;
  const nodeId = element.dataset.nodeId;
  selectNode(nodeId);
  if (spacePressed) return beginPan(event);
  const world = screenToWorld(event.clientX, event.clientY);
  const position = positions.get(nodeId);
  interaction = { type: 'node', pointerId: event.pointerId, nodeId, element, offsetX: world.x - position.x, offsetY: world.y - position.y };
  element.classList.add('dragging');
  element.setPointerCapture(event.pointerId);
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
  byId('canvas').setPointerCapture(event.pointerId);
}

function handlePointerMove(event) {
  if (connection) {
    const from = positions.get(connection.sourceId);
    const target = screenToWorld(event.clientX, event.clientY);
    const start = { x: from.x + NODE_WIDTH, y: from.y + NODE_PORT_Y };
    const bend = Math.max(55, Math.abs(target.x - start.x) * 0.42);
    byId('preview-edge').setAttribute('d', `M${start.x} ${start.y} C${start.x + bend} ${start.y},${target.x - bend} ${target.y},${target.x} ${target.y}`);
    return;
  }
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  if (interaction.type === 'node') {
    const world = screenToWorld(event.clientX, event.clientY);
    const position = { x: world.x - interaction.offsetX, y: world.y - interaction.offsetY };
    positions.set(interaction.nodeId, position);
    interaction.element.style.left = `${position.x}px`;
    interaction.element.style.top = `${position.y}px`;
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
  if (interaction.type === 'node') {
    interaction.element.classList.remove('dragging');
    captureHistory();
  }
  interaction = null;
  saveLayoutSoon();
}

function beginConnection(event) {
  event.preventDefault();
  event.stopPropagation();
  const sourceId = event.currentTarget.closest('.node').dataset.nodeId;
  connection = { sourceId, pointerId: event.pointerId };
  byId('preview-edge').style.display = 'block';
  event.currentTarget.setPointerCapture(event.pointerId);
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
  byId('preview-edge').style.display = 'none';
  const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest('.node');
  const targetId = targetElement?.dataset.nodeId;
  if (!targetId || targetId === sourceId) return;
  const target = draft.nodes.find((node) => node.id === targetId);
  if ((target.dependsOn || []).includes(sourceId)) return notify('Nodes are already connected.');
  if (transitivelyDependsOn(sourceId, targetId)) return notify('Connection rejected: it would create a cycle.');
  target.dependsOn = [...(target.dependsOn || []), sourceId];
  captureHistory();
  renderGraph();
  selectNode(targetId);
  validateDraft();
}

function zoomAt(nextScale, clientX, clientY) {
  const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextScale));
  const rect = byId('canvas').getBoundingClientRect();
  const x = clientX ?? rect.left + rect.width / 2;
  const y = clientY ?? rect.top + rect.height / 2;
  const world = screenToWorld(x, y);
  viewport.scale = scale;
  viewport.x = x - rect.left - world.x * scale;
  viewport.y = y - rect.top - world.y * scale;
  applyViewport();
  saveLayoutSoon();
}

function handleWheel(event) {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    zoomAt(viewport.scale * Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY);
  } else {
    viewport.x -= event.deltaX;
    viewport.y -= event.deltaY;
    applyViewport();
    saveLayoutSoon();
  }
}

function autoLayout({ record = true } = {}) {
  positions = defaultGraphPositions();
  renderGraph();
  fitView();
  if (record) captureHistory();
  saveLayoutSoon();
}

function fitView() {
  ensurePositions();
  if (!positions.size) return;
  const rect = byId('canvas').getBoundingClientRect();
  const values = [...positions.values()];
  const minX = Math.min(...values.map((position) => position.x));
  const minY = Math.min(...values.map((position) => position.y));
  const maxX = Math.max(...values.map((position) => position.x + NODE_WIDTH));
  const maxY = Math.max(...values.map((position) => position.y + 140));
  const padding = 100;
  viewport.scale = Math.max(MIN_ZOOM, Math.min(1.35, Math.min(
    (rect.width - padding * 2) / Math.max(1, maxX - minX),
    (rect.height - padding * 2) / Math.max(1, maxY - minY)
  )));
  viewport.x = (rect.width - (maxX - minX) * viewport.scale) / 2 - minX * viewport.scale;
  viewport.y = (rect.height - (maxY - minY) * viewport.scale) / 2 - minY * viewport.scale;
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
  byId('undo').disabled = historyIndex <= 0;
  byId('redo').disabled = historyIndex >= history.length - 1;
}

function restoreHistory(index) {
  if (index < 0 || index >= history.length) return;
  historyIndex = index;
  const snapshot = JSON.parse(history[index]);
  draft = snapshot.draft;
  positions = new Map(Object.entries(snapshot.positions));
  if (!draft.nodes.some((node) => node.id === selectedId)) selectedId = null;
  renderGraph();
  if (selectedId) selectNode(selectedId);
  else renderRecipeDetails();
  validateDraft();
  saveLayoutSoon();
  byId('undo').disabled = historyIndex <= 0;
  byId('redo').disabled = historyIndex >= history.length - 1;
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
    const result = await api('/api/validate', { method: 'POST', body: JSON.stringify({ recipe: draft }) });
    if (sequence !== validationSequence) return;
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
  } catch (error) {
    if (sequence !== validationSequence) return;
    byId('integrity').textContent = `INVALID / ${error.message}`;
    byId('integrity').className = 'invalid';
    byId('review').disabled = true;
  }
}

function renderLive() {
  const live = catalog.live;
  if (!live) {
    byId('run-summary').textContent = 'No active run';
    byId('active-stage').textContent = 'No active run';
    byId('activity').textContent = 'Waiting for a recipe-bound workflow.';
    byId('events').innerHTML = '';
    byId('budget').textContent = '—';
    byId('meter').style.width = '0';
    updateRuntimePresentation();
    return;
  }
  const active = live.plan.nodes.find((node) => live.nodes[node.id].status === 'RUNNING')
    || live.plan.nodes.find((node) => live.nodes[node.id].status === 'READY');
  const runtimeNode = active ? live.nodes[active.id] : null;
  byId('run-summary').textContent = active ? `${active.id} · ${runtimeNode.status}` : `Run ${live.run.state}`;
  byId('active-stage').textContent = active?.id || 'Run complete';
  byId('activity').textContent = active ? runtimeNode.activity || `${runtimeNode.status} · attempt ${runtimeNode.attempts}` : `Final state: ${live.run.state}`;
  const spent = live.budget.spentThisRun;
  const limit = live.budget.perRunTokenLimit;
  byId('meter').style.width = `${Math.min(100, limit ? (spent / limit) * 100 : 0)}%`;
  byId('budget').textContent = `${spent.toLocaleString()} / ${limit.toLocaleString()} TOKENS`;
  byId('events').innerHTML = live.events.slice(-7).reverse().map((event) => `
    <p class="${event.type === 'NODE_ACTIVITY' || event.type.includes('START') ? 'event-active' : ''}">
      ${escapeHtml(event.at.slice(11, 19))} · ${escapeHtml(event.type)} · ${escapeHtml(event.changedNodes.join(', '))}
    </p>
  `).join('');
  updateRuntimePresentation();
}

async function refreshLive() {
  try {
    const result = await api('/api/live');
    catalog.live = result.live;
    renderLive();
  } catch {
    // A transient refresh failure must not discard the draft.
  }
}

async function loadRecipe() {
  const id = byId('recipe').value;
  const [result, saved] = await Promise.all([
    api(`/api/recipe?id=${encodeURIComponent(id)}`),
    api(`/api/layout?id=${encodeURIComponent(id)}`)
  ]);
  draft = structuredClone(result.recipe);
  source = result.source;
  loadedRecipeId = draft.id;
  selectedId = null;
  byId('inspector-panel').classList.remove('open');
  positions = new Map(Object.entries(saved.layout?.positions || {}));
  ensurePositions();
  viewport = saved.layout?.viewport || { x: 0, y: 0, scale: 1 };
  renderGraph();
  if (!saved.layout || (draft.nodes.length <= 12 && viewport.scale < 0.45)) fitView();
  renderRecipeDetails();
  captureHistory({ reset: true });
  validateDraft();
}

async function refreshCatalog(selectedRecipe) {
  catalog = await api('/api/bootstrap');
  const selector = byId('recipe');
  selector.innerHTML = catalog.recipes.map((recipe) => (
    `<option value="${escapeHtml(recipe.id)}">${escapeHtml(recipe.id)} · v${escapeHtml(recipe.version)}</option>`
  )).join('');
  if (selectedRecipe && catalog.recipes.some((recipe) => recipe.id === selectedRecipe)) selector.value = selectedRecipe;
  renderPalette();
  renderLive();
}

function bindCanvas() {
  const canvas = byId('canvas');
  canvas.addEventListener('pointerdown', (event) => {
    if (event.target === canvas || event.target === byId('scene') || event.target === byId('nodes') || event.target === byId('edges')) {
      selectedId = null;
      updateSelection();
      renderRecipeDetails();
      byId('inspector-panel').classList.remove('open');
      beginPan(event);
    }
  });
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', finishPointer);
  canvas.addEventListener('pointercancel', finishPointer);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('application/x-ael-node-type')) return;
    event.preventDefault();
    canvas.classList.add('drop-ready');
  });
  canvas.addEventListener('dragleave', () => canvas.classList.remove('drop-ready'));
  canvas.addEventListener('drop', (event) => {
    event.preventDefault();
    canvas.classList.remove('drop-ready');
    const type = event.dataTransfer.getData('application/x-ael-node-type');
    if (type) addNode(type, screenToWorld(event.clientX, event.clientY));
  });
  byId('auto-layout').onclick = () => autoLayout();
  byId('fit-view').onclick = fitView;
  byId('fit-view-rail').onclick = fitView;
  byId('zoom-in').onclick = () => zoomAt(viewport.scale * 1.2);
  byId('zoom-out').onclick = () => zoomAt(viewport.scale / 1.2);
  byId('undo').onclick = () => restoreHistory(historyIndex - 1);
  byId('redo').onclick = () => restoreHistory(historyIndex + 1);
}

function editableTarget(target) {
  return target.matches('input,textarea,select,[contenteditable="true"]');
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
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
    event.preventDefault();
    deleteSelectedNode();
  }
});
document.addEventListener('keyup', (event) => {
  if (event.code === 'Space') spacePressed = false;
});
window.addEventListener('blur', () => { spacePressed = false; });

byId('copy').onclick = async () => {
  try {
    const handoff = await api('/api/handoff?audience=developer');
    await navigator.clipboard.writeText(handoff.brief);
    notify('Redacted developer brief copied.');
  } catch (error) {
    notify(error.message);
  }
};

byId('download').onclick = async () => {
  try {
    const handoff = await api('/api/handoff?audience=agent');
    const blob = new Blob([JSON.stringify(handoff.bundle, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${handoff.bundle.runId}.ael-handoff.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    notify('Integrity-bound handoff exported.');
  } catch (error) {
    notify(error.message);
  }
};

byId('record-decision').onclick = async () => {
  if (!catalog.live) return notify('Start a workflow run before recording a decision.');
  try {
    await api('/api/decision', {
      method: 'POST',
      body: JSON.stringify({
        runId: catalog.live.run.runId,
        summary: byId('decision-summary').value,
        rationale: byId('decision-rationale').value,
        consequences: []
      })
    });
    byId('decision-summary').value = '';
    byId('decision-rationale').value = '';
    notify('Redacted decision recorded for handoff.');
  } catch (error) {
    notify(error.message);
  }
};

byId('review').onclick = () => byId('confirm').showModal();
byId('cancel').onclick = () => byId('confirm').close();
byId('install').onclick = async () => {
  try {
    await api('/api/install', {
      method: 'POST',
      body: JSON.stringify({
        recipe: draft,
        layout: layoutPayload(),
        replace: catalog.recipes.some((recipe) => recipe.id === draft.id)
      })
    });
    byId('confirm').close();
    notify('Recipe and private canvas layout installed atomically.');
    await refreshCatalog(draft.id);
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
  await refreshCatalog('default');
  byId('recipe').onchange = loadRecipe;
  bindCanvas();
  byId('toggle-library').onclick = () => byId('library-panel').classList.toggle('open');
  byId('quick-add').onclick = () => byId('library-panel').classList.add('open');
  byId('close-library').onclick = () => byId('library-panel').classList.remove('open');
  byId('workflow-settings').onclick = () => {
    selectedId = null;
    updateSelection();
    renderRecipeDetails();
    byId('inspector-panel').classList.add('open');
  };
  byId('close-inspector').onclick = () => byId('inspector-panel').classList.remove('open');
  byId('toggle-execution').onclick = () => byId('execution-panel').classList.toggle('open');
  byId('close-execution').onclick = () => byId('execution-panel').classList.remove('open');
  await loadRecipe();
  clearInterval(liveTimer);
  liveTimer = setInterval(refreshLive, 1800);
}

initialize().catch((error) => notify(error.message));
