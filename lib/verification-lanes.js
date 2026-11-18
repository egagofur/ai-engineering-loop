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

// Verification catalog (#110, C-23): every kind of proof a project may
// configure in verification.md, the layer it proves, and whether the default
// plan runs it. AEL does not ship these tools; it recognises them, orders
// them, binds their evidence, and lets an AC require one (`verify.key`).
// Layers: L1 static, L2 runtime, L3 end-to-end, LF formal (model checking,
// proofs; slow, so never in the default plan).
const VERIFICATION_CATALOG = Object.freeze({
  build: { layer: 'L1', plan: true, what: 'compiles or bundles' },
  typecheck: { layer: 'L1', plan: true, what: 'static types' },
  lint: { layer: 'L1', plan: true, what: 'lint and static analysis' },
  security: { layer: 'L1', plan: false, what: 'dependency or static security scan' },
  test_unit: { layer: 'L2', plan: true, what: 'unit tests' },
  test_related: { layer: 'L2', plan: false, what: 'tests related to changed files' },
  test_all: { layer: 'L2', plan: false, what: 'full regression suite' },
  property: { layer: 'L2', plan: true, what: 'property-based tests' },
  fuzz: { layer: 'L2', plan: false, what: 'fuzz tests' },
  mutation: { layer: 'L2', plan: false, what: 'mutation tests (do the tests catch broken code?)' },
  coverage: { layer: 'L2', plan: false, what: 'coverage threshold' },
  benchmark: { layer: 'L2', plan: false, what: 'benchmark or performance tests' },
  smoke: { layer: 'L2', plan: false, what: 'start, probe readiness, stop' },
  contract: { layer: 'L3', plan: false, what: 'API or consumer contract tests' },
  e2e: { layer: 'L3', plan: false, what: 'end-to-end user flows' },
  pentest: { layer: 'L3', plan: false, what: 'penetration or DAST scan' },
  formal: { layer: 'LF', plan: false, what: 'formal verification (TLA+, Lean, model checking)' }
});
const LAYER_OF_KEY = Object.freeze(Object.fromEntries(Object.entries(VERIFICATION_CATALOG).map(([key, entry]) => [key, entry.layer])));
// Cheapest-first default plan (templates/repo-config/verification.md
// "Default order"): L1 static checks, then L2 unit and property tests.
const DEFAULT_PLAN_KEYS = Object.freeze(Object.keys(VERIFICATION_CATALOG).filter((key) => VERIFICATION_CATALOG[key].plan));

function layerOfKey(key) {
  return LAYER_OF_KEY[key] || null;
}

// verification.md key of a recorded command string (null when unmapped).
function keyOfCommand(rootDir, commandText) {
  const value = String(commandText || '').trim();
  for (const [key, text] of Object.entries(verificationCommands(rootDir))) {
    const base = text.replace(FILES_TOKEN, '').trim();
    if (value === text || (base && value.startsWith(base))) return key;
  }
  return null;
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

function formalCoveredFiles(rootDir, run) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(rootDir, '.ai-engineering-loop', 'verification.md'), 'utf8');
  } catch {
    return [];
  }
  const match = text.match(/\*\*formal_covers\*\*:\s*(.+)/i);
  if (!match) return [];
  const globs = match[1].replace(/`/g, '').split(',').map((glob) => glob.trim()).filter(Boolean);
  const artifact = run?.artifacts?.diff;
  if (!artifact?.path || !globs.length) return [];
  let diff = '';
  try {
    diff = fs.readFileSync(path.join(rootDir, artifact.path), 'utf8');
  } catch {
    return [];
  }
  const { matchesGlob } = require('./impact-map.js');
  return [...new Set(extractChangedPaths(diff))].filter((file) => globs.some((glob) => matchesGlob(file, glob)));
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
  formalCoveredFiles,
  VERIFICATION_CATALOG,
  keyOfCommand,
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
