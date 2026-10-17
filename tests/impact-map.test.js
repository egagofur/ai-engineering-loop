'use strict';

// Issue #71: blast-radius impact map before Stage 3.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const {
  buildImpactMap,
  changedFilesFromDiff,
  driftFindings,
  goalKeywords,
  matchesGlob,
  mergeDriftIntoLedger,
  validateImpactMap
} = require('../lib/impact-map.js');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'impact-map.schema.json'), 'utf8'));

function setupRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-impact-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-impact-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  };
  write('src/invoices/invoice-service.js', 'function approveInvoice(id) { return id; }\nmodule.exports = { approveInvoice };\n');
  write('src/invoices/routes.js', "router.post('/invoices/:id/approve', handler);\napp.get('/invoices', list);\n");
  write('src/users/profile.js', 'function renderProfile() {}\n');
  write('migrations/001_invoices.sql', 'CREATE TABLE IF NOT EXISTS invoices (id int);\n');
  write('tests/invoice-service.test.js', "require('../src/invoices/invoice-service.js');\n");
  write('README.md', '# Demo\n');
  write('package.json', '{"name":"demo","scripts":{"test":"node --version"}}\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx', '--allow-empty');
  return { repo, cli, git, write };
}

function ok(result, label) {
  assert.strictEqual(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  return result;
}

function startFrozenRun({ repo, cli }, objective = 'Approve invoice must lock the invoice') {
  const run = JSON.parse(ok(cli('run', '--json', objective), 'run').stdout);
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop', 'goal-draft.json'), JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    objective,
    acceptanceCriteria: [{ id: 'AC-1', statement: 'approved invoices cannot be edited', evidenceRequired: 'node --version exit 0', failureCases: ['editing an approved invoice succeeds'] }]
  }));
  ok(cli('goal', 'draft', '--run', run.runId, '--file', '.ai-engineering-loop/goal-draft.json', '--revision', '0'), 'goal draft');
  const freeze = ok(cli('goal', 'freeze', '--latest', '--run', run.runId, '--by', 'human'), 'goal freeze');
  return { runId: run.runId, runDir: path.join(repo, '.ai-engineering-loop/runs', run.runId), freeze };
}

function requiredKeysPresent(map) {
  for (const key of SCHEMA.required) assert.ok(Object.hasOwn(map, key), `schema key ${key} missing`);
  for (const entry of [...map.files, ...map.tests]) {
    for (const key of SCHEMA.$defs.pathEntry.required) assert.ok(Object.hasOwn(entry, key), `${key} missing in ${JSON.stringify(entry)}`);
  }
  for (const entry of [...map.modules, ...map.dbTables]) {
    for (const key of SCHEMA.$defs.namedEntry.required) assert.ok(Object.hasOwn(entry, key));
  }
}

test('glob matching covers **, *, ? and directory prefixes', () => {
  assert.ok(matchesGlob('src/a/b.js', 'src/**'));
  assert.ok(matchesGlob('src/a/b.js', 'src/'));
  assert.ok(matchesGlob('src/b.js', 'src/**/b.js'));
  assert.ok(matchesGlob('src/b.js', 'src/*.js'));
  assert.ok(!matchesGlob('src/a/b.js', 'src/*.js'));
  assert.ok(matchesGlob('src/b1.js', 'src/b?.js'));
  assert.ok(matchesGlob('./src/b.js', 'src/b.js'));
  assert.ok(!matchesGlob('srcx/b.js', 'src/'));
});

test('keywords are neutral: English and Indonesian filler words are dropped', () => {
  const keywords = goalKeywords({
    objective: 'Invoice yang sudah approved harus tidak bisa diubah',
    acceptanceCriteria: [{ statement: 'The invoice must return 403', failureCases: ['edit succeeds'] }]
  });
  assert.ok(keywords.includes('invoice'));
  assert.ok(keywords.includes('approved'));
  for (const filler of ['yang', 'sudah', 'harus', 'tidak', 'bisa', 'the', 'must', 'return']) {
    assert.ok(!keywords.includes(filler), filler);
  }
});

