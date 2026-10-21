'use strict';

// Iteration ceiling from the run's recipe and no-progress detection between
// Judge iterations (iteration-policy.md, no-progress-policy.md).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { runsDir } = require('./run-state.js');

const DEFAULT_MAX_ITERATIONS = 3;
const MAX_ITERATIONS_CEILING = 5;
const ITERATIONS_FILE = 'iterations.jsonl';

function clampIterations(value) {
  if (!Number.isSafeInteger(value)) return DEFAULT_MAX_ITERATIONS;
  return Math.min(MAX_ITERATIONS_CEILING, Math.max(1, value));
}

// The loop group that decides at the Judge node sets the ceiling. Runs without
// a workflow (legacy) or with an unreadable plan keep the default.
function runMaxIterations(rootDir, run) {
  if (!run?.workflow) return DEFAULT_MAX_ITERATIONS;
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(path.join(runsDir(rootDir), run.runId, 'plan.json'), 'utf8'));
  } catch {
    return DEFAULT_MAX_ITERATIONS;
  }
  const judgeIds = new Set((plan.nodes || [])
    .filter((node) => node && (node.legacyGate === 'judge' || node.type === 'judge'))
    .map((node) => node.id));
  const group = (plan.loopGroups || []).find((candidate) => judgeIds.has(candidate.decisionNodeId))
    || (plan.loopGroups || []).find((candidate) => (candidate.nodeIds || []).some((id) => judgeIds.has(id)));
  return group ? clampIterations(group.maxIterations) : DEFAULT_MAX_ITERATIONS;
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function findingSignature(finding) {
  return crypto.createHash('sha256')
    .update(`${normalizeText(finding.location)}\n${normalizeText(finding.failureScenario)}`)
    .digest('hex')
    .slice(0, 16);
}

function iterationsPath(rootDir, runId) {
  return path.join(runsDir(rootDir), runId, ITERATIONS_FILE);
}

function readIterations(rootDir, runId) {
  let text;
  try {
    text = fs.readFileSync(iterationsPath(rootDir, runId), 'utf8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A torn trailing line is ignored; the next append starts a fresh line.
    }
  }
  return entries;
}

// Returns the NO_PROGRESS reason when this ITERATE repeats the previous
// iteration: the same non-empty blocking findings, or an unchanged diff.
function detectNoProgress(rootDir, run, { diffHash, blockingFindings = [] }) {
  const previous = readIterations(rootDir, run.runId)
    .filter((entry) => entry.verdict === 'ITERATE' && entry.iteration < run.iteration)
    .pop();
  if (!previous) return null;
  if (diffHash && previous.diffHash === diffHash) {
    return `NO_PROGRESS: iteration ${run.iteration} has the same Maker diff as iteration ${previous.iteration}`;
  }
  const signatures = blockingFindings.map(findingSignature).sort();
  const before = [...(previous.blockingSignatures || [])].sort();
  if (signatures.length && signatures.length === before.length && signatures.every((sig, i) => sig === before[i])) {
    return `NO_PROGRESS: iteration ${run.iteration} repeats the blocking findings of iteration ${previous.iteration}`;
  }
  return null;
}

function recordIteration(rootDir, run, { verdict, diffHash, blockingFindings = [], now = new Date() }) {
  const entry = {
    iteration: run.iteration,
    verdict,
    diffHash: diffHash || null,
    blockingSignatures: blockingFindings.map(findingSignature),
    at: now.toISOString()
  };
  const filePath = iterationsPath(rootDir, run.runId);
  let prefix = '';
  try {
    const current = fs.readFileSync(filePath, 'utf8');
    if (current && !current.endsWith('\n')) prefix = '\n';
  } catch {
    // first entry
  }
  fs.appendFileSync(filePath, `${prefix}${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return entry;
}

module.exports = {
  DEFAULT_MAX_ITERATIONS,
  MAX_ITERATIONS_CEILING,
  ITERATIONS_FILE,
  runMaxIterations,
  findingSignature,
  readIterations,
  detectNoProgress,
  recordIteration
};
