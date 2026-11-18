'use strict';

const fs = require('fs');
const path = require('path');

const FILE = 'measurements.json';
const MIN_RUNS = 3;

const fail = (message) => Object.assign(new Error(message), { code: 'INVALID_USAGE' });
const filePath = (rootDir, runId) => path.join(rootDir, '.ai-engineering-loop', 'runs', runId, FILE);
const percent = (value, flag) => {
  const number = Number(String(value ?? '').replace(/%$/, ''));
  if (!Number.isFinite(number) || number < 0) throw fail(`${flag} must be a non-negative percentage, such as 4 or 4%`);
  return number;
};

function loadMeasurements(rootDir, runId) {
  try {
    return JSON.parse(fs.readFileSync(filePath(rootDir, runId), 'utf8')).measurements || [];
  } catch {
    return [];
  }
}

function recordMeasurement(rootDir, runId, { ac, runs, spread, effect, limiter, now = new Date() }) {
  if (!/^AC-\d+$/.test(String(ac || ''))) throw fail('--ac must be an AC id such as AC-2');
  const count = Number(runs);
  if (!Number.isInteger(count) || count < 1) throw fail('--runs must be a whole number of measured runs');
  const reason = String(limiter || '').trim();
  if (!reason) throw fail('--limiter is required: the resource or code path that bounds the number, from a profile or counters');
  const entry = { ac, runs: count, spread: percent(spread, '--spread'), effect: percent(effect, '--effect'), limiter: reason, recordedAt: now.toISOString() };
  const measurements = loadMeasurements(rootDir, runId).filter((item) => item.ac !== ac).concat(entry);
  fs.writeFileSync(filePath(rootDir, runId), `${JSON.stringify({ schemaVersion: 1, runId, measurements }, null, 2)}\n`, { mode: 0o600 });
  return entry;
}

function measurementProblems(rootDir, run, goal) {
  const needed = (goal?.acceptanceCriteria || []).filter((ac) => ac.measure === true);
  if (!needed.length) return [];
  const recorded = new Map(loadMeasurements(rootDir, run.runId).map((item) => [item.ac, item]));
  const problems = [];
  for (const ac of needed) {
    const m = recorded.get(ac.id);
    if (!m) problems.push(`${ac.id}: no measurement recorded`);
    else if (m.runs < MIN_RUNS) problems.push(`${ac.id}: ${m.runs} run(s); at least ${MIN_RUNS} are needed to see the noise`);
    else if (m.spread >= m.effect) problems.push(`${ac.id}: run-to-run spread ${m.spread}% is not smaller than the effect ${m.effect}%`);
  }
  return problems;
}

module.exports = { MIN_RUNS, loadMeasurements, measurementProblems, recordMeasurement };
