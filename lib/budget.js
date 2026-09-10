'use strict';

const fs = require('fs');
const path = require('path');
const { assertRunId, getCurrentRun, loadRun } = require('./run-state.js');
const { loadPolicy, updatePolicy } = require('./runtime-policy.js');
const { ensurePrivateRuntimeIgnores } = require('./runtime-files.js');

function usageDir(rootDir) {
  return path.join(rootDir, '.ai-engineering-loop', 'usage');
}

function utcDay(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    const err = new Error('Usage timestamp must be a valid Date');
    err.code = 'INVALID_USAGE';
    throw err;
  }
  return now.toISOString().slice(0, 10);
}

function usagePath(rootDir, now = new Date()) {
  return path.join(usageDir(rootDir), `${utcDay(now)}.jsonl`);
}

function usageError(message, code = 'INVALID_USAGE') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function validateTokenCount(name, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw usageError(`${name} must be a non-negative integer`);
  }
}

function validateModel(model) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(String(model || ''))) {
    throw usageError('model must be a provider model identifier, not free-form text');
  }
  return String(model);
}

function readUsageFile(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (cause) {
    if (cause.code === 'ENOENT') return [];
    throw usageError(`Unable to inspect usage ledger: ${cause.message}`, 'INVALID_USAGE_LEDGER');
  }
  if (stat.isSymbolicLink()) {
    throw usageError('Usage ledger must not be a symbolic link', 'INVALID_USAGE_LEDGER');
  }
  let lines;
  try {
    lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  } catch (cause) {
    throw usageError(`Unable to read usage ledger: ${cause.message}`, 'INVALID_USAGE_LEDGER');
  }
  return lines.map((line, index) => {
    try {
      const entry = JSON.parse(line);
      assertRunId(entry.runId);
      validateTokenCount('inputTokens', entry.inputTokens);
      validateTokenCount('outputTokens', entry.outputTokens);
      if (entry.totalTokens !== entry.inputTokens + entry.outputTokens) {
        throw new Error('totalTokens does not equal inputTokens + outputTokens');
      }
      validateModel(entry.model);
      if (entry.nodeId != null && !/^[a-z][a-z0-9-]{0,63}$/.test(entry.nodeId)) {
        throw new Error('nodeId is invalid');
      }
      if (typeof entry.recordedAt !== 'string' || Number.isNaN(Date.parse(entry.recordedAt))) {
        throw new Error('recordedAt is invalid');
      }
      return entry;
    } catch (cause) {
      throw usageError(
        `Usage ledger line ${index + 1} is invalid: ${cause.message}`,
        'INVALID_USAGE_LEDGER'
      );
    }
  });
}

function readUsage(rootDir, now = new Date()) {
  return readUsageFile(usagePath(rootDir, now));
}

function readAllUsage(rootDir) {
  const directory = usageDir(rootDir);
  if (!fs.existsSync(directory)) return [];
  let names;
  try {
    names = fs.readdirSync(directory)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .sort();
  } catch (cause) {
    throw usageError(`Unable to enumerate usage ledgers: ${cause.message}`, 'INVALID_USAGE_LEDGER');
  }
  return names.flatMap((name) => readUsageFile(path.join(directory, name)));
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, assertRunId(runId));
  const current = getCurrentRun(rootDir);
  if (!current) throw usageError('No current run. Pass --run <id>.', 'NO_CURRENT_RUN');
  return current;
}

