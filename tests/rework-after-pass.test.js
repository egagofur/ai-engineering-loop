'use strict';

// The delivered diff is the judged diff.
// A Run at JUDGED_PASS whose working tree changes afterwards (for example test
// fixes for Devil's Advocate findings) must not get stuck. `gate maker
// --from-git` refuses to overwrite the judged diff and names `run --reopen`,
// which starts a new iteration so the new diff is verified, reviewed and
// judged before delivery. The judged diff hash stays the delivered diff hash.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function setupRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-rework-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-rework-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_GOAL_FREEZE_OK: '1' };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  const commit = (message) => {
    git('add', '-A');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', message, '--allow-empty');
  };
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/list.js'), 'module.exports = (items) => items.slice(0, 10);\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo","scripts":{"test":"node --version"}}\n');
  commit('init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  commit('ctx');
  return { repo, cli, commit };
}

function ok(result, label) {
  assert.strictEqual(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  return result;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readState = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));

// maker (from git) -> verify -> empty ledger -> review -> judge.
function makeAndJudge({ repo, cli }, runId, runDir) {
  ok(cli('gate', 'maker', '--from-git', '--run', runId), 'gate maker --from-git');
  ok(cli('verify', '--run', runId, '--cmd', 'node --version', '--json'), 'verify');
  fs.writeFileSync(
    path.join(repo, '.ai-engineering-loop/tasks/claimed-vs-reality.md'),
    '| AC | Claimed | Reality from command log |\n|---|---|---|\n| AC-1 | paginated | node --version exit 0 |\n'
  );
  const diffHash = readState(runDir).artifacts.diff.sha256;
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify({ schemaVersion: 1, runId, diffHash, findings: [] }));
  ok(cli('gate', 'review', '--run', runId, '--json'), 'gate review');
  ok(cli('gate', 'judge', '--run', runId), 'gate judge');
  return diffHash;
}

function freezeGoal({ repo, cli }, runId) {
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop', 'goal-draft.json'), JSON.stringify({
    schemaVersion: 1,
    runId,
    objective: 'Paginate the list',
    restatement: { problem: 'The list shows only the first page.', doneWhen: 'A caller can request page 2.', failIf: 'Page 2 is empty while rows remain.', unknowns: 'None.' },
    acceptanceCriteria: [{ id: 'AC-1', statement: 'returns page 2', evidenceRequired: 'node --version exit 0', failureCases: ['page beyond end returns empty'] }]
  }));
  ok(cli('goal', 'draft', '--json', '--run', runId, '--file', '.ai-engineering-loop/goal-draft.json', '--revision', '0'), 'goal draft');
  ok(cli('goal', 'freeze', '--json', '--latest', '--run', runId, '--by', 'human'), 'goal freeze');
}

function runToPass(ctx) {
  const { repo, cli } = ctx;
  const run = JSON.parse(ok(cli('run', '--json', 'Add pagination to the list'), 'run').stdout);
  const runDir = path.join(repo, '.ai-engineering-loop/runs', run.runId);
  freezeGoal(ctx, run.runId);
  fs.writeFileSync(path.join(repo, 'src/list.js'), 'module.exports = (items, page = 1) => items.slice((page - 1) * 10, page * 10);\n');
  const judgedHash = makeAndJudge(ctx, run.runId, runDir);
  assert.strictEqual(readState(runDir).state, 'JUDGED_PASS');
  return { runId: run.runId, runDir, judgedHash };
}

test('gate maker --from-git after JUDGED_PASS keeps the judged diff and names run --reopen', () => {
  const ctx = setupRepo();
  const { runId, runDir, judgedHash } = runToPass(ctx);
  // DA-01 test fix lands after the Judge passed.
  fs.writeFileSync(path.join(ctx.repo, 'src/list.js'), 'module.exports = (items, page = 1) => items.slice(Math.max(page - 1, 0) * 10, page * 10);\n');

  const refused = ctx.cli('gate', 'maker', '--from-git', '--run', runId, '--json');
  assert.notStrictEqual(refused.status, 0, 'gate maker must refuse once the diff is judged');
  assert.strictEqual(sha256(path.join(runDir, 'diff.patch')), judgedHash, 'the judged diff.patch is not overwritten');
  const body = JSON.parse(refused.stdout);
  assert.match(body.fix, new RegExp(`run --reopen --run ${runId} --reason`), 'fix names the reopen command');
  assert.ok(body.why, 'error carries why');
  assert.strictEqual(readState(runDir).state, 'JUDGED_PASS');
});

