'use strict';

// Baseline verification (C-10, learn-harness-engineering L06 + startup flow):
// before the Maker edits anything, run the project's own verification plan
// once on the frozen starting state. A broken command is caught before work
// starts, and failures that already existed are told apart from regressions.

const fs = require('fs');
const path = require('path');
const { atomicWriteJson, getCurrentRun, getGitRevision, loadRun, runsDir } = require('./run-state.js');

const BASELINE_FILE = 'baseline.json';
const COMMAND_NOT_FOUND = 127;

function baselineError(message, code, fix) {
  return Object.assign(new Error(fix ? `${message} FIX: ${fix}` : message), { code });
}

function resolveRun(rootDir, runId) {
  const run = runId ? loadRun(rootDir, runId) : getCurrentRun(rootDir);
  if (!run) throw baselineError('No current run.', 'NO_CURRENT_RUN', 'pass --run <id>.');
  return run;
}

// Failing test names from common runner output (node:test, TAP, jest, vitest,
// pytest). Best effort: an empty list means "could not tell", never "none".
function extractFailingTests(text) {
  const names = new Set();
  const patterns = [
    /^\s*✖\s+(.+?)\s+\(\d+(?:\.\d+)?m?s\)\s*$/gm, // node:test spec reporter
    /^not ok \d+ - (.+)$/gm, // TAP
    /^\s*●\s+(.+?)\s*$/gm, // jest
    /^\s*[×✗]\s+(.+?)(?:\s+\d+m?s)?\s*$/gm, // vitest
    /^FAILED\s+(\S+)/gm // pytest -rf
  ];
  const value = String(text || '');
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const name = match[1].trim();
      if (name && !/^failing tests:?$/i.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

const passedRecord = (record) => record.exitCode === 0 && record.timeoutStatus === 'COMPLETED';

// Run `plan` ([{ key, layer, command, args, shell }]) serially on the current
// tree and write runs/<id>/baseline.json. Must run before the Maker gate, so
// the tree is the frozen starting point.
async function recordBaseline(rootDir, { runId, plan, timeoutMs, runCommand } = {}) {
  const run = resolveRun(rootDir, runId);
  if (run.artifacts?.diff) {
    throw baselineError(`Run ${run.runId} already has a gated Maker diff; a baseline must describe the tree before the change.`,
      'BASELINE_TOO_LATE', 'start a new Run, or skip the baseline for this one.');
  }
  if (!Array.isArray(plan) || plan.length === 0) {
    throw baselineError('No baseline commands.', 'NO_BASELINE_COMMANDS',
      'add build/typecheck/lint/test_unit to .ai-engineering-loop/verification.md, or pass --cmd.');
  }
  const recorder = require('./verification-recorder.js');
  const exec = runCommand || recorder.runCommand;
  const limit = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : recorder.DEFAULT_TIMEOUT_MS;
  const records = [];
  const problems = [];
  for (const item of plan) {
    const result = await exec(item.command, item.args || [], { cwd: rootDir, timeoutMs: limit, shell: Boolean(item.shell) });
    const record = {
      key: item.key || null,
      layer: item.layer || null,
      command: result.command,
      exitCode: result.exitCode,
      timeoutStatus: result.timeoutStatus,
      failingTests: passedRecord(result) ? [] : extractFailingTests(`${result.stdout}\n${result.stderr}`)
    };
    records.push(record);
    if (result.exitCode === COMMAND_NOT_FOUND || result.launchError) {
      problems.push(`${record.command}: command not found (exit ${result.exitCode}). FIX: correct the ${record.key || 'command'} entry in .ai-engineering-loop/verification.md; verification cannot prove anything with it.`);
      break;
    }
  }
  const broken = problems.length > 0;
  const red = records.some((record) => !passedRecord(record));
  if (!broken && red) {
    for (const record of records.filter((r) => !passedRecord(r))) {
      problems.push(`${record.command}: already failing before any change (exit ${record.exitCode}${record.failingTests.length ? `; ${record.failingTests.length} failing test(s)` : ''}). FIX: repair the baseline in a separate Run first, or continue knowing these failures are pre-existing.`);
    }
  }
  const status = broken ? 'BROKEN' : (red ? 'RED' : 'GREEN');
  const document = {
    schemaVersion: 1,
    runId: run.runId,
    gitRevision: getGitRevision(rootDir),
    recordedAt: new Date().toISOString(),
    status,
    commands: records
  };
  const filePath = path.join(runsDir(rootDir), run.runId, BASELINE_FILE);
  atomicWriteJson(filePath, document);
  return {
    runId: run.runId,
    path: path.relative(rootDir, filePath).split(path.sep).join('/'),
    status,
    commands: records,
    problems
  };
}

function loadBaseline(rootDir, runId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runsDir(rootDir), runId, BASELINE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

// Label failing verification records as pre-existing (every failing test was
// already failing at baseline) or new. Records without a baseline counterpart,
// or whose failures cannot be named, stay "new": unknown is never excused.
function classifyAgainstBaseline(baseline, records) {
  const byCommand = new Map((baseline?.commands || []).map((record) => [record.command, record]));
  return (records || []).filter((record) => !passedRecord(record)).map((record) => {
    const before = byCommand.get(record.command);
    const failing = extractFailingTests(`${record.stdout || ''}\n${record.stderr || ''}`);
    const known = new Set(before?.failingTests || []);
    const fresh = failing.filter((name) => !known.has(name));
    const preExisting = Boolean(before && !passedRecord(before) && failing.length > 0 && fresh.length === 0);
    return { command: record.command, preExisting, newFailures: preExisting ? [] : (fresh.length ? fresh : failing) };
  });
}

module.exports = {
  BASELINE_FILE,
  classifyAgainstBaseline,
  extractFailingTests,
  loadBaseline,
  recordBaseline
};
