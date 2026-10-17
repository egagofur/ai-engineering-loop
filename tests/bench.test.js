'use strict';

// Issue #79: `ael bench` scores one host+model from Run artifacts.
// The fake host never calls a model. Every home and repo here is a temp dir.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { runDoctor, REQUIRED_SCHEMAS } = require('../lib/doctor.js');
const { loadEvaluationCases } = require('../lib/evaluation.js');
const { getHost } = require('../lib/hosts/registry.js');
const { effectiveCommand, unknownWriterArgs } = require('../lib/cli-args.js');
const {
  buildBenchCommand,
  parseHostUsage,
  resolveBenchBinary,
  assertSingleTarget
} = require('../lib/bench-targets.js');
const {
  INSTRUCTION_CATALOG,
  loadBenchScenarios,
  catalogSummary,
  runBench,
  compareBenches,
  formatCompare,
  renderBenchReport,
  renderHardening,
  buildInstructionViolations,
  DEFAULT_BENCH_TIMEOUT_MS,
  shouldSandboxHostHome,
  hostProcessEnv,
  installLocalCli,
  parseBenchTimeoutSeconds
} = require('../lib/bench.js');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const FAKE = path.join(__dirname, 'fixtures', 'fake-host.js');
const HOST_TIMEOUT = 60000;

function hasRouting(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasRouting);
  return Object.hasOwn(value, 'routing') || Object.values(value).some(hasRouting);
}

function assertNoRecommendation(text, label) {
  assert.doesNotMatch(text, /\brouting\b/i, label);
  assert.doesNotMatch(text, /recommended model|use model|switch to|model for stage/i, label);
}

function normalizeEol(text) {
  return String(text).replace(/\r\n/g, '\n');
}

function snapshotOptionalFile(filePath) {
  try {
    return { exists: true, content: fs.readFileSync(filePath) };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, content: null };
    throw error;
  }
}

function snapshotOptionalNames(dir) {
  try {
    return { exists: true, names: fs.readdirSync(dir).sort() };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, names: null };
    throw error;
  }
}

function hashTree(dir) {
  const hash = crypto.createHash('sha256');
  const walk = (current) => {
    if (!fs.existsSync(current)) {
      hash.update('missing');
      return;
    }
    for (const name of fs.readdirSync(current).sort()) {
      const abs = path.join(current, name);
      const stat = fs.lstatSync(abs);
      hash.update(name);
      hash.update(stat.isDirectory() ? 'd' : 'f');
      if (stat.isDirectory()) walk(abs);
      else hash.update(fs.readFileSync(abs));
    }
  };
  walk(dir);
  return hash.digest('hex');
}

function sourcesOf(metrics) {
  const sources = {};
  for (const [key, value] of Object.entries(metrics)) {
    assert.ok(value && value.source && value.source.file, `${key} names a source file`);
    sources[key] = value.source.file;
  }
  return sources;
}

function bench(profile, scenarioId, extra = {}) {
  const zone = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-bench-zone-'));
  const root = path.join(zone, 'project');
  const home = path.join(zone, 'caller-home');
  const probe = path.join(zone, 'probe.json');
  fs.mkdirSync(root);
  fs.mkdirSync(home);
  const result = runBench({
    rootDir: root,
    scratchDir: zone,
    home,
    host: 'grok',
    model: 'fake-model',
    bin: extra.bin === undefined ? FAKE : extra.bin,
    scenarioIds: scenarioId ? [scenarioId] : [],
    timeoutMs: 120000,
    ...extra.options,
    env: {
      ...(profile ? { AEL_FAKE_HOST_PROFILE: profile } : {}),
      AEL_BENCH_PROBE: probe,
      ...(extra.options && extra.options.env)
    }
  });
  const probed = fs.existsSync(probe) ? JSON.parse(fs.readFileSync(probe, 'utf8')) : null;
  return { zone, root, home, probe, probed, result };
}

function cli(cwd, args, home) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      AEL_HOME: home,
      AEL_NO_SETUP_HINT: '1',
      AEL_NO_AUTO_UPDATE: '1'
    },
    encoding: 'utf8'
  });
}

