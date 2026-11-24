import { diagramUrl, fetchDetail, fetchMe, fetchProjects, fetchRuns, freezeGoal, saveActor } from './api.js';
import { crewLabel, crewRuns, renderOrders, withLiveOrders } from './orders.js';
import { renderOverview, renderProjectList, sortProjects, worktreeState } from './list.js';
import { recommendedView, renderDetail, renderRoomCard, renderRunHead, renderSketch, renderSketchFoot, sketchFrame, sketchOptions } from './detail.js';
import { mountRing2d, ringMode, ringModel } from './ring2d.js';
import { createSheet, trapFocus } from './sheet.js';
import { roomTargets, stepTarget, waitBubble, waitLevel, waitSeconds } from './mood.js';

const ELAPSED_REFRESH_MS = 60_000;

const elements = {
  overview: document.getElementById('overview'),
  live: document.getElementById('live'),
  connection: document.getElementById('connection'),
  list: document.getElementById('project-list'),
  run: document.getElementById('run'),
  empty: document.getElementById('run-empty'),
  head: document.getElementById('run-head'),
  status: document.getElementById('run-status'),
  detail: document.getElementById('run-detail'),
  ring: document.getElementById('ring'),
  detailsButton: document.getElementById('details-open'),
  ordersButton: document.getElementById('orders-open'),
  ordersSheet: document.getElementById('orders-sheet'),
  orders: document.getElementById('orders'),
  sheet: document.getElementById('details-sheet'),
  projects: document.getElementById('projects'),
  projectsToggle: document.getElementById('projects-toggle'),
  room: document.getElementById('room'),
  sketchSheet: document.getElementById('sketch-sheet'),
  sketch: document.getElementById('sketch'),
  roomCard: document.querySelector('#room .room-card')
};

const MOOD_TURN_MS = 3000;
const ROOM_FADE_MS = 260;
const moodView = { level: 0, turn: 0 };
const roomView = { open: false, busy: false, direction: 0 };

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const HAS_WEBGL = webglAvailable();
const ringView = { key: null, handle: null, gl: null, model: null, ticket: 0, loading: false, threeFailed: false };
let kitchenModule = null;

function loadKitchen() {
  if (!kitchenModule) kitchenModule = import('./restaurant.js');
  return kitchenModule;
}

if (HAS_WEBGL) loadKitchen().catch(() => {});

const state = {
  projects: [],
  loaded: false,
  selectedId: new URLSearchParams(window.location.search).get('project'),
  detail: null,
  detailKey: null,
  detailError: null,
  me: { actor: null, actorValid: false },
  freezing: false,
  goalView: 'formatted',
  sketchView: null,
  sketchKey: null,
  sketchActor: null,
  sketchWarm: null,
  pendingSketch: null
};

let detailTicket = 0;

function webglAvailable() {
  return typeof window.WebGL2RenderingContext === 'function';
}

function wantsGl() {
  return ringMode({ webgl: HAS_WEBGL, threeFailed: ringView.threeFailed }) === '3d';
}

function disposeGl() {
  ringView.ticket += 1;
  ringView.loading = false;
  if (ringView.gl) ringView.gl.dispose();
  ringView.gl = null;
  elements.ring.dataset.bot = 'css';
  elements.ring.dataset.ring = 'flat';
}

function clearRing() {
  disposeGl();
  if (ringView.handle) ringView.handle.dispose();
  ringView.handle = null;
  ringView.key = null;
  moodView.level = 0;
  elements.ring.hidden = true;
}

function currentModel(summary) {
  const model = ringModel(summary.ring, summary);
  model.waitLevel = summary.waiting ? waitLevel(waitSeconds(summary.waiting)) : 0;
  return model;
}

function popBubble(bubble) {
  delete bubble.dataset.pop;
  void bubble.offsetWidth;
  bubble.dataset.pop = '';
}