test('impact map is written on Goal freeze and lists files, modules, endpoints, tables, and tests with reasons', () => {
  const ctx = setupRepo();
  const { runId, runDir, freeze } = startFrozenRun(ctx);
  assert.match(freeze.stderr, /Impact map: .*impact-map\.json \(DRAFT/);
  const map = JSON.parse(fs.readFileSync(path.join(runDir, 'impact-map.json'), 'utf8'));
  assert.strictEqual(map.status, 'DRAFT');
  assert.strictEqual(map.runId, runId);
  assert.deepStrictEqual(validateImpactMap(map, { runId }), []);
  requiredKeysPresent(map);
  const files = map.files.map((entry) => entry.path);
  assert.ok(files.includes('src/invoices/invoice-service.js'));
  assert.ok(files.includes('src/invoices/routes.js'));
  assert.ok(!files.includes('src/users/profile.js'));
  assert.ok(map.modules.some((entry) => entry.name === 'src/invoices'));
  assert.ok(map.endpoints.some((entry) => entry.method === 'POST' && entry.route === '/invoices/:id/approve'));
  assert.ok(map.dbTables.some((entry) => entry.kind === 'table' && entry.name === 'invoices'));
  assert.ok(map.dbTables.some((entry) => entry.kind === 'migration' && entry.path === 'migrations/001_invoices.sql'));
  assert.ok(map.tests.some((entry) => entry.path === 'tests/invoice-service.test.js'));
  for (const entry of [...map.files, ...map.modules, ...map.endpoints, ...map.dbTables, ...map.tests]) {
    assert.ok(entry.reason.trim(), JSON.stringify(entry));
    assert.ok(entry.confidence > 0 && entry.confidence <= 1);
  }
  const again = JSON.parse(ok(ctx.cli('impact', 'map', '--run', runId, '--json'), 'impact map').stdout).map;
  assert.deepStrictEqual({ ...again, generatedAt: null }, { ...map, generatedAt: null }, 'generation is deterministic');
});

test('confirm turns the map into allowed scope; a confirmed map is locked unless --force', () => {
  const ctx = setupRepo();
  const { runId } = startFrozenRun(ctx);
  ok(ctx.cli('impact', 'map', '--run', runId), 'impact map');
  const confirmed = JSON.parse(ok(ctx.cli('impact', 'confirm', '--run', runId, '--by', 'ega', '--allow', 'docs/**', '--remove', 'src/invoices/routes.js', '--json'), 'confirm').stdout).map;
  assert.strictEqual(confirmed.status, 'CONFIRMED');
  assert.strictEqual(confirmed.confirmedBy, 'ega');
  assert.ok(confirmed.scope.allowedPaths.includes('src/invoices/invoice-service.js'));
  assert.ok(confirmed.scope.allowedPaths.includes('tests/invoice-service.test.js'));
  assert.ok(confirmed.scope.allowedPaths.includes('migrations/001_invoices.sql'));
  assert.ok(confirmed.scope.allowedPaths.includes('docs/**'));
  assert.ok(!confirmed.scope.allowedPaths.includes('src/invoices/routes.js'));
  assert.deepStrictEqual(require('../lib/impact-map.js').impactScope(confirmed), { allowedPaths: confirmed.scope.allowedPaths });
  const locked = ctx.cli('impact', 'map', '--run', runId, '--json');
  assert.strictEqual(locked.status, 1);
  assert.strictEqual(JSON.parse(locked.stdout).code, 'IMPACT_MAP_LOCKED');
  ok(ctx.cli('impact', 'map', '--run', runId, '--force'), 'impact map --force');
  assert.strictEqual(ctx.cli('impact', 'confirm', '--run', runId).status, 1, 'confirm requires --by');
});

test('trivial goals skip with a recorded reason and no drift is reported', () => {
  const ctx = setupRepo();
  const { runId, runDir } = startFrozenRun(ctx, 'Fix the README typo');
  assert.strictEqual(ctx.cli('impact', 'skip', '--run', runId, '--by', 'ega').status, 1, 'reason required');
  const skipped = JSON.parse(ok(ctx.cli('impact', 'skip', '--run', runId, '--by', 'ega', '--reason', 'copy-only change', '--json'), 'skip').stdout).map;
  assert.strictEqual(skipped.status, 'SKIPPED');
  assert.strictEqual(skipped.skipReason, 'copy-only change');
  assert.strictEqual(skipped.scope, null);
  ctx.write('README.md', '# Demo app\n');
  fs.writeFileSync(path.join(runDir, 'diff.patch'), ctx.git('diff'));
  ok(ctx.cli('gate', 'maker', '--run', runId), 'gate maker');
  const drift = JSON.parse(ok(ctx.cli('impact', 'drift', '--run', runId, '--json'), 'drift').stdout).drift;
  assert.strictEqual(drift.mapStatus, 'SKIPPED');
  assert.deepStrictEqual(drift.outOfMap, []);
});

test('verify records out-of-map files; review-pack shows them and the review gate adds a LOW ledger finding', () => {
  const ctx = setupRepo();
  const { runId, runDir } = startFrozenRun(ctx);
  ok(ctx.cli('impact', 'confirm', '--run', runId, '--by', 'ega'), 'confirm');
  ctx.write('src/invoices/invoice-service.js', 'function approveInvoice(id) { return { id, locked: true }; }\nmodule.exports = { approveInvoice };\n');
  ctx.write('src/users/profile.js', 'function renderProfile() { return null; }\n');
  fs.writeFileSync(path.join(runDir, 'diff.patch'), ctx.git('diff'));
  ok(ctx.cli('gate', 'maker', '--run', runId), 'gate maker');
  const verify = JSON.parse(ok(ctx.cli('verify', '--run', runId, '--cmd', 'node --version', '--json'), 'verify').stdout);
  assert.deepStrictEqual(verify.impactDrift, { mapStatus: 'CONFIRMED', outOfMap: ['src/users/profile.js'] });
  fs.writeFileSync(
    path.join(ctx.repo, '.ai-engineering-loop/tasks/claimed-vs-reality.md'),
    '| AC | Claimed | Reality from command log |\n|---|---|---|\n| AC-1 | locked | node --version exit 0 |\n'
  );
  const pack = JSON.parse(ok(ctx.cli('review-pack', '--run', runId, '--json'), 'review-pack').stdout);
  assert.deepStrictEqual(pack.impactDrift.outOfMap, ['src/users/profile.js']);
  const diffPack = JSON.parse(fs.readFileSync(path.join(ctx.repo, pack.packPath), 'utf8'));
  assert.deepStrictEqual(diffPack.impactDrift.outOfMap, ['src/users/profile.js']);
  const diffHash = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')).artifacts.diff.sha256;
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify({ schemaVersion: 1, runId, diffHash, findings: [] }));
  ok(ctx.cli('gate', 'review', '--run', runId), 'gate review');
  const ledger = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8'));
  assert.strictEqual(ledger.findings.length, 1);
  assert.strictEqual(ledger.findings[0].source, 'impact-map');
  assert.strictEqual(ledger.findings[0].severity, 'LOW');
  assert.strictEqual(ledger.findings[0].location, 'src/users/profile.js');
  assert.strictEqual(require('../lib/orchestration.js').isBlockingFinding(ledger.findings[0]), false, 'drift is a warning');
});

