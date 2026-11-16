'use strict';

// Cards from "All Code Is Slop (Except Mine)": C-19 (learning confidence)
// and C-20 (built-in forbid-import / forbid-api rules).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { selectLearnings, confidenceOf } = require('../lib/learn.js');
const { checkRule, parseImportSpec } = require('../lib/rule-check.js');
const { promoteLearning, loadRules } = require('../lib/rules.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function learnings(root, entries) {
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'learnings.json'), JSON.stringify({ schemaVersion: 1, entries }));
}

const entry = (id, runIds, lesson) => ({ id, axis: 'spec', severity: 'HIGH', lesson, locations: ['src/a.js'], occurrences: runIds.length, runIds, lastRunId: runIds.at(-1) });

test('C-19 AC-1/AC-2 learnings carry confidence; a one-run lesson reads as "consider", never as a rule', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-conf-'));
  learnings(root, [
    entry('L-one', ['r1'], 'You must never call the API twice'),
    entry('L-two', ['r1', 'r2'], 'pagination off by one'),
    entry('L-three', ['r1', 'r2', 'r3'], 'missing null check')
  ]);
  const { learnings: picked } = selectLearnings(root, { files: ['src/a.js'], budgetTokens: 5000 });
  const byId = Object.fromEntries(picked.map((item) => [item.id, item]));
  assert.strictEqual(byId['L-one'].confidence, 'tentative');
  assert.match(byId['L-one'].lesson, /^Consider \(seen in 1 Run, not a rule\): /);
  assert.strictEqual(byId['L-two'].confidence, 'recurring');
  assert.strictEqual(byId['L-three'].confidence, 'rule-candidate');
  assert.match(byId['L-three'].lesson, /promote it to a rule/);
  assert.strictEqual(confidenceOf({ runIds: [] }), 'tentative');
});

const added = (file, line, text) => ({ file, line, text });

test('C-20 AC-1 forbid-import catches renderer -> main imports (relative and bare), with file:line', () => {
  const rule = { id: 'R-x', kind: 'forbid-import', spec: 'src/renderer/** -> src/main/**' };
  const lines = [
    added('src/renderer/App.tsx', 3, "import { store } from '../main/store';"),
    added('src/renderer/App.tsx', 4, "const ok = require('./local');"),
    added('src/main/index.ts', 1, "import { x } from './store';")
  ];
  const violations = checkRule(rule, lines);
  assert.deepStrictEqual(violations.map((v) => `${v.file}:${v.line}`), ['src/renderer/App.tsx:3']);
  assert.match(violations[0].message, /imports "\.\.\/main\/store"/);
  const fsRule = { id: 'R-fs', kind: 'forbid-import', spec: 'src/renderer/** -> fs' };
  assert.strictEqual(checkRule(fsRule, [added('src/renderer/a.ts', 1, "import fs from 'fs';")]).length, 1);
  assert.throws(() => parseImportSpec('src/renderer/**'), /needs "<fromGlob> -> <toGlob>"/);
});

test('C-20 AC-2 forbid-api passes inside the excepted folder and fails outside it', () => {
  const rule = { id: 'R-e', kind: 'forbid-api', pattern: '\\buseEffect\\(', except: 'src/framework/**' };
  assert.deepStrictEqual(checkRule(rule, [added('src/framework/hooks.ts', 9, 'useEffect(() => {}, []);')]), []);
  const bad = checkRule(rule, [added('src/features/list.tsx', 12, '  useEffect(() => load(), []);')]);
  assert.deepStrictEqual(bad.map((v) => `${v.file}:${v.line}`), ['src/features/list.tsx:12']);
});

test('C-20 promote stores a built-in rule as a diff-scoped check and verify runs it end to end', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-forbid-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-forbid-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'src/renderer'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src/main'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src/main/store.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(repo, 'src/renderer/app.js'), 'module.exports = 1;\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop/verification.md'), '# V\n- **test_unit**: `node --version`\n');
  learnings(repo, [entry('L-b1', ['a', 'b', 'c'], 'renderer imported main')]);
  assert.throws(() => promoteLearning(repo, 'L-b1', { forbidImport: 'a -> b', forbidApi: 'x', fix: 'f', by: 'h' }), /one of --forbid-import or --forbid-api/);
  const promote = cli('learn', 'promote', 'L-b1', '--forbid-import', 'src/renderer/** -> src/main/**', '--fix', 'Go through src/preload/bridge.js', '--by', 'ega', '--json');
  assert.strictEqual(promote.status, 0, promote.stdout + promote.stderr);
  const rule = loadRules(repo).rules[0];
  assert.deepStrictEqual([rule.kind, rule.scope, rule.spec], ['forbid-import', 'diff', 'src/renderer/** -> src/main/**']);
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx', '--allow-empty');
  const run = JSON.parse(cli('run', '--json', 'Change the renderer').stdout);
  const runDir = path.join(repo, '.ai-engineering-loop/runs', run.runId);
  fs.writeFileSync(path.join(runDir, 'goal-contract.json'), JSON.stringify({
    schemaVersion: 1, runId: run.runId, objective: 'r',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'x', evidenceRequired: 'y', failureCases: ['z'] }]
  }));
  assert.strictEqual(cli('gate', 'goal', '--run', run.runId).status, 0);
  fs.writeFileSync(path.join(repo, 'src/renderer/app.js'), "const store = require('../main/store');\nmodule.exports = store;\n");
  assert.strictEqual(cli('gate', 'maker', '--from-git', '--run', run.runId).status, 0);
  const bad = cli('verify', '--run', run.runId);
  assert.strictEqual(bad.status, 1, bad.stdout);
  assert.match(bad.stdout, /Rule R-b1 violated.*FIX: Go through src\/preload\/bridge\.js/);
});