function updateMood() {
  const handle = ringView.handle;
  const summary = state.detail && state.detail.summary;
  if (!handle || !handle.bubble) return;
  if (!summary || !summary.waiting) {
    handle.bubble.hidden = true;
    moodView.level = 0;
    return;
  }
  const bubble = waitBubble(summary.waiting.kind, waitSeconds(summary.waiting), moodView.turn, { reducedMotion: reducedMotionQuery.matches });
  handle.bubble.hidden = false;
  handle.bubble.dataset.level = String(bubble.level);
  if (handle.bubble.textContent !== bubble.text) {
    handle.bubble.textContent = bubble.text;
    if (!reducedMotionQuery.matches) popBubble(handle.bubble);
  }
  if (bubble.level !== moodView.level) {
    moodView.level = bubble.level;
    handle.mood.textContent = `The bot says: ${bubble.text}`;
    if (ringView.model) {
      ringView.model.waitLevel = bubble.level;
      if (ringView.gl) ringView.gl.update(ringView.model);
    }
  }
}

function crewModels() {
  return crewRuns(state.projects, state.selectedId).map(({ id, run }) => ({ id, label: crewLabel(run), model: currentModel(run) }));
}

function syncGl(swap) {
  if (!wantsGl()) {
    disposeGl();
    return;
  }
  if (ringView.gl) {
    ringView.gl.update(ringView.model, { swap, direction: swap ? roomView.direction : 0 });
    ringView.gl.setCrew(crewModels());
    roomView.direction = 0;
    return;
  }
  if (ringView.loading) return;
  ringView.loading = true;
  const ticket = ringView.ticket;
  const failed = () => {
    ringView.threeFailed = true;
    if (ticket === ringView.ticket) disposeGl();
  };
  loadKitchen().then(({ mountKitchen }) => {
    if (ticket !== ringView.ticket || !ringView.handle) return;
    ringView.loading = false;
    try {
      elements.ring.dataset.ring = '3d';
      ringView.gl = mountKitchen(ringView.handle.gl, ringView.model, {
        root: elements.ring,
        reducedMotion: reducedMotionQuery.matches,
        diners: (state.me.diners || []).length,
        onOpen: () => openRoom(),
        onBook: () => openOrders(null),
        onCrew: (id) => select(id)
      });
      ringView.gl.setCrew(crewModels());
      elements.ring.dataset.bot = '3d';
    } catch {
      failed();
    }
  }).catch(failed);
}

function syncRing() {
  const project = selectedProject();
  const summary = state.detail && state.detail.summary;
  if (!project || !project.run || !summary) {
    clearRing();
    return;
  }
  const key = `${project.id}|${summary.runId}`;
  const view = { summary, findings: state.detail.findings, projectName: project.name, actor: validActor(), diners: state.me.diners || [] };
  const swap = ringView.key !== null && ringView.key !== key;
  ringView.model = currentModel(summary);
  elements.ring.hidden = false;
  if (!ringView.handle) ringView.handle = mountRing2d(elements.ring, view);
  else ringView.handle.update(view);
  if (ringView.key !== key) moodView.level = 0;
  ringView.key = key;
  syncGl(swap);
  updateMood();
}

function selectableTargets() {
  return state.projects.flatMap((project) => [
    project,
    ...(project.worktreeRuns || []).filter((run) => run.worktreeId).map((run) => ({
      id: run.worktreeId,
      name: `${project.name} · worktree`,
      state: worktreeState(run),
      run
    }))
  ]);
}

function selectedProject() {
  return selectableTargets().find((target) => target.id === state.selectedId) || null;
}

function runKey(project) {
  const run = project && project.run;
  return run ? [project.id, run.runId, run.state, run.updatedAt, run.stage, run.waiting && run.waiting.kind].join('|') : null;
}

function validActor() {
  return state.me.actorValid ? state.me.actor : null;
}

function focusedListButton() {
  const active = document.activeElement;
  const button = active && elements.list.contains(active) && active.closest('[data-project-id]');
  return button ? { id: button.dataset.projectId, action: button.dataset.action || 'select' } : null;
}

function renderList() {
  const focused = focusedListButton();
  elements.list.innerHTML = state.loaded ? renderProjectList(state.projects, { selectedId: state.selectedId, actor: validActor() }) : '';
  elements.overview.innerHTML = state.loaded ? renderOverview(state.projects) : '<li class="chip">Loading projects…</li>';
  if (!focused) return;
  const match = [...elements.list.querySelectorAll('[data-project-id]')]
    .find((button) => button.dataset.projectId === focused.id && (button.dataset.action || 'select') === focused.action);
  if (match) match.focus();
}

