'use strict';

let catalog;
let draft;
let source;
let selectedId;
let liveTimer;
let validationSequence = 0;

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(
  /[&<>"']/g,
  (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
);

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

function renderRecipeDetails() {
  const existing = recipeSummary();
  byId('inspector-label').textContent = 'RECIPE INSPECTOR';
  byId('details').innerHTML = `
    <div class="source-line"><span>${source.toUpperCase()}</span><span>${draft.nodes.length} NODES</span></div>
    <label for="recipe-id">RECIPE ID</label>
    <input id="recipe-id" value="${escapeHtml(draft.id)}">
    <label for="recipe-version">VERSION</label>
    <input id="recipe-version" type="number" min="1" value="${escapeHtml(draft.version)}">
    <label for="recipe-description">DESCRIPTION</label>
    <textarea id="recipe-description">${escapeHtml(draft.description)}</textarea>
    <label for="recipe-modes">COMPATIBLE MODES</label>
    <select id="recipe-modes" multiple>
      ${['REPORT_ONLY', 'ASSISTED', 'UNATTENDED'].map((mode) => (
        `<option ${draft.compatibleModes.includes(mode) ? 'selected' : ''}>${mode}</option>`
      )).join('')}
    </select>
    ${existing?.source === 'builtin' ? '<p class="hint">Change the recipe ID to fork this protected preset.</p>' : ''}
    <button id="apply-recipe">APPLY METADATA</button>
  `;
  byId('apply-recipe').onclick = applyRecipeDetails;
}

function applyRecipeDetails() {
  draft.id = byId('recipe-id').value.trim();
  draft.version = Number(byId('recipe-version').value);
  draft.description = byId('recipe-description').value.trim();
  draft.compatibleModes = [...byId('recipe-modes').selectedOptions].map((option) => option.value);
  renderGraph();
  renderRecipeDetails();
  validateDraft();
}

function graphPositions() {
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
    return [node.id, { x: 90 + depth * 300, y: 125 + row * 150 }];
  }));
}

function renderGraph() {
  const positions = graphPositions();
  const container = byId('nodes');
  container.innerHTML = '';
  draft.nodes.forEach((node, index) => {
    const position = positions.get(node.id);
    const runtimeNode = catalog.live?.nodes?.[node.id];
    const element = document.createElement('article');
    element.className = `node ${runtimeNode?.status.toLowerCase() || ''} ${selectedId === node.id ? 'selected' : ''}`;
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    element.innerHTML = `
      <small>${String(index + 1).padStart(2, '0')} / ${escapeHtml(node.type.toUpperCase())}</small>
      <h3>${escapeHtml(node.id)}</h3>
      <span class="status">● ${runtimeNode?.status || 'DRAFT'}</span>
      ${runtimeNode?.activity ? `<p class="node-activity">${escapeHtml(runtimeNode.activity)}</p>` : ''}
    `;
    element.onclick = (event) => {
      event.stopPropagation();
      selectNode(node.id);
    };
    container.append(element);
  });
  renderEdges(positions);
  byId('mode').textContent = `${draft.compatibleModes.join(' · ') || 'NO MODE'} / EDIT MODE`;
}

function renderEdges(positions) {
  const svg = byId('edges');
  const group = byId('edge-paths');
  const coordinates = [...positions.values()];
  const width = Math.max(1200, ...coordinates.map((position) => position.x + 300));
  const height = Math.max(900, ...coordinates.map((position) => position.y + 200));
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  group.innerHTML = '';
  draft.nodes.forEach((node) => {
    for (const dependencyId of node.dependsOn || []) {
      const from = positions.get(dependencyId);
      const to = positions.get(node.id);
      if (!from || !to) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute(
        'd',
        `M${from.x + 210} ${from.y + 52} C${from.x + 255} ${from.y + 52},${to.x - 45} ${to.y + 52},${to.x} ${to.y + 52}`
      );
      const active = catalog.live?.nodes?.[dependencyId]?.status === 'RUNNING';
      path.setAttribute('class', active ? 'edge active' : 'edge');
      path.setAttribute('marker-end', 'url(#arrow)');
      group.append(path);
    }
  });
}