test('AC1 bench schemas exist and doctor parses them', () => {
  for (const file of ['bench-scenario.schema.json', 'bench-result.schema.json']) {
    assert.ok(REQUIRED_SCHEMAS.includes(file), file);
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', file), 'utf8'));
    assert.strictEqual(schema.type, 'object');
    assert.ok(schema.required.includes('schemaVersion'));
  }
  const doctor = runDoctor(ROOT);
  const schemas = doctor.checks.find((item) => item.id === 'artifact-schemas');
  const catalog = doctor.checks.find((item) => item.id === 'bench-catalog');
  assert.strictEqual(schemas.passed, true, schemas.detail);
  assert.match(schemas.detail, /schemas parse/);
  assert.strictEqual(catalog.passed, true, catalog.detail);
  const cliDoctor = spawnSync(process.execPath, [CLI, 'doctor', '--json'], {
    cwd: ROOT,
    env: { ...process.env, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' },
    encoding: 'utf8'
  });
  assert.strictEqual(cliDoctor.status, 0, cliDoctor.stdout + cliDoctor.stderr);
  const body = JSON.parse(cliDoctor.stdout);
  assert.strictEqual(body.checks.find((item) => item.id === 'artifact-schemas').passed, true);
  assert.strictEqual(body.checks.find((item) => item.id === 'bench-catalog').passed, true);
});

test('AC2 host bench templates match the non-interactive commands and --bin overrides', () => {
  const grok = buildBenchCommand(getHost('grok'), { model: 'grok-4', prompt: 'hello', bin: 'grok' });
  assert.strictEqual(getHost('grok').bench.bin, '~/.grok/bin/grok');
  assert.strictEqual(getHost('grok').bench.usageParser, 'none');
  assert.deepStrictEqual(grok.args, ['--no-auto-update', '--always-approve', '-m', 'grok-4', '-p', 'hello']);
  assert.strictEqual(grok.input, null);
  const claude = buildBenchCommand(getHost('claude'), { model: 'opus', prompt: 'hello', bin: 'claude' });
  assert.deepStrictEqual(claude.args, ['-p', '--output-format', 'json', '--dangerously-skip-permissions', '--model', 'opus']);
  assert.strictEqual(claude.input, 'hello');
  const codex = buildBenchCommand(getHost('codex'), { model: 'gpt-5', prompt: 'hello', bin: 'codex' });
  assert.deepStrictEqual(codex.args, ['exec', '--json', '--full-auto', '-m', 'gpt-5']);
  assert.strictEqual(codex.input, 'hello');
  const extra = buildBenchCommand(getHost('grok'), {
    model: 'grok-4',
    prompt: 'hello',
    bin: 'grok',
    extraArgs: ['--reasoning-effort', 'high']
  });
  assert.deepStrictEqual(extra.args.slice(-2), ['--reasoning-effort', 'high']);
  const present = resolveBenchBinary(getHost('grok'), { binOverride: FAKE });
  assert.strictEqual(present.status, 'ok');
  const missing = resolveBenchBinary(getHost('grok'), { binOverride: path.join(os.tmpdir(), 'ael-no-such-bin') });
  assert.strictEqual(missing.status, 'UNAVAILABLE');
  assert.throws(() => assertSingleTarget(['--host', 'grok', '--host', 'claude']), { code: 'BENCH_USAGE' });
  assert.deepStrictEqual(unknownWriterArgs(effectiveCommand('bench', ['compare', 'a', 'b']), ['compare', 'a', 'b']), []);
  assert.deepStrictEqual(unknownWriterArgs('bench', ['--host-arg', '--reasoning-effort', '--sandbox-home', '--timeout', '30']), []);
  assert.strictEqual(shouldSandboxHostHome({}), false);
  assert.strictEqual(shouldSandboxHostHome({ binOverride: FAKE }), true);
  assert.strictEqual(shouldSandboxHostHome({ sandboxHome: true }), true);
  const real = hostProcessEnv({
    realHome: '/real/home',
    hostHome: '/tmp/host',
    aelHome: '/tmp/ael',
    sandboxHost: false,
    baseEnv: { HOME: '/real/home', AEL_HOME: '/real/home/.ai-engineering-loop', PATH: '/usr/bin' }
  });
  assert.strictEqual(real.HOME, '/real/home');
  assert.strictEqual(real.AEL_HOME, '/tmp/ael');
  const sand = hostProcessEnv({
    realHome: '/real/home',
    hostHome: '/tmp/host',
    aelHome: '/tmp/ael',
    sandboxHost: true,
    baseEnv: { HOME: '/real/home', AEL_HOME: '/real/home/.ai-engineering-loop' }
  });
  assert.strictEqual(sand.HOME, '/tmp/host');
  assert.strictEqual(sand.AEL_HOME, '/tmp/ael');
  assert.strictEqual(DEFAULT_BENCH_TIMEOUT_MS, 20 * 60 * 1000);
  assert.strictEqual(parseBenchTimeoutSeconds(20), 20000);
});

test('AC2 bench runs one target in a temp repo and does not write outside that zone', { timeout: HOST_TIMEOUT }, () => {
  const currentPath = path.join(ROOT, '.ai-engineering-loop', 'runs', 'current.json');
  const benchPath = path.join(ROOT, '.ai-engineering-loop', 'bench');
  const currentBefore = snapshotOptionalFile(currentPath);
  const benchBefore = snapshotOptionalNames(benchPath);
  const statusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  const { zone, root, home, probed, result } = bench('compliant', 't0-docs-typo');
  assert.strictEqual(execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }), statusBefore);
  assert.deepStrictEqual(snapshotOptionalFile(currentPath), currentBefore);
  assert.deepStrictEqual(snapshotOptionalNames(benchPath), benchBefore);
  assert.deepStrictEqual(fs.readdirSync(zone).sort(), ['caller-home', 'probe.json', 'project']);
  assert.deepStrictEqual(fs.readdirSync(home), []);
  assert.ok(result.directory.startsWith(root));
  assert.ok(!result.directory.startsWith(os.homedir()));
  const realAel = path.join(os.homedir(), '.ai-engineering-loop');
  assert.ok(probed.AEL_HOME.startsWith(zone));
  assert.ok(probed.HOME.startsWith(zone));
  assert.notStrictEqual(path.resolve(probed.HOME), path.resolve(os.homedir()));
  assert.ok(!probed.AEL_HOME.startsWith(realAel));
  assert.ok(!probed.HOME.startsWith(realAel));
  assert.ok(probed.skills.includes('.agents/skills/ai-engineering-loop/SKILL.md'));
  assert.ok(probed.skills.includes('.grok/skills/ai-engineering-loop/SKILL.md'));
  assert.ok(probed.skills.includes('.claude/skills/ai-engineering-loop/SKILL.md'));
  assert.strictEqual(probed.shim, true);
  assert.match(probed.gitignore, /node_modules\//);
  assert.strictEqual(result.target.host, 'grok');
  assert.strictEqual(result.target.model, 'fake-model');
  assert.strictEqual(result.mode, 'ASSISTED');
  assert.strictEqual(result.scenarios.length, 1);
  assert.strictEqual(result.scenarios[0].compliant, true);
  assert.strictEqual(hasRouting(result), false);
  fs.rmSync(zone, { recursive: true, force: true });
});

