'use strict';

// review ingest binds the Finding Ledger to the Devil's Advocate's raw output.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const { extractLedger } = require('../lib/review-ingest.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function setupRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-ingest-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-ingest-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/list.js'), 'module.exports = (items) => items.slice(0, 10);\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo","scripts":{"test":"node --version"}}\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx', '--allow-empty');
  return { repo, cli };
}

function ok(result, label) {
  assert.strictEqual(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  return result;
}

const lowFinding = {
  id: 'F-1',
  location: 'src/list.js:1',
  failureScenario: 'page 0 returns an odd slice',
  evidence: 'slice(-10, 0)',
  severity: 'LOW',
  validity: 'VALID',
  disposition: 'ACCEPTABLE'
};
const highFinding = {
  id: 'F-2',
  location: 'src/list.js:1',
  failureScenario: 'negative page leaks the tail of the list',
  evidence: 'slice(-20, -10)',
  severity: 'HIGH',
  validity: 'VALID',
  disposition: 'STRONG',
  concreteAlternativeDiff: '+ page = Math.max(1, page)'
};

// Goal (frozen with --confirm-impact), Maker, verify: ready for review.
function toVerified({ repo, cli }) {
  const run = JSON.parse(ok(cli('run', '--json', 'Add pagination to the list'), 'run').stdout);
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop/goal-draft.json'), JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    objective: 'Paginate the list',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'returns page 2', evidenceRequired: 'tests exit 0', failureCases: ['page beyond end returns empty'] }]
  }));
  const draft = JSON.parse(ok(cli('goal', 'draft', '--run', run.runId, '--file', '.ai-engineering-loop/goal-draft.json', '--revision', '0'), 'goal draft').stdout);
  assert.ok(draft.result.impactPreview, 'the draft carries an impact preview for the human');
  const freeze = JSON.parse(ok(cli('goal', 'freeze', '--latest', '--run', run.runId, '--by', 'human', '--confirm-impact'), 'goal freeze').stdout);
  assert.strictEqual(freeze.result.impact.status, 'CONFIRMED');
  fs.writeFileSync(path.join(repo, 'src/list.js'), 'module.exports = (items, page = 1) => items.slice((page - 1) * 10, page * 10);\n');
  ok(cli('gate', 'maker', '--from-git', '--run', run.runId), 'gate maker');
  ok(cli('verify', '--run', run.runId, '--cmd', 'node --version'), 'verify');
  fs.writeFileSync(
    path.join(repo, '.ai-engineering-loop/tasks/claimed-vs-reality.md'),
    '| AC | Claimed | Reality from command log |\n|---|---|---|\n| AC-1 | paginated | node --version exit 0 |\n'
  );
  return { runId: run.runId, runDir: path.join(repo, '.ai-engineering-loop/runs', run.runId) };
}

function childOutput(repo, findings) {
  const file = path.join(repo, '.ai-engineering-loop', 'da-output.md');
  fs.writeFileSync(file, `## Review\nLooks mostly fine.\n\n\`\`\`json\n${JSON.stringify({ findings }, null, 2)}\n\`\`\`\n`);
  return '.ai-engineering-loop/da-output.md';
}

test('extractLedger takes the last JSON object with a findings array', () => {
  assert.deepStrictEqual(extractLedger('noise {"a":1} more {"findings":[{"id":"X"}]} tail').findings, [{ id: 'X' }]);
  assert.strictEqual(extractLedger('no json here'), null);
});

test('review ingest binds the ledger and chains to a deterministic Judge PASS', () => {
  const ctx = setupRepo();
  const { runId, runDir } = toVerified(ctx);
  const result = JSON.parse(ok(ctx.cli('review', 'ingest', '--run', runId, '--child-id', 'da-123', '--file', childOutput(ctx.repo, [lowFinding]), '--json'), 'review ingest').stdout);
  assert.strictEqual(result.ledgerBinding, 'BOUND');
  assert.strictEqual(result.judgeRequired, false);
  assert.strictEqual(result.state, 'JUDGED_PASS');
  const ledger = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8'));
  assert.strictEqual(ledger.reviewer.childId, 'da-123');
  assert.match(ledger.reviewer.rawSha256, /^[a-f0-9]{64}$/);
});

test('dropping or silently downgrading a reviewer finding breaks the ledger binding', () => {
  const ctx = setupRepo();
  const { runId, runDir } = toVerified(ctx);
  // Ingest only; the HIGH finding makes the Judge required, so the run stays REVIEWED.
  const ingested = JSON.parse(ok(ctx.cli('review', 'ingest', '--run', runId, '--child-id', 'da-1', '--file', childOutput(ctx.repo, [lowFinding, highFinding]), '--json'), 'ingest').stdout);
  assert.strictEqual(ingested.judgeRequired, true);
  const ledgerPath = path.join(runDir, 'findings.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const { checkLedgerBinding } = require('../lib/review-ingest.js');
  const run = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));

  const dropped = { ...ledger, findings: ledger.findings.filter((f) => f.id !== 'F-2') };
  assert.match(checkLedgerBinding(ctx.repo, run, dropped).errors.join(), /F-2 from the reviewer was removed/);

  const flipped = { ...ledger, findings: ledger.findings.map((f) => (f.id === 'F-2' ? { ...f, validity: 'INVALID' } : f)) };
  assert.match(checkLedgerBinding(ctx.repo, run, flipped).errors.join(), /F-2 was downgraded without dismissal\.evidence/);

  const justified = { ...ledger, findings: ledger.findings.map((f) => (f.id === 'F-2' ? { ...f, validity: 'INVALID', dismissal: { by: 'maker', evidence: 'tests/list.test.js:12 covers negative pages' } } : f)) };
  assert.deepStrictEqual(checkLedgerBinding(ctx.repo, run, justified).errors, []);

  fs.writeFileSync(path.join(runDir, 'review-raw.txt'), 'edited');
  assert.match(checkLedgerBinding(ctx.repo, run, ledger).errors.join(), /does not match reviewer\.rawSha256/);
});

test('a hand-written ledger is reported UNBOUND but still accepted in ASSISTED', () => {
  const ctx = setupRepo();
  const { runId, runDir } = toVerified(ctx);
  const diffHash = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')).artifacts.diff.sha256;
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify({ schemaVersion: 1, runId, diffHash, findings: [] }));
  const review = JSON.parse(ok(ctx.cli('gate', 'review', '--run', runId, '--json'), 'gate review').stdout);
  assert.strictEqual(review.ledgerBinding, 'UNBOUND');
});
