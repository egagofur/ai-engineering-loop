'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const { validateRecipe } = require('../lib/recipe.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

const PLAIN_DEFAULTS = Object.freeze({
  usualTier: 'T1',
  mode: 'ASSISTED',
  extraApproval: 'no',
  docsLight: 'no',
  makerIntern: 'none',
  headsUp: 'none',
  extraBeforeGrill: 'none',
  extraAfterFreeze: 'none',
  extraAfterPass: 'none'
});

// One row per backbone element. Remove and skip are separate rows where both
// are attacks on the same element (goal-contract, devil-advocate, judge).
const BACKBONE_ATTACKS = Object.freeze([
  {
    element: 'goal-contract',
    answers: { drop: ['goal-contract'] },
    code: 'BACKBONE_GOAL_CONTRACT_REQUIRED',
    detail: /goal-contract/
  },
  {
    element: 'goal-contract skip',
    answers: { conditionalSkip: ['goal-contract'] },
    code: 'BACKBONE_CONDITIONAL_SKIP',
    detail: /cannot conditionally skip/
  },
  {
    element: 'devil-advocate',
    answers: { drop: ['devil-advocate'] },
    code: 'BACKBONE_DEVIL_ADVOCATE_REQUIRED',
    detail: /devil-advocate/
  },
  {
    element: 'devil-advocate skip',
    answers: { conditionalSkip: ['devil-advocate'] },
    code: 'BACKBONE_CONDITIONAL_SKIP',
    detail: /cannot conditionally skip/
  },
  {
    element: 'judge',
    answers: { drop: ['judge'] },
    code: 'BACKBONE_JUDGE_REQUIRED',
    detail: /judge/
  },
  {
    element: 'judge skip',
    answers: { conditionalSkip: ['judge'] },
    code: 'BACKBONE_CONDITIONAL_SKIP',
    detail: /cannot conditionally skip/
  },
  {
    element: 'assisted-approval',
    answers: { removeAssistedApproval: 'yes' },
    code: 'BACKBONE_ASSISTED_APPROVAL_REQUIRED',
    detail: /approval/
  },
  {
    element: 't2-judge-model',
    answers: { judgeModel: 'CHEAP_MODEL' },
    code: 'BACKBONE_T2_JUDGE_MODEL',
    detail: /STRONG_MODEL/
  }
]);

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-pw-repo-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-pw-home-'));
  const aelHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-pw-ael-'));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    AEL_HOME: aelHome,
    AEL_NO_AUTO_UPDATE: '1',
    AEL_NO_SETUP_HINT: '1'
  };
  return { root, home, aelHome, env };
}

function cleanup(box) {
  fs.rmSync(box.root, { recursive: true, force: true });
  fs.rmSync(box.home, { recursive: true, force: true });
  fs.rmSync(box.aelHome, { recursive: true, force: true });
}

function cli(box, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: box.root,
    env: box.env,
    encoding: 'utf8'
  });
}

