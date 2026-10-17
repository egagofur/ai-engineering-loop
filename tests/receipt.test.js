'use strict';

// Issue #70: proof-carrying PR receipt (receipt.json + verify-receipt).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { verifyReceipt, receiptDigest, parseEvidenceLinks, renderReceiptMarkdown } = require('../lib/receipt.js');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'receipt.schema.json'), 'utf8'));

function ok(result, label) {
  assert.strictEqual(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  return result;
}

// Drives a T1 run to DELIVERED. `rows` = claimed-vs-reality rows to write.
function deliveredRun({ rows = ['AC-1', 'AC-2'], deliverArgs = [] } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-receipt-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-receipt-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/list.js'), 'module.exports = (items) => items.slice(0, 10);\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  ok(cli('init'), 'init');
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx', '--allow-empty');
  const run = JSON.parse(ok(cli('run', '--json', 'Add pagination to the list'), 'run').stdout);
  const runDir = path.join(repo, '.ai-engineering-loop/runs', run.runId);
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop', 'goal-draft.json'), JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    objective: 'Paginate the list',
    acceptanceCriteria: [
      { id: 'AC-1', statement: 'returns page 2', evidenceRequired: 'node --version exit 0', failureCases: ['page beyond end returns empty'] },
      { id: 'AC-2', statement: 'page 0 is rejected', evidenceRequired: 'node --version exit 0', failureCases: ['page 0 returns items'] }
    ]
  }));
  ok(cli('goal', 'draft', '--run', run.runId, '--file', '.ai-engineering-loop/goal-draft.json', '--revision', '0'), 'draft');
  ok(cli('goal', 'freeze', '--latest', '--run', run.runId, '--by', 'human'), 'freeze');
  fs.writeFileSync(path.join(repo, 'src/list.js'), 'module.exports = (items, page = 1) => items.slice((page - 1) * 10, page * 10);\n');
  ok(cli('gate', 'maker', '--from-git', '--run', run.runId), 'maker');
  ok(cli('verify', '--run', run.runId, '--cmd', 'node --version'), 'verify');
  fs.writeFileSync(
    path.join(repo, '.ai-engineering-loop/tasks/claimed-vs-reality.md'),
    `| AC | Claimed | Reality from command log |\n|---|---|---|\n${rows.map((id) => `| ${id} | done | node --version exit 0 |`).join('\n')}\n`
  );
  ok(cli('review-pack', '--run', run.runId), 'review-pack');
  const diffHash = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')).artifacts.diff.sha256;
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify({ schemaVersion: 1, runId: run.runId, diffHash, findings: [] }));
  ok(cli('gate', 'review', '--run', run.runId), 'review');
  ok(cli('gate', 'judge', '--run', run.runId), 'judge');
  git('add', 'src');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'paginate');
  const head = git('rev-parse', 'HEAD').trim();
  const deliver = JSON.parse(ok(cli('deliver', '--run', run.runId, '--destination', 'pr', '--summary', 'paginate', '--approve', '--by', 'human', '--host', 'claude', '--json', ...deliverArgs), 'deliver').stdout);
  const receipt = JSON.parse(fs.readFileSync(path.join(runDir, 'receipt.json'), 'utf8'));
  return { repo, home, cli, git, runId: run.runId, runDir, head, deliver, receipt };
}

function codes(result) {
  return result.problems.map((problem) => problem.code);
}

