'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { loadFeatureMap, scaffoldFeatureMap } = require('../lib/feature-map.js');
const { auditHarness } = require('../lib/harness-audit.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function rootDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-fmap-')));
}

function write(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

test('feature-map scaffold drafts routes, what they do, and how a user reaches them', () => {
  const root = rootDir();
  write(root, 'src/api.js', "const app = { get() {}, post() {} };\napp.get('/health', health);\napp.post('/api/refunds', refund);\n");
  write(root, 'node_modules/pkg/index.js', "app.get('/secret', secret);\n");
  const result = scaffoldFeatureMap(root);
  assert.strictEqual(result.source, 'routes');
  assert.deepStrictEqual(result.signals, ['routes']);
  assert.strictEqual(result.written, '.ai-engineering-loop/feature-map.md');
  assert.strictEqual(result.preserved, false);
  const entries = loadFeatureMap(root);
  assert.deepStrictEqual(entries.map((entry) => entry.id), ['api-refunds', 'health']);
  const refunds = entries.find((entry) => entry.id === 'api-refunds');
  assert.strictEqual(refunds.where, 'POST /api/refunds');
  assert.strictEqual(refunds.how, 'call POST /api/refunds');
  assert.deepStrictEqual(refunds.paths, ['src/api.js']);
  assert.strictEqual(refunds.driver, null);
  assert.ok(!entries.some((entry) => entry.id === 'secret' || entry.where.includes('/secret')));
});

test('feature-map scaffold reads OpenAPI summaries and prefers the implementing file', () => {
  const root = rootDir();
  write(root, 'openapi.json', JSON.stringify({
    openapi: '3.0.0',
    paths: {
      '/pets/{id}': { get: { summary: 'Show a pet' } },
      '/pets': { get: { summary: 'List pets' }, post: { operationId: 'createPet' } }
    }
  }));
  write(root, 'docs/openapi.yaml', [
    'openapi: 3.0.0',
    'paths:',
    '  /yards:',
    '    get:',
    '      summary: List yards',
    'components:',
    '  schemas: {}',
    ''
  ].join('\n'));
  write(root, 'src/pets.js', "app.get('/pets/:id', show);\n");
  const result = scaffoldFeatureMap(root);
  assert.strictEqual(result.source, 'mixed');
  assert.deepStrictEqual(result.signals, ['openapi', 'routes']);
  const entries = loadFeatureMap(root);
  const show = entries.find((entry) => entry.where.startsWith('GET /pets/:id'));
  assert.strictEqual(show.where, 'GET /pets/:id — Show a pet');
  assert.strictEqual(show.how, 'call GET /pets/:id');
  assert.deepStrictEqual(show.paths, ['src/pets.js']);
  assert.ok(entries.some((entry) => entry.where === 'GET /pets — List pets' && entry.how === 'call GET /pets'));
  assert.ok(entries.some((entry) => entry.where === 'POST /pets — createPet'));
  assert.ok(entries.some((entry) => entry.where === 'GET /yards — List yards' && entry.paths[0] === 'docs/openapi.yaml'));
});

test('feature-map scaffold drafts pages and Next route handlers', () => {
  const root = rootDir();
  write(root, 'src/app/(shop)/settings/page.tsx', 'export default function Page() { return null; }\n');
  write(root, 'src/app/api/refunds/route.ts', 'export async function POST() { return new Response(); }\n');
  write(root, 'pages/api/health.js', 'module.exports = (req, res) => res.end("ok");\n');
  write(root, 'src/routes/about/+page.svelte', '<h1>About</h1>\n');
  const result = scaffoldFeatureMap(root);
  assert.strictEqual(result.source, 'mixed');
  assert.deepStrictEqual(result.signals, ['routes', 'pages']);
  const entries = loadFeatureMap(root);
  const settings = entries.find((entry) => entry.id === 'settings');
  assert.strictEqual(settings.where, 'page /settings');
  assert.strictEqual(settings.how, 'open /settings');
  assert.deepStrictEqual(settings.paths, ['src/app/(shop)/settings/page.tsx']);
  assert.ok(entries.some((entry) => entry.where === 'POST /api/refunds' && entry.paths[0] === 'src/app/api/refunds/route.ts'));
  assert.ok(entries.some((entry) => entry.where === 'GET /api/health' && entry.how === 'call GET /api/health'));
  assert.ok(entries.some((entry) => entry.where === 'page /about' && entry.how === 'open /about'));
});

test('feature-map scaffold reads feature and usage bullets and prefers a matching src directory', () => {
  const root = rootDir();
  write(root, 'README.md', '# widget-api\n\n## Features\n\n- list inventory\n- add widget\n\n## Usage\n\n- filter by keyword\n');
  write(root, 'src/inventory/index.js', 'module.exports = {};\n');
  write(root, 'src/lib/util.js', 'module.exports = {};\n');
  const result = scaffoldFeatureMap(root);
  const entries = loadFeatureMap(root);
  const inventory = entries.find((entry) => entry.id === 'list-inventory');
  assert.ok(inventory, entries.map((entry) => entry.id).join(','));
  assert.deepStrictEqual(inventory.paths, ['src/inventory/**']);
  assert.ok(entries.some((entry) => entry.id === 'add-widget' && entry.paths[0] === 'README.md'));
  assert.ok(entries.some((entry) => entry.id === 'filter-by-keyword'));
  assert.ok(entries.every((entry) => entry.id !== 'lib'));
  assert.ok(result.rows >= 3);
  assert.ok(result.signals.includes('readme'));
});

test('feature-map scaffold reads package.json bin and scripts, and src directories', () => {
  const root = rootDir();
  write(root, 'package.json', JSON.stringify({
    name: 'widget-api',
    bin: { 'widget-api': 'bin/widget.js' },
    scripts: { test: 'node -e 0', 'seed-demo': 'node seed.js' }
  }));
  const fromPackage = scaffoldFeatureMap(root);
  const packaged = loadFeatureMap(root);
  assert.strictEqual(fromPackage.source, 'package');
  assert.ok(packaged.some((entry) => entry.id === 'widget-api' && entry.paths[0] === 'bin/widget.js' && entry.how === 'run widget-api'));
  assert.ok(packaged.some((entry) => entry.id === 'seed-demo' && entry.how === 'npm run seed-demo'));
  assert.ok(packaged.every((entry) => entry.id !== 'test'));

  const dirs = rootDir();
  write(dirs, 'src/widgets/index.js', 'module.exports = {};\n');
  write(dirs, 'src/lib/util.js', 'module.exports = {};\n');
  const fromSrc = scaffoldFeatureMap(dirs);
  assert.strictEqual(fromSrc.source, 'src');
  assert.deepStrictEqual(loadFeatureMap(dirs).map((entry) => entry.id), ['widgets']);
  assert.deepStrictEqual(loadFeatureMap(dirs)[0].paths, ['src/widgets/**']);
});

test('feature-map scaffold uses README headings only when nothing else describes a feature', () => {
  const root = rootDir();
  write(root, 'README.md', '# Demo\n\n## Installation\n\nnpm install\n\n## Export CSV\n\nDownload the report.\n\n## License\n\nMIT\n');
  const result = scaffoldFeatureMap(root);
  assert.strictEqual(result.source, 'readme');
  const [entry] = loadFeatureMap(root);
  assert.strictEqual(entry.id, 'export-csv');
  assert.strictEqual(entry.where, 'Export CSV');
  assert.strictEqual(entry.how, 'read the README section "Export CSV"');
  assert.deepStrictEqual(entry.paths, ['README.md']);
  write(root, 'src/api.js', "app.get('/health', health);\n");
  fs.rmSync(path.join(root, '.ai-engineering-loop', 'feature-map.md'));
  const withRoute = scaffoldFeatureMap(root);
  assert.deepStrictEqual(withRoute.signals, ['routes']);
  assert.ok(loadFeatureMap(root).every((entry) => entry.id !== 'export-csv'));
});

test('feature-map scaffold writes a stub table when the repo has no signal, and an edited map is kept', () => {
  const root = rootDir();
  write(root, '.ai-engineering-loop/verification.md', '- **e2e**: `npm run e2e`\n');
  const stub = scaffoldFeatureMap(root);
  assert.strictEqual(stub.source, 'stub');
  assert.strictEqual(stub.rows, 0);
  assert.deepStrictEqual(loadFeatureMap(root), []);
  const text = fs.readFileSync(path.join(root, '.ai-engineering-loop', 'feature-map.md'), 'utf8');
  assert.match(text, /\| Feature \| Where \(UI or endpoint\) \| Paths \| How to reach \| Driver \|/);
  assert.match(text, /no routes, OpenAPI document, pages, or README feature headings/);
  const items = auditHarness(root, { budget: false }).items;
  assert.ok(items.some((item) => item.id === 'feature-map' && /feature-map scaffold/.test(item.detail)));
  assert.ok(!items.some((item) => item.id === 'feature-map-drift'));
  const again = scaffoldFeatureMap(root);
  assert.strictEqual(again.written, null);
  assert.ok(!fs.existsSync(path.join(root, '.ai-engineering-loop', 'feature-map.md.ael-new')));
  fs.appendFileSync(path.join(root, '.ai-engineering-loop', 'feature-map.md'), '\n<!-- mine -->\n');
  const edited = scaffoldFeatureMap(root);
  assert.strictEqual(edited.preserved, true);
  assert.strictEqual(edited.written, '.ai-engineering-loop/feature-map.md.ael-new');
  assert.match(fs.readFileSync(path.join(root, '.ai-engineering-loop', 'feature-map.md'), 'utf8'), /mine/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, edited.written), 'utf8'), /mine/);
});