test('run --reopen starts a new iteration and the reworked diff reaches DELIVERED', () => {
  const ctx = setupRepo();
  const { runId, runDir, judgedHash } = runToPass(ctx);
  fs.writeFileSync(path.join(ctx.repo, 'src/list.js'), 'module.exports = (items, page = 1) => items.slice(Math.max(page - 1, 0) * 10, page * 10);\n');

  const noReason = ctx.cli('run', '--reopen', '--run', runId, '--json');
  assert.notStrictEqual(noReason.status, 0, 'reopen needs a reason');
  assert.strictEqual(readState(runDir).state, 'JUDGED_PASS');

  const reopened = JSON.parse(ok(ctx.cli('run', '--reopen', '--run', runId, '--reason', 'DA-01..DA-03 test fixes', '--json'), 'reopen').stdout);
  assert.strictEqual(reopened.state, 'GOAL_FROZEN');
  assert.strictEqual(reopened.iteration, 2);
  assert.match(reopened.next, new RegExp(`gate maker --from-git --run ${runId}`));
  const state = readState(runDir);
  for (const name of ['diff', 'verification', 'findings', 'verdict']) {
    assert.strictEqual(state.artifacts[name], undefined, `${name} must be re-earned`);
  }
  assert.strictEqual(state.history.at(-1).gate, 'run-reopen');
  const archived = path.join(runDir, 'iterations', '1');
  for (const name of ['verification.json', 'findings.json', 'verdict.json', 'diff.patch']) {
    assert.ok(fs.existsSync(path.join(archived, name)), `iteration 1 keeps ${name}`);
  }
  assert.strictEqual(sha256(path.join(archived, 'diff.patch')), judgedHash);

  const reworkedHash = makeAndJudge(ctx, runId, runDir);
  assert.notStrictEqual(reworkedHash, judgedHash);
  ctx.commit('work');
  ok(ctx.cli('deliver', '--run', runId, '--destination', 'pr', '--summary', 'paginate', '--approve', '--by', 'human', '--json'), 'deliver');
  const delivered = readState(runDir);
  assert.strictEqual(delivered.state, 'DELIVERED');
  assert.strictEqual(delivered.artifacts.diff.sha256, reworkedHash, 'the delivered diff is the re-judged diff');
});

test('run --reopen refuses runs that are not between Maker and delivery', () => {
  const ctx = setupRepo();
  const run = JSON.parse(ok(ctx.cli('run', '--json', 'Add pagination to the list'), 'run').stdout);
  const refused = ctx.cli('run', '--reopen', '--run', run.runId, '--reason', 'nothing judged yet', '--json');
  assert.notStrictEqual(refused.status, 0);
  const body = JSON.parse(refused.stdout);
  assert.ok(body.why && body.fix, 'refusal carries why and fix');
});

// Gap 1a: verify must not record evidence for code that is not the gated diff.
test('verify refuses when the code changed after gate maker (DIFF_DRIFT) and names run --reopen', () => {
  const ctx = setupRepo();
  const run = JSON.parse(ok(ctx.cli('run', '--json', 'Add pagination to the list'), 'run').stdout);
  const runDir = path.join(ctx.repo, '.ai-engineering-loop/runs', run.runId);
  freezeGoal(ctx, run.runId);
  fs.writeFileSync(path.join(ctx.repo, 'src/list.js'), 'module.exports = (items, page = 1) => items.slice(page * 10);\n');
  ok(ctx.cli('gate', 'maker', '--from-git', '--run', run.runId), 'gate maker');
  const gated = sha256(path.join(runDir, 'diff.patch'));
  // The agent fixes the bug without re-gating.
  fs.writeFileSync(path.join(ctx.repo, 'src/list.js'), 'module.exports = (items, page = 1) => items.slice((page - 1) * 10, page * 10);\n');
  const refused = ctx.cli('verify', '--run', run.runId, '--cmd', 'node --version', '--json');
  assert.notStrictEqual(refused.status, 0, 'verify must refuse drifted code');
  const body = JSON.parse(refused.stdout);
  assert.match(body.error, /DIFF_DRIFT/);
  assert.ok(body.why);
  assert.match(body.fix, new RegExp(`run --reopen --run ${run.runId}`));
  assert.ok(body.details.some((line) => line.startsWith('src/list.js')), 'names the drifted file');
  assert.strictEqual(readState(runDir).state, 'MAKER_COMPLETE');
  assert.strictEqual(sha256(path.join(runDir, 'diff.patch')), gated);
});

// Gap 1b: deliver must compare what is committed with the judged diff.
test('deliver refuses committed code the Judge never saw', () => {
  const ctx = setupRepo();
  const { runId, runDir } = runToPass(ctx);
  fs.appendFileSync(path.join(ctx.repo, 'src/list.js'), 'module.exports.boom = () => { throw new Error("unjudged"); };\n');
  ctx.commit('add pagination');
  const refused = ctx.cli('deliver', '--run', runId, '--destination', 'pr', '--summary', 'x', '--approve', '--by', 'human', '--json');
  assert.notStrictEqual(refused.status, 0, 'deliver must refuse unjudged committed code');
  const body = JSON.parse(refused.stdout);
  assert.match(body.error, /DIFF_DRIFT/);
  assert.match(body.fix, new RegExp(`run --reopen --run ${runId}`));
  assert.strictEqual(readState(runDir).state, 'JUDGED_PASS');
});