test('drift helpers: changed files, findings, and idempotent ledger merge', () => {
  const diff = 'diff --git a/src/a.js b/src/a.js\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/.ai-engineering-loop/x b/.ai-engineering-loop/x\ndiff --git a/old.js b/new.js\n';
  assert.deepStrictEqual(changedFilesFromDiff(diff), ['new.js', 'src/a.js']);
  const drift = { diffHash: 'h', mapStatus: 'DRAFT', outOfMap: ['new.js'] };
  const findings = driftFindings(drift);
  assert.strictEqual(findings[0].validity, 'VALID');
  assert.match(findings[0].failureScenario, /unconfirmed/);
  const first = mergeDriftIntoLedger({ diffHash: 'h', findings: [] }, drift);
  assert.strictEqual(first.added, 1);
  assert.strictEqual(mergeDriftIntoLedger(first.ledger, drift).added, 0);
  assert.strictEqual(mergeDriftIntoLedger({ diffHash: 'other', findings: [] }, drift).added, 0, 'stale drift is ignored');
});

test('validateImpactMap rejects missing reasons, bad status, and unconfirmed scope', () => {
  const base = buildImpactMap(os.tmpdir(), { run: { runId: 'r1' }, goal: { objective: 'x', acceptanceCriteria: [] } });
  assert.deepStrictEqual(validateImpactMap(base, { runId: 'r1' }), []);
  assert.ok(validateImpactMap({ ...base, status: 'MAYBE' }).some((e) => /status/.test(e)));
  assert.ok(validateImpactMap({ ...base, files: [{ path: 'a', confidence: 0.5, reason: '' }] }).some((e) => /reason/.test(e)));
  assert.ok(validateImpactMap({ ...base, status: 'CONFIRMED' }).some((e) => /allowedPaths/.test(e)));
  assert.ok(validateImpactMap({ ...base, status: 'SKIPPED' }).some((e) => /skipReason/.test(e)));
});
