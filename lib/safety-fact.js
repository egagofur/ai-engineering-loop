'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { destructiveFindings } = require('./guard.js');
const { redactHomePaths, redactSecrets } = require('./safe-context.js');

const FILE = 'safety-fact.json';
const LEVELS = {
  1: 'stated',
  2: 'pointed at the line',
  3: 'walked the failure path',
  4: 'ran real code',
  5: 'reproduced in the running app'
};

const fail = (message, code = 'INVALID_USAGE') => Object.assign(new Error(message), { code });
const factPath = (rootDir, runId) => path.join(rootDir, '.ai-engineering-loop', 'runs', runId, FILE);

function recordSafetyFact(rootDir, runId, { fact, command = null, live = false, level = null, timeoutMs = 120000, now = new Date() }) {
  const text = String(fact || '').trim();
  if (!text) throw fail('--fact is required: the one fact this change is safe because of');
  let record;
  if (command) {
    if (destructiveFindings(command).length) throw fail('The proof command looks destructive; prove the fact with a read-only script or test');
    const result = spawnSync(command, { cwd: rootDir, encoding: 'utf8', timeout: timeoutMs, shell: true });
    if (result.status !== 0) {
      throw fail(`The proof command did not pass (exit ${result.status ?? 'none'}), so the fact is not proven. Fix the change or the fact, then record again.`, 'SAFETY_FACT_NOT_PROVEN');
    }
    record = {
      fact: text,
      level: live ? 5 : 4,
      command: redactHomePaths(redactSecrets(command).text),
      exitCode: 0,
      outputTail: redactHomePaths(redactSecrets(String(result.stdout || '')).text).slice(-1000)
    };
  } else {
    const claimed = level == null ? 1 : Number(level);
    if (![1, 2, 3].includes(claimed)) throw fail('--level without --cmd must be 1, 2 or 3; levels 4 and 5 need a proof command that passes');
    if (live) throw fail('--live needs --cmd: level 5 is a passing proof run against the running app');
    record = { fact: text, level: claimed };
  }
  const value = { schemaVersion: 1, runId, ...record, levelName: LEVELS[record.level], recordedAt: now.toISOString() };
  fs.writeFileSync(factPath(rootDir, runId), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return value;
}

function loadSafetyFact(rootDir, runId) {
  try {
    return JSON.parse(fs.readFileSync(factPath(rootDir, runId), 'utf8'));
  } catch {
    return null;
  }
}

function safetyFactProblem(rootDir, run, { minimum = 4 } = {}) {
  const value = loadSafetyFact(rootDir, run.runId);
  if (!value) return 'no safety fact recorded';
  if (value.level < minimum) return `safety fact is level ${value.level} (${LEVELS[value.level]}); level ${minimum} needs a proof command that passes`;
  return null;
}

module.exports = { LEVELS, loadSafetyFact, recordSafetyFact, safetyFactProblem };
