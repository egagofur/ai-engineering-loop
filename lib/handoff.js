'use strict';

const fs = require('fs');
const path = require('path');
const { canonicalJson, sha256 } = require('./recipe.js');
const { atomicWriteJson, getCurrentRun, loadRun, runsDir } = require('./run-state.js');
const { redactSecrets } = require('./safe-context.js');
const { workflowStatus } = require('./workflow-runtime.js');

const AUDIENCES = new Set(['developer', 'agent', 'auditor']);
const MAX_BUNDLE_BYTES = 1024 * 1024;

function handoffError(message, code = 'HANDOFF_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveRun(rootDir, runId) {
  const run = runId ? loadRun(rootDir, runId) : getCurrentRun(rootDir);
  if (!run) throw handoffError('No current run. Pass --run <id>.', 'NO_CURRENT_RUN');
  return run;
}

function redactValue(value, categories) {
  if (typeof value === 'string') {
    const result = redactSecrets(value);
    result.categories.forEach((category) => categories.add(category));
    const redacted = result.text
      .replace(/(?:file:\/\/)?\/?Users\/[A-Za-z0-9._-]+/g, '[REDACTED HOME]')
      .replace(/\b[A-Z]:\\Users\\[^\\\s]+/gi, '[REDACTED HOME]');
    if (redacted !== result.text) categories.add('HOME_PATH');
    return redacted;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, categories));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, categories)]));
  }
  return value;
}

function loadOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw handoffError('Optional handoff input must be a regular file');
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw handoffError(`Optional handoff input is invalid JSON: ${cause.message}`, 'INVALID_HANDOFF_INPUT');
  }
}

function recordDecision(rootDir, {
  runId,
  summary,
  rationale,
  consequences = [],
  now = new Date()
} = {}) {
  const run = resolveRun(rootDir, runId);
  if (typeof summary !== 'string' || !summary.trim() || summary.trim().length > 160) {
    throw handoffError('Decision summary must be 1-160 characters', 'INVALID_DECISION');
  }
  if (typeof rationale !== 'string' || !rationale.trim() || rationale.trim().length > 1000) {
    throw handoffError('Decision rationale must be 1-1000 characters', 'INVALID_DECISION');
  }
  if (!Array.isArray(consequences) || consequences.length > 20 || consequences.some(
    (item) => typeof item !== 'string' || !item.trim() || item.length > 240
  )) {
    throw handoffError('Decision consequences must contain at most 20 short strings', 'INVALID_DECISION');
  }
  const filePath = path.join(runsDir(rootDir), run.runId, 'decisions.json');
  const decisions = loadOptionalJson(filePath) || [];
  if (!Array.isArray(decisions) || decisions.length >= 100) {
    throw handoffError('Decision memory must be an array with fewer than 100 entries', 'INVALID_DECISION');
  }
  const categories = new Set();
  const entry = redactValue({
    id: `decision-${String(decisions.length + 1).padStart(3, '0')}`,
    summary: summary.trim(),
    rationale: rationale.trim(),
    consequences: consequences.map((item) => item.trim()),
    recordedAt: now.toISOString()
  }, categories);
  atomicWriteJson(filePath, [...decisions, entry]);
  return { runId: run.runId, decision: entry, redactionCategories: [...categories].sort() };
}