function emptyMessage(project) {
  if (!state.loaded) return 'Loading projects…';
  if (!project) return state.projects.length ? 'Pick a project to see its Run.' : 'No projects yet.';
  if (project.state === 'missing') return 'This project folder is missing.';
  if (!project.run) return 'No active Run in this project.';
  if (state.detailError) return `Could not load this Run: ${state.detailError}`;
  return 'Loading Run…';
}

function renderRun() {
  const project = selectedProject();
  if (project && project.run && !state.detail && !state.detailError && ringView.handle) return;
  const showing = Boolean(project && project.run && state.detail);
  elements.empty.hidden = showing;
  elements.empty.textContent = showing ? '' : emptyMessage(project);
  elements.run.dataset.showing = String(showing);
  elements.detailsButton.hidden = !showing;
  elements.ordersButton.hidden = !showing;
  syncRing();
  if (!showing) {
    if (sheet.isOpen()) sheet.close();
    if (sketchSheet.isOpen()) sketchSheet.close();
    if (ordersSheet.isOpen()) ordersSheet.close();
    elements.head.innerHTML = '';
    elements.detail.innerHTML = '';
    return;
  }
  const input = elements.head.querySelector('#freeze-actor');
  const typed = input ? input.value : '';
  const typing = input && document.activeElement === input;
  syncSketch();
  elements.head.innerHTML = renderRunHead(state.detail.summary, { actor: validActor(), projectName: project.name });
  const focusedTab = document.activeElement && elements.detail.contains(document.activeElement) ? document.activeElement.dataset.goalView : null;
  elements.detail.innerHTML = renderDetail(state.detail, { goalView: state.goalView });
  if (focusedTab) {
    const tab = elements.detail.querySelector(`[data-goal-view="${focusedTab}"]`);
    if (tab) tab.focus();
  }
  const next = elements.head.querySelector('#freeze-actor');
  if (next && typed) next.value = typed;
  if (next && typing) next.focus();
  syncRoom();
}

const sheet = createSheet(elements.sheet, {
  onOpenChange(open) {
    document.body.dataset.sheet = open ? 'open' : 'closed';
    elements.detailsButton.setAttribute('aria-expanded', String(open));
  }
});

const sketchSheet = createSheet(elements.sketchSheet, {
  onOpenChange(open) {
    document.body.dataset.sheet = open ? 'open' : 'closed';
  }
});

const ordersSheet = createSheet(elements.ordersSheet, {
  onOpenChange(open) {
    document.body.dataset.sheet = open ? 'open' : 'closed';
    elements.ordersButton.setAttribute('aria-expanded', String(open));
  }
});
let ordersTicket = 0;

async function openOrders(opener) {
  const project = selectedProject();
  if (!project || ordersSheet.isOpen() || sheet.isOpen() || sketchSheet.isOpen()) return;
  const ticket = ++ordersTicket;
  elements.orders.innerHTML = renderOrders([], { projectName: project.name, loading: true });
  ordersSheet.open(opener || null);
  try {
    const runs = await fetchRuns(project.id);
    if (ticket === ordersTicket) elements.orders.innerHTML = renderOrders(withLiveOrders(runs, crewRuns(state.projects, state.selectedId)), { projectName: project.name });
  } catch (error) {
    if (ticket === ordersTicket) elements.orders.innerHTML = renderOrders([], { projectName: project.name, error: error.message });
  }
}

function hasSketch(detail) {
  return sketchOptions(detail).length > 0;
}

function sketchTarget() {
  const project = selectedProject();
  const detail = state.detail;
  if (!project || !hasSketch(detail)) return null;
  return { project, detail, key: [project.id, detail.summary.runId, detail.goalHash].join('|') };
}

function sketchPanel() {
  return elements.sketch.querySelector('#sketch-panel');
}

function markFrame(frame) {
  frame.dataset.loaded = 'true';
  const panel = sketchPanel();
  if (panel && !frame.hidden) {
    panel.dataset.loaded = 'true';
    panel.removeAttribute('aria-busy');
  }
}

