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
let selectedIds = new Set();
let selectedEdgeId;
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
let pendingConnectionSource;
let runs = [];
let goal = { text: '', version: 1, frozen: false };
let activeRunId;
let pendingImport;
let hydratedGoalKey;
let selectedCheckoutRun;

const DISPLAY_NAME_MAX = 80;
const ROOT_TYPES = new Set(['goal-contract', 'trigger']);

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

function validDisplayName(value) {
  const name = String(value || '').trim();
  if (!name) return 'Display Name is required.';
  if (name.length > DISPLAY_NAME_MAX) return `Display Name must be ${DISPLAY_NAME_MAX} characters or fewer.`;
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'Display Name cannot contain control characters.';
  return '';
}

function isInputTarget(target) {
  return target instanceof Element && Boolean(target.closest('input,textarea,select,button,[contenteditable="true"],dialog'));
}

function csv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function slug(value) {
  return String(value || 'run').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'run';
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
  const container = byId('loop-groups');
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
        <button type="button" aria-label="Remove ${escapeHtml(loopGroup.displayName)} group">Ungroup</button>
      </header>
    `;
    element.querySelector('button').onclick = (event) => {
      event.stopPropagation();
      draft.loopGroups = draft.loopGroups.filter((candidate) => candidate.id !== loopGroup.id);
      captureHistory();
      renderGraph();
      validateDraft();
    };
    element.querySelector('header').onpointerdown = (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault();
      event.stopPropagation();
      const world = screenToWorld(event.clientX, event.clientY);
      interaction = {
        type: 'group',
        pointerId: event.pointerId,
        groupId: loopGroup.id,
        start: world,
        element: byId('canvas'),
        origins: new Map(loopGroup.nodeIds.map((nodeId) => [nodeId, { ...positions.get(nodeId) }]))
      };
      selectedIds = new Set(loopGroup.nodeIds);
      selectedId = loopGroup.decisionNodeId;
      updateSelection();
      byId('canvas').setPointerCapture(event.pointerId);
    };
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
  return stages[node.type] || `CUSTOM ${String(index + 1).padStart(2, '0')}`;
}

function renderEdges() {
  const group = byId('edge-paths');
  const controls = byId('edge-controls');
  group.innerHTML = '';
  controls.innerHTML = '';
  if (!draft) return;
  draft.edges.forEach((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', edgePath(from, to));
    path.setAttribute('class', `${catalog.live?.nodes?.[edge.from]?.status === 'RUNNING' ? 'edge active' : 'edge'}${selectedEdgeId === edge.id ? ' selected' : ''}`);
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
    let hideTimer;
    path.onpointerenter = () => {
      clearTimeout(hideTimer);
      control.classList.add('visible');
    };
    path.onpointerleave = () => {
      hideTimer = setTimeout(() => control.classList.remove('visible'), 100);
    };
    control.onpointerenter = () => {
      clearTimeout(hideTimer);
      control.classList.add('visible');
    };
    control.onpointerleave = () => control.classList.remove('visible');
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
  for (const loopGroup of draft.loopGroups || []) {
    const from = positions.get(loopGroup.decisionNodeId);
    const to = positions.get(loopGroup.repeatTargetId);
    const bounds = loopBounds(loopGroup);
    if (!from || !to || !bounds) continue;
    const returnPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    returnPath.setAttribute(
      'd',
      `M${from.x + NODE_WIDTH} ${from.y + NODE_PORT_Y} H${bounds.right + 28} V${bounds.top - 18} H${to.x - 28} V${to.y + NODE_PORT_Y} H${to.x}`
    );
    returnPath.setAttribute('class', 'edge loop-return');
    returnPath.setAttribute('marker-end', 'url(#arrow)');
    group.append(returnPath);
    const label = document.createElement('span');
    label.className = 'edge-label loop-label';
    label.style.left = `${bounds.right + 28}px`;
    label.style.top = `${bounds.top - 18}px`;
    label.textContent = loopGroup.repeatLabel;
    controls.append(label);
  }
}

function nodeMarkup(node, index) {
  const runtimeNode = catalog.live?.nodes?.[node.id];
  const outgoing = draft.edges.some((edge) => edge.from === node.id);
  const root = rootCandidates().length === 1 && rootCandidates()[0].id === node.id;
  return `
    <button class="port port-in" aria-label="Input for ${escapeHtml(node.id)}" tabindex="-1"></button>
    <small>${escapeHtml(stageLabel(node, index))} / ${escapeHtml(node.type.toUpperCase())}</small>
    <button class="node-title" title="Double-click to edit Display Name">${escapeHtml(displayName(node))}</button>
    <span class="technical-id">${escapeHtml(node.id)}</span>
    <span class="status">● ${escapeHtml(runtimeNode?.status || 'DRAFT')}</span>
    ${runtimeNode?.activity ? `<p class="node-activity">${escapeHtml(runtimeNode.activity)}</p>` : ''}
    <button class="port port-out" aria-label="Connect from ${escapeHtml(node.id)}" tabindex="-1"></button>
    ${outgoing ? '' : `<button class="output-add" title="Add connected node" aria-label="Add node connected after ${escapeHtml(displayName(node))}">+</button>`}
    ${root ? `<div class="execute-pod"><input class="task-input" aria-label="Task for this run" placeholder="Describe this run’s task" value="${escapeHtml(catalog.live?.run?.task || '')}"><button class="execute-trigger">${goal.frozen ? 'Execute' : 'Set Goal'}</button><span class="execute-hint">${goal.frozen ? 'Local runtime only' : 'Freeze Goal first'}</span></div>` : ''}
  `;
}

function renderGraph() {
  ensurePositions();
  renderLoopGroups();
  const container = byId('nodes');
  container.innerHTML = '';
  draft.nodes.forEach((node, index) => {
    const position = positions.get(node.id);
    const runtimeNode = catalog.live?.nodes?.[node.id];
    const element = document.createElement('article');
    element.dataset.nodeId = node.id;
    element.className = `node ${runtimeNode?.status.toLowerCase() || ''} ${selectedIds.has(node.id) ? 'selected' : ''}`;
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    element.innerHTML = nodeMarkup(node, index);
    element.addEventListener('pointerdown', beginNodeInteraction);
    element.querySelector('.port-out').addEventListener('pointerdown', beginConnection);
    element.querySelector('.node-title').addEventListener('dblclick', beginInlineRename);
    element.querySelector('.output-add')?.addEventListener('click', openContextualAdd);
    element.querySelector('.execute-trigger')?.addEventListener('click', executeFromTrigger);
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
    element.classList.toggle('selected', selectedIds.has(element.dataset.nodeId));
  });
  const actions = byId('selection-actions');
  actions.hidden = selectedIds.size < 2;
  byId('selection-count').textContent = `${selectedIds.size} nodes`;
  const grouped = [...selectedIds].some((nodeId) =>
    (draft?.loopGroups || []).some((group) => group.nodeIds.includes(nodeId))
  );
  byId('create-loop-group').disabled = grouped;
  byId('create-loop-group').title = grouped ? 'Ungroup selected steps before creating another Loop Group' : '';
}

function renderRecipeDetails() {
  const existing = recipeSummary();
  byId('inspector-label').textContent = 'WORKFLOW';
  byId('inspector-title').textContent = draft.id;
  byId('inspector-title').contentEditable = 'false';
  byId('inspector-title').onkeydown = null;
  byId('inspector-title').onblur = null;
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

function selectNode(nodeId, { additive = false } = {}) {
  const node = draft.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return;
  if (additive) {
    if (selectedIds.has(nodeId)) selectedIds.delete(nodeId);
    else selectedIds.add(nodeId);
  } else {
    selectedIds = new Set([nodeId]);
  }
  selectedEdgeId = null;
  selectedId = nodeId;
  updateSelection();
  const runtimeNode = catalog.live?.nodes?.[nodeId];
  byId('inspector-label').textContent = 'NODE';
  byId('inspector-title').textContent = displayName(node);
  byId('inspector-title').contentEditable = 'true';
  byId('inspector-title').title = 'Edit Display Name';
  byId('inspector-title').onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.currentTarget.textContent = displayName(node);
      event.currentTarget.blur();
    }
  };
  byId('inspector-title').onblur = (event) => applyDisplayName(node, event.currentTarget.textContent);
  byId('inspector-panel').classList.add('open');
  byId('details').innerHTML = `
    <div class="source-line"><span>${escapeHtml(node.type.toUpperCase())}</span><span>${escapeHtml(runtimeNode?.status || 'DRAFT')}</span></div>
    <div id="name-validation" class="validation-message" aria-live="polite"></div>
    <label for="node-id">Technical ID</label><input id="node-id" value="${escapeHtml(node.id)}" disabled>
    ${node.type === 'delivery' ? deliveryAdapterControls() : ''}
    <details>
      <summary>Settings</summary>
      <div class="settings-body">
        <label>Type</label><input value="${escapeHtml(node.type)}" disabled>
        <label for="node-dependencies">Inputs</label>
        <input id="node-dependencies" value="${escapeHtml((node.dependsOn || []).join(', '))}" placeholder="Connect nodes on the canvas">
        ${node.type === 'agent' ? `
          <label for="node-extra">Role</label><input id="node-extra" value="${escapeHtml(node.role || '')}">
          ${node.prompt != null ? customAgentFields(node) : ''}
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

function customAgentFields(node) {
  return `
    <label for="custom-node-prompt">Prompt</label><textarea id="custom-node-prompt">${escapeHtml(node.prompt || '')}</textarea>
    <label for="custom-node-capabilities">Capabilities</label><input id="custom-node-capabilities" value="${escapeHtml((node.capabilityRefs || []).join(', '))}">
    <label for="custom-node-mcp">MCP references</label><input id="custom-node-mcp" value="${escapeHtml((node.mcpRefs || []).join(', '))}">
    <label for="custom-node-inputs">Input artifacts</label><input id="custom-node-inputs" value="${escapeHtml((node.inputArtifacts || []).join(', '))}">
    <label for="custom-node-output">Output artifact</label><input id="custom-node-output" value="${escapeHtml(node.outputArtifacts?.[0]?.artifact || '')}">
    <label for="custom-node-schema">Output schema</label><input id="custom-node-schema" value="${escapeHtml(node.outputArtifacts?.[0]?.schema || 'schemas/report.schema.json')}">
    <label for="custom-node-timeout">Timeout (sec)</label><input id="custom-node-timeout" type="number" min="1" value="${escapeHtml(Math.round((node.timeoutMs || 900000) / 1000))}">
    <label for="custom-node-retries">Maximum attempts</label><input id="custom-node-retries" type="number" min="1" value="${escapeHtml(node.retry?.maxAttempts ?? 2)}">
  `;
}

function applyDisplayName(node, value) {
  const error = validDisplayName(value);
  const message = byId('name-validation');
  if (error) {
    if (message) message.textContent = error;
    byId('inspector-title').textContent = displayName(node);
    return false;
  }
  const next = value.trim();
  if (next === displayName(node)) return true;
  node.displayName = next;
  captureHistory();
  renderGraph();
  selectNode(node.id);
  return true;
}

function beginInlineRename(event) {
  event.preventDefault();
  event.stopPropagation();
  const node = draft.nodes.find((candidate) => candidate.id === event.currentTarget.closest('.node').dataset.nodeId);
  const input = document.createElement('input');
  input.className = 'inline-rename';
  input.maxLength = DISPLAY_NAME_MAX;
  input.value = displayName(node);
  event.currentTarget.replaceWith(input);
  input.focus();
  input.select();
  let saved = false;
  const finish = () => {
    if (saved) return;
    saved = true;
    const error = validDisplayName(input.value);
    if (error) notify(error);
    else if (input.value.trim() !== displayName(node)) {
      node.displayName = input.value.trim();
      captureHistory();
    }
    renderGraph();
    selectNode(node.id);
  };
  input.onkeydown = (keyEvent) => {
    if (keyEvent.key === 'Enter') input.blur();
    if (keyEvent.key === 'Escape') {
      input.value = displayName(node);
      input.blur();
    }
  };
  input.onblur = finish;
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
  const custom = node.type === 'agent' && node.prompt && ['READY', 'RUNNING'].includes(runtimeNode.status) ? `
    <p class="hint">This node is waiting for an external operator. Studio does not execute the agent independently.</p>
    <button id="copy-agent-command">Copy command</button>
    ${runtimeNode.status === 'READY'
      ? '<button id="start-agent-node">Mark running</button>'
      : '<label for="agent-evidence">Run-bound evidence JSON path</label><input id="agent-evidence" placeholder=".ai-engineering-loop/runs/…/agent-report.json"><button id="complete-agent-node">Complete with evidence</button>'}
  ` : '';
  const activity = runtimeNode.status === 'RUNNING'
    ? '<label for="runtime-activity">SAFE ACTIVITY UPDATE</label><input id="runtime-activity" maxlength="240"><button id="send-activity">REPORT ACTIVITY</button>'
    : '';
  return approve || retry || activity || custom
    ? `<section class="runtime-controls"><label>RUNTIME CONTROL</label>${custom}${activity}<div class="button-row">${approve}${retry}</div></section>`
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
  if (byId('copy-agent-command')) byId('copy-agent-command').onclick = async () => {
    await navigator.clipboard.writeText(`ai-engineering-loop node start ${node.id} --run ${runId}`);
    notify('External operator command copied.');
  };
  if (byId('start-agent-node')) byId('start-agent-node').onclick = () => mutateNode('/api/node/start', { runId, nodeId: node.id });
  if (byId('complete-agent-node')) byId('complete-agent-node').onclick = () => mutateNode('/api/node/complete', {
    runId,
    nodeId: node.id,
    artifact: byId('agent-evidence').value.trim()
  });
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
  if (!applyDisplayName(node, byId('inspector-title').textContent)) return;
  const inputs = csv(byId('node-dependencies').value);
  draft.edges = draft.edges.filter((edge) => edge.to !== node.id);
  inputs.forEach((from, index) => {
    if (from !== node.id && draft.nodes.some((candidate) => candidate.id === from)) {
      draft.edges.push({ id: uniqueEdgeId(from, node.id), from, to: node.id });
    }
  });
  syncDependencies();
  if (node.type === 'agent') {
    node.role = byId('node-extra').value.trim();
    node.context = { ...(node.context || {}), maxTokens: Number(byId('node-tokens').value) };
    if (node.prompt != null) {
      node.prompt = byId('custom-node-prompt').value.trim();
      node.capabilityRefs = csv(byId('custom-node-capabilities').value);
      node.mcpRefs = csv(byId('custom-node-mcp').value);
      node.inputArtifacts = csv(byId('custom-node-inputs').value);
      node.outputArtifacts = [{
        artifact: byId('custom-node-output').value.trim(),
        schema: byId('custom-node-schema').value.trim()
      }];
      node.tokenLimit = Number(byId('node-tokens').value);
      node.timeoutMs = Number(byId('custom-node-timeout').value) * 1000;
      node.retry = {
        maxAttempts: Number(byId('custom-node-retries').value),
        backoffMs: node.retry?.backoffMs || 1000
      };
    }
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
  captureHistory();
  renderGraph();
  selectNode(node.id);
  validateDraft();
  saveLayoutSoon();
}

function deleteSelectedNode() {
  if (!selectedIds.size) return;
  const removed = new Set(selectedIds);
  const containingGroup = (draft.loopGroups || []).find((group) =>
    group.nodeIds.some((nodeId) => removed.has(nodeId))
  );
  if (containingGroup) {
    notify(`Ungroup “${containingGroup.displayName}” before deleting its steps.`);
    return;
  }
  draft.nodes = draft.nodes.filter((node) => !removed.has(node.id));
  draft.edges = draft.edges.filter((edge) => !removed.has(edge.from) && !removed.has(edge.to));
  syncDependencies();
  removed.forEach((id) => positions.delete(id));
  selectedId = null;
  selectedIds.clear();
  captureHistory();
  renderGraph();
  renderRecipeDetails();
  byId('inspector-panel').classList.remove('open');
  validateDraft();
  saveLayoutSoon();
}

function deleteEdge(id) {
  const before = draft.edges.length;
  draft.edges = draft.edges.filter((edge) => edge.id !== id);
  if (draft.edges.length === before) return;
  syncDependencies();
  selectedEdgeId = null;
  captureHistory();
  renderGraph();
  validateDraft();
}

function uniqueNodeId(type) {
  let suffix = draft.nodes.length + 1;
  while (draft.nodes.some((node) => node.id === `${type}-${suffix}`)) suffix += 1;
  return `${type}-${suffix}`;
}

function createNode(type, id = uniqueNodeId(type)) {
  const label = catalog.nodeTypes.find((candidate) => candidate.type === type)?.label || type.replaceAll('-', ' ');
  const node = { id, type, displayName: label, dependsOn: [] };
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
  if (pendingConnectionSource) {
    draft.edges.push({ id: uniqueEdgeId(pendingConnectionSource, node.id), from: pendingConnectionSource, to: node.id });
    syncDependencies();
    pendingConnectionSource = null;
  }
  positions.set(node.id, { x: position.x - NODE_WIDTH / 2, y: position.y - NODE_PORT_Y });
  captureHistory();
  renderGraph();
  selectNode(node.id);
  byId('library-panel').classList.remove('open');
  validateDraft();
}

function duplicateSelectedNode() {
  if (!selectedIds.size) return;
  const originals = draft.nodes.filter((node) => selectedIds.has(node.id));
  const mapping = new Map();
  const clones = originals.map((original) => {
    const clone = structuredClone(original);
    clone.id = uniqueNodeId(original.type);
    while (draft.nodes.some((node) => node.id === clone.id) || mapping.has(clone.id)) clone.id = `${clone.id}-copy`;
    clone.displayName = `${displayName(original)} copy`;
    if (clone.output?.artifact) clone.output.artifact = `${clone.id}-output`;
    mapping.set(original.id, clone.id);
    const originalPosition = positions.get(original.id);
    positions.set(clone.id, { x: originalPosition.x + 36, y: originalPosition.y + 132 });
    draft.nodes.push(clone);
    return clone;
  });
  const copiedEdges = draft.edges.filter((edge) => mapping.has(edge.from) && mapping.has(edge.to)).map((edge) => ({
    id: uniqueEdgeId(mapping.get(edge.from), mapping.get(edge.to)),
    from: mapping.get(edge.from),
    to: mapping.get(edge.to)
  }));
  draft.edges.push(...copiedEdges);
  syncDependencies();
  const cloneIds = new Set(clones.map((node) => node.id));
  selectedId = clones.at(-1)?.id;
  captureHistory();
  renderGraph();
  if (selectedId) selectNode(selectedId);
  selectedIds = cloneIds;
  updateSelection();
  validateDraft();
}

function openContextualAdd(event) {
  event.stopPropagation();
  pendingConnectionSource = event.currentTarget.closest('.node').dataset.nodeId;
  byId('library-panel').classList.add('open');
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
  if (event.button !== 0 || event.target.closest('.port,.output-add,.execute-pod,.node-title,.inline-rename')) return;
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
    const origin = interaction.origins.get(interaction.nodeId);
    const delta = { x: position.x - origin.x, y: position.y - origin.y };
    interaction.origins.forEach((start, id) => {
      const next = { x: start.x + delta.x, y: start.y + delta.y };
      positions.set(id, next);
      const nodeElement = document.querySelector(`.node[data-node-id="${CSS.escape(id)}"]`);
      if (nodeElement) {
        nodeElement.style.left = `${next.x}px`;
        nodeElement.style.top = `${next.y}px`;
      }
    });
    renderEdges();
  } else if (interaction.type === 'group') {
    const world = screenToWorld(event.clientX, event.clientY);
    const delta = { x: world.x - interaction.start.x, y: world.y - interaction.start.y };
    interaction.origins.forEach((start, id) => {
      positions.set(id, { x: start.x + delta.x, y: start.y + delta.y });
    });
    renderGraph();
  } else if (interaction.type === 'lasso') {
    updateLasso(event);
  } else {
    viewport.x = interaction.viewportX + event.clientX - interaction.startX;
    viewport.y = interaction.viewportY + event.clientY - interaction.startY;
    applyViewport();
  }
}

function finishPointer(event) {
  if (connection && connection.pointerId === event.pointerId) return finishConnection(event);
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  if (interaction.type === 'node' || interaction.type === 'group') {
    interaction.element.classList.remove('dragging');
    captureHistory();
  } else if (interaction.type === 'lasso') finishLasso();
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
  if (draft.edges.some((edge) => edge.from === sourceId && edge.to === targetId)) return notify('Nodes are already connected.');
  if (transitivelyDependsOn(sourceId, targetId)) return notify('Connection rejected: it would create a cycle.');
  draft.edges.push({ id: uniqueEdgeId(sourceId, targetId), from: sourceId, to: targetId });
  syncDependencies();
  captureHistory();
  renderGraph();
  selectNode(targetId);
  validateDraft();
}

function beginLasso(event) {
  const start = screenToWorld(event.clientX, event.clientY);
  interaction = { type: 'lasso', pointerId: event.pointerId, start, current: start, additive: event.shiftKey };
  const marquee = byId('selection-marquee');
  marquee.style.display = 'block';
  marquee.style.left = `${start.x}px`;
  marquee.style.top = `${start.y}px`;
  marquee.style.width = '0';
  marquee.style.height = '0';
  byId('canvas').setPointerCapture(event.pointerId);
}

function updateLasso(event) {
  interaction.current = screenToWorld(event.clientX, event.clientY);
  const left = Math.min(interaction.start.x, interaction.current.x);
  const top = Math.min(interaction.start.y, interaction.current.y);
  const right = Math.max(interaction.start.x, interaction.current.x);
  const bottom = Math.max(interaction.start.y, interaction.current.y);
  const marquee = byId('selection-marquee');
  Object.assign(marquee.style, {
    left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`
  });
  const next = interaction.additive ? new Set(selectedIds) : new Set();
  positions.forEach((position, id) => {
    if (position.x < right && position.x + NODE_WIDTH > left && position.y < bottom && position.y + 110 > top) next.add(id);
  });
  selectedIds = next;
  selectedId = [...next].at(-1) || null;
  updateSelection();
}