function budgetStatus(rootDir, { runId, nodeId, estimatedTokens = 0, now = new Date() } = {}) {
  validateTokenCount('estimatedTokens', estimatedTokens);
  const run = resolveRun(rootDir, runId);
  const policy = loadPolicy(rootDir);
  const todayEntries = readUsage(rootDir, now);
  const allEntries = readAllUsage(rootDir);
  const spentToday = todayEntries.reduce((sum, entry) => sum + entry.totalTokens, 0);
  const spentThisRun = allEntries
    .filter((entry) => entry.runId === run.runId)
    .reduce((sum, entry) => sum + entry.totalTokens, 0);
  const projectedToday = spentToday + estimatedTokens;
  const projectedThisRun = spentThisRun + estimatedTokens;
  const reasons = [];
  let node = null;
  let spentThisNode = 0;
  let nodeTokenLimit = null;
  if (nodeId) {
    const { workflowStatus, NODE_STATES } = require('./workflow-runtime.js');
    const workflow = workflowStatus(rootDir, { runId: run.runId });
    node = workflow.plan.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw usageError(`Unknown workflow node: ${nodeId}`);
    if (!node.capabilities.modelRequired) reasons.push(`node ${nodeId} does not permit model usage`);
    const status = workflow.state.nodes[nodeId].status;
    if (![NODE_STATES.READY, NODE_STATES.RUNNING].includes(status)) {
      reasons.push(`node ${nodeId} is ${status}, not READY`);
    }
    nodeTokenLimit = node.context?.maxTokens || null;
    spentThisNode = allEntries
      .filter((entry) => entry.runId === run.runId && entry.nodeId === nodeId)
      .reduce((sum, entry) => sum + entry.totalTokens, 0);
    if (nodeTokenLimit != null && spentThisNode + estimatedTokens > nodeTokenLimit) {
      reasons.push(`node ${nodeId} token limit would be exceeded`);
    }
    if (nodeTokenLimit != null && estimatedTokens === 0 && spentThisNode >= nodeTokenLimit) {
      reasons.push(`node ${nodeId} token limit is exhausted`);
    }
  }
  if (policy.killSwitch) reasons.push('kill switch is active');
  if (projectedThisRun > policy.perRunTokenLimit) reasons.push('per-run token limit would be exceeded');
  if (projectedToday > policy.dailyTokenLimit) reasons.push('daily token limit would be exceeded');
  if (estimatedTokens === 0 && spentThisRun >= policy.perRunTokenLimit) {
    reasons.push('per-run token limit is exhausted');
  }
  if (estimatedTokens === 0 && spentToday >= policy.dailyTokenLimit) {
    reasons.push('daily token limit is exhausted');
  }

  return {
    schemaVersion: 1,
    runId: run.runId,
    day: utcDay(now),
    allowed: reasons.length === 0,
    reasons: [...new Set(reasons)],
    killSwitch: policy.killSwitch,
    spentThisRun,
    perRunTokenLimit: policy.perRunTokenLimit,
    remainingThisRun: Math.max(0, policy.perRunTokenLimit - spentThisRun),
    spentToday,
    dailyTokenLimit: policy.dailyTokenLimit,
    remainingToday: Math.max(0, policy.dailyTokenLimit - spentToday),
    estimatedTokens,
    ...(node ? {
      nodeId,
      spentThisNode,
      nodeTokenLimit,
      remainingThisNode: nodeTokenLimit == null ? null : Math.max(0, nodeTokenLimit - spentThisNode)
    } : {})
  };
}

function assertBudgetAvailable(rootDir, options = {}) {
  const status = budgetStatus(rootDir, options);
  if (!status.allowed) {
    const err = new Error(`Token budget blocked: ${status.reasons.join('; ')}`);
    err.code = 'BUDGET_BLOCKED';
    err.details = status.reasons;
    err.status = status;
    throw err;
  }
  return status;
}

function appendPrivateLine(rootDir, filePath, line) {
  ensurePrivateRuntimeIgnores(rootDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let descriptor;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY | noFollow,
      0o600
    );
    if (!fs.fstatSync(descriptor).isFile()) throw new Error('usage ledger is not a regular file');
    fs.writeSync(descriptor, line);
    fs.fchmodSync(descriptor, 0o600);
  } catch (cause) {
    throw usageError(`Unable to append usage ledger: ${cause.message}`, 'USAGE_WRITE_FAILED');
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
  }
}

function recordTokenUsage(
  rootDir,
  { runId, nodeId, inputTokens, outputTokens, model, now = new Date() } = {}
) {
  const run = resolveRun(rootDir, runId);
  validateTokenCount('inputTokens', inputTokens);
  validateTokenCount('outputTokens', outputTokens);
  const normalizedModel = validateModel(model);
  const totalTokens = inputTokens + outputTokens;
  if (totalTokens === 0) throw usageError('A usage record must contain at least one token');
  const entry = {
    schemaVersion: 1,
    runId: run.runId,
    inputTokens,
    outputTokens,
    totalTokens,
    model: normalizedModel,
    ...(nodeId ? { nodeId } : {}),
    recordedAt: now.toISOString()
  };
  if (nodeId) budgetStatus(rootDir, { runId: run.runId, nodeId, now });
  appendPrivateLine(rootDir, usagePath(rootDir, now), `${JSON.stringify(entry)}\n`);
  return {
    entry,
    status: budgetStatus(rootDir, { runId: run.runId, nodeId, now })
  };
}

function setKillSwitch(rootDir, active) {
  return updatePolicy(rootDir, { killSwitch: Boolean(active) });
}

module.exports = {
  usageDir,
  utcDay,
  usagePath,
  readUsage,
  readAllUsage,
  budgetStatus,
  assertBudgetAvailable,
  recordTokenUsage,
  setKillSwitch
};
