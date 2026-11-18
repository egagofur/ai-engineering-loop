'use strict';

const fs = require('fs');
const path = require('path');

const DAY = 86400000;
const RUN_ID = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/;
const STAGES = [
  ['goal', 'STARTED', 'GOAL_FROZEN'],
  ['maker', 'GOAL_FROZEN', 'MAKER_COMPLETE'],
  ['verify', 'MAKER_COMPLETE', 'VERIFIED'],
  ['review', 'VERIFIED', /^JUDGED_/],
  ['deliver', 'JUDGED_PASS', 'DELIVERED']
];

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const readLines = (file) => {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
};

function runDate(runId) {
  const m = RUN_ID.exec(runId);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

function stageDurations(history) {
  const lastAt = (match) => {
    const hits = history.filter((entry) => (match instanceof RegExp ? match.test(entry.to) : entry.to === match));
    return hits.length ? Date.parse(hits[hits.length - 1].at) : null;
  };
  const result = {};
  for (const [name, from, to] of STAGES) {
    const a = lastAt(from);
    const b = lastAt(to);
    result[name] = a && b && b >= a ? b - a : 0;
  }
  return result;
}

function cleanTitle(state = {}, goal = {}) {
  const pick = String(goal.title || '').trim()
    || String(goal.objective || '').split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '').trim()
    || String(state.displayName || state.task || '').replace(/^(--?[\w-]+(\s+|$))+/, '').trim();
  return pick || 'Untitled run';
}

function clientText(goal) {
  if (String(goal.plainSummary || '').trim()) return [goal.plainSummary.trim(), 'plainSummary'];
  if (String(goal.businessOutcome || '').trim()) return [goal.businessOutcome.trim(), 'businessOutcome'];
  return [String(goal.objective || '').trim(), 'objective'];
}

function loadRun(projectPath, runId) {
  const dir = path.join(projectPath, '.ai-engineering-loop', 'runs', runId);
  const state = readJson(path.join(dir, 'state.json')) || {};
  const goal = readJson(path.join(dir, 'goal-contract.json')) || {};
  const verdict = readJson(path.join(dir, 'verdict.json')) || {};
  const delivery = readJson(path.join(dir, 'delivery.json')) || {};
  const verification = readJson(path.join(dir, 'verification.json')) || {};
  const receipt = readJson(path.join(dir, 'receipt.json')) || {};
  const summary = readJson(path.join(dir, 'run-summary.json')) || {};
  const history = Array.isArray(state.history) ? state.history : [];
  const [text, source] = clientText(goal);
  const acs = Array.isArray(receipt.acceptanceCriteria) && receipt.acceptanceCriteria.length
    ? receipt.acceptanceCriteria
    : (goal.acceptanceCriteria || []);
  const files = {};
  for (const name of ['goal-contract.json', 'verification.json', 'verdict.json', 'receipt.md', 'lifecycle.jsonl']) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) files[name] = file;
  }
  return {
    project: path.basename(projectPath),
    projectPath,
    runId,
    date: runDate(runId),
    endedAt: history.length ? new Date(history[history.length - 1].at) : runDate(runId),
    state: state.state || 'UNKNOWN',
    delivered: state.state === 'DELIVERED',
    tier: state.tier?.current || verdict.tier || null,
    title: cleanTitle(state, goal),
    objective: String(goal.objective || ''),
    clientText: text,
    clientTextSource: source,
    verdict: verdict.verdict || null,
    verdictReason: String(verdict.reason || ''),
    iterations: readLines(path.join(dir, 'iterations.jsonl')).map((entry) => ({ verdict: entry.verdict, cause: entry.cause || null })),
    branch: delivery.destination || null,
    approvedBy: delivery.approvedBy || null,
    commands: (verification.commands || []).map((c) => ({ command: String(c.command || ''), exitCode: c.exitCode, durationMs: c.durationMs || 0 })),
    testCounts: summary.verification?.testCounts || null,
    acs: acs.map((ac) => ({ id: ac.id, statement: ac.statement || '', status: ac.status || null, evidence: typeof ac.evidence === 'string' ? ac.evidence : ac.evidence ? JSON.stringify(ac.evidence) : null })),
    outOfMap: Array.isArray(receipt.impact?.outOfMap) ? receipt.impact.outOfMap : [],
    openFindings: Array.isArray(summary.openFindings) ? summary.openFindings.length : 0,
    stages: stageDurations(history),
    interventions: require('./interventions.js').runInterventions(dir),
    files
  };
}

function runsBetween(projectPath, from, to) {
  let ids = [];
  try {
    ids = fs.readdirSync(path.join(projectPath, '.ai-engineering-loop', 'runs')).filter((id) => RUN_ID.test(id));
  } catch {
    return [];
  }
  return ids.filter((id) => {
    const d = runDate(id);
    return d >= from && d < to;
  }).map((id) => loadRun(projectPath, id));
}

const cycle = (run) => Object.values(run.stages).reduce((a, b) => a + b, 0);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function metricsOf(runs) {
  const judged = runs.filter((run) => run.iterations.length);
  const causes = {};
  for (const run of runs) for (const entry of run.iterations) if (entry.verdict !== 'PASS' && entry.cause) causes[entry.cause] = (causes[entry.cause] || 0) + 1;
  return {
    runs: runs.length,
    delivered: runs.filter((run) => run.delivered).length,
    firstPassRate: judged.length ? Math.round((judged.filter((run) => run.iterations[0].verdict === 'PASS').length / judged.length) * 100) : null,
    medianCycleMs: median(runs.filter((run) => run.delivered).map(cycle).filter(Boolean)),
    t2: runs.filter((run) => run.tier === 'T2').length,
    interventionsPerRun: require('./interventions.js').summarizeInterventions(runs.map((run) => run.interventions)).perRun,
    causes
  };
}

function collectRecap({ projects, days = 7, now = new Date() }) {
  const to = now;
  const from = new Date(now.getTime() - days * DAY);
  const prevFrom = new Date(from.getTime() - days * DAY);
  const runs = projects.flatMap((p) => runsBetween(p, from, to)).sort((a, b) => a.date - b.date);
  const previousRuns = projects.flatMap((p) => runsBetween(p, prevFrom, from));
  return {
    window: { from, to, days },
    projects: projects.map((p) => path.basename(p)),
    runs,
    metrics: metricsOf(runs),
    previous: previousRuns.length ? metricsOf(previousRuns) : null
  };
}

module.exports = { STAGES, cleanTitle, collectRecap, cycle, runDate };
