import { fetchDetail, fetchMe, fetchProjects, freezeGoal, saveActor } from './api.js';
import { renderOverview, renderProjectList, sortProjects } from './list.js';
import { renderDetail, renderRunHead } from './detail.js';

const ELAPSED_REFRESH_MS = 60_000;

const elements = {
  overview: document.getElementById('overview'),
  connection: document.getElementById('connection'),
  list: document.getElementById('project-list'),
  run: document.getElementById('run'),
  empty: document.getElementById('run-empty'),
  head: document.getElementById('run-head'),
  status: document.getElementById('run-status'),
  detail: document.getElementById('run-detail')
};

const state = {
  projects: [],
  loaded: false,
  selectedId: new URLSearchParams(window.location.search).get('project'),
  detail: null,
  detailKey: null,
  detailError: null,
  me: { actor: null, actorValid: false },
  freezing: false
};

let detailTicket = 0;

function selectedProject() {
  return state.projects.find((project) => project.id === state.selectedId) || null;
}

function runKey(project) {
  const run = project && project.run;
  return run ? [project.id, run.runId, run.state, run.updatedAt, run.stage, run.waiting && run.waiting.kind].join('|') : null;
}

function focusedProjectId() {
  const row = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-project-id]');
  return row ? row.dataset.projectId : null;
}

function renderList() {
  const focusedId = focusedProjectId();
  elements.list.innerHTML = state.loaded ? renderProjectList(state.projects, { selectedId: state.selectedId }) : '';
  elements.overview.innerHTML = state.loaded ? renderOverview(state.projects) : 'Loading projects…';
  if (!focusedId) return;
  const row = [...elements.list.querySelectorAll('[data-project-id]')].find((button) => button.dataset.projectId === focusedId);
  if (row) row.focus();
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
  if (!showing) {
    elements.head.innerHTML = '';
    elements.detail.innerHTML = '';
    return;
  }
  const input = elements.head.querySelector('#freeze-actor');
  const typed = input ? input.value : '';
  const typing = input && document.activeElement === input;
  elements.head.innerHTML = renderRunHead(state.detail.summary, {
    projectName: project.name,
    actor: state.me.actorValid ? state.me.actor : null
  });
  elements.detail.innerHTML = renderDetail(state.detail);
  const next = elements.head.querySelector('#freeze-actor');
  if (next && typed) next.value = typed;
  if (next && typing) next.focus();
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

function setBusy(busy) {
  const button = elements.head.querySelector('button[data-action="freeze"]');
  if (!button) return;
  button.disabled = busy;
  if (busy) button.textContent = 'Freezing…';
}

function freezeFailure(error) {
  if (error.code === 'GOAL_DRAFT_CONFLICT') return 'The Goal changed since you opened it. The new draft is shown; read it and freeze again.';
  return error.fix ? `${error.message}. ${error.fix}` : error.message;
}

async function freeze(name) {
  if (state.freezing) return;
  const project = selectedProject();
  const detail = state.detail;
  if (!project || !detail || !detail.goalHash) {
    setStatus('There is no Goal draft to freeze. Reload the page.');
    return;
  }
  state.freezing = true;
  setBusy(true);
  try {
    if (name !== undefined) state.me = await saveActor(name);
    const result = await freezeGoal(project.id, detail.summary.runId, detail.goalHash);
    setStatus(result.alreadyFrozen ? 'This Goal was already frozen in the agent host.' : `Goal frozen as ${state.me.actor}.`);
  } catch (error) {
    setStatus(freezeFailure(error));
  } finally {
    state.freezing = false;
  }
  await refreshProjects();
  await loadDetail();
}

function setConnection(message) {
  elements.connection.hidden = !message;
  elements.connection.textContent = message || '';
}

function connect() {
  const source = new EventSource('/api/events');
  source.addEventListener('projects', (event) => {
    setConnection(null);
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    applyProjects(payload.projects);
  });
  source.addEventListener('error', () => {
    setConnection(source.readyState === EventSource.CLOSED
      ? 'Lost the Studio connection. Start `ael studio` again, then reload this page.'
      : 'Reconnecting to Studio…');
  });
}

elements.list.addEventListener('click', (event) => {
  const row = event.target.closest('[data-project-id]');
  if (row) select(row.dataset.projectId);
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
