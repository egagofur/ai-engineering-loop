const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  assessSmallTaskFastPath,
  buildContextIndex,
  createDiffHunkPack,
  queryContextIndex,
  relatedContextIndex
} = require('../lib/smart-context.js');
const { createRun } = require('../lib/run-state.js');
const { updatePolicy } = require('../lib/runtime-policy.js');

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-smart-context-'));
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  createRun(root, { runId: 'run-001' });
  return root;
}

function commitAll(root, message = 'initial') {
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', message], { cwd: root, stdio: 'ignore' });
}

test('context index caches repository summaries without source content', () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, 'src', 'app.js'), [
    'function alpha() { return 1; }',
    'class Beta {}',
    'const api_key = "sk-test-supersecret123";'
  ].join('\n'));

  const result = buildContextIndex(root, { files: ['src/app.js'] });
  const serialized = fs.readFileSync(path.join(root, result.path), 'utf8');

  assert.strictEqual(result.index.files.length, 1);
  assert.strictEqual(result.index.files[0].path, 'src/app.js');
  assert.strictEqual(result.index.cache.misses, 1);
  assert.deepStrictEqual(result.index.files[0].symbols.slice(0, 2), ['alpha', 'Beta']);
  assert.doesNotMatch(serialized, /supersecret|return 1/);
});

test('context index reuses per-hash summary cache when file content is unchanged', () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'function alpha() { return 1; }\n');
  const first = buildContextIndex(root, { files: ['src/app.js'] });
  const cachedPath = path.join(root, '.ai-engineering-loop', 'context', 'files', `${first.index.files[0].sourceSha256}.json`);
  const cached = JSON.parse(fs.readFileSync(cachedPath, 'utf8'));
  cached.symbols = ['cached-alpha'];
  fs.writeFileSync(cachedPath, `${JSON.stringify(cached, null, 2)}\n`);

  const second = buildContextIndex(root, { files: ['src/app.js'] });

  assert.strictEqual(second.index.cache.hits, 1);
  assert.strictEqual(second.index.cache.misses, 0);
  assert.deepStrictEqual(second.index.files[0].symbols, ['cached-alpha']);
});

test('context index query and related commands return metadata without source bodies', () => {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'payments.js'), 'function authorizePayment() { return "secret-body"; }\n');
  fs.writeFileSync(path.join(root, 'tests', 'payments.test.js'), 'const paymentTest = true;\n');
  buildContextIndex(root, { files: ['src/payments.js', 'tests/payments.test.js'] });

  const query = queryContextIndex(root, { query: 'authorizePayment' });
  const related = relatedContextIndex(root, { file: 'src/payments.js' });
  const serialized = JSON.stringify({ query, related });

  assert.strictEqual(query.matches[0].path, 'src/payments.js');
  assert.deepStrictEqual(query.matches[0].symbols, ['authorizePayment']);
  assert.strictEqual(related.matches[0].path, 'tests/payments.test.js');
  assert.doesNotMatch(serialized, /secret-body/);
});

test('diff hunk pack sends bounded hunks and file summaries instead of whole files', () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, 'src', 'app.js'), [
    ...Array.from({ length: 80 }, (_, index) => `const before${index} = ${index};`),
    'module.exports = 1;',
    ...Array.from({ length: 80 }, (_, index) => `const after${index} = ${index};`)
  ].join('\n'));
  commitAll(root);
  fs.writeFileSync(path.join(root, 'src', 'app.js'), [
    ...Array.from({ length: 80 }, (_, index) => `const before${index} = ${index};`),
    'function changed() {',
    '  return "safe";',
    '}',
    'const api_key = "sk-test-supersecret123";',
    'module.exports = changed;',
    ...Array.from({ length: 80 }, (_, index) => `const after${index} = ${index};`)
  ].join('\n'));

  const result = createDiffHunkPack(root, { runId: 'run-001', profile: 'lean' });
  const serialized = fs.readFileSync(path.join(root, result.path), 'utf8');
  const file = result.pack.files[0];

  assert.strictEqual(result.pack.reviewProfile, 'lean');
  assert.strictEqual(result.pack.reviewBudget.devilAdvocateMaxFindings, 5);
  assert.strictEqual(result.pack.reviewBudget.judgeMayReadFullDiff, false);
  assert.strictEqual(file.path, 'src/app.js');
  assert.ok(file.summary.sourceBytes > file.includedBytes);
  assert.match(file.hunks[0].content, /function changed/);
  assert.doesNotMatch(serialized, /const before0/);
  assert.doesNotMatch(serialized, /const after79/);
  assert.doesNotMatch(serialized, /supersecret/);
  assert.doesNotMatch(serialized, /api_key = "sk-test/);
});

test('diff hunk pack uses review profile limits and records unresolved finding context', () => {
  const root = tempRepo();
  updatePolicy(root, { reviewProfile: 'standard' });
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'module.exports = 1;\n');
  commitAll(root);
  fs.writeFileSync(path.join(root, 'src', 'app.js'), `${'x'.repeat(20_000)}\n`);
  const runDir = path.join(root, '.ai-engineering-loop', 'runs', 'run-001');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify({
    findings: [
      { id: 'DA-01', validity: 'VALID', severity: 'HIGH', disposition: 'STRONG', location: 'src/app.js#L1' },
      { id: 'DA-02', validity: 'VALID', severity: 'LOW', disposition: 'ACCEPTABLE', location: 'src/app.js#L1' }
    ]
  }));

  const result = createDiffHunkPack(root, { runId: 'run-001' });

  assert.strictEqual(result.pack.reviewProfile, 'standard');
  assert.match(result.pack.reviewDelta.currentDiffHash, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(result.pack.reviewDelta.unresolvedFindingIds, ['DA-01']);
  assert.deepStrictEqual(result.pack.reviewDelta.focusPaths, ['src/app.js']);
  assert.strictEqual(result.pack.unresolvedFindings.length, 1);
  assert.strictEqual(result.pack.unresolvedFindings[0].id, 'DA-01');
  assert.ok(result.pack.files[0].truncated);
});

test('small-task fast path stays lean only for small low-risk diffs', () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'module.exports = 1;\n');
  commitAll(root);
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'module.exports = 2;\n');

  const eligible = assessSmallTaskFastPath(root);
  assert.strictEqual(eligible.eligible, true);
  assert.strictEqual(eligible.recommendedProfile, 'lean');

  fs.mkdirSync(path.join(root, 'src', 'auth'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'auth', 'permissions.js'), 'module.exports = true;\n');
  const blocked = assessSmallTaskFastPath(root);
  assert.strictEqual(blocked.eligible, false);
  assert.ok(blocked.reasons.includes('HIGH_RISK_PATH'));
  assert.strictEqual(blocked.recommendedProfile, 'standard');
});
