'use strict';

// C-11: weakened verification in the gated diff becomes VALID ledger findings.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { scanDiff, mergeIntegrityIntoLedger, isTestFile } = require('../lib/verification-integrity.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

const diff = (file, body, extra = '') => `diff --git a/${file} b/${file}\n${extra}--- a/${file}\n+++ b/${file}\n${body}\n`;

test('test file detection covers js, py, go and java conventions', () => {
  for (const file of ['tests/a.js', 'src/a.test.ts', 'src/__tests__/x.js', 'pkg/a_test.go', 'tests/test_api.py', 'src/FooTest.java']) {
    assert.ok(isTestFile(file), file);
  }
  assert.ok(!isTestFile('src/list.js'));
});

test('AC-1 an added it.skip in an existing test is a HIGH finding at file:line with a concrete diff', () => {
  const findings = scanDiff(diff('tests/list.test.js', '@@ -3,2 +3,2 @@\n context\n-it("pages", () => {\n+it.skip("pages", () => {'), { tier: 'T1' });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].severity, 'HIGH');
  assert.strictEqual(findings[0].location, 'tests/list.test.js:4');
  assert.match(findings[0].concreteAlternativeDiff, /\+ it\("pages"/);
  assert.strictEqual(scanDiff(diff('tests/list.test.js', '@@ -1 +1 @@\n+xit("a")'), { tier: 'T2' })[0].severity, 'BLOCKER');
  assert.strictEqual(scanDiff(diff('src/list.js', '@@ -1 +1 @@\n+it.skip("not a test file")'), {}).length, 0);
});

test('AC-2 editing verification.md is flagged unless the Goal Contract names it', () => {
  const change = diff('.ai-engineering-loop/verification.md', '@@ -1 +1 @@\n-- **test_unit**: `npm test`\n+- **test_unit**: `true`');
  assert.strictEqual(scanDiff(change, {}).length, 1);
  assert.strictEqual(scanDiff(change, { goalText: 'scope: .ai-engineering-loop/verification.md' }).length, 0);
  assert.strictEqual(scanDiff(diff('vitest.config.ts', '@@ -1 +1 @@\n+coverage: 0'), {}).length, 1);
});

test('AC-3 deleting a test without a replacement is flagged; a replacement in the same dir is not', () => {
  const deleted = diff('tests/old.test.js', '@@ -1 +0,0 @@\n-it("x", () => expect(1).toBe(1))', 'deleted file mode 100644\n');
  assert.strictEqual(scanDiff(deleted, {}).length, 1);
  const replaced = deleted + diff('tests/new.test.js', '@@ -0,0 +1 @@\n+it("x", () => expect(1).toBe(1))', 'new file mode 100644\n');
  assert.strictEqual(scanDiff(replaced, {}).length, 0);
});

test('dropping assertions without replacement is flagged; swapping one for one is not', () => {
  const dropped = diff('tests/a.test.js', '@@ -1,3 +1,1 @@\n-  expect(a).toBe(1);\n-  expect(b).toBe(2);\n+  expect(a).toBe(1);');
  assert.match(scanDiff(dropped, {})[0].failureScenario, /1 assertion\(s\) removed/);
  const swapped = diff('tests/a.test.js', '@@ -1 +1 @@\n-  expect(a).toBe(1);\n+  expect(a).toBe(2);');
  assert.strictEqual(scanDiff(swapped, {}).length, 0);
});

test('a merged integrity finding can only be downgraded with a human dismissal', () => {
  const [item] = scanDiff(diff('tests/list.test.js', '@@ -1 +1 @@\n+it.only("a")'), {});
  const first = mergeIntegrityIntoLedger({ findings: [] }, [item]);
  assert.strictEqual(first.added, 1);
  const tampered = { findings: [{ ...item, validity: 'INVALID' }] };
  assert.match(mergeIntegrityIntoLedger(tampered, [item]).errors[0], /without a human dismissal/);
  const dismissed = { findings: [{ ...item, validity: 'INVALID', dismissal: { by: 'ega', evidence: 'flaky upstream, tracked in #9' } }] };
  assert.deepStrictEqual(mergeIntegrityIntoLedger(dismissed, [item]).errors, []);
});

test('review gate adds the finding to the ledger and the Judge must then decide', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-integ-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-integ-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'tests'));
  fs.writeFileSync(path.join(repo, 'tests/list.test.js'), 'it("pages", () => {});\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx');
  const run = JSON.parse(cli('run', '--json', 'Add pagination to the list endpoint').stdout);
  const runDir = path.join(repo, '.ai-engineering-loop/runs', run.runId);
  fs.writeFileSync(path.join(runDir, 'goal-contract.json'), JSON.stringify({
    schemaVersion: 1, runId: run.runId, objective: 'Paginate',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'page 2', evidenceRequired: 'tests', failureCases: ['empty'] }]
  }));
  assert.strictEqual(cli('gate', 'goal', '--run', run.runId).status, 0);
  fs.writeFileSync(path.join(repo, 'tests/list.test.js'), 'it.skip("pages", () => {});\n');
  assert.strictEqual(cli('gate', 'maker', '--from-git', '--run', run.runId).status, 0);
  const verified = cli('verify', '--run', run.runId, '--cmd', 'node --version');
  assert.strictEqual(verified.status, 0, verified.stdout + verified.stderr);
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop/tasks/claimed-vs-reality.md'),
    '| AC | Claimed | Reality from command log | Layer |\n|---|---|---|---|\n| AC-1 | paged | node --version exit 0 | L2 |\n');
  const diffHash = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')).artifacts.diff.sha256;
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify({ schemaVersion: 1, runId: run.runId, diffHash, findings: [] }));
  const review = cli('gate', 'review', '--run', run.runId);
  assert.strictEqual(review.status, 0, review.stdout + review.stderr);
  const ledger = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8'));
  assert.ok(ledger.findings.some((f) => f.source === 'verification-integrity' && f.location === 'tests/list.test.js:1'));
  const judge = cli('gate', 'judge', '--run', run.runId);
  assert.notStrictEqual(judge.status, 0);
  assert.match(judge.stdout + judge.stderr, /Judge subagent required/);
});