// C-23: verification catalog.
const { VERIFICATION_CATALOG, DEFAULT_PLAN_KEYS, defaultCommandPlan, keyOfCommand } = require('../lib/verification-lanes.js');
const { acStatuses, requiredKeys } = require('../lib/ac-status.js');
const { parseLayerCell } = require('../lib/claimed-vs-reality.js');

test('C-23 AC-1 the catalog maps every pre-production technique to a layer; only cheap ones are in the default plan', () => {
  for (const key of ['security', 'property', 'fuzz', 'mutation', 'coverage', 'benchmark', 'contract', 'pentest', 'formal']) {
    assert.ok(VERIFICATION_CATALOG[key], key);
  }
  assert.strictEqual(VERIFICATION_CATALOG.formal.layer, 'LF');
  assert.strictEqual(VERIFICATION_CATALOG.contract.layer, 'L3');
  assert.deepStrictEqual(DEFAULT_PLAN_KEYS, ['build', 'typecheck', 'lint', 'test_unit', 'property']);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-catalog-'));
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'));
  fs.writeFileSync(path.join(root, '.ai-engineering-loop/verification.md'),
    '- **test_unit**: `npm test`\n- **property**: `npm run test:prop`\n- **formal**: `tlc spec.tla`\n- **pentest**: `zap-baseline.py -t http://localhost:3000`\n');
  assert.deepStrictEqual(defaultCommandPlan(root).map((step) => `${step.key}:${step.layer}`), ['test_unit:L2', 'property:L2']);
  assert.strictEqual(keyOfCommand(root, 'tlc spec.tla'), 'formal');
  assert.strictEqual(parseLayerCell('L2+LF').layers.has('LF'), true);
});

test('C-23 AC-2 an AC requiring a key or layer is proven only by a passing record of that kind', () => {
  const goal = { acceptanceCriteria: [
    { id: 'AC-1', verify: { key: 'pentest' } },
    { id: 'AC-2', verify: { layer: 'LF' } },
    { id: 'AC-3', verify: { key: 'contract' } }
  ] };
  const records = [
    { command: 'zap', key: 'pentest', layer: 'L3', exitCode: 0, timeoutStatus: 'COMPLETED' },
    { command: 'npm test', key: 'test_unit', layer: 'L2', exitCode: 0, timeoutStatus: 'COMPLETED' },
    { command: 'tlc spec.tla', key: 'formal', layer: 'LF', exitCode: 1, timeoutStatus: 'COMPLETED' }
  ];
  assert.deepStrictEqual(acStatuses(goal, records).map((ac) => [ac.id, ac.status]), [['AC-1', 'proven'], ['AC-2', 'failed'], ['AC-3', 'pending']]);
  assert.deepStrictEqual(requiredKeys(goal), ['pentest', 'contract']);
});

// C-22: feature map.
const { parseFeatureMap, featuresForFiles, renderForPack } = require('../lib/feature-map.js');
const { auditHarness } = require('../lib/harness-audit.js');

const MAP = [
  '# Feature map',
  '',
  '| Feature | Where | Paths | How to reach | Driver |',
  '|---|---|---|---|---|',
  '| export-csv | Reports > Export button | src/reports/**, src/export/** | open Reports, click Export | `npm run drive -- export` |',
  '| login | /login page | src/auth/** | open /login | |'
].join('\n');

