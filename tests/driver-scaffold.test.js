'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { scaffoldDriver, driverProblems } = require('../lib/driver-scaffold.js');
const { loadFeatureMap } = require('../lib/feature-map.js');
const { auditHarness } = require('../lib/harness-audit.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function project({ pkg = {}, rows }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-driver-')));
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'app', ...pkg }));
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'feature-map.md'), [
    '| Feature | Where (UI or endpoint) | Paths | How to reach | Driver |',
    '|---|---|---|---|---|',
    ...rows
  ].join('\n') + '\n');
  return root;
}

test('C-43 a Playwright repo gets a web driver, and the feature map points at it', () => {
  const root = project({
    pkg: { scripts: { dev: 'next dev' }, devDependencies: { '@playwright/test': '1.0.0' } },
    rows: ['| export-csv | Reports > Export button | src/reports/** | open Reports, click Export | |']
  });
  const [result] = scaffoldDriver(root);
  assert.strictEqual(result.surface, 'web');
  assert.strictEqual(result.written, '.ai-engineering-loop/drivers/export-csv.mjs');
  assert.strictEqual(result.featureMapUpdated, true);
  assert.deepStrictEqual(result.gaps, []);
  const file = path.join(root, result.written);
  assert.strictEqual(spawnSync(process.execPath, ['--check', file]).status, 0, 'generated driver parses');
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /const EXPECT = null;/);
  assert.match(source, /next dev|npm run dev/);
  assert.strictEqual(loadFeatureMap(root)[0].driver, 'node .ai-engineering-loop/drivers/export-csv.mjs');
  assert.ok(fs.existsSync(path.join(root, '.ai-engineering-loop', 'drivers', 'export-csv.md')));
  assert.deepStrictEqual(scaffoldDriver(root), [], 'nothing left without a driver');
});

test('C-43 a repo with no runner gets a launch driver that names the gap and fails until EXPECT is set', () => {
  const root = project({ rows: ['| settings | Settings page | src/settings/** | open /settings | |'] });
  const [result] = scaffoldDriver(root);
  assert.strictEqual(result.surface, 'launch');
  assert.deepStrictEqual(result.gaps, ['start command', 'browser or API runner']);
  const readme = fs.readFileSync(path.join(root, '.ai-engineering-loop', 'drivers', 'settings.md'), 'utf8');
  assert.match(readme, /No start command found/);
  assert.match(readme, /Add Playwright/);
  const run = spawnSync(process.execPath, [path.join(root, result.written)], { cwd: root, env: { ...process.env, AEL_BASE_URL: 'http://127.0.0.1:9' }, encoding: 'utf8', timeout: 20000 });
  assert.notStrictEqual(run.status, 0, 'unfilled driver never passes');
});

test('C-43 API rows get an api driver; an edited driver is never overwritten', () => {
  const root = project({ pkg: { scripts: { start: 'node server.js' } }, rows: ['| refund | POST /api/refunds | src/refunds/** | call the endpoint | |'] });
  const [first] = scaffoldDriver(root, { feature: 'refund' });
  assert.strictEqual(first.surface, 'api');
  const file = path.join(root, first.file);
  assert.strictEqual(spawnSync(process.execPath, ['--check', file]).status, 0);
  fs.appendFileSync(file, '\n// my edit\n');
  const [again] = scaffoldDriver(root, { feature: 'refund' });
  assert.strictEqual(again.written, `${first.file}.ael-new`);
  assert.match(fs.readFileSync(file, 'utf8'), /my edit/);
  assert.throws(() => scaffoldDriver(root, { feature: 'nope' }), /No feature "nope"/);
  assert.throws(() => scaffoldDriver(root, { surface: 'desktop' }), /--surface/);
});

test('C-43 doctor warns about a driver command whose file is missing; the CLI scaffolds as JSON', () => {
  const root = project({ rows: ['| export | Reports | src/** | click Export | `node .ai-engineering-loop/drivers/export.mjs` |'] });
  assert.deepStrictEqual(driverProblems(root), [{ feature: 'export', problem: 'driver file .ai-engineering-loop/drivers/export.mjs is missing' }]);
  const items = auditHarness(root, { budget: false }).items || auditHarness(root, { budget: false });
  const flat = JSON.stringify(items);
  assert.match(flat, /feature-driver/);
  assert.match(flat, /driver scaffold --feature export/);
  const out = spawnSync(process.execPath, [CLI, 'driver', 'scaffold', '--feature', 'export', '--surface', 'cli', '--json'], { cwd: root, env: { ...process.env, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' }, encoding: 'utf8' });
  assert.strictEqual(out.status, 0, out.stdout + out.stderr);
  assert.strictEqual(JSON.parse(out.stdout).drivers[0].surface, 'cli');
  assert.deepStrictEqual(driverProblems(root), []);
  const bad = spawnSync(process.execPath, [CLI, 'driver', 'build', '--json'], { cwd: root, encoding: 'utf8' });
  assert.notStrictEqual(bad.status, 0);
});
