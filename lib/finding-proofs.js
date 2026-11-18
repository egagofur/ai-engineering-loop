'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { destructiveFindings } = require('./guard.js');
const { redactHomePaths, redactSecrets } = require('./safe-context.js');

const PROOF_TIMEOUT_MS = 120000;
const TAIL = 2000;

const tail = (text) => redactHomePaths(redactSecrets(String(text || '')).text).slice(-TAIL);

function runProof(rootDir, proof, timeoutMs) {
  const command = String(proof.command || '').trim();
  if (!command) return { status: 'refused', reason: 'proof.command is empty' };
  const destructive = destructiveFindings(command);
  if (destructive.length) return { status: 'refused', reason: destructive.map((item) => item.reason).join('; ') };
  const started = Date.now();
  const result = proof.shell === false
    ? spawnSync(command.split(/\s+/)[0], command.split(/\s+/).slice(1), { cwd: rootDir, encoding: 'utf8', timeout: timeoutMs })
    : spawnSync(command, { cwd: rootDir, encoding: 'utf8', timeout: timeoutMs, shell: true });
  const durationMs = Date.now() - started;
  if (result.error?.code === 'ETIMEDOUT' || (result.signal && durationMs >= timeoutMs - 50)) {
    return { status: 'timed_out', durationMs };
  }
  if (result.error) return { status: 'refused', reason: result.error.message, durationMs };
  return {
    status: result.status === 0 ? 'not_reproduced' : 'reproduced',
    exitCode: result.status,
    durationMs,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr)
  };
}

function runFindingProofs(rootDir, run, { timeoutMs = PROOF_TIMEOUT_MS } = {}) {
  const runDir = path.join(rootDir, '.ai-engineering-loop', 'runs', run.runId);
  const ledgerPath = path.join(runDir, 'findings.json');
  const counts = { reproduced: 0, not_reproduced: 0, refused: 0, timed_out: 0 };
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch {
    return counts;
  }
  if (!Array.isArray(ledger.findings)) return counts;
  const records = [];
  let changed = false;
  ledger.findings = ledger.findings.map((finding) => {
    const next = { ...finding };
    if ('proofStatus' in next) {
      delete next.proofStatus;
      changed = true;
    }
    const runnable = next.validity === 'VALID' && ['BLOCKER', 'HIGH'].includes(next.severity) && next.proof && typeof next.proof === 'object';
    if (!runnable) return next;
    const outcome = runProof(rootDir, next.proof, timeoutMs);
    next.proofStatus = outcome.status;
    counts[outcome.status] += 1;
    records.push({ id: next.id, command: tail(next.proof.command), ...outcome });
    changed = true;
    return next;
  });
  if (changed) fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  if (records.length) {
    fs.writeFileSync(path.join(runDir, 'proofs.json'), `${JSON.stringify({ schemaVersion: 1, runId: run.runId, diffHash: ledger.diffHash, proofs: records }, null, 2)}\n`, { mode: 0o600 });
  }
  return counts;
}

module.exports = { PROOF_TIMEOUT_MS, runFindingProofs };