function createHandoff(rootDir, { runId, audience = 'developer', now = new Date() } = {}) {
  if (!AUDIENCES.has(audience)) throw handoffError(`Invalid audience: ${audience}`);
  const run = resolveRun(rootDir, runId);
  const directory = path.join(runsDir(rootDir), run.runId);
  const workflow = run.workflow ? workflowStatus(rootDir, { runId: run.runId }) : null;
  const decisions = loadOptionalJson(path.join(directory, 'decisions.json')) || [];
  if (!Array.isArray(decisions)) throw handoffError('Decision memory must be an array', 'INVALID_HANDOFF_INPUT');
  const categories = new Set();
  const content = redactValue({
    objective: run.task,
    state: run.state,
    mode: run.mode,
    iteration: run.iteration,
    recipe: run.workflow || null,
    nodes: workflow ? workflow.plan.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      status: workflow.state.nodes[node.id].status,
      attempts: workflow.state.nodes[node.id].attempts,
      reason: workflow.state.nodes[node.id].reason || null,
      activity: workflow.state.nodes[node.id].activity || null
    })) : [],
    artifacts: run.artifacts,
    decisions,
    transitions: run.history,
    nextActions: workflow
      ? workflow.plan.nodes.filter((node) => workflow.state.nodes[node.id].status === 'READY').map((node) => node.id)
      : []
  }, categories);
  const material = {
    schemaVersion: 1,
    audience,
    runId: run.runId,
    generatedAt: now.toISOString(),
    graphHash: run.workflow?.graphHash || null,
    finalState: run.state,
    redacted: true,
    sourceIncluded: false,
    redactionCategories: [...categories].sort(),
    content
  };
  return { ...material, bundleHash: sha256(material) };
}

function handoffBrief(bundle) {
  const lines = [
    '# Engineering Handoff',
    '',
    `Run: ${bundle.runId}`,
    `State: ${bundle.finalState}`,
    `Mode: ${bundle.content.mode}`,
    `Graph: ${bundle.graphHash || 'legacy'}`,
    '',
    '## Objective',
    bundle.content.objective || 'Not recorded.',
    '',
    '## Workflow',
    ...bundle.content.nodes.map((node) => `- ${node.id}: ${node.status}${node.reason ? ` — ${node.reason}` : ''}`),
    '',
    '## Decisions',
    ...(bundle.content.decisions.length ? bundle.content.decisions.map((decision) => `- ${decision.decision || decision.summary || JSON.stringify(decision)}`) : ['- None recorded.']),
    '',
    '## Evidence',
    ...Object.entries(bundle.content.artifacts).map(([name, artifact]) => (
      `- ${name}: ${artifact && typeof artifact === 'object' ? artifact.sha256 || 'recorded' : 'recorded'}`
    )),
    '',
    '## Next actions',
    ...(bundle.content.nextActions.length ? bundle.content.nextActions.map((action) => `- ${action}`) : ['- No READY nodes.'])
  ];
  return lines.join('\n');
}

function verifyHandoff(bundle) {
  if (!bundle || bundle.schemaVersion !== 1 || !AUDIENCES.has(bundle.audience)) {
    throw handoffError('Handoff manifest is invalid', 'INVALID_HANDOFF');
  }
  const { bundleHash, ...material } = bundle;
  if (bundleHash !== sha256(material)) throw handoffError('Handoff bundle hash does not match', 'HANDOFF_TAMPERED');
  return {
    valid: true,
    runId: bundle.runId,
    audience: bundle.audience,
    bundleHash,
    canonicalBytes: Buffer.byteLength(canonicalJson(bundle))
  };
}

function readHandoff(rootDir, file) {
  const absolute = path.resolve(rootDir, file);
  const relative = path.relative(rootDir, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) throw handoffError('Handoff path escapes repository');
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch (cause) {
    throw handoffError(`Unable to inspect handoff: ${cause.message}`, 'INVALID_HANDOFF');
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_BUNDLE_BYTES) {
    throw handoffError('Handoff must be a regular file under 1 MiB');
  }
  const realRoot = fs.realpathSync(rootDir);
  const realFile = fs.realpathSync(absolute);
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) {
    throw handoffError('Handoff path escapes repository through a symlink');
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (cause) {
    throw handoffError(`Handoff is invalid JSON: ${cause.message}`, 'INVALID_HANDOFF');
  }
}

module.exports = {
  AUDIENCES,
  createHandoff,
  handoffBrief,
  recordDecision,
  verifyHandoff,
  readHandoff
};
