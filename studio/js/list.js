export const STAGES = ['goal', 'maker', 'verify', 'review', 'judge', 'deliver'];

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

export function freezeWait(run) {
  return Boolean(run && run.waiting && run.waiting.kind === 'freeze');
}

export function runMeta(run) {
  if (!run) return '';
  const waiting = freezeWait(run) ? '' : waitingLabel(run.waiting);
  return [waiting || stageLabel(run.stage), run.tier, formatElapsed(run.elapsedMs)].filter(Boolean).join(' · ');
}

export const FINISHED_RUN_STATES = new Set(['REPORTED', 'DELIVERED', 'CANCELLED', 'ESCALATED']);

export function worktreeState(run) {
  if (run.waiting) return 'waiting';
  return FINISHED_RUN_STATES.has(run.state) ? 'idle' : 'working';
}

export function projectState(project) {
  return Object.hasOwn(STATE_ORDER, project && project.state) ? project.state : 'idle';
}

export function stateLabel(state) {
  return STATE_LABELS[state] || STATE_LABELS.idle;
}

export function projectMeta(project) {
  if (project.run) return runMeta(project.run);
  return projectState(project) === 'missing' ? STATE_LABELS.missing : 'No active Run';
}

export function worktreeRows(project) {
  return (project.worktreeRuns || []).filter((run) => run.worktreeId);
}

export function listFreezeLabel(actor) {
  return actor ? `Freeze as ${actor}` : 'Freeze…';
}

export function listFreezeName(targetName, actor) {
  return actor ? `Freeze ${targetName} as ${actor}` : `Freeze ${targetName}`;
}

export function overviewChips(projects) {
  const list = projects || [];
  const working = list.filter((project) => project.state === 'working').length;
  const waiting = list.filter((project) => project.state === 'waiting').length;
  const chips = [{ kind: 'count', text: `${list.length} ${list.length === 1 ? 'kitchen' : 'kitchens'}` }];
  chips.push({ kind: working ? 'working' : 'count', text: `${working} ${working === 1 ? 'chef' : 'chefs'} cooking` });
  if (waiting) chips.push({ kind: 'waiting', text: `${waiting} ${waiting === 1 ? 'order needs' : 'orders need'} you` });
  return chips;
}
