'use strict';

const fs = require('fs');
const path = require('path');
const { sha256 } = require('./recipe.js');
const { assertRunId, loadRun, runsDir } = require('./run-state.js');
const { redactSecrets } = require('./safe-context.js');

const MAX_INTERACTIONS = 500;
const MAX_MESSAGE_LENGTH = 8000;
const ACTOR_ID = /^[A-Za-z0-9@._-]{1,64}$/;
const QUESTION_ID = /^q-[a-f0-9]{12}$/;
const LOCK_STALE_MS = 60_000;

function interactionError(message, code = 'RUN_INTERACTION_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function ledgerPath(rootDir, runId) {
  assertRunId(runId);
  loadRun(rootDir, runId);
  return path.join(runsDir(rootDir), runId, 'interactions.jsonl');
}

function withInteractionLock(rootDir, runId, operation) {
  const lock = `${ledgerPath(rootDir, runId)}.lock`;
  let descriptor;
  try {
    try {
      descriptor = fs.openSync(lock, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = fs.lstatSync(lock);
      if (stat.isSymbolicLink() || !stat.isFile() || Date.now() - stat.mtimeMs <= LOCK_STALE_MS) {
        throw interactionError('Another interaction update is in progress', 'RUN_INTERACTION_BUSY');
      }
      fs.unlinkSync(lock);
      descriptor = fs.openSync(lock, 'wx', 0o600);
    }
    return operation();
  } finally {
    if (descriptor != null) {
      fs.closeSync(descriptor);
      try { fs.unlinkSync(lock); } catch {}
    }
  }
}

function materialHash(event) {
  const { hash, ...material } = event;
  return sha256(material);
}

function readLedger(rootDir, runId) {
  const file = ledgerPath(rootDir, runId);
  if (!fs.existsSync(file)) return [];
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) {
    throw interactionError('Run interactions must be a bounded regular file', 'INVALID_RUN_INTERACTIONS');
  }
  const events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  });
  let previousHash = null;
  for (const [index, event] of events.entries()) {
    if (!event || event.runId !== runId || event.sequence !== index + 1 ||
        event.previousHash !== previousHash || event.hash !== materialHash(event) ||
        !['QUESTION', 'ANSWER'].includes(event.type)) {
      throw interactionError(`Run interaction ${index + 1} failed integrity validation`, 'INVALID_RUN_INTERACTIONS');
    }
    previousHash = event.hash;
  }
  return events;
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
  const file = ledgerPath(rootDir, runId);
  const events = readLedger(rootDir, runId);
  if (events.length >= MAX_INTERACTIONS) {
    throw interactionError('Run interaction limit reached', 'RUN_INTERACTION_LIMIT');
  }
  const material = {
    schemaVersion: 1,
    runId,
    sequence: events.length + 1,
    previousHash: events.at(-1)?.hash || null,
    at: now.toISOString(),
    ...partial
  };
  const event = { ...material, hash: sha256(material) };
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'a' });
  return event;
}

function appendRunQuestion(rootDir, runId, { message, actor = 'agent' } = {}, { now = new Date() } = {}) {
  return withInteractionLock(rootDir, runId, () => {
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
  return withInteractionLock(rootDir, runId, () => {
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