test('C-22 AC-1 the review pack gets the feature-map entries whose paths the diff touches', () => {
  const entries = parseFeatureMap(MAP);
  assert.deepStrictEqual(entries.map((e) => [e.id, e.paths.length, e.driver]), [['export-csv', 2, 'npm run drive -- export'], ['login', 1, null]]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-fmap-'));
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'));
  fs.writeFileSync(path.join(root, '.ai-engineering-loop/feature-map.md'), MAP);
  const touched = featuresForFiles(root, ['src/export/csv.js', 'README.md']);
  assert.deepStrictEqual(touched.map((e) => e.id), ['export-csv']);
  assert.match(renderForPack(touched), /export-csv: Reports > Export button\. Reach: open Reports, click Export\. Driver: `npm run drive -- export`/);
  assert.strictEqual(renderForPack([]), '');
});

test('C-22 AC-2 doctor --harness warns when e2e or smoke exists but the feature map is empty', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-fmap-doc-'));
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'));
  fs.writeFileSync(path.join(root, '.ai-engineering-loop/verification.md'), '- **e2e**: `npm run e2e`\n');
  assert.ok(auditHarness(root, { budget: false }).items.some((item) => item.id === 'feature-map'));
  fs.writeFileSync(path.join(root, '.ai-engineering-loop/feature-map.md'), MAP);
  assert.ok(!auditHarness(root, { budget: false }).items.some((item) => item.id === 'feature-map'));
});

// C-21: intended flow and artifact-first receipt.
const { flowProblems, flowWarnings, renderFlow } = require('../lib/flow.js');
const { validateGoalContract } = require('../lib/gates.js');

const FLOW = [
  { from: 'List', event: 'click Export', to: 'Exporting' },
  { from: 'Exporting', event: 'file ready', to: 'Done' },
  { from: 'Exporting', event: 'disk full', to: 'Stuck' }
];

test('C-21 AC-3 a Goal flow renders as a transition table and dead ends are flagged', () => {
  assert.strictEqual(renderFlow(FLOW).split('\n')[2], '| List | click Export | Exporting |');
  assert.deepStrictEqual(flowWarnings(FLOW), ['"Stuck" has no way out; mark it terminal (Done/Error) or add the next step']);
  assert.deepStrictEqual(flowProblems([{ from: 'A', to: 'B' }]), ['flow[0].event is required']);
  const contract = { objective: 'x', flow: [{ from: 'A' }], acceptanceCriteria: [{ id: 'AC-1', statement: 's', evidenceRequired: 'e', failureCases: ['f'] }] };
  assert.ok(validateGoalContract(contract).errors.some((e) => e.includes('flow[0].event')));
});

test('C-21 AC-1/AC-2 receipt lists artifacts first and marks a crossComponent AC without one as missing', () => {
  const { renderReceiptMarkdown } = require('../lib/receipt.js');
  const receipt = {
    runId: 'r1', goal: { version: 1, contentHash: 'abc', flow: FLOW }, base: { sha: 'b' }, head: { sha: 'h' }, digest: 'd',
    acceptanceCriteria: [
      { id: 'AC-1', statement: 'export', status: 'PASS', evidence: [{ type: 'link', kind: 'video', url: 'https://cdn.example/export.mp4' }] },
      { id: 'AC-2', statement: 'import', status: 'MISSING', missing: ['no verification artifact (video, screenshot or diagram); pass --evidence AC-2=<https-url>'], evidence: [] }
    ],
    review: { findings: { total: 0, valid: 0, blocking: 0 }, verdict: { verdict: 'PASS' } },
    guard: { block: 0, warn: 0 }
  };
  const md = renderReceiptMarkdown(receipt);
  assert.ok(md.indexOf('### Verification artifacts') < md.indexOf('### Intended flow'));
  assert.ok(md.indexOf('### Intended flow') < md.indexOf('### Acceptance criteria'));
  assert.match(md, /- \*\*AC-1\*\* video: \[video\]\(https:\/\/cdn\.example\/export\.mp4\)/);
  assert.match(md, /❌ \*\*AC-2\*\* import — \*\*missing:\*\* no verification artifact/);
});

test('C-21 AC-2 crossComponent and rubric ACs need an artifact link; others do not', () => {
  const { criterionEntry } = require('../lib/receipt.js');
  const passing = [{ type: 'command', passed: true }];
  const claims = [{ ac: 'AC-1', reality: 'npm run e2e exit 0' }, { ac: 'AC-2', reality: 'ok' }, { ac: 'AC-3', reality: 'ok' }];
  const cross = criterionEntry({ id: 'AC-1', statement: 's', crossComponent: true }, { commands: passing, claims, links: {} });
  assert.strictEqual(cross.status, 'MISSING');
  assert.match(cross.missing[0], /no verification artifact/);
  const withLink = criterionEntry({ id: 'AC-1', statement: 's', crossComponent: true }, { commands: passing, claims, links: { 'AC-1': ['https://cdn.example/a.png'] } });
  assert.strictEqual(withLink.status, 'PASS');
  assert.strictEqual(withLink.evidence.find((e) => e.type === 'link').kind, 'screenshot');
  assert.strictEqual(criterionEntry({ id: 'AC-2', statement: 's', rubric: [{ criterion: 'c', pass: 'p' }] }, { commands: passing, claims, links: {} }).status, 'MISSING');
  assert.strictEqual(criterionEntry({ id: 'AC-3', statement: 's' }, { commands: passing, claims, links: {} }).status, 'PASS');
});
