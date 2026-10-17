'use strict';

// `ael learn` (#61): mine past Runs' finding ledgers into project learnings.
// Deterministic (no model call): VALID findings are clustered per review axis
// by word overlap, deduped, and written with their runId provenance to
// .ai-engineering-loop/learnings.json (+ learnings.md). Context packs inject
// the most relevant entries within their token budget.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { atomicWriteJson, atomicWritePrivateFile, runsDir } = require('./run-state.js');
const { listRunHistory } = require('./run-history.js');
const { estimateTokens, redactHomePaths, redactSecrets } = require('./safe-context.js');

const LEARNINGS_JSON = 'learnings.json';
const LEARNINGS_MD = 'learnings.md';
const MAX_LEDGER_BYTES = 256 * 1024;
const MAX_LESSON_CHARS = 300;
const DEFAULT_MAX_AGE_RUNS = 20;
const CLUSTER_THRESHOLD = 0.6;
const SEVERITY_RANK = Object.freeze({ BLOCKER: 4, HIGH: 3, MEDIUM: 2, LOW: 1 });
const MAX_CONTEXT_LEARNINGS = 5;
// Share of a stage's token budget that learnings may use.
const LEARNINGS_BUDGET_SHARE = 0.1;
// CLI-generated findings that describe one Run, not a reusable lesson.
const NON_LESSON_SOURCES = new Set(['impact-map']);
const REJECTED = new Set(['REJECTED', 'DISMISSED', 'WONT_FIX', 'INVALID']);
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'then', 'than', 'will', 'would', 'should',
  'must', 'could', 'have', 'does', 'are', 'was', 'were', 'not', 'but', 'can', 'its', 'their', 'there', 'which',
  'yang', 'dan', 'untuk', 'dengan', 'dari', 'pada', 'tidak', 'akan', 'bisa', 'atau', 'ini', 'itu'
]);

function learnError(message, code = 'LEARN_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function learningsPath(rootDir, file = LEARNINGS_JSON) {
  return path.join(rootDir, '.ai-engineering-loop', file);
}

function safeText(value, max = MAX_LESSON_CHARS) {
  const text = redactHomePaths(redactSecrets(String(value ?? '')).text).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function signature(text) {
  return [...new Set(String(text || '')
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word)))].sort();
}

function jaccard(left, right) {
  if (!left.length && !right.length) return 1;
  const set = new Set(left);
  const shared = right.filter((word) => set.has(word)).length;
  return shared / (left.length + right.length - shared);
}

function locationPath(location) {
  const value = String(location || '').split('#')[0].replace(/:\d+(?::\d+)?$/, '').replace(/\\/g, '/').trim();
  if (!value || path.isAbsolute(value) || value.split('/').includes('..') || /\s/.test(value)) return null;
  return value;
}

function readLedger(rootDir, runId) {
  const filePath = path.join(runsDir(rootDir), runId, 'findings.json');
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_LEDGER_BYTES) return null;
  try {
    const ledger = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(ledger?.findings) ? ledger : null;
  } catch {
    return null;
  }
}

// Valid, accepted findings only: INVALID validity or a rejected resolution
// never becomes a lesson.
function isLesson(finding) {
  if (!finding || finding.validity !== 'VALID') return false;
  if (NON_LESSON_SOURCES.has(finding.source)) return false;
  for (const key of ['status', 'resolution', 'decision']) {
    if (REJECTED.has(String(finding[key] || '').toUpperCase())) return false;
  }
  return Boolean(String(finding.failureScenario || '').trim());
}

function readExisting(rootDir) {
  const filePath = learningsPath(rootDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value?.schemaVersion === 1 ? value : null;
  } catch {
    return null;
  }
}

