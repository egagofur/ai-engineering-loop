'use strict';

// Evaluator calibration (C-13, learn-harness-engineering L11 + L14 anchors):
// pin the Devil's Advocate and Judge to reality. Post-delivery outcomes (a
// human MR comment, a revert, a bug traced to a Run) are compared with that
// Run's Finding Ledger, so misses and wrong dismissals become visible and
// can drive prompt changes (tracked by the reviewer prompt hash, C-16).

const fs = require('fs');
const path = require('path');
const { runsDir, loadRun } = require('./run-state.js');

const OUTCOMES_FILE = 'outcomes.jsonl';
const SOURCES = Object.freeze(['mr-comment', 'revert', 'bug', 'incident']);

function calibrationError(message, code) {
  return Object.assign(new Error(message), { code });
}

const fileOf = (location) => String(location || '').replace(/:\d+(?::\d+)?$/, '');

function recordOutcome(rootDir, { runId, source, location, summary, evidence = null, by, now = new Date() } = {}) {
  if (!runId) throw calibrationError('outcome record needs --run <id> (the delivered Run the outcome traces to).', 'INVALID_USAGE');
  if (!SOURCES.includes(source)) throw calibrationError(`--source must be one of ${SOURCES.join(', ')}`, 'INVALID_USAGE');
  if (!String(location || '').trim()) throw calibrationError('--location <file[:line]> is required so the outcome can be matched to findings.', 'INVALID_USAGE');
  if (!String(summary || '').trim()) throw calibrationError('--summary <text> is required.', 'INVALID_USAGE');
  if (!String(by || '').trim()) throw calibrationError('--by <name> is required: outcomes are human-reported evidence.', 'INVALID_USAGE');
  loadRun(rootDir, runId);
  const entry = { source, location: String(location).trim(), summary: String(summary).trim(), by: String(by).trim(), at: now.toISOString(), ...(evidence ? { evidence } : {}) };
  fs.appendFileSync(path.join(runsDir(rootDir), runId, OUTCOMES_FILE), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return entry;
}

function readJsonLines(filePath) {
  let text = '';
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').filter((line) => line.trim()).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

// Classify one outcome against the Run's ledger findings.
function classifyOutcome(outcome, findings) {
  const file = fileOf(outcome.location);
  const related = (findings || []).filter((finding) => fileOf(finding.location) === file);
  if (!related.length) return { verdict: 'DA_MISS', findings: [] };
  const dismissed = related.filter((finding) => finding.validity === 'INVALID' || finding.dismissal);
  if (dismissed.length) return { verdict: 'FALSE_DISMISS', findings: dismissed.map((finding) => finding.id) };
  return { verdict: 'CAUGHT_BUT_SHIPPED', findings: related.map((finding) => finding.id) };
}

function calibrate(rootDir) {
  let runs = [];
  try {
    runs = fs.readdirSync(runsDir(rootDir), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    runs = [];
  }
  const rows = [];
  const byPrompt = {};
  for (const runId of runs) {
    const outcomes = readJsonLines(path.join(runsDir(rootDir), runId, OUTCOMES_FILE));
    if (!outcomes.length) continue;
    let ledger = null;
    try {
      ledger = JSON.parse(fs.readFileSync(path.join(runsDir(rootDir), runId, 'findings.json'), 'utf8'));
    } catch {
      ledger = null;
    }
    const prompt = ledger?.reviewer?.promptSha256 ? ledger.reviewer.promptSha256.slice(0, 12) : 'unknown';
    for (const outcome of outcomes) {
      const result = classifyOutcome(outcome, ledger?.findings);
      rows.push({ runId, ...outcome, ...result, prompt });
      const bucket = byPrompt[prompt] || (byPrompt[prompt] = { outcomes: 0, DA_MISS: 0, FALSE_DISMISS: 0, CAUGHT_BUT_SHIPPED: 0 });
      bucket.outcomes += 1;
      bucket[result.verdict] += 1;
    }
  }
  const count = (verdict) => rows.filter((row) => row.verdict === verdict).length;
  return {
    outcomes: rows.length,
    daMiss: count('DA_MISS'),
    falseDismiss: count('FALSE_DISMISS'),
    caughtButShipped: count('CAUGHT_BUT_SHIPPED'),
    byPrompt,
    rows
  };
}

function formatCalibration(report) {
  const lines = [`Outcomes: ${report.outcomes} (DA missed ${report.daMiss}, wrongly dismissed ${report.falseDismiss}, caught but shipped ${report.caughtButShipped})`];
  for (const row of report.rows.filter((r) => r.verdict !== 'CAUGHT_BUT_SHIPPED')) {
    lines.push(`- ${row.verdict} ${row.runId} ${row.location}: ${row.summary}${row.findings.length ? ` (findings ${row.findings.join(', ')})` : ''}`);
  }
  if (report.daMiss || report.falseDismiss) {
    lines.push('Next: add each miss as a concrete check to agents/shared/devil-advocate.body.md (or a learn promote rule), then compare the next prompt hash here.');
  }
  for (const [prompt, bucket] of Object.entries(report.byPrompt)) {
    lines.push(`- prompt ${prompt}: ${bucket.outcomes} outcome(s), ${bucket.DA_MISS} miss, ${bucket.FALSE_DISMISS} false dismiss`);
  }
  return lines.join('\n');
}

module.exports = { OUTCOMES_FILE, SOURCES, calibrate, classifyOutcome, formatCalibration, recordOutcome };
