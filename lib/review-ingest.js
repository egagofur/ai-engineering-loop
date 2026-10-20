'use strict';

// `review ingest`: bind the Finding Ledger to the Devil's Advocate's raw
// output, so the Maker cannot silently drop or downgrade a finding.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadRun, getCurrentRun, runsDir } = require('./run-state.js');

const RAW_FILE = 'review-raw.txt';
const MAX_RAW_BYTES = 2 * 1024 * 1024;
const SEVERITY_RANK = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, BLOCKER: 3 });

function ingestError(message, code, details = []) {
  return Object.assign(new Error(message), { code, details });
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// The last JSON object with a `findings` array: fenced ```json blocks first,
// then the whole text, then every balanced {...} candidate.
function extractLedger(text) {
  const candidates = [];
  for (const match of String(text).matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) candidates.push(match[1]);
  candidates.push(text);
  const source = String(text);
  for (let start = source.indexOf('{'); start !== -1; start = source.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (char === '\\') index += 1;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) {
        candidates.push(source.slice(start, index + 1));
        break;
      }
    }
  }
  let found = null;
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && Array.isArray(value.findings)) found = value;
    } catch {
      // not JSON
    }
  }
  return found;
}

function ingestReview(rootDir, { runId, childId, file } = {}) {
  if (!String(childId || '').trim()) throw ingestError('--child-id is required (the reviewer subagent\'s own id)', 'INVALID_USAGE');
  if (!file) throw ingestError('--file <child-output> is required', 'INVALID_USAGE');
  const run = runId ? loadRun(rootDir, runId) : getCurrentRun(rootDir);
  if (!run) throw ingestError('No current Run. Pass --run <id>.', 'NO_CURRENT_RUN');
  if (run.state !== 'VERIFIED') throw ingestError(`review ingest needs a VERIFIED Run (state is ${run.state})`, 'INVALID_STATE');
  const source = path.resolve(rootDir, file);
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw ingestError('--file must be a regular file', 'INVALID_FILE');
  if (stat.size > MAX_RAW_BYTES) throw ingestError(`--file is larger than ${MAX_RAW_BYTES} bytes`, 'INVALID_FILE');
  const raw = fs.readFileSync(source);
  const ledger = extractLedger(raw.toString('utf8'));
  if (!ledger) throw ingestError('No JSON ledger with a findings array in the reviewer output', 'NO_LEDGER_IN_OUTPUT');
  const runDir = path.join(runsDir(rootDir), run.runId);
  fs.writeFileSync(path.join(runDir, RAW_FILE), raw, { mode: 0o600 });
  const document = {
    ...ledger,
    schemaVersion: 1,
    runId: run.runId,
    diffHash: run.artifacts?.diff?.sha256,
    reviewer: { name: 'devil-advocate', childId: String(childId).trim(), rawSha256: sha256(raw) },
    findings: ledger.findings
  };
  fs.writeFileSync(path.join(runDir, 'findings.json'), `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  return { runId: run.runId, findings: ledger.findings.length, rawSha256: document.reviewer.rawSha256 };
}

// Checks a ledger against the raw reviewer output it claims to come from.
// Returns { binding: 'BOUND'|'UNBOUND'|'NOT_REQUIRED', errors }.
function checkLedgerBinding(rootDir, run, ledger) {
  if ((run.tier?.current || null) === 'T0') return { binding: 'NOT_REQUIRED', errors: [] };
  const rawSha256 = ledger?.reviewer?.rawSha256;
  if (!rawSha256) return { binding: 'UNBOUND', errors: [] };
  const errors = [];
  let raw;
  try {
    raw = fs.readFileSync(path.join(runsDir(rootDir), run.runId, RAW_FILE));
  } catch {
    return { binding: 'BOUND', errors: [`${RAW_FILE} is missing; re-run review ingest`] };
  }
  if (sha256(raw) !== rawSha256) return { binding: 'BOUND', errors: [`${RAW_FILE} does not match reviewer.rawSha256`] };
  const original = extractLedger(raw.toString('utf8'))?.findings || [];
  const current = new Map((ledger.findings || []).map((finding) => [finding.id, finding]));
  for (const finding of original) {
    const now = current.get(finding.id);
    if (!now) {
      errors.push(`finding ${finding.id} from the reviewer was removed`);
      continue;
    }
    const downgraded = (finding.validity === 'VALID' && now.validity !== 'VALID')
      || (SEVERITY_RANK[now.severity] ?? 0) < (SEVERITY_RANK[finding.severity] ?? 0);
    if (downgraded && !String(now.dismissal?.evidence || '').trim()) {
      errors.push(`finding ${finding.id} was downgraded without dismissal.evidence`);
    }
  }
  return { binding: 'BOUND', errors };
}

module.exports = { RAW_FILE, extractLedger, ingestReview, checkLedgerBinding };