test('doctor --harness drift stays quiet for scaffolded paths that are tracked', () => {
  const root = rootDir();
  execFileSync('git', ['init', '-q'], { cwd: root });
  write(root, 'src/api.js', "app.get('/health', health);\n");
  execFileSync('git', ['add', 'src/api.js'], { cwd: root });
  scaffoldFeatureMap(root);
  const drift = auditHarness(root, { budget: false }).items.filter((item) => item.id === 'feature-map-drift');
  assert.deepStrictEqual(drift, []);
  const map = path.join(root, '.ai-engineering-loop', 'feature-map.md');
  fs.writeFileSync(map, fs.readFileSync(map, 'utf8').replace('src/api.js', 'src/missing/**'));
  const flagged = auditHarness(root, { budget: false }).items.filter((item) => item.id === 'feature-map-drift');
  assert.strictEqual(flagged.length, 1);
  assert.match(flagged[0].detail, /src\/missing\/\*\*/);
});

test('feature-map scaffold CLI writes JSON and refuses an unknown subcommand', () => {
  const root = rootDir();
  write(root, 'README.md', '## Export CSV\n\nDownload.\n');
  const env = { ...process.env, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const out = spawnSync(process.execPath, [CLI, 'feature-map', 'scaffold', '--json'], { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(out.status, 0, out.stdout + out.stderr);
  const body = JSON.parse(out.stdout);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.source, 'readme');
  assert.strictEqual(body.rows, 1);
  const bad = spawnSync(process.execPath, [CLI, 'feature-map', 'build', '--json'], { cwd: root, env, encoding: 'utf8' });
  assert.notStrictEqual(bad.status, 0);
  assert.match(bad.stdout + bad.stderr, /Unknown argument/);
  assert.ok(!fs.existsSync(path.join(root, '.ai-engineering-loop', 'feature-map.md.ael-new')));
});

test('next reads the feature map and its missing-list FIX is valid JSON', () => {
  const root = rootDir();
  write(root, 'README.md', '# widget-api\n\n## Features\n\n- list inventory\n');
  assert.strictEqual(scaffoldFeatureMap(root).rows, 1);
  const env = { ...process.env, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const next = spawnSync(process.execPath, [CLI, 'next', '--json'], { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(next.status, 0, next.stdout + next.stderr);
  const body = JSON.parse(next.stdout);
  assert.strictEqual(body.next.id, 'list-inventory');
  assert.ok(!fs.existsSync(path.join(root, '.ai-engineering-loop/features.json')));
  const empty = rootDir();
  const missing = spawnSync(process.execPath, [CLI, 'next', '--json'], { cwd: empty, env, encoding: 'utf8' });
  assert.notStrictEqual(missing.status, 0);
  const error = JSON.parse(missing.stdout);
  assert.strictEqual(error.code, 'NO_FEATURES');
  assert.match(error.fix, /feature-map scaffold/);
  const example = error.error.slice(error.error.indexOf('{'));
  const parsed = JSON.parse(example);
  assert.strictEqual(parsed.schemaVersion, 1);
  assert.strictEqual(parsed.features[0].status, 'not_started');
  assert.ok(Array.isArray(parsed.features[0].dependsOn));
  const { FEATURES_EXAMPLE } = require('../lib/features.js');
  assert.deepStrictEqual(JSON.parse(FEATURES_EXAMPLE), parsed);
});

test('init offers feature-map scaffold and does not write the map', () => {
  const root = rootDir();
  write(root, 'package.json', '{"name":"app"}\n');
  const env = { ...process.env, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const out = spawnSync(process.execPath, [CLI, 'init'], { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Optional next step: `ael feature-map scaffold`/);
  assert.ok(!fs.existsSync(path.join(root, '.ai-engineering-loop', 'feature-map.md')));
});

test('project onboarding offers feature-map scaffold and does not require it', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'adapters', 'project-onboarding', 'SKILL.md'), 'utf8');
  assert.match(skill, /feature-map scaffold/);
  assert.match(skill, /only after the user says yes/);
  assert.match(skill, /Do not run `feature-map scaffold` unless the user asks/);
});
