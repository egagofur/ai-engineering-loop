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

const SCOPES = Object.freeze(['repo', 'diff']);

function promoteLearning(rootDir, learningId, { check, fix, why = null, by, shell = true, scope = 'repo', forbidImport = null, forbidApi = null, except = null, prove = null, now = new Date() } = {}) {
  if (!SCOPES.includes(scope)) throw rulesError(`--scope must be repo or diff (got ${scope}).`, 'INVALID_USAGE');
  // C-20 built-in kinds: no hand-written check, always judged on added lines.
  let builtin = null;
  if (forbidImport && forbidApi) throw rulesError('Use one of --forbid-import or --forbid-api per rule.', 'INVALID_USAGE');
  if (forbidImport) {
    require('./rule-check.js').parseImportSpec(forbidImport);
    builtin = { kind: 'forbid-import', spec: String(forbidImport).trim() };
  } else if (forbidApi) {
    try {
      new RegExp(forbidApi);
    } catch (cause) {
      throw rulesError(`--forbid-api is not a valid regex: ${cause.message}`, 'INVALID_USAGE');
    }
    builtin = { kind: 'forbid-api', pattern: String(forbidApi), ...(except ? { except: String(except).trim() } : {}) };
  }
  if (builtin) {
    check = `ael rules check R-${learningId.replace(/^L-/, '')}`;
    scope = 'diff';
    shell = true;
  }
  if (!String(check || '').trim()) throw rulesError('--check "<command>" (or --forbid-import / --forbid-api) is required: the check must exit non-zero on a violation.', 'INVALID_USAGE');
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
    scope,
    ...(builtin || {}),
    createdBy: String(by).trim(),
    createdAt: now.toISOString()
  };
  if (prove) rule.provenBy = proveRule(rootDir, rule, prove, { now });
  atomicWriteJson(path.join(rootDir, RULES_FILE), { schemaVersion: 1, rules: [...document.rules, rule] });
  return rule;
}

