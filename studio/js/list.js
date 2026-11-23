const STATE_ORDER = { waiting: 0, working: 1, idle: 2, missing: 3 };

const STAGE_LABELS = {
  goal: 'Goal',
  maker: 'Maker',
  verify: 'Verify',
  review: 'Review',
  judge: 'Judge',
  deliver: 'Deliver'
};

const WAITING_LABELS = {
  freeze: 'Freeze?',
  approval: 'Approve delivery?',
  question: 'Agent asks you'
};

const STATE_LABELS = {
  waiting: 'Waiting for you',
  working: 'Working',
  idle: 'Idle',
  missing: 'Folder missing'
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || (stage ? String(stage) : '');
}

export function waitingLabel(waiting) {
  return waiting ? WAITING_LABELS[waiting.kind] || 'Waiting for you' : '';
}

export function formatElapsed(ms) {
  const minutes = Math.floor(Math.max(0, Number(ms) || 0) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function sortProjects(projects) {
  const rank = (project) => STATE_ORDER[project.state] ?? STATE_ORDER.idle;
  return [...(projects || [])].sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
}

function freezeWait(run) {
  return Boolean(run && run.waiting && run.waiting.kind === 'freeze');
}

function nameSuffix(run) {
  return freezeWait(run) ? ` <span class="row-ask">· ${WAITING_LABELS.freeze}</span>` : '';
}

function runMeta(run) {
  if (!run) return '';
  const waiting = freezeWait(run) ? '' : waitingLabel(run.waiting);
  const parts = [waiting || stageLabel(run.stage), run.tier, formatElapsed(run.elapsedMs)].filter(Boolean);
  return parts.map(escapeHtml).join(' · ');
}

const FINISHED_RUN_STATES = new Set(['REPORTED', 'DELIVERED', 'CANCELLED', 'ESCALATED']);

export function worktreeState(run) {
  if (run.waiting) return 'waiting';
  return FINISHED_RUN_STATES.has(run.state) ? 'idle' : 'working';
}

function listFreezeButton(targetId, run, actor, targetName) {
  if (!freezeWait(run)) return '';
  const label = actor ? `Freeze as ${escapeHtml(actor)}` : 'Freeze…';
  const accessibleName = actor ? `Freeze ${targetName} as ${actor}` : `Freeze ${targetName}`;
  return `<button type="button" class="primary list-freeze" data-action="list-freeze" data-project-id="${escapeHtml(targetId)}" data-run-id="${escapeHtml(run.runId)}" data-goal-hash="${escapeHtml(run.waiting.goalHash)}" aria-label="${escapeHtml(accessibleName)}">${label}</button>`;
}

function worktreeRow(run, selectedId, actor) {
  const selected = run.worktreeId === selectedId;
  const state = worktreeState(run);
  return `<li class="worktree-run" data-state="${state}">`
    + `<button type="button" class="worktree-row" data-project-id="${escapeHtml(run.worktreeId)}"${selected ? ' aria-current="true"' : ''}>`
    + `<span class="bot bot-${state}" aria-hidden="true"></span>`
    + `<span class="worktree-task">${escapeHtml(run.task || run.runId)}${nameSuffix(run)}</span>`
    + `<span class="row-meta">${runMeta(run)}</span></button>`
    + listFreezeButton(run.worktreeId, run, actor, run.task || run.runId)
    + '</li>';
}

function projectRow(project, selectedId, actor) {
  const selected = project.id === selectedId;
  const state = Object.hasOwn(STATE_ORDER, project.state) ? project.state : 'idle';
  const meta = project.run ? runMeta(project.run) : escapeHtml(state === 'missing' ? STATE_LABELS.missing : 'No active Run');
  const worktrees = (project.worktreeRuns || [])
    .filter((run) => run.worktreeId)
    .map((run) => worktreeRow(run, selectedId, actor))
    .join('');
  return `<li class="project" data-state="${state}">`
    + `<button type="button" class="project-row" data-project-id="${escapeHtml(project.id)}"${selected ? ' aria-current="true"' : ''}>`
    + `<span class="bot bot-${state}" role="img" aria-label="${STATE_LABELS[state]}"></span>`
    + `<span class="row-name">${escapeHtml(project.name)}${nameSuffix(project.run)}</span>`
    + `<span class="row-meta">${meta}</span>`
    + '</button>'
    + listFreezeButton(project.id, project.run, actor, project.name)
    + (worktrees ? `<ul class="worktree-runs" aria-label="Worktree Runs">${worktrees}</ul>` : '')
    + '</li>';
}

export function renderProjectList(projects, { selectedId = null, actor = null } = {}) {
  const sorted = sortProjects(projects);
  if (!sorted.length) {
    return '<p class="empty">No projects yet. AEL lists a project here once you run <code>ael init</code> or <code>ael run</code> in it.</p>';
  }
  return `<ul class="project-list">${sorted.map((project) => projectRow(project, selectedId, actor)).join('')}</ul>`;
}

export function renderOverview(projects) {
  const list = projects || [];
  const working = list.filter((project) => project.state === 'working').length;
  const waiting = list.filter((project) => project.state === 'waiting').length;
  const parts = [`${list.length} ${list.length === 1 ? 'project' : 'projects'}`, `${working} ${working === 1 ? 'bot' : 'bots'} working`];
  if (waiting) parts.push(`${waiting} waiting for you`);
  return escapeHtml(parts.join(' · '));
}
