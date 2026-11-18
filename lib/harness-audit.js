'use strict';

// `doctor --harness` (C-08, learn-harness-engineering L03/L04/L12): harness
// debt in the project, reported as candidates to fix or delete. Harness rots
// like code: entry files bloat, learnings go stale, rules outlive their need.

const fs = require('fs');
const path = require('path');
const { runsDir } = require('./run-state.js');

const ENTRY_MIN = 50;
const ENTRY_MAX = 200;
const STALE_LEARNING_RUNS = 10;
const RULE_REVIEW_DAYS = 90;
const BUDGET_HEADROOM = 0.02;

// Only structured lines count (headings, lists, tables, code, bold leads), so
// sprinkling keywords into prose cannot game the score (Goodhart, L14).
// Adapted from harness-creator's structuredText (MIT).
function structuredText(markdown) {
  const kept = [];
  let inFence = false;
  for (const raw of String(markdown || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^#{1,6}\s/.test(line) || /^([-*+]|\d+\.)\s/.test(line) || line.startsWith('|') || /^\*\*[^*]+\*\*/.test(line)) {
      if (line) kept.push(line);
    }
  }
  return kept.join('\n').toLowerCase();
}

function auditEntryFile(rootDir) {
  const name = ['AGENTS.md', 'CLAUDE.md'].find((file) => fs.existsSync(path.join(rootDir, file)));
  if (!name) return [{ id: 'entry-file', level: 'warn', detail: 'No AGENTS.md or CLAUDE.md. FIX: add a 50-200 line router: overview, run/verify commands, hard rules, links to docs.' }];
  const text = fs.readFileSync(path.join(rootDir, name), 'utf8');
  const lines = text.split(/\r?\n/).length;
  const items = [];
  if (lines > ENTRY_MAX) items.push({ id: 'entry-file-size', level: 'warn', detail: `${name} has ${lines} lines (> ${ENTRY_MAX}). FIX: keep it a router; move topic detail to docs/ and link it.` });
  if (lines < ENTRY_MIN) items.push({ id: 'entry-file-size', level: 'info', detail: `${name} has ${lines} lines; fine if it still answers what/run/verify.` });
  const structured = structuredText(text);
  const needs = [
    ['verification', /verif|test|check/],
    ['definition of done', /definition of done|done when|done only when/],
    ['startup', /startup|start here|quick start|before writing|setup/]
  ];
  for (const [label, pattern] of needs) {
    if (!pattern.test(structured)) items.push({ id: 'entry-file-structure', level: 'warn', detail: `${name} has no structured ${label} section (heading or list). FIX: add one; prose mentions do not count.` });
  }
  return items;
}