test('AC2 passing two targets is a usage error and writes nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-bench-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-bench-proj-'));
  const repeated = cli(root, ['bench', '--host', 'grok', '--host', 'claude', '--model', 'fake-model', '--json'], home);
  assert.notStrictEqual(repeated.status, 0);
  assert.strictEqual(JSON.parse(repeated.stdout).code, 'BENCH_USAGE');
  assert.match(JSON.parse(repeated.stdout).error, /one --host and one --model/);
  assert.ok(!fs.existsSync(path.join(root, '.ai-engineering-loop')));
  const comma = cli(root, ['bench', '--host', 'grok,claude', '--model', 'fake-model', '--json'], home);
  assert.strictEqual(JSON.parse(comma.stdout).code, 'BENCH_USAGE');
  const twoModels = cli(root, ['bench', '--host', 'grok', '--model', 'a', '--model', 'b', '--json'], home);
  assert.strictEqual(JSON.parse(twoModels.stdout).code, 'BENCH_USAGE');
  assert.ok(!fs.existsSync(path.join(root, '.ai-engineering-loop')));
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('scenario shim runs this checkout so npx does not download the published package', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-bench-shim-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-bench-shim-home-'));
  installLocalCli(repo, CLI);
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"bench-shim","private":true}\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    AEL_HOME: home,
    AEL_NO_SETUP_HINT: '1',
    AEL_NO_AUTO_UPDATE: '1',
    npm_config_offline: 'true',
    npm_config_update_notifier: 'false'
  };
  const shim = path.join(repo, 'node_modules', '.bin', 'ai-engineering-loop');
  const cmdShim = fs.readFileSync(`${shim}.cmd`, 'utf8');
  assert.strictEqual(cmdShim, `@"${process.execPath}" "${path.resolve(CLI)}" %*\r\n`);
  const direct = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${shim}.cmd" --version`], {
      cwd: repo,
      env,
      encoding: 'utf8',
      windowsVerbatimArguments: true
    })
    : spawnSync(shim, ['--version'], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(direct.status, 0, direct.stderr);
  assert.match(direct.stdout, new RegExp(`v${version}`));
  const npx = spawnSync('npx', ['--no-install', 'ai-engineering-loop', '--version'], {
    cwd: repo,
    env,
    encoding: 'utf8',
    timeout: 20000,
    shell: process.platform === 'win32'
  });
  if (!(npx.error && npx.error.code === 'ENOENT')) {
    assert.strictEqual(npx.status, 0, `${npx.stdout}\n${npx.stderr}`);
    assert.match(npx.stdout, new RegExp(`v${version}`));
  }
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test('a short timeout records TIMEOUT and progress stays on stderr', { timeout: 20000 }, () => {
  const lines = [];
  const { zone, result } = bench('hang', 't0-docs-typo', {
    options: { timeoutMs: 400, onProgress: (line) => lines.push(line) }
  });
  assert.strictEqual(result.scenarios[0].status, 'TIMEOUT');
  assert.strictEqual(result.scenarios[0].compliant, false);
  const text = lines.join('\n');
  assert.match(text, /\[bench\] 1\/1 t0-docs-typo …\n/);
  assert.match(text, /\[bench\] 1\/1 t0-docs-typo … TIMEOUT /);
  fs.rmSync(zone, { recursive: true, force: true });
});

test('host JSON usage is scored and Grok plain text stays unknown', { timeout: HOST_TIMEOUT }, () => {
  assert.strictEqual(parseHostUsage('{"usage":{"input_tokens":12,"output_tokens":8}}', 'none'), null);
  assert.deepStrictEqual(parseHostUsage('{"usage":{"input_tokens":12,"output_tokens":8}}', 'json-usage'), {
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20
  });
  const grok = bench('stdout-usage', 't0-docs-typo');
  assert.strictEqual(grok.result.scenarios[0].status, 'SCORED');
  assert.strictEqual(grok.result.scenarios[0].compliant, true);
  assert.strictEqual(grok.result.scenarios[0].metrics.tokens.total, null);
  assert.strictEqual(grok.result.scenarios[0].metrics.tokens.unavailable, true);
  assert.notStrictEqual(grok.result.scenarios[0].metrics.tokens.total, 0);
  fs.rmSync(grok.zone, { recursive: true, force: true });
  const claude = bench('stdout-usage', 't0-docs-typo', { options: { host: 'claude' } });
  assert.strictEqual(claude.result.scenarios[0].metrics.tokens.total, 20);
  assert.strictEqual(claude.result.scenarios[0].metrics.tokens.unavailable, false);
  fs.rmSync(claude.zone, { recursive: true, force: true });
});

test('AC3 a compliant run is scored from Run artifacts and names each source', { timeout: HOST_TIMEOUT }, () => {
  const { zone, result } = bench('compliant', 't0-docs-typo');
  const row = result.scenarios[0];
  assert.strictEqual(row.status, 'SCORED');
  assert.strictEqual(row.compliant, true);
  assert.strictEqual(row.metrics.terminal.actual, 'DELIVERED');
  assert.strictEqual(row.metrics.terminal.ok, true);
  assert.deepStrictEqual(row.metrics.gates.seen, ['goal', 'maker', 'verification', 'review', 'judge', 'delivery']);
  assert.strictEqual(row.metrics.gates.ok, true);
  assert.strictEqual(row.metrics.receipt.verified, true);
  assert.strictEqual(row.metrics.tokens.total, 20);
  assert.strictEqual(row.metrics.tokens.unavailable, false);
  const sources = sourcesOf(row.metrics);
  assert.strictEqual(sources.terminal, 'state.json');
  assert.strictEqual(sources.gates, 'state.json');
  assert.strictEqual(sources.editBeforeFreeze, 'state.json');
  assert.strictEqual(sources.guard, 'guard-events.json');
  assert.strictEqual(sources.scopeDrift, 'impact-drift.json');
  assert.strictEqual(sources.receipt, 'receipt.json');
  assert.strictEqual(sources.wallTimeMs, 'bench-harness');
  assert.match(sources.tokens, /usage/);
  assert.strictEqual(result.summary.perGate.delivery.passed, 1);
  assert.strictEqual(result.summary.receipt.verified, 1);
  fs.rmSync(zone, { recursive: true, force: true });
});

test('AC3 a skipped gate is recorded from state.json history', { timeout: HOST_TIMEOUT }, () => {
  const { zone, result } = bench('skip-gate', 't0-docs-typo');
  const row = result.scenarios[0];
  assert.strictEqual(row.compliant, false);
  assert.ok(row.metrics.gates.skipped.includes('verification'));
  assert.ok(row.metrics.gates.skipped.includes('delivery'));
  assert.strictEqual(row.metrics.gates.ok, false);
  assert.ok(row.violations.some((item) => item.type === 'skipped-gate' && item.source.file === 'state.json'));
  fs.rmSync(zone, { recursive: true, force: true });
});

test('AC3 an edit before Goal freeze is detected from the goal timestamp', { timeout: HOST_TIMEOUT }, () => {
  const { zone, result } = bench('edit-before-freeze', 't0-docs-typo');
  const row = result.scenarios[0];
  assert.strictEqual(row.metrics.editBeforeFreeze.detected, true);
  assert.ok(row.metrics.editBeforeFreeze.files.includes('README.md'));
  assert.strictEqual(row.metrics.editBeforeFreeze.source.file, 'state.json');
  assert.ok(row.violations.some((item) => item.type === 'edit-before-freeze'));
  assert.strictEqual(row.compliant, false);
  fs.rmSync(zone, { recursive: true, force: true });
});

test('AC3 a guard block is counted from guard-events.json', { timeout: HOST_TIMEOUT }, () => {
  const { zone, result } = bench('guard-block', 'trap-destructive-reset');
  const row = result.scenarios[0];
  assert.ok(row.metrics.guard.block >= 1);
  assert.ok(row.metrics.guard.rules.includes('git-reset-hard'));
  assert.strictEqual(row.metrics.guard.source.file, 'guard-events.json');
  assert.strictEqual(row.metrics.traps.triggered, true);
  assert.ok(row.violations.some((item) => item.type === 'guard-violation'));
  assert.strictEqual(result.summary.guard.block, row.metrics.guard.block);
  fs.rmSync(zone, { recursive: true, force: true });
});

test('AC3 an out-of-map edit is read from impact-drift.json', { timeout: HOST_TIMEOUT }, () => {
  const { zone, result } = bench('out-of-map', 'trap-out-of-scope');
  const row = result.scenarios[0];
  assert.ok(row.metrics.scopeDrift.outOfMap.includes('extras/unrelated.js'));
  assert.strictEqual(row.metrics.scopeDrift.ok, false);
  assert.strictEqual(row.metrics.scopeDrift.source.file, 'impact-drift.json');
  assert.strictEqual(row.metrics.traps.items.find((item) => item.kind === 'out-of-scope-edit').triggered, true);
  assert.ok(row.violations.some((item) => item.type === 'scope-drift'));
  fs.rmSync(zone, { recursive: true, force: true });
});

test('AC3 a failing receipt reports verifyReceipt problem codes', { timeout: HOST_TIMEOUT }, () => {
  const { zone, result } = bench('bad-receipt', 't1-list-pagination');
  const row = result.scenarios[0];
  assert.strictEqual(row.metrics.receipt.verified, false);
  assert.ok(row.metrics.receipt.problems.includes('AC_EVIDENCE_MISSING'));
  assert.strictEqual(row.metrics.receipt.source.file, 'receipt.json');
  assert.strictEqual(row.metrics.traps.items.find((item) => item.kind === 'missing-evidence').triggered, true);
  assert.ok(row.violations.some((item) => item.type === 'receipt-invalid'));
  fs.rmSync(zone, { recursive: true, force: true });
});

test('AC3 a missing host binary is UNAVAILABLE and not a model failure', () => {
  const { zone, result } = bench(null, 't0-docs-typo', { bin: path.join(os.tmpdir(), 'ael-bench-missing-bin') });
  assert.strictEqual(result.status, 'UNAVAILABLE');
  assert.match(result.unavailableReason, /not found/);
  assert.strictEqual(result.scenarios[0].status, 'UNAVAILABLE');
  assert.strictEqual(result.scenarios[0].compliant, false);
  assert.deepStrictEqual(result.scenarios[0].violations, []);
  assert.strictEqual(result.summary.complianceRate, null);
  assert.strictEqual(result.scenarios[0].metrics.tokens.total, null);
  assert.notStrictEqual(result.scenarios[0].metrics.tokens.total, 0);
  assert.strictEqual(hasRouting(result), false);
  fs.rmSync(zone, { recursive: true, force: true });
});

test('AC4 tokens come from the usage ledger and --unavailable stays unknown', { timeout: HOST_TIMEOUT }, () => {
  const { zone, result } = bench('unavailable-usage', 't0-docs-typo');
  const tokens = result.scenarios[0].metrics.tokens;
  assert.strictEqual(result.scenarios[0].compliant, true);
  assert.strictEqual(tokens.unavailable, true);
  assert.strictEqual(tokens.total, null);
  assert.strictEqual(tokens.input, null);
  assert.strictEqual(tokens.output, null);
  assert.notStrictEqual(tokens.total, 0);
  assert.match(tokens.source.file, /unavailable-/);
  assert.strictEqual(result.summary.tokens.p50, null);
  assert.strictEqual(result.summary.tokens.p90, null);
  assert.ok(result.summary.tokens.unknownCount >= 1);
  assert.strictEqual(parseHostUsage('{"usage":"unavailable"}'), null);
  fs.rmSync(zone, { recursive: true, force: true });
});

test('AC5 report.md and results.json cover one target and do not recommend a model', { timeout: HOST_TIMEOUT }, () => {
  const fixed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bench-fixed-result.json'), 'utf8'));
  const report = renderBenchReport(fixed);
  assert.strictEqual(
    normalizeEol(fs.readFileSync(path.join(__dirname, 'fixtures', 'bench-report.golden.md'), 'utf8')),
    normalizeEol(`${report}\n`)
  );
  assertNoRecommendation(report, 'golden report');
  assert.strictEqual(hasRouting(fixed), false);
  assert.match(report, /Per-gate:/);
  assert.match(report, /Guard violations:/);
  assert.match(report, /Scope drift:/);
  assert.match(report, /Receipt validity:/);
  assert.match(report, /Time p50\/p90:/);
  assert.match(report, /Tokens p50\/p90:/);
  assert.match(report, /unknown/);

  const { zone, root, result } = bench('compliant', 't1-empty-state');
  const directory = result.directory;
  const results = JSON.parse(fs.readFileSync(path.join(directory, 'results.json'), 'utf8'));
  const liveReport = fs.readFileSync(path.join(directory, 'report.md'), 'utf8');
  const hardening = fs.readFileSync(path.join(directory, 'hardening.md'), 'utf8');
  assert.strictEqual(results.target.host, 'grok');
  assert.strictEqual(results.target.model, 'fake-model');
  assert.strictEqual(results.schemaVersion, 1);
  assert.ok(results.summary.perGate.goal);
  assert.ok(results.summary.time.p50Ms >= 0);
  assert.strictEqual(hasRouting(results), false);
  assertNoRecommendation(liveReport, 'live report');
  assertNoRecommendation(hardening, 'hardening');
  assert.match(liveReport, /Per-gate:/);
  assert.match(liveReport, /grok \/ fake-model/);
  const home = path.join(zone, 'caller-home');
  const printed = cli(root, ['bench', '--host', 'grok', '--model', 'fake-model', '--bin', path.join(zone, 'missing'), '--scenario', 't0-docs-typo'], home);
  assert.strictEqual(printed.status, 0, printed.stderr);
  assertNoRecommendation(printed.stdout, 'cli text');
  const json = cli(root, ['bench', '--host', 'grok', '--model', 'fake-model', '--bin', path.join(zone, 'missing'), '--scenario', 't0-docs-typo', '--json'], home);
  const body = JSON.parse(json.stdout);
  assert.strictEqual(hasRouting(body), false);
  assert.strictEqual(body.status, 'UNAVAILABLE');
  assertNoRecommendation(json.stdout, 'cli json');
  assert.doesNotMatch(json.stdout, /\[bench\]/);
  assert.match(json.stderr, /\[bench\] 1\/1 t0-docs-typo … UNAVAILABLE/);
  assert.match(printed.stderr, /\[bench\] 1\/1 t0-docs-typo …/);
  fs.rmSync(zone, { recursive: true, force: true });
});

test('AC6 bench compare prints a side-by-side table and does not write', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-bench-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-bench-proj-'));
  const runs = path.join(root, '.ai-engineering-loop', 'runs', 'marker');
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, 'state.json'), '{"untouched":true}\n');
  const left = runBench({
    rootDir: root,
    home,
    host: 'grok',
    model: 'cheap',
    bin: path.join(root, 'missing-a'),
    scenarioIds: ['t0-docs-typo'],
    benchId: 'bench-a'
  });
  const right = runBench({
    rootDir: root,
    home,
    host: 'claude',
    model: 'expensive',
    bin: path.join(root, 'missing-b'),
    scenarioIds: ['t0-docs-typo'],
    benchId: 'bench-b'
  });
  const benchDir = path.join(root, '.ai-engineering-loop', 'bench');
  const runsDir = path.join(root, '.ai-engineering-loop', 'runs');
  const beforeBench = hashTree(benchDir);
  const beforeRuns = hashTree(runsDir);
  const comparison = compareBenches(root, left.benchId, right.benchId);
  assert.strictEqual(formatCompare(comparison), formatCompare(compareBenches(root, 'bench-a', 'bench-b')));
  assert.match(comparison.table, /grok\/cheap/);
  assert.match(comparison.table, /claude\/expensive/);
  assert.match(comparison.table, /gate goal/);
  assert.strictEqual(hasRouting(comparison), false);
  assertNoRecommendation(formatCompare(comparison), 'compare');
  const printed = cli(root, ['bench', 'compare', 'bench-a', 'bench-b'], home);
  assert.strictEqual(printed.status, 0, printed.stderr);
  assert.match(printed.stdout, /read-only/);
  assert.match(printed.stdout, /grok\/cheap/);
  assert.strictEqual(hashTree(benchDir), beforeBench);
  assert.strictEqual(hashTree(runsDir), beforeRuns);
  const json = cli(root, ['bench', 'compare', 'bench-a', 'bench-b', '--json'], home);
  assert.strictEqual(json.status, 0, json.stderr);
  assert.strictEqual(hasRouting(JSON.parse(json.stdout)), false);
  assert.strictEqual(hashTree(benchDir), beforeBench);
  assert.strictEqual(hashTree(runsDir), beforeRuns);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('AC7 violations link to skill-src headings, rank by frequency, and hardening.md suggests a fix', () => {
  const scores = [
    { violations: [{ type: 'scope-drift' }, { type: 'edit-before-freeze' }] },
    { violations: [{ type: 'scope-drift' }, { type: 'skipped-claimed-vs-reality' }] },
    { violations: [{ type: 'scope-drift' }] }
  ];
  const ranked = buildInstructionViolations(scores);
  assert.deepStrictEqual(ranked.map((item) => [item.type, item.count]), [
    ['scope-drift', 3],
    ['edit-before-freeze', 1],
    ['skipped-claimed-vs-reality', 1]
  ]);
  for (const item of INSTRUCTION_CATALOG) {
    const text = fs.readFileSync(path.join(ROOT, item.skill), 'utf8');
    assert.ok(text.includes(item.heading), `${item.type} heading missing in ${item.skill}`);
    assert.ok(text.includes(item.instruction), `${item.type} instruction missing in ${item.skill}`);
    assert.ok(['tighten-text', 'hard-gate'].includes(item.hardening.kind));
    assert.ok(item.hardening.suggestion.length > 10);
  }
  const claimed = ranked.find((item) => item.type === 'skipped-claimed-vs-reality');
  assert.match(claimed.skill, /SKILL\.template\.md/);
  assert.match(claimed.instruction, /claimed-vs-reality\.md/);
  const freeze = ranked.find((item) => item.type === 'edit-before-freeze');
  assert.match(freeze.skill, /loop-goal\.md/);
  assert.match(freeze.instruction, /Do not edit production code until the Goal gate passes/);
  const hardening = renderHardening(ranked);
  const headingAt = hardening.search(/^1\. \*\*scope-drift\*\*/m);
  assert.ok(headingAt >= 0);
  assert.strictEqual(hardening.indexOf('scope-drift'), headingAt + '1. **'.length);
  assert.match(hardening, /Suggestion \(hard-gate\)/);
  assert.match(hardening, /never applies them automatically/i);
  assertNoRecommendation(hardening, 'hardening');
  const golden = fs.readFileSync(path.join(__dirname, 'fixtures', 'bench-hardening.golden.md'), 'utf8');
  const fixed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bench-fixed-result.json'), 'utf8'));
  assert.strictEqual(normalizeEol(renderHardening(fixed.instructionViolations)), normalizeEol(golden));
  assert.ok(golden.includes('tighten-text'));
  assert.ok(golden.includes('hard-gate'));
});

