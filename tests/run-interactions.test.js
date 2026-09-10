'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createRun } = require('../lib/run-state.js');
const {
  appendRunAnswer,
  appendRunQuestion,
  listRunInteractions
} = require('../lib/run-interactions.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-interactions-'));
  const run = createRun(root, {
    runId: '20260910T190000Z-aabbccdd',
    task: 'Build a safer canvas',
    now: new Date('2026-09-10T19:00:00Z')
  });
  return { root, run };
}

test('Run interactions preserve ordered, attributed, redacted questions and answers', () => {
  const { root, run } = fixture();
  const question = appendRunQuestion(root, run.runId, {
    message: 'Q1: use token ghp_abcdefghijklmnop?',
    actor: 'maker'
  }, { now: new Date('2026-09-10T19:01:00Z') });
  assert.equal(question.number, 1);
  assert.doesNotMatch(question.message, /ghp_abc/);

  const answer = appendRunAnswer(root, run.runId, question.questionId, {
    message: 'Use the local adapter.',
    actor: 'studio-user'
  }, { now: new Date('2026-09-10T19:02:00Z') });
  assert.equal(answer.type, 'ANSWER');
  const listed = listRunInteractions(root, run.runId);
  assert.equal(listed.interactions.length, 2);
  assert.equal(listed.questions[0].answer.message, 'Use the local adapter.');
  assert.equal(listed.pending.length, 0);
});

test('Run interactions reject duplicate answers and a tampered ledger', () => {
  const { root, run } = fixture();
  const question = appendRunQuestion(root, run.runId, { message: 'Q1?', actor: 'agent' });
  assert.throws(
    () => appendRunQuestion(root, run.runId, { message: 'Q1?', actor: 'agent' }),
    { code: 'DUPLICATE_QUESTION' }
  );
  appendRunAnswer(root, run.runId, question.questionId, { message: 'A1', actor: 'human' });
  assert.throws(
    () => appendRunAnswer(root, run.runId, question.questionId, { message: 'A2', actor: 'human' }),
    { code: 'QUESTION_ALREADY_ANSWERED' }
  );

  const file = path.join(root, '.ai-engineering-loop', 'runs', run.runId, 'interactions.jsonl');
  fs.appendFileSync(file, '{"invalid":true}\n');
  assert.throws(() => listRunInteractions(root, run.runId), { code: 'INVALID_RUN_INTERACTIONS' });
});