function selectNode(nodeId) {
  selectedId = nodeId;
  const node = draft.nodes.find((candidate) => candidate.id === nodeId);
  const runtimeNode = catalog.live?.nodes?.[nodeId];
  byId('inspector-label').textContent = 'NODE INSPECTOR';
  byId('details').innerHTML = `
    <div class="source-line"><span>${escapeHtml(node.type.toUpperCase())}</span><span>${runtimeNode?.status || 'DRAFT'}</span></div>
    <label for="node-id">NODE ID</label>
    <input id="node-id" value="${escapeHtml(node.id)}">
    <label>TYPE</label>
    <input value="${escapeHtml(node.type)}" disabled>
    <label for="node-dependencies">DEPENDENCIES</label>
    <input id="node-dependencies" value="${escapeHtml((node.dependsOn || []).join(', '))}" placeholder="goal, verification">
    ${node.type === 'agent' ? `
      <label for="node-extra">ROLE</label><input id="node-extra" value="${escapeHtml(node.role || '')}">
      <label for="node-tokens">MAX TOKENS</label><input id="node-tokens" type="number" min="1" value="${escapeHtml(node.context?.maxTokens || '')}">
    ` : node.type === 'approval' ? `
      <label for="node-extra">APPROVAL MESSAGE</label><textarea id="node-extra">${escapeHtml(node.message || '')}</textarea>
    ` : node.type === 'condition' ? `
      <label for="condition-field">CONDITION FIELD</label>
      <select id="condition-field">${['run.mode', 'run.state', 'run.iteration', 'run.task'].map((field) => `<option ${node.expression?.field === field ? 'selected' : ''}>${field}</option>`).join('')}</select>
      <label for="condition-operator">OPERATOR</label>
      <select id="condition-operator">${['equals', 'notEquals', 'contains', 'exists', 'isEmpty', 'greaterThan', 'lessThan'].map((operator) => `<option ${node.expression?.operator === operator ? 'selected' : ''}>${operator}</option>`).join('')}</select>
      <label for="condition-value">VALUE</label><input id="condition-value" value="${escapeHtml(node.expression?.value ?? '')}">
    ` : ''}
    <div class="button-row"><button id="apply-node">APPLY NODE</button><button id="delete-node" class="danger">DELETE</button></div>
    ${runtimeControls(node, runtimeNode)}
  `;
  byId('apply-node').onclick = applyNodeDetails;
  byId('delete-node').onclick = deleteSelectedNode;
  bindRuntimeControls(node, runtimeNode);
  renderGraph();
}

function runtimeControls(node, runtimeNode) {
  if (!catalog.live || !runtimeNode) return '';
  const approve = node.type === 'approval' && runtimeNode.status === 'READY'
    ? '<button id="approve-node">APPROVE</button>'
    : '';
  const retry = ['FAILED', 'RUNNING'].includes(runtimeNode.status)
    ? '<button id="retry-node">RETRY</button>'
    : '';
  const activity = runtimeNode.status === 'RUNNING'
    ? '<label for="runtime-activity">SAFE ACTIVITY UPDATE</label><input id="runtime-activity" maxlength="240"><button id="send-activity">REPORT ACTIVITY</button>'
    : '';
  return approve || retry || activity
    ? `<section class="runtime-controls"><label>RUNTIME CONTROL</label>${activity}<div class="button-row">${approve}${retry}</div></section>`
    : '';
}

