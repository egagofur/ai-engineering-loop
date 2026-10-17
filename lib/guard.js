'use strict';

// Runtime guardrails (#59). `guard check` decides allow | warn | block for one
// tool call before it runs: Edit/Write outside the Run's scope, and Bash
// commands that destroy files, history, or data. ASSISTED warns (the host
// asks the human), UNATTENDED and REPORT_ONLY block. Every warn/block is
// appended to the Run as evidence.

const fs = require('fs');
const path = require('path');
const { RUN_MODES, TERMINAL_STATES, atomicWriteJson, getCurrentRun, loadRun, runsDir } = require('./run-state.js');
const { loadPolicy } = require('./runtime-policy.js');
const { redactHomePaths, redactSecrets } = require('./safe-context.js');
const { impactScope, loadImpactMap, matchesAnyGlob } = require('./impact-map.js');

const GUARD_EVENTS_FILE = 'guard-events.json';
const MAX_EVENTS = 500;
const MAX_TARGET_CHARS = 300;
const DECISIONS = Object.freeze(['allow', 'warn', 'block']);
const EDIT_TOOLS = new Set(['edit', 'write', 'multiedit', 'notebookedit']);
const BASH_TOOLS = new Set(['bash', 'shell']);

function guardError(message, code = 'INVALID_USAGE') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeTool(tool) {
  const value = String(tool || '').trim().toLowerCase();
  if (EDIT_TOOLS.has(value)) return 'edit';
  if (BASH_TOOLS.has(value)) return 'bash';
  return value ? 'other' : null;
}

// Accepts a Claude Code PreToolUse payload ({ tool_name, tool_input }) or a
// plain { path } / { command } object.
function parseGuardInput(input, tool) {
  const value = input && typeof input === 'object' ? input : {};
  const toolInput = value.tool_input && typeof value.tool_input === 'object' ? value.tool_input : value;
  const kind = normalizeTool(tool || value.tool_name);
  if (!kind) throw guardError('guard check needs --tool edit|bash or a payload with tool_name');
  return {
    tool: kind,
    toolName: value.tool_name || tool,
    path: toolInput.file_path || toolInput.notebook_path || toolInput.path || null,
    command: typeof toolInput.command === 'string' ? toolInput.command : null
  };
}

