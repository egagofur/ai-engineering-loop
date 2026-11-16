'use strict';

// Review feedback promotion (C-05, learn-harness-engineering L10): a lesson
// that keeps coming back from review becomes an executable check with an
// agent-oriented fix message. Rules live in .ai-engineering-loop/rules.json,
// run as L1 commands in the default verify plan, and the verification gate
// requires every rule to have passed on the gated diff.

const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('./run-state.js');

const RULES_FILE = path.join('.ai-engineering-loop', 'rules.json');
const PROMOTE_AFTER_RUNS = 3;

function rulesError(message, code = 'RULES_FAILED') {
  return Object.assign(new Error(message), { code });
}

function loadRules(rootDir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(rootDir, RULES_FILE), 'utf8'));
    return Array.isArray(value.rules) ? value : { schemaVersion: 1, rules: [] };
  } catch {
    return { schemaVersion: 1, rules: [] };
  }
}

function loadLearningEntries(rootDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, '.ai-engineering-loop', 'learnings.json'), 'utf8')).entries || [];
  } catch {
    return [];
  }
}

function promoteLearning(rootDir, learningId, { check, fix, why = null, by, shell = true, now = new Date() } = {}) {
  if (!String(check || '').trim()) throw rulesError('--check "<command>" is required: the command must exit non-zero on a violation.', 'INVALID_USAGE');
  if (!String(fix || '').trim()) throw rulesError('--fix "<instruction>" is required: tell the agent exactly how to repair a violation.', 'INVALID_USAGE');
  if (!String(by || '').trim()) throw rulesError('--by <name> is required: promoting a rule is a human decision.', 'INVALID_USAGE');
  const learning = loadLearningEntries(rootDir).find((entry) => entry.id === learningId);
  if (!learning) throw rulesError(`No learning ${learningId} in .ai-engineering-loop/learnings.json. Run \`learn\` first and use an id it prints.`, 'NOT_FOUND');
  const document = loadRules(rootDir);
  const id = `R-${learningId.replace(/^L-/, '')}`;
  if (document.rules.some((rule) => rule.id === id)) throw rulesError(`${learningId} is already promoted as ${id}.`, 'ALREADY_PROMOTED');
  const rule = {
    id,
    from: learningId,
    lesson: learning.lesson,
    check: String(check).trim(),
    shell: Boolean(shell),
    why: why ? String(why).trim() : learning.lesson,
    fix: String(fix).trim(),
    layer: 'L1',
    createdBy: String(by).trim(),
    createdAt: now.toISOString()
  };
  atomicWriteJson(path.join(rootDir, RULES_FILE), { schemaVersion: 1, rules: [...document.rules, rule] });
  return rule;
}

// Learnings seen in >= PROMOTE_AFTER_RUNS Runs and not promoted yet.
function promotionCandidates(rootDir, entries = loadLearningEntries(rootDir)) {
  const promoted = new Set(loadRules(rootDir).rules.map((rule) => rule.from));
  return entries
    .filter((entry) => (entry.runIds || []).length >= PROMOTE_AFTER_RUNS && !promoted.has(entry.id))
    .map((entry) => ({ id: entry.id, runs: entry.runIds.length, lesson: entry.lesson }));
}

// Default-plan steps for every rule (L1, shell by default).
function rulePlan(rootDir) {
  return loadRules(rootDir).rules.map((rule) => ({ key: `rule:${rule.id}`, layer: 'L1', text: rule.check, shell: rule.shell !== false, rule }));
}

// Shell commands are recorded JSON-quoted; compare on the unquoted text.
function plainCommand(text) {
  const value = String(text || '').trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function ruleForCommand(rootDir, commandText) {
  const value = plainCommand(commandText);
  return loadRules(rootDir).rules.find((rule) => rule.check === value) || null;
}

// Rules with no passing record in a full-scope bundle.
function missingRules(rootDir, bundle) {
  const records = bundle?.commands || [];
  if (records.length && records.every((record) => record.scope === 'related')) return [];
  const passing = records.filter((record) => record.exitCode === 0);
  const passed = new Set(passing.map((record) => plainCommand(record.command)));
  const keys = new Set(passing.map((record) => record.key).filter(Boolean));
  return loadRules(rootDir).rules.filter((rule) => !passed.has(rule.check) && !keys.has(`rule:${rule.id}`));
}

module.exports = {
  PROMOTE_AFTER_RUNS,
  RULES_FILE,
  loadRules,
  missingRules,
  promoteLearning,
  promotionCandidates,
  ruleForCommand,
  rulePlan
};
