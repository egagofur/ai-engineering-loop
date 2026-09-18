'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWriteJson, getCurrentRun, loadRun, runsDir } = require('./run-state.js');

function verificationSummaryError(message, code = 'VERIFICATION_SUMMARY_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, runId);
  const current = getCurrentRun(rootDir);
  if (!current) throw verificationSummaryError('No current run. Pass --run <id>.', 'NO_CURRENT_RUN');
  return current;
}

function parseCount(patterns, text) {
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function testCountsFromText(text) {
  const total = parseCount([
    /\btests?\s+(\d+)\b/i,
    /\b(\d+)\s+tests?\b/i,
    /\btotal[:=\s]+(\d+)\b/i
  ], text);
  const passed = parseCount([
    /\bpass(?:ed)?\s+(\d+)\b/i,
    /\b(\d+)\s+pass(?:ed)?\b/i
  ], text);
  const failed = parseCount([
    /\bfail(?:ed)?\s+(\d+)\b/i,
    /\b(\d+)\s+fail(?:ed)?\b/i
  ], text);
  return {
    passed: passed ?? null,
    failed: failed ?? null,
    total: total ?? (passed != null && failed != null ? passed + failed : null)
  };
}

function mergeCounts(left, right) {
  const sumOrNull = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));
  return {
    passed: sumOrNull(left.passed, right.passed),
    failed: sumOrNull(left.failed, right.failed),
    total: sumOrNull(left.total, right.total)
  };
}

function failureExcerpt(command) {
  if (Number(command.exitCode || 0) === 0 && !command.timedOut) return null;
  const source = [command.stderr, command.stdout].map((value) => String(value || '').trim()).find(Boolean);
  if (!source) return command.timedOut ? 'Command timed out' : `Command exited ${command.exitCode}`;
  return source.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 3).join('\n').slice(0, 800);
}

function summarizeCommand(command) {
  const output = `${command.stdout || ''}\n${command.stderr || ''}`;
  return {
    command: String(command.command || ''),
    exitCode: Number(command.exitCode || 0),
    timedOut: Boolean(command.timedOut || command.timeoutStatus === 'TIMED_OUT'),
    durationMs: Number.isFinite(command.durationMs) ? command.durationMs : null,
    startedAt: command.startedAt || null,
    finishedAt: command.finishedAt || null,
    testCounts: testCountsFromText(output),
    failureExcerpt: failureExcerpt(command)
  };
}

function summarizeVerificationBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw verificationSummaryError('verification bundle must be a JSON object', 'INVALID_VERIFICATION');
  }
  const commands = (bundle.commands || []).map(summarizeCommand);
  const testCounts = commands
    .map((command) => command.testCounts)
    .reduce(mergeCounts, { passed: null, failed: null, total: null });
  const exitCode = commands.some((command) => command.timedOut)
    ? 1
    : commands.reduce((highest, command) => Math.max(highest, command.exitCode), 0);
  return {
    schemaVersion: 1,
    runId: bundle.runId || null,
    generatedAt: new Date().toISOString(),
    gitRevision: bundle.gitRevision || bundle.revision || null,
    diffHash: bundle.diffHash || null,
    commandCount: commands.length,
    exitCode,
    passed: exitCode === 0,
    testCounts,
    commands
  };
}

function readVerificationBundle(rootDir, runId) {
  const run = resolveRun(rootDir, runId);
  const filePath = path.join(runsDir(rootDir), run.runId, 'verification.json');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw verificationSummaryError(`Unable to read verification.json: ${cause.message}`, 'INVALID_VERIFICATION');
  }
  return { run, filePath, bundle: parsed };
}

function writeVerificationSummary(rootDir, { runId } = {}) {
  const { run, bundle } = readVerificationBundle(rootDir, runId);
  const summary = summarizeVerificationBundle({ ...bundle, runId: bundle.runId || run.runId });
  const filePath = path.join(runsDir(rootDir), run.runId, 'verification-summary.json');
  atomicWriteJson(filePath, summary);
  return {
    summary,
    path: path.relative(rootDir, filePath).split(path.sep).join('/')
  };
}

module.exports = {
  summarizeVerificationBundle,
  writeVerificationSummary
};
