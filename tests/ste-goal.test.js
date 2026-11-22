'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { steFindings, goalReadability, renderHumanGoal } = require('../lib/ste.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

test('STE checks flag long, passive, vague and multi-action sentences, and pass plain ones', () => {
  assert.deepStrictEqual(steFindings('The export button saves a CSV file of the filtered rows.'), []);
  const rules = (text, kind) => steFindings(text, { kind }).map((item) => item.rule);
  assert.ok(rules('An empty name is rejected by the API.').includes('active-voice'));
  assert.ok(rules('The page should load fast and handle errors properly.').includes('precise-words'));
  assert.ok(rules('Open the report and then click export and then save the file.', 'instruction').includes('one-instruction'));
  assert.ok(rules(Array.from({ length: 30 }, () => 'word').join(' ') + '.').includes('length'));
  assert.ok(rules('Keeping the filter, the page reloads.').includes('no-ing-start'));
  assert.deepStrictEqual(steFindings('Run `npm test -- --grep "should handle things properly"` after the change.'), [], 'code is not checked');
});

test('the human Goal reads as plain sections and keeps every AC, proof and failure case', () => {
  const goal = {
    runId: 'r1', objective: 'Users export the filtered report as CSV.',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'Export saves only the filtered rows.', evidenceRequired: 'unit test output', failureCases: ['The CSV ignores the active filter.'] }],
    outOfScope: ['PDF export'],
    statements: [{ text: 'Exports stay under 10k rows', kind: 'assumption' }]
  };
  const md = renderHumanGoal(goal, { revision: 1 });
  assert.match(md, /^# Goal for Run r1 \(revision 1\)/);
  assert.match(md, /## What changes\n\nUsers export the filtered report as CSV\./);
  assert.match(md, /AC-1\. Export saves only the filtered rows\.\n {3}- Proof: unit test output\.\n {3}- Fail if: The CSV ignores the active filter\./);
  assert.match(md, /## Not in this change\n\n- PDF export/);
  assert.match(md, /## Not confirmed yet\n\n- Exports stay under 10k rows/);
  assert.doesNotMatch(md, /Writing checks/);
  assert.strictEqual(goalReadability(goal).length, 0);
});

test('goal draft writes goal.md and readability warnings; goal show --human prints it; JSON for agents is unchanged', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-ste-home-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-ste-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p","scripts":{"test":"node -e 0"}}\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  const out = cli('run', '--json', 'Add CSV export');
  const runId = JSON.parse(out.stdout.slice(out.stdout.search(/^\{/m))).runId;
  fs.mkdirSync(path.join(dir, '.ai-engineering-loop', 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ai-engineering-loop', 'drafts', 'goal.json'), JSON.stringify({
    schemaVersion: 1, runId, objective: 'The export should be fast and work properly.',
    restatement: RESTATE,
    acceptanceCriteria: [{ id: 'AC-1', statement: 'The filtered rows are exported by the button.', evidenceRequired: 'unit test', failureCases: ['CSV ignores the filter'] }]
  }));
  const draft = cli('goal', 'draft', '--json', '--run', runId, '--file', '.ai-engineering-loop/drafts/goal.json', '--revision', '0');
  assert.strictEqual(draft.status, 0, draft.stdout + draft.stderr);
  const body = JSON.parse(draft.stdout);
  assert.ok(body.result.contract.acceptanceCriteria, 'agent JSON still carries the contract');
  assert.strictEqual(body.human.path, `.ai-engineering-loop/runs/${runId}/goal.md`);
  const rules = body.readability.map((item) => `${item.field}:${item.rule}`);
  assert.ok(rules.includes('objective:precise-words'));
  assert.ok(rules.includes('AC-1.statement:active-voice'));
  const plain = cli('goal', 'draft', '--run', runId, '--file', '.ai-engineering-loop/drafts/goal.json', '--revision', '1');
  assert.strictEqual(plain.status, 0, plain.stdout + plain.stderr);
  assert.doesNotMatch(plain.stdout, /^\{/m, 'people get text by default, not JSON');
  assert.match(plain.stdout, /## Restate\n\nProblem: People cannot take the filtered rows out of the report\./);
  assert.match(plain.stdout, /## Done when/);
  assert.match(plain.stdout, /Agents: add --json/);
  const human = cli('goal', 'show', '--run', runId, '--human');
  assert.strictEqual(human.status, 0);
  assert.match(human.stdout, /## Done when/);
  assert.match(human.stdout, /## Writing checks \(STE style, not blocking\)/);
  assert.strictEqual(human.stdout, fs.readFileSync(path.join(dir, body.human.path), 'utf8'));
});

const RESTATE = {
  problem: 'People cannot take the filtered rows out of the report.',
  doneWhen: 'Export saves a CSV of only the filtered rows.',
  failIf: 'The CSV still contains rows the filter hid.',
  unknowns: 'None.'
};

test('goal.md opens with a Restate block of the problem, not a later acceptance section', () => {
  const md = renderHumanGoal({
    runId: 'r1',
    objective: 'Use PapaParse in src/export.js so users export the filtered report as CSV.',
    restatement: RESTATE,
    acceptanceCriteria: [{ id: 'AC-1', statement: 'Export saves only the filtered rows.', evidenceRequired: 'unit test output', failureCases: ['The CSV ignores the active filter.'] }]
  }, { revision: 1 });
  assert.match(md, /## Restate\n\nProblem: People cannot take the filtered rows out of the report\.\n\nDone when: Export saves a CSV of only the filtered rows\.\n\nFail if: The CSV still contains rows the filter hid\.\n\nUnknowns: None\./);
  const restate = md.slice(md.indexOf('## Restate'), md.indexOf('## What changes'));
  assert.doesNotMatch(restate, /PapaParse|src\/export\.js/);
  assert.ok(md.indexOf('## Restate') < md.indexOf('## Done when'));
});

test('the Goal schema requires a restatement with problem, doneWhen, failIf and unknowns', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'goal-contract.schema.json'), 'utf8'));
  assert.ok(schema.required.includes('restatement'));
  assert.deepStrictEqual(schema.properties.restatement.required, ['problem', 'doneWhen', 'failIf', 'unknowns']);
  const { restatementProblems } = require('../lib/gates.js');
  assert.deepStrictEqual(restatementProblems({}), ['restatement is required: problem, doneWhen, failIf, unknowns']);
  assert.ok(restatementProblems({ restatement: { ...RESTATE, failIf: '  ' } }).includes('restatement.failIf is required'));
  assert.deepStrictEqual(restatementProblems({ restatement: RESTATE }), []);
});

test('loop-goal tells the agent to restate the problem before acceptance criteria', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'skill-src', 'ael', 'references', 'loop-goal.md'), 'utf8');
  const restate = text.indexOf('restate the problem');
  const criteria = text.indexOf('AC is a failure table');
  assert.ok(restate !== -1 && restate < criteria, 'Restate comes before acceptance criteria');
  assert.match(text, /Leave the human's method out/);
  assert.match(text, /goal draft` refuses a missing restatement/);
});

test('goal draft refuses a missing or blank restatement', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-restate-home-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-restate-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p","scripts":{"test":"node -e 0"}}\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  const out = cli('run', '--json', 'Add CSV export');
  const runId = JSON.parse(out.stdout.slice(out.stdout.search(/^\{/m))).runId;
  fs.mkdirSync(path.join(dir, '.ai-engineering-loop', 'drafts'), { recursive: true });
  const file = path.join(dir, '.ai-engineering-loop', 'drafts', 'goal.json');
  const goal = {
    schemaVersion: 1,
    runId,
    objective: 'Export the filtered report as CSV.',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'Export saves only the filtered rows.', evidenceRequired: 'unit test', failureCases: ['The CSV ignores the filter.'] }]
  };
  fs.writeFileSync(file, JSON.stringify(goal));
  const missing = cli('goal', 'draft', '--json', '--run', runId, '--file', '.ai-engineering-loop/drafts/goal.json', '--revision', '0');
  assert.notStrictEqual(missing.status, 0);
  const body = JSON.parse(missing.stdout);
  assert.strictEqual(body.code, 'RESTATEMENT_MISSING');
  assert.match(body.error, /restatement/);
  assert.match(body.why, /method/);
  assert.match(body.fix, /goal draft/);
  fs.writeFileSync(file, JSON.stringify({ ...goal, restatement: { ...RESTATE, failIf: '   ' } }));
  const blank = cli('goal', 'draft', '--json', '--run', runId, '--file', '.ai-engineering-loop/drafts/goal.json', '--revision', '0');
  assert.strictEqual(JSON.parse(blank.stdout).code, 'RESTATEMENT_MISSING');
});

test('#154 adjectives that end in -ing are not flagged; real participle openings still are', () => {
  for (const text of ['missing id throws', 'missing id returns undefined', 'Existing rows stay unchanged.', 'Pending jobs keep their order.', 'Running the export twice keeps one file.']) {
    assert.ok(!steFindings(text).some((item) => item.rule === 'no-ing-start'), text);
  }
  for (const text of ['Keeping the filter, the page reloads.', 'Returning early, the API skips validation.']) {
    assert.ok(steFindings(text).some((item) => item.rule === 'no-ing-start'), text);
  }
});
