import { fetchDetail, fetchMe, fetchProjects, freezeGoal, saveActor } from './api.js';
import { renderOverview, renderProjectList, sortProjects, worktreeState } from './list.js';
import { renderDetail, renderRunHead } from './detail.js';
import { mountRing2d, ringMode, ringModel } from './ring2d.js';
import { createSheet } from './sheet.js';

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
  sheet: document.getElementById('details-sheet'),
  projects: document.getElementById('projects'),
  projectsToggle: document.getElementById('projects-toggle')
};

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const HAS_WEBGL = webglAvailable();
const ringView = { key: null, handle: null, bot: null, model: null, ticket: 0, loading: false, threeFailed: false };

const state = {
  projects: [],
  loaded: false,
  selectedId: new URLSearchParams(window.location.search).get('project'),
  detail: null,
  detailKey: null,
  detailError: null,
  me: { actor: null, actorValid: false },
  freezing: false,
  goalView: 'formatted'
};

let detailTicket = 0;

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!context) return false;
    const loseContext = context.getExtension('WEBGL_lose_context');
    if (loseContext) loseContext.loseContext();
    return true;
  } catch {
    return false;
  }
}

function wantsGlBot() {
  return ringMode({ webgl: HAS_WEBGL, threeFailed: ringView.threeFailed }) === '3d';
}

function disposeBot() {
  ringView.ticket += 1;
  ringView.loading = false;
  if (ringView.bot) ringView.bot.dispose();
  ringView.bot = null;
  elements.ring.dataset.bot = 'css';
  elements.ring.dataset.ring = 'flat';
}

function clearRing() {
  disposeBot();
  if (ringView.handle) ringView.handle.dispose();
  ringView.handle = null;
  ringView.key = null;
  elements.ring.hidden = true;
}

function syncBot() {
  if (!wantsGlBot()) {
    disposeBot();
    return;
  }
  if (ringView.bot) {
    ringView.bot.update(ringView.model);
    return;
  }
  if (ringView.loading) return;
  ringView.loading = true;
  const ticket = ringView.ticket;
  const failed = () => {
    ringView.threeFailed = true;
    if (ticket === ringView.ticket) disposeBot();
  };
  import('./ring.js').then(({ mountRing3d }) => {
    if (ticket !== ringView.ticket || !ringView.handle) return;
    ringView.loading = false;
    try {
      elements.ring.dataset.ring = '3d';
      ringView.bot = mountRing3d(ringView.handle.gl, ringView.model, { root: elements.ring, reducedMotion: reducedMotionQuery.matches });
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
  const view = { summary, findings: state.detail.findings, projectName: project.name };
  ringView.model = ringModel(summary.ring, summary);
  elements.ring.hidden = false;
  if (ringView.key !== key) {
    clearRing();
    elements.ring.hidden = false;
    ringView.key = key;
    ringView.handle = mountRing2d(elements.ring, view);
  } else {
    ringView.handle.update(view);
  }
  syncBot();
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
  const showing = Boolean(project && project.run && state.detail);
  elements.empty.hidden = showing;
  elements.empty.textContent = showing ? '' : emptyMessage(project);
  elements.run.dataset.showing = String(showing);
  elements.detailsButton.hidden = !showing;
  syncRing();
  if (!showing) {
    if (sheet.isOpen()) sheet.close();
    elements.head.innerHTML = '';
    elements.detail.innerHTML = '';
    return;
  }
  const input = elements.head.querySelector('#freeze-actor');
  const typed = input ? input.value : '';
  const typing = input && document.activeElement === input;
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
}

const sheet = createSheet(elements.sheet, {
  onOpenChange(open) {
    document.body.dataset.sheet = open ? 'open' : 'closed';
    elements.detailsButton.setAttribute('aria-expanded', String(open));
  }
});

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
  if (enter) playEnter();
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

async function withFreezeLock(button, operation) {
  if (state.freezing) return;
  state.freezing = true;
  setBusy(button, true);
  try {
    await operation();
  } catch (error) {
    setStatus(freezeFailure(error));
  } finally {
    state.freezing = false;
  }
  await refreshProjects();
  await loadDetail();
}

async function freeze(name) {
  const project = selectedProject();
  const detail = state.detail;
  if (!project || !detail || !detail.goalHash) {
    setStatus('There is no Goal draft to freeze. Reload the page.');
    return;
  }
  await withFreezeLock(elements.head.querySelector('button[data-action="freeze"]'), async () => {
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
  if ((event.key === 'd' || event.key === 'D') && !sheet.isOpen() && !elements.detailsButton.hidden) {
    event.preventDefault();
    sheet.open(elements.detailsButton);
  }
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

elements.ring.addEventListener('click', (event) => {
  if (event.target.closest('.ring-bot') && ringView.bot) ringView.bot.react();
});

elements.head.addEventListener('click', (event) => {
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
  disposeBot();
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
