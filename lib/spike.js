'use strict';

// A throwaway prototype before the Goal is frozen. The command records the
// question and what the contract should say. It does not keep the spike code.

const fs = require('fs');
const path = require('path');
const { atomicWriteJson, getCurrentRun, loadRun, runsDir } = require('./run-state.js');

const MIN_TEXT = 8;
const MAX_QUESTION = 500;
const MAX_LEARNED = 2000;

function spikeError(message, code, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, runId);
  const current = getCurrentRun(rootDir);
  if (!current) {
    throw spikeError('spike needs a Run. Start one, then record the spike before the Goal is frozen.', 'NO_RUN', {
      why: 'The note is stored on the Run that the contract will freeze.',
      fix: 'ael run "<task>"'
    });
  }
  return current;
}

function bounded(value, label, max, fix) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text.length < MIN_TEXT || text.length > max) {
    throw spikeError(`${label} must be ${MIN_TEXT}-${max} characters.`, 'INVALID_USAGE', {
      why: 'The spike note is one question and what the contract should say.',
      fix
    });
  }
  return text;
}

function spikePath(rootDir, runId) {
  return path.join(runsDir(rootDir), runId, 'spike.json');
}

function recordSpike(rootDir, { runId = null, question, learned, discarded = false, now = new Date() } = {}) {
  if (discarded !== true) {
    throw spikeError('A spike is throwaway. Delete the prototype, then pass --discarded.', 'SPIKE_NOT_DISCARDED', {
      why: 'Spike code must not become the implementation or the contract.',
      fix: 'ael spike record --discarded --question "<one question>" --learned "<what the contract should say>"'
    });
  }
  const run = resolveRun(rootDir, runId);
  if (run.goal?.frozen === true || run.state !== 'STARTED') {
    throw spikeError('Record the spike before the Goal is frozen.', 'GOAL_ALREADY_FROZEN', {
      why: 'The spike informs the contract. After freeze the contract does not move.',
      fix: 'Write the Goal from what you learned, then ask the human to freeze.'
    });
  }
  const doc = {
    schemaVersion: 1,
    runId: run.runId,
    question: bounded(question, '--question', MAX_QUESTION, 'ael spike record --discarded --question "<one question>" --learned "<what you learned>"'),
    learned: bounded(learned, '--learned', MAX_LEARNED, 'ael spike record --discarded --question "<one question>" --learned "<what the contract should say>"'),
    discarded: true,
    recordedAt: now.toISOString()
  };
  atomicWriteJson(spikePath(rootDir, run.runId), doc);
  return { ...doc, path: `.ai-engineering-loop/runs/${run.runId}/spike.json` };
}

function showSpike(rootDir, { runId = null } = {}) {
  let run = null;
  try {
    run = runId ? loadRun(rootDir, runId) : getCurrentRun(rootDir);
  } catch (err) {
    if (err.code === 'NO_CURRENT_RUN') return { ok: true, recorded: false, runId: null };
    throw err;
  }
  if (!run) return { ok: true, recorded: false, runId: null };
  const file = spikePath(rootDir, run.runId);
  if (!fs.existsSync(file)) return { ok: true, recorded: false, runId: run.runId };
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (cause) {
    return { ok: false, recorded: true, runId: run.runId, code: 'INVALID_SPIKE', error: `spike.json is not valid JSON: ${cause.message}` };
  }
  if (doc?.discarded !== true || !String(doc.question || '').trim() || !String(doc.learned || '').trim()) {
    return {
      ok: false,
      recorded: true,
      runId: run.runId,
      code: 'SPIKE_NOT_DISCARDED',
      error: 'spike.json must say the prototype was discarded, with a question and what was learned.',
      fix: 'ael spike record --discarded --question "<one question>" --learned "<what the contract should say>"'
    };
  }
  return { ok: true, recorded: true, runId: run.runId, spike: doc };
}

module.exports = {
  recordSpike,
  showSpike
};