function finishLasso() {
  byId('selection-marquee').style.display = 'none';
  const finalSelection = new Set(selectedIds);
  if (selectedId) selectNode(selectedId);
  selectedIds = finalSelection;
  updateSelection();
}

function rootCandidates() {
  if (!draft) return [];
  const incoming = new Set(draft.edges.map((edge) => edge.to));
  return draft.nodes.filter((node) => ROOT_TYPES.has(node.type) || !incoming.has(node.id));
}

async function executeFromTrigger(event) {
  event.stopPropagation();
  const candidates = rootCandidates();
  if (candidates.length !== 1) return notify(`Execute requires exactly one trigger/root; found ${candidates.length}.`);
  const task = event.currentTarget.closest('.execute-pod').querySelector('.task-input').value.trim();
  if (task) byId('goal-task').value = task;
  if (!goal.frozen || !activeRunId) {
    byId('goal-dialog').showModal();
    return notify('Save and freeze the Goal Contract before execution.');
  }
  try {
    await api(`/api/runs/${encodeURIComponent(activeRunId)}/execute`, {
      method: 'POST',
      body: '{}'
    });
    notify('Local runtime started. External AI dispatch remains disabled.');
    await refreshLive();
  } catch (error) {
    notify(error.message);
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
  if (activeRunId && catalog.live?.run && !['DELIVERED', 'REPORTED', 'ESCALATED'].includes(catalog.live.run.state)) {
    return activeRunId;
  }
  const task = byId('goal-task').value.trim();
  const created = await api('/api/runs', {
    method: 'POST',
    body: JSON.stringify({
      task,
      constraints: byId('goal-constraints').value.trim(),
      displayName: byId('goal-run-name').value.trim(),
      recipeId: loadedRecipeId,
      mode: draft.compatibleModes.includes('ASSISTED') ? 'ASSISTED' : draft.compatibleModes[0]
    })
  });
  activeRunId = created.run.runId;
  await refreshLive();
  return activeRunId;
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
    const contract = goalContractFromForm(runId);
    await api(`/api/runs/${encodeURIComponent(runId)}/goal`, {
      method: 'PUT',
      body: JSON.stringify({ goal: contract })
    });
    goal = { text: contract.objective, criteria: contract.acceptanceCriteria, version: goal.version, frozen: false };
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
  byId('goal-version').textContent = `V${goal.version}`;
  byId('goal-text').disabled = goal.frozen;
  byId('goal-criteria').disabled = goal.frozen;
  byId('goal-task').disabled = goal.frozen;
  byId('goal-constraints').disabled = goal.frozen;
  byId('goal-run-name').disabled = goal.frozen;
  byId('save-goal').hidden = goal.frozen;
  byId('review-goal').hidden = goal.frozen;
  byId('confirm-freeze').hidden = true;
  byId('unfreeze-goal').hidden = !goal.frozen;
}

async function reviewGoal() {
  const contract = await saveGoalFromForm();
  if (!contract) return;
  byId('goal-dialog').showModal();
  byId('goal-dialog').querySelector('.advanced-goal').open = true;
  byId('goal-review').hidden = false;
  byId('goal-review').innerHTML = `
    <strong>${escapeHtml(contract.objective)}</strong>
    <p>${contract.acceptanceCriteria.length} numbered acceptance failure rows are ready.</p>
  `;
  byId('confirm-freeze').hidden = false;
}

async function freezeGoalFromForm() {
  try {
    const result = await api(`/api/runs/${encodeURIComponent(activeRunId)}/goal/freeze`, {
      method: 'POST',
      body: JSON.stringify({ actor: 'studio-user' })
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
  const fields = byId('unfreeze-fields');
  if (fields.hidden) {
    fields.hidden = false;
    byId('unfreeze-reason').focus();
    return;
  }
  try {
    const result = await api(`/api/runs/${encodeURIComponent(activeRunId)}/goal/unfreeze`, {
      method: 'POST',
      body: JSON.stringify({ actor: 'studio-user', reason: byId('unfreeze-reason').value })
    });
    goal.frozen = false;
    goal.version = result.run.goal.version;
    fields.hidden = true;
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
  activeRunId = catalog.live?.run?.runId || null;
  if (!liveGoal) return;
  goal.version = liveGoal.version || 1;
  goal.frozen = liveGoal.frozen === true;
  if (catalog.live.run.task) byId('goal-task').value = catalog.live.run.task;
  if (catalog.live.run.constraints) byId('goal-constraints').value = catalog.live.run.constraints;
  if (catalog.live.run.displayName) byId('goal-run-name').value = catalog.live.run.displayName;
  renderGoalState();
}

async function hydrateGoalFromLive() {
  const run = catalog.live?.run;
  const artifactPath = run?.artifacts?.goalContract?.path;
  const key = `${run?.runId || ''}:${run?.goal?.version || 1}:${artifactPath || ''}`;
  if (!artifactPath || hydratedGoalKey === key) return;
  try {
    const result = await api(`/api/runs/${encodeURIComponent(run.runId)}/artifacts?path=${encodeURIComponent(artifactPath)}`);
    const contract = JSON.parse(result.artifact.content);
    byId('goal-text').value = contract.objective || '';
    byId('goal-criteria').value = (contract.acceptanceCriteria || []).map((criterion) => (
      `${criterion.statement} | ${criterion.evidenceRequired} | ${(criterion.failureCases || []).join(' | ')}`
    )).join('\n');
    goal.text = contract.objective || '';
    goal.criteria = contract.acceptanceCriteria || [];
    hydratedGoalKey = key;
  } catch {
    // The Goal remains inspectable through Run History if its bounded artifact cannot be hydrated.
  }
}

async function loadRuns() {
  const query = byId('run-search').value.trim();
  try {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (byId('run-status').value) params.set('status', byId('run-status').value);
    if (byId('run-mode').value) params.set('mode', byId('run-mode').value);
    if (byId('run-from').value) params.set('from', `${byId('run-from').value}T00:00:00.000Z`);
    if (byId('run-to').value) params.set('to', `${byId('run-to').value}T23:59:59.999Z`);
    const result = await api(`/api/runs${params.size ? `?${params}` : ''}`);
    runs = result.runs;
    const list = byId('run-list');
    if (!runs.length) {
      list.innerHTML = '<div class="empty-state"><h2>No runs found</h2><p>Create a task from the workflow trigger.</p></div>';
    } else {
      list.innerHTML = runs.map((run) => `
        <button class="run-row" data-run-id="${escapeHtml(run.runId)}">
          <strong>${escapeHtml(run.displayName)}</strong>
          <span>${escapeHtml(run.status)} · ${escapeHtml(new Date(run.updatedAt).toLocaleString())}</span>
          <small>${escapeHtml(run.task)}</small>
        </button>
      `).join('');
      list.querySelectorAll('.run-row').forEach((button) => {
        button.onclick = () => loadRunDetail(button.dataset.runId);
      });
    }
    if (result.corrupt.length) {
      list.insertAdjacentHTML('beforeend', `<p class="validation-message">${result.corrupt.length} corrupt run record(s) were isolated.</p>`);
    }
  } catch (error) {
    byId('run-list').innerHTML = `<p class="validation-message">${escapeHtml(error.message)}</p>`;
  }
}

async function loadRunDetail(runId) {
  try {
    selectedCheckoutRun = runId;
    const [result, checkoutResult, interactionResult] = await Promise.all([
      api(`/api/runs/${encodeURIComponent(runId)}`),
      api(`/api/runs/${encodeURIComponent(runId)}/checkout`),
      api(`/api/runs/${encodeURIComponent(runId)}/interactions`)
    ]);
    const run = result.run;
    const checkout = checkoutResult.checkout;
    const maxX = Math.max(...checkout.nodes.map((node) => node.position.x), 0) + NODE_WIDTH + 80;
    const maxY = Math.max(...checkout.nodes.map((node) => node.position.y), 0) + 180;
    const paths = checkout.edges.map((edge) => {
      const from = checkout.nodes.find((node) => node.id === edge.from);
      const to = checkout.nodes.find((node) => node.id === edge.to);
      if (!from || !to) return '';
      const x1 = from.position.x + NODE_WIDTH;
      const y1 = from.position.y + NODE_PORT_Y;
      const x2 = to.position.x;
      const y2 = to.position.y + NODE_PORT_Y;
      return `<path d="M ${x1} ${y1} C ${x1 + 70} ${y1}, ${x2 - 70} ${y2}, ${x2} ${y2}"></path>`;
    }).join('');
    const checkoutGroups = (checkout.loopGroups || []).map((group) => {
      const members = checkout.nodes.filter((node) => group.nodeIds.includes(node.id));
      if (!members.length) return '';
      const left = Math.min(...members.map((node) => node.position.x)) - 28;
      const top = Math.min(...members.map((node) => node.position.y)) - 36;
      const right = Math.max(...members.map((node) => node.position.x + NODE_WIDTH)) + 28;
      const bottom = Math.max(...members.map((node) => node.position.y + 108)) + 28;
      return `<div class="checkout-loop status-${escapeHtml((group.runtime?.status || 'pending').toLowerCase())}" style="left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px"><b>${escapeHtml(group.displayName)}</b><span>Iteration ${escapeHtml(group.runtime?.iteration || 1)} / ${escapeHtml(group.maxIterations)}</span></div>`;
    }).join('');
    byId('run-detail').innerHTML = `
      <header class="checkout-header">
        <div><button id="checkout-back" class="quiet">← Run History</button><small>READ-ONLY CHECKOUT · ${escapeHtml(run.status)}</small><h2>${escapeHtml(run.displayName)}</h2><p>${escapeHtml(run.task)}</p></div>
        <div class="checkout-actions"><button id="copy-agent-handoff">Copy for AI Agent</button><button id="duplicate-run-workflow" class="primary">Duplicate as Workflow</button></div>
      </header>
      <div class="checkout-meta"><span>${escapeHtml(run.runId)}</span><span>${run.goalFrozen ? `Goal frozen V${escapeHtml(run.goalVersion)}` : 'Goal draft'}</span><span>Actual node states</span></div>
      <section class="checkout-canvas" style="--checkout-width:${maxX}px;--checkout-height:${maxY}px">
        <svg viewBox="0 0 ${maxX} ${maxY}" aria-hidden="true">${paths}</svg>
        ${checkoutGroups}
        ${checkout.nodes.map((node) => `<button class="checkout-node status-${escapeHtml(node.status.toLowerCase())}" data-checkout-node="${escapeHtml(node.id)}" style="left:${node.position.x}px;top:${node.position.y}px">
          <small>${escapeHtml(node.type)}${node.loopIteration ? ` · LOOP ${escapeHtml(node.loopIteration)}` : ''}</small><strong>${escapeHtml(node.displayName)}</strong><span>${escapeHtml(node.status)}</span>
        </button>`).join('')}
      </section>
      <section id="node-io-panel" class="node-io-panel"><div class="empty-state"><h3>Select a node</h3><p>Inspect its real Input, Output, Evidence, and Timeline.</p></div></section>
      <section class="agent-interactions"><header><div><small>LIVE AGENT INTERACTIONS</small><h3>Questions from the Agent</h3></div><span>Updates automatically</span></header><div id="interaction-list"></div></section>
    `;
    renderInteractions(interactionResult.interactions);
    byId('checkout-back').onclick = () => {
      selectedCheckoutRun = null;
      byId('run-detail').innerHTML = '<div class="empty-state"><h2>Select a run</h2><p>Open a read-only checkout to inspect actual node evidence.</p></div>';
    };
    byId('copy-agent-handoff').onclick = () => copyAgentHandoff(runId);
    byId('duplicate-run-workflow').onclick = async () => {
      try {
        const duplicate = await api(`/api/runs/${encodeURIComponent(runId)}/duplicate`, {
          method: 'POST',
          body: JSON.stringify({ recipeId: `${slug(run.displayName)}-copy` })
        });
        draft = normalizeDraftGraph(structuredClone(duplicate.preview.recipe));
        positions = new Map(checkout.nodes.map((node) => [node.id, node.position]));
        loadedRecipeId = null;
        captureHistory({ reset: true });
        renderGraph();
        renderRecipeDetails();
        validateDraft();
        showWorkspace('workflows');
        notify('Run duplicated into a new editable workflow. History was not changed.');
      } catch (error) {
        notify(error.message);
      }
    };
    byId('run-detail').querySelectorAll('[data-checkout-node]').forEach((button) => {
      button.onclick = () => loadNodeIo(runId, button.dataset.checkoutNode);
    });
  } catch (error) {
    byId('run-detail').innerHTML = `<p class="validation-message">${escapeHtml(error.message)}</p>`;
  }
}

function renderArtifactPreview(artifact) {
  if (!artifact) return '<p class="muted">No artifact was recorded for this node.</p>';
  if (artifact.unavailable) return `<p class="validation-message">Artifact unavailable: ${escapeHtml(artifact.code)}</p>`;
  return `<p class="artifact-path">${escapeHtml(artifact.descriptor.path)}</p><button class="artifact-download" data-artifact-download="${escapeHtml(artifact.descriptor.path)}">Download copy</button><pre>${escapeHtml(artifact.preview.content)}</pre>`;
}

async function loadNodeIo(runId, nodeId) {
  const panel = byId('node-io-panel');
  try {
    const { io } = await api(`/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}`);
    panel.innerHTML = `
      <header><small>NODE I/O · ${escapeHtml(io.node.status)}</small><h3>${escapeHtml(io.node.displayName)}</h3></header>
      <div class="io-grid">
        <section><h4>Input</h4>${io.input.task ? `<p><b>Task</b><br>${escapeHtml(io.input.task)}</p>` : ''}${io.input.constraints ? `<p><b>Constraints</b><br>${escapeHtml(io.input.constraints)}</p>` : ''}${io.input.dependencies.length ? io.input.dependencies.map((dependency) => `<p><b>${escapeHtml(dependency.nodeId)}</b> · ${escapeHtml(dependency.status)}</p>${renderArtifactPreview(dependency.artifact)}`).join('') : '<p class="muted">Root input from this Run.</p>'}</section>
        <section><h4>Output</h4><p><b>${escapeHtml(io.output.status)}</b>${io.output.reason ? ` · ${escapeHtml(io.output.reason)}` : ''}</p>${renderArtifactPreview(io.output.artifact)}</section>
        <section><h4>Evidence</h4>${renderArtifactPreview(io.evidence)}</section>
        <section><h4>Timeline</h4><div class="timeline">${io.timeline.map((event) => `<p><time>${escapeHtml(event.at)}</time><strong>${escapeHtml(event.type)}</strong></p>`).join('') || '<p class="muted">No node events yet.</p>'}</div></section>
      </div>`;
    panel.querySelectorAll('[data-artifact-download]').forEach((button) => {
      button.onclick = async () => {
        try {
          const result = await api(`/api/runs/${encodeURIComponent(runId)}/artifacts?path=${encodeURIComponent(button.dataset.artifactDownload)}`);
          const blob = new Blob([result.artifact.content], { type: 'text/plain' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = button.dataset.artifactDownload.split('/').at(-1);
          link.click();
          URL.revokeObjectURL(link.href);
        } catch (error) {
          notify(error.message);
        }
      };
    });
  } catch (error) {
    panel.innerHTML = `<p class="validation-message">${escapeHtml(error.message)}</p>`;
  }
}

function renderInteractions(result) {
  const target = byId('interaction-list');
  if (!target) return;
  target.innerHTML = result.questions.length ? result.questions.map((question) => `
    <article class="agent-question ${question.answer ? 'answered' : 'pending'}">
      <small>Q${escapeHtml(question.number)} · ${escapeHtml(question.actor)}</small>
      <p>${escapeHtml(question.message)}</p>
      ${question.answer ? `<div class="agent-answer"><b>Answer</b><p>${escapeHtml(question.answer.message)}</p></div>` : `<form data-answer="${escapeHtml(question.questionId)}"><textarea maxlength="8000" required placeholder="Answer so the Agent can continue…"></textarea><button class="primary">Send answer</button></form>`}
    </article>
  `).join('') : '<p class="muted">No questions yet. The Agent can post Q1, Q2, Q3 from the Run-bound CLI.</p>';
  target.querySelectorAll('[data-answer]').forEach((form) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        await api(`/api/runs/${encodeURIComponent(selectedCheckoutRun)}/questions/${encodeURIComponent(form.dataset.answer)}/answer`, {
          method: 'POST',
          body: JSON.stringify({ message: form.querySelector('textarea').value, actor: 'studio-user' })
        });
        await refreshCheckoutInteractions();
      } catch (error) {
        notify(error.message);
      }
    };
  });
}

async function refreshCheckoutInteractions() {
  if (!selectedCheckoutRun || !byId('interaction-list')) return;
  try {
    const result = await api(`/api/runs/${encodeURIComponent(selectedCheckoutRun)}/interactions`);
    renderInteractions(result.interactions);
  } catch {
    // Corrupt or unavailable Run data is isolated and does not affect another Run.
  }
}

async function copyAgentHandoff(runId = activeRunId) {
  try {
    if (!runId) await ensureStudioRun();
    const result = await api(`/api/runs/${encodeURIComponent(runId || activeRunId)}/agent-handoff`);
    await navigator.clipboard.writeText(result.handoff.prompt);
    byId('goal-dialog').close();
    notify('Run-bound prompt copied. Paste it into your AI coding Agent.');
  } catch (error) {
    byId('goal-validation').textContent = error.message;
  }
}

function showWorkspace(section) {
  const showingRuns = section === 'runs';
  byId('runs-view').hidden = !showingRuns;
  byId('canvas').hidden = showingRuns;
  byId('workflow-context').hidden = showingRuns;
  byId('review').hidden = showingRuns;
  byId('show-runs').classList.toggle('active', showingRuns);
  byId('show-runs').setAttribute('aria-current', showingRuns ? 'page' : 'false');
  byId('show-workflows').classList.toggle('active', !showingRuns);
  byId('show-workflows').setAttribute('aria-current', showingRuns ? 'false' : 'page');
  if (showingRuns) loadRuns();
}

async function previewImport() {
  try {
    const importedRecipe = JSON.parse(byId('import-source').value);
    const result = await api('/api/import/preview', {
      method: 'POST',
      body: JSON.stringify({ existingRecipe: draft, importedRecipe, operation: 'merge' })
    });
    pendingImport = { importedRecipe, mergePlan: result.plan };
    byId('import-preview').innerHTML = `
      <strong>${escapeHtml(importedRecipe.id || 'Imported workflow')}</strong>
      <p>${escapeHtml(importedRecipe.nodes?.length || 0)} nodes · ${escapeHtml(importedRecipe.edges?.length || 0)} explicit Edges</p>
      <p>${Object.values(result.plan.nodeIdMap).filter((id, index) => id !== Object.keys(result.plan.nodeIdMap)[index]).length} node ID conflict(s) will be renamed.</p>
    `;
    byId('import-choices').hidden = false;
  } catch (error) {
    pendingImport = null;
    byId('import-choices').hidden = true;
    byId('import-preview').innerHTML = `<p class="validation-message">${escapeHtml(error.message)}</p>`;
  }
}

async function applyImport(operation) {
  if (!pendingImport) return;
  try {
    const plan = operation === 'merge'
      ? pendingImport.mergePlan
      : { operation: 'replace', nodeIdMap: {}, edgeIdMap: {} };
    const result = await api('/api/import/apply', {
      method: 'POST',
      body: JSON.stringify({
        existingRecipe: draft,
        importedRecipe: pendingImport.importedRecipe,
        plan
      })
    });
    draft = normalizeDraftGraph(structuredClone(result.recipe));
    positions = new Map();
    ensurePositions();
    selectedIds.clear();
    selectedId = null;
    captureHistory();
    renderGraph();
    renderRecipeDetails();
    validateDraft();
    byId('import-dialog').close();
    notify(`${operation === 'merge' ? 'Merged' : 'Replaced'} canvas from validated JSON.`);
  } catch (error) {
    byId('import-preview').innerHTML = `<p class="validation-message">${escapeHtml(error.message)}</p>`;
  }
}

function exportWorkflowJson() {
  const blob = new Blob([`${JSON.stringify(authoringRecipe(), null, 2)}\n`], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${draft.id}.workflow.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function createCustomAgentFromForm(event) {
  event.preventDefault();
  const id = uniqueNodeId('agent');
  const name = byId('custom-name').value.trim();
  const prompt = byId('custom-prompt').value.trim();
  const error = validDisplayName(name);
  if (error || !prompt) return notify(error || 'Custom Agent prompt is required.');
  const artifact = byId('custom-output').value.trim() || `${id}-report`;
  const node = {
    id,
    type: 'agent',
    displayName: name,
    prompt,
    capabilityRefs: csv(byId('custom-capabilities').value),
    mcpRefs: csv(byId('custom-mcp').value),
    inputArtifacts: csv(byId('custom-inputs').value),
    outputArtifacts: [{ artifact, schema: 'schemas/report.schema.json' }],
    tokenLimit: Number(byId('custom-tokens').value),
    timeoutMs: Number(byId('custom-timeout').value) * 1000,
    retry: { maxAttempts: Number(byId('custom-retries').value), backoffMs: 1000 }
  };
  draft.nodes.push(node);
  if (pendingConnectionSource) {
    draft.edges.push({ id: uniqueEdgeId(pendingConnectionSource, id), from: pendingConnectionSource, to: id });
    pendingConnectionSource = null;
  }
  syncDependencies();
  const center = worldAtCanvasCenter();
  positions.set(id, { x: center.x - NODE_WIDTH / 2, y: center.y - NODE_PORT_Y });
  captureHistory();
  renderGraph();
  selectNode(id);
  validateDraft();
  byId('custom-dialog').close();
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
    syncGoalFromLive();
    await hydrateGoalFromLive();
    renderLive();
    await refreshCheckoutInteractions();
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
  draft = normalizeDraftGraph(structuredClone(result.recipe));
  source = result.source;
  loadedRecipeId = draft.id;
  selectedId = null;
  selectedIds.clear();
  selectedEdgeId = null;
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
      renderRecipeDetails();
      byId('inspector-panel').classList.remove('open');
      if (event.button === 1 || spacePressed) beginPan(event);
      else if (event.button === 0) beginLasso(event);
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
  } else if (modifier && event.key.toLowerCase() === 'a' && byId('canvas').contains(document.activeElement)) {
    event.preventDefault();
    selectedIds = new Set(draft.nodes.map((node) => node.id));
    selectedId = [...selectedIds].at(-1) || null;
    updateSelection();
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId) {
    event.preventDefault();
    deleteEdge(selectedEdgeId);
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.size) {
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

function openLoopDialog() {
  const members = draft.nodes.filter((node) => selectedIds.has(node.id));
  if (members.length < 2) return notify('Select at least two steps for a Loop Group.');
  if ((draft.loopGroups || []).some((group) => group.nodeIds.some((id) => selectedIds.has(id)))) {
    return notify('A step can only belong to one Loop Group.');
  }
  const options = members.map((node) =>
    `<option value="${escapeHtml(node.id)}">${escapeHtml(displayName(node))}</option>`
  ).join('');
  for (const id of ['loop-entry', 'loop-decision', 'loop-repeat-target']) byId(id).innerHTML = options;
  const incomingEntry = members.find((node) =>
    draft.edges.some((edge) => edge.to === node.id && !selectedIds.has(edge.from))
  ) || members[0];
  const outgoing = draft.edges.find((edge) =>
    selectedIds.has(edge.from) && !selectedIds.has(edge.to)
  );
  if (!outgoing) return notify('Connect the Loop decision step to its Continue step first.');
  const decision = outgoing
    ? members.find((node) => node.id === outgoing.from)
    : members.find((node) => ['decision', 'judge', 'condition'].includes(node.type)) || members.at(-1);
  const exitIds = new Set(draft.edges
    .filter((edge) => selectedIds.has(edge.from) && !selectedIds.has(edge.to))
    .map((edge) => edge.to));
  const exitCandidates = draft.nodes.filter((node) => exitIds.has(node.id));
  byId('loop-exit-target').innerHTML = exitCandidates.map((node) =>
    `<option value="${escapeHtml(node.id)}">${escapeHtml(displayName(node))}</option>`
  ).join('');
  byId('loop-entry').value = incomingEntry.id;
  byId('loop-repeat-target').value = incomingEntry.id;
  byId('loop-decision').value = decision.id;
  if (outgoing) byId('loop-exit-target').value = outgoing.to;
  byId('loop-name').value = '';
  byId('loop-dialog').showModal();
}

function createLoopGroupFromForm(event) {
  event.preventDefault();
  const display = byId('loop-name').value.trim();
  const repeatOutcome = byId('loop-repeat-outcome').value.trim();
  const exitOutcome = byId('loop-exit-outcome').value.trim();
  if (repeatOutcome === exitOutcome) return notify('Repeat and Continue outcomes must be different.');
  let id = slug(display || 'iteration-loop');
  const occupied = new Set((draft.loopGroups || []).map((group) => group.id));
  for (let suffix = 2; occupied.has(id); suffix += 1) id = `${slug(display || 'iteration-loop')}-${suffix}`;
  const loopGroup = {
    id,
    displayName: display,
    nodeIds: draft.nodes.filter((node) => selectedIds.has(node.id)).map((node) => node.id),
    entryNodeId: byId('loop-entry').value,
    decisionNodeId: byId('loop-decision').value,
    repeatTargetId: byId('loop-repeat-target').value,
    exitTargetId: byId('loop-exit-target').value,
    maxIterations: Number(byId('loop-max').value),
    repeatOutcome,
    exitOutcome,
    repeatLabel: byId('loop-repeat-label').value.trim(),
    exitLabel: byId('loop-exit-label').value.trim()
  };
  draft.loopGroups.push(loopGroup);
  captureHistory();
  renderGraph();
  validateDraft();
  byId('loop-dialog').close();
  notify(`Loop Group “${display}” created.`);
}

async function initialize() {
  await refreshCatalog('default');
  byId('recipe').onchange = loadRecipe;
  bindCanvas();
  byId('toggle-library').onclick = () => byId('library-panel').classList.toggle('open');
  byId('close-library').onclick = () => byId('library-panel').classList.remove('open');
  byId('show-workflows').onclick = () => showWorkspace('workflows');
  byId('show-runs').onclick = () => showWorkspace('runs');
  byId('run-search').oninput = loadRuns;
  for (const id of ['run-status', 'run-mode', 'run-from', 'run-to']) byId(id).onchange = loadRuns;
  byId('import-json').onclick = () => byId('import-dialog').showModal();
  byId('export-json').onclick = exportWorkflowJson;
  byId('preview-import').onclick = previewImport;
  byId('import-file').onchange = async (event) => {
    const [file] = event.currentTarget.files;
    if (file) byId('import-source').value = await file.text();
  };
  byId('merge-import').onclick = () => applyImport('merge');
  byId('replace-import').onclick = () => applyImport('replace');
  byId('create-custom').onclick = () => byId('custom-dialog').showModal();
  byId('custom-form').onsubmit = createCustomAgentFromForm;
  byId('open-goal').onclick = () => {
    renderGoalState();
    byId('goal-dialog').showModal();
  };
  byId('save-goal').onclick = saveGoalFromForm;
  byId('start-agent').onclick = () => copyAgentHandoff();
  byId('review-goal').onclick = reviewGoal;
  byId('confirm-freeze').onclick = freezeGoalFromForm;
  byId('unfreeze-goal').onclick = unfreezeGoalFromForm;
  byId('duplicate-selection').onclick = duplicateSelectedNode;
  byId('delete-selection').onclick = deleteSelectedNode;
  byId('create-loop-group').onclick = openLoopDialog;
  byId('loop-form').onsubmit = createLoopGroupFromForm;
  document.querySelectorAll('[data-close]').forEach((button) => {
    button.onclick = () => byId(button.dataset.close).close();
  });
  document.querySelectorAll('.dialog-maximize').forEach((button) => {
    button.onclick = () => button.closest('dialog').classList.toggle('maximized');
  });
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