test('deliver writes a complete receipt, stores its digest, and verify-receipt passes', () => {
  const ctx = deliveredRun({ deliverArgs: ['--evidence', 'AC-1=https://ci.example.com/runs/1/screenshot.png'] });
  const { receipt } = ctx;
  for (const key of SCHEMA.required) assert.ok(Object.hasOwn(receipt, key), `receipt.${key}`);
  assert.match(receipt.digest, /^[a-f0-9]{64}$/);
  assert.strictEqual(receipt.digest, receiptDigest(receipt));
  assert.strictEqual(receipt.head.sha, ctx.head);
  assert.strictEqual(receipt.host.id, 'claude');
  assert.deepStrictEqual(receipt.acceptanceCriteria.map((item) => [item.id, item.status]), [['AC-1', 'PASS'], ['AC-2', 'PASS']]);
  assert.ok(receipt.acceptanceCriteria[0].evidence.some((item) => item.type === 'link' && item.url === 'https://ci.example.com/runs/1/screenshot.png'));
  assert.ok(receipt.acceptanceCriteria[0].evidence.some((item) => item.type === 'command' && item.exitCode === 0 && /^[a-f0-9]{64}$/.test(item.outputSha256)));
  assert.strictEqual(receipt.review.verdict.verdict, 'PASS');
  assert.deepStrictEqual(receipt.artifacts.map((item) => item.name).slice(0, 5), ['goalContract', 'diff', 'verification', 'findings', 'verdict']);
  const delivery = JSON.parse(fs.readFileSync(path.join(ctx.runDir, 'delivery.json'), 'utf8'));
  assert.deepStrictEqual(delivery.receipt, { path: `.ai-engineering-loop/runs/${ctx.runId}/receipt.json`, digest: receipt.digest });
  assert.strictEqual(ctx.deliver.receipt.digest, receipt.digest);
  const markdown = fs.readFileSync(path.join(ctx.runDir, 'receipt.md'), 'utf8');
  assert.match(markdown, /^## Receipt/);
  assert.match(markdown, /- ✅ \*\*AC-1\*\*/);
  assert.match(markdown, /\[evidence\]\(https:\/\/ci\.example\.com/);
  const text = JSON.stringify(receipt) + markdown;
  for (const local of [ctx.repo, ctx.home, os.tmpdir(), os.homedir()]) assert.ok(!text.includes(local), `receipt leaks ${local}`);
  const verified = ok(ctx.cli('verify-receipt', '--run', ctx.runId, '--head', ctx.head, '--json'), 'verify-receipt');
  assert.deepStrictEqual(JSON.parse(verified.stdout).problems, []);
  ok(ctx.cli('verify-receipt', `.ai-engineering-loop/runs/${ctx.runId}/receipt.json`), 'by path, HEAD default');
});

test('verify-receipt detects a tampered artifact, a changed Goal, a head mismatch, and an edited receipt', () => {
  const ctx = deliveredRun();
  const verificationFile = path.join(ctx.runDir, 'verification.json');
  const original = fs.readFileSync(verificationFile, 'utf8');
  fs.writeFileSync(verificationFile, original.replace('"exitCode": 0', '"exitCode": 0 '));
  assert.ok(codes(verifyReceipt(ctx.repo, { runId: ctx.runId, head: ctx.head })).includes('ARTIFACT_TAMPERED'));
  fs.writeFileSync(verificationFile, original);
  assert.deepStrictEqual(codes(verifyReceipt(ctx.repo, { runId: ctx.runId, head: ctx.head })), []);

  const goalFile = path.join(ctx.runDir, 'goal-contract.json');
  const goal = JSON.parse(fs.readFileSync(goalFile, 'utf8'));
  fs.writeFileSync(goalFile, JSON.stringify({ ...goal, objective: 'Something else' }, null, 2));
  assert.ok(codes(verifyReceipt(ctx.repo, { runId: ctx.runId, head: ctx.head })).includes('GOAL_CHANGED'));

  const mismatch = ctx.cli('verify-receipt', '--run', ctx.runId, '--head', 'f'.repeat(40), '--json');
  assert.strictEqual(mismatch.status, 1);
  assert.ok(JSON.parse(mismatch.stdout).problems.some((problem) => problem.code === 'HEAD_MISMATCH'));

  const receiptFile = path.join(ctx.runDir, 'receipt.json');
  const edited = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  edited.review.verdict.verdict = 'PASS';
  edited.acceptanceCriteria[0].statement = 'edited after delivery';
  fs.writeFileSync(receiptFile, JSON.stringify(edited));
  assert.ok(codes(verifyReceipt(ctx.repo, { runId: ctx.runId, head: ctx.head })).includes('RECEIPT_DIGEST_MISMATCH'));
});

test('an AC without evidence is an explicit ❌ and fails verify-receipt', () => {
  const ctx = deliveredRun({ rows: ['AC-1'] });
  const ac2 = ctx.receipt.acceptanceCriteria.find((item) => item.id === 'AC-2');
  assert.strictEqual(ac2.status, 'MISSING');
  assert.match(ac2.missing.join(), /claimed-vs-reality/);
  assert.deepStrictEqual(ctx.deliver.receipt.missingEvidence, ['AC-2']);
  assert.match(fs.readFileSync(path.join(ctx.runDir, 'receipt.md'), 'utf8'), /- ❌ \*\*AC-2\*\*.*missing/);
  const result = verifyReceipt(ctx.repo, { runId: ctx.runId, head: ctx.head });
  assert.deepStrictEqual(codes(result), ['AC_EVIDENCE_MISSING']);
  assert.match(result.problems[0].detail, /^AC-2/);
});

test('evidence links must be hosted http(s) URLs for a known AC', () => {
  assert.deepStrictEqual(parseEvidenceLinks(['AC-1=https://ci.example/x.png']), { 'AC-1': ['https://ci.example/x.png'] });
  for (const bad of ['AC-1=file:///Users/me/shot.png', 'AC-1=/tmp/shot.png', 'AC-1=https://user:pw@ci.example/x', 'screenshot.png']) {
    assert.throws(() => parseEvidenceLinks([bad]), { code: 'INVALID_EVIDENCE_LINK' }, bad);
  }
  assert.match(renderReceiptMarkdown({
    runId: 'r', goal: { version: 1, contentHash: 'a'.repeat(64) }, base: { sha: null }, head: { sha: 'b'.repeat(40) }, digest: 'c'.repeat(64),
    acceptanceCriteria: [{ id: 'AC-1', statement: 'x | y', status: 'MISSING', missing: ['no recorded verification command'], evidence: [] }],
    review: { findings: { total: 0, valid: 0, blocking: 0 }, verdict: { verdict: 'PASS' } }, impact: null, guard: { warn: 0, block: 0 }
  }), /❌ \*\*AC-1\*\* x \\\| y — \*\*missing:\*\*/);
});
