'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runFindingProofs } = require('../lib/finding-proofs.js');
const { isBlockingFinding } = require('../lib/orchestration.js');

const node = JSON.stringify(process.execPath);
const finding = (id, proof, extra = {}) => ({
  id, location: 'a.js:1', failureScenario: 'x', evidence: 'y', severity: 'HIGH', validity: 'VALID', disposition: 'STRONG', concreteAlternativeDiff: '- a\n+ b',
  ...(proof ? { proof } : {}), ...extra
});

function setup(findings) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-proofs-'));
  const runDir = path.join(root, '.ai-engineering-loop', 'runs', 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify({ schemaVersion: 1, runId: 'run-1', diffHash: 'h', findings }));
  return { root, runDir, run: { runId: 'run-1' } };
}

test('C-29 a proof that fails reproduces the finding and keeps it blocking', () => {
  const { root, runDir, run } = setup([finding('F-1', { command: `${node} -e "process.exit(3)"`, shell: true })]);
  const result = runFindingProofs(root, run);
  const [f] = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8')).findings;
  assert.strictEqual(f.proofStatus, 'reproduced');
  assert.strictEqual(isBlockingFinding(f), true);
  assert.deepStrictEqual(result, { reproduced: 1, not_reproduced: 0, refused: 0, timed_out: 0 });
  const proofs = JSON.parse(fs.readFileSync(path.join(runDir, 'proofs.json'), 'utf8'));
  assert.strictEqual(proofs.proofs[0].exitCode, 3);
});

test('C-29 a proof that passes does not reproduce the finding, which stops blocking', () => {
  const { root, runDir, run } = setup([finding('F-1', { command: `${node} -e "process.exit(0)"`, shell: true })]);
  runFindingProofs(root, run);
  const [f] = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8')).findings;
  assert.strictEqual(f.proofStatus, 'not_reproduced');
  assert.strictEqual(isBlockingFinding(f), false);
});

test('C-29 destructive proofs are refused and stay blocking; findings without proof are untouched; forged status is cleared', () => {
  const { root, runDir, run } = setup([
    finding('F-1', { command: 'rm -rf /tmp/whatever', shell: true }),
    finding('F-2', null, { proofStatus: 'not_reproduced' }),
    finding('F-3', { command: `${node} -e "process.exit(1)"`, shell: true }, { severity: 'LOW' })
  ]);
  runFindingProofs(root, run);
  const [f1, f2, f3] = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8')).findings;
  assert.strictEqual(f1.proofStatus, 'refused');
  assert.strictEqual(isBlockingFinding(f1), true);
  assert.strictEqual(f2.proofStatus, undefined, 'status only comes from a CLI run');
  assert.strictEqual(isBlockingFinding(f2), true);
  assert.strictEqual(f3.proofStatus, undefined, 'only BLOCKER/HIGH proofs run');
});

test('C-29 a proof that runs too long is timed out and stays blocking', () => {
  const { root, runDir, run } = setup([finding('F-1', { command: `${node} -e "setTimeout(()=>{},5000)"`, shell: true })]);
  runFindingProofs(root, run, { timeoutMs: 300 });
  const [f] = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8')).findings;
  assert.strictEqual(f.proofStatus, 'timed_out');
  assert.strictEqual(isBlockingFinding(f), true);
});
