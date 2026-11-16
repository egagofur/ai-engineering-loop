'use strict';

// Verification lanes: a fast `related` lane for iterations and one `final`
// full run before delivery when the gated verification was related-only.

const fs = require('fs');
const path = require('path');
const { runsDir } = require('./run-state.js');
const { extractChangedPaths } = require('./escalation.js');

const FINAL_FILE = 'final-verification.json';
const FILES_TOKEN = '{files}';

function laneError(message, code) {
  return Object.assign(new Error(message), { code });
}

// `- **key**: `command`` lines from .ai-engineering-loop/verification.md.
function verificationCommands(rootDir) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(rootDir, '.ai-engineering-loop', 'verification.md'), 'utf8');
  } catch {
    return {};
  }
  const commands = {};
  for (const match of text.matchAll(/\*\*([a-z0-9_]+)\*\*:\s*`([^`]+)`/gi)) {
    if (!Object.hasOwn(commands, match[1])) commands[match[1]] = match[2].trim();
  }
  return commands;
}

// Changed files of the gated Maker diff that still exist (deleted files have
// no tests to relate to).
function relatedFiles(rootDir, run) {
  const artifact = run.artifacts?.diff;
  if (!artifact?.path) throw laneError('Maker evidence is not gated yet. Run `gate maker` first.', 'MAKER_NOT_GATED');
  const diff = fs.readFileSync(path.join(rootDir, artifact.path), 'utf8');
  return [...new Set(extractChangedPaths(diff))]
    .filter((file) => !file.startsWith('.ai-engineering-loop/'))
    .filter((file) => {
      try {
        return fs.statSync(path.join(rootDir, file)).isFile();
      } catch {
        return false;
      }
    });
}

// Expand `{files}` in the project's test_related command. `split` is the
// CLI's command splitter so quoting rules stay identical to `--cmd`.
function relatedCommand(rootDir, run, { split, shell = false } = {}) {
  const template = verificationCommands(rootDir).test_related;
  if (!template) {
    throw laneError(
      'No test_related command in .ai-engineering-loop/verification.md. Add e.g. - **test_related**: `npx jest --findRelatedTests {files}`, or pass --cmd.',
      'NO_RELATED_COMMAND'
    );
  }
  if (!template.includes(FILES_TOKEN)) {
    throw laneError(`test_related must contain ${FILES_TOKEN}`, 'INVALID_RELATED_COMMAND');
  }
  const files = relatedFiles(rootDir, run);
  if (!files.length) {
    throw laneError('The gated diff has no existing files to relate tests to; run the full `verify`.', 'NO_RELATED_FILES');
  }
  if (shell) {
    const quoted = files.map((file) => `'${file.replace(/'/g, `'\\''`)}'`).join(' ');
    return { ...split(template.split(FILES_TOKEN).join(quoted), true), files };
  }
  const parsed = split(template.replace(FILES_TOKEN, 'AEL_FILES_PLACEHOLDER'), false);
  const args = parsed.args.flatMap((arg) => (arg === 'AEL_FILES_PLACEHOLDER' ? files : [arg]));
  return { ...parsed, args, files };
}

// Verification layers (#110): which verification.md key proves which layer.
const LAYER_OF_KEY = Object.freeze({
  build: 'L1', typecheck: 'L1', lint: 'L1',
  test_unit: 'L2', test_related: 'L2', test_all: 'L2', smoke: 'L2',
  e2e: 'L3'
});
// Cheapest-first default plan (templates/repo-config/verification.md
// "Default order"): L1 static checks, then L2 unit tests.
const DEFAULT_PLAN_KEYS = Object.freeze(['build', 'typecheck', 'lint', 'test_unit']);

function layerOfKey(key) {
  return LAYER_OF_KEY[key] || null;
}

// Ordered [{ key, layer, text }] for the configured default plan. A command
// marked `# Optional` is still run when present.
// Commands that rewrite files (`eslint --fix`, `prettier --write`) would
// change the gated diff mid-verification, so they never run by default.
function isMutatingCommand(text) {
  return /(^|\s)(--fix|--write|-w)(\s|=|$)/.test(String(text || ''));
}

function defaultCommandPlan(rootDir, keys = DEFAULT_PLAN_KEYS) {
  const commands = verificationCommands(rootDir);
  return keys
    .filter((key) => commands[key] && !isMutatingCommand(commands[key]))
    .map((key) => ({ key, layer: layerOfKey(key), text: commands[key] }));
}

// Layer of a recorded command string, by matching it against verification.md.
function layerOfCommand(rootDir, commandText) {
  const value = String(commandText || '').trim();
  const commands = verificationCommands(rootDir);
  for (const [key, text] of Object.entries(commands)) {
    const base = text.replace(FILES_TOKEN, '').trim();
    if (value === text || (base && value.startsWith(base))) return layerOfKey(key);
  }
  return null;
}

// C-03: changes that can break startup without breaking unit tests
// (migrations, env, config, entrypoints, dependency manifests).
const STARTUP_RISK = /(^|\/)(migrations?|db\/migrate|prisma|alembic)\/|(^|\/)\.env(\.[\w-]+)?$|(^|\/)(config|settings)\/|\.config\.[cm]?[jt]s$|(^|\/)(docker-compose[^/]*\.ya?ml|Dockerfile|Procfile)$|(^|\/)(main|index|server|app)\.[cm]?[jt]s$|(^|\/)(package\.json|requirements\.txt|pyproject\.toml|go\.mod|Cargo\.toml)$/;

// Changed paths that warrant the `smoke` check, from the gated diff.
function startupRiskFiles(rootDir, run) {
  const artifact = run?.artifacts?.diff;
  if (!artifact?.path) return [];
  let diff = '';
  try {
    diff = fs.readFileSync(path.join(rootDir, artifact.path), 'utf8');
  } catch {
    return [];
  }
  return [...new Set(extractChangedPaths(diff))].filter((file) => STARTUP_RISK.test(file));
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

const passed = (record) => record && record.exitCode === 0 && record.timeoutStatus === 'COMPLETED';
const isFull = (record) => (record.scope || 'full') !== 'related';

// Whether delivery needs (or already has) a full run for the gated diff.
function finalVerificationStatus(rootDir, run) {
  const dir = path.join(runsDir(rootDir), run.runId);
  const bundle = readJson(path.join(dir, 'verification.json'));
  const commands = bundle?.commands || [];
  if (!commands.length || commands.some(isFull)) {
    return { required: false, satisfied: true, reason: 'gated verification already ran full scope' };
  }
  const final = readJson(path.join(dir, FINAL_FILE));
  const diffHash = run.artifacts?.diff?.sha256;
  if (!final) return { required: true, satisfied: false, reason: `missing ${FINAL_FILE}; run \`verify --final --run ${run.runId}\`` };
  if (final.runId !== run.runId || final.diffHash !== diffHash) {
    return { required: true, satisfied: false, reason: `${FINAL_FILE} is not bound to the gated Maker diff` };
  }
  const records = final.commands || [];
  if (!records.length || !records.every(passed)) {
    return { required: true, satisfied: false, reason: `${FINAL_FILE} has a failing or missing command` };
  }
  return { required: true, satisfied: true, reason: 'final full verification passed' };
}

module.exports = {
  DEFAULT_PLAN_KEYS,
  LAYER_OF_KEY,
  defaultCommandPlan,
  isMutatingCommand,
  startupRiskFiles,
  layerOfCommand,
  layerOfKey,
  FINAL_FILE,
  FILES_TOKEN,
  verificationCommands,
  relatedFiles,
  relatedCommand,
  finalVerificationStatus
};