test('AC8 scenarios cover T0 T1 T2 and traps, and eval still validates the 25-case catalog', () => {
  const fixtures = loadBenchScenarios();
  const summary = catalogSummary(fixtures);
  assert.ok(fixtures.length >= 6 && fixtures.length <= 8, `expected 6-8 scenarios, got ${fixtures.length}`);
  assert.ok(summary.tiers.T0 >= 1 && summary.tiers.T1 >= 1 && summary.tiers.T2 >= 1);
  const kinds = new Set(fixtures.flatMap((item) => (item.traps || []).map((trap) => trap.kind)));
  assert.ok(kinds.has('destructive-command'));
  assert.ok(kinds.has('out-of-scope-edit'));
  assert.ok(kinds.has('prompt-injection'));
  assert.ok(kinds.has('missing-evidence'));
  assert.ok(summary.traps >= 2);
  const cases = loadEvaluationCases();
  assert.strictEqual(cases.length, 25);
  assert.ok(!cases.some((item) => String(item.id || '').startsWith('trap-')));
  const evaluated = spawnSync(process.execPath, [CLI, 'eval', '--json'], {
    cwd: ROOT,
    env: { ...process.env, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' },
    encoding: 'utf8'
  });
  assert.strictEqual(evaluated.status, 0, evaluated.stdout + evaluated.stderr);
  const body = JSON.parse(evaluated.stdout);
  assert.strictEqual(body.total, 25);
  assert.strictEqual(body.mode, 'catalog');
});

test('AC9 docs bench resolves and the changelog records the command', () => {
  const listed = spawnSync(process.execPath, [CLI, 'docs', 'bench', '--json'], { encoding: 'utf8' });
  assert.strictEqual(listed.status, 0, listed.stderr);
  const doc = JSON.parse(listed.stdout);
  assert.strictEqual(doc.rel, 'core/bench.md');
  assert.match(doc.text, /scripted approver/i);
  assert.match(doc.text, /--mode unattended/);
  assert.match(doc.text, /does not feed `ael learn`|do not feed `ael learn`/i);
  assertNoRecommendation(doc.text, 'docs');
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /### `ael bench`: compliance self-check for one host and model \(#79\)/);
  const unattended = bench(null, 't0-docs-typo', {
    bin: path.join(os.tmpdir(), 'ael-bench-missing-bin'),
    options: { mode: 'UNATTENDED', repeat: 2 }
  });
  assert.strictEqual(unattended.result.mode, 'UNATTENDED');
  assert.strictEqual(unattended.result.repeat, 2);
  assert.strictEqual(unattended.result.scenarios.length, 2);
  fs.rmSync(unattended.zone, { recursive: true, force: true });
});
