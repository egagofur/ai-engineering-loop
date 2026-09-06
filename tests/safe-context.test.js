const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createContextPack,
  contextPackSummary,
  redactSecrets,
  resolveSafeRepoFile
} = require('../lib/safe-context.js');
const { createRun } = require('../lib/run-state.js');

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-context-'));
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  createRun(root, { runId: 'run-001' });
  return root;
}

test('redactSecrets removes common credentials without returning their values', () => {
  const source = [
    'Authorization: Bearer eyJhbGciOiJub25l.secret',
    'api_key = "sk-test-supersecret123"',
    'const token = "ghp_1234567890abcdefghijkl";',
    'AKIAIOSFODNN7EXAMPLE'
  ].join('\n');
  const result = redactSecrets(source);

  assert.doesNotMatch(result.text, /eyJhbGci|supersecret|ghp_123|AKIAIOS/);
  assert.ok(result.categories.length >= 4);
});

test('context pack is stage-bounded, redacted, private, and transcript-free', () => {
  const root = tempRepo();
  fs.writeFileSync(
    path.join(root, 'src/config.js'),
    'const api_key = "sk-test-supersecret123";\nmodule.exports = api_key;\n'
  );
  const result = createContextPack(root, {
    stage: 'devil-advocate',
    files: ['src/config.js']
  });
  const serialized = fs.readFileSync(path.join(root, result.path), 'utf8');
  const summary = contextPackSummary(result);

  assert.doesNotMatch(serialized, /supersecret/);
  assert.match(serialized, /\[REDACTED/);
  assert.strictEqual(result.pack.transcriptInherited, false);
  assert.strictEqual(summary.files, 1);
  assert.ok(summary.redactions >= 1);
  assert.strictEqual(fs.statSync(path.join(root, result.path)).mode & 0o777, 0o600);
});

test('sensitive files and repository escapes are blocked', () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=secret\n');
  assert.throws(() => resolveSafeRepoFile(root, '.env'), /Sensitive context path/);
  assert.throws(() => resolveSafeRepoFile(root, '../outside'), /escapes the repository/);
});

test('symlinks cannot escape the repository', () => {
  const root = tempRepo();
  const outside = path.join(os.tmpdir(), `ael-outside-${process.pid}.txt`);
  fs.writeFileSync(outside, 'outside');
  fs.symlinkSync(outside, path.join(root, 'src/outside-link'));
  assert.throws(() => resolveSafeRepoFile(root, 'src/outside-link'), /symlink escapes/);
});

test('large source files are truncated deterministically', () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, 'src/large.js'), 'x'.repeat(40_000));
  const result = createContextPack(root, {
    stage: 'maker',
    files: ['src/large.js']
  });
  assert.strictEqual(result.pack.entries[0].includedBytes, 32_000);
  assert.strictEqual(result.pack.entries[0].truncated, true);
  assert.strictEqual(result.pack.estimatedTokens, 8_000);
});

test('judge context rejects more than three files', () => {
  const root = tempRepo();
  const files = ['a', 'b', 'c', 'd'].map((name) => {
    const rel = `src/${name}.txt`;
    fs.writeFileSync(path.join(root, rel), name);
    return rel;
  });
  assert.throws(
    () => createContextPack(root, { stage: 'judge', files }),
    (err) => err.code === 'CONTEXT_FILE_LIMIT'
  );
});