// Shell segments split on ; && || | and newlines; quotes are kept simple on
// purpose: a quoted "rm -rf" still warns, which errs on the safe side.
function segments(command) {
  return String(command || '')
    .split(/\n|;|&&|\|\||\|/)
    .map((part) => part.trim().split(/\s+/).filter(Boolean).map((token) => token.replace(/^['"]|['"]$/g, '')))
    .filter((tokens) => tokens.length);
}

function shortFlags(tokens) {
  return tokens.filter((token) => /^-[A-Za-z]+$/.test(token)).join('').replace(/-/g, '');
}

function commandIndex(tokens, name) {
  return tokens.findIndex((token) => token === name || token.endsWith(`/${name}`));
}

function gitSubcommand(tokens) {
  const start = commandIndex(tokens, 'git');
  if (start === -1) return null;
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-C' || token === '-c') {
      index += 1;
      continue;
    }
    if (token.startsWith('-')) continue;
    return { name: token, args: tokens.slice(index + 1) };
  }
  return null;
}

const DESTRUCTIVE_RULES = Object.freeze([
  {
    id: 'rm-recursive-force',
    reason: 'rm with recursive and force flags deletes files without confirmation',
    test: (tokens) => {
      const start = commandIndex(tokens, 'rm');
      if (start === -1) return false;
      const args = tokens.slice(start + 1);
      const flags = shortFlags(args);
      const recursive = /[rR]/.test(flags) || args.includes('--recursive');
      const force = flags.includes('f') || args.includes('--force');
      return recursive && force;
    }
  },
  {
    id: 'git-push-force',
    reason: 'git push --force rewrites remote history',
    test: (tokens) => {
      const git = gitSubcommand(tokens);
      if (git?.name !== 'push') return false;
      return git.args.some((arg) => arg === '--force' || arg.startsWith('--force-with-lease') ||
        arg === '--force-if-includes' || (/^-[A-Za-z]+$/.test(arg) && arg.includes('f')) ||
        (/^\+[^\s]/.test(arg)));
    }
  },
  {
    id: 'git-reset-hard',
    reason: 'git reset --hard discards uncommitted work',
    test: (tokens) => {
      const git = gitSubcommand(tokens);
      return git?.name === 'reset' && git.args.includes('--hard');
    }
  },
  {
    id: 'git-clean-force',
    reason: 'git clean -fd deletes untracked files and directories',
    test: (tokens) => {
      const git = gitSubcommand(tokens);
      if (git?.name !== 'clean') return false;
      const flags = shortFlags(git.args);
      const force = flags.includes('f') || git.args.includes('--force');
      const dirs = flags.includes('d');
      return force && dirs;
    }
  }
]);

const SQL_RULES = Object.freeze([
  { id: 'sql-drop', reason: 'DROP TABLE/DATABASE/SCHEMA destroys data', pattern: /\bdrop\s+(?:table|database|schema)\b/i },
  { id: 'sql-truncate', reason: 'TRUNCATE deletes every row of a table', pattern: /\btruncate\s+(?:table\s+)?[`"'[]?[A-Za-z_]/i }
]);

function destructiveFindings(command) {
  const findings = new Map();
  for (const tokens of segments(command)) {
    for (const rule of DESTRUCTIVE_RULES) {
      if (rule.test(tokens)) findings.set(rule.id, rule.reason);
    }
  }
  for (const rule of SQL_RULES) {
    if (rule.pattern.test(String(command || ''))) findings.set(rule.id, rule.reason);
  }
  return [...findings].map(([id, reason]) => ({ id, reason }));
}

function activeRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, runId);
  const current = getCurrentRun(rootDir);
  return current && !TERMINAL_STATES.has(current.state) ? current : null;
}

function readFrozenGoal(rootDir, run) {
  const filePath = path.join(runsDir(rootDir), run.runId, 'goal-contract.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Allowed = the frozen Goal's scope.allowedPaths plus the confirmed impact
// map (#71); denied = the Goal's scope.deniedPaths. No allowed list means no
// path enforcement, but denied paths always apply.
function runScope(rootDir, run) {
  if (!run) return { allowedPaths: null, deniedPaths: [], sources: [] };
  const goal = readFrozenGoal(rootDir, run);
  const mapScope = impactScope(loadImpactMap(rootDir, run.runId));
  const sources = [];
  let allowed = null;
  if (Array.isArray(goal?.scope?.allowedPaths)) {
    allowed = [...goal.scope.allowedPaths];
    sources.push('goal');
  }
  if (mapScope) {
    allowed = [...(allowed || []), ...mapScope.allowedPaths];
    sources.push('impact-map');
  }
  return {
    allowedPaths: allowed ? [...new Set(allowed)].sort() : null,
    deniedPaths: Array.isArray(goal?.scope?.deniedPaths) ? [...goal.scope.deniedPaths] : [],
    sources
  };
}

// Real path of a file that may not exist yet: resolve the nearest existing
// ancestor (macOS /var -> /private/var, symlinked checkouts) and re-append.
function realish(target) {
  let current = path.resolve(target);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

function repoRelative(rootDir, filePath) {
  const absolute = path.resolve(rootDir, String(filePath));
  const pairs = [[path.resolve(rootDir), absolute], [realish(rootDir), realish(absolute)]];
  for (const [root, target] of pairs) {
    const rel = path.relative(root, target);
    if (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  }
  return null;
}

function scopeFindings(rootDir, filePath, scope) {
  if (!filePath) return [];
  const relative = repoRelative(rootDir, filePath);
  if (relative != null && (relative === '.ai-engineering-loop' || relative.startsWith('.ai-engineering-loop/'))) return [];
  if (relative == null) {
    return scope.allowedPaths ? [{ id: 'outside-repository', reason: 'edit target is outside the repository and the Run scope' }] : [];
  }
  if (matchesAnyGlob(relative, scope.deniedPaths)) {
    return [{ id: 'scope-denied', reason: `${relative} matches scope.deniedPaths` }];
  }
  if (scope.allowedPaths && !matchesAnyGlob(relative, scope.allowedPaths)) {
    return [{ id: 'scope-outside', reason: `${relative} is outside the Run scope (${scope.sources.join(' + ')})` }];
  }
  return [];
}

function decisionFor(mode, findings) {
  if (!findings.length) return 'allow';
  return mode === RUN_MODES.ASSISTED ? 'warn' : 'block';
}

function safeTarget(parsed, rootDir) {
  const raw = parsed.tool === 'bash' ? parsed.command : (repoRelative(rootDir, parsed.path || '') ?? parsed.path);
  return redactHomePaths(redactSecrets(String(raw || '')).text).slice(0, MAX_TARGET_CHARS);
}

function recordGuardEvent(rootDir, runId, event) {
  const filePath = path.join(runsDir(rootDir), runId, GUARD_EVENTS_FILE);
  let events = [];
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(parsed.events)) events = parsed.events;
    } catch {
      events = [];
    }
  }
  events.push(event);
  atomicWriteJson(filePath, { schemaVersion: 1, runId, events: events.slice(-MAX_EVENTS) });
}

function checkGuard(rootDir, { tool, input, runId, now = new Date() } = {}) {
  const parsed = parseGuardInput(input, tool);
  const run = activeRun(rootDir, runId);
  const mode = run?.mode || loadPolicy(rootDir).defaultMode;
  let findings = [];
  if (parsed.tool === 'edit') {
    if (run && mode === RUN_MODES.REPORT_ONLY) {
      findings.push({ id: 'report-only-mutation', reason: 'REPORT_ONLY runs must not edit the repository' });
    }
    findings.push(...scopeFindings(rootDir, parsed.path, runScope(rootDir, run)));
  } else if (parsed.tool === 'bash') {
    findings = destructiveFindings(parsed.command);
  }
  const decision = decisionFor(mode, findings);
  const result = {
    decision,
    tool: parsed.tool,
    mode,
    runId: run?.runId || null,
    rules: findings.map((item) => item.id),
    reasons: findings.map((item) => item.reason)
  };
  if (run && decision !== 'allow') {
    recordGuardEvent(rootDir, run.runId, {
      at: now.toISOString(),
      tool: parsed.toolName || parsed.tool,
      decision,
      mode,
      rules: result.rules,
      reasons: result.reasons,
      target: safeTarget(parsed, rootDir)
    });
  }
  return result;
}

function loadGuardEvents(rootDir, runId) {
  const filePath = path.join(runsDir(rootDir), runId, GUARD_EVENTS_FILE);
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

function guardSummary(rootDir, runId) {
  const events = loadGuardEvents(rootDir, runId);
  return {
    warn: events.filter((event) => event.decision === 'warn').length,
    block: events.filter((event) => event.decision === 'block').length,
    rules: [...new Set(events.flatMap((event) => event.rules || []))].sort()
  };
}

// Claude Code PreToolUse output: deny blocks the call, ask hands it to the
// human, and allow prints nothing so the normal permission flow continues.
function claudeHookOutput(result) {
  if (result.decision === 'allow') return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision === 'block' ? 'deny' : 'ask',
      permissionDecisionReason: `ai-engineering-loop guard (${result.mode}): ${result.reasons.join('; ')}`
    }
  };
}

module.exports = {
  DECISIONS,
  GUARD_EVENTS_FILE,
  DESTRUCTIVE_RULES,
  parseGuardInput,
  destructiveFindings,
  runScope,
  checkGuard,
  loadGuardEvents,
  guardSummary,
  claudeHookOutput
};