function parseOk(result, label) {
  assert.equal(result.status, 0, `${label}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function parseFail(result, label) {
  assert.notEqual(result.status, 0, label);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false, `${label}\n${result.stdout}`);
  return body;
}

function toPosix(rel) {
  return rel.split(path.sep).join('/');
}

function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      out.push(toPosix(path.relative(dir, abs)));
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(abs);
    }
  };
  walk(dir);
  return out.sort();
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function questionMap(body) {
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.questions));
  return new Map(body.questions.map((question) => [question.id, question]));
}

test('AC 2: workflow interview --json returns plain defaults when there is no history', () => {
  const box = sandbox();
  try {
    const help = cli(box, ['workflow', '--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /interview \[--json\]/);
    assert.match(help.stdout, /propose --answers <file>/);
    assert.match(help.stdout, /accept --proposal <id> --by <name>/);
    assert.match(help.stdout, /HUMAN_REQUIRED/);

    const before = {
      root: listFiles(box.root),
      home: listFiles(box.home),
      aelHome: listFiles(box.aelHome)
    };
    const body = parseOk(cli(box, ['workflow', 'interview', '--json']), 'interview');
    const questions = questionMap(body);
    assert.deepEqual([...questions.keys()], Object.keys(PLAIN_DEFAULTS));
    assert.equal(body.historyCount, 0);
    assert.equal(body.pendingProposal, null);
    for (const [id, fallback] of Object.entries(PLAIN_DEFAULTS)) {
      const question = questions.get(id);
      assert.equal(question.default, fallback, id);
      assert.equal(typeof question.prompt, 'string');
      assert.ok(question.prompt.length > 0, id);
      assert.ok(question.options.includes(fallback), id);
      assert.deepEqual(question.evidence.runIds, []);
      assert.deepEqual(question.evidence.counts, { total: 0 });
    }
    assert.deepEqual(listFiles(box.root), before.root);
    assert.deepEqual(listFiles(box.home), before.home);
    assert.deepEqual(listFiles(box.aelHome), before.aelHome);
  } finally {
    cleanup(box);
  }
});

test('AC 2: workflow interview --json cites run ids and counts for history-derived defaults', () => {
  const box = sandbox();
  try {
    const delivered = ['run-5', 'run-1', 'run-4', 'run-2', 'run-3'].map((runId) => ({
      schemaVersion: 1,
      runId,
      state: 'DELIVERED',
      mode: 'UNATTENDED',
      tier: 'T2',
      recipeId: 'default'
    }));
    const historyPath = path.join(box.aelHome, '.ai-engineering-loop', 'workflow-history.jsonl');
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    const lines = delivered.concat([{
      schemaVersion: 1,
      runId: 'run-cancelled',
      state: 'CANCELLED',
      mode: 'ASSISTED',
      tier: 'T0',
      recipeId: 'default'
    }]);
    fs.writeFileSync(historyPath, `${lines.map((row) => JSON.stringify(row)).join('\n')}\n`);
    const before = listFiles(box.aelHome);

    const body = parseOk(cli(box, ['workflow', 'interview', '--json']), 'interview history');
    const questions = questionMap(body);
    assert.equal(body.historyCount, 5);
    const expectedIds = ['run-1', 'run-2', 'run-3', 'run-4', 'run-5'];
    for (const id of ['usualTier', 'mode']) {
      const question = questions.get(id);
      const expected = id === 'usualTier' ? 'T2' : 'UNATTENDED';
      assert.equal(question.default, expected, id);
      assert.deepEqual(question.evidence.runIds, expectedIds);
      assert.equal(question.evidence.counts[expected], 5);
      assert.equal(question.evidence.counts.total, 5);
      assert.equal(question.evidence.runIds.includes('run-cancelled'), false);
    }
    const unchanged = questions.get('makerIntern');
    assert.equal(unchanged.default, 'none');
    assert.deepEqual(unchanged.evidence.runIds, []);
    assert.equal(unchanged.evidence.counts.total, 5);
    assert.deepEqual(listFiles(box.aelHome), before);
    assert.deepEqual(listFiles(box.root), []);
    assert.deepEqual(listFiles(box.home), []);
  } finally {
    cleanup(box);
  }
});

test('AC 3: workflow propose rejects backbone attacks with named errors', () => {
  const box = sandbox();
  const answersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-pw-attacks-'));
  try {
    const seen = new Set();
    for (const [index, row] of BACKBONE_ATTACKS.entries()) {
      seen.add(row.code);
      const answers = writeJson(path.join(answersDir, `answers-${index + 1}.json`), row.answers);
      const result = cli(box, ['workflow', 'propose', '--answers', answers, '--json']);
      const body = parseFail(result, row.element);
      assert.equal(body.code, row.code, `${row.element}\n${result.stdout}\n${result.stderr}`);
      assert.match(body.details.join('\n'), row.detail, row.element);
    }
    assert.deepEqual([...seen].sort(), [
      'BACKBONE_ASSISTED_APPROVAL_REQUIRED',
      'BACKBONE_CONDITIONAL_SKIP',
      'BACKBONE_DEVIL_ADVOCATE_REQUIRED',
      'BACKBONE_GOAL_CONTRACT_REQUIRED',
      'BACKBONE_JUDGE_REQUIRED',
      'BACKBONE_T2_JUDGE_MODEL'
    ]);
    assert.equal(fs.existsSync(path.join(box.aelHome, '.ai-engineering-loop', 'workflow-proposals')), false);
    assert.deepEqual(listFiles(box.home), []);
    assert.deepEqual(listFiles(box.root), []);
    assert.deepEqual(listFiles(box.aelHome), []);
  } finally {
    fs.rmSync(answersDir, { recursive: true, force: true });
    cleanup(box);
  }
});

test('AC 3: workflow propose compiles a personal recipe that passes validation', () => {
  const box = sandbox();
  try {
    const answers = writeJson(path.join(os.tmpdir(), `ael-pw-answers-${process.pid}.json`), {
      usualTier: 'T1',
      mode: 'ASSISTED',
      extraApproval: 'no',
      docsLight: 'no',
      makerIntern: 'none',
      headsUp: 'none'
    });
    try {
      const body = parseOk(cli(box, ['workflow', 'propose', '--answers', answers, '--json']), 'propose');
      assert.equal(body.ok, true);
      assert.equal(body.valid, true);
      assert.equal(body.status, 'pending');
      assert.match(body.id, /^pw-interview-[a-f0-9]{8}$/);
      const recordPath = path.join(box.aelHome, '.ai-engineering-loop', 'workflow-proposals', `${body.id}.json`);
      const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
      assert.equal(record.recipe.id, 'personal');
      const validation = validateRecipe(record.recipe);
      assert.equal(validation.valid, true, validation.errors.join('; '));
      assert.equal(listFiles(box.root).length, 0);
      assert.deepEqual(listFiles(box.home), []);
      const written = listFiles(box.aelHome);
      assert.ok(written.every((rel) => rel === '.ai-engineering-loop' || rel.startsWith('.ai-engineering-loop/')));
      assert.ok(written.includes(`.ai-engineering-loop/workflow-proposals/${body.id}.json`));
    } finally {
      fs.rmSync(answers, { force: true });
    }
  } finally {
    cleanup(box);
  }
});

test('AC 4: workflow accept requires --by, writes only under the AEL home, bumps version, and keeps history', async () => {
  const box = sandbox();
  const answersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-pw-answers-'));
  try {
    const firstAnswers = writeJson(path.join(answersDir, 'first.json'), {
      usualTier: 'T1',
      mode: 'ASSISTED',
      makerIntern: 'none'
    });
    const proposed = parseOk(cli(box, ['workflow', 'propose', '--answers', firstAnswers, '--json']), 'propose 1');
    const proposalFile = path.join(box.aelHome, '.ai-engineering-loop', 'workflow-proposals', `${proposed.id}.json`);
    assert.equal(JSON.parse(fs.readFileSync(proposalFile, 'utf8')).status, 'pending');

    const missingBy = parseFail(cli(box, ['workflow', 'accept', '--proposal', proposed.id, '--json']), 'missing --by');
    assert.equal(missingBy.code, 'INVALID_APPROVER');
    assert.equal(fs.existsSync(path.join(box.aelHome, '.ai-engineering-loop', 'workflow', 'personal.json')), false);

    const unattended = parseFail(cli(box, [
      'workflow', 'accept', '--proposal', proposed.id, '--by', 'ada', '--mode', 'unattended', '--json'
    ]), 'unattended');
    assert.equal(unattended.code, 'HUMAN_REQUIRED');
    assert.equal(JSON.parse(fs.readFileSync(proposalFile, 'utf8')).status, 'pending');
    assert.equal(fs.existsSync(path.join(box.aelHome, '.ai-engineering-loop', 'workflow', 'personal.json')), false);
    assert.equal(fs.existsSync(path.join(box.aelHome, '.ai-engineering-loop', 'config.json')), false);

    const accepted = parseOk(cli(box, [
      'workflow', 'accept', '--proposal', proposed.id, '--by', 'ada', '--json'
    ]), 'accept 1');
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.recipeId, 'personal');
    assert.equal(accepted.version, 1);
    assert.equal(accepted.replacedVersion, null);
    const personalPath = path.join(box.aelHome, '.ai-engineering-loop', 'workflow', 'personal.json');
    const firstRecipe = JSON.parse(fs.readFileSync(personalPath, 'utf8'));
    assert.equal(firstRecipe.id, 'personal');
    assert.equal(firstRecipe.version, 1);
    assert.match(firstRecipe.description, /maker_intern: none/);
    assert.equal(fs.existsSync(path.join(box.aelHome, '.ai-engineering-loop', 'workflow', '.history', '1.json')), false);
    const config = JSON.parse(fs.readFileSync(path.join(box.aelHome, '.ai-engineering-loop', 'config.json'), 'utf8'));
    assert.equal(config.defaultRecipe, 'personal');
    assert.equal(config.defaultRecipeAcceptedBy, 'ada');

    await new Promise((resolve) => setTimeout(resolve, 25));
    const secondAnswers = writeJson(path.join(answersDir, 'second.json'), {
      usualTier: 'T1',
      mode: 'ASSISTED',
      makerIntern: 'local-intern'
    });
    const proposedAgain = parseOk(cli(box, ['workflow', 'propose', '--answers', secondAnswers, '--json']), 'propose 2');
    assert.notEqual(proposedAgain.id, proposed.id);
    const bumped = parseOk(cli(box, [
      'workflow', 'accept', '--proposal', proposedAgain.id, '--by', 'ada', '--json'
    ]), 'accept 2');
    assert.equal(bumped.version, 2);
    assert.equal(bumped.replacedVersion, 1);
    const personal = JSON.parse(fs.readFileSync(personalPath, 'utf8'));
    const archived = JSON.parse(fs.readFileSync(
      path.join(box.aelHome, '.ai-engineering-loop', 'workflow', '.history', '1.json'),
      'utf8'
    ));
    assert.equal(personal.version, 2);
    assert.match(personal.description, /maker_intern: local-intern/);
    assert.equal(archived.version, 1);
    assert.match(archived.description, /maker_intern: none/);
    assert.equal(personalPath.startsWith(box.aelHome), true);
    assert.equal(personalPath.includes(box.root), false);

    const files = listFiles(box.aelHome);
    assert.deepEqual(files.filter((rel) => !rel.startsWith('.ai-engineering-loop/workflow-proposals')), [
      '.ai-engineering-loop',
      '.ai-engineering-loop/config.json',
      '.ai-engineering-loop/workflow',
      '.ai-engineering-loop/workflow/.history',
      '.ai-engineering-loop/workflow/.history/1.json',
      '.ai-engineering-loop/workflow/personal.json'
    ]);
    assert.deepEqual(
      files.filter((rel) => rel.startsWith('.ai-engineering-loop/workflow-proposals/')),
      [
        `.ai-engineering-loop/workflow-proposals/${proposed.id}.json`,
        `.ai-engineering-loop/workflow-proposals/${proposedAgain.id}.json`
      ].sort()
    );
    assert.equal(files.some((rel) => rel.includes('workflow-history')), false);
    assert.deepEqual(listFiles(box.root), []);
    assert.deepEqual(listFiles(box.home), []);
    const stored = JSON.stringify(personal) + JSON.stringify(archived);
    assert.equal(stored.includes(box.root), false);
    assert.equal(stored.includes(box.home), false);
  } finally {
    fs.rmSync(answersDir, { recursive: true, force: true });
    cleanup(box);
  }
});