function proveRule(rootDir, rule, commit, { now = new Date() } = {}) {
  const { execFileSync, spawnSync } = require('child_process');
  const os = require('os');
  const git = (...args) => execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let sha;
  try {
    sha = git('rev-parse', '--verify', `${commit}^{commit}`).trim();
  } catch {
    throw rulesError(`--prove ${commit} is not a commit in this repository.`, 'INVALID_USAGE');
  }
  let failed;
  if (rule.scope === 'diff') {
    const { parseDiff } = require('./verification-integrity.js');
    const files = parseDiff(git('show', '--format=', '--no-color', sha, '--', '.', ':(exclude).ai-engineering-loop')).filter((file) => !file.deleted);
    const lines = files.flatMap((file) => file.added.map((added) => ({ file: file.path, line: added.line, text: added.text })));
    if (rule.kind) {
      failed = require('./rule-check.js').checkRule(rule, lines).length > 0;
    } else {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-rule-proof-'));
      const addedPath = path.join(tmp, 'added-lines.txt');
      fs.writeFileSync(addedPath, lines.map((l) => `${l.file}:${l.line}:${l.text}`).join('\n'));
      const env = { ...process.env, AEL_CHANGED_FILES: files.map((file) => file.path).join('\n'), AEL_ADDED_LINES_FILE: addedPath };
      const result = rule.shell !== false
        ? spawnSync(rule.check, { cwd: rootDir, shell: true, env, encoding: 'utf8' })
        : spawnSync(rule.check.split(/\s+/)[0], rule.check.split(/\s+/).slice(1), { cwd: rootDir, env, encoding: 'utf8' });
      fs.rmSync(tmp, { recursive: true, force: true });
      failed = result.status !== 0;
    }
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-rule-proof-wt-'));
    const tree = path.join(tmp, 'tree');
    git('worktree', 'add', '--detach', '--quiet', tree, sha);
    try {
      const result = rule.shell !== false
        ? spawnSync(rule.check, { cwd: tree, shell: true, encoding: 'utf8' })
        : spawnSync(rule.check.split(/\s+/)[0], rule.check.split(/\s+/).slice(1), { cwd: tree, encoding: 'utf8' });
      failed = result.status !== 0;
    } finally {
      git('worktree', 'remove', '--force', tree);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  if (!failed) {
    throw rulesError(`The check did not fail on ${sha.slice(0, 12)}, so it would not have caught that mistake. Pick the commit that introduced the mistake, or fix the check.`, 'RULE_NOT_PROVEN');
  }
  return { commit: sha, at: now.toISOString() };
}

// Learnings seen in >= PROMOTE_AFTER_RUNS Runs and not promoted yet.
function promotionCandidates(rootDir, entries = loadLearningEntries(rootDir)) {
  const promoted = new Set(loadRules(rootDir).rules.map((rule) => rule.from));
  return entries
    .filter((entry) => (entry.runIds || []).length >= PROMOTE_AFTER_RUNS && !promoted.has(entry.id))
    .map((entry) => ({ id: entry.id, runs: entry.runIds.length, lesson: entry.lesson }));
}

// C-17 ratchet: a `diff` rule judges only what this change adds. Its check
// receives AEL_CHANGED_FILES (one path per line) and AEL_ADDED_LINES_FILE
// (`path:line:text` per added line, the format of `grep -n`), so
// `! grep -E "<pattern>" "$AEL_ADDED_LINES_FILE"` flags new occurrences only.
function writeAddedLines(rootDir, run) {
  const { parseDiff } = require('./verification-integrity.js');
  let diffText = '';
  try {
    diffText = fs.readFileSync(path.join(rootDir, run.artifacts.diff.path), 'utf8');
  } catch {
    diffText = '';
  }
  const files = parseDiff(diffText).filter((file) => !file.deleted);
  const lines = files.flatMap((file) => file.added.map((added) => `${file.path}:${added.line}:${added.text}`));
  const dir = path.join(rootDir, '.ai-engineering-loop', 'runs', run.runId);
  fs.mkdirSync(dir, { recursive: true });
  const addedPath = path.join(dir, 'rule-added-lines.txt');
  fs.writeFileSync(addedPath, lines.length ? `${lines.join('\n')}\n` : '');
  return { AEL_CHANGED_FILES: files.map((file) => file.path).join('\n'), AEL_ADDED_LINES_FILE: addedPath };
}

// Built-in kinds run through this CLI (`rules check <id>`); others run their
// stored check.
function commandForRule(rule) {
  return rule.kind ? require('./rule-check.js').builtinCommand(rule) : rule.check;
}

// Default-plan steps for every rule (L1, shell by default). `run` enables
// the diff env for `scope: "diff"` rules.
function rulePlan(rootDir, run = null) {
  const rules = loadRules(rootDir).rules;
  const diffEnv = run && rules.some((rule) => rule.scope === 'diff') ? writeAddedLines(rootDir, run) : null;
  return rules.map((rule) => ({
    key: `rule:${rule.id}`,
    layer: 'L1',
    text: commandForRule(rule),
    shell: rule.kind ? true : rule.shell !== false,
    rule,
    ...(rule.scope === 'diff' ? { env: diffEnv || { AEL_CHANGED_FILES: '', AEL_ADDED_LINES_FILE: '' } } : {})
  }));
}

// Legacy backlog of a `diff` rule: run its check against every tracked line
// (as if all were added). Exit 0 = clean, ready to switch to `repo`.
function legacyBacklog(rootDir, rule, { maxBytes = 32 * 1024 * 1024 } = {}) {
  const { execFileSync, spawnSync } = require('child_process');
  let dump = '';
  try {
    dump = execFileSync('git', ['grep', '-n', '-I', '-e', '', '--', '.', ':(exclude).ai-engineering-loop'], { cwd: rootDir, encoding: 'utf8', maxBuffer: maxBytes });
  } catch (cause) {
    if (cause.status !== 1) return { rule: rule.id, error: `git grep failed: ${cause.message.split('\n')[0]}` };
  }
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-rule-backlog-'));
  const addedPath = path.join(tmp, 'all-lines.txt');
  fs.writeFileSync(addedPath, dump);
  const files = [...new Set(dump.split('\n').filter(Boolean).map((line) => line.split(':')[0]))];
  const result = rule.kind || rule.shell !== false
    ? spawnSync(commandForRule(rule), { cwd: rootDir, shell: true, encoding: 'utf8', env: { ...process.env, AEL_CHANGED_FILES: files.join('\n'), AEL_ADDED_LINES_FILE: addedPath }, maxBuffer: maxBytes })
    : spawnSync(rule.check.split(/\s+/)[0], rule.check.split(/\s+/).slice(1), { cwd: rootDir, encoding: 'utf8', env: { ...process.env, AEL_CHANGED_FILES: files.join('\n'), AEL_ADDED_LINES_FILE: addedPath } });
  fs.rmSync(tmp, { recursive: true, force: true });
  const output = `${result.stdout || ''}${result.stderr || ''}`.split('\n').filter((line) => line.trim());
  return { rule: rule.id, clean: result.status === 0, outputLines: output.length, sample: output.slice(0, 3) };
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
  return loadRules(rootDir).rules.find((rule) => rule.check === value || commandForRule(rule) === value) || null;
}

function findRule(rootDir, id) {
  return loadRules(rootDir).rules.find((rule) => rule.id === id) || null;
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
  proveRule,
  SCOPES,
  commandForRule,
  findRule,
  legacyBacklog,
  writeAddedLines,
  PROMOTE_AFTER_RUNS,
  RULES_FILE,
  loadRules,
  missingRules,
  promoteLearning,
  promotionCandidates,
  ruleForCommand,
  rulePlan
};
