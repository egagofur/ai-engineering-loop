'use strict';

const fs = require('fs');
const path = require('path');
const { assertRunId, loadRun, runDisplayMetadata, runsDir } = require('./run-state.js');
const { redactSecrets } = require('./safe-context.js');

const MAX_ARTIFACT_BYTES = 64 * 1024;

function historyError(message, code = 'RUN_HISTORY_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function redactedValue(value) {
  return JSON.parse(redactSecrets(JSON.stringify(value)).text);
}

function regularRunDirectory(rootDir, runId) {
  assertRunId(runId);
  const directory = path.join(runsDir(rootDir), runId);
  let directoryStat;
  let stateStat;
  try {
    directoryStat = fs.lstatSync(directory);
    stateStat = fs.lstatSync(path.join(directory, 'state.json'));
  } catch (cause) {
    throw historyError(`Run ${runId} is unavailable: ${cause.message}`, 'RUN_NOT_FOUND');
  }
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory() ||
      stateStat.isSymbolicLink() || !stateStat.isFile()) {
    throw historyError(`Run ${runId} is not a regular persisted run`, 'INVALID_RUN_HISTORY');
  }
  return directory;
}

function summaryFor(run) {
  const presentation = run.displayName && run.slug
    ? { displayName: run.displayName, slug: run.slug, keywords: run.keywords || [] }
    : runDisplayMetadata(run.task);
  return redactedValue({
    runId: run.runId,
    ...presentation,
    task: run.task,
    status: run.state,
    mode: run.mode,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    goalVersion: run.goal?.version || null,
    goalFrozen: run.goal?.frozen === true
  });
}

function searchableText(rootDir, run) {
  const workflowTerms = run.workflow
    ? JSON.stringify(require('./workflow-runtime.js').workflowStatus(rootDir, { runId: run.runId }))
    : '';
  const artifactTerms = run.artifacts ? JSON.stringify(run.artifacts) : '';
  return `${JSON.stringify(summaryFor(run))} ${workflowTerms} ${artifactTerms}`.toLocaleLowerCase('en-US');
}

function listRunHistory(rootDir, { query = '', status, mode, from, to } = {}) {
  const directory = runsDir(rootDir);
  if (!fs.existsSync(directory)) return { runs: [], corrupt: [] };
  const needle = String(query || '').trim().toLocaleLowerCase('en-US');
  const runs = [];
  const corrupt = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'current.json' || !entry.isDirectory()) continue;
    try {
      regularRunDirectory(rootDir, entry.name);
      const run = loadRun(rootDir, entry.name);
      if (run.workflow) require('./workflow-runtime.js').workflowStatus(rootDir, { runId: run.runId });
      const created = Date.parse(run.createdAt);
      if (status && run.state !== status) continue;
      if (mode && run.mode !== mode) continue;
      if (from && (!Number.isFinite(created) || created < Date.parse(from))) continue;
      if (to && (!Number.isFinite(created) || created > Date.parse(to))) continue;
      if (needle && !searchableText(rootDir, run).includes(needle)) continue;
      runs.push(summaryFor(run));
    } catch (error) {
      corrupt.push({ runId: entry.name, code: error.code || 'INVALID_RUN_HISTORY', error: error.message });
    }
  }
  runs.sort((left, right) =>
    String(right.createdAt || '').localeCompare(String(left.createdAt || '')) ||
    left.runId.localeCompare(right.runId)
  );
  corrupt.sort((left, right) => left.runId.localeCompare(right.runId));
  return { runs, corrupt };
}

function runHistoryDetail(rootDir, runId) {
  const directory = regularRunDirectory(rootDir, runId);
  const run = loadRun(rootDir, runId);
  let workflow = null;
  let decisions = [];
  const decisionsPath = path.join(directory, 'decisions.json');
  if (fs.existsSync(decisionsPath)) {
    const stat = fs.lstatSync(decisionsPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) {
      throw historyError('Run decisions must be a bounded regular file', 'INVALID_RUN_HISTORY');
    }
    try {
      decisions = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
    } catch (cause) {
      throw historyError(`Run decisions are invalid: ${cause.message}`, 'INVALID_RUN_HISTORY');
    }
    if (!Array.isArray(decisions)) throw historyError('Run decisions must be an array', 'INVALID_RUN_HISTORY');
  }
  let events = [];
  if (run.workflow) {
    workflow = require('./workflow-runtime.js').workflowStatus(rootDir, { runId });
    events = workflow.events.map(({ initialNodes, changes, ...event }) => ({
      ...event,
      changedNodes: (changes || []).map((change) => change.nodeId)
    }));
  }
  const nodeArtifacts = Object.fromEntries(
    Object.entries(workflow?.state?.nodes || {})
      .filter(([, node]) => node.artifact?.path)
      .map(([nodeId, node]) => [`node:${nodeId}`, node.artifact])
  );
  const artifacts = { ...(run.artifacts || {}), ...nodeArtifacts };
  const artifactValues = Object.values(artifacts);
  return redactedValue({
    ...summaryFor(run),
    history: run.history || [],
    events,
    decisions,
    artifacts,
    evidence: {
      present: artifactValues.some((artifact) =>
        artifact && typeof artifact === 'object' &&
        /(?:evidence|verification|findings|verdict)/i.test(String(artifact.path || ''))
      )
    },
    workflow: run.workflow || null
  });
}

function inspectRunArtifact(rootDir, runId, relativePath, { maxBytes = MAX_ARTIFACT_BYTES } = {}) {
  const directory = regularRunDirectory(rootDir, runId);
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw historyError('Artifact path must be relative to its run', 'UNSAFE_HISTORY_PATH');
  }
  const normalized = String(relativePath).replace(/\\/g, '/');
  const descriptorPrefix = `.ai-engineering-loop/runs/${runId}/`;
  const runRelativePath = normalized.startsWith(descriptorPrefix)
    ? normalized.slice(descriptorPrefix.length)
    : normalized;
  const requested = path.resolve(directory, runRelativePath);
  const relative = path.relative(directory, requested);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw historyError('Artifact path escapes its owning run', 'UNSAFE_HISTORY_PATH');
  }
  let stat;
  let real;
  try {
    stat = fs.lstatSync(requested);
    real = fs.realpathSync(requested);
  } catch (cause) {
    throw historyError(`Artifact is unavailable: ${cause.message}`, 'HISTORY_ARTIFACT_NOT_FOUND');
  }
  const realDirectory = fs.realpathSync(directory);
  const realRelative = path.relative(realDirectory, real);
  if (stat.isSymbolicLink() || !stat.isFile() ||
      realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw historyError('Artifact must be a regular file inside its owning run', 'UNSAFE_HISTORY_PATH');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ARTIFACT_BYTES) {
    throw historyError(`Artifact limit must be between 1 and ${MAX_ARTIFACT_BYTES} bytes`, 'INVALID_HISTORY_LIMIT');
  }
  if (stat.size > maxBytes) {
    throw historyError(`Artifact exceeds the ${maxBytes} byte inspection limit`, 'HISTORY_ARTIFACT_TOO_LARGE');
  }
  const redacted = redactSecrets(fs.readFileSync(real, 'utf8'));
  return {
    runId,
    path: relative.split(path.sep).join('/'),
    size: stat.size,
    content: redacted.text,
    redactions: redacted.categories
  };
}

module.exports = {
  MAX_ARTIFACT_BYTES,
  listRunHistory,
  runHistoryDetail,
  inspectRunArtifact
};