function collectOccurrences(rootDir) {
  // listRunHistory is newest first; mining runs oldest first keeps cluster
  // ids stable as new Runs arrive.
  const runs = [...listRunHistory(rootDir).runs].reverse();
  const occurrences = [];
  for (const run of runs) {
    const ledger = readLedger(rootDir, run.runId);
    if (!ledger) continue;
    const findings = [...ledger.findings].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const finding of findings.filter(isLesson)) {
      occurrences.push({
        runId: run.runId,
        createdAt: run.createdAt || '',
        axis: finding.axis || 'spec',
        severity: SEVERITY_RANK[finding.severity] ? finding.severity : 'LOW',
        lesson: safeText(finding.failureScenario),
        location: locationPath(finding.location),
        words: signature(finding.failureScenario)
      });
    }
  }
  return { runs, occurrences };
}

function clusterOccurrences(occurrences) {
  const clusters = [];
  for (const item of occurrences) {
    const cluster = clusters.find((entry) => entry.axis === item.axis && jaccard(entry.words, item.words) >= CLUSTER_THRESHOLD);
    if (!cluster) {
      clusters.push({
        id: `L-${crypto.createHash('sha256').update(`${item.axis}|${item.words.join(' ')}`).digest('hex').slice(0, 10)}`,
        axis: item.axis,
        words: item.words,
        items: [item]
      });
    } else {
      cluster.items.push(item);
    }
  }
  return clusters;
}

function entryFor(cluster) {
  const latest = cluster.items[cluster.items.length - 1];
  const severity = cluster.items.reduce((best, item) => (SEVERITY_RANK[item.severity] > SEVERITY_RANK[best] ? item.severity : best), 'LOW');
  const runIds = [...new Set(cluster.items.map((item) => item.runId))].sort();
  return {
    id: cluster.id,
    axis: cluster.axis,
    severity,
    lesson: latest.lesson,
    locations: [...new Set(cluster.items.map((item) => item.location).filter(Boolean))].sort(),
    occurrences: cluster.items.length,
    runIds,
    firstRunId: cluster.items[0].runId,
    lastRunId: latest.runId,
    lastSeenAt: latest.createdAt
  };
}

function byRelevance(left, right) {
  return right.occurrences - left.occurrences ||
    SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
    left.id.localeCompare(right.id);
}

function pruneReason(rootDir, entry, runIndex, maxAgeRuns) {
  if (entry.locations.length && entry.locations.every((file) => !fs.existsSync(path.join(rootDir, file)))) return 'files-removed';
  const age = runIndex.get(entry.lastRunId);
  if (age != null && age >= maxAgeRuns) return 'stale';
  return null;
}

