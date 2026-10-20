'use strict';

const { ACTOR_ID } = require('./fsutil.js');
const { createLedger } = require('./jsonl-ledger.js');
const { sha256 } = require('./recipe.js');
const { redactSecrets } = require('./safe-context.js');

const MAX_INTERACTIONS = 500;
const MAX_MESSAGE_LENGTH = 8000;
const QUESTION_ID = /^q-[a-f0-9]{12}$/;

function interactionError(message, code = 'RUN_INTERACTION_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

const ledger = createLedger({
  fileName: 'interactions.jsonl',
  maxBytes: 2 * 1024 * 1024,
  types: new Set(['QUESTION', 'ANSWER']),
  codes: { invalid: 'INVALID_RUN_INTERACTIONS', busy: 'RUN_INTERACTION_BUSY' },
  messages: {
    bounded: 'Run interactions must be a bounded regular file',
    event: 'Run interaction',
    busy: 'Another interaction update is in progress'
  }
});

function readLedger(rootDir, runId) {
  return ledger.read(rootDir, runId);
}

function normalizedMessage(value) {
  const message = redactSecrets(String(value || '').trim()).text;
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    throw interactionError(`Message must be 1-${MAX_MESSAGE_LENGTH} characters`, 'INVALID_INTERACTION_MESSAGE');
  }
  return message;
}

function normalizedActor(value) {
  const actor = String(value || '').trim();
  if (!ACTOR_ID.test(actor)) {
    throw interactionError('Actor must be a short account identifier', 'INVALID_INTERACTION_ACTOR');
  }
  return actor;
}

function append(rootDir, runId, partial, now) {
  const events = readLedger(rootDir, runId);
  if (events.length >= MAX_INTERACTIONS) {
    throw interactionError('Run interaction limit reached', 'RUN_INTERACTION_LIMIT');
  }
  return ledger.append(rootDir, runId, events, partial, now);
}

function appendRunQuestion(rootDir, runId, { message, actor = 'agent' } = {}, { now = new Date() } = {}) {
  return ledger.withLock(rootDir, runId, () => {
    const events = readLedger(rootDir, runId);
    const number = events.filter((event) => event.type === 'QUESTION').length + 1;
    const cleanMessage = normalizedMessage(message);
    const cleanActor = normalizedActor(actor);
    if (events.some((event) =>
      event.type === 'QUESTION' && event.message === cleanMessage && event.actor === cleanActor &&
      !events.some((answer) => answer.type === 'ANSWER' && answer.questionId === event.questionId)
    )) {
      throw interactionError('An identical question is already waiting for an answer', 'DUPLICATE_QUESTION');
    }
    const questionId = `q-${sha256({ runId, number, message: cleanMessage, at: now.toISOString() }).slice(0, 12)}`;
    return append(rootDir, runId, {
      type: 'QUESTION',
      questionId,
      number,
      message: cleanMessage,
      actor: cleanActor
    }, now);
  });
}

function appendRunAnswer(
  rootDir,
  runId,
  questionId,
  { message, actor = 'human' } = {},
  { now = new Date() } = {}
) {
  return ledger.withLock(rootDir, runId, () => {
    if (!QUESTION_ID.test(String(questionId))) {
      throw interactionError('Question ID is invalid', 'INVALID_QUESTION_ID');
    }
    const events = readLedger(rootDir, runId);
    if (!events.some((event) => event.type === 'QUESTION' && event.questionId === questionId)) {
      throw interactionError(`Question ${questionId} does not exist`, 'QUESTION_NOT_FOUND');
    }
    if (events.some((event) => event.type === 'ANSWER' && event.questionId === questionId)) {
      throw interactionError(`Question ${questionId} is already answered`, 'QUESTION_ALREADY_ANSWERED');
    }
    return append(rootDir, runId, {
      type: 'ANSWER',
      questionId,
      message: normalizedMessage(message),
      actor: normalizedActor(actor)
    }, now);
  });
}

function listRunInteractions(rootDir, runId) {
  const interactions = readLedger(rootDir, runId);
  const answers = new Map(
    interactions.filter((event) => event.type === 'ANSWER').map((event) => [event.questionId, event])
  );
  const questions = interactions.filter((event) => event.type === 'QUESTION')
    .map((question) => ({ ...question, answer: answers.get(question.questionId) || null }));
  return {
    runId,
    interactions,
    questions,
    pending: questions.filter((question) => !question.answer)
  };
}

module.exports = {
  MAX_INTERACTIONS,
  MAX_MESSAGE_LENGTH,
  appendRunAnswer,
  appendRunQuestion,
  listRunInteractions
};