function addFrame(target, view) {
  const panel = sketchPanel();
  if (!panel) return null;
  const existing = panel.querySelector(`iframe[data-view="${view}"]`);
  if (existing) return existing;
  panel.insertAdjacentHTML('beforeend', sketchFrame(view, diagramUrl(target.project.id, target.detail.summary.runId, view, target.detail.goalHash)));
  const frame = panel.lastElementChild;
  frame.hidden = view !== state.sketchView;
  frame.addEventListener('load', () => markFrame(frame), { once: true });
  return frame;
}

function showFrame(target, view) {
  const panel = sketchPanel();
  const frame = addFrame(target, view);
  if (!panel || !frame) return;
  for (const other of panel.querySelectorAll('iframe[data-view]')) other.hidden = other !== frame;
  const loaded = frame.dataset.loaded === 'true';
  panel.dataset.loaded = String(loaded);
  if (loaded) panel.removeAttribute('aria-busy');
  else panel.setAttribute('aria-busy', 'true');
  panel.setAttribute('aria-labelledby', `sketch-tab-${view}`);
  for (const tab of elements.sketch.querySelectorAll('[role="tab"][data-sketch-view]')) {
    const on = tab.dataset.sketchView === view;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
}

function prepareSketch() {
  const target = sketchTarget();
  if (!target) return false;
  const actor = validActor();
  if (target.key !== state.sketchKey) {
    state.sketchKey = target.key;
    state.sketchActor = actor;
    state.sketchView = recommendedView(target.detail);
    elements.sketch.innerHTML = renderSketch(target.detail, { view: state.sketchView, actor });
  } else if (actor !== state.sketchActor) {
    state.sketchActor = actor;
    const foot = elements.sketch.querySelector('.sketch-foot');
    if (foot) foot.innerHTML = renderSketchFoot(actor);
  }
  showFrame(target, state.sketchView);
  return true;
}

function waitsForFreeze(detail) {
  return Boolean(detail && detail.summary && detail.summary.waiting && detail.summary.waiting.kind === 'freeze');
}

function syncSketch() {
  const target = sketchTarget();
  if (!target) {
    if (sketchSheet.isOpen()) sketchSheet.close();
    return;
  }
  if (sketchSheet.isOpen() || waitsForFreeze(target.detail) || target.key === state.sketchKey) prepareSketch();
}

function warmSketchTabs() {
  const target = sketchTarget();
  if (!target || state.sketchWarm === target.key) return;
  state.sketchWarm = target.key;
  const idle = window.requestIdleCallback || ((run) => window.setTimeout(run, 200));
  idle(() => {
    const live = sketchTarget();
    if (!live || live.key !== target.key) return;
    for (const option of sketchOptions(target.detail)) addFrame(target, option.view);
  });
}

function openSketch(opener) {
  if (!hasSketch(state.detail)) {
    setStatus('There is no order sketch for this Goal right now.');
    return;
  }
  if (roomView.open) return;
  if (sheet.isOpen()) sheet.close();
  prepareSketch();
  sketchSheet.open(opener || null);
  warmSketchTabs();
}

const narrowQuery = window.matchMedia('(max-width: 899px)');

function setProjectsOpen(open) {
  elements.projectsToggle.setAttribute('aria-expanded', String(open));
  elements.projects.dataset.open = String(open);
}

function typingTarget(target) {
  return Boolean(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
}

function setStatus(message) {
  elements.status.textContent = message || '';
}

function playEnter() {
  delete elements.run.dataset.enter;
  void elements.run.offsetWidth;
  elements.run.dataset.enter = '';
}

async function loadDetail({ enter = false } = {}) {
  const project = selectedProject();
  state.detailKey = runKey(project);
  const ticket = ++detailTicket;
  if (!project || !project.run) {
    state.detail = null;
    state.detailError = null;
    renderRun();
    return;
  }
  try {
    const detail = await fetchDetail(project.id, project.run.runId);
    if (ticket !== detailTicket) return;
    state.detail = detail;
    state.detailError = null;
  } catch (error) {
    if (ticket !== detailTicket) return;
    state.detail = null;
    state.detailError = error.message;
  }
  renderRun();
  if (enter && !ringView.gl) playEnter();
  if (state.pendingSketch && state.pendingSketch === state.selectedId && state.detail) {
    state.pendingSketch = null;
    openSketch(null);
  }
}

function fallbackSelection() {
  if (selectedProject()) return state.selectedId;
  const first = sortProjects(state.projects)[0];
  return first ? first.id : null;
}

function applyProjects(projects) {
  state.projects = Array.isArray(projects) ? projects : [];
  state.loaded = true;
  const previous = state.selectedId;
  state.selectedId = fallbackSelection();
  renderList();
  const changed = previous !== state.selectedId;
  if (changed || runKey(selectedProject()) !== state.detailKey) {
    if (changed) state.detail = null;
    loadDetail({ enter: changed || !state.detail });
  } else {
    renderRun();
  }
}

function select(projectId) {
  if (!projectId || projectId === state.selectedId) return;
  state.selectedId = projectId;
  state.detail = null;
  state.detailError = null;
  setStatus('');
  const url = new URL(window.location.href);
  url.searchParams.set('project', projectId);
  window.history.replaceState(null, '', url);
  renderList();
  renderRun();
  loadDetail({ enter: true });
}

async function refreshProjects() {
  try {
    applyProjects(await fetchProjects());
  } catch (error) {
    setConnection(error.message);
  }
}

function setBusy(button, busy) {
  if (!button || !button.isConnected) return;
  button.disabled = busy;
  if (busy) button.textContent = 'Freezing…';
}

function freezeFailure(error) {
  if (error.code === 'GOAL_DRAFT_CONFLICT') return 'The Goal changed since you opened it. The new draft is shown; read it and freeze again.';
  return error.fix ? `${error.message}. ${error.fix}` : error.message;
}

async function submitFreeze(targetId, runId, expectedHash) {
  const result = await freezeGoal(targetId, runId, expectedHash);
  setStatus(result.alreadyFrozen ? 'This Goal was already frozen in the agent host.' : `Goal frozen as ${state.me.actor}.`);
}

const FREEZE_DONE_MS = 650;

function showFrozen(button) {
  if (!button || !button.isConnected) return Promise.resolve();
  button.dataset.done = 'true';
  button.textContent = 'Frozen';
  return wait(reducedMotionQuery.matches ? 0 : FREEZE_DONE_MS);
}

async function withFreezeLock(button, operation) {
  if (state.freezing) return;
  state.freezing = true;
  setBusy(button, true);
  try {
    await operation();
    await showFrozen(button);
  } catch (error) {
    setStatus(freezeFailure(error));
  } finally {
    state.freezing = false;
  }
  await refreshProjects();
  await loadDetail();
}

async function freeze(name, button = elements.head.querySelector('button[data-action="freeze"]')) {
  const project = selectedProject();
  const detail = state.detail;
  if (!project || !detail || !detail.goalHash) {
    setStatus('There is no Goal draft to freeze. Reload the page.');
    return;
  }
  await withFreezeLock(button, async () => {
    if (name !== undefined) state.me = await saveActor(name);
    await submitFreeze(project.id, detail.summary.runId, detail.goalHash);
  });
}

async function freezeFromList(button) {
  const targetId = button.dataset.projectId;
  const runId = button.dataset.runId;
  select(targetId);
  if (!validActor()) {
    setStatus('Type your name under the Goal to freeze it.');
    return;
  }
  const liveButton = [...elements.list.querySelectorAll('button[data-action="list-freeze"]')]
    .find((candidate) => candidate.dataset.projectId === targetId) || button;
  const goalHash = button.dataset.goalHash;
  if (!goalHash) {
    setStatus('There is no Goal draft to freeze. Reload the page.');
    return;
  }
  await withFreezeLock(liveButton, () => submitFreeze(targetId, runId, goalHash));
}

const LIVE_TEXT = { connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', offline: 'Offline' };

function setLive(next) {
  if (elements.live.dataset.state === next) return;
  elements.live.dataset.state = next;
  elements.live.querySelector('.live-text').textContent = LIVE_TEXT[next];
}

function showGoalView(view, { focus = false } = {}) {
  state.goalView = view;
  for (const tab of elements.detail.querySelectorAll('[role="tab"][data-goal-view]')) {
    const selected = tab.dataset.goalView === view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    if (panel) panel.hidden = !selected;
    if (selected && focus) tab.focus();
  }
}

const TAB_KEYS = {
  'ArrowRight': (index, count) => (index + 1) % count,
  'ArrowLeft': (index, count) => (index - 1 + count) % count,
  'Home': () => 0,
  'End': (index, count) => count - 1
};

function setConnection(message) {
  elements.connection.hidden = !message;
  elements.connection.textContent = message || '';
}

function connect() {
  const source = new EventSource('/api/events');
  source.addEventListener('open', () => setLive('live'));
  source.addEventListener('projects', (event) => {
    setConnection(null);
    setLive('live');
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    applyProjects(payload.projects);
  });
  source.addEventListener('error', () => {
    setLive(source.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');
    setConnection(source.readyState === EventSource.CLOSED
      ? 'Lost the Studio connection. Start `ael studio` again, then reload this page.'
      : 'Reconnecting to Studio…');
  });
}

elements.list.addEventListener('click', (event) => {
  const sketchButton = event.target.closest('button[data-action="list-sketch"]');
  if (sketchButton) {
    const id = sketchButton.dataset.projectId;
    if (id === state.selectedId && state.detail) openSketch(sketchButton);
    else {
      state.pendingSketch = id;
      select(id);
    }
    return;
  }
  const freezeButton = event.target.closest('button[data-action="list-freeze"]');
  if (freezeButton) {
    freezeFromList(freezeButton);
    return;
  }
  const row = event.target.closest('[data-project-id]');
  if (row) {
    select(row.dataset.projectId);
    if (narrowQuery.matches) setProjectsOpen(false);
  }
});

elements.detailsButton.addEventListener('click', () => sheet.open(elements.detailsButton));
elements.ordersButton.addEventListener('click', () => openOrders(elements.ordersButton));

elements.projectsToggle.addEventListener('click', () => {
  setProjectsOpen(elements.projectsToggle.getAttribute('aria-expanded') !== 'true');
});

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typingTarget(event.target)) return;
  if (event.key === 'Escape' && elements.projects.dataset.open === 'true') {
    setProjectsOpen(false);
    elements.projectsToggle.focus();
    return;
  }
  if (roomView.open) return;
  if ((event.key === 'o' || event.key === 'O') && !sheet.isOpen() && !sketchSheet.isOpen() && !ordersSheet.isOpen() && !elements.ordersButton.hidden) {
    event.preventDefault();
    openOrders(elements.ordersButton);
    return;
  }
  if ((event.key === 'd' || event.key === 'D') && !sheet.isOpen() && !sketchSheet.isOpen() && !ordersSheet.isOpen() && !elements.detailsButton.hidden) {
    event.preventDefault();
    sheet.open(elements.detailsButton);
  }
});

function showSketchView(view, { focus = false } = {}) {
  const target = sketchTarget();
  if (!target) return;
  state.sketchView = view;
  showFrame(target, view);
  if (focus) {
    const tab = elements.sketch.querySelector(`[data-sketch-view="${view}"]`);
    if (tab) tab.focus();
  }
}

elements.sketch.addEventListener('click', (event) => {
  const tab = event.target.closest('[role="tab"][data-sketch-view]');
  if (tab) {
    showSketchView(tab.dataset.sketchView);
    return;
  }
  const action = event.target.closest('button[data-action]');
  if (!action) return;
  if (action.dataset.action === 'freeze') freeze(undefined, action);
  else if (action.dataset.action === 'sketch-freeze-name') {
    sketchSheet.close();
    focusActorInput();
  }
});

elements.sketch.addEventListener('keydown', (event) => {
  const tab = event.target.closest('[role="tab"][data-sketch-view]');
  const move = TAB_KEYS[event.key];
  if (!tab || !move) return;
  event.preventDefault();
  const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
  showSketchView(tabs[move(tabs.indexOf(tab), tabs.length)].dataset.sketchView, { focus: true });
});

elements.detail.addEventListener('click', (event) => {
  const tab = event.target.closest('[role="tab"][data-goal-view]');
  if (tab) showGoalView(tab.dataset.goalView);
});

elements.detail.addEventListener('keydown', (event) => {
  const tab = event.target.closest('[role="tab"][data-goal-view]');
  const move = TAB_KEYS[event.key];
  if (!tab || !move) return;
  event.preventDefault();
  const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
  showGoalView(tabs[move(tabs.indexOf(tab), tabs.length)].dataset.goalView, { focus: true });
});

function focusActorInput() {
  const input = elements.head.querySelector('#freeze-actor');
  if (input) input.focus();
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function syncRoom() {
  if (!roomView.open || !state.detail) return;
  const project = selectedProject();
  if (!project) return;
  elements.roomCard.innerHTML = renderRoomCard(state.detail.summary, { findings: state.detail.findings, projectName: project.name, actor: validActor() });
}

async function openRoom() {
  if (roomView.open || roomView.busy || !ringView.handle || !state.detail) return;
  roomView.busy = true;
  roomView.open = true;
  elements.run.dataset.zoom = 'in';
  syncRoom();
  elements.room.hidden = false;
  void elements.room.offsetWidth;
  elements.room.dataset.open = 'true';
  elements.room.querySelector('[data-action="room-close"]').focus();
  if (ringView.gl) await ringView.gl.zoom('in');
  roomView.busy = false;
}

async function closeRoom() {
  if (!roomView.open || roomView.busy) return;
  roomView.busy = true;
  elements.room.dataset.open = 'false';
  const zoomOut = ringView.gl ? ringView.gl.zoom('out') : Promise.resolve();
  await wait(reducedMotionQuery.matches ? 0 : ROOM_FADE_MS);
  elements.room.hidden = true;
  delete elements.run.dataset.zoom;
  roomView.open = false;
  const bot = elements.ring.querySelector('.ring-bot');
  if (bot) bot.focus();
  await zoomOut;
  roomView.busy = false;
}

function roomStep(direction) {
  if (roomView.busy) return;
  const id = stepTarget(roomTargets(state.projects), state.selectedId, direction);
  if (!id || id === state.selectedId) return;
  roomView.direction = direction;
  select(id);
}

elements.ring.addEventListener('click', (event) => {
  const action = event.target.closest('.guest [data-action]');
  if (action) {
    if (action.dataset.action === 'freeze') freeze(undefined, action);
    else if (action.dataset.action === 'guest-freeze-name') focusActorInput();
    else if (action.dataset.action === 'open-sketch') openSketch(action);
    return;
  }
  if (!event.target.closest('.ring-bot')) return;
  if (ringView.gl) ringView.gl.react();
  openRoom();
});

elements.room.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]');
  if (!action) {
    if (!event.target.closest('.room-card') && ringView.gl) ringView.gl.react();
    return;
  }
  const name = action.dataset.action;
  if (name === 'room-close') closeRoom();
  else if (name === 'room-next') roomStep(1);
  else if (name === 'room-prev') roomStep(-1);
  else if (name === 'freeze') freeze(undefined, action);
  else if (name === 'room-freeze-name') {
    closeRoom().then(focusActorInput);
  }
});

elements.room.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeRoom();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    roomStep(1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    roomStep(-1);
  } else {
    trapFocus(event, elements.room);
  }
});

window.setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  moodView.turn += 1;
  updateMood();
}, MOOD_TURN_MS);

elements.head.addEventListener('click', (event) => {
  const sketch = event.target.closest('button[data-action="open-sketch"]');
  if (sketch) {
    openSketch(sketch);
    return;
  }
  const button = event.target.closest('button[data-action="freeze"]');
  if (!button || button.type === 'submit') return;
  freeze();
});

elements.head.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-action="freeze"]');
  if (!form) return;
  event.preventDefault();
  const name = form.elements.actor.value.trim();
  if (name) freeze(name);
});

reducedMotionQuery.addEventListener('change', () => {
  disposeGl();
  syncRing();
});

setInterval(() => {
  if (document.visibilityState === 'visible') refreshProjects();
}, ELAPSED_REFRESH_MS);

async function start() {
  renderList();
  renderRun();
  try {
    state.me = await fetchMe();
  } catch {
    state.me = { actor: null, actorValid: false };
  }
  await refreshProjects();
  connect();
}

start();