function renderMarkdown(document) {
  const lines = [
    '# Project learnings',
    '',
    `Generated by \`npx ai-engineering-loop learn\` from ${document.sourceRuns} Run(s). Do not edit entries by hand; mark one superseded with \`"supersededBy"\` in ${LEARNINGS_JSON} and run \`learn --prune\`.`,
    ''
  ];
  if (!document.entries.length) lines.push('_No recurring lessons yet._');
  for (const entry of document.entries) {
    const where = entry.locations.length ? ` (${entry.locations.join(', ')})` : '';
    lines.push(`- **${entry.id}** [${entry.axis}, ${entry.severity}, ×${entry.occurrences}] ${entry.lesson}${where} — runs: ${entry.runIds.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

function learn(rootDir, { dryRun = false, prune = false, maxAgeRuns = DEFAULT_MAX_AGE_RUNS } = {}) {
  if (!Number.isSafeInteger(maxAgeRuns) || maxAgeRuns < 1) throw learnError('--max-age-runs must be a positive integer', 'INVALID_USAGE');
  const existing = readExisting(rootDir);
  const { runs, occurrences } = collectOccurrences(rootDir);
  const createdAt = new Map(runs.map((run) => [run.runId, run.createdAt || '']));
  // Newest run = age 0.
  const runIndex = new Map([...runs].reverse().map((run, index) => [run.runId, index]));
  const suppressed = new Map((existing?.suppressed || []).map((item) => [item.id, item]));
  for (const entry of existing?.entries || []) {
    if (entry.supersededBy && !suppressed.has(entry.id)) {
      suppressed.set(entry.id, { id: entry.id, reason: 'superseded', supersededBy: String(entry.supersededBy), lastRunId: entry.lastRunId });
    }
  }
  const entries = [];
  const pruned = [];
  for (const entry of clusterOccurrences(occurrences).map(entryFor)) {
    const hidden = suppressed.get(entry.id);
    // A suppressed lesson returns only if it recurs in a newer Run.
    if (hidden && String(createdAt.get(entry.lastRunId) || '') <= String(createdAt.get(hidden.lastRunId) || '')) continue;
    if (hidden) suppressed.delete(entry.id);
    const reason = prune ? pruneReason(rootDir, entry, runIndex, maxAgeRuns) : null;
    if (reason) {
      pruned.push({ id: entry.id, reason });
      suppressed.set(entry.id, { id: entry.id, reason, lastRunId: entry.lastRunId });
      continue;
    }
    entries.push(entry);
  }
  entries.sort(byRelevance);
  const document = {
    schemaVersion: 1,
    generator: 'ael-learn-v1',
    sourceRuns: runs.length,
    latestRunId: runs.length ? runs[runs.length - 1].runId : null,
    entries,
    suppressed: [...suppressed.values()].sort((a, b) => a.id.localeCompare(b.id))
  };
  const result = {
    document,
    pruned,
    path: '.ai-engineering-loop/learnings.json',
    markdownPath: '.ai-engineering-loop/learnings.md',
    written: false
  };
  if (!dryRun) {
    atomicWriteJson(learningsPath(rootDir), document);
    atomicWritePrivateFile(learningsPath(rootDir, LEARNINGS_MD), renderMarkdown(document));
    result.written = true;
  }
  return result;
}

function loadLearnings(rootDir) {
  return readExisting(rootDir)?.entries || [];
}

function relevance(entry, files) {
  let score = 0;
  for (const file of files) {
    if (entry.locations.includes(file)) score += 3;
    else if (entry.locations.some((location) => path.posix.dirname(location) === path.posix.dirname(file))) score += 1;
  }
  return score;
}

// Top-K learnings for a context pack, greedily kept inside `budgetTokens`.
// Entries relevant to the pack's files rank first; project-wide recurring
// lessons (2+ runs) fill the rest.
function selectLearnings(rootDir, { files = [], budgetTokens = 0, limit = MAX_CONTEXT_LEARNINGS } = {}) {
  const budget = Math.max(0, Math.floor(budgetTokens));
  const normalized = files.map((file) => String(file).replace(/\\/g, '/'));
  const ranked = loadLearnings(rootDir)
    .map((entry) => ({ entry, score: relevance(entry, normalized) }))
    .filter(({ entry, score }) => score > 0 || entry.runIds.length > 1)
    .sort((left, right) => right.score - left.score || byRelevance(left.entry, right.entry));
  const selected = [];
  let tokens = 0;
  for (const { entry } of ranked) {
    if (selected.length >= limit) break;
    const item = {
      id: entry.id,
      axis: entry.axis,
      severity: entry.severity,
      lesson: safeText(entry.lesson),
      locations: entry.locations.slice(0, 5),
      occurrences: entry.occurrences
    };
    const cost = estimateTokens(JSON.stringify(item));
    if (tokens + cost > budget) continue;
    selected.push(item);
    tokens += cost;
  }
  return { learnings: selected, estimatedTokens: tokens };
}

module.exports = {
  LEARNINGS_JSON,
  LEARNINGS_MD,
  LEARNINGS_BUDGET_SHARE,
  DEFAULT_MAX_AGE_RUNS,
  isLesson,
  learn,
  loadLearnings,
  selectLearnings,
  renderMarkdown
};