function bindRuntimeControls(node, runtimeNode) {
  const runId = catalog.live?.run?.runId;
  if (byId('approve-node')) byId('approve-node').onclick = () => mutateNode('/api/node/approve', { runId, nodeId: node.id });
  if (byId('retry-node')) byId('retry-node').onclick = () => mutateNode('/api/node/retry', { runId, nodeId: node.id });
  if (byId('send-activity')) {
    byId('send-activity').onclick = () => mutateNode('/api/node/activity', {
      runId,
      nodeId: node.id,
      message: byId('runtime-activity').value
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

function applyNodeDetails() {
  const node = draft.nodes.find((candidate) => candidate.id === selectedId);
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
      node.expression.value = field === 'run.iteration' || ['greaterThan', 'lessThan'].includes(operator)
        ? Number(rawValue)
        : rawValue;
    }
  }
  selectedId = node.id;
  renderGraph();
  selectNode(node.id);
  validateDraft();
}

function deleteSelectedNode() {
  if (!selectedId) return;
  draft.nodes = draft.nodes.filter((node) => node.id !== selectedId);
  draft.nodes.forEach((node) => {
    node.dependsOn = (node.dependsOn || []).filter((dependency) => dependency !== selectedId);
  });
  selectedId = null;
  renderGraph();
  renderRecipeDetails();
  validateDraft();
}

function addNode(type) {
  let suffix = draft.nodes.length + 1;
  while (draft.nodes.some((node) => node.id === `${type}-${suffix}`)) suffix += 1;
  const id = `${type}-${suffix}`;
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
  draft.nodes.push(node);
  selectNode(id);
  validateDraft();
}

function renderPalette() {
  const excluded = new Set(['goal-contract', 'maker', 'verification', 'devil-advocate', 'judge', 'delivery', 'report']);
  byId('palette').innerHTML = catalog.nodeTypes
    .filter((node) => node.executable && !excluded.has(node.type))
    .map((node) => `
      <button class="palette-item" data-node-type="${escapeHtml(node.type)}">
        <b>${escapeHtml(node.label)}</b><small>${escapeHtml(node.category.toUpperCase())}</small>
      </button>
    `).join('');
  document.querySelectorAll('[data-node-type]').forEach((button) => {
    button.onclick = () => addNode(button.dataset.nodeType);
  });
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
    byId('active-stage').textContent = 'No active run';
    byId('activity').textContent = 'Waiting for a recipe-bound workflow.';
    byId('events').innerHTML = '';
    byId('budget').textContent = '—';
    byId('meter').style.width = '0';
    return;
  }
  const active = live.plan.nodes.find((node) => live.nodes[node.id].status === 'RUNNING')
    || live.plan.nodes.find((node) => live.nodes[node.id].status === 'READY');
  const runtimeNode = active ? live.nodes[active.id] : null;
  byId('active-stage').textContent = active?.id || 'Run complete';
  byId('activity').textContent = active
    ? runtimeNode.activity || `${runtimeNode.status} · attempt ${runtimeNode.attempts}`
    : `Final state: ${live.run.state}`;
  const spent = live.budget.spentThisRun;
  const limit = live.budget.perRunTokenLimit;
  byId('meter').style.width = `${Math.min(100, limit ? (spent / limit) * 100 : 0)}%`;
  byId('budget').textContent = `${spent.toLocaleString()} / ${limit.toLocaleString()} TOKENS`;
  byId('events').innerHTML = live.events.slice(-7).reverse().map((event) => `
    <p class="${event.type === 'NODE_ACTIVITY' || event.type.includes('START') ? 'event-active' : ''}">
      ${escapeHtml(event.at.slice(11, 19))} · ${escapeHtml(event.type)} · ${escapeHtml(event.changedNodes.join(', '))}
    </p>
  `).join('');
  renderGraph();
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
  const result = await api(`/api/recipe?id=${encodeURIComponent(byId('recipe').value)}`);
  draft = structuredClone(result.recipe);
  source = result.source;
  selectedId = null;
  renderGraph();
  renderRecipeDetails();
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

async function initialize() {
  await refreshCatalog();
  byId('recipe').onchange = loadRecipe;
  byId('canvas').onclick = () => {
    selectedId = null;
    renderGraph();
    renderRecipeDetails();
  };
  await loadRecipe();
  clearInterval(liveTimer);
  liveTimer = setInterval(refreshLive, 1800);
}

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
      body: JSON.stringify({ recipe: draft, replace: catalog.recipes.some((recipe) => recipe.id === draft.id) })
    });
    byId('confirm').close();
    notify('Recipe installed atomically.');
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

initialize().catch((error) => notify(error.message));
