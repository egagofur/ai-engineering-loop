'use strict';

// Issue #97: `goal draft --from-design <doc>` and `designRef`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const design = require('../lib/design-ref.js');
const { validateGoalContract } = require('../lib/gates.js');

const DOC = `# Webhook delivery

## Goals

- Deliver each event to subscribers with retries
- Keep **idempotency** per event id

## Non-Goals

- Batch sending

## Detailed Implementation Plan

### Target Scope

- \`src/webhooks/deliver.js\` (new)
- Modify \`src/events/bus.js\` and \`./src/config.js\`
- Not a path: \`retry()\` or \`/etc/hosts\`

### Test Plan

1. Delivers once on 200
2. Retries with backoff on 500, then dead-letters after 5 tries

\`\`\`
- not a test case inside a fence
\`\`\`
`;

function setupRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-design-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-design-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'docs/designs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs/designs/webhooks.md'), DOC);
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo","scripts":{"test":"node --version"}}\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  const run = JSON.parse(cli('run', '--json', 'add', 'webhook', 'delivery').stdout);
  return { repo, cli, runId: run.runId };
}

test('parseDesignDoc reads goals, non-goals, target files and test cases leniently', () => {
  const parsed = design.parseDesignDoc(DOC);
  assert.strictEqual(parsed.title, 'Webhook delivery');
  assert.deepStrictEqual(parsed.goals, ['Deliver each event to subscribers with retries', 'Keep idempotency per event id']);
  assert.deepStrictEqual(parsed.nonGoals, ['Batch sending']);
  assert.deepStrictEqual(parsed.targetFiles, ['src/webhooks/deliver.js', 'src/events/bus.js', 'src/config.js']);
  assert.deepStrictEqual(parsed.testCases, ['Delivers once on 200', 'Retries with backoff on 500, then dead-letters after 5 tries']);
  assert.deepStrictEqual(parsed.warnings, []);
});

test('draftFromDesign builds a valid draft with placeholders and designRef', () => {
  const doc = { path: 'docs/designs/webhooks.md', sha256: 'a'.repeat(64), text: DOC };
  const draft = design.draftFromDesign(doc, design.parseDesignDoc(DOC));
  assert.strictEqual(draft.acceptanceCriteria.length, 2);
  assert.deepStrictEqual(draft.outOfScope, ['Batch sending']);
  assert.deepStrictEqual(draft.designRef.targetFiles, ['src/webhooks/deliver.js', 'src/events/bus.js', 'src/config.js']);
  assert.ok(validateGoalContract({ ...draft, schemaVersion: 1, runId: 'r' }).valid);
  assert.deepStrictEqual(design.placeholderRows(draft), ['AC-1', 'AC-2']);
});

test('a doc without Test Plan or Target Scope still drafts, with warnings and placeholder rows', () => {
  const parsed = design.parseDesignDoc('# Thin idea\n\nSome prose only.\n');
  assert.strictEqual(parsed.warnings.length, 2);
  const draft = design.draftFromDesign({ path: 'x.md', sha256: 'b'.repeat(64) }, parsed);
  assert.strictEqual(draft.acceptanceCriteria.length, 1);
  assert.match(draft.acceptanceCriteria[0].statement, /^<fill:/);
  assert.deepStrictEqual(draft.designRef.targetFiles, []);
});

test('validateDesignRef rejects malformed references', () => {
  assert.deepStrictEqual(design.validateDesignRef(undefined), []);
  assert.strictEqual(design.validateDesignRef({ path: '../x.md', sha256: 'z' }).length, 2);
  assert.ok(!validateGoalContract({ objective: 'o', acceptanceCriteria: [{ id: 'AC-1', statement: 's', evidenceRequired: 'e', failureCases: ['f'] }], designRef: { path: 'a.md' } }).valid);
});

test('CLI: --from-design drafts, freeze refuses placeholders, and show reports a changed design', () => {
  const { repo, cli, runId } = setupRepo();
  const drafted = cli('goal', 'draft', '--run', runId, '--from-design', 'docs/designs/webhooks.md', '--revision', '0');
  assert.strictEqual(drafted.status, 0, drafted.stderr);
  const out = JSON.parse(drafted.stdout);
  assert.strictEqual(out.design.path, 'docs/designs/webhooks.md');
  assert.deepStrictEqual(out.design.placeholders, ['AC-1', 'AC-2']);
  assert.strictEqual(out.result.contract.designRef.targetFiles.length, 3);

  const frozen = cli('goal', 'freeze', '--run', runId, '--latest', '--by', 'alice');
  assert.notStrictEqual(frozen.status, 0);
  assert.match(frozen.stdout + frozen.stderr, /GOAL_PLACEHOLDERS/);

  let shown = JSON.parse(cli('goal', 'show', '--run', runId).stdout);
  assert.deepStrictEqual(shown.design, { path: 'docs/designs/webhooks.md', missing: false, designChanged: false });
  fs.appendFileSync(path.join(repo, 'docs/designs/webhooks.md'), '\n- late edit\n');
  shown = JSON.parse(cli('goal', 'show', '--run', runId).stdout);
  assert.strictEqual(shown.design.designChanged, true);

  // --file keeps the caller's rows and only adds designRef; then freeze passes.
  const filled = {
    objective: 'Webhook delivery',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'Delivers once on 200', evidenceRequired: 'test/deliver.test.js', failureCases: ['double delivery'] }]
  };
  fs.writeFileSync(path.join(repo, 'goal.json'), JSON.stringify(filled));
  const withFile = cli('goal', 'draft', '--run', runId, '--from-design', 'docs/designs/webhooks.md', '--file', 'goal.json', '--revision', '1');
  assert.strictEqual(withFile.status, 0, withFile.stderr);
  const contract = JSON.parse(withFile.stdout).result.contract;
  assert.strictEqual(contract.acceptanceCriteria.length, 1);
  assert.strictEqual(contract.designRef.path, 'docs/designs/webhooks.md');
  const ok = cli('goal', 'freeze', '--run', runId, '--latest', '--by', 'alice');
  assert.strictEqual(ok.status, 0, ok.stderr);
});

test('CLI: unsafe or missing design documents fail without writing a draft', () => {
  const { repo, cli, runId } = setupRepo();
  fs.writeFileSync(path.join(repo, 'big.md'), 'x'.repeat(256 * 1024 + 1));
  const outside = path.join(os.tmpdir(), `ael-outside-${process.pid}.md`);
  fs.writeFileSync(outside, DOC);
  const cases = [['missing.md', /DESIGN_DOC_MISSING/], [outside, /UNSAFE_DESIGN_PATH/], ['big.md', /INVALID_DESIGN_DOC/], ['package.json', /INVALID_DESIGN_DOC/]];
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(repo, 'docs/designs/webhooks.md'), path.join(repo, 'link.md'));
    cases.push(['link.md', /INVALID_DESIGN_DOC/]);
  }
  for (const [file, code] of cases) {
    const result = cli('goal', 'draft', '--run', runId, '--from-design', file, '--revision', '0');
    assert.notStrictEqual(result.status, 0, file);
    assert.match(result.stdout + result.stderr, code, file);
  }
  assert.strictEqual(JSON.parse(cli('goal', 'show', '--run', runId).stdout).draft, null);
});