function listRunIds(rootDir) {
  try {
    return fs.readdirSync(runsDir(rootDir), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

function auditLearnings(rootDir) {
  let entries = [];
  try {
    entries = JSON.parse(fs.readFileSync(path.join(rootDir, '.ai-engineering-loop', 'learnings.json'), 'utf8')).entries || [];
  } catch {
    return [];
  }
  const runs = listRunIds(rootDir);
  const recent = new Set(runs.slice(-STALE_LEARNING_RUNS));
  if (runs.length <= STALE_LEARNING_RUNS) return [];
  return entries
    .filter((entry) => !(entry.runIds || []).some((runId) => recent.has(runId)))
    .map((entry) => ({ id: 'stale-learning', level: 'warn', detail: `${entry.id} not seen in the last ${STALE_LEARNING_RUNS} Runs: ${String(entry.lesson || '').slice(0, 80)}. FIX: \`learn --prune\` or delete it if the problem is gone.` }));
}

function auditRules(rootDir, now = new Date()) {
  let rules = [];
  try {
    rules = JSON.parse(fs.readFileSync(path.join(rootDir, '.ai-engineering-loop', 'rules.json'), 'utf8')).rules || [];
  } catch {
    return [];
  }
  const items = [];
  for (const rule of rules) {
    if (!rule.from || !rule.why || !rule.fix) items.push({ id: 'rule-provenance', level: 'warn', detail: `${rule.id} lacks a source (from), why or fix. FIX: record where it came from and how to repair a violation.` });
    if (rule.scope === 'diff') {
      const backlog = require('./rules.js').legacyBacklog(rootDir, rule);
      if (backlog.error) items.push({ id: 'rule-backlog', level: 'info', detail: `${rule.id}: ${backlog.error}` });
      else if (backlog.clean) items.push({ id: 'rule-backlog', level: 'info', detail: `${rule.id} (scope diff) has no legacy violations left. Switch it to scope repo so the whole codebase stays clean.` });
      else items.push({ id: 'rule-backlog', level: 'info', detail: `${rule.id} (scope diff): legacy violations remain (${backlog.outputLines} output line(s), e.g. ${backlog.sample[0] || 'n/a'}). Clean them up over time; new ones are already blocked.` });
    }
    if (!rule.provenBy) items.push({ id: 'rule-unproven', level: 'info', detail: `${rule.id} was never shown to catch a real mistake. FIX: re-promote it with \`learn promote ${rule.from || '<learning>'} ... --prove <commit that introduced the mistake>\`.` });
    const age = (now - new Date(rule.createdAt || 0)) / 86400000;
    if (age > RULE_REVIEW_DAYS) items.push({ id: 'rule-review', level: 'info', detail: `${rule.id} is ${Math.floor(age)} days old. Re-check it is still needed (bench --without rules).` });
  }
  return items;
}

// Inside the AEL package repo: T1 skill-context headroom from scripts/measure.js.
function auditBudget(rootDir) {
  const script = path.join(rootDir, 'scripts', 'measure.js');
  if (!fs.existsSync(script)) return [];
  try {
    const { measureAll, BASELINE } = require(script);
    const t1 = measureAll().results.find((row) => row.tier === 'T1');
    const limit = BASELINE.parentContextChars / 2;
    const headroom = (limit - t1.parentContextChars) / limit;
    return [{
      id: 'skill-budget',
      level: headroom < BUDGET_HEADROOM ? 'warn' : 'info',
      detail: `T1 skill context ${t1.parentContextChars}/${limit} chars (${(headroom * 100).toFixed(2)}% headroom).${headroom < BUDGET_HEADROOM ? ' FIX: trim skill-src references before adding text.' : ''}`
    }];
  } catch (cause) {
    return [{ id: 'skill-budget', level: 'warn', detail: `measure failed: ${cause.message}` }];
  }
}

// C-22: runtime verification without a feature map makes agents guess what
// to exercise.
function auditFeatureMap(rootDir) {
  const lanes = require('./verification-lanes.js');
  const commands = lanes.verificationCommands(rootDir);
  if (!commands.e2e && !commands.smoke) return [];
  if (require('./feature-map.js').loadFeatureMap(rootDir).length) return [];
  return [{ id: 'feature-map', level: 'warn', detail: 'e2e/smoke is configured but .ai-engineering-loop/feature-map.md is missing or empty. FIX: list user-facing features (Feature | Where | Paths | How to reach | Driver) so agents and reviewers share one vocabulary for runtime checks.' }];
}

function auditFeatureMapDrift(rootDir) {
  const entries = require('./feature-map.js').loadFeatureMap(rootDir);
  if (!entries.length) return [];
  let files = [];
  try {
    files = require('child_process').execFileSync('git', ['ls-files'], { cwd: rootDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
  const { matchesGlob } = require('./impact-map.js');
  const items = [];
  for (const entry of entries) {
    const dead = entry.paths.filter((glob) => !files.some((file) => matchesGlob(file, glob)));
    if (dead.length) items.push({ id: 'feature-map-drift', level: 'warn', detail: `Feature "${entry.id}" lists paths that match no tracked file: ${dead.join(', ')}. FIX: update the Paths column in .ai-engineering-loop/feature-map.md, or remove the feature if it is gone.` });
  }
  return items;
}

function auditHarness(rootDir, { budget = true } = {}) {
  const items = [
    ...auditEntryFile(rootDir),
    ...auditFeatureMap(rootDir),
    ...auditFeatureMapDrift(rootDir),
    ...auditLearnings(rootDir),
    ...auditRules(rootDir),
    ...(budget ? auditBudget(rootDir) : [])
  ];
  return { ok: !items.some((item) => item.level === 'warn'), items };
}

module.exports = { auditHarness, structuredText };