// Gap 4: a change committed before the Maker gate is still the Run's change.
test('gate maker --from-git diffs against the Run start, so an early commit is captured', () => {
  const ctx = setupRepo();
  const run = JSON.parse(ok(ctx.cli('run', '--json', 'Add pagination to the list'), 'run').stdout);
  const runDir = path.join(ctx.repo, '.ai-engineering-loop/runs', run.runId);
  freezeGoal(ctx, run.runId);
  const empty = ctx.cli('gate', 'maker', '--from-git', '--run', run.runId, '--json');
  assert.notStrictEqual(empty.status, 0);
  const emptyBody = JSON.parse(empty.stdout);
  assert.ok(emptyBody.why && emptyBody.fix, 'no-change error carries why and fix');
  fs.writeFileSync(path.join(ctx.repo, 'src/list.js'), 'module.exports = (items, page = 1) => items.slice((page - 1) * 10, page * 10);\n');
  fs.writeFileSync(path.join(ctx.repo, 'src/page.js'), 'module.exports = 10;\n');
  ctx.commit('wip');
  ok(ctx.cli('gate', 'maker', '--from-git', '--run', run.runId), 'gate maker after an early commit');
  const diff = fs.readFileSync(path.join(runDir, 'diff.patch'), 'utf8');
  assert.match(diff, /page - 1/);
  assert.match(diff, /src\/page\.js/);
  ok(ctx.cli('verify', '--run', run.runId, '--cmd', 'node --version', '--json'), 'verify on the committed change');
  assert.strictEqual(readState(runDir).state, 'VERIFIED');
});

// The Judge ITERATE path keeps working: fix, re-gate maker, verify.
test('after a Judge ITERATE the fixed code is re-gated and verified', () => {
  const ctx = setupRepo();
  const run = JSON.parse(ok(ctx.cli('run', '--json', 'Add pagination to the list'), 'run').stdout);
  const runDir = path.join(ctx.repo, '.ai-engineering-loop/runs', run.runId);
  freezeGoal(ctx, run.runId);
  fs.writeFileSync(path.join(ctx.repo, 'src/list.js'), 'module.exports = (items, page) => items.slice((page - 1) * 10, page * 10);\n');
  ok(ctx.cli('gate', 'maker', '--from-git', '--run', run.runId), 'gate maker');
  ok(ctx.cli('verify', '--run', run.runId, '--cmd', 'node --version', '--json'), 'verify');
  fs.writeFileSync(
    path.join(ctx.repo, '.ai-engineering-loop/tasks/claimed-vs-reality.md'),
    '| AC | Claimed | Reality from command log |\n|---|---|---|\n| AC-1 | paginated | node --version exit 0 |\n'
  );
  const diffHash = readState(runDir).artifacts.diff.sha256;
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify({ schemaVersion: 1, runId: run.runId, diffHash, findings: [{
    id: 'DA-01', location: 'src/list.js:1', failureScenario: 'page undefined returns empty list', evidence: 'slice(NaN) is empty',
    severity: 'HIGH', validity: 'VALID', disposition: 'STRONG', concreteAlternativeDiff: '- (items, page)\n+ (items, page = 1)'
  }] }));
  ok(ctx.cli('gate', 'review', '--run', run.runId, '--json'), 'gate review');
  fs.writeFileSync(path.join(runDir, 'verdict.json'), JSON.stringify({ schemaVersion: 1, runId: run.runId, verdict: 'ITERATE', reason: 'DA-01 valid HIGH', action: 'default page', modelTier: 'STRONG_MODEL' }));
  ok(ctx.cli('gate', 'judge', '--run', run.runId), 'gate judge ITERATE');
  assert.strictEqual(readState(runDir).state, 'GOAL_FROZEN');
  fs.writeFileSync(path.join(ctx.repo, 'src/list.js'), 'module.exports = (items, page = 1) => items.slice((page - 1) * 10, page * 10);\n');
  ok(ctx.cli('gate', 'maker', '--from-git', '--run', run.runId), 'gate maker iteration 2');
  ok(ctx.cli('verify', '--run', run.runId, '--cmd', 'node --version', '--json'), 'verify iteration 2');
  const state = readState(runDir);
  assert.strictEqual(state.state, 'VERIFIED');
  assert.strictEqual(state.iteration, 2);
});
