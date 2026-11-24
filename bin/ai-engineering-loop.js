#!/usr/bin/env node

/**
 * AI Engineering Loop — Deterministic CLI Bootstrap & Living Context Engine
 * Repository: https://github.com/egagofur/ai-engineering-loop
 * 
 * Architecture Principle:
 * The CLI handles deterministic repository discovery, context initialization,
 * baseline metadata tracking (metadata.json), status checks, and non-destructive drift refreshes.
 * The AI Agent handles task reasoning, RCA, implementation, review, judging, and impact assessment.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJsonOptional, sha256: sha256Text } = require('../lib/fsutil.js');
const { execSync, spawn, spawnSync } = require('child_process');

// Command modules load on first use, so a hot path such as
// `guard check --hook` (run before every tool call) loads only what it
// touches. lazyModule: a namespace that requires the file on first property
// read. lazyFunctions: destructure functions now, require the file on first
// call. Modules whose constants are read at load time stay eager.
function lazyModule(file) {
  let mod;
  return new Proxy({}, { get: (_, key) => (mod ||= require(file))[key] });
}

function lazyFunctions(file) {
  return new Proxy({}, { get: (_, key) => (...params) => require(file)[key](...params) });
}
const {
  homeDir,
  applyHostSync,
  hostSkillStatus,
  resolveHostSelection,
  planHostSync,
  formatHostSyncReport
} = lazyFunctions('../lib/sync-hosts.js');
const hostCommands = lazyModule('../lib/hosts/commands.js');
const { listDocs, readDoc } = lazyFunctions('../lib/docs.js');
const {
  wantsCommandHelp,
  unknownWriterArgs,
  effectiveCommand,
  commandHelp
} = require('../lib/cli-args.js');
const {
  detectAdapterHints,
  writeShippedAdapter,
  formatGenerateAdapterReport,
  parseTypeArg
} = lazyFunctions('../lib/generate-adapter.js');
const { detectAdapter } = lazyFunctions('../lib/adapter-detect.js');
const { checkAdapter } = lazyFunctions('../lib/adapter-check.js');
const {
  writeWorkflowOverlay,
  formatGenerateWorkflowReport,
  parseWriteArg,
  workflowMarkdown,
  lessonsMarkdown
} = lazyFunctions('../lib/generate-workflow.js');
const {
  RUN_MODES,
  TERMINAL_STATES,
  createOrResumeRun,
  getCurrentRun,
  loadRun,
  newRunId,
  runsDir
} = require('../lib/run-state.js');
const {
  DEFAULT_POLICY,
  assertModeAllowed,
  loadPolicy,
  normalizeMode,
  normalizeReviewProfile,
  updatePolicy
} = require('../lib/runtime-policy.js');
const {
  applyGate,
  judgeRequirement
} = lazyFunctions('../lib/gates.js');
const { initialTierState } = lazyFunctions('../lib/tier.js');
const impactMap = lazyModule('../lib/impact-map.js');
const guard = lazyModule('../lib/guard.js');
const guardHooks = lazyModule('../lib/guard-hooks.js');
const receipts = lazyModule('../lib/receipt.js');
const { learn } = lazyFunctions('../lib/learn.js');
const {
  runBench,
  compareBenches,
  formatCompare,
  parseBenchTimeoutSeconds
} = lazyFunctions('../lib/bench.js');
const {
  createContextPack,
  contextPackSummary
} = lazyFunctions('../lib/safe-context.js');
const {
  assessSmallTaskFastPath,
  buildContextIndex,
  createDiffHunkPack,
  queryContextIndex,
  relatedContextIndex,
  smartContextSummary
} = lazyFunctions('../lib/smart-context.js');
const {
  compactRun
} = lazyFunctions('../lib/run-compaction.js');
const {
  defaultCasesDir,
  loadEvaluationCases,
  loadResults,
  scoreEvaluationResults,
  catalogSummary
} = lazyFunctions('../lib/evaluation.js');
const {
  assessRunEscalation
} = lazyFunctions('../lib/escalation.js');
const {
  writeVerificationSummary
} = lazyFunctions('../lib/verification-summary.js');
const {
  recordVerificationCommands,
  recordVerificationCommand
} = lazyFunctions('../lib/verification-recorder.js');
const {
  scaffoldArtifact,
  validateArtifactFile
} = lazyFunctions('../lib/agent-artifacts.js');
const {
  createClaimedVsRealityTemplate
} = lazyFunctions('../lib/claimed-vs-reality.js');
const {
  runDoctor
} = lazyFunctions('../lib/doctor.js');
const {
  checkForUpdate,
  detectInstallScope,
  executeUpdatePlan
} = lazyFunctions('../lib/update-manager.js');
const autoUpdate = lazyModule('../lib/auto-update.js');
const projectRegistry = lazyModule('../lib/project-registry.js');
const {
  assertBudgetAvailable,
  budgetStatus,
  recordTokenUsage,
  recordUsageUnavailable,
  setKillSwitch
} = lazyFunctions('../lib/budget.js');
const {
  PRIVATE_RUNTIME_GITIGNORE
} = require('../lib/runtime-files.js');
const {
  appendRunAnswer,
  appendRunQuestion,
  closeFreezeQuestions: closeRunFreezeQuestions,
  freezeQuestionMessage,
  listRunInteractions
} = lazyFunctions('../lib/run-interactions.js');
const {
  appendRunLifecycle,
  listRunLifecycle,
  runAgentPresence
} = lazyFunctions('../lib/run-lifecycle.js');
const {
  freezeGoal,
  humanFreezeActor,
  loadGoalDraft,
  saveGoalDraft
} = lazyFunctions('../lib/goal-runtime.js');
const {
  abortSandbox,
  captureSandbox,
  createSandbox,
  sandboxStatus
} = lazyFunctions('../lib/sandbox.js');
const {
  compileRecipe,
  explainPlan,
  listRecipes,
  loadRecipe,
  mermaidPlan,
  simulatePlan,
  validateRecipe
} = lazyFunctions('../lib/recipe.js');
const {
  applyWorkflowGate,
  approveWorkflowNode,
  completeWorkflowNode,
  createWorkflowBundle,
  failWorkflowNode,
  recordWorkflowActivity,
  retryWorkflowNode,
  startWorkflowNode,
  workflowStatus
} = lazyFunctions('../lib/workflow-runtime.js');
const {
  cloneRecipe,
  diffRecipes,
  inspectRecipe,
  installRecipe,
  recipeCatalog
} = lazyFunctions('../lib/recipe-builder.js');
const {
  createHandoff,
  handoffBrief,
  readHandoff,
  verifyHandoff
} = lazyFunctions('../lib/handoff.js');
const { createStudioServer } = lazyFunctions('../lib/studio-server.js');
const { readStudioUrl } = lazyFunctions('../lib/studio/instance.js');

const VERSION = require('../package.json').version;
const CWD = process.cwd();
const CONTEXT_DIR = path.join(CWD, '.ai-engineering-loop');

// Core files in .ai-engineering-loop/
const REQUIRED_FILES = [
  'metadata.json',
  'config.md',
  'architecture.md',
  'conventions.md',
  'verification.md',
  'adapter.md',
  'glossary.md',
  'adrs/README.md'
];

// Non-destructive mode (issue #37, `refresh --non-destructive`): a context file
// is overwritten only if it still matches what AEL last generated (hash in
// .ael-generated.json) or is package-owned; otherwise the new template goes to
// `<file>.ael-new` and the user's file is left alone.
// Legacy projects (no .ael-generated.json yet, decision 5 on #37): the first
// such refresh overwrites AEL-managed files directly, after copying the old
// content into a snapshot under .ai-engineering-loop/.ael-backup/<timestamp>/.
// Hashes are recorded so later refreshes use the normal flow. Only paths this
// writer generates are touched; files written with overwrite:false
// (lessons, glossary, ...) and every other user file are left alone.
let CONTEXT_WRITE_SAFE = false;
let CONTEXT_WRITE_LEGACY = null; // { root, snapshotDir } during a legacy refresh
const CONTEXT_WRITE_REPORT = { updated: [], aelNew: [], kept: [], seen: new Set(), snapshot: [], removed: [], obsoleteKept: [] };
const PACKAGE_OWNED_CONTEXT = new Set(['metadata.json']);
const GENERATED_HASHES_FILE = '.ael-generated.json';

function generatedHashesPath(filePath) {
  return path.join(path.dirname(filePath), GENERATED_HASHES_FILE);
}

function readGeneratedHashes(filePath) {
  return readJsonOptional(generatedHashesPath(filePath), {});
}

function writeGeneratedHashes(filePath, hashes) {
  try {
    fs.writeFileSync(generatedHashesPath(filePath), `${JSON.stringify(hashes, null, 2)}\n`);
  } catch {
    // Best effort.
  }
}

function recordGeneratedHash(filePath, content) {
  const hashes = readGeneratedHashes(filePath);
  hashes[path.basename(filePath)] = sha256Text(content);
  writeGeneratedHashes(filePath, hashes);
}

function snapshotContextFile(filePath) {
  if (!CONTEXT_WRITE_LEGACY || !fs.existsSync(filePath)) return;
  const rel = path.relative(CONTEXT_WRITE_LEGACY.root, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
  const dest = path.join(CONTEXT_WRITE_LEGACY.snapshotDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
  CONTEXT_WRITE_REPORT.snapshot.push(rel.split(path.sep).join('/'));
}

function writeContextFile(filePath, content, { overwrite = true } = {}) {
  CONTEXT_WRITE_REPORT.seen.add(path.resolve(filePath));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!overwrite && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return false;
  }
  const name = path.basename(filePath);
  if (CONTEXT_WRITE_SAFE && fs.existsSync(filePath) && !PACKAGE_OWNED_CONTEXT.has(name)) {
    const current = fs.readFileSync(filePath, 'utf8');
    if (current === content) {
      CONTEXT_WRITE_REPORT.kept.push(name);
      recordGeneratedHash(filePath, content);
      return false;
    }
    if (CONTEXT_WRITE_LEGACY) {
      snapshotContextFile(filePath);
    } else if (readGeneratedHashes(filePath)[name] !== sha256Text(current)) {
      fs.writeFileSync(`${filePath}.ael-new`, content);
      CONTEXT_WRITE_REPORT.aelNew.push(`${name}.ael-new`);
      return false;
    }
  }
  fs.writeFileSync(filePath, content);
  recordGeneratedHash(filePath, content);
  if (CONTEXT_WRITE_SAFE) CONTEXT_WRITE_REPORT.updated.push(name);
  return true;
}

// After a non-destructive refresh: remove AEL-managed files this version no
// longer generates. Normal flow: only files whose recorded hash still matches
// (edited ones are reported and kept); removed files are snapshotted first
// during a legacy refresh.
function removeObsoleteContextFiles(contextDir) {
  const root = path.resolve(contextDir);
  const candidates = new Map();
  const hashDirs = [root];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && fs.existsSync(path.join(root, entry.name, GENERATED_HASHES_FILE))) {
        hashDirs.push(path.join(root, entry.name));
      }
    }
  } catch {
    return;
  }
  for (const dir of hashDirs) {
    const hashes = readGeneratedHashes(path.join(dir, 'x'));
    for (const [name, hash] of Object.entries(hashes)) {
      if (!/^[\w.-]+$/.test(name) || name.startsWith('.')) continue;
      candidates.set(path.join(dir, name), { hash, dir, name });
    }
  }
  for (const [abs, info] of candidates) {
    if (CONTEXT_WRITE_REPORT.seen.has(abs)) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      stat = null;
    }
    if (stat && stat.isFile()) {
      if (sha256Text(fs.readFileSync(abs)) !== info.hash) {
        CONTEXT_WRITE_REPORT.obsoleteKept.push(rel);
        continue;
      }
      snapshotContextFile(abs);
      fs.unlinkSync(abs);
      CONTEXT_WRITE_REPORT.removed.push(rel);
    }
    const hashes = readGeneratedHashes(path.join(info.dir, 'x'));
    if (Object.hasOwn(hashes, info.name)) {
      delete hashes[info.name];
      writeGeneratedHashes(path.join(info.dir, 'x'), hashes);
    }
  }
}

function ignoreProjectContextOnFirstInit(rootDir) {
  const filePath = path.join(rootDir, '.gitignore');
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    const error = new Error('Refusing to update a symlinked project .gitignore');
    error.code = 'UNSAFE_GITIGNORE';
    throw error;
  }
  const current = readFileSafe(filePath) || '';
  const alreadyIgnored = current.split(/\r?\n/)
    .some((line) => line.trim().replace(/\/+$/, '') === '.ai-engineering-loop');
  if (alreadyIgnored) return false;
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(filePath, `${current}${separator}.ai-engineering-loop/\n`);
  return true;
}

/**
 * Colorized console helpers
 */
const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (msg) => (COLOR ? console.log(`\x1b[${code}m%s\x1b[0m`, msg) : console.log(msg));
const log = {
  info: paint(36),
  success: paint(32),
  warn: paint(33),
  error: paint(31),
  bold: paint(1),
  dim: paint(2)
};

/**
 * Safe file reader
 */
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

/**
 * Compute SHA256 checksum of a file
 */
function getFileChecksum(filePath) {
  const content = readFileSafe(filePath);
  if (!content) return null;
  return sha256Text(content).slice(0, 16);
}

/**
 * Get current git HEAD revision (Level 0 signal)
 */
function getGitRevision(rootDir) {
  try {
    return execSync('git rev-parse HEAD', { cwd: rootDir, stdio: ['pipe', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch (e) {
    return 'untracked';
  }
}

/**
 * Repository Discovery Engine
 */
function gitDefaultBranch(rootDir) {
  const run = (args) => {
    try {
      return execSync(`git ${args}`, { cwd: rootDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  const remote = run('symbolic-ref --quiet --short refs/remotes/origin/HEAD').replace(/^origin\//, '');
  return remote || run('symbolic-ref --quiet --short HEAD') || null;
}

function analyzeRepository(rootDir) {
  const discovery = {
    projectName: path.basename(rootDir),
    isMonorepo: false,
    profile: 'backend-api',
    profileConfidence: 'LOW',
    languages: [],
    frameworks: [],
    packageManager: 'npm',
    scripts: {
      testUnit: 'npm test',
      testAll: 'npm test',
      typecheck: null,
      lint: null,
      build: null,
      e2e: null
    },
    adapter: {
      type: 'standard',
      repoSlug: null,
      defaultBranch: 'main',
      ciProvider: 'none'
    },
    topLevelDirs: [],
    manifestChecksums: {},
    evidence: []
  };

  // Inspect directory structure
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    discovery.topLevelDirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name);
  } catch (e) {}

  // 1. Monorepo & Topology Detection
  const hasApps = fs.existsSync(path.join(rootDir, 'apps'));
  const hasPackages = fs.existsSync(path.join(rootDir, 'packages'));
  const hasPnpmWorkspace = fs.existsSync(path.join(rootDir, 'pnpm-workspace.yaml'));
  const hasTurbo = fs.existsSync(path.join(rootDir, 'turbo.json'));
  const hasNx = fs.existsSync(path.join(rootDir, 'nx.json'));
  const hasLerna = fs.existsSync(path.join(rootDir, 'lerna.json'));
  const hasGoWork = fs.existsSync(path.join(rootDir, 'go.work'));

  if (hasPnpmWorkspace || hasTurbo || hasNx || hasLerna || hasGoWork || (hasApps && hasPackages)) {
    discovery.isMonorepo = true;
    discovery.profile = 'monorepo';
    discovery.evidence.push('Topology: Monorepo workspace detected');
  }

  // 2. Package Managers & Manifests
  if (fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml')) || hasPnpmWorkspace) {
    discovery.packageManager = 'pnpm';
  } else if (fs.existsSync(path.join(rootDir, 'yarn.lock'))) {
    discovery.packageManager = 'yarn';
  } else if (fs.existsSync(path.join(rootDir, 'bun.lockb')) || fs.existsSync(path.join(rootDir, 'bun.lock'))) {
    discovery.packageManager = 'bun';
  }

  // Track manifest checksums
  const pkgPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    discovery.manifestChecksums['package.json'] = getFileChecksum(pkgPath);
    discovery.evidence.push('Manifest: package.json');
    try {
      const pkg = JSON.parse(readFileSafe(pkgPath) || '{}');
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const usesTypeScript = Boolean(allDeps.typescript) || fs.existsSync(path.join(rootDir, 'tsconfig.json'));
      discovery.languages.push(usesTypeScript ? 'TypeScript' : 'JavaScript');
      const frameworksBefore = discovery.frameworks.length;

      if (allDeps['next']) { discovery.frameworks.push('Next.js'); if (!discovery.isMonorepo) discovery.profile = 'web-app'; }
      if (allDeps['react']) { discovery.frameworks.push('React'); if (!discovery.isMonorepo) discovery.profile = 'web-app'; }
      if (allDeps['vue']) { discovery.frameworks.push('Vue'); if (!discovery.isMonorepo) discovery.profile = 'web-app'; }
      if (allDeps['svelte'] || allDeps['@sveltejs/kit']) { discovery.frameworks.push('Svelte'); if (!discovery.isMonorepo) discovery.profile = 'web-app'; }
      if (allDeps['@nestjs/core']) { discovery.frameworks.push('NestJS'); if (!discovery.isMonorepo) discovery.profile = 'backend-api'; }
      if (allDeps['express']) { discovery.frameworks.push('Express'); if (!discovery.isMonorepo) discovery.profile = 'backend-api'; }
      if (allDeps['fastify']) { discovery.frameworks.push('Fastify'); if (!discovery.isMonorepo) discovery.profile = 'backend-api'; }
      if (allDeps['@prisma/client'] || allDeps['prisma']) { discovery.frameworks.push('Prisma ORM'); }
      if (discovery.frameworks.length > frameworksBefore) discovery.profileConfidence = 'HIGH';
      else if (!discovery.isMonorepo) {
        discovery.profile = 'library';
        discovery.profileConfidence = 'LOW';
        discovery.evidence.push(`Profile: library (no web or server framework found${pkg.bin ? '; package has a bin, so it is a CLI' : ''}); edit config.md if this is a service`);
      }

      // Script mapping
      const scripts = pkg.scripts || {};
      const pm = discovery.packageManager;
      if (scripts['test:unit']) discovery.scripts.testUnit = `${pm} run test:unit`;
      else if (scripts['test']) discovery.scripts.testUnit = `${pm} test`;
      // Fast verification lane (`verify --related`): the runner's own
      // related-test selection, through the project's test script when it has one.
      const testScript = scripts['test:unit'] ? 'test:unit' : (scripts['test'] ? 'test' : null);
      const viaScript = (extra) => (testScript ? `${pm} run ${testScript}${pm === 'npm' ? ' --' : ''} ${extra}` : null);
      if (allDeps['vitest']) discovery.scripts.testRelated = `npx vitest related --run --passWithNoTests {files}`;
      else if (allDeps['jest'] || allDeps['ts-jest']) {
        discovery.scripts.testRelated = viaScript('--findRelatedTests --passWithNoTests {files}') || 'npx jest --findRelatedTests --passWithNoTests {files}';
      }

      // Only commands the project really has: a guessed `npx tsc` can fetch an
      // unrelated package, and `eslint --fix` would edit files during verify.
      const hasTypeScript = Boolean(allDeps['typescript']) || fs.existsSync(path.join(rootDir, 'tsconfig.json'));
      if (scripts['typecheck']) discovery.scripts.typecheck = `${pm} run typecheck`;
      else if (scripts['type-check']) discovery.scripts.typecheck = `${pm} run type-check`;
      else if (scripts['check']) discovery.scripts.typecheck = `${pm} run check`;
      else discovery.scripts.typecheck = hasTypeScript ? 'npx tsc --noEmit' : null;

      discovery.scripts.lint = scripts['lint'] ? `${pm} run lint` : null;
      discovery.scripts.build = scripts['build'] ? `${pm} run build` : null;
      if (scripts['test:e2e']) discovery.scripts.e2e = `${pm} run test:e2e`;
    } catch (e) {}
  }

  // Go
  const goModPath = path.join(rootDir, 'go.mod');
  if (fs.existsSync(goModPath)) {
    discovery.manifestChecksums['go.mod'] = getFileChecksum(goModPath);
    discovery.languages.push('Go');
    if (!discovery.isMonorepo) discovery.profile = 'backend-api';
    discovery.scripts.testUnit = 'go test -v ./...';
    discovery.scripts.build = 'go build ./...';
    discovery.scripts.typecheck = 'go vet ./...';
    discovery.evidence.push('Manifest: go.mod');
  }

  // Rust
  const cargoPath = path.join(rootDir, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    discovery.manifestChecksums['Cargo.toml'] = getFileChecksum(cargoPath);
    discovery.languages.push('Rust');
    if (!discovery.isMonorepo) discovery.profile = 'library';
    discovery.scripts.testUnit = 'cargo test';
    discovery.scripts.build = 'cargo build';
    discovery.scripts.typecheck = 'cargo check';
    discovery.scripts.lint = 'cargo clippy';
    discovery.evidence.push('Manifest: Cargo.toml');
  }

  // Python
  const pyprojPath = path.join(rootDir, 'pyproject.toml');
  const reqPath = path.join(rootDir, 'requirements.txt');
  if (fs.existsSync(pyprojPath) || fs.existsSync(reqPath)) {
    if (fs.existsSync(pyprojPath)) discovery.manifestChecksums['pyproject.toml'] = getFileChecksum(pyprojPath);
    if (fs.existsSync(reqPath)) discovery.manifestChecksums['requirements.txt'] = getFileChecksum(reqPath);
    discovery.languages.push('Python');
    if (!discovery.isMonorepo) discovery.profile = 'backend-api';
    discovery.scripts.testUnit = 'pytest';
    discovery.scripts.typecheck = 'mypy .';
    discovery.scripts.lint = 'ruff check .';
    discovery.evidence.push('Manifest: pyproject.toml / requirements.txt');
  }

  // Flutter / Mobile
  const pubspecPath = path.join(rootDir, 'pubspec.yaml');
  if (fs.existsSync(pubspecPath)) {
    discovery.manifestChecksums['pubspec.yaml'] = getFileChecksum(pubspecPath);
    discovery.languages.push('Dart / Flutter');
    discovery.profile = 'mobile-app';
    discovery.scripts.testUnit = 'flutter test';
    discovery.scripts.typecheck = 'dart analyze';
    discovery.scripts.build = 'flutter build bundle';
    discovery.evidence.push('Manifest: pubspec.yaml');
  }

  // 3. Adapter / CI Detection (shared with generate-adapter and Studio, #62)
  const detected = detectAdapter(rootDir);
  discovery.adapter.defaultBranch = gitDefaultBranch(rootDir) || discovery.adapter.defaultBranch;
  discovery.adapter.type = detected.type;
  discovery.adapter.ciProvider = detected.ciProvider;
  discovery.adapter.repoSlug = detected.remote || null;
  discovery.evidence.push(`Adapter: ${detected.type} (${detected.reason})`);

  return discovery;
}

/**
 * Generate Context Files (Including metadata.json Baseline)
 */
function generateContextFiles(rootDir, discovery, trigger = 'init', impact = 'INITIAL_BOOTSTRAP', options = {}) {
  const overwriteCore = options.overwriteCore !== false;
  const targetDir = path.join(rootDir, '.ai-engineering-loop');
  fs.mkdirSync(targetDir, { recursive: true });

  const currentRevision = getGitRevision(rootDir);

  // 0. metadata.json (Baseline)
  const metadataJson = {
    contextVersion: VERSION,
    generatedAt: new Date().toISOString(),
    repositoryRevision: currentRevision,
    projectProfile: discovery.profile,
    manifestChecksums: discovery.manifestChecksums,
    lastReconciliation: {
      timestamp: new Date().toISOString(),
      trigger,
      impact
    }
  };
  writeContextFile(
    path.join(targetDir, 'metadata.json'),
    JSON.stringify(metadataJson, null, 2) + '\n',
    { overwrite: overwriteCore }
  );

  // 1. config.md
  const configMd = `# Project Configuration

## Metadata
- **project_name**: "${discovery.projectName}"
- **project_profile**: "${discovery.profile}" # Archetype from profiles/${discovery.profile}.md
- **languages**:
${discovery.languages.map((l) => `  - ${l}`).join('\n') || '  - Unspecified'}
- **frameworks**:
${discovery.frameworks.map((f) => `  - ${f}`).join('\n') || '  - Standard'}
- **package_manager**: "${discovery.packageManager}"
- **default_base_branch**: "${discovery.adapter.defaultBranch}"

## Observed Evidence
${discovery.evidence.map((e) => `- ${e}`).join('\n')}
`;
  writeContextFile(path.join(targetDir, 'config.md'), configMd, { overwrite: overwriteCore });

  // 2. architecture.md
  const archMd = `# Project Architecture

## System Overview
Discovered architecture for ${discovery.projectName} (${discovery.profile}).

## Discovered Top-Level Directories
${discovery.topLevelDirs.map((d) => `- \`${d}/\``).join('\n') || '- Flat directory layout'}

## Boundary Invariants
- Preserve existing component boundaries and modular encapsulation.
- Zero circular dependencies across packages or modules.
- Changes must be surgical and adhere to existing architecture patterns.

## Evidence & Confidence
- Observed from: Directory scan, package manifests
- Confidence: ${discovery.profileConfidence || 'LOW'}${discovery.profileConfidence === 'HIGH' ? '' : ' (no framework evidence; confirm the profile and boundaries in config.md)'}
`;
  writeContextFile(path.join(targetDir, 'architecture.md'), archMd, { overwrite: overwriteCore });

  // 3. conventions.md
  const convMd = `# Project Conventions

## Code Standards
- File naming: kebab-case or established repository convention.
- Error handling: Use domain-specific errors; zero empty catch blocks.
- Types: Strict typing; zero unnecessary \`any\` types.

## Forbidden Anti-Patterns
- Zero speculative TODOs or orphan dead code in production pull requests.
- Never commit private secrets, passwords, or API keys.
- Do not make unsolicited renovations outside the active Goal Contract scope.
`;
  writeContextFile(path.join(targetDir, 'conventions.md'), convMd, { overwrite: overwriteCore });

  // 4. verification.md
  const verifyMd = `# Project Verification Commands

## Discovered Verification Commands
- **test_unit**: \`${discovery.scripts.testUnit}\`
${discovery.scripts.typecheck ? `- **typecheck**: \`${discovery.scripts.typecheck}\`` : ''}
${discovery.scripts.lint ? `- **lint**: \`${discovery.scripts.lint}\`` : ''}
${discovery.scripts.build ? `- **build**: \`${discovery.scripts.build}\`` : ''}
${discovery.scripts.e2e ? `- **e2e**: \`${discovery.scripts.e2e}\`` : ''}
${discovery.scripts.testRelated ? `- **test_related**: \`${discovery.scripts.testRelated}\`` : ''}

## Verification Protocol
- Default order, cheapest first, stop at the first failure: build -> typecheck -> lint -> test_unit -> security scan (for example \`npm audit --omit=dev\`) -> e2e (optional).
- 100% deterministic checks must pass before Devil's Advocate review.
- Unit tests must cover boundary cases, null safety, and error paths.
`;
  writeContextFile(path.join(targetDir, 'verification.md'), verifyMd, { overwrite: overwriteCore });

  // 5. adapter.md
  const adapterMd = `# Project Delivery Adapter Configuration

## Delivery Pipeline
- **adapter_type**: "${discovery.adapter.type}" # standard | github | gitlab | dot | custom
${discovery.adapter.repoSlug ? `- **remote_repository**: "${discovery.adapter.repoSlug}"` : ''}
- **default_target_branch**: "${discovery.adapter.defaultBranch}"
- **ci_provider**: "${discovery.adapter.ciProvider}"
`;
  writeContextFile(path.join(targetDir, 'adapter.md'), adapterMd, { overwrite: overwriteCore });

  const glossaryMd = `# Ubiquitous Language

One term per concept. Agents and humans use these words in Goal Contracts, tests, code names, and review.

## Terms

| Term | Meaning | Do not say |
|---|---|---|
| Goal Contract | Frozen Stage 1 acceptance document | "the prompt" |
| Seam | Public interface under test | "the internals" |

Update this file during Stage 1 grill when a term is coined or corrected.
`;
  writeContextFile(path.join(targetDir, 'glossary.md'), glossaryMd, { overwrite: false });

  const adrReadme = `# Architecture Decision Records

Hard decisions that would otherwise live only in chat. Write one ADR when Stage 1 grill settles a choice that future agents must not re-litigate.

File name: \`NNN-short-kebab-title.md\`

## Template

\`\`\`markdown
# ADR NNN: <title>

## Status
Accepted

## Context
What forced a choice.

## Decision
What we chose, in glossary terms.

## Consequences
What becomes easier, harder, or forbidden.
\`\`\`
`;
  writeContextFile(path.join(targetDir, 'adrs', 'README.md'), adrReadme, { overwrite: false });

  writeContextFile(path.join(targetDir, 'workflow.md'), workflowMarkdown(), { overwrite: false });
  writeContextFile(path.join(targetDir, 'lessons.md'), lessonsMarkdown(), { overwrite: false });
  writeContextFile(
    path.join(targetDir, 'runtime-policy.json'),
    `${JSON.stringify(DEFAULT_POLICY, null, 2)}\n`,
    { overwrite: false }
  );
  writeContextFile(
    path.join(targetDir, '.gitignore'),
    PRIVATE_RUNTIME_GITIGNORE,
    { overwrite: false }
  );
  try {
    require('../lib/sources.js').writeSourcesFile(rootDir);
  } catch {
    log.dim('sources.md was not written; run `ai-engineering-loop sources refresh` later.');
  }
}

/**
 * Validate Context Integrity
 */
function validateContext(targetDir) {
  if (!fs.existsSync(targetDir)) return { valid: false, reason: 'Directory missing' };
  for (const f of REQUIRED_FILES) {
    const fullPath = path.join(targetDir, f);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size === 0) {
      return { valid: false, reason: `Missing or empty ${f}` };
    }
  }
  return { valid: true };
}

/**
 * Evaluate Drift Against Baseline (Progressive Level 0 & Level 1)
 */
function evaluateDrift(rootDir, targetDir) {
  const metadataPath = path.join(targetDir, 'metadata.json');
  const metadataStr = readFileSafe(metadataPath);
  if (!metadataStr) return { status: 'STALE', reason: 'Missing metadata.json baseline' };

  let metadata;
  try {
    metadata = JSON.parse(metadataStr);
  } catch (e) {
    return { status: 'STALE', reason: 'Corrupt metadata.json' };
  }

  const currentRevision = getGitRevision(rootDir);
  const baselineRevision = metadata.repositoryRevision || 'unknown';

  // Check manifest checksums (Level 0)
  const currentManifests = {};
  for (const manifest of ['package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'requirements.txt', 'pubspec.yaml']) {
    const p = path.join(rootDir, manifest);
    if (fs.existsSync(p)) {
      currentManifests[manifest] = getFileChecksum(p);
    }
  }

  const baselineManifests = metadata.manifestChecksums || {};
  let manifestDrift = false;
  const changedManifests = [];

  for (const [m, hash] of Object.entries(currentManifests)) {
    if (baselineManifests[m] !== hash) {
      manifestDrift = true;
      changedManifests.push(m);
    }
  }

  if (manifestDrift) {
    return {
      status: 'STALE',
      reason: `Manifest drift detected in: ${changedManifests.join(', ')}`,
      level: 'LEVEL_2'
    };
  }

  if (currentRevision === baselineRevision || currentRevision === 'untracked') {
    return { status: 'CURRENT', reason: 'Git HEAD and manifest checksums match baseline (Level 0)', level: 'LEVEL_0' };
  }

  // Inspect touched files if HEAD advanced (Level 1)
  try {
    const diffFiles = execSync(`git diff --name-only ${baselineRevision}..HEAD`, { cwd: rootDir, stdio: ['pipe', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean);

    const architecturalFiles = diffFiles.filter(
      (f) =>
        f.endsWith('.json') ||
        f.endsWith('.toml') ||
        f.endsWith('.yaml') ||
        f.endsWith('.yml') ||
        f.startsWith('.github/') ||
        f.startsWith('.gitlab-ci')
    );

    if (architecturalFiles.length === 0) {
      return {
        status: 'CURRENT',
        reason: `HEAD advanced but only non-architectural files modified (${diffFiles.length} files)`,
        level: 'LEVEL_1'
      };
    } else {
      return {
        status: 'POSSIBLE_DRIFT',
        reason: `Architectural files modified: ${architecturalFiles.join(', ')}`,
        level: 'LEVEL_2'
      };
    }
  } catch (e) {
    return { status: 'CURRENT', reason: 'Unable to compute git diff; manifests match', level: 'LEVEL_0' };
  }
}

/**
 * Command Handlers
 */

// Command: init
function handleInit() {
  log.info('AI Engineering Loop — Project Context Bootstrap (init)');
  log.dim(`Target directory: ${CWD}`);

  const firstInitialization = !fs.existsSync(CONTEXT_DIR);
  let overwriteCore = true;
  let trigger = 'init';
  let impact = 'INITIAL_BOOTSTRAP';

  if (fs.existsSync(CONTEXT_DIR)) {
    const validation = validateContext(CONTEXT_DIR);
    if (validation.valid) {
      log.success('✓ .ai-engineering-loop/ already exists and is valid.');
      const drift = evaluateDrift(CWD, CONTEXT_DIR);
      console.log(`- Baseline Status: ${drift.status} (${drift.reason})`);
      log.dim('Run "npx ai-engineering-loop status" to inspect health, or "refresh" to update.');
      process.exit(0);
    } else {
      log.warn(`! Existing .ai-engineering-loop/ found but incomplete: ${validation.reason}. Repairing...`);
      overwriteCore = false;
      trigger = 'repair';
      impact = 'REPAIR_MISSING';
    }
  }

  log.info('Analyzing repository topology and manifests...');
  const discovery = analyzeRepository(CWD);

  if (!Object.keys(discovery.manifestChecksums || {}).length && !discovery.languages.length) {
    log.warn('> No manifest found (package.json, go.mod, pyproject.toml, ...): profile unknown, no test command. Edit .ai-engineering-loop/verification.md once the project has one.');
  } else {
    log.dim(`> Profile Bound: ${discovery.profile}${discovery.profileConfidence === 'HIGH' ? '' : ' (guessed: no framework found; change it in config.md if wrong)'}`);
    log.dim(`> Languages: ${discovery.languages.join(', ') || 'Unspecified'}`);
    log.dim(`> Package Manager: ${discovery.packageManager}`);
    log.dim(`> Unit Test Command: ${discovery.scripts.testUnit}`);
  }
  const wantedNode = Number(String(require('../package.json').engines?.node || '>=18').match(/\d+/)?.[0] || 18);
  if (Number(process.versions.node.split('.')[0]) < wantedNode) log.warn(`! Node ${process.versions.node} is older than the supported ${wantedNode}; some commands may fail. FIX: install Node ${wantedNode}+.`);

  if (firstInitialization && ignoreProjectContextOnFirstInit(CWD)) {
    log.dim('> .gitignore now ignores .ai-engineering-loop/. Commit it on its own so it stays out of your next change: git add .gitignore && git commit -m "Ignore AEL context"');
  }
  generateContextFiles(CWD, discovery, trigger, impact, { overwriteCore });

  const validation = validateContext(CONTEXT_DIR);
  if (validation.valid) {
    log.success('\n✓ Successfully initialized .ai-engineering-loop/ with:');
    REQUIRED_FILES.forEach((f) => console.log(`  - .ai-engineering-loop/${f}`));
    log.dim('\nProject context is private by default. Remove .ai-engineering-loop/ from .gitignore if you want to share it.');
    if (!agentSkillState().installed) log.warn(SETUP_HINT);
    offerFeatureMapScaffold();
  } else {
    log.error(`\n✗ Initialization validation failed: ${validation.reason}`);
    process.exit(1);
  }
}

// Optional next step. A TTY may say yes; everyone else only sees the command.
function offerFeatureMapScaffold() {
  const hint = 'Optional next step: `ael feature-map scaffold` drafts .ai-engineering-loop/feature-map.md from routes, OpenAPI, pages, or the README. It does not overwrite a map you edit.';
  try {
    if (fs.existsSync(path.join(CONTEXT_DIR, 'feature-map.md'))) return;
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      log.dim(hint);
      return;
    }
    process.stdout.write('Draft a feature map from routes, OpenAPI, pages, or the README? [y/N]: ');
    const buffer = Buffer.alloc(16);
    const bytes = fs.readSync(0, buffer, 0, buffer.length, null);
    const answer = buffer.toString('utf8', 0, bytes).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      log.dim(hint);
      return;
    }
    const result = require('../lib/feature-map.js').scaffoldFeatureMap(CWD);
    if (result.written) log.success(`✓ ${result.written} (${result.rows} row(s) from ${result.signals.join(', ') || 'stub'})`);
    else log.dim(hint);
  } catch {
    log.dim(hint);
  }
}

// Command: status
function statusJson() {
  const result = {
    ok: false,
    status: 'NOT_INITIALIZED',
    packageVersion: VERSION,
    project: path.basename(CWD),
    studioUrl: readStudioUrl(CWD),
    hostSkills: hostSkillStatus({ home: homeDir(), version: VERSION })
  };
  if (fs.existsSync(CONTEXT_DIR)) {
    const validation = validateContext(CONTEXT_DIR);
    if (!validation.valid) {
      result.status = 'INCOMPLETE';
      result.reason = validation.reason;
    } else {
      let metadata = {};
      try { metadata = JSON.parse(readFileSafe(path.join(CONTEXT_DIR, 'metadata.json')) || '{}'); } catch (e) {}
      const drift = evaluateDrift(CWD, CONTEXT_DIR);
      result.ok = true;
      result.status = 'READY';
      result.contextVersion = metadata.contextVersion || null;
      result.projectProfile = metadata.projectProfile || null;
      result.freshness = { status: drift.status, reason: drift.reason, level: drift.level || null };
      const activeRun = currentRunSafe(CWD);
      if (activeRun && !TERMINAL_STATES.has(activeRun.state)) {
        const info = require('../lib/run-abandon.js').staleRunInfo(activeRun);
        result.activeRun = { runId: activeRun.runId, state: activeRun.state, updatedAt: activeRun.updatedAt || null, stale: info.stale, idleDays: info.idleDays };
        if (info.stale) result.activeRun.hint = require('../lib/run-abandon.js').abandonCommand(activeRun.runId);
      }
      const worktreeHint = require('../lib/run-isolation.js').pruneHint(CWD);
      if (worktreeHint) result.worktreeHint = worktreeHint;
    }
  }
  return result;
}

function agentSkillState() {
  try {
    const hosts = hostSkillStatus({ home: homeDir(), version: VERSION });
    return { hosts, installed: hosts.managedFiles > 0 || Boolean(hosts.installedVersion) };
  } catch {
    return { hosts: null, installed: true };
  }
}

const SETUP_HINT = 'Next: `ael setup` installs the ael skill into the coding agents on this machine (Claude Code, Codex, Cursor, ...); then start a new agent session. No agent yet? See README "Bring your own AI agent".';

function handleStatus() {
  if (command === 'status' && process.argv.includes('--json')) {
    const result = statusJson();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  log.info('AI Engineering Loop — Project Context Status (status)');
  log.dim(`Target directory: ${CWD}`);

  if (!fs.existsSync(CONTEXT_DIR)) {
    log.warn('Status: NOT INITIALIZED');
    log.dim('Run "npx ai-engineering-loop init" to bootstrap context.');
    process.exit(1);
  }

  const validation = validateContext(CONTEXT_DIR);
  if (!validation.valid) {
    log.error(`Status: INCOMPLETE (${validation.reason})`);
    log.dim('Run "npx ai-engineering-loop refresh" or "init" to repair.');
    process.exit(1);
  }

  const metadataStr = readFileSafe(path.join(CONTEXT_DIR, 'metadata.json'));
  let metadata = {};
  try { metadata = JSON.parse(metadataStr || '{}'); } catch (e) {}

  const drift = evaluateDrift(CWD, CONTEXT_DIR);

  log.success('Status: READY & VALID');
  console.log(`- Project Name: ${path.basename(CWD)}`);
  console.log(`- Project Profile: ${metadata.projectProfile || 'unspecified'}`);
  const gitState = require('../lib/git-readiness.js').gitReadiness(CWD);
  const baseline = metadata.repositoryRevision && /^[0-9a-f]{7,}$/.test(metadata.repositoryRevision) ? metadata.repositoryRevision.slice(0, 8) : 'none';
  console.log(`- Context Baseline Git: ${baseline}`);
  if (gitState.ok) console.log(`- Living Freshness: ${COLOR ? `\x1b[32m${drift.status}\x1b[0m` : drift.status} (${drift.reason})`);
  else {
    log.warn(`- Git: NOT READY (${gitState.message}); a Run cannot start.`);
    log.dim(`  FIX: ${gitState.fix}`);
  }
  for (const warning of gitState.warnings || []) log.warn(`- Git: ${warning}`);
  console.log(`- Context Files: ${REQUIRED_FILES.length}/${REQUIRED_FILES.length} verified (including metadata.json, glossary.md, adrs/)`);

  const activeRun = currentRunSafe(CWD);
  if (activeRun && !TERMINAL_STATES.has(activeRun.state)) {
    console.log(`- Active run: ${activeRun.runId} (${activeRun.state})`);
    const provenance = require('../lib/provenance.js').loadProvenance(CWD, activeRun.runId);
    if (provenance && provenance.unconfirmed.length) {
      log.warn(`- Unconfirmed: ${provenance.unconfirmed.length} assumption(s) in the Goal (not blocking)`);
      for (const text of provenance.unconfirmed.slice(0, 5)) log.dim(`  - ${text}`);
    }
    const hint = staleRunHint(activeRun);
    if (hint) log.warn(`  ${hint}`);
  }
  const worktreeHint = require('../lib/run-isolation.js').pruneHint(CWD);
  if (worktreeHint) log.warn(`- ${worktreeHint}`);

  const { hosts, installed } = agentSkillState();
  if (!installed) {
    log.warn('- Host skills: NOT INSTALLED (no agent on this machine has the ael skill yet)');
    log.dim(`  ${SETUP_HINT}`);
  } else if (hosts.stale) {
    log.warn(`- Host skills: STALE (${hosts.staleFiles} file(s) behind package v${VERSION}${hosts.installedVersion ? `, installed v${hosts.installedVersion}` : ''})`);
    log.dim('  Run "npx ai-engineering-loop sync-hosts" (or "update apply --yes" after a package upgrade), then start a new session.');
  } else {
    console.log(`- Host skills: CURRENT (${hosts.managedFiles} managed file(s) match v${VERSION}; packs: ${hosts.packs.join(', ')})`);
  }
}

// Command: refresh
function handleGarden() {
  const json = process.argv.includes('--json');
  if (process.argv.includes('--non-destructive')) {
    stageJsonError(Object.assign(new Error('--garden does not reconcile context. Nothing was written.'), {
      code: 'INVALID_USAGE',
      why: 'Garden only reports stale learnings, feature-map rows, and old Runs.',
      fix: 'ael refresh --garden'
    }), json, 'INVALID_USAGE');
  }
  try {
    const garden = require('../lib/garden.js');
    const apply = process.argv.includes('--yes');
    const result = apply ? garden.applyGarden(CWD) : garden.planGarden(CWD);
    if (json) {
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      return;
    }
    console.log(`Garden${apply ? '' : ' (dry-run, nothing written)'}`);
    if (!result.learnings.length) console.log('Learnings: nothing stale');
    for (const item of result.learnings) console.log(`Learning ${item.id}: ${item.action} (${item.reason})`);
    if (result.featureMapSkipped) console.log(`Feature map: skipped (${result.featureMapSkipped})`);
    else if (!result.featureMap.length) console.log('Feature map: nothing stale');
    for (const row of result.featureMap) console.log(`Feature ${row.id}: ${row.action}${row.reason ? ` (${row.reason})` : ''} ${row.paths.join(', ')}`);
    if (!result.runs.length) console.log('Runs: nothing old');
    for (const row of result.runs) console.log(`Run ${row.runId} ${row.state} ${row.ageDays}d: ${row.action}. ${row.note}`);
    console.log(apply
      ? `Wrote: ${result.written.join(', ') || '(nothing)'}`
      : `Would write: ${result.writes.join(', ') || '(nothing)'}. Apply with: ael refresh --garden --yes`);
  } catch (err) {
    stageJsonError(err, json, 'GARDEN_FAILED');
  }
}

function handleRefresh() {
  if (process.argv.includes('--garden')) {
    handleGarden();
    return;
  }
  if (process.argv.includes('--yes')) {
    stageJsonError(Object.assign(new Error('--yes applies a garden tidy. Nothing was written.'), {
      code: 'INVALID_USAGE',
      why: 'refresh --yes is not a context refresh.',
      fix: 'ael refresh --garden --yes'
    }), process.argv.includes('--json'), 'INVALID_USAGE');
  }
  if (process.argv.includes('--non-destructive')) {
    handleSafeRefresh();
    return;
  }
  log.info('AI Engineering Loop — Context Drift Refresh (refresh)');
  log.dim(`Target directory: ${CWD}`);

  if (!fs.existsSync(CONTEXT_DIR)) {
    log.warn('Context not found. Initializing fresh context...');
    handleInit();
    return;
  }

  const validation = validateContext(CONTEXT_DIR);
  if (!validation.valid) {
    log.info(`Incomplete context: ${validation.reason}. Filling missing files without overwriting filled ones...`);
    const discovery = analyzeRepository(CWD);
    generateContextFiles(CWD, discovery, 'refresh', 'REPAIR_MISSING', { overwriteCore: false });
  }

  const drift = evaluateDrift(CWD, CONTEXT_DIR);
  if (drift.status === 'CURRENT' && validateContext(CONTEXT_DIR).valid) {
    log.success('✓ Context is already CURRENT. No changes required.');
    log.dim(`Reason: ${drift.reason}`);
    process.exit(0);
  }

  log.info(`Drift detected: ${drift.reason}. Reconciling context...`);
  const discovery = analyzeRepository(CWD);

  generateContextFiles(CWD, discovery, 'refresh', 'DRIFT_RECONCILIATION', { overwriteCore: true });

  log.success('✓ Context reconciled non-destructively.');
  handleStatus();
}

function handleSyncHosts() {
  const dryRun = process.argv.includes('--dry-run');
  const prune = process.argv.includes('--prune');
  const json = process.argv.includes('--json');
  const packArg = argValue('--pack');
  let results;
  try {
    results = applyHostSync({
      home: homeDir(),
      dryRun,
      prune,
      packs: packArg == null ? null : packArg,
      version: VERSION
    });
  } catch (err) {
    log.error(`${err.code || 'SYNC_FAILED'}: ${err.message}`);
    process.exit(2);
  }
  if (json) {
    console.log(JSON.stringify({
      ok: true,
      version: VERSION,
      dryRun,
      packs: results.packs,
      packSource: results.packSource,
      files: results.map(({ content, ...item }) => item)
    }, null, 2));
    return;
  }
  log.info(`AI Engineering Loop — Sync host skills (sync-hosts)${dryRun ? ' [dry-run]' : ''}`);
  console.log(formatHostSyncReport(results, { version: VERSION, dryRun }));
}

function hostSyncOrExit(selection, { dryRun = false } = {}) {
  try {
    return applyHostSync({ home: homeDir(), hosts: selection, dryRun, version: VERSION });
  } catch (err) {
    log.error(`${err.code || 'SYNC_FAILED'}: ${err.message}`);
    process.exit(2);
  }
}

function readTtyLine(question, fallback) {
  process.stdout.write(question);
  try {
    const buffer = Buffer.alloc(64);
    const bytes = fs.readSync(0, buffer, 0, buffer.length, null);
    return buffer.toString('utf8', 0, bytes).trim().toLowerCase() || fallback;
  } catch {
    return fallback;
  }
}

// `hosts list|doctor|enable|disable` (issues #49, #52).
function handleHosts() {
  const rest = process.argv.slice(3).filter((arg) => !arg.startsWith('-'));
  const sub = rest[0] || 'list';
  const json = process.argv.includes('--json');
  const home = homeDir();
  const selection = resolveHostSelection(home);
  if (sub === 'list') {
    const rows = hostCommands.listHosts({ home, selection });
    if (json) {
      console.log(JSON.stringify({ ok: true, source: selection.source, mode: selection.mode, hosts: rows }, null, 2));
      return;
    }
    console.log(hostCommands.formatHostsList(rows, selection));
    if (selection.source !== 'config') console.log('Run "ai-engineering-loop setup" to choose hosts explicitly.');
    return;
  }
  if (sub === 'doctor') {
    const { hostsDoctor, formatHostsDoctor } = require('../lib/hosts/doctor.js');
    const report = hostsDoctor({ home, selection, plan: planHostSync({ home, hosts: selection }) });
    console.log(json ? JSON.stringify(report, null, 2) : formatHostsDoctor(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (sub !== 'enable' && sub !== 'disable') {
    log.error(`Unknown hosts subcommand "${sub}". Use: list, doctor, enable <id...>, disable <id...>. Nothing was written.`);
    process.exit(2);
  }
  let ids;
  try {
    ids = hostCommands.parseHostIds(rest.slice(1));
  } catch (err) {
    log.error(`${err.code}: ${err.message}. Nothing was written.`);
    process.exit(2);
  }
  if (!ids.length) {
    log.error(`hosts ${sub} needs at least one host id. Nothing was written.`);
    process.exit(2);
  }
  const next = hostCommands.changeHosts({ home, selection, [sub]: ids });
  const results = hostSyncOrExit(next);
  if (json) {
    console.log(JSON.stringify({ ok: true, [sub === 'enable' ? 'enabled' : 'disabled']: ids, hosts: [...next.enabled], files: results.map(({ content, ...item }) => item) }, null, 2));
    return;
  }
  log.info(`AI Engineering Loop — hosts ${sub} ${ids.join(', ')}`);
  console.log(formatHostSyncReport(results, { version: VERSION }));
}

// `setup` (issue #49): the one-time, explicit replacement for a postinstall
// hook. Detects agents (config folder or PATH binary, never executed), asks,
// then syncs. Without a TTY it only prints the plan unless --yes is given.
function handleSetup() {
  const home = homeDir();
  const json = process.argv.includes('--json');
  const yes = process.argv.includes('--yes');
  const hostsArg = argValue('--hosts');
  const modeArg = argValue('--mode');
  if (modeArg && !['auto', 'manual'].includes(modeArg)) {
    log.error('--mode must be auto or manual. Nothing was written.');
    process.exit(2);
  }
  const selection = resolveHostSelection(home);
  const rows = hostCommands.listHosts({ home, selection });
  let ids;
  try {
    ids = hostsArg ? hostCommands.parseHostIds(hostsArg) : rows.filter((row) => row.detected).map((row) => row.id);
  } catch (err) {
    log.error(`${err.code}: ${err.message}. Nothing was written.`);
    process.exit(2);
  }
  const interactive = process.stdin.isTTY && process.stdout.isTTY && !json && autoUpdate.autoUpdateAllowedHere();
  if (!yes && !interactive) {
    const plan = {
      ok: false,
      wrote: false,
      code: 'SETUP_NOT_CONFIRMED',
      detected: rows.filter((row) => row.detected).map((row) => row.id),
      wouldEnable: ids,
      why: 'A non-interactive session cannot ask, so setup does not write host files.',
      fix: 'ai-engineering-loop setup --yes'
    };
    if (json) console.log(JSON.stringify(plan, null, 2));
    else {
      console.log(`Would enable: ${ids.join(', ') || '(none detected)'}`);
      console.log('Nothing was written.');
      console.error(`FIX: ${plan.fix}`);
    }
    process.exitCode = 2;
    return;
  }
  let mode = hostCommands.setupMode({ modeArg, interactive: false });
  if (!ids.length) {
    const message = 'No coding agent detected, so nothing was installed. Install Claude Code, Cursor, Codex, OpenCode, or another supported agent, then rerun `ai-engineering-loop setup --yes`.';
    if (json) console.log(JSON.stringify({ ok: false, wrote: false, code: 'NO_HOSTS', enabled: [], error: message, fix: 'Install a supported coding agent, then `ai-engineering-loop setup --yes`.' }));
    else console.error(message);
    process.exitCode = 1;
    return;
  }
  if (!yes) {
    console.log(hostCommands.formatHostsList(rows, selection));
    const ok = readTtyLine(`Install the loop for ${ids.join(', ')}? [Y/n] `, 'y');
    if (!['y', 'yes'].includes(ok)) {
      console.log('Nothing was written.');
      return;
    }
    if (!modeArg) {
      mode = hostCommands.setupMode({ interactive: true, answer: readTtyLine(hostCommands.SETUP_MODE_QUESTION, '') });
    }
  }
  const next = hostCommands.applySetup({ home, ids, mode });
  const results = hostSyncOrExit(next);
  if (json) {
    console.log(JSON.stringify({ ok: true, wrote: true, enabled: [...next.enabled], mode: next.mode, files: results.map(({ content, ...item }) => item) }, null, 2));
    return;
  }
  log.info(`AI Engineering Loop — setup (${next.enabled.size} host${next.enabled.size === 1 ? '' : 's'}, mode ${next.mode})`);
  console.log(formatHostSyncReport(results, { version: VERSION }));
}

// First-run hint (issue #49): no postinstall writes to HOME, so the first
// interactive CLI use suggests `setup` once a day until hosts are chosen.
function maybeSetupHint() {
  try {
    if (process.env.AEL_NO_SETUP_HINT === '1' || process.argv.includes('--json')) return;
    if (!process.stderr.isTTY || !autoUpdate.autoUpdateAllowedHere()) return;
    const home = homeDir();
    if (hostCommands.savedHosts(home)) return;
    const userState = require('../lib/user-state.js');
    const stampFile = userState.userStatePath('setup-hint.json', home);
    const last = userState.readJsonFile(stampFile, {});
    if (last.at && Date.now() - Date.parse(last.at) < 24 * 60 * 60 * 1000) return;
    const rows = hostCommands.listHosts({ home, selection: resolveHostSelection(home) });
    const detected = rows.filter((row) => row.detected).map((row) => row.id);
    if (!detected.length) return;
    userState.writeJsonFile(stampFile, { at: new Date().toISOString() });
    process.stderr.write(`ai-engineering-loop: detected ${detected.join(', ')}. Run "ai-engineering-loop setup" once to install the loop for them (silence: AEL_NO_SETUP_HINT=1).\n`);
  } catch {
    // A hint never breaks a command.
  }
}

// New agents after setup (issue #52): `status` prints a short, rate-limited
// notice in manual mode; auto mode is handled by the background `update auto`.
function maybeNewHostsNotice() {
  try {
    if (process.argv.includes('--json') || !process.stderr.isTTY || !autoUpdate.autoUpdateAllowedHere()) return;
    const message = require('../lib/hosts/redetect.js').newHostsNotice({ home: homeDir() });
    if (message) process.stderr.write(`${message}\n`);
  } catch {
    // A notice never breaks a command.
  }
}

function handleGenerateAdapter() {
  log.info('AI Engineering Loop — Generate delivery adapter (generate-adapter)');
  const hints = detectAdapterHints(CWD);
  const type = parseTypeArg(process.argv);
  if (!type) {
    console.log(formatGenerateAdapterReport(hints, { version: VERSION }));
    return;
  }
  try {
    const wrote = writeShippedAdapter(CWD, { type, hints });
    console.log(formatGenerateAdapterReport(hints, { version: VERSION, wrote }));
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }
}

function handleGenerateWorkflow() {
  log.info('AI Engineering Loop — Generate loop overlay (generate-workflow)');
  const shouldWrite = parseWriteArg(process.argv);
  if (!shouldWrite) {
    console.log(formatGenerateWorkflowReport({ version: VERSION }));
    return;
  }
  try {
    const wrote = writeWorkflowOverlay(CWD, {});
    console.log(formatGenerateWorkflowReport({ version: VERSION, wrote }));
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }
}

function detectGrokHost() {
  try {
    const { detectGrokRuntime } = require('../lib/orchestration.js');
    return detectGrokRuntime(process.env, fs);
  } catch (e) {
    return null;
  }
}

// Top lessons from earlier Runs (learn.js), ranked for the files in play.
function runLearnings() {
  try {
    const { selectLearnings } = require('../lib/learn.js');
    return selectLearnings(CWD, { files: workingTreePaths(CWD), budgetTokens: 600, limit: 5 }).learnings;
  } catch {
    return [];
  }
}

// Lessons are mined when a Run ends (delivered or escalated), so the next Run
// sees them without a manual `learn`. Best effort: never fails the gate.
function autoLearn(run) {
  if (!run || !['DELIVERED', 'ESCALATED'].includes(run.state) || process.env.AEL_NO_AUTO_LEARN === '1') return;
  try {
    learn(CWD, {});
  } catch (err) {
    console.error(`! learnings not updated: ${err.message}`);
  }
}

function workingTreePaths(rootDir) {
  try {
    return execSync('git status --porcelain --untracked-files=all', { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter((line) => line && !line.startsWith('.ai-engineering-loop/'))
      .map((line) => line.includes(' -> ') ? line.split(' -> ').pop() : line);
  } catch (e) {
    return [];
  }
}

// Command: run
// `run --abandon [--run <id>] --reason <text> --by <name> [--yes] [--json]`
// (issue #46). ASSISTED asks for confirmation (or --yes); UNATTENDED runs are
// refused unless a human passes --yes. Terminal runs exit 2.
function startWorktreeRun(task, runArgs, runJson, realLog) {
  const isolation = require('../lib/run-isolation.js');
  try {
    const worktree = isolation.createWorktree(CWD, { task, baseRef: argValue('--base') });
    const passthrough = [];
    for (const flag of ['--mode', '--recipe', '--tier', '--tier-reason']) {
      const value = argValue(flag);
      if (value != null) passthrough.push(flag, value);
    }
    const child = spawnSync(process.execPath, [process.argv[1], 'run', '--json', ...passthrough, task], { cwd: worktree.path, encoding: 'utf8', env: process.env });
    let started;
    try {
      started = JSON.parse(String(child.stdout || '').slice(String(child.stdout || '').indexOf('{')));
    } catch {
      started = { ok: false, error: (child.stderr || child.stdout || 'run did not start').trim() };
    }
    if (!started.ok) throw Object.assign(new Error(`Worktree created at ${worktree.path}, but the Run did not start: ${started.error}`), { code: started.code || 'RUN_FAILED' });
    isolation.registerWorktree(worktree.mainRoot, { runId: started.runId, path: worktree.path, branch: worktree.branch, base: worktree.base, baseRef: worktree.baseRef, task, state: 'active', createdAt: new Date().toISOString() });
    const result = { ...started, worktree: { path: worktree.path, branch: worktree.branch, baseRef: worktree.baseRef, mainCheckout: worktree.mainRoot }, next: `Work only in ${worktree.path} for this Run.` };
    if (runJson) realLog(JSON.stringify(result, null, 2));
    else {
      console.log = realLog;
      log.success(`✓ Run ${started.runId} started in a new worktree`);
      console.log(`- Path: ${worktree.path}`);
      console.log(`- Branch: ${worktree.branch} (from ${worktree.baseRef})`);
      console.log(`- Work only in that folder for this Run. After deliver, Stage 9 removes the worktree when it is clean.`);
    }
  } catch (err) {
    console.log = realLog;
    if (runJson) realLog(JSON.stringify({ ok: false, code: err.code || 'RUN_FAILED', error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

function handlePr() {
  const json = process.argv.includes('--json');
  try {
    if (args[1] === 'babysit') {
      const runId = argValue('--run');
      if (!runId) throw Object.assign(new Error('Use: pr babysit --run <id> [--json]'), { code: 'INVALID_USAGE', fix: 'ai-engineering-loop pr babysit --run <id>' });
      const result = require('../lib/pr-babysit.js').babysit(CWD, { runId });
      if (json) console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      else {
        console.log(`PR #${result.pr} (${result.branch || 'branch unknown'}): ${result.action}${result.reason ? ` (${result.reason})` : ''}`);
        console.log(result.message);
        if (result.fixRunId) console.log(`- fix run: ${result.fixRunId}${result.tier ? ` (${result.tier})` : ''}`);
        if (result.pushed) console.log(`- pushed ${result.branch}`);
        if (result.next) console.log(`- next: ${result.next}`);
        for (const blocker of result.blockers || []) console.log(`- blocker: ${blocker}`);
        if (result.url) console.log(`- ${result.url}`);
      }
      return;
    }
    if (args[1] !== 'status') throw Object.assign(new Error('Use: pr status [--run <id> | --branch <name> | --pr <number>] [--json] | pr babysit --run <id> [--json]'), { code: 'INVALID_USAGE' });
    const explicit = argValue('--pr') || argValue('--branch');
    const runId = argValue('--run') || (explicit ? null : getCurrentRun(CWD)?.runId) || null;
    const status = require('../lib/pr-status.js').prStatus(CWD, { runId, branch: argValue('--branch'), pr: argValue('--pr') });
    if (json) console.log(JSON.stringify({ ok: true, ...status }, null, 2));
    else {
      console.log(`PR #${status.pr} (${status.branch || 'branch unknown'}): ${status.verdict}`);
      for (const blocker of status.blockers) console.log(`- blocker: ${blocker}`);
      for (const item of status.waitingOn || []) console.log(`- waiting on: ${item}`);
      if (status.mergeRecorded) console.log(`- recorded runs/${status.runId}/merge.json`);
      console.log(`- ${status.url}`);
    }
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'PR_STATUS_FAILED', error: err.message, ...(err.why ? { why: err.why } : {}), ...(err.fix ? { fix: err.fix } : {}) }));
    else {
      log.error(err.message);
      if (err.why) console.error(`WHY: ${err.why}`);
      if (err.fix) console.error(`FIX: ${err.fix}`);
    }
    process.exitCode = 1;
  }
}

function handleWorktree() {
  const json = process.argv.includes('--json');
  const isolation = require('../lib/run-isolation.js');
  try {
    if (args[1] !== 'prune') throw Object.assign(new Error('Use: worktree prune [--audit] [--include-scratch] [--yes] [--json]'), { code: 'INVALID_USAGE' });
    const includeScratch = process.argv.includes('--include-scratch');
    if (!process.argv.includes('--yes')) {
      const audit = process.argv.includes('--audit');
      const { plan } = isolation.planPrune(CWD, { includeScratch, audit, sizes: true });
      if (json) console.log(JSON.stringify({ ok: true, applied: false, plan }, null, 2));
      else if (!plan.length) log.success('✓ No AEL worktree needs cleanup');
      else {
        const mb = (bytes) => (bytes == null ? '?' : `${(bytes / 1048576).toFixed(1)} MB`);
        console.log('SIZE\tAGE\tBUCKET\tRUN\tWORKTREE');
        for (const row of plan) {
          console.log(`${mb(row.sizeBytes)}\t${row.ageDays == null ? '?' : `${row.ageDays}d`}\t${row.bucket}\t${row.runState || '-'}\t${row.path}`);
          const what = [...row.actions, ...row.notes];
          if (what.length) console.log(`  ${what.join('; ')}`);
        }
        console.log('Apply with: ai-engineering-loop worktree prune --yes [--include-scratch] (changed tracked files, open PRs and foreign worktrees are never removed)');
      }
      return;
    }
    const result = isolation.applyPrune(CWD, { includeScratch });
    if (json) console.log(JSON.stringify({ ok: true, applied: true, ...result }, null, 2));
    else if (!result.done.length) log.success('✓ Nothing to clean up');
    else for (const item of result.done) console.log(`✓ ${item.action}: ${item.path}`);
  } catch (err) {
    stageJsonError(err, json, 'WORKTREE_FAILED');
  }
}

function handleRunAbandon() {
  const json = process.argv.includes('--json');
  const yes = process.argv.includes('--yes');
  const runAbandon = require('../lib/run-abandon.js');
  const fail = (err) => {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'ABANDON_FAILED', error: err.message }));
    else log.error(err.message);
    process.exit(err.exitCode || 1);
  };
  try {
    const plan = runAbandon.planAbandon(CWD, { runId: argValue('--run'), reason: argValue('--reason'), by: argValue('--by') });
    const { run } = plan;
    const activity = require('../lib/run-isolation.js').runActivity(CWD, run);
    if (activity.live && !process.argv.includes('--force-live')) {
      throw Object.assign(new Error(`Run ${run.runId} was active ${activity.idleMinutes} minute(s) ago; another session may still be working on it. Add --force-live only if you are sure, or start this task in a worktree: run --worktree "<task>".`), { code: 'RUN_LIVE' });
    }
    if (run.mode === 'UNATTENDED' && !yes) {
      throw Object.assign(new Error(`Run ${run.runId} is UNATTENDED. Agents must not abandon it; a human can re-run with --yes.`), { code: 'UNATTENDED_REQUIRES_HUMAN', exitCode: 2 });
    }
    if (!yes) {
      if (json || !process.stdin.isTTY || !process.stdout.isTTY) {
        throw Object.assign(new Error(`Confirm abandoning run ${run.runId} (${run.state}) by re-running with --yes.`), { code: 'CONFIRMATION_REQUIRED' });
      }
      process.stdout.write(`Abandon run ${run.runId} (${run.state}, ${run.task ? `"${String(run.task).slice(0, 60)}"` : 'no task'})? Run data is kept. [y/N] `);
      const buffer = Buffer.alloc(16);
      let answer = '';
      try {
        answer = buffer.toString('utf8', 0, fs.readSync(0, buffer, 0, buffer.length, null)).trim().toLowerCase();
      } catch {
        answer = '';
      }
      if (!['y', 'yes'].includes(answer)) {
        console.log('Not abandoned.');
        process.exit(1);
      }
    }
    const result = runAbandon.abandonRun(CWD, { runId: run.runId, reason: plan.reason, by: plan.actor });
    if (json) console.log(JSON.stringify({ ok: true, ...result }));
    else {
      log.success(`✓ Run ${result.runId} abandoned (${result.from} -> CANCELLED) by ${result.by}: ${result.reason}`);
      console.log(result.released
        ? '- current.json released; refresh and auto-update will process this project again.'
        : `- current run unchanged${result.current ? ` (${result.current})` : ''}.`);
    }
  } catch (err) {
    fail(err);
  }
}

// One-line hint for an active run that has not moved for STALE_RUN_DAYS.
function staleRunHint(run) {
  const runAbandon = require('../lib/run-abandon.js');
  const info = runAbandon.staleRunInfo(run);
  if (!info.stale) return null;
  return `Run ${run.runId} has been ${run.state} for ${info.idleDays} day(s). If it is abandoned: ${runAbandon.abandonCommand(run.runId)}`;
}

function currentRunSafe(dir) {
  try {
    return getCurrentRun(dir);
  } catch {
    return null;
  }
}

function requiredFlag(name, fix) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw Object.assign(new Error(`${name} needs a value.`), { code: 'INVALID_USAGE', why: 'The bug report source was missing.', fix });
  }
  return value;
}

// Bug report -> one red-repro Goal. The Run itself is unchanged after the draft.
function reproIntake() {
  const fromIssue = requiredFlag('--from-issue', 'ael run --from-issue <url|#n>');
  const fromReport = requiredFlag('--from-report', 'ael outcome repro --file <path>');
  if (!fromIssue && !fromReport) return null;
  if (fromIssue && fromReport) {
    throw Object.assign(new Error('Pass --from-issue or --from-report, not both.'), { code: 'INVALID_USAGE', why: 'One bug report starts one Run.', fix: 'ael run --from-issue <url|#n>' });
  }
  const issueRepro = require('../lib/issue-repro.js');
  return fromIssue ? issueRepro.readIssue(CWD, fromIssue) : issueRepro.readReportFile(CWD, fromReport);
}

const RUN_FLAGS = new Set(['--new', '--json', '--worktree', '--abandon', '--yes', '--force-live', '--help', '-h']);
const RUN_VALUED = ['--mode', '--recipe', '--tier', '--tier-reason', '--from-issue', '--from-report', '--run', '--reason', '--by', '--base'];

function rejectUnknownRunFlags(runArgs) {
  const valued = new Set(RUN_VALUED);
  for (let index = 0; index < runArgs.length; index += 1) {
    const token = runArgs[index];
    if (token === '--') break;
    if (!token.startsWith('--')) continue;
    if (RUN_FLAGS.has(token)) continue;
    if (valued.has(token)) {
      index += 1;
      continue;
    }
    const known = [...RUN_FLAGS, ...RUN_VALUED].filter((flag) => flag.startsWith('--'));
    let suggestion = null;
    let best = 4;
    for (const flag of known) {
      const distance = editDistance(token, flag);
      if (distance > 0 && distance < best) {
        suggestion = flag;
        best = distance;
      }
    }
    throw Object.assign(new Error(`Unknown flag ${token}.${suggestion ? ` Did you mean \`${suggestion}\`?` : ''}`), {
      code: 'INVALID_USAGE',
      why: 'Unknown flags are not the task. Treating them as the task can start or replace the active Run.',
      fix: 'Run `ael help run` for the flags. Quote the task: ael run "Add CSV export".'
    });
  }
}

function handleRun() {
  if (process.argv.includes('--abandon')) return handleRunAbandon();
  const runJson = process.argv.includes('--json');
  try {
    rejectUnknownRunFlags(process.argv.slice(3));
  } catch (err) {
    if (runJson) console.log(JSON.stringify({ ok: false, code: err.code, error: err.message, why: err.why, fix: err.fix }));
    else {
      log.error(err.message);
      console.error(`WHY: ${err.why}`);
      console.error(`FIX: ${err.fix}`);
    }
    process.exit(1);
  }
  const gitState = require('../lib/git-readiness.js').gitReadiness(CWD);
  if (!gitState.ok) {
    if (runJson) console.log(JSON.stringify({ ok: false, code: gitState.code, error: `Cannot start a Run: ${gitState.message}.`, why: gitState.why, fix: gitState.fix }));
    else {
      log.error(`Cannot start a Run: ${gitState.message}.`);
      console.error(`WHY: ${gitState.why}`);
      console.error(`FIX: ${gitState.fix}`);
    }
    process.exit(1);
  }
  const realLog = console.log;
  if (runJson) console.log = () => {};
  log.info('AI Engineering Loop — Task Execution Entrypoint (run)');

  if (!fs.existsSync(CONTEXT_DIR)) {
    log.warn('Project context missing. Auto-initializing before task execution...');
    handleInit();
  } else {
    handleStatus();
  }

  const runArgs = process.argv.slice(3);
  const forceNew = runArgs.includes('--new');
  const modeArg = argValue('--mode');
  const recipeArg = argValue('--recipe');
  const tierArg = argValue('--tier');
  const tierReasonArg = argValue('--tier-reason');
  const taskParts = [];
  for (let index = 0; index < runArgs.length; index++) {
    if (['--new', '--json', '--worktree'].includes(runArgs[index])) continue;
    if (['--mode', '--recipe', '--tier', '--tier-reason', '--base'].includes(runArgs[index])) {
      index += 1;
      continue;
    }
    if (['--from-issue', '--from-report'].includes(runArgs[index])) {
      index += 1;
      continue;
    }
    taskParts.push(runArgs[index]);
  }
  let task = taskParts.join(' ').trim();
  let runResult;
  let repro = null;
  try {
    repro = reproIntake();
    if (repro && task) {
      throw Object.assign(new Error('A bug-report Run takes its task from the report.'), { code: 'INVALID_USAGE', why: 'The issue title is the task, so extra words would start a different Run.', fix: 'ael run --from-issue <url|#n>' });
    }
    if (repro) task = repro.title;
    if (process.argv.includes('--base')) {
      const baseRef = argValue('--base');
      if (!baseRef || baseRef.startsWith('-')) {
        throw Object.assign(new Error('--base needs a branch or commit.'), {
          code: 'INVALID_USAGE',
          why: 'A stacked Run starts from a commit that already exists in this repository.',
          fix: 'ael run --worktree --base <branch> "<task>"'
        });
      }
      if (!runArgs.includes('--worktree')) {
        throw Object.assign(new Error('--base starts a stacked worktree and does not switch this checkout.'), {
          code: 'INVALID_USAGE',
          why: 'Checking out another branch here would mix this Run with the stack.',
          fix: 'ael run --worktree --base <branch> "<task>"'
        });
      }
    }
    if (runArgs.includes('--worktree')) {
      if (repro) {
        throw Object.assign(new Error('--from-issue starts the Run in this checkout.'), { code: 'INVALID_USAGE', why: 'The red-repro Goal is drafted on the Run created here.', fix: 'ael run --from-issue <url|#n>' });
      }
      return startWorktreeRun(task, runArgs, runJson, realLog);
    }
    const current = getCurrentRun(CWD);
    if (!task && (forceNew || !current || TERMINAL_STATES.has(current.state))) {
      throw Object.assign(new Error('run needs a task when no Run is in progress'), { code: 'INVALID_USAGE', why: 'A Run is bound to one task; an empty task cannot be tiered, gated or delivered.', fix: 'ai-engineering-loop run "Add CSV export to the report page"' });
    }
    if (!forceNew) {
      const conflict = require('../lib/run-isolation.js').runConflict(CWD, current, task);
      if (conflict) {
        throw Object.assign(new Error(`Run ${conflict.runId} (${conflict.state}) is unfinished and works on a different task${conflict.live ? `; it was active ${conflict.idleMinutes} minute(s) ago` : ''}. Ask the human which option to take; do not pick one yourself.`), { code: 'RUN_CONFLICT', conflict });
      }
    }
    const policy = loadPolicy(CWD);
    const startsNewRun = forceNew || !current || TERMINAL_STATES.has(current.state);
    if (forceNew && current && !TERMINAL_STATES.has(current.state)) {
      // C-15 (L07 WIP=1): starting another Run while one is unfinished.
      try {
        const ratio = require('../lib/features.js').vcr(require('../lib/features.js').loadFeatures(CWD));
        if (ratio.value < 1) console.error(`! VCR ${ratio.verified}/${ratio.activated}: Run ${current.runId} is still ${current.state}. Finishing it first usually beats starting another (WIP=1).`);
      } catch {
        // No feature ledger.
      }
    }
    let mode = modeArg ? normalizeMode(modeArg) : (startsNewRun ? policy.defaultMode : null);
    let workflow = null;
    let requestedRunId = null;
    if (startsNewRun || recipeArg) {
      const resolved = require('../lib/personal-workflow.js').resolveRunWorkflow(CWD, {
        mode: mode || (current ? current.mode : null),
        recipeId: recipeArg || null
      });
      const recipe = resolved.recipe;
      if (!mode && current) mode = current.mode;
      if (startsNewRun && !modeArg && mode && !recipe.compatibleModes.includes(mode)) {
        if (recipe.compatibleModes.length !== 1) {
          throw new Error(`Recipe ${recipe.id} requires an explicit compatible --mode.`);
        }
        mode = recipe.compatibleModes[0];
      }
      const plan = compileRecipe(recipe, { mode: mode || recipe.compatibleModes[0] });
      if (startsNewRun) {
        requestedRunId = newRunId();
        workflow = createWorkflowBundle(plan, requestedRunId, {
          run: {
            runId: requestedRunId,
            mode,
            state: 'STARTED',
            iteration: 1,
            task
          }
        });
        workflow.workflowSource = resolved.source;
        if (resolved.reason) workflow.workflowReason = resolved.reason;
      } else {
        workflow = { plan };
      }
    }
    if (mode) assertModeAllowed(CWD, mode);
    const tier = startsNewRun
      ? initialTierState({ task, changedPaths: workingTreePaths(CWD), override: tierArg, overrideReason: tierReasonArg })
      : null;
    if (!startsNewRun && tierArg) throw new Error('--tier applies only when a new run starts (use --new).');
    runResult = createOrResumeRun(CWD, {
      task,
      forceNew,
      mode,
      workflow,
      tier,
      ...(requestedRunId ? { runId: requestedRunId } : {})
    });
    assertBudgetAvailable(CWD, { runId: runResult.run.runId });
    if (repro) runResult.repro = require('../lib/issue-repro.js').attachReproGoal(CWD, runResult.run.runId, repro);
  } catch (err) {
    console.log = realLog;
    if (runJson) {
      realLog(JSON.stringify({ ok: false, code: err.code || 'RUN_FAILED', error: err.message, ...(err.why ? { why: err.why } : {}), ...(err.fix ? { fix: err.fix } : {}), ...(err.conflict ? { conflict: err.conflict } : {}) }));
      process.exit(err.code === 'RUN_CONFLICT' ? 3 : 1);
    }
    log.error(err.message);
    if (err.why) console.error(`WHY: ${err.why}`);
    if (err.fix) console.error(`FIX: ${err.fix}`);
    if (err.conflict) {
      for (const option of err.conflict.options) console.log(`- ${option.id === err.conflict.recommended ? '(recommended) ' : ''}${option.label}: ${option.command}`);
      process.exit(3);
    }
    process.exit(1);
  }
  if (runJson) {
    console.log = realLog;
    const run = runResult.run;
    console.log(JSON.stringify({
      ok: true,
      runId: run.runId,
      resumed: runResult.resumed,
      state: run.state,
      iteration: run.iteration,
      mode: run.mode || RUN_MODES.ASSISTED,
      tier: run.tier ? run.tier.current : null,
      tierSource: run.tier ? run.tier.source : null,
      tierReasons: run.tier ? run.tier.reasons : [],
      subagents: run.tier ? { T0: 0, T1: 1, T2: 2 }[run.tier.current] : 2,
      recipe: run.workflow ? run.workflow.recipeId : null,
      workflowSource: run.workflow ? (run.workflow.workflowSource || null) : null,
      ...(run.workflow && run.workflow.workflowReason ? { workflowReason: run.workflow.workflowReason } : {}),
      budget: (() => {
        try {
          const b = budgetStatus(CWD, { runId: run.runId });
          return { allowed: b.allowed, spentThisRun: b.spentThisRun, warnings: b.warnings || [] };
        } catch (e) {
          return { allowed: false, error: e.message };
        }
      })(),
      hostSkills: (() => {
        const h = hostSkillStatus({ home: homeDir(), version: VERSION });
        return { stale: h.stale, staleFiles: h.staleFiles, installedVersion: h.installedVersion, packageVersion: VERSION };
      })(),
      learnings: runLearnings(),
      ...(() => {
        const hint = require('../lib/run-isolation.js').pruneHint(CWD);
        return hint ? { worktreeHint: hint } : {};
      })(),
      ...specHintField(runResult),
      ...(runResult.repro ? { repro: runResult.repro } : {}),
      studioUrl: readStudioUrl(CWD)
    }, null, 2));
    return;
  }
  console.log(`- Run: ${runResult.run.runId} (${runResult.resumed ? 'resumed' : 'created'})`);
  if (runResult.repro) {
    const draft = runResult.repro;
    console.log(`- Red repro: ${draft.failingBehavior}`);
    console.log(`- Verify (fails today): ${draft.command}`);
    console.log(`- Issue reader: read-only (${draft.source}${draft.ref ? `, ${draft.ref}` : ''}).`);
    console.log(draft.drafted
      ? `- Goal draft revision ${draft.revision}. Next: \`goal show --run ${runResult.run.runId} --human\`, then the human freezes. Maker, verify, Devil's Advocate, Judge, and deliver --approve follow.`
      : `- Goal draft already present (revision ${draft.revision}).`);
  }
  if (runResult.run.tier) {
    const t = runResult.run.tier;
    console.log(`- Tier: ${t.current} (${t.source}; ${t.reasons.map((r) => r.code).join(', ')})`);
  }
  const hint = specHintField(runResult).specHint;
  if (hint) console.log(`- Spec: ${hint}`);
  console.log(`- State: ${runResult.run.state}, iteration ${runResult.run.iteration}`);
  console.log(`- Mode: ${runResult.run.mode || RUN_MODES.ASSISTED}`);
  if (runResult.run.workflow) {
    const runtime = workflowStatus(CWD, { runId: runResult.run.runId });
    const ready = runtime.plan.nodes
      .filter((node) => runtime.state.nodes[node.id].status === 'READY')
      .map((node) => node.id);
    console.log(`- Recipe: ${runResult.run.workflow.recipeId} (${runResult.run.workflow.graphHash})`);
    if (runResult.run.workflow.workflowSource) {
      const why = runResult.run.workflow.workflowReason ? ` (${runResult.run.workflow.workflowReason})` : '';
      console.log(`- Workflow source: ${runResult.run.workflow.workflowSource}${why}`);
    }
    console.log(`- Ready nodes: ${ready.join(', ') || 'none'}`);
  }

  const grok = detectGrokHost();

  console.log('\n------------------------------------------------------------');
  if (!agentSkillState().installed) {
    log.warn('No agent has the ael skill yet, so nothing will pick up this Run on its own.');
    log.dim(SETUP_HINT);
  }
  log.bold('Agent checklist:');
  console.log(runResult.repro
    ? '1. Red-repro Goal is drafted. Show it and wait for the human to freeze (docs root-cause-analysis)'
    : '1. Grill if needed (docs grill-policy), then freeze a failure-table Goal Contract');
  if (runResult.run.mode === RUN_MODES.REPORT_ONLY) {
    console.log('2. Analyze evidence without changing repository files');
    console.log('3. Write report.json; if the host has a subagent tool, have ONE fresh devil-advocate challenge it (no Judge), and record `review` in report.json (loop-maker)');
    console.log('4. Finish with `ai-engineering-loop gate report`');
  } else {
    console.log('2. Root Cause Analysis (docs root-cause-analysis) & Plan');
    console.log('3. Maker TDD at named seams (docs tdd-policy)');
    console.log('4. Run Deterministic Verification');
    const tierNow = runResult.run.tier ? runResult.run.tier.current : null;
    if (tierNow === 'T0') {
      console.log('5. T0: no Devil\'s Advocate. Fill claimed-vs-reality, then `gate review` (CLI writes the empty ledger)');
      console.log('6. T0: `gate judge` writes the deterministic verdict (no Judge subagent)');
    } else if (tierNow === 'T1') {
      console.log('5. Execute lean Devil\'s Advocate review, then `gate review --json`');
      console.log('6. Judge subagent only if `gate review` says judgeRequired; otherwise `gate judge` is deterministic');
    } else {
      console.log('5. Execute Devil\'s Advocate Adversarial Review');
      console.log(`6. Judge Agent evaluates DoD and issues PASS verdict${tierNow === 'T2' ? ' (STRONG_MODEL required)' : ''}`);
    }
    console.log('7. Context Impact Assessment (NONE / TARGETED / MAJOR)');
    console.log('8. Delivery Adapter creates MR/PR');
    if (runResult.run.mode === RUN_MODES.ASSISTED) {
      console.log('9. Human approval is required before the delivery gate');
    }
  }

  if (grok && grok.host === 'grok-cli') {
    console.log('------------------------------------------------------------');
    log.bold('Grok CLI host:');
    console.log(`- Binary: ${grok.grokBin || 'detected'}`);
    console.log(`- spawn_subagent: ${grok.invocationAvailable ? 'INVOCATION_AVAILABLE' : 'UNAVAILABLE'}`);
    console.log(`- Execution proven: no (requires child subagent_id + model response)`);
    if (grok.invocationAvailable) {
      console.log('- Devil\'s Advocate: spawn_subagent type=devil-advocate capability_mode=execute (no resume_from)');
      console.log('- Judge: spawn_subagent type=judge capability_mode=execute (sibling, not nested)');
      console.log('- Forbidden types: caveman:cavecrew-reviewer, explore, plan');
    } else {
      console.log(`- Fallback: CONTEXT_ISOLATION_ONLY (${grok.reason})`);
    }
    console.log('- Skill: .agents/skills/ael/SKILL.md (spawn rules: references/loop-hosts.md, Grok CLI section)');
  }

  const claudeSkill = path.join(CWD, '.claude', 'skills', 'ael', 'SKILL.md');
  const claudeAgent = path.join(CWD, '.claude', 'agents', 'devil-advocate.md');
  if (fs.existsSync(claudeSkill) || fs.existsSync(claudeAgent)) {
    console.log('------------------------------------------------------------');
    log.bold('Claude Code host:');
    console.log('- Subagent tool: Task (or Agent). Keys allowed: subagent_type, description, prompt');
    console.log('- Devil\'s Advocate: Task subagent_type=devil-advocate');
    console.log('- Judge: Task subagent_type=judge (sibling, not nested)');
    console.log('- Do not pass spawn_subagent, capability_mode, isolation, resume_from (Kiro 400 REQUEST_BODY_INVALID)');
    console.log('- Skill: .claude/skills/ael/SKILL.md');
  }

  const sharedSkill = path.join(CWD, '.agents', 'skills', 'ael', 'SKILL.md');
  if (fs.existsSync(sharedSkill)) {
    console.log('------------------------------------------------------------');
    log.bold('Shared .agents/skills hosts (Codex, Gemini CLI, Antigravity, Cursor, Copilot, ...):');
    console.log('- Same skill on every host; spawn rules per host: references/loop-hosts.md');
    console.log('- Devil\'s Advocate: 8 tool calls, diff file, skip css');
    console.log('- Judge: 4 tool calls, ledger + contract only');
    console.log('- Skill: .agents/skills/ael/SKILL.md');
  }
  console.log('------------------------------------------------------------\n');
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function parseBooleanArg(name, value) {
  if (!['true', 'false'].includes(String(value))) {
    const err = new Error(`${name} must be true or false`);
    err.code = 'INVALID_POLICY_VALUE';
    throw err;
  }
  return value === 'true';
}

function parsePositiveIntegerArg(name, value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    const err = new Error(`${name} must be a positive integer`);
    err.code = 'INVALID_POLICY_VALUE';
    throw err;
  }
  return parsed;
}

function parseNonNegativeIntegerArg(name, value) {
  if (value == null) {
    const err = new Error(`${name} is required`);
    err.code = 'INVALID_USAGE';
    throw err;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    const err = new Error(`${name} must be a non-negative integer`);
    err.code = 'INVALID_USAGE';
    throw err;
  }
  return parsed;
}

function handlePolicy() {
  const action = process.argv[3] || 'show';
  const json = process.argv.includes('--json');
  try {
    let policy;
    if (action === 'show') {
      policy = loadPolicy(CWD);
    } else if (action === 'set') {
      const changes = {};
      const mode = argValue('--default-mode');
      const allowUnattended = argValue('--allow-unattended');
      const requireSandbox = argValue('--require-sandbox');
      const reviewProfile = argValue('--review-profile');
      const goalFreeze = argValue('--goal-freeze');
      const perRunLimit = argValue('--per-run-token-limit');
      const dailyLimit = argValue('--daily-token-limit');
      if (mode != null) changes.defaultMode = normalizeMode(mode);
      if (reviewProfile != null) changes.reviewProfile = normalizeReviewProfile(reviewProfile);
      if (goalFreeze != null) {
        if (!require('../lib/runtime-policy.js').GOAL_FREEZE_MODES.includes(goalFreeze)) throw Object.assign(new Error('--goal-freeze must be host-question or strict'), { code: 'INVALID_USAGE' });
        changes.goalFreeze = goalFreeze;
      }
      if (allowUnattended != null) {
        changes.allowUnattended = parseBooleanArg('--allow-unattended', allowUnattended);
      }
      if (requireSandbox != null) {
        changes.requireSandboxForUnattended = parseBooleanArg('--require-sandbox', requireSandbox);
      }
      if (perRunLimit != null) {
        changes.perRunTokenLimit = parsePositiveIntegerArg('--per-run-token-limit', perRunLimit);
      }
      if (dailyLimit != null) {
        changes.dailyTokenLimit = parsePositiveIntegerArg('--daily-token-limit', dailyLimit);
      }
      if (Object.keys(changes).length === 0) {
        throw new Error('No policy changes provided');
      }
      policy = updatePolicy(CWD, changes);
    } else {
      throw new Error('Unknown policy action. Use show|set');
    }
    if (json) console.log(JSON.stringify(policy));
    else {
      log.success(action === 'set' ? '✓ Runtime policy updated' : 'Runtime policy');
      console.log(JSON.stringify(policy, null, 2));
    }
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'POLICY_ERROR', error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

function handleBudget() {
  const action = process.argv[3] || 'status';
  const json = process.argv.includes('--json');
  const runId = argValue('--run');
  const nodeId = argValue('--node');
  try {
    let result;
    if (action === 'status') {
      result = budgetStatus(CWD, {
        runId,
        nodeId,
        estimatedTokens: argValue('--estimate') == null
          ? 0
          : parseNonNegativeIntegerArg('--estimate', argValue('--estimate'))
      });
    } else if (action === 'record' && process.argv.includes('--unavailable')) {
      result = recordUsageUnavailable(CWD, { runId, nodeId });
    } else if (action === 'record') {
      result = recordTokenUsage(CWD, {
        runId,
        nodeId,
        inputTokens: parseNonNegativeIntegerArg('--input', argValue('--input')),
        outputTokens: parseNonNegativeIntegerArg('--output', argValue('--output')),
        model: argValue('--model'),
        role: argValue('--role')
      });
    } else if (action === 'pause' || action === 'resume') {
      result = setKillSwitch(CWD, action === 'pause');
    } else {
      throw new Error('Unknown budget action. Use status|record|pause|resume');
    }
    if (json) console.log(JSON.stringify(result));
    else {
      log.success(action === 'record' ? '✓ Token usage recorded' : `Token budget: ${action}`);
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'BUDGET_ERROR', error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

function handleSandbox() {
  const action = process.argv[3] || 'status';
  const json = process.argv.includes('--json');
  const runId = argValue('--run');
  try {
    let result;
    if (action === 'create') result = createSandbox(CWD, { runId });
    else if (action === 'capture') result = captureSandbox(CWD, { runId });
    else if (action === 'abort') result = abortSandbox(CWD, { runId });
    else if (action === 'status') result = sandboxStatus(CWD, { runId });
    else throw new Error('Unknown sandbox action. Use create|capture|abort|status');
    if (json) console.log(JSON.stringify(result));
    else {
      log.success(`✓ Sandbox ${action}`);
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'SANDBOX_ERROR', error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

async function handleVerification() {
  const action = process.argv[3] || 'summarize';
  const separatorIndex = process.argv.indexOf('--');
  const optionArgs = action === 'record' && separatorIndex !== -1
    ? process.argv.slice(0, separatorIndex)
    : process.argv;
  const readOption = (name) => {
    const index = optionArgs.indexOf(name);
    return index === -1 ? null : optionArgs[index + 1] || null;
  };
  const json = optionArgs.includes('--json');
  const runId = readOption('--run');
  try {
    if (action === 'record') {
      if (separatorIndex === -1 || !process.argv[separatorIndex + 1]) {
        throw Object.assign(
          new Error('Provide an executable after `--`, for example `ai-engineering-loop verification record --run <id> -- npm test`.'),
          { code: 'INVALID_COMMAND' }
        );
      }
      const command = process.argv[separatorIndex + 1];
      const commandArgs = process.argv.slice(separatorIndex + 2);
      const timeoutValue = readOption('--timeout-ms');
      const result = await recordVerificationCommand(CWD, {
        runId,
        command,
        args: commandArgs,
        shell: optionArgs.includes('--shell'),
        timeoutMs: timeoutValue == null
          ? undefined
          : parsePositiveIntegerArg('--timeout-ms', timeoutValue)
      });
      if (json) {
        console.log(JSON.stringify({
          ok: result.command.exitCode === 0 && result.command.timeoutStatus === 'COMPLETED',
          runId: result.runId,
          path: result.path,
          summaryPath: path.relative(CWD, path.join(runsDir(CWD), result.runId, 'verification-summary.json'))
            .split(path.sep).join('/'),
          command: result.command.command,
          exitCode: result.command.exitCode,
          timeoutStatus: result.command.timeoutStatus,
          testCounts: result.summary.testCounts
        }));
      } else {
        const passed = result.command.exitCode === 0 && result.command.timeoutStatus === 'COMPLETED';
        if (passed) log.success('✓ Verification command recorded');
        else log.error('Verification command recorded with a failing result');
        console.log(`- Run: ${result.runId}`);
        console.log(`- Command: ${result.command.command}`);
        console.log(`- Exit code: ${result.command.exitCode}; timeout: ${result.command.timeoutStatus}`);
        console.log(`- Evidence: ${result.path}`);
        console.log(`- Summary: ${JSON.stringify(result.summary.testCounts)}`);
        if (!passed) {
          const excerpt = [result.command.stderr, result.command.stdout]
            .map((value) => String(value || '').trim())
            .find(Boolean);
          if (excerpt) console.error(`- Output: ${excerpt.split('\n').slice(-3).join('\n').slice(-800)}`);
        }
      }
      if (result.command.exitCode !== 0 || result.command.timeoutStatus !== 'COMPLETED') {
        process.exitCode = result.command.exitCode > 0 ? result.command.exitCode : 1;
      }
      return;
    }
    if (action !== 'summarize') throw new Error('Unknown verification action. Use summarize|record');
    const result = writeVerificationSummary(CWD, { runId });
    if (json) {
      console.log(JSON.stringify({
        ok: true,
        path: result.path,
        commandCount: result.summary.commandCount,
        exitCode: result.summary.exitCode,
        passed: result.summary.passed,
        testCounts: result.summary.testCounts
      }));
    } else {
      log.success('✓ verification summary created');
      console.log(`- Path: ${result.path}`);
      console.log(`- Commands: ${result.summary.commandCount}, exit code: ${result.summary.exitCode}`);
      console.log(`- Tests: ${JSON.stringify(result.summary.testCounts)}`);
    }
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'VERIFICATION_ERROR', error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

function handleArtifactTool(action) {
  const json = process.argv.includes('--json');
  try {
    if (action === 'scaffold') {
      const type = process.argv[3];
      if (type === 'goal') {
        const goal = require('../lib/agent-artifacts.js').scaffoldGoal(CWD, { runId: argValue('--run') });
        if (json) console.log(JSON.stringify({ ok: true, ...goal, templateOnly: true }));
        else {
          log.success('✓ Goal Contract template created');
          console.log(`- Path: ${goal.path}`);
          console.log(`- Next: fill in every <...>, delete _templateOnly, then \`${goal.nextCommand}\`.`);
        }
        return;
      }
      const result = scaffoldArtifact(CWD, { type, runId: argValue('--run') });
      if (json) console.log(JSON.stringify({ ok: true, ...result, templateOnly: true }));
      else {
        log.success(`✓ ${result.type} template created`);
        console.log(`- Run: ${result.runId}`);
        console.log(`- Path: ${result.path}`);
        console.log('- Template is deliberately incomplete; it cannot pass its gate until replaced with observed evidence.');
      }
      return;
    }
    if (action === 'validate') {
      const file = process.argv[3];
      if (!file || file.startsWith('-')) throw new Error('validate requires a repository-relative JSON file');
      const result = validateArtifactFile(CWD, { file, type: argValue('--type') });
      if (json) console.log(JSON.stringify({ ok: result.valid, ...result }));
      else {
        console.log(`Artifact ${result.path}: ${result.valid ? 'VALID' : 'INVALID'}`);
        for (const error of result.errors) console.error(`- ${error}`);
        if (result.note) console.log(`- ${result.note}`);
      }
      if (!result.valid) process.exitCode = 1;
      return;
    }
    throw new Error('Use scaffold <goal|verification|findings|delivery> or validate <file>');
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'ARTIFACT_TOOL_FAILED', error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

// Shared by `gate` and the combined stage commands (issue #34) so both paths
// publish identical workflow-node and Studio lifecycle events.
function executeGate(gate, runId) {
  const target = runId ? loadRun(CWD, runId) : getCurrentRun(CWD);
  if (!target) throw new Error('No current run. Start one with `ai-engineering-loop run`.');
  listRunLifecycle(CWD, target.runId);
  let lifecycleNode = null;
  if (target.workflow) {
    const workflow = workflowStatus(CWD, { runId: target.runId });
    lifecycleNode = workflow.plan.nodes.find((node) => node.legacyGate === gate) || null;
    if (lifecycleNode && workflow.state.nodes[lifecycleNode.id].status === 'READY') {
      startWorkflowNode(CWD, lifecycleNode.id, { runId: target.runId });
      appendRunLifecycle(CWD, target.runId, {
        type: 'NODE_STARTED',
        nodeId: lifecycleNode.id,
        phase: gate,
        actor: 'agent',
        message: `${lifecycleNode.displayName || lifecycleNode.id} started`
      });
    }
  }
  if (gate === 'maker') ensureImpactMap(target.runId);
  const run = target.workflow
    ? applyWorkflowGate(CWD, gate, { runId: target.runId }).run
    : applyGate(CWD, gate, { runId: target.runId });
  if (gate === 'goal') ensureImpactMap(target.runId);
  if (gate === 'verification') recordImpactDrift(target.runId);
  autoLearn(run);
  const runCompleted = run.state === 'DELIVERED' || run.state === 'REPORTED';
  appendRunLifecycle(CWD, target.runId, {
    type: runCompleted
      ? 'RUN_COMPLETED'
      : (lifecycleNode ? 'NODE_COMPLETED' : 'PHASE_COMPLETED'),
    ...(!runCompleted && lifecycleNode ? { nodeId: lifecycleNode.id } : {}),
    phase: gate,
    actor: 'agent',
    status: 'PASSED',
    message: `${lifecycleNode?.displayName || gate} completed`
  });
  return run;
}

// The freeze answers the pending freeze question(s) that `goal draft` asked,
// so Studio does not keep showing them. Best effort.
function closeFreezeQuestions(runId, actor) {
  try {
    closeRunFreezeQuestions(CWD, runId, actor);
  } catch (err) {
    console.error(`! freeze question not closed: ${err.message}`);
  }
}

// Blast radius of a Goal draft, so the human sees it with the Goal and can
// confirm both in one stop (`goal freeze --confirm-impact`). Best effort.
function impactPreview(runId, goal) {
  try {
    const map = impactMap.buildImpactMap(CWD, { run: loadRun(CWD, runId), goal });
    return { files: (map.files || []).map((file) => file.path), tests: (map.tests || []).map((t) => t.path || t) };
  } catch (err) {
    return { error: err.message };
  }
}

// Blast-radius map (#71): written into the Run once the Goal is frozen, so it
// exists before Stage 3. Best effort: a scan failure never blocks a gate.
function ensureImpactMap(runId) {
  try {
    if (impactMap.loadImpactMap(CWD, runId)) return null;
    const result = impactMap.generateImpactMap(CWD, { runId });
    console.error(`- Impact map: ${result.path} (DRAFT; review it with \`impact show\`, then \`impact confirm --by <name>\` or \`impact skip --reason <text>\`)`);
    return result;
  } catch (err) {
    console.error(`! impact map not written: ${err.message}`);
    return null;
  }
}

// Drift of the gated Maker diff against the map, recorded with verification;
// the review gate turns out-of-map files into LOW ledger findings.
function recordImpactDrift(runId) {
  try {
    return impactMap.detectImpactDrift(CWD, { runId }).drift;
  } catch (err) {
    console.error(`! impact drift not checked: ${err.message}`);
    return null;
  }
}

// `gate maker --from-git` (issue #35): write the working-tree diff (tracked and
// untracked files, excluding .ai-engineering-loop/) to RUN_DIR/diff.patch so the
// agent does not need a separate write step. ASSISTED/REPORT_ONLY only;
// UNATTENDED diffs come from `sandbox capture`.
function captureMakerDiff(run) {
  if (run.mode === 'UNATTENDED') throw new Error('--from-git is not allowed in UNATTENDED; use `sandbox capture`.');
  require('../lib/git-readiness.js').assertGitReady(CWD);
  const { execFileSync } = require('child_process');
  const exclude = ':(exclude).ai-engineering-loop';
  const git = (args, allowExit1 = false) => {
    try {
      return execFileSync('git', args, { cwd: CWD, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      if (allowExit1 && e.status === 1) return e.stdout;
      throw e;
    }
  };
  let diff = git(['diff', '--binary', 'HEAD', '--', '.', exclude]);
  const aelOnlyIgnore = (file) => file === '.gitignore' && (readFileSafe(path.join(CWD, file)) || '').trim().replace(/\/+$/, '') === '.ai-engineering-loop';
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', '.', exclude]).split('\0').filter(Boolean).filter((file) => !aelOnlyIgnore(file));
  for (const file of untracked) diff += git(['diff', '--binary', '--no-index', '--', '/dev/null', file], true);
  if (!diff.trim()) throw new Error('--from-git found no changes against HEAD.');
  const target = path.join(CWD, '.ai-engineering-loop', 'runs', run.runId, 'diff.patch');
  fs.writeFileSync(target, diff);
  return { path: path.relative(CWD, target).split(path.sep).join('/'), files: untracked.length };
}

function reviewLedgerBinding(run) {
  try {
    const ledger = JSON.parse(fs.readFileSync(path.join(CWD, '.ai-engineering-loop', 'runs', run.runId, 'findings.json'), 'utf8'));
    return require('../lib/review-ingest.js').checkLedgerBinding(CWD, run, ledger).binding;
  } catch {
    return null;
  }
}

function handleGate() {
  const gate = process.argv[3];
  const runId = argValue('--run');
  const json = process.argv.includes('--json');
  if (!gate || gate.startsWith('-')) {
    stageJsonError(Object.assign(new Error('gate needs a name: goal, maker, review, judge, delivery or report'), { code: 'INVALID_USAGE', why: 'Each gate checks one stage of the Run.', fix: '`ai-engineering-loop status` shows the current stage; then e.g. `ai-engineering-loop gate goal --run <id>`.' }), json, 'INVALID_USAGE');
  }
  let targetRunId = runId;
  try {
    const target = runId ? loadRun(CWD, runId) : getCurrentRun(CWD);
    if (!target) throw new Error('No current run. Start one with `ai-engineering-loop run`.');
    targetRunId = target.runId;
    if (gate === 'judge' && ['JUDGED_PASS', 'DELIVERED'].includes(target.state)) {
      const next = target.state === 'DELIVERED' ? 'nothing; the Run is delivered' : `deliver --run ${target.runId} --approve --by <name>`;
      if (json) console.log(JSON.stringify({ ok: true, runId: target.runId, state: target.state, gate, alreadyPassed: true, next }));
      else console.log(`✓ judge already PASS for ${target.runId}. Next: ${next}`);
      return;
    }
    if (process.argv.includes('--from-git')) {
      if (gate !== 'maker') throw new Error('--from-git only applies to `gate maker`.');
      captureMakerDiff(target);
    }
    const run = executeGate(gate, target.runId);
    const judge = gate === 'review' && run.tier ? judgeRequirement(CWD, run) : null;
    const ledgerBinding = gate === 'review' ? reviewLedgerBinding(run) : null;
    const guardEvents = guard.guardSummary(CWD, run.runId);
    if (json) {
      console.log(JSON.stringify({
        ok: true,
        runId: run.runId,
        state: run.state,
        iteration: run.iteration,
        gate,
        ...(run.tier ? { tier: run.tier.current } : {}),
        ...(judge ? { judgeRequired: judge.required, judgeReasons: judge.reasons } : {}),
        ...(ledgerBinding ? { ledgerBinding } : {}),
        guard: guardEvents
      }));
    } else {
      log.success(`✓ ${gate} gate passed`);
      console.log(`- Run: ${run.runId}`);
      console.log(`- State: ${run.state}, iteration ${run.iteration}`);
      if (run.tier) console.log(`- Tier: ${run.tier.current}`);
      for (const warning of (run.history || []).at(-1)?.cleanStateWarnings || []) console.log(`! Clean state: ${warning}`);
      if (guardEvents.warn || guardEvents.block) {
        console.log(`- Guard: ${guardEvents.block} blocked, ${guardEvents.warn} warned (${guardEvents.rules.join(', ')}); see guard-events.json`);
      }
      if (ledgerBinding === 'UNBOUND') {
        console.log('- Ledger: UNBOUND (hand-written findings.json). Prefer `review ingest` so the ledger is bound to the reviewer output.');
      }
      if (judge) {
        console.log(judge.required
          ? `- Judge: REQUIRED (${judge.reasons.join('; ')}). Spawn the Judge subagent, write verdict.json, then gate judge.`
          : '- Judge: not required. Run "gate judge" now; the CLI writes the deterministic verdict.');
      }
    }
  } catch (err) {
    const retryHint = targetRunId && gate && err.code === 'GATE_FAILED'
      ? `After correcting the reported issue, retry: npx ai-engineering-loop gate ${gate} --run ${targetRunId}`
      : null;
    const details = [...(err.details || []), ...(retryHint ? [retryHint] : [])];
    if (json) {
      console.log(JSON.stringify({
        ok: false,
        code: err.code || 'GATE_FAILED',
        error: err.message,
        ...(err.why ? { why: err.why } : {}),
        ...(err.fix ? { fix: err.fix } : {}),
        details
      }));
    } else {
      log.error(err.message);
      if (err.why) console.error(`WHY: ${err.why}`);
      if (err.fix) console.error(`FIX: ${err.fix}`);
      for (const detail of details) console.error(`- ${detail}`);
    }
    process.exit(1);
  }
}

function handleNode() {
  const action = process.argv[3] || 'status';
  const nodeId = process.argv[4];
  const runId = argValue('--run');
  const json = process.argv.includes('--json');
  try {
    if (action === 'status') {
      const workflow = workflowStatus(CWD, { runId });
      const result = {
        ok: true,
        runId: workflow.run.runId,
        recipe: workflow.plan.recipe,
        graphHash: workflow.plan.graphHash,
        nodes: workflow.plan.nodes.map((node) => ({
          id: node.id,
          type: node.type,
          order: node.order,
          ...workflow.state.nodes[node.id]
        }))
      };
      if (json) console.log(JSON.stringify(result));
      else {
        console.log(`Workflow: ${workflow.plan.recipe.id} (${workflow.plan.graphHash})`);
        for (const node of result.nodes) {
          console.log(`${String(node.order).padStart(2)} ${node.id}: ${node.status}`);
        }
      }
      return;
    }
    if (!nodeId || nodeId.startsWith('-')) throw new Error(`node ${action} requires a node id`);
    const beforeAction = workflowStatus(CWD, { runId });
    listRunLifecycle(CWD, beforeAction.run.runId);
    let workflow;
    if (action === 'start') {
      workflow = startWorkflowNode(CWD, nodeId, { runId });
    } else if (action === 'complete') {
      workflow = completeWorkflowNode(CWD, nodeId, { runId, artifact: argValue('--artifact') });
    } else if (action === 'fail') {
      workflow = failWorkflowNode(CWD, nodeId, {
        runId,
        reason: argValue('--reason') || 'node execution failed'
      });
    } else if (action === 'activity') {
      workflow = recordWorkflowActivity(CWD, nodeId, {
        runId,
        message: argValue('--message')
      });
    } else if (action === 'retry') {
      workflow = retryWorkflowNode(CWD, nodeId, { runId });
    } else if (action === 'approve') {
      if (!process.argv.includes('--yes')) {
        throw new Error('Approval requires explicit --yes confirmation');
      }
      workflow = approveWorkflowNode(CWD, nodeId, {
        runId,
        approvedBy: argValue('--by') || 'human'
      });
    } else {
      throw new Error(`Unknown node action: ${action}`);
    }
    const node = workflow.state.nodes[nodeId];
    const lifecycleType = {
      start: 'NODE_STARTED',
      activity: 'NODE_ACTIVITY',
      complete: 'NODE_COMPLETED',
      approve: 'NODE_COMPLETED',
      fail: 'NODE_ACTIVITY',
      retry: 'NODE_ACTIVITY'
    }[action];
    if (lifecycleType) {
      const lifecycleMessage = {
        start: `Node ${nodeId} started`,
        complete: `Node ${nodeId} completed`,
        approve: `Node ${nodeId} approved`,
        fail: `Node ${nodeId} failed`,
        retry: `Node ${nodeId} queued for retry`
      }[action];
      appendRunLifecycle(CWD, workflow.run.runId, {
        type: lifecycleType,
        nodeId,
        phase: nodeId,
        actor: action === 'approve' ? argValue('--by') || 'human' : 'agent',
        message: action === 'activity'
          ? argValue('--message')
          : lifecycleMessage
      });
    }
    if (json) console.log(JSON.stringify({ ok: true, nodeId, ...node }));
    else log.success(`✓ Node ${nodeId}: ${node.status}`);
  } catch (err) {
    if (json) {
      console.log(JSON.stringify({
        ok: false,
        code: err.code || 'NODE_FAILED',
        error: err.message,
        details: err.details || []
      }));
    } else {
      log.error(err.message);
      for (const detail of err.details || []) console.error(`- ${detail}`);
    }
    process.exit(1);
  }
}

function commandFiles(startIndex, optionsWithValues = []) {
  const files = [];
  for (let index = startIndex; index < process.argv.length; index++) {
    const value = process.argv[index];
    if (optionsWithValues.includes(value)) {
      index += 1;
      continue;
    }
    if (!value.startsWith('--')) files.push(value);
  }
  return files;
}

function handleContext() {
  const stage = process.argv[3];
  const runId = argValue('--run');
  const profile = argValue('--profile');
  const base = argValue('--base') || 'HEAD';
  const query = argValue('--query');
  const limit = Number(argValue('--limit') || 10);
  const json = process.argv.includes('--json');
  const includeIgnored = process.argv.includes('--include-ignored');
  const files = commandFiles(4, ['--run', '--profile', '--base', '--query', '--limit', '--output']);
  try {
    if (stage === 'index') {
      const result = buildContextIndex(CWD, { files, includeIgnored });
      const summary = smartContextSummary(result);
      if (json) {
        console.log(JSON.stringify({ ok: true, ...summary }));
      } else {
        log.success('✓ smart context index created');
        console.log(`- Path: ${summary.path}`);
        console.log(`- Files: ${summary.files}`);
      }
      return;
    }
    if (stage === 'query') {
      const result = queryContextIndex(CWD, { query: query || files.join(' '), limit });
      if (json) {
        console.log(JSON.stringify({ ok: true, ...result }));
      } else {
        log.success('✓ context index query complete');
        console.log(`- Matches: ${result.matches.length}`);
        for (const match of result.matches) console.log(`  - ${match.path}${match.symbols.length ? ` (${match.symbols.join(', ')})` : ''}`);
      }
      return;
    }
    if (stage === 'related') {
      const result = relatedContextIndex(CWD, { file: files[0], limit });
      if (json) {
        console.log(JSON.stringify({ ok: true, ...result }));
      } else {
        log.success('✓ related context query complete');
        console.log(`- File: ${result.file}`);
        for (const match of result.matches) console.log(`  - ${match.path}`);
      }
      return;
    }
    if (stage === 'fast-path') {
      const result = assessSmallTaskFastPath(CWD, { base, includeIgnored });
      if (json) {
        console.log(JSON.stringify({ ok: true, ...result }));
      } else {
        log.success(result.eligible ? '✓ small-task fast path eligible' : 'Small-task fast path not eligible');
        console.log(`- Profile: ${result.recommendedProfile}`);
        console.log(`- Files: ${result.changedPaths.length}, changed lines: ${result.changedLines}`);
        if (result.reasons.length) console.log(`- Reasons: ${result.reasons.join(', ')}`);
      }
      return;
    }
    if (stage === 'compact') {
      const result = compactRun(CWD, { runId });
      if (json) {
        console.log(JSON.stringify({ ok: true, runId: result.summary.runId, paths: result.paths, openFindings: result.summary.openFindings.length }));
      } else {
        log.success('✓ run context compacted');
        console.log(`- Summary: ${result.paths.markdown}`);
        console.log(`- Machine summary: ${result.paths.summary}`);
        console.log(`- Open findings: ${result.paths.openFindings}`);
      }
      return;
    }
    if (stage === 'claimed-vs-reality') {
      const result = createClaimedVsRealityTemplate(CWD, {
        runId,
        outputPath: argValue('--output') || undefined
      });
      if (json) console.log(JSON.stringify({ ok: true, ...result }));
      else {
        log.success('✓ Claimed-vs-reality template created from the frozen Goal');
        console.log(`- Run: ${result.runId}`);
        console.log(`- Path: ${result.path}`);
        console.log('- Claimed and Reality remain blank; populate Reality only from actual command output.');
      }
      return;
    }
    if (stage === 'diff-hunks' || stage === 'diff-pack') {
      const result = createDiffHunkPack(CWD, { runId, base, profile, includeIgnored });
      const summary = smartContextSummary(result);
      if (json) {
        console.log(JSON.stringify({ ok: true, ...summary }));
      } else {
        log.success('✓ smart diff hunk pack created');
        console.log(`- Path: ${summary.path}`);
        console.log(`- Review profile: ${summary.reviewProfile}`);
        console.log(`- Files: ${summary.files}, estimated tokens: ${summary.estimatedTokens}`);
        console.log(`- Unresolved findings: ${summary.unresolvedFindings}, truncated: ${summary.truncated}`);
        if (summary.ignoredPaths) console.log(`- Ignored by context policy: ${summary.ignoredPaths}`);
      }
      return;
    }
    const result = createContextPack(CWD, { runId, stage, files, profile });
    const summary = contextPackSummary(result);
    if (json) {
      console.log(JSON.stringify({ ok: true, ...summary }));
    } else {
      log.success(`✓ ${stage} context pack created`);
      console.log(`- Path: ${summary.path}`);
      console.log(`- Review profile: ${summary.reviewProfile}`);
      console.log(`- Files: ${summary.files}, estimated tokens: ${summary.estimatedTokens}`);
      console.log(`- Redactions: ${summary.redactions}, truncated files: ${summary.truncatedFiles}`);
    }
  } catch (err) {
    if (json) {
      console.log(JSON.stringify({
        ok: false,
        code: err.code || 'UNSAFE_CONTEXT',
        error: err.message,
        details: err.details || [],
        ...(err.budget ? { budget: err.budget } : {})
      }));
    } else {
      log.error(err.message);
      for (const detail of err.details || []) console.error(`- ${detail}`);
    }
    process.exit(1);
  }
}

function handleEval() {
  const casesDir = argValue('--cases') || defaultCasesDir();
  const resultsDir = argValue('--results');
  const json = process.argv.includes('--json');
  try {
    const fixtures = loadEvaluationCases(casesDir);
    if (!resultsDir) {
      const summary = catalogSummary(fixtures);
      if (json) console.log(JSON.stringify({ ok: true, mode: 'catalog', ...summary }));
      else {
        log.success(`✓ Evaluation catalog valid (${summary.total} cases)`);
        console.log(`- Categories: ${Object.keys(summary.categories).join(', ')}`);
        console.log(`- Oracle verdicts: ${JSON.stringify(summary.verdicts)}`);
      }
      return;
    }

    const score = scoreEvaluationResults(fixtures, loadResults(resultsDir));
    const ok = score.failed === 0 && score.incorrectPasses === 0 && score.secretLeaks === 0;
    if (json) console.log(JSON.stringify({ ok, ...score }));
    else {
      console.log(`Evaluation: ${score.passed}/${score.total} passed`);
      console.log(`- Incorrect PASS: ${score.incorrectPasses}`);
      console.log(`- Secret leaks: ${score.secretLeaks}`);
      for (const item of score.cases.filter((result) => !result.passed)) {
        console.log(`  ${item.caseId}: expected=${item.expected} actual=${item.actual || 'MISSING'}`);
      }
    }
    if (!ok) process.exit(1);
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'EVALUATION_FAILED', error: err.message, details: err.details || [] }));
    else {
      log.error(err.message);
      for (const detail of err.details || []) console.error(`- ${detail}`);
    }
    process.exit(1);
  }
}

function handleEscalation() {
  const runId = argValue('--run');
  const json = process.argv.includes('--json');
  try {
    const assessment = assessRunEscalation(CWD, { runId });
    if (json) console.log(JSON.stringify({ ok: true, ...assessment }));
    else {
      console.log(`Required model tier: ${assessment.requiredTier}`);
      for (const reason of assessment.reasons) {
        console.log(`- ${reason.code}: ${reason.detail}`);
      }
    }
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'ESCALATION_FAILED', error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

function handleState() {
  const runId = argValue('--run');
  const json = process.argv.includes('--json');
  try {
    const run = runId ? loadRun(CWD, runId) : getCurrentRun(CWD);
    if (!run) throw new Error('No current run. Start one with `ai-engineering-loop run`.');
    if (json) console.log(JSON.stringify({ ok: true, ...run }));
    else {
      console.log(`Run: ${run.runId}`);
      console.log(`State: ${run.state}`);
      console.log(`Iteration: ${run.iteration}`);
      console.log(`Artifacts: ${Object.keys(run.artifacts).join(', ') || 'none'}`);
      const hint = staleRunHint(run);
      if (hint) log.warn(hint);
    }
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'STATE_FAILED', error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

function handleDoctor() {
  const json = process.argv.includes('--json');
  if (process.argv.includes('--harness')) {
    // C-08: harness debt in this project (warnings never block).
    const audit = require('../lib/harness-audit.js').auditHarness(CWD);
    if (json) console.log(JSON.stringify(audit));
    else {
      console.log(`Harness audit: ${audit.ok ? 'no debt found' : 'debt found'}`);
      for (const item of audit.items) console.log(`${item.level === 'warn' ? '!' : '-'} ${item.id}: ${item.detail}`);
    }
    return;
  }
  const packageScope = process.argv.includes('--package');
  const skill = agentSkillState();
  const result = packageScope
    ? runDoctor(path.join(__dirname, '..'), { projectDir: CWD })
    : require('../lib/doctor.js').machineChecks(path.join(__dirname, '..'), { projectDir: CWD, hostSkills: skill.hosts ? { installed: skill.installed, stale: skill.hosts.stale, staleFiles: skill.hosts.staleFiles } : null });
  if (json) console.log(JSON.stringify({ ...result, scope: packageScope ? 'package' : 'machine' }));
  else {
    const warned = result.checks.some((check) => !check.passed && check.level === 'warn');
    console.log(`AI Engineering Loop doctor${packageScope ? ' (package)' : ''}: ${result.ok ? (warned ? 'READY (warnings)' : 'READY') : 'NOT READY'}`);
    for (const check of result.checks) {
      console.log(`${check.passed ? '✓' : check.level === 'warn' ? '!' : '✗'} ${check.id}: ${check.detail}`);
    }
  }
  if (!result.ok) process.exit(1);
}

function printUpdatePlan(plan) {
  console.log(`Current: ${plan.currentVersion}`);
  console.log(`Latest:  ${plan.latestVersion}`);
  console.log(`Install: ${plan.installScope}`);
  if (plan.updateAvailable) {
    console.log('\nUpdate available. Recommended commands:');
  } else {
    console.log('\nai-engineering-loop is up to date. Sync commands remain safe to run:');
  }
  for (const item of plan.commands) console.log(item.display);
}

// Used by auto-update for every registered project: regenerate context with
// user-edited files preserved (new templates land in *.ael-new).
function handleSafeRefresh() {
  if (!fs.existsSync(CONTEXT_DIR)) {
    log.error('No .ai-engineering-loop/ here; run init first.');
    process.exit(1);
  }
  const current = getCurrentRun(CWD);
  if (current && !TERMINAL_STATES.has(current.state)) {
    log.warn(`Run ${current.runId} is active (${current.state}); skipping refresh until it finishes.`);
    log.dim(`If that run is abandoned, close it first: ${require('../lib/run-abandon.js').abandonCommand(current.runId)}`);
    process.exit(3);
  }
  const legacy = !fs.existsSync(path.join(CONTEXT_DIR, GENERATED_HASHES_FILE));
  if (legacy) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    CONTEXT_WRITE_LEGACY = { root: path.resolve(CONTEXT_DIR), snapshotDir: path.join(CONTEXT_DIR, '.ael-backup', stamp) };
  }
  CONTEXT_WRITE_SAFE = true;
  const discovery = analyzeRepository(CWD);
  generateContextFiles(CWD, discovery, 'refresh', 'PACKAGE_UPDATE', { overwriteCore: true });
  removeObsoleteContextFiles(CONTEXT_DIR);
  CONTEXT_WRITE_SAFE = false;
  let snapshot = null;
  if (CONTEXT_WRITE_LEGACY && CONTEXT_WRITE_REPORT.snapshot.length) {
    snapshot = path.relative(CWD, CONTEXT_WRITE_LEGACY.snapshotDir).split(path.sep).join('/');
    fs.writeFileSync(path.join(CONTEXT_WRITE_LEGACY.snapshotDir, 'snapshot.json'), `${JSON.stringify({
      schemaVersion: 1,
      reason: 'LEGACY_FIRST_UPDATE',
      version: VERSION,
      at: new Date().toISOString(),
      files: CONTEXT_WRITE_REPORT.snapshot,
      removed: CONTEXT_WRITE_REPORT.removed
    }, null, 2)}\n`);
  }
  CONTEXT_WRITE_LEGACY = null;
  const report = {
    ok: true,
    mode: legacy ? 'legacy-first-update' : 'hash-checked',
    updated: CONTEXT_WRITE_REPORT.updated,
    aelNew: CONTEXT_WRITE_REPORT.aelNew,
    unchanged: CONTEXT_WRITE_REPORT.kept,
    removed: CONTEXT_WRITE_REPORT.removed,
    obsoleteKept: CONTEXT_WRITE_REPORT.obsoleteKept,
    snapshot
  };
  if (process.argv.includes('--json')) console.log(JSON.stringify(report));
  else {
    log.success('✓ Context refreshed non-destructively.');
    if (legacy) console.log(`- First update of a legacy project: AEL-managed files overwritten${snapshot ? `; previous copies in ${snapshot}` : ''}.`);
    if (report.removed.length) console.log(`- Removed obsolete AEL files: ${report.removed.join(', ')}`);
    if (report.aelNew.length) console.log(`- Kept your edits; review new templates: ${report.aelNew.join(', ')}`);
    if (report.obsoleteKept.length) console.log(`- Obsolete but edited (kept): ${report.obsoleteKept.join(', ')}`);
  }
}

function readCurrentRunFor(dir) {
  const run = getCurrentRun(dir);
  return run ? { ...run, terminal: TERMINAL_STATES.has(run.state) } : null;
}

function expectedRepository() {
  const repo = require('../package.json').repository;
  return repo && typeof repo === 'object' ? repo.url : repo || null;
}

// Decision 1 on #37: a short, useful notice, at most once a day per project,
// interactive stderr only (never CI or --json).
function showUpdateNotice(cache, decision, policy) {
  const notice = require('../lib/update-notice.js');
  if (!notice.noticeAllowed()) return;
  const projectKey = path.resolve(process.cwd());
  if (!notice.noticeDue(cache, projectKey)) return;
  const packageRoot = path.join(__dirname, '..');
  const scope = cache.scope || detectInstallScope(packageRoot);
  const manager = scope === 'global' ? notice.detectGlobalPackageManager(packageRoot) : notice.detectPackageManager(projectKey);
  const cached = cache.highlights;
  const highlights = cached && cached.target === decision.target && cached.from === VERSION ? cached.items || [] : [];
  process.stderr.write(`${notice.formatNotice({
    packageName: require('../package.json').name,
    current: VERSION,
    target: decision.target,
    bump: decision.bump,
    scope,
    manager,
    highlights,
    policy: policy.policy,
    reason: decision.reason
  })}\n`);
  const userState = require('../lib/user-state.js');
  userState.writeJsonFile(userState.userStatePath('update-check.json'), notice.markNoticeShown(cache, projectKey, decision.target));
}

// Background only: cache 2-4 CHANGELOG highlights for current -> target.
async function cacheUpdateHighlights(cache, decision, packageName) {
  if (!decision.target || decision.action === 'none') return;
  if (cache.highlights && cache.highlights.target === decision.target && cache.highlights.from === VERSION) return;
  const notice = require('../lib/update-notice.js');
  const slug = (String(expectedRepository() || '').match(/github\.com[/:]([^/]+\/[^/.]+)/) || [])[1] || null;
  const text = await notice.fetchChangelog({ packageName, target: decision.target, repositorySlug: slug });
  if (!text) return;
  const items = notice.changelogHighlights(text, { current: VERSION, target: decision.target });
  const userState = require('../lib/user-state.js');
  const latest = autoUpdate.readCache() || cache;
  userState.writeJsonFile(userState.userStatePath('update-check.json'), { ...latest, highlights: { from: VERSION, target: decision.target, items } });
}

// Foreground hook for run/status/init/refresh. Never blocks and never throws:
// prints a pending summary or notice to stderr and, when the cache is stale or
// an update is due, starts `update auto --background` detached.
function maybeAutoUpdate() {
  try {
    if (!autoUpdate.autoUpdateAllowedHere()) return;
    const summary = autoUpdate.consumeSummary();
    if (summary) process.stderr.write(`${summary}\n`);
    const policy = autoUpdate.resolvePolicy();
    if (policy.policy === 'off') return;
    const cache = autoUpdate.readCache();
    if (autoUpdate.cacheStale(cache)) {
      autoUpdate.spawnBackgroundCheck({ cliPath: __filename });
      return;
    }
    const state = autoUpdate.readState();
    const decision = autoUpdate.decideUpdate({ current: VERSION, distTags: cache.distTags, ...policy });
    const applyInBackground = decision.action === 'apply' && cache.scope === 'global';
    if (applyInBackground || (state.pendingProjects || []).length) {
      autoUpdate.spawnBackgroundCheck({ cliPath: __filename });
    }
    if (!applyInBackground && decision.action !== 'none') showUpdateNotice(cache, decision, policy);
  } catch {
    // Auto-update must never break a command.
  }
}

// `update auto [--background] [--force] [--json]`: check (cached 24 h), decide,
// and apply under the user's policy; also retries projects left pending.
function handleUpdateAuto() {
  const json = process.argv.includes('--json');
  const background = process.argv.includes('--background');
  const packageName = require('../package.json').name;
  const policy = autoUpdate.resolvePolicy();
  const out = (value) => {
    if (!background) console.log(json ? JSON.stringify(value) : JSON.stringify(value, null, 2));
  };
  if (policy.policy === 'off' && !process.argv.includes('--force')) {
    out({ ok: true, action: 'none', reason: `POLICY_OFF (${policy.source})` });
    return;
  }
  let cache = autoUpdate.readCache();
  if (autoUpdate.cacheStale(cache) || process.argv.includes('--force')) cache = autoUpdate.refreshCache({ packageName });
  const scope = detectInstallScope(path.join(__dirname, '..'));
  try {
    require('../lib/user-state.js').writeJsonFile(require('../lib/user-state.js').userStatePath('update-check.json'), { ...cache, scope });
  } catch {
    // Best effort.
  }
  const decision = autoUpdate.decideUpdate({ current: VERSION, distTags: cache.distTags, ...policy });
  // Agents installed after setup (#52): auto mode enables and syncs them here.
  let hostsResult = { added: [] };
  try {
    hostsResult = require('../lib/hosts/redetect.js').autoEnableNewHosts({ home: homeDir(), scope });
    if (hostsResult.added.length && decision.action !== 'apply') {
      const synced = applyHostSync({ home: homeDir(), hosts: resolveHostSelection(homeDir()), version: VERSION });
      hostsResult = { ...hostsResult, synced: synced.filter((item) => item.action === 'copy').length };
    }
  } catch (err) {
    hostsResult = { added: [], error: err.message };
  }
  const projects = projectRegistry.listProjects().projects;
  let result = null;
  if (decision.action === 'apply') {
    result = autoUpdate.applyUpdate({
      packageName,
      current: VERSION,
      target: decision.target,
      scope,
      projects,
      readCurrentRun: readCurrentRunFor,
      expectedRepository: expectedRepository()
    });
  } else {
    result = autoUpdate.processPending({ projects, readCurrentRun: readCurrentRunFor });
  }
  const held = result && Array.isArray(result.pending) && result.pending.length
    ? { pendingHint: `Projects skipped because a run is active. If a run is abandoned, run in that project: ${require('../lib/run-abandon.js').abandonCommand()}` }
    : {};
  out({ ok: true, policy: policy.policy, policySource: policy.source, scope, offline: cache.error || null, decision, result, hosts: hostsResult, ...held });
  cacheUpdateHighlights({ ...cache, scope }, decision, packageName).catch(() => {});
}

function handleUpdatePolicy() {
  const json = process.argv.includes('--json');
  const value = process.argv[4] && !process.argv[4].startsWith('-') ? process.argv[4] : undefined;
  const channel = argValue('--channel') || undefined;
  const pin = process.argv.includes('--no-pin') ? null : (argValue('--pin') || undefined);
  try {
    if (value !== undefined || channel !== undefined || pin !== undefined) autoUpdate.setPolicy({ policy: value, channel, pin });
    const resolved = autoUpdate.resolvePolicy();
    if (json) console.log(JSON.stringify({ ok: true, ...resolved }));
    else console.log(`Auto-update policy: ${resolved.policy} (${resolved.source}); channel ${resolved.channel}${resolved.pin ? `; pin ${resolved.pin}` : ''}. Majors are always notice-only.`);
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code, error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

function handleUpdateRollback() {
  const json = process.argv.includes('--json');
  try {
    if (!process.argv.includes('--yes')) throw Object.assign(new Error('update rollback requires --yes'), { code: 'CONFIRMATION_REQUIRED' });
    const record = autoUpdate.rollback({ packageName: require('../package.json').name, projects: projectRegistry.listProjects().projects });
    if (json) console.log(JSON.stringify({ ok: true, ...record }));
    else log.success(`✓ Rolled back to ${record.to} and re-synced host skills${record.restored && record.restored.length ? `; restored ${record.restored.length} legacy project snapshot(s)` : ""}.`);
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'ROLLBACK_FAILED', error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

function handleProjects() {
  const action = process.argv[3] || 'list';
  const json = process.argv.includes('--json');
  try {
    let result;
    if (action === 'list') result = projectRegistry.listProjects();
    else if (action === 'add') result = { added: projectRegistry.addProject(process.argv[4] && !process.argv[4].startsWith('-') ? process.argv[4] : CWD) };
    else if (action === 'remove') result = { removed: projectRegistry.removeProject(process.argv[4] && !process.argv[4].startsWith('-') ? process.argv[4] : CWD) };
    else if (action === 'scan') {
      const root = argValue('--root');
      if (!root) throw Object.assign(new Error('projects scan requires --root <dir>'), { code: 'ROOT_REQUIRED' });
      const depth = Number(argValue('--depth') || 4);
      if (!Number.isInteger(depth) || depth < 0 || depth > 8) throw Object.assign(new Error('--depth must be 0-8'), { code: 'INVALID_DEPTH' });
      result = projectRegistry.scanProjects(root, { maxDepth: depth });
    } else throw Object.assign(new Error(`Unknown projects action: ${action}`), { code: 'UNKNOWN_ACTION' });
    if (json) console.log(JSON.stringify({ ok: true, action, ...result }));
    else if (action === 'list') {
      if (!result.projects.length) console.log('No registered projects. They are added by init/run/status/refresh, or `projects add|scan`.');
      for (const p of result.projects) {
        const held = currentRunSafe(p.path);
        const info = held ? require('../lib/run-abandon.js').staleRunInfo(held) : { stale: false };
        const tag = info.stale ? `; held by stale run ${held.runId} (${held.state}, ${info.idleDays}d): run --abandon there` : '';
        console.log(`- ${p.path} (context ${p.contextVersion || '?'}, seen ${p.lastSeen}${tag})`);
      }
    } else console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'PROJECTS_FAILED', error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

// First-run question (TTY only, once). Non-interactive sessions stay on
// `notify` until the user picks a policy with `update policy`.
function askAutoUpdatePolicyOnce() {
  try {
    if (!process.stdin.isTTY || !process.stdout.isTTY || !autoUpdate.autoUpdateAllowedHere()) return;
    if (autoUpdate.resolvePolicy().source !== 'unset') return;
    process.stdout.write(`Auto-update ai-engineering-loop? [off/notify/patch/minor/all] (default ${autoUpdate.DEFAULT_POLICY}; majors are always notice-only): `);
    const buffer = Buffer.alloc(64);
    const bytes = fs.readSync(0, buffer, 0, buffer.length, null);
    const answer = buffer.toString('utf8', 0, bytes).trim().toLowerCase() || autoUpdate.DEFAULT_POLICY;
    autoUpdate.setPolicy({ policy: autoUpdate.POLICIES.includes(answer) ? answer : autoUpdate.DEFAULT_POLICY });
  } catch {
    // Never block init on the prompt.
  }
}

function handleUpdate() {
  const action = process.argv[3] || 'check';
  if (action === 'auto') return handleUpdateAuto();
  if (action === 'policy') return handleUpdatePolicy();
  if (action === 'rollback') return handleUpdateRollback();
  const json = process.argv.includes('--json');
  const yes = process.argv.includes('--yes');
  try {
    const plan = checkForUpdate(path.join(__dirname, '..'));
    if (action === 'check' || action === 'plan') {
      if (json) console.log(JSON.stringify({ ok: true, action, ...plan }));
      else printUpdatePlan(plan);
      return;
    }
    if (action === 'apply') {
      if (json && !yes) {
        throw new Error('update apply requires --yes; use update plan for a dry run');
      }
      if (!yes) {
        printUpdatePlan(plan);
        throw new Error('Refusing to update without explicit confirmation. Re-run with: ai-engineering-loop update apply --yes');
      }
      if (!plan.updateAvailable) {
        if (json) console.log(JSON.stringify({ ok: true, action, skipped: true, reason: 'UP_TO_DATE', ...plan }));
        else {
          console.log('ai-engineering-loop is already up to date.');
          printUpdatePlan(plan);
        }
        return;
      }
      if (!json) printUpdatePlan(plan);
      executeUpdatePlan(plan);
      if (json) console.log(JSON.stringify({ ok: true, action, applied: true, ...plan }));
      else log.success('✓ ai-engineering-loop updated and post-update sync completed');
      return;
    }
    throw new Error(`Unknown update action: ${action}`);
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'UPDATE_FAILED', error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

// `migrate --from <old>`: idempotent major migrations for home and every
// registered project (plus this one when it has .ai-engineering-loop/).
function handleMigrate() {
  const json = process.argv.includes('--json');
  try {
    const from = argValue('--from');
    if (!from) throw Object.assign(new Error('migrate requires --from <old-version>'), { code: 'FROM_REQUIRED' });
    const migrations = require('../lib/migrations.js');
    const projects = projectRegistry.listProjects().projects.map((p) => p.path);
    const here = path.resolve(CWD);
    if (fs.existsSync(path.join(here, '.ai-engineering-loop')) && !projects.includes(here)) projects.push(here);
    const report = migrations.runMigrations({ from, to: VERSION, projects, dryRun: process.argv.includes('--dry-run') });
    if (json) console.log(JSON.stringify({ ok: true, ...report }));
    else if (!report.migrations.length) console.log(`No migrations between ${from} and ${VERSION}.`);
    else for (const step of report.migrations) console.log(`- v${step.major}: ${step.description} (home ${step.home}, ${step.projects.length} project(s))`);
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'MIGRATE_FAILED', error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

function workflowFail(err, json) {
  if (json) {
    console.log(JSON.stringify({
      ok: false,
      code: err.code || 'PERSONAL_WORKFLOW_FAILED',
      error: err.message,
      details: err.details || []
    }));
  } else {
    log.error(err.message);
    for (const detail of err.details || []) console.error(`- ${detail}`);
  }
  process.exit(1);
}

function readAnswersFile(file) {
  if (!file) {
    throw Object.assign(new Error('workflow propose requires --answers <file>'), { code: 'ANSWERS_REQUIRED' });
  }
  const absolute = path.resolve(CWD, file);
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    throw Object.assign(new Error(`Answers file not found: ${file}`), { code: 'ANSWERS_NOT_FOUND' });
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw Object.assign(new Error('Answers file must be a regular file'), { code: 'UNSAFE_ANSWERS_PATH' });
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (cause) {
    throw Object.assign(new Error(`Answers JSON is invalid: ${cause.message}`), { code: 'INVALID_ANSWERS' });
  }
}

function workflowMode() {
  const explicit = argValue('--mode');
  if (explicit) return explicit;
  try {
    const current = getCurrentRun(CWD);
    if (current && !TERMINAL_STATES.has(current.state)) return current.mode;
  } catch {
    // No run is not a mode.
  }
  return null;
}

function handleWorkflow() {
  const action = process.argv[3] || '';
  const json = process.argv.includes('--json');
  const personal = require('../lib/personal-workflow.js');
  try {
    if (action === 'interview') {
      const result = personal.interviewQuestions();
      console.log(json ? JSON.stringify({ ok: true, ...result }) : JSON.stringify({ ok: true, ...result }, null, 2));
      return;
    }
    if (action === 'propose') {
      const result = personal.proposeFromAnswers(readAnswersFile(argValue('--answers')), { rootDir: CWD });
      console.log(JSON.stringify({
        ok: true,
        id: result.proposal.id,
        status: result.proposal.status,
        valid: true,
        diff: result.diff
      }));
      return;
    }
    if (action === 'accept' || action === 'reject') {
      const proposalId = argValue('--proposal');
      if (!proposalId) throw Object.assign(new Error(`workflow ${action} requires --proposal <id>`), { code: 'PROPOSAL_REQUIRED' });
      const result = action === 'accept'
        ? personal.acceptProposal({ proposalId, by: argValue('--by'), mode: workflowMode() })
        : personal.rejectProposal({ proposalId, by: argValue('--by'), mode: workflowMode() });
      console.log(JSON.stringify({
        ok: true,
        id: result.proposal.id,
        status: result.proposal.status,
        ...(result.recipe ? { recipeId: result.recipe.id, version: result.recipe.version, replacedVersion: result.replacedVersion } : {})
      }));
      return;
    }
    if (action === 'suggest') {
      const result = personal.suggestProposals({ rootDir: CWD });
      console.log(JSON.stringify({
        ok: true,
        historyCount: result.historyCount,
        proposals: result.proposals.map((item) => ({
          id: item.id,
          kind: item.kind,
          status: item.status,
          evidence: item.evidence
        }))
      }));
      return;
    }
    throw Object.assign(new Error('Unknown workflow action. Use interview|propose|accept|reject|suggest'), { code: 'UNKNOWN_WORKFLOW_ACTION' });
  } catch (err) {
    workflowFail(err, json);
  }
}

function handleRecipe() {
  const action = process.argv[3] || 'list';
  const id = process.argv[4];
  const mode = argValue('--mode');
  const json = process.argv.includes('--json');
  try {
    if (action === 'catalog') {
      const result = { ok: true, nodeTypes: recipeCatalog() };
      console.log(JSON.stringify(result, null, json ? 0 : 2));
      return;
    }
    if (action === 'clone' || action === 'create') {
      const sourceId = action === 'clone' ? id : (argValue('--from') || 'default');
      const targetId = action === 'clone' ? process.argv[5] : id;
      if (!sourceId || !targetId || targetId.startsWith('-')) {
        throw new Error(`recipe ${action} requires ${action === 'clone' ? '<source> <target>' : '<id> [--from <preset>]'}`);
      }
      const result = cloneRecipe(CWD, sourceId, targetId, { description: argValue('--description') });
      const relativePath = path.relative(CWD, result.path).split(path.sep).join('/');
      console.log(json ? JSON.stringify({ ok: true, ...result, path: relativePath }) :
        `Created ${targetId} from ${sourceId} at ${relativePath}\nSource hash: ${result.sourceHash}`);
      return;
    }
    if (action === 'install') {
      if (!id || id.startsWith('-')) throw new Error('recipe install requires a candidate path');
      const result = installRecipe(CWD, id, { replace: process.argv.includes('--replace') });
      const relativePath = path.relative(CWD, result.path).split(path.sep).join('/');
      console.log(json ? JSON.stringify({ ok: true, ...result, path: relativePath }) :
        `Installed ${result.recipe.id} v${result.recipe.version}\nSource hash: ${result.sourceHash}`);
      return;
    }
    if (action === 'diff') {
      const rightId = process.argv[5];
      if (!id || !rightId) throw new Error('recipe diff requires <left> <right>');
      const result = diffRecipes(CWD, id, rightId);
      console.log(JSON.stringify({ ok: true, ...result }, null, json ? 0 : 2));
      return;
    }
    if (action === 'inspect') {
      if (!id || id.startsWith('-')) throw new Error('recipe inspect requires an id');
      console.log(JSON.stringify({ ok: true, ...inspectRecipe(CWD, id) }, null, json ? 0 : 2));
      return;
    }
    if (action === 'list') {
      const recipes = listRecipes(CWD).map((entry) => {
        const { recipe } = loadRecipe(CWD, entry.id);
        return {
          ...entry,
          description: recipe.description,
          compatibleModes: recipe.compatibleModes
        };
      });
      if (json) console.log(JSON.stringify({ ok: true, recipes }));
      else {
        console.log('Workflow recipes:');
        for (const recipe of recipes) {
          console.log(`- ${recipe.id} [${recipe.source}] ${recipe.compatibleModes.join(', ')}`);
          console.log(`  ${recipe.description}`);
        }
      }
      return;
    }

    if (!['show', 'validate', 'explain', 'graph', 'simulate'].includes(action)) {
      throw Object.assign(new Error(`Unknown recipe action: ${action}`), { code: 'UNKNOWN_RECIPE_ACTION' });
    }
    if (!id || id.startsWith('-')) {
      throw Object.assign(new Error(`recipe ${action} requires an id`), { code: 'RECIPE_ID_REQUIRED' });
    }
    const loaded = loadRecipe(CWD, id);
    if (action === 'show') {
      console.log(JSON.stringify(loaded.recipe, null, json ? 0 : 2));
      return;
    }
    if (action === 'validate') {
      const validation = validateRecipe(loaded.recipe, mode ? { mode } : {});
      const result = { ok: validation.valid, id, source: loaded.source, ...validation };
      if (json) console.log(JSON.stringify(result));
      else {
        console.log(`Recipe ${id}: ${validation.valid ? 'VALID' : 'INVALID'}`);
        for (const warning of validation.warnings) console.log(`! ${warning}`);
        for (const error of validation.errors) console.log(`✗ ${error}`);
      }
      if (!validation.valid) process.exit(1);
      return;
    }

    const plan = compileRecipe(loaded.recipe, mode ? { mode } : {});
    if (action === 'explain') {
      console.log(json ? JSON.stringify({ ok: true, source: loaded.source, plan }) : explainPlan(plan));
    } else if (action === 'graph') {
      const mermaid = mermaidPlan(plan);
      console.log(json ? JSON.stringify({ ok: true, graphHash: plan.graphHash, mermaid }) : mermaid);
    } else {
      const simulation = simulatePlan(plan);
      console.log(JSON.stringify({ ok: true, ...simulation }, null, json ? 0 : 2));
    }
  } catch (err) {
    if (json) {
      console.log(JSON.stringify({
        ok: false,
        code: err.code || 'RECIPE_FAILED',
        error: err.message,
        details: err.details || []
      }));
    } else {
      log.error(err.message);
      for (const detail of err.details || []) console.error(`- ${detail}`);
    }
    process.exit(1);
  }
}

function safeHandoffOutput(file) {
  const absolute = path.resolve(CWD, file);
  const relative = path.relative(CWD, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw Object.assign(new Error('Handoff output must stay inside the repository'), { code: 'UNSAFE_HANDOFF_PATH' });
  }
  const parent = path.dirname(absolute);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const realRoot = fs.realpathSync(CWD);
  const realParent = fs.realpathSync(parent);
  if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${path.sep}`)) {
    throw Object.assign(new Error('Handoff output escapes the repository through a symlink'), { code: 'UNSAFE_HANDOFF_PATH' });
  }
  return absolute;
}

function handleHandoff() {
  const action = process.argv[3] || 'create';
  const json = process.argv.includes('--json');
  try {
    if (action === 'create') {
      const bundle = createHandoff(CWD, {
        runId: argValue('--run'),
        audience: argValue('--audience') || 'developer'
      });
      const requested = argValue('--output');
      if (requested === '-') {
        console.log(JSON.stringify(bundle, null, json ? 0 : 2));
        return;
      }
      const output = safeHandoffOutput(requested || `${bundle.runId}.ael-handoff.json`);
      const descriptor = fs.openSync(output, 'wx', 0o600);
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify(bundle, null, 2)}\n`);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      const result = {
        ok: true,
        path: path.relative(CWD, output).split(path.sep).join('/'),
        runId: bundle.runId,
        audience: bundle.audience,
        bundleHash: bundle.bundleHash
      };
      console.log(json ? JSON.stringify(result) : `Created ${result.path}\nBundle hash: ${result.bundleHash}`);
      return;
    }
    const file = process.argv[4];
    if (!file || file.startsWith('-')) throw new Error(`handoff ${action} requires a file`);
    const bundle = readHandoff(CWD, file);
    const verification = verifyHandoff(bundle);
    if (action === 'inspect') {
      console.log(JSON.stringify({ ok: true, ...verification }, null, json ? 0 : 2));
    } else if (action === 'brief') {
      console.log(handoffBrief(bundle));
    } else {
      throw new Error('Unknown handoff action. Use create|inspect|brief');
    }
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'HANDOFF_FAILED', error: err.message }));
    else log.error(err.message);
    process.exitCode = 1;
  }
}

function openStudio(url) {
  const command = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function requiredRunId(command) {
  const runId = argValue('--run') || getCurrentRun(CWD)?.runId;
  if (!runId) {
    const error = new Error(`${command} requires --run <id> or a current Run`);
    error.code = 'INVALID_USAGE';
    throw error;
  }
  return runId;
}

function integerArg(name, fallback) {
  const raw = argValue(name);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    const error = new Error(`${name} must be a non-negative integer`);
    error.code = 'INVALID_USAGE';
    throw error;
  }
  return value;
}

function requiredIntegerArg(name) {
  const value = integerArg(name, undefined);
  if (value == null) {
    const error = new Error(`${name} is required`);
    error.code = 'INVALID_USAGE';
    throw error;
  }
  return value;
}

function readBoundedJsonInput(fileName) {
  if (!fileName) {
    const error = new Error('goal draft requires --file <json> or --from-design <doc.md>');
    error.code = 'INVALID_USAGE';
    error.why = 'The Goal Contract is a JSON file: objective, acceptance criteria with evidence and failure cases.';
    error.fix = '`ai-engineering-loop scaffold goal` writes a template to .ai-engineering-loop/drafts/goal.json; fill it in, then `goal draft --file .ai-engineering-loop/drafts/goal.json --revision 0`.';
    throw error;
  }
  const file = path.resolve(CWD, fileName);
  const relative = path.relative(CWD, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('Goal draft input must stay inside the repository');
    error.code = 'UNSAFE_GOAL_PATH';
    throw error;
  }
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > 256 * 1024) {
    const error = new Error('Goal draft input must be a bounded regular file');
    error.code = 'INVALID_GOAL_DRAFT';
    throw error;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Spec pack hint (#99): once, when a new Run starts at T2. T0/T1 and resumed
// Runs get nothing, so their output is unchanged.
function specHintField(runResult) {
  const run = runResult.run;
  if (runResult.resumed || run.tier?.current !== 'T2') return {};
  let installed = false;
  try {
    installed = hostSkillStatus({ home: homeDir(), version: VERSION }).packs.includes('spec');
  } catch {
    installed = false;
  }
  return {
    specHint: 'For a new feature or architecture change, design first with the ael-spec skill: brainstorm -> draft -> review, then `goal draft --from-design docs/designs/<name>.md`.' +
      (installed ? '' : ' Install it with `sync-hosts`.')
  };
}

function handleGoal() {
  const action = args[1] || 'show';
  try {
    const runId = requiredRunId('goal');
    let result;
    const extra = {};
    if (action === 'show') {
      result = loadGoalDraft(CWD, runId);
      if (process.argv.includes('--human')) {
        if (!result) throw Object.assign(new Error('No Goal draft yet'), { code: 'GOAL_DRAFT_MISSING', fix: '`scaffold goal`, fill it in, then `goal draft --file .ai-engineering-loop/drafts/goal.json --revision 0`.' });
        process.stdout.write(require('../lib/ste.js').renderHumanGoal(result.contract, { runId, revision: result.metadata?.revision }));
        return;
      }
      if (result?.contract?.designRef) extra.design = require('../lib/design-ref.js').designStatus(CWD, result.contract.designRef);
    } else if (action === 'draft') {
      appendRunLifecycle(CWD, runId, {
        type: 'GOAL_DRAFTING',
        phase: 'goal',
        actor: argValue('--by') || 'agent',
        message: argValue('--message') || 'Updating the Goal draft'
      });
      const designFile = argValue('--from-design');
      let draftGoal;
      if (designFile) {
        const designRef = require('../lib/design-ref.js');
        const doc = designRef.readDesignDoc(CWD, designFile);
        const parsed = designRef.parseDesignDoc(doc.text);
        draftGoal = argValue('--file')
          ? { ...readBoundedJsonInput(argValue('--file')), designRef: designRef.designRefFrom(doc, parsed) }
          : designRef.draftFromDesign(doc, parsed);
        extra.design = {
          path: doc.path,
          targetFiles: parsed.targetFiles.length,
          placeholders: designRef.placeholderRows(draftGoal),
          warnings: parsed.warnings
        };
      } else {
        draftGoal = readBoundedJsonInput(argValue('--file'));
      }
      if (draftGoal && draftGoal._templateOnly === true) {
        throw Object.assign(new Error(`${argValue('--file')} is still the scaffold template`), { code: 'TEMPLATE_ONLY', why: 'A template with <...> placeholders would freeze a Goal nobody wrote.', fix: 'Replace every <...> with the real goal, delete `_templateOnly` and `_howTo`, then rerun `goal draft`.' });
      }
      const restatementErrors = require('../lib/gates.js').restatementProblems(draftGoal);
      if (restatementErrors.length) {
        throw Object.assign(new Error(`Goal draft is missing a restatement: ${restatementErrors.join('; ')}`), {
          code: 'RESTATEMENT_MISSING',
          why: 'A freeze without a restatement locks the method the human suggested, not the problem the agent understood.',
          fix: 'Add restatement { problem, doneWhen, failIf, unknowns } to the Goal JSON. State the problem and the outcomes in your own words. Leave the steps out. Then rerun `goal draft`.'
        });
      }
      const draftFile = argValue('--file');
      if (draftFile && !path.resolve(CWD, draftFile).startsWith(path.join(CWD, '.ai-engineering-loop') + path.sep)) {
        extra.warning = `Goal draft file ${draftFile} is outside .ai-engineering-loop/, so it will show up in the Maker diff. Keep drafts in .ai-engineering-loop/drafts/.`;
        console.error(`! ${extra.warning}`);
      }
      result = saveGoalDraft(CWD, runId, draftGoal, {
        actor: argValue('--by') || 'agent',
        expectedRevision: requiredIntegerArg('--revision')
      });
      extra.repoRoot = require('../lib/git-readiness.js').gitTopLevel(CWD);
      extra.impactPreview = impactPreview(runId, draftGoal);
      const ste = require('../lib/ste.js');
      const humanPath = path.join(runsDir(CWD), runId, 'goal.md');
      fs.writeFileSync(humanPath, ste.renderHumanGoal(draftGoal, { runId, revision: result.metadata?.revision }), { mode: 0o600 });
      extra.human = { path: path.relative(CWD, humanPath).split(path.sep).join('/'), show: `goal show --run ${runId} --human` };
      extra.readability = ste.goalReadability(draftGoal);
      if (draftGoal && draftGoal.flow != null) {
        const flowLib = require('../lib/flow.js');
        extra.flow = { table: flowLib.renderFlow(draftGoal.flow), mermaid: flowLib.renderMermaid(draftGoal.flow), problems: flowLib.flowProblems(draftGoal.flow), warnings: flowLib.flowWarnings(draftGoal.flow), ...flowLib.flowCounts(draftGoal) };
        const preference = require('../lib/generate-workflow.js').readFreezeDiagram(CWD);
        extra.diagramOptions = flowLib.diagramOptions(draftGoal, { preference });
        if (preference === 'off') extra.diagramsOff = true;
        else extra.diagramHint = `Offer the recommended view or freeze; render one with \`goal diagram --run ${runId} --view <state|storyboard|lanes>\`.`;
      }
      appendRunLifecycle(CWD, runId, {
        type: 'GOAL_DRAFT_UPDATED',
        phase: 'goal',
        actor: argValue('--by') || 'agent',
        message: `Goal draft revision ${result.metadata.revision} was saved`
      });
      appendRunLifecycle(CWD, runId, {
        type: 'GOAL_READY',
        phase: 'goal',
        actor: argValue('--by') || 'agent',
        message: `Goal draft revision ${result.metadata.revision} is ready for review`
      });
      // The freeze question is persisted with the draft, so Studio shows it
      // without a separate `interaction question` call.
      try {
        extra.question = appendRunQuestion(CWD, runId, {
          message: freezeQuestionMessage(result.metadata.revision),
          actor: argValue('--by') || 'agent'
        });
        appendRunLifecycle(CWD, runId, { type: 'AGENT_WAITING', phase: 'goal', actor: argValue('--by') || 'agent', message: `Waiting for answer to Q${extra.question.number}` });
      } catch (err) {
        extra.question = { error: err.message };
      }
    } else if (action === 'freeze') {
      const { assertGoalFreezeApproval, freezeMode } = require('../lib/goal-freeze-approval.js');
      const approval = assertGoalFreezeApproval({ runId, actor: argValue('--by'), mode: freezeMode(CWD) });
      const latest = process.argv.includes('--latest');
      const latestDraft = latest ? loadGoalDraft(CWD, runId) : null;
      if (latest && !latestDraft) {
        throw Object.assign(new Error('No Goal draft to freeze'), { code: 'GOAL_DRAFT_MISSING' });
      }
      const expectedHash = latest ? latestDraft.metadata.contentHash : argValue('--hash');
      if (!expectedHash) {
        const error = new Error('--hash is required (or --latest)');
        error.code = 'INVALID_USAGE';
        throw error;
      }
      const target = loadRun(CWD, runId);
      let goalNode = null;
      if (target.workflow) {
        const workflow = workflowStatus(CWD, { runId });
        goalNode = workflow.plan.nodes.find((node) => node.legacyGate === 'goal') || null;
        if (goalNode && workflow.state.nodes[goalNode.id].status === 'READY') {
          startWorkflowNode(CWD, goalNode.id, { runId });
          appendRunLifecycle(CWD, runId, {
            type: 'NODE_STARTED',
            nodeId: goalNode.id,
            phase: 'goal',
            actor: 'agent',
            message: `${goalNode.displayName || goalNode.id} freeze started`
          });
        }
      }
      result = freezeGoal(CWD, runId, {
        actor: argValue('--by'),
        expectedRevision: latest ? latestDraft.metadata.revision : requiredIntegerArg('--revision'),
        expectedHash,
        interactiveConfirmed: approval.via === 'tty'
      });
      const human = result.goal.actor;
      if (result.alreadyFrozen) {
        extra.alreadyFrozen = true;
        closeFreezeQuestions(runId, humanFreezeActor(argValue('--by'), runId));
      } else {
        appendRunLifecycle(CWD, runId, {
          type: goalNode ? 'NODE_COMPLETED' : 'GOAL_FROZEN',
          ...(goalNode ? { nodeId: goalNode.id } : {}),
          phase: 'goal',
          actor: human,
          message: 'Goal Contract frozen'
        });
        ensureImpactMap(runId);
        closeFreezeQuestions(runId, human);
        // One human stop: the same person accepts the Goal and its blast radius
        // (shown as impactPreview with the draft).
        if (process.argv.includes('--confirm-impact')) {
          const confirmed = impactMap.confirmImpactMap(CWD, { runId, by: human });
          extra.impact = { status: confirmed.map ? confirmed.map.status : 'CONFIRMED' };
        }
      }
    } else if (action === 'diagram') {
      Object.assign(extra, renderGoalDiagram(runId));
    } else {
      const error = new Error('goal must be show, draft, freeze, or diagram');
      error.code = 'INVALID_USAGE';
      throw error;
    }
    if (!process.argv.includes('--json') && ['draft', 'freeze'].includes(action)) {
      const meta = result?.metadata || {};
      if (extra.alreadyFrozen) {
        log.success(`✓ Goal already frozen by ${result.goal.actor} (${result.goal.approval})`);
        console.log('- Next: Maker (implement), then `gate maker --from-git`. Agents: add --json.');
        return;
      }
      log.success(`✓ goal ${action}: Run ${runId}${meta.revision != null ? `, revision ${meta.revision}` : ''}${meta.contentHash ? ` (${String(meta.contentHash).slice(0, 12)})` : ''}`);
      if (action === 'draft' && extra.human) {
        console.log('');
        process.stdout.write(fs.readFileSync(path.join(CWD, extra.human.path), 'utf8'));
        console.log('');
      }
      if (action === 'draft') console.log(`- Repo: ${extra.repoRoot || 'unresolved'}`);
      if (extra.impactPreview) console.log(`- Impact preview: ${JSON.stringify(extra.impactPreview).slice(0, 200)}`);
      if (extra.warning) console.log(`! ${extra.warning}`);
      console.log(action === 'draft' ? `- Next: ask the human to run \`goal freeze --latest --run ${runId} --by "<their name>"\` in their own terminal and type the confirmation. Agents: add --json. Do not freeze from this shell.` : '- Next: Maker (implement), then `gate maker --from-git`. Agents: add --json.');
      return;
    }
    console.log(JSON.stringify({ ok: true, runId, [action === 'show' ? 'draft' : 'result']: result, ...extra }, null, 2));
  } catch (error) {
    process.exitCode = 1;
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ ok: false, code: error.code || 'GOAL_FAILED', error: error.message, ...(error.why ? { why: error.why } : {}), ...(error.fix ? { fix: error.fix } : {}) }));
      return;
    }
    log.error(`${error.code || 'GOAL_FAILED'}: ${error.message}`);
    if (error.why) console.error(`WHY: ${error.why}`);
    if (error.fix) console.error(`FIX: ${error.fix}`);
  }
}

function contentLangArg() {
  const lang = argValue('--lang');
  if (lang == null) return null;
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) {
    throw Object.assign(new Error('--lang must be a language tag such as id, en or pt-BR'), { code: 'INVALID_USAGE' });
  }
  return lang;
}

function renderGoalDiagram(runId) {
  const view = argValue('--view');
  const { VIEWS } = require('../lib/flow.js');
  if (!VIEWS.includes(view)) {
    throw Object.assign(new Error('goal diagram needs --view state|storyboard|lanes'), { code: 'INVALID_USAGE' });
  }
  const run = loadRun(CWD, runId);
  let goal;
  let revision;
  let suffix;
  if (run.goal?.frozen) {
    goal = JSON.parse(fs.readFileSync(path.join(CWD, '.ai-engineering-loop', 'runs', runId, 'goal-contract.json'), 'utf8'));
    revision = null;
    suffix = 'frozen';
  } else {
    const draft = loadGoalDraft(CWD, runId);
    if (!draft) throw Object.assign(new Error('No Goal draft yet: run `goal draft` first'), { code: 'GOAL_DRAFT_MISSING' });
    revision = draft.metadata.revision;
    const requested = argValue('--revision');
    if (requested != null && Number(requested) !== revision) {
      throw Object.assign(new Error(`Only the latest draft is kept: it is revision ${revision}. Rerun with --revision ${revision} or without --revision.`), { code: 'GOAL_REVISION_MISMATCH' });
    }
    goal = draft.contract;
    suffix = `r${revision}`;
  }
  if (!Array.isArray(goal.flow) || !goal.flow.length) {
    throw Object.assign(new Error('The Goal has no flow to draw. Add flow steps ({from, event, to}) to the draft, then rerun `goal draft`.'), { code: 'GOAL_FLOW_MISSING' });
  }
  const html = require('../lib/flow-diagram.js').renderDiagram(goal, { view, revision, lang: contentLangArg() });
  const dir = path.join(CWD, '.ai-engineering-loop', 'runs', runId, 'diagrams');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${view}-${suffix}.html`);
  fs.writeFileSync(file, html, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  if (process.argv.includes('--open')) openStudio(file);
  const counts = require('../lib/flow.js').flowCounts(goal);
  return {
    view,
    path: file,
    counts,
    next: counts.undecided || counts.hotspots || counts.sideEffects
      ? 'Ask the human: freeze, another view, or turn the ? cells, hotspots and side effects into AC, non-goals or forbiddenTransitions (new draft revision).'
      : 'Ask the human: freeze or another view.'
  };
}

function handleActivity() {
  const aliases = {
    'goal-drafting': 'GOAL_DRAFTING',
    'goal-ready': 'GOAL_READY',
    heartbeat: 'AGENT_HEARTBEAT',
    waiting: 'AGENT_WAITING',
    'node-started': 'NODE_STARTED',
    'node-activity': 'NODE_ACTIVITY',
    'node-completed': 'NODE_COMPLETED',
    'node-failed': 'NODE_FAILED',
    'loop-iterated': 'LOOP_ITERATED',
    'run-completed': 'RUN_COMPLETED'
  };
  try {
    const action = args[1] || 'heartbeat';
    const type = aliases[action];
    if (!type) throw Object.assign(new Error(`Unknown activity type: ${action}`), { code: 'INVALID_USAGE' });
    const runId = requiredRunId('activity');
    const nodeId = argValue('--node');
    if (type.startsWith('NODE_') && !nodeId) {
      throw Object.assign(new Error(`${action} requires --node <id>`), { code: 'INVALID_USAGE' });
    }
    const event = appendRunLifecycle(CWD, runId, {
      type,
      phase: argValue('--phase'),
      nodeId,
      actor: argValue('--by') || 'agent',
      message: argValue('--message') || 'Agent is working',
      status: argValue('--status'),
      ...(argValue('--evidence-path') ? {
        evidence: {
          path: argValue('--evidence-path'),
          sha256: argValue('--evidence-hash')
        }
      } : {})
    });
    console.log(JSON.stringify({ ok: true, event, presence: runAgentPresence(CWD, runId) }, null, 2));
  } catch (error) {
    log.error(`${error.code || 'ACTIVITY_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}

const STUDIO_START_WAIT_MS = 5000;
const STUDIO_STOP_WAIT_MS = 3000;

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function studioLogPath(home) {
  return path.join(home, '.ai-engineering-loop', 'studio.log');
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function studioAnswersHealth(instance) {
  try {
    const response = await fetch(`http://127.0.0.1:${instance.port}/healthz`, { signal: AbortSignal.timeout(1500) });
    const body = await response.json();
    return body.app === 'ael-studio' && body.pid === instance.pid;
  } catch {
    return false;
  }
}

async function waitForExit(pid, ms) {
  const deadline = Date.now() + ms;
  while (pidIsAlive(pid) && Date.now() < deadline) await sleepMs(50);
  return !pidIsAlive(pid);
}

async function stopStudio(home) {
  const { readInstance, clearInstance } = require('../lib/studio/instance.js');
  const instance = readInstance({ home });
  if (!instance) {
    console.log('Studio is not running');
    return;
  }
  if (!(await studioAnswersHealth(instance))) {
    clearInstance({ home });
    console.log('Studio is not running (removed a stale instance file)');
    return;
  }
  try {
    process.kill(instance.pid, 'SIGTERM');
  } catch {
    clearInstance({ home });
    console.log('Studio stopped');
    return;
  }
  let gone = await waitForExit(instance.pid, STUDIO_STOP_WAIT_MS);
  if (!gone) {
    try {
      process.kill(instance.pid, 'SIGKILL');
    } catch {
      gone = !pidIsAlive(instance.pid);
    }
    gone = gone || await waitForExit(instance.pid, 1000);
  }
  if (!gone) {
    log.error(`Studio (pid ${instance.pid}) did not exit; instance file kept`);
    process.exitCode = 1;
    return;
  }
  clearInstance({ home });
  console.log('Studio stopped');
}

function studioUrlFromChild(child, timeoutMs) {
  return new Promise((resolve) => {
    let timer;
    const finish = (url) => {
      clearTimeout(timer);
      resolve(url);
    };
    timer = setTimeout(() => finish(null), timeoutMs);
    child.on('message', (message) => {
      if (message && typeof message.url === 'string') finish(message.url);
    });
    child.on('exit', () => finish(null));
    child.on('error', () => finish(null));
  });
}

async function startStudioInBackground(home, port) {
  const { readInstance } = require('../lib/studio/instance.js');
  const logFile = studioLogPath(home);
  fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
  const startOffset = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  const fd = fs.openSync(logFile, 'a', 0o600);
  fs.chmodSync(logFile, 0o600);
  const childArgs = [__filename, 'studio', '--no-open', '--port', String(port)];
  if (process.argv.includes('--no-notify')) childArgs.push('--no-notify');
  const child = spawn(process.execPath, childArgs, { detached: true, stdio: ['ignore', fd, fd, 'ipc'] });
  fs.closeSync(fd);
  const url = await studioUrlFromChild(child, STUDIO_START_WAIT_MS);
  if (child.connected) child.disconnect();
  child.unref();
  if (url && readInstance({ home })) {
    console.log(url);
    return;
  }
  const written = fs.readFileSync(logFile).subarray(startOffset).toString('utf8');
  log.error('Studio did not start in the background. Last log lines:');
  console.error(written.split('\n').filter(Boolean).slice(-10).join('\n'));
  process.exitCode = 1;
}

function startStudioInForeground(home, port) {
  const { writeInstance, clearInstance, clearInstanceIfOwned } = require('../lib/studio/instance.js');
  const { osNotifier } = require('../lib/studio/notify.js');
  const notifier = process.argv.includes('--no-notify') ? undefined : osNotifier();
  const { server, token, close } = createStudioServer({ home, notifier });
  server.on('error', (error) => {
    log.error(`Unable to start Studio: ${error.message}`);
    process.exitCode = 1;
  });
  const shutdown = () => {
    clearInstanceIfOwned({ home, pid: process.pid });
    try {
      close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', () => clearInstanceIfOwned({ home, pid: process.pid }));
  server.listen(port, '127.0.0.1', () => {
    const actualPort = server.address().port;
    writeInstance({ home, pid: process.pid, port: actualPort });
    const url = `http://127.0.0.1:${actualPort}/?token=${token}`;
    log.success('✓ AEL Studio is running locally');
    if (typeof process.send === 'function') {
      console.log(`http://127.0.0.1:${actualPort}/ (running in the background; stop it with \`ael studio --stop\`)`);
      process.send({ url }, () => {
        if (process.connected) process.disconnect();
      });
      return;
    }
    console.log(url);
    console.log('Press Ctrl+C to stop. The session token is valid only for this process.');
    if (!process.argv.includes('--no-open')) openStudio(url);
  });
}

async function handleStudio() {
  const home = homeDir();
  if (process.argv.includes('--stop')) {
    await stopStudio(home);
    return;
  }
  const requestedPort = argValue('--port');
  const port = requestedPort == null ? 4317 : Number(requestedPort);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    log.error('--port must be an integer from 0 to 65535');
    process.exitCode = 1;
    return;
  }
  const { readInstance } = require('../lib/studio/instance.js');
  const running = readInstance({ home });
  if (running) {
    console.log(running.url);
    console.log('Studio is already running; if the browser asks for a session, run `ael studio --stop` then `ael studio`');
    if (!process.argv.includes('--no-open') && !process.argv.includes('--background')) openStudio(running.url);
    return;
  }
  if (process.argv.includes('--background')) {
    await startStudioInBackground(home, port);
    return;
  }
  startStudioInForeground(home, port);
}

function handleInteraction() {
  const action = args[1] || 'list';
  const runId = argValue('--run');
  const message = argValue('--message');
  const actor = argValue('--by');
  try {
    if (!runId) {
      const error = new Error('interaction requires --run <id>');
      error.code = 'INVALID_USAGE';
      throw error;
    }
    let result;
    if (action === 'list') {
      result = listRunInteractions(CWD, runId);
    } else if (action === 'question') {
      listRunLifecycle(CWD, runId);
      result = appendRunQuestion(CWD, runId, { message, actor: actor || 'agent' });
      appendRunLifecycle(CWD, runId, {
        type: 'AGENT_WAITING',
        phase: 'goal',
        actor: actor || 'agent',
        message: `Waiting for answer to Q${result.number}`
      });
    } else if (action === 'answer') {
      result = appendRunAnswer(CWD, runId, args[2], { message, actor: actor || 'human' });
    } else {
      const error = new Error('interaction must be list, question, or answer');
      error.code = 'INVALID_USAGE';
      throw error;
    }
    if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else if (action === 'list') {
      if (result.questions.length === 0) console.log('No agent questions for this Run.');
      for (const question of result.questions) {
        console.log(`Q${question.number} [${question.questionId}] ${question.message}`);
        console.log(question.answer ? `  Answer: ${question.answer.message}` : '  Waiting for an answer');
      }
    } else {
      log.success(`✓ ${action === 'question' ? 'Question posted' : 'Answer recorded'}`);
      console.log(`${result.questionId}: ${result.message}`);
    }
  } catch (error) {
    log.error(`${error.code || 'INTERACTION_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}


// ---------------------------------------------------------------------------
// Combined stage commands (issue #34). Each replaces several agent turns with
// one CLI call and goes through the same gates, so results are identical to
// the long form (`verification record`... `gate verification`, etc.).

function autoHeartbeat(runId, phase, message) {
  try {
    appendRunLifecycle(CWD, runId, { type: 'AGENT_HEARTBEAT', phase, actor: 'agent', message });
  } catch (e) {
    // Heartbeats are best-effort Studio telemetry; never fail a stage on them.
  }
}

function defaultVerificationCommand() {
  const text = readFileSafe(path.join(CONTEXT_DIR, 'verification.md')) || '';
  const match = text.match(/\*\*test_unit\*\*:\s*`([^`]+)`/);
  return match ? match[1].trim() : null;
}

function splitCommand(text, shell) {
  const value = String(text || '').trim();
  if (!value) throw Object.assign(new Error('Empty verification command'), { code: 'INVALID_COMMAND' });
  if (shell) return { command: value, args: [], shell: true };
  if (/[|&;<>()$`"'\\*?]/.test(value)) {
    throw Object.assign(new Error(`"${value}" needs shell syntax; pass --shell or split it into separate --cmd values.`), { code: 'INVALID_COMMAND' });
  }
  const [command, ...rest] = value.split(/\s+/);
  return { command, args: rest, shell: false };
}

function stageJsonError(err, json, code) {
  if (json) {
    console.log(JSON.stringify({ ok: false, code: err.code || code, error: err.message, ...(err.why ? { why: err.why } : {}), ...(err.fix ? { fix: err.fix } : {}), details: err.details || [], ...(err.conflict ? { conflict: err.conflict } : {}) }));
  } else {
    log.error(err.message);
    if (err.why) console.error(`WHY: ${err.why}`);
    if (err.fix && !err.conflict) console.error(`FIX: ${err.fix}`);
    for (const option of err.conflict ? err.conflict.options : []) console.error(`- ${option.id === err.conflict.recommended ? '(recommended) ' : ''}${option.label}: ${option.command}`);
    for (const detail of err.details || []) console.error(`- ${detail}`);
  }
  process.exit(err.code === 'RUN_CONFLICT' ? 3 : 1);
}

function repeatedArg(name) {
  const values = [];
  const separator = process.argv.indexOf('--');
  const scoped = separator === -1 ? process.argv : process.argv.slice(0, separator);
  for (let index = 0; index < scoped.length; index += 1) {
    if (scoped[index] === name && scoped[index + 1] != null) values.push(scoped[index + 1]);
  }
  return values;
}

function commandOutputTail(value, limit = 800) {
  const text = String(value || '').trim();
  if (!text || text === '(no stdout)') return '';
  const tail = text.split('\n').slice(-12).join('\n');
  return tail.length > limit ? tail.slice(-limit) : tail;
}

async function handleVerify() {
  const json = process.argv.includes('--json');
  try {
    const runId = requiredRunId('verify');
    const shell = process.argv.includes('--shell');
    const related = process.argv.includes('--related');
    const final = process.argv.includes('--final');
    if (related && final) throw Object.assign(new Error('--related and --final cannot be combined'), { code: 'INVALID_USAGE' });
    let texts = repeatedArg('--cmd');
    const lanes = require('../lib/verification-lanes.js');
    const baselineMode = process.argv.includes('--baseline');
    if (baselineMode && (related || final)) throw Object.assign(new Error('--baseline cannot be combined with --related or --final'), { code: 'INVALID_USAGE' });
    let commandsToRun;
    let defaultPlan = false;
    if (related && texts.length === 0) {
      const target = loadRun(CWD, runId);
      commandsToRun = [{ ...lanes.relatedCommand(CWD, target, { split: splitCommand, shell }), layer: 'L2' }];
    } else if (texts.length === 0) {
      // C-02: no --cmd runs the cheapest-first plan (L1 build/typecheck/lint,
      // then L2 test_unit) and stops at the first failure.
      const plan = lanes.defaultCommandPlan(CWD);
      // C-05: promoted review rules run as L1 checks, after the static checks.
      const rules = require('../lib/rules.js').rulePlan(CWD, loadRun(CWD, runId));
      if (rules.length) {
        const firstL2 = plan.findIndex((step) => step.layer !== 'L1');
        plan.splice(firstL2 === -1 ? plan.length : firstL2, 0, ...rules);
      }
      // C-23: catalog keys an AC requires (verify.key, e.g. pentest, formal)
      // run too when the project configures them.
      if (!baselineMode) {
        try {
          const target = loadRun(CWD, runId);
          const goal = require('../lib/claimed-vs-reality.js').loadFrozenGoal(CWD, target);
          const configured = lanes.verificationCommands(CWD);
          const acStatusLib = require('../lib/ac-status.js');
          for (const key of acStatusLib.requiredKeys(goal)) {
            if (configured[key] && !plan.some((step) => step.key === key)) plan.push({ key, layer: lanes.layerOfKey(key), text: configured[key] });
          }
          // A required layer with no step yet: the first configured catalog key of that layer.
          for (const layer of acStatusLib.requiredLayers(goal)) {
            if (plan.some((step) => step.layer === layer)) continue;
            const key = Object.keys(lanes.VERIFICATION_CATALOG).find((name) => lanes.VERIFICATION_CATALOG[name].layer === layer && configured[name]);
            if (key) plan.push({ key, layer, text: configured[key] });
          }
        } catch {
          // No frozen Goal yet; nothing extra to run.
        }
      }
      // C-03: startup-risky diffs also run the configured smoke check (L2).
      const smokeText = lanes.verificationCommands(CWD).smoke;
      if (smokeText && !baselineMode && lanes.startupRiskFiles(CWD, loadRun(CWD, runId)).length) {
        plan.push({ key: 'smoke', layer: 'L2', text: smokeText });
      }
      const formalText = lanes.verificationCommands(CWD).formal;
      if (formalText && !baselineMode && !plan.some((step) => step.key === 'formal') && lanes.formalCoveredFiles(CWD, loadRun(CWD, runId)).length) {
        plan.push({ key: 'formal', layer: 'LF', text: formalText });
      }
      if (!plan.length) throw Object.assign(new Error('No --cmd given and no build/typecheck/lint/test_unit command in .ai-engineering-loop/verification.md. FIX: add them to verification.md or pass --cmd.'), { code: 'INVALID_COMMAND' });
      commandsToRun = plan.map((step) => ({ ...splitCommand(step.text, shell || Boolean(step.shell)), key: step.key, layer: step.layer, ...(step.env ? { env: step.env } : {}) }));
      defaultPlan = true;
    } else {
      commandsToRun = texts.map((text) => {
        const layer = lanes.layerOfCommand(CWD, text);
        return { ...splitCommand(text, shell), ...(layer ? { layer } : {}) };
      });
    }
    const timeoutValue = argValue('--timeout-ms');
    if (baselineMode) {
      const outcome = await require('../lib/baseline.js').recordBaseline(CWD, {
        runId,
        plan: commandsToRun,
        ...(timeoutValue == null ? {} : { timeoutMs: parsePositiveIntegerArg('--timeout-ms', timeoutValue) })
      });
      const result = { ok: outcome.status !== 'BROKEN', runId, baseline: outcome };
      if (json) console.log(JSON.stringify(result));
      else {
        const say = outcome.status === 'GREEN' ? log.success : (outcome.status === 'RED' ? log.warn : log.error);
        say(`Baseline ${outcome.status}: ${outcome.path}`);
        for (const c of outcome.commands) console.log(`- ${c.command}: exit ${c.exitCode}`);
        for (const problem of outcome.problems) console.log(`! ${problem}`);
      }
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (final) {
      const target = loadRun(CWD, runId);
      if (target.state !== 'JUDGED_PASS') throw Object.assign(new Error(`verify --final needs a Judge PASS (state is ${target.state})`), { code: 'INVALID_STATE' });
      const status = lanes.finalVerificationStatus(CWD, target);
      let recordedFinal = null;
      if (status.required && !status.satisfied) {
        recordedFinal = await recordVerificationCommands(CWD, {
          runId,
          commands: commandsToRun,
          target: 'final',
          fresh: process.argv.includes('--fresh'),
          serial: process.argv.includes('--serial'),
          ...(timeoutValue == null ? {} : { timeoutMs: parsePositiveIntegerArg('--timeout-ms', timeoutValue) })
        });
      }
      const result = {
        ok: recordedFinal ? recordedFinal.passed : true,
        runId,
        final: recordedFinal
          ? { path: recordedFinal.path, commands: recordedFinal.commands.map((c) => ({ command: c.command, exitCode: c.exitCode, reused: Boolean(c.reused) })) }
          : { reused: true, reason: status.reason }
      };
      if (json) console.log(JSON.stringify(result));
      else if (result.ok) log.success(`✓ final verification ${recordedFinal ? 'passed' : `not needed (${status.reason})`}; deliver next`);
      else log.error('Final verification failed; fix it before delivery.');
      if (!result.ok) process.exitCode = 1;
      return;
    }
    const recorded = await recordVerificationCommands(CWD, {
      runId,
      commands: commandsToRun,
      serial: process.argv.includes('--serial'),
      fresh: process.argv.includes('--fresh'),
      stopOnFailure: defaultPlan,
      ...(related ? { scope: 'related' } : {}),
      ...(timeoutValue == null ? {} : { timeoutMs: parsePositiveIntegerArg('--timeout-ms', timeoutValue) })
    });
    const commands = recorded.commands.map((c) => ({
      command: c.command,
      exitCode: c.exitCode,
      timeoutStatus: c.timeoutStatus,
      ...(c.layer ? { layer: c.layer } : {}),
      ...(c.scope ? { scope: c.scope } : {}),
      ...(c.reused ? { reused: true } : {}),
      ...(!recorded.passed && (c.exitCode !== 0 || c.timeoutStatus !== 'COMPLETED') ? {
        stdoutTail: commandOutputTail(c.stdout),
        stderrTail: commandOutputTail(c.stderr)
      } : {})
    }));
    if (!recorded.passed) {
      autoHeartbeat(runId, 'verification', 'Verification failed; Maker must fix before review');
      const baselineModule = require('../lib/baseline.js');
      const failures = baselineModule.classifyAgainstBaseline(baselineModule.loadBaseline(CWD, runId), recorded.commands);
      const result = { ok: false, code: 'VERIFICATION_FAILED', runId, commands, skipped: recorded.skipped, failures, gate: null, evidence: `.ai-engineering-loop/runs/${runId}/verification.json` };
      if (json) console.log(JSON.stringify(result));
      else {
        log.error('Verification failed; the gate was not attempted.');
        console.log(`- Evidence: .ai-engineering-loop/runs/${runId}/verification.json`);
        for (const c of commands) {
          console.log(`- ${c.command}: exit ${c.exitCode} (${c.timeoutStatus})`);
          if (c.stderrTail) console.log(`- stderr:\n${c.stderrTail}`);
          if (c.stdoutTail) console.log(`- stdout:\n${c.stdoutTail}`);
        }
        for (const skippedCommand of recorded.skipped) console.log(`- ${skippedCommand}: skipped (an earlier, cheaper check failed)`);
        for (const c of recorded.commands.filter((item) => item.exitCode !== 0)) {
          const rulesLib = require('../lib/rules.js');
          const rule = (c.key && c.key.startsWith('rule:') ? rulesLib.findRule(CWD, c.key.slice(5)) : null) || rulesLib.ruleForCommand(CWD, c.command);
          if (rule) console.log(`! Rule ${rule.id} violated. WHY: ${rule.why} FIX: ${rule.fix}`);
        }
        for (const f of failures) {
          console.log(f.preExisting
            ? `! ${f.command}: every failure was already failing at baseline (pre-existing). FIX: repair it in a separate Run, or narrow --cmd to the tests this change owns.`
            : `! ${f.command}: new failure(s)${f.newFailures.length ? `: ${f.newFailures.slice(0, 5).join('; ')}` : ''}. FIX: fix the change before review.`);
        }
      }
      process.exitCode = 1;
      return;
    }
    const run = executeGate('verification', runId);
    const drift = impactMap.loadImpactDrift(CWD, runId) || { mapStatus: 'MISSING', outOfMap: [] };
    const compact = compactRun(CWD, { runId });
    let claimed = { path: '.ai-engineering-loop/tasks/claimed-vs-reality.md', created: false };
    try {
      claimed = { ...createClaimedVsRealityTemplate(CWD, { runId }), created: true };
    } catch (err) {
      if (err.code !== 'OUTPUT_EXISTS') throw err;
    }
    const result = {
      ok: true,
      runId,
      state: run.state,
      tier: run.tier ? run.tier.current : null,
      commands,
      testCounts: recorded.summary.testCounts,
      impactDrift: { mapStatus: drift.mapStatus, outOfMap: drift.outOfMap },
      compact: compact.paths,
      claimedVsReality: claimed,
      acStatus: (() => {
        try {
          return require('../lib/ac-status.js').runAcStatuses(CWD, run, require('../lib/claimed-vs-reality.js').loadFrozenGoal(CWD, run))
            .filter((ac) => ac.status !== 'unbound');
        } catch {
          return [];
        }
      })(),
      ...(related ? { scope: 'related', finalRequired: 'Run `verify --final` after Judge PASS, before delivery.' } : {}),
      next: run.tier && run.tier.current === 'T0'
        ? 'Fill claimed-vs-reality, then gate review and gate judge'
        : 'Fill claimed-vs-reality, then review-pack and spawn the Devil\'s Advocate'
    };
    if (json) console.log(JSON.stringify(result));
    else {
      log.success('✓ verification recorded and gated');
      for (const c of commands) console.log(`- ${c.command}: exit ${c.exitCode}`);
      console.log(`- State: ${run.state}`);
      if (drift.outOfMap.length) {
        console.log(`! ${drift.outOfMap.length} file(s) changed outside the ${drift.mapStatus} impact map (LOW finding at review): ${drift.outOfMap.join(', ')}`);
      } else if (drift.mapStatus === 'MISSING') {
        console.log('! No impact map for this Run; drift was not checked');
      }
      console.log(`- Claimed-vs-reality: ${claimed.path}${claimed.created ? ' (scaffolded; fill it from the command output)' : ''}`);
      for (const ac of result.acStatus) console.log(`- ${ac.id}: ${ac.status} (\`${ac.command}\`)`);
      console.log(`- Next: ${result.next}`);
    }
  } catch (err) {
    stageJsonError(err, json, 'VERIFY_FAILED');
  }
}

function handleOutcome() {
  const json = process.argv.includes('--json');
  try {
    const action = args[1] && !args[1].startsWith('--') ? args[1] : null;
    if (action === 'repro') {
      const file = argValue('--file');
      if (!file || file.startsWith('-')) {
        throw Object.assign(new Error('outcome repro needs --file <path> with the pasted bug report.'), { code: 'INVALID_USAGE', why: 'Without a live issue reader, the bug report is a local file.', fix: 'ael outcome repro --file .ai-engineering-loop/drafts/bug-report.md' });
      }
      process.once('exit', () => projectRegistry.registerProject(CWD));
      process.argv = [process.argv[0], process.argv[1], 'run', '--from-report', file, ...(json ? ['--json'] : [])];
      return handleRun();
    }
    if (action !== 'record') throw Object.assign(new Error('outcome supports: record --run <id> --source mr-comment|revert|bug|incident --location <file[:line]> --summary <text> --by <name> [--evidence <path|url>] | repro --file <path>'), { code: 'INVALID_USAGE' });
    if (argValue('--file')) throw Object.assign(new Error('outcome record does not take --file.'), { code: 'INVALID_USAGE', fix: 'ael outcome repro --file <path>' });
    const entry = require('../lib/calibration.js').recordOutcome(CWD, {
      runId: argValue('--run'),
      source: argValue('--source'),
      location: argValue('--location'),
      summary: argValue('--summary'),
      evidence: argValue('--evidence'),
      by: argValue('--by')
    });
    if (json) console.log(JSON.stringify({ ok: true, outcome: entry }));
    else log.success(`✓ outcome recorded for ${argValue('--run')}; run \`calibrate\` to compare it with the review`);
  } catch (err) {
    stageJsonError(err, json, 'OUTCOME_FAILED');
  }
}

function handleCalibrate() {
  const json = process.argv.includes('--json');
  try {
    const calibration = require('../lib/calibration.js');
    const report = calibration.calibrate(CWD);
    if (json) console.log(JSON.stringify({ ok: true, ...report }));
    else console.log(calibration.formatCalibration(report));
  } catch (err) {
    stageJsonError(err, json, 'CALIBRATE_FAILED');
  }
}

function handleDebt() {
  const json = process.argv.includes('--json');
  try {
    const debt = require('../lib/debt.js');
    const action = args[1] && !args[1].startsWith('--') ? args[1] : 'list';
    if (action === 'close') {
      const item = debt.closeDebt(CWD, args[2], { by: argValue('--by'), note: argValue('--note') });
      if (json) console.log(JSON.stringify({ ok: true, item }));
      else log.success(`✓ closed ${item.id}`);
      return;
    }
    if (action !== 'list') throw Object.assign(new Error('debt supports: list, close <id> --by <name>'), { code: 'INVALID_USAGE' });
    const file = argValue('--file');
    const items = debt.loadDebt(CWD).items.filter((item) => item.status === 'open' && (!file || item.file === file));
    if (json) console.log(JSON.stringify({ ok: true, items }));
    else if (!items.length) console.log('No open debt.');
    else for (const item of items) console.log(`- ${item.id} [${item.risk}] ${item.location}: ${item.debt} (deferred: ${item.whyDeferred}; revisit: ${item.nextTrigger})`);
  } catch (err) {
    stageJsonError(err, json, 'DEBT_FAILED');
  }
}

function handleNext() {
  const json = process.argv.includes('--json');
  try {
    const features = require('../lib/features.js');
    const document = features.loadFeatures(CWD) || features.featuresFromMap(CWD);
    if (!document) {
      throw Object.assign(new Error(`No feature list. FIX: run \`ael feature-map scaffold\`, or create .ai-engineering-loop/features.json with ${features.FEATURES_EXAMPLE}`), {
        code: 'NO_FEATURES',
        why: 'next needs a feature list. features.json is the ledger; feature-map.md is the map scaffold writes.',
        fix: 'ael feature-map scaffold'
      });
    }
    const next = features.nextFeature(document);
    const ratio = features.vcr(document);
    const problems = features.auditFeatures(CWD, document);
    const active = document.features.filter((item) => item.status === 'active').map((item) => item.id);
    const result = { ok: problems.length === 0, next, vcr: ratio, active, problems };
    if (json) console.log(JSON.stringify(result));
    else {
      console.log(`VCR: ${ratio.verified}/${ratio.activated} (${ratio.value})${active.length ? `; active: ${active.join(', ')}` : ''}`);
      if (ratio.value < 1 && active.length) console.log(`! Finish ${active[0]} before starting another feature (WIP=1).`);
      console.log(next ? `Next: ${next.id} - ${next.title || next.behavior}${next.verify ? ` (verify: ${next.verify})` : ''}. Start it with a Goal whose featureId is "${next.id}".` : 'Next: nothing unblocked.');
      for (const problem of problems) console.log(`! ${problem}`);
    }
    if (problems.length) process.exitCode = 1;
  } catch (err) {
    stageJsonError(err, json, 'NEXT_FAILED');
  }
}

// C-20: `rules check <id>` runs a built-in rule kind against the lines the
// change adds ($AEL_ADDED_LINES_FILE); violations print as file:line.
function handleRules() {
  const json = process.argv.includes('--json');
  try {
    if (args[1] !== 'check' || !args[2]) throw Object.assign(new Error('rules supports: check <ruleId>'), { code: 'INVALID_USAGE' });
    const rule = require('../lib/rules.js').findRule(CWD, args[2]);
    if (!rule) throw Object.assign(new Error(`No rule ${args[2]} in .ai-engineering-loop/rules.json`), { code: 'NOT_FOUND' });
    const ruleCheck = require('../lib/rule-check.js');
    const violations = ruleCheck.checkRule(rule, ruleCheck.readAddedLines());
    if (json) console.log(JSON.stringify({ ok: violations.length === 0, rule: rule.id, violations }));
    else for (const v of violations) console.log(`${v.file}:${v.line}: ${v.message}`);
    if (violations.length) process.exitCode = 1;
  } catch (err) {
    stageJsonError(err, json, 'RULES_FAILED');
  }
}

function handleSafety() {
  try {
    if (args[1] !== 'record') throw Object.assign(new Error('Use: safety record --run <id> --fact <text> [--cmd <command>] [--live] [--level 1-3]'), { code: 'INVALID_USAGE' });
    const runId = requiredRunId('safety record');
    const value = require('../lib/safety-fact.js').recordSafetyFact(CWD, runId, {
      fact: argValue('--fact'),
      command: argValue('--cmd'),
      live: process.argv.includes('--live'),
      level: argValue('--level')
    });
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: true, runId, safetyFact: value }, null, 2));
    else log.success(`✓ Safety fact recorded at level ${value.level} (${value.levelName}): ${value.fact}`);
  } catch (error) {
    log.error(`${error.code || 'SAFETY_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}

function handleMeasurement() {
  try {
    if (args[1] !== 'record') throw Object.assign(new Error('Use: measurement record --run <id> --ac <AC-n> --runs <n> --spread <pct> --effect <pct> --limiter <text>'), { code: 'INVALID_USAGE' });
    const runId = requiredRunId('measurement record');
    const value = require('../lib/measurements.js').recordMeasurement(CWD, runId, {
      ac: argValue('--ac'),
      runs: argValue('--runs'),
      spread: argValue('--spread'),
      effect: argValue('--effect'),
      limiter: argValue('--limiter')
    });
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: true, runId, measurement: value }, null, 2));
    else log.success(`✓ ${value.ac}: ${value.runs} runs, spread ${value.spread}%, effect ${value.effect}%, limited by ${value.limiter}`);
  } catch (error) {
    log.error(`${error.code || 'MEASUREMENT_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}

function handleRecap() {
  try {
    const days = argValue('--days') == null ? 7 : Number(argValue('--days'));
    if (!Number.isInteger(days) || days < 1 || days > 366) {
      throw Object.assign(new Error('--days must be a whole number from 1 to 366'), { code: 'INVALID_USAGE' });
    }
    const { AUDIENCES, renderRecap } = require('../lib/recap-html.js');
    const audience = argValue('--for') || 'me';
    if (!AUDIENCES.includes(audience)) throw Object.assign(new Error('--for must be me, lead or client'), { code: 'INVALID_USAGE' });
    const projectsArg = argValue('--projects');
    const projects = !projectsArg
      ? [CWD]
      : projectsArg === 'all'
        ? projectRegistry.listProjects().projects.map((project) => project.path)
        : projectsArg.split(',').map((item) => path.resolve(CWD, item.trim())).filter(Boolean);
    if (!projects.length) throw Object.assign(new Error('No projects to recap: register one with `ael projects` or pass --projects <path>'), { code: 'INVALID_USAGE' });
    if (audience === 'client' && projects.length > 1) {
      throw Object.assign(new Error('A client recap covers one project only: pass --projects <path> with a single path'), { code: 'INVALID_USAGE' });
    }
    const now = argValue('--now') ? new Date(argValue('--now')) : new Date();
    if (Number.isNaN(now.getTime())) throw Object.assign(new Error('--now must be an ISO date'), { code: 'INVALID_USAGE' });
    const data = require('../lib/recap.js').collectRecap({ projects, days, now });
    const html = renderRecap(data, { audience, now, lang: contentLangArg() });
    const day = (d) => d.toISOString().slice(0, 10);
    const out = argValue('--out')
      ? path.resolve(CWD, argValue('--out'))
      : path.join(CWD, '.ai-engineering-loop', 'recaps', `recap-${day(data.window.from)}-${day(now)}-${audience}.html`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html, { mode: 0o600 });
    fs.chmodSync(out, 0o600);
    if (process.argv.includes('--open')) openStudio(out);
    const summary = { ok: true, path: out, audience, days, projects: data.projects, runs: data.metrics.runs, delivered: data.metrics.delivered };
    if (process.argv.includes('--json')) console.log(JSON.stringify(summary, null, 2));
    else log.success(`✓ Recap (${audience}, ${days} days, ${summary.runs} runs, ${summary.delivered} delivered): ${out}`);
  } catch (error) {
    log.error(`${error.code || 'RECAP_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}

function handleStats() {
  const json = process.argv.includes('--json');
  try {
    const lastValue = argValue('--last');
    const stats = require('../lib/stats.js');
    const result = stats.computeStats(CWD, lastValue == null ? {} : { last: parsePositiveIntegerArg('--last', lastValue) });
    if (json) console.log(JSON.stringify({ ok: true, ...result }));
    else console.log(stats.formatStats(result));
  } catch (err) {
    stageJsonError(err, json, 'STATS_FAILED');
  }
}

function readGuardInput() {
  const source = argValue('--input') || (process.argv.includes('--hook') ? '-' : null);
  if (source == null) {
    const target = argValue('--path');
    const commandText = argValue('--command');
    if (target == null && commandText == null) {
      throw Object.assign(new Error('guard check needs --input -|<file>, --path <file>, or --command <text>'), { code: 'INVALID_USAGE' });
    }
    return target != null ? { path: target } : { command: commandText };
  }
  const text = source === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(CWD, source), 'utf8');
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw Object.assign(new Error(`guard input is not JSON: ${cause.message}`), { code: 'INVALID_USAGE' });
  }
}

function handleGuard() {
  const action = args[1] && !args[1].startsWith('--') ? args[1] : 'check';
  const json = process.argv.includes('--json');
  const hook = argValue('--hook');
  try {
    if (action !== 'check') throw Object.assign(new Error('guard supports: check'), { code: 'INVALID_USAGE' });
    if (hook != null && hook !== 'claude') throw Object.assign(new Error('--hook supports: claude'), { code: 'INVALID_USAGE' });
    const result = guard.checkGuard(CWD, { tool: argValue('--tool'), input: readGuardInput(), runId: argValue('--run') });
    if (hook === 'claude') {
      const output = guard.claudeHookOutput(result);
      if (output) console.log(JSON.stringify(output));
      return;
    }
    if (json) console.log(JSON.stringify({ ok: true, ...result }));
    else {
      const mark = { allow: '✓', warn: '!', block: '✗' }[result.decision];
      console.log(`${mark} ${result.decision} (${result.tool}, ${result.mode}${result.runId ? `, run ${result.runId}` : ', no active run'})`);
      for (const reason of result.reasons) console.log(`- ${reason}`);
    }
    if (result.decision === 'block') process.exitCode = 2;
  } catch (err) {
    if (hook) {
      console.error(`ai-engineering-loop guard: ${err.message}`);
      // Exit 2 makes Claude Code block the call; exit 1 would let it run.
      process.exitCode = guard.hookFailureExitCode(CWD, argValue('--run'));
      return;
    }
    stageJsonError(err, json, 'GUARD_FAILED');
  }
}

function handleHooks() {
  const action = args[1] && !args[1].startsWith('--') ? args[1] : 'status';
  const json = process.argv.includes('--json');
  try {
    const options = { host: argValue('--host') || 'claude' };
    let result;
    if (action === 'install') result = guardHooks.installHooks(CWD, options);
    else if (action === 'uninstall') result = guardHooks.uninstallHooks(CWD, options);
    else if (action === 'status') result = guardHooks.hooksStatus(CWD, options);
    else throw Object.assign(new Error('hooks must be install, uninstall, or status'), { code: 'INVALID_USAGE' });
    if (json) console.log(JSON.stringify({ ok: true, action, ...result }));
    else {
      const verb = action === 'status' ? '' : (result.changed ? ' (updated)' : ' (already up to date)');
      log.success(`✓ ${result.host} guard hooks ${result.installed ? 'installed' : 'not installed'} in ${result.settings}${verb}`);
      if (result.installed) console.log('- Edit/Write outside the Run scope and destructive Bash commands: ASSISTED asks, UNATTENDED blocks.');
    }
  } catch (err) {
    stageJsonError(err, json, 'HOOKS_FAILED');
  }
}

function handleImpact() {
  const action = args[1] && !args[1].startsWith('--') ? args[1] : 'show';
  const json = process.argv.includes('--json');
  try {
    const runId = requiredRunId('impact');
    let result;
    if (action === 'map') {
      const limit = argValue('--limit');
      result = impactMap.generateImpactMap(CWD, {
        runId,
        force: process.argv.includes('--force'),
        ...(limit == null ? {} : { limit: parsePositiveIntegerArg('--limit', limit) })
      });
    } else if (action === 'confirm') {
      result = impactMap.confirmImpactMap(CWD, {
        runId,
        by: argValue('--by'),
        allow: repeatedArg('--allow'),
        remove: repeatedArg('--remove')
      });
    } else if (action === 'skip') {
      result = impactMap.skipImpactMap(CWD, { runId, by: argValue('--by'), reason: argValue('--reason') });
    } else if (action === 'show') {
      const map = impactMap.loadImpactMap(CWD, runId);
      if (!map) throw Object.assign(new Error('No impact map yet. Run `impact map` first.'), { code: 'IMPACT_MAP_MISSING' });
      result = { map, path: `.ai-engineering-loop/runs/${runId}/${impactMap.IMPACT_MAP_FILE}` };
    } else if (action === 'drift') {
      const drift = impactMap.detectImpactDrift(CWD, { runId });
      result = { map: null, drift: drift.drift, path: drift.path };
    } else {
      throw Object.assign(new Error('impact must be map, show, confirm, skip, or drift'), { code: 'INVALID_USAGE' });
    }
    if (json) {
      console.log(JSON.stringify({ ok: true, runId, action, path: result.path, ...(result.map ? { map: result.map } : {}), ...(result.drift ? { drift: result.drift } : {}) }, null, 2));
      return;
    }
    if (result.drift) {
      log.success(`✓ impact drift checked (${result.drift.mapStatus})`);
      console.log(`- Changed: ${result.drift.changedFiles.length}, outside the map: ${result.drift.outOfMap.length}`);
      for (const file of result.drift.outOfMap) console.log(`  ! ${file}`);
      return;
    }
    const { map } = result;
    log.success(`✓ impact map ${map.status} (${result.path})`);
    if (map.status === 'SKIPPED') {
      console.log(`- Skipped: ${map.skipReason}`);
      return;
    }
    for (const key of ['files', 'modules', 'endpoints', 'dbTables', 'tests']) {
      console.log(`- ${key}: ${map[key].length}`);
      for (const entry of map[key].slice(0, 10)) {
        const label = entry.route ? `${entry.method} ${entry.route} (${entry.path})` : (entry.path && key !== 'dbTables' ? entry.path : entry.name);
        console.log(`  ${label}  [${entry.confidence}] ${entry.reason}`);
      }
    }
    if (map.status === 'CONFIRMED') console.log(`- Allowed scope: ${map.scope.allowedPaths.length} path(s), confirmed by ${map.confirmedBy}`);
    else console.log('- Next: confirm with `impact confirm --by <name> [--allow <glob>]... [--remove <path>]...` or skip a trivial goal with `impact skip --by <name> --reason <text>`');
  } catch (err) {
    stageJsonError(err, json, 'IMPACT_FAILED');
  }
}

function handleReviewPack() {
  const json = process.argv.includes('--json');
  try {
    const runId = requiredRunId('review-pack');
    const run = loadRun(CWD, runId);
    if (!run.artifacts?.verification) {
      throw Object.assign(new Error('review-pack needs a passed verification gate (run verify first).'), { code: 'GATE_FAILED' });
    }
    const base = argValue('--base') || 'HEAD';
    const fastPath = assessSmallTaskFastPath(CWD, { base });
    const pack = smartContextSummary(createDiffHunkPack(CWD, { runId, base, profile: argValue('--profile') }));
    const escalation = assessRunEscalation(CWD, { runId });
    const tier = run.tier ? run.tier.current : null;
    // C-14: open debt on the files this change touches goes into the pack.
    let openDebt = [];
    let touchedFeatures = [];
    try {
      const changed = require('../lib/verification-lanes.js').relatedFiles(CWD, run);
      openDebt = require('../lib/debt.js').openDebtFor(CWD, changed);
      const featureMap = require('../lib/feature-map.js');
      touchedFeatures = featureMap.featuresForFiles(CWD, changed);
      const unconfirmed = require('../lib/provenance.js').renderUnconfirmed(require('../lib/provenance.js').loadProvenance(CWD, runId), '## Unconfirmed assumptions in the Goal (raise a finding if the code relies on one)');
      const sections = [];
      if (openDebt.length) {
        sections.push(['## Open debt on changed files', '', ...openDebt.map((item) => `- ${item.id} ${item.location}: ${item.debt} (deferred: ${item.whyDeferred}; risk ${item.risk})`)].join('\n'));
      }
      const featuresNote = featureMap.renderForPack(touchedFeatures).trim();
      if (featuresNote) sections.push(featuresNote);
      if (unconfirmed.length) sections.push(unconfirmed.join('\n').trim());
      // Appendices used to be concatenated onto the JSON file, which made
      // escalation and gate judge reject it. Rewrite the whole document.
      if (sections.length && pack.path) {
        const abs = path.join(CWD, pack.path);
        const document = JSON.parse(fs.readFileSync(abs, 'utf8'));
        document.appendices = sections;
        require('../lib/fsutil.js').writePrivateJson(abs, document);
      }
    } catch {
      openDebt = [];
    }
    const diffRelative = path.relative(CWD, path.join(runsDir(CWD), runId, 'diff.patch')).split(path.sep).join('/');
    const reviewInputs = require('../lib/review-ingest.js').recordReviewInputs(CWD, runId, { packPath: pack.path, diffPath: diffRelative });
    autoHeartbeat(runId, 'review', 'Review pack built');
    const result = {
      ok: true,
      runId,
      tier,
      devilAdvocateRequired: tier !== 'T0',
      packPath: pack.path,
      diffPath: path.relative(CWD, path.join(runsDir(CWD), runId, 'diff.patch')).split(path.sep).join('/'),
      reviewProfile: pack.reviewProfile,
      estimatedTokens: pack.estimatedTokens,
      truncated: pack.truncated,
      unresolvedFindings: pack.unresolvedFindings,
      impactDrift: pack.impactDrift,
      openDebt: openDebt.map((item) => ({ id: item.id, location: item.location, debt: item.debt })),
      features: touchedFeatures.map((entry) => ({ id: entry.id, where: entry.where, driver: entry.driver })),
      reviewInputs: { inputs: reviewInputs.inputs, promptSha256: reviewInputs.promptSha256 },
      fastPath: { eligible: fastPath.eligible, reasons: fastPath.reasons },
      escalation: { requiredTier: escalation.requiredTier, reasons: escalation.reasons.map((r) => r.code) }
    };
    if (json) console.log(JSON.stringify(result));
    else {
      log.success('✓ review pack ready');
      console.log(`- Pack: ${result.packPath} (${result.reviewProfile}, ~${result.estimatedTokens} tokens)`);
      console.log(`- Tier: ${tier || 'none'}; Devil's Advocate ${result.devilAdvocateRequired ? 'required' : 'not used (T0)'}`);
      console.log(`- Judge tier floor: ${result.escalation.requiredTier}${result.escalation.reasons.length ? ` (${result.escalation.reasons.join(', ')})` : ''}`);
      if (result.impactDrift?.outOfMap.length) {
        console.log(`- Outside the impact map: ${result.impactDrift.outOfMap.join(', ')} (check their side effects)`);
      }
      for (const line of result.impactDrift?.design || []) console.log(`- ${line}`);
      if (touchedFeatures.length) console.log(`- Features touched: ${touchedFeatures.map((entry) => entry.id).join(', ')} (in the pack; use them for L3 evidence)`);
      if (openDebt.length) console.log(`- Open debt on changed files: ${openDebt.map((item) => item.id).join(', ')} (in the pack; resolve or keep consciously)`);
    }
  } catch (err) {
    stageJsonError(err, json, 'REVIEW_PACK_FAILED');
  }
}

function handleDeliver() {
  const json = process.argv.includes('--json');
  try {
    const runId = requiredRunId('deliver');
    const run = loadRun(CWD, runId);
    const mode = run.mode || RUN_MODES.ASSISTED;
    const approve = process.argv.includes('--approve');
    const by = argValue('--by');
    if (mode === RUN_MODES.REPORT_ONLY) {
      throw Object.assign(new Error('REPORT_ONLY runs finish with gate report, not deliver.'), { code: 'INVALID_USAGE' });
    }
    if (mode === RUN_MODES.ASSISTED && !approve) {
      if (!['JUDGED_PASS', 'DELIVERED'].includes(run.state)) {
        console.error(`Run ${run.runId} is ${run.state}; deliver comes after the Judge passes. Next: \`ai-engineering-loop status\` shows the stage to finish. Nothing was written.`);
      } else {
        console.error('ASSISTED delivery needs the human\'s explicit approval: deliver --approve --by <name>. Nothing was written.');
      }
      process.exit(2);
    }
    if (approve && !by) {
      throw Object.assign(new Error('--approve requires --by <name> (the approving human).'), { code: 'INVALID_USAGE' });
    }
    // Adapter preflight (#63): UNATTENDED stops before anything is written;
    // ASSISTED only warns, because a human is approving this delivery.
    // A configured-vs-detected mismatch can be deliberate, so it never blocks.
    const adapterProblems = checkAdapter(CWD).filter((item) => !item.passed);
    const blocking = adapterProblems.filter((item) => item.id !== 'adapter-detected');
    if (mode === RUN_MODES.UNATTENDED && blocking.length) {
      throw Object.assign(
        new Error(`Adapter preflight failed; nothing was written. ${blocking.map((item) => `${item.id}: ${item.detail}`).join('; ')}`),
        { code: 'ADAPTER_PREFLIGHT_FAILED' }
      );
    }
    for (const item of adapterProblems) console.error(`! ${item.id}: ${item.detail}`);
    const approved = [];
    if (approve && run.workflow) {
      const workflow = workflowStatus(CWD, { runId });
      for (const node of workflow.plan.nodes) {
        if (node.type !== 'approval' || workflow.state.nodes[node.id].status !== 'READY') continue;
        approveWorkflowNode(CWD, node.id, { runId, approvedBy: by });
        appendRunLifecycle(CWD, runId, { type: 'NODE_COMPLETED', nodeId: node.id, phase: node.id, actor: by, message: `Node ${node.id} approved` });
        approved.push(node.id);
      }
    }
    const deliveryPath = path.join(runsDir(CWD), runId, 'delivery.json');
    let delivery = null;
    if (fs.existsSync(deliveryPath)) {
      try { delivery = JSON.parse(fs.readFileSync(deliveryPath, 'utf8')); } catch (e) { delivery = null; }
    }
    const destination = argValue('--destination');
    const summary = argValue('--summary');
    if (!delivery && !(destination && summary)) {
      throw Object.assign(new Error('Pass --destination <where> and --summary <text>, or write delivery.json first.'), { code: 'INVALID_USAGE' });
    }
    // Proof-carrying receipt (#70): the final deliver step, after approval.
    // Missing gate artifacts leave no receipt; the delivery gate then reports them.
    let receipt = null;
    try {
      receipt = receipts.writeReceipt(CWD, {
        runId,
        host: argValue('--host'),
        model: argValue('--model'),
        head: argValue('--head'),
        evidenceLinks: repeatedArg('--evidence'),
        aelVersion: VERSION
      });
    } catch (err) {
      if (err.code !== 'RECEIPT_INPUT_MISSING') throw err;
    }
    delivery = {
      ...(delivery || {}),
      schemaVersion: 1,
      runId,
      ...(destination ? { destination } : {}),
      ...(summary ? { summary } : {}),
      ...(approve ? { humanApproved: true, approvedBy: by } : {}),
      ...(receipt ? { receipt: { path: receipt.path, digest: receipt.receipt.digest } } : {})
    };
    fs.writeFileSync(deliveryPath, `${JSON.stringify(delivery, null, 2)}\n`, { mode: 0o600 });
    const next = executeGate('delivery', runId);
    const result = {
      ok: true,
      runId,
      state: next.state,
      approvedNodes: approved,
      humanApproved: delivery.humanApproved === true,
      receipt: receipt && { path: receipt.path, markdown: receipt.markdownPath, digest: receipt.receipt.digest, missingEvidence: receipt.missing }
    };
    if (next.state === 'DELIVERED') {
      try {
        const cleanup = require('../lib/run-isolation.js').cleanupAfterDeliver(CWD, runId);
        if (cleanup) result.cleanup = cleanup;
      } catch (cause) {
        result.cleanup = { error: cause.message };
      }
    }
    if (json) console.log(JSON.stringify(result));
    else {
      log.success('✓ delivery gate passed');
      console.log(`- State: ${next.state}`);
      if (approved.length) console.log(`- Approved: ${approved.join(', ')} by ${by}`);
      if (receipt) console.log(`- Receipt: ${receipt.path} (digest ${receipt.receipt.digest.slice(0, 12)}); paste ${receipt.markdownPath} into the PR/MR body`);
      if (receipt?.missing.length) console.log(`! Missing AC evidence (❌ in the receipt): ${receipt.missing.join(', ')}`);
      if (result.cleanup?.removed) console.log(`- Stage 9: worktree removed, evidence copied to ${result.cleanup.mainCheckout}; branch ${result.cleanup.branch} kept until merged. Continue in ${result.cleanup.mainCheckout}.`);
      else if (result.cleanup?.keptReason) console.log(`! Stage 9: worktree kept (${result.cleanup.keptReason}); evidence copied to ${result.cleanup.mainCheckout}.`);
      else if (result.cleanup?.error) console.log(`! Stage 9 cleanup failed: ${result.cleanup.error}`);
    }
  } catch (err) {
    stageJsonError(err, json, 'DELIVER_FAILED');
  }
}

function handleVerifyReceipt() {
  const json = process.argv.includes('--json');
  try {
    const positional = args.slice(1).find((arg, index, list) => !arg.startsWith('--') && !['--run', '--head'].includes(list[index - 1]));
    const result = receipts.verifyReceipt(CWD, {
      runId: argValue('--run'),
      receiptPath: positional,
      head: argValue('--head')
    });
    if (json) console.log(JSON.stringify(result));
    else if (result.ok) {
      log.success(`✓ receipt verified (${result.path}, digest ${result.digest.slice(0, 12)})`);
    } else {
      log.error(`Receipt check failed (${result.path})`);
      for (const problem of result.problems) console.error(`- ${problem.code}: ${problem.detail}`);
    }
    if (!result.ok) process.exitCode = 1;
  } catch (err) {
    stageJsonError(err, json, 'VERIFY_RECEIPT_FAILED');
  }
}

function handleBench() {
  const json = process.argv.includes('--json');
  const rest = process.argv.slice(3);
  try {
    if (rest[0] === 'compare') {
      const ids = [];
      for (let index = 1; index < rest.length; index += 1) {
        const arg = rest[index];
        if (arg === '--json') continue;
        if (arg.startsWith('--')) {
          throw Object.assign(new Error(`Unknown argument for bench compare: ${arg}`), { code: 'BENCH_USAGE' });
        }
        ids.push(arg);
      }
      if (ids.length !== 2) {
        throw Object.assign(new Error('bench compare needs exactly two bench ids'), { code: 'BENCH_USAGE' });
      }
      const comparison = compareBenches(CWD, ids[0], ids[1]);
      if (json) console.log(JSON.stringify(comparison));
      else process.stdout.write(formatCompare(comparison));
      return;
    }
    const modeArg = argValue('--mode');
    const repeatArg = argValue('--repeat');
    const timeoutArg = argValue('--timeout');
    const result = runBench({
      rootDir: CWD,
      home: homeDir(),
      realHome: os.homedir(),
      host: argValue('--host'),
      model: argValue('--model'),
      bin: argValue('--bin'),
      sandboxHome: process.argv.includes('--sandbox-home'),
      hostArgs: repeatedArg('--host-arg'),
      scenarioIds: repeatedArg('--scenario'),
      without: repeatedArg('--without').flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean),
      repeat: repeatArg == null ? 1 : parsePositiveIntegerArg('--repeat', repeatArg),
      timeoutMs: timeoutArg == null ? undefined : parseBenchTimeoutSeconds(timeoutArg),
      mode: modeArg == null ? 'ASSISTED' : normalizeMode(modeArg),
      args: rest,
      env: process.env,
      aelVersion: VERSION
    });
    const relativeDir = path.relative(CWD, result.directory).split(path.sep).join('/');
    if (json) {
      const { directory: _directory, ...body } = result;
      console.log(JSON.stringify({ ...body, directory: relativeDir }));
      return;
    }
    const rate = result.summary.complianceRate;
    log.success(`✓ bench ${result.benchId} (${result.target.host}/${result.target.model})`);
    console.log(`- Status: ${result.status}`);
    console.log(`- Compliance: ${rate == null ? 'unknown' : `${Math.round(rate * 1000) / 10}%`}`);
    console.log(`- Report: ${relativeDir}/report.md`);
    if (result.instructionViolations.length) {
      console.log(`- Top violation: ${result.instructionViolations[0].type} (×${result.instructionViolations[0].count})`);
    }
  } catch (err) {
    stageJsonError(err, json, 'BENCH_FAILED');
  }
}

// Command: review ingest (ledger bound to the reviewer output; lib/review-ingest.js)
// Writes findings.json from the raw child output, gates review, and gates the
// Judge too when the deterministic verdict is allowed.
function handleReview() {
  const json = process.argv.includes('--json');
  try {
    if (process.argv[3] !== 'ingest') throw Object.assign(new Error('Usage: review ingest --run <id> --child-id <id> --file <child-output>'), { code: 'INVALID_USAGE' });
    const { ingestReview } = require('../lib/review-ingest.js');
    const ingested = ingestReview(CWD, { runId: argValue('--run'), childId: argValue('--child-id'), file: argValue('--file') });
    let run = executeGate('review', ingested.runId);
    const judge = run.tier ? judgeRequirement(CWD, run) : { required: true, reasons: ['NO_TIER'] };
    if (!judge.required) run = executeGate('judge', ingested.runId);
    const result = {
      ok: true,
      runId: run.runId,
      state: run.state,
      iteration: run.iteration,
      findings: ingested.findings,
      ledgerBinding: 'BOUND',
      judgeRequired: judge.required,
      judgeReasons: judge.reasons,
      next: judge.required
        ? 'Spawn the Judge with the ledger and contract, write verdict.json, then gate judge.'
        : (run.state === 'JUDGED_PASS' ? 'Deliver after human approval.' : `Judge returned ${run.state}; fix and re-verify.`)
    };
    if (json) console.log(JSON.stringify(result));
    else {
      log.success(`✓ review ingested (${ingested.findings} finding(s), bound to the reviewer output)`);
      console.log(`- State: ${run.state}, iteration ${run.iteration}`);
      console.log(`- Next: ${result.next}`);
    }
  } catch (err) {
    stageJsonError(err, json, 'REVIEW_INGEST_FAILED');
  }
}

// Command: quick start|finish (T0 in two calls; lib/quick.js)
function handleQuick() {
  const action = process.argv[3];
  const json = process.argv.includes('--json');
  const { startQuick, finishQuick } = require('../lib/quick.js');
  try {
    let result;
    if (action === 'start') {
      const valued = new Set(['--mode', '--run', '--cmd', '--timeout-ms']);
      const words = [];
      for (let index = 4; index < process.argv.length; index += 1) {
        const arg = process.argv[index];
        if (valued.has(arg)) { index += 1; continue; }
        if (arg.startsWith('--')) continue;
        words.push(arg);
      }
      result = startQuick(CWD, { task: words.join(' '), mode: argValue('--mode') });
    } else if (action === 'finish') {
      const timeoutValue = argValue('--timeout-ms');
      result = finishQuick(CWD, {
        runId: argValue('--run'),
        commands: repeatedArg('--cmd'),
        shell: process.argv.includes('--shell'),
        serial: process.argv.includes('--serial'),
        timeoutMs: timeoutValue == null ? null : parsePositiveIntegerArg('--timeout-ms', timeoutValue)
      });
    } else {
      throw Object.assign(new Error('Usage: quick start "<task>" [--mode assisted] | quick finish [--run <id>] [--cmd "<command>"]...'), { code: 'INVALID_USAGE' });
    }
    if (json) console.log(JSON.stringify(result));
    else {
      (result.ok ? log.success : log.warn)(`${result.ok ? '✓' : '!'} quick ${action}: Run ${result.runId} (${result.tier}${result.state ? `, ${result.state}` : ''})`);
      for (const item of result.learnings || []) console.log(`- Learning [${item.severity}]: ${item.lesson}`);
      console.log(`- Next: ${result.next}`);
    }
    if (!result.ok) process.exitCode = 1;
  } catch (err) {
    stageJsonError(err, json, 'QUICK_FAILED');
  }
}

function handleSources() {
  const json = process.argv.includes('--json');
  const action = args[1] || 'show';
  const sources = require('../lib/sources.js');
  try {
    if (action === 'refresh' || action === 'show') {
      const result = action === 'refresh' ? sources.writeSourcesFile(CWD) : { path: sources.SOURCES_FILE, sources: sources.detectSources(CWD) };
      if (json) {
        console.log(JSON.stringify({ ok: true, ...result }, null, 2));
        return;
      }
      for (const item of result.sources) console.log(`${item.available ? '✓' : '-'} ${item.id}: ${item.detail}`);
      if (action === 'refresh') console.log(`Wrote ${result.path}; edit its Scope section to limit channels and labels.`);
      return;
    }
    const runId = action === 'record' ? requiredRunId('sources record') : (argValue('--run') || currentRunSafe(CWD)?.runId);
    const run = runId ? loadRun(CWD, runId) : null;
    if (action === 'hint') {
      const result = sources.gatherHints(CWD, run);
      if (json) {
        console.log(JSON.stringify({ ok: true, ...result }, null, 2));
        return;
      }
      console.log(`Gather budget ${result.tier}: ${result.used}/${result.budget} used. Stop once every Goal statement has a source.`);
      for (const item of result.hints) console.log(`- ${item.source}: ${item.try}`);
      return;
    }
    if (action === 'record') {
      const result = sources.recordGather(CWD, run, { source: argValue('--source'), ref: argValue('--ref'), line: argValue('--line') });
      if (json) console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      else console.log(`✓ ${result.entry.id} recorded (${result.used}/${result.budget}). Cite it as source "${result.entry.id}" on a Goal fact.`);
      return;
    }
    throw Object.assign(new Error('Use: sources [show|refresh|hint|record] [--run <id>] [--source <id> --ref <ref> --line <text>] [--json]'), { code: 'INVALID_USAGE' });
  } catch (err) {
    stageJsonError(err, json, 'SOURCES_FAILED');
  }
}

function handleFeatureMap() {
  const json = process.argv.includes('--json');
  try {
    if (args[1] !== 'scaffold') throw Object.assign(new Error('Use: feature-map scaffold [--json]'), { code: 'INVALID_USAGE' });
    const result = require('../lib/feature-map.js').scaffoldFeatureMap(CWD);
    if (json) {
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      return;
    }
    if (result.preserved) console.log(`! ${result.file} was edited; new draft saved as ${result.written}`);
    else if (result.written) console.log(`✓ ${result.written} (${result.rows} row(s) from ${result.signals.join(', ') || 'stub'})`);
    else console.log(`- ${result.file} unchanged`);
    if (!result.rows) console.log('No routes, OpenAPI, pages, README feature bullets, package.json bin, or src directories found. Next: add a ## Features list or fill the stub table, then rerun `ael feature-map scaffold`.');
    else console.log('Check the rows, then `driver scaffold` to add a driver for each feature.');
  } catch (err) {
    stageJsonError(err, json, 'FEATURE_MAP_FAILED');
  }
}

function handleDriver() {
  const json = process.argv.includes('--json');
  try {
    if (args[1] !== 'scaffold') throw Object.assign(new Error('Use: driver scaffold [--feature <id>] [--surface web|api|cli|launch] [--json]'), { code: 'INVALID_USAGE' });
    const results = require('../lib/driver-scaffold.js').scaffoldDriver(CWD, { feature: argValue('--feature'), surface: argValue('--surface') });
    if (json) {
      console.log(JSON.stringify({ ok: true, drivers: results }, null, 2));
      return;
    }
    if (!results.length) log.success('✓ Every feature in the feature map already has a driver');
    for (const item of results) {
      if (item.written && item.written.endsWith('.ael-new')) console.log(`! ${item.feature}: ${item.file} was edited; new template saved as ${item.written}`);
      else if (item.written) console.log(`✓ ${item.feature} (${item.surface}): ${item.written}${item.featureMapUpdated ? ' (feature map Driver set)' : ''}`);
      else console.log(`- ${item.feature}: ${item.file} unchanged`);
      if (item.gaps.length) console.log(`  missing: ${item.gaps.join(', ')} (see the .md next to the driver)`);
    }
    console.log('Fill in EXPECT and the user steps, then run the driver; it exits 0 only when the result matches.');
  } catch (err) {
    stageJsonError(err, json, 'DRIVER_FAILED');
  }
}

function learnFromTranscripts(json) {
  try {
    const lessons = require('../lib/transcript-lessons.js');
    const sinceArg = String(argValue('--since') || '30d');
    if (!/^\d+d?$/.test(sinceArg)) throw Object.assign(new Error('--since must be a number of days, such as 30 or 30d'), { code: 'INVALID_USAGE' });
    const since = Number(sinceArg.replace(/d$/, ''));
    const hostArg = argValue('--host') || 'all';
    const hosts = hostArg === 'all' ? lessons.HOSTS : hostArg.split(',').map((item) => item.trim());
    const minArg = argValue('--min-sessions');
    const minSessions = minArg == null ? 2 : parsePositiveIntegerArg('--min-sessions', minArg);
    const result = lessons.mineTranscripts(CWD, { hosts, since, minSessions });
    const dryRun = process.argv.includes('--dry-run');
    const written = dryRun ? null : lessons.writeTranscriptLessons(CWD, result, { since });
    if (json) {
      console.log(JSON.stringify({ ok: true, written, ...result }, null, 2));
      return;
    }
    log.info(`Transcripts scanned (last ${since} days): ${Object.entries(result.scanned).map(([host, n]) => `${host} ${n}`).join(', ')}; ${result.corrections} correction(s) found`);
    if (!result.entries.length) {
      log.success(`✓ No correction repeated across ${minSessions}+ sessions`);
      return;
    }
    for (const entry of result.entries) {
      console.log(`- ${entry.id} ×${entry.sessions} sessions (${entry.hosts.join(', ')}): ${entry.lesson}`);
      console.log(`  fix level: ${entry.suggestedFix.level} (${entry.suggestedFix.why})${entry.suggestedFix.command ? `\n  try: ${entry.suggestedFix.command}` : ''}`);
    }
    console.log(written ? `Saved to ${written} (redacted examples only). Promote one with \`learn promote <id> ...\`.` : 'Dry run: nothing saved.');
  } catch (err) {
    stageJsonError(err, json, 'LEARN_TRANSCRIPTS_FAILED');
  }
}

function handleSpike() {
  const json = process.argv.includes('--json');
  const sub = args[1];
  const fail = (err) => stageJsonError(err, json, 'SPIKE_FAILED');
  if (sub !== 'record' && sub !== 'show') {
    fail(Object.assign(new Error('Use: spike record --discarded --question <text> --learned <text> | spike show'), {
      code: 'INVALID_USAGE',
      why: 'A spike note is recorded before the Goal freeze, or shown.',
      fix: 'ael spike record --discarded --question "<one question>" --learned "<what the contract should say>"'
    }));
  }
  try {
    const spike = require('../lib/spike.js');
    if (sub === 'show') {
      const result = spike.showSpike(CWD, { runId: argValue('--run') });
      if (json) console.log(JSON.stringify(result, null, 2));
      else if (!result.recorded) console.log(result.runId ? `Run ${result.runId} has no spike. A spike is optional.` : 'No current Run.');
      else if (!result.ok) {
        console.error(`${result.code}: ${result.error}`);
        if (result.fix) console.error(`FIX: ${result.fix}`);
      } else console.log(`Spike discarded. Question: ${result.spike.question}`);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    const result = spike.recordSpike(CWD, {
      runId: argValue('--run'),
      question: argValue('--question'),
      learned: argValue('--learned'),
      discarded: process.argv.includes('--discarded')
    });
    if (json) console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    else console.log(`Recorded ${result.path}. Draft the Goal from that note, then ask the human to freeze.`);
  } catch (err) {
    fail(err);
  }
}

function handleOvernight() {
  const json = process.argv.includes('--json');
  const sub = args[1] && !String(args[1]).startsWith('-') ? args[1] : 'check';
  const fail = (err) => stageJsonError(err, json, 'OVERNIGHT_FAILED');
  if (sub !== 'check') {
    fail(Object.assign(new Error('Use: overnight check [--run <id>] [--json]'), {
      code: 'INVALID_USAGE',
      why: 'The overnight contract is checked against one Run.',
      fix: 'ael overnight check --run <id>'
    }));
  }
  try {
    const valued = new Set(['--run']);
    const flags = new Set(['--json']);
    const scoped = process.argv.slice(3);
    for (let index = 0; index < scoped.length; index += 1) {
      const token = scoped[index];
      if (token === 'check') continue;
      if (!token.startsWith('-')) {
        throw Object.assign(new Error(`Unexpected argument ${token}.`), { code: 'INVALID_USAGE', fix: 'ael overnight check --run <id>' });
      }
      if (valued.has(token)) {
        const value = scoped[index + 1];
        if (!value || value.startsWith('-')) throw Object.assign(new Error(`${token} needs a value.`), { code: 'INVALID_USAGE', fix: 'ael overnight check --run <id>' });
        index += 1;
        continue;
      }
      if (!flags.has(token)) throw Object.assign(new Error(`Unknown flag ${token}.`), { code: 'INVALID_USAGE', fix: 'ael overnight check --run <id>' });
    }
    const result = require('../lib/overnight.js').morningReview(CWD, { runId: argValue('--run') });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Overnight contract (${result.contract.id})`);
      if (!result.runId) {
        console.log('No current Run.');
        console.log(`May: ${result.contract.mayDo.join('; ')}`);
        console.log(`Must not: ${result.contract.mustNot.join('; ')}`);
        console.log(`Stop when: ${result.contract.stopWhen.join(', ')}`);
        console.log('FIX: ael overnight check --run <id>');
      } else {
        console.log(`Run ${result.runId} ${result.mode} ${result.state}`);
        console.log(`Applies: ${result.applies ? 'yes' : 'no'}`);
        console.log(`May continue: ${result.mayContinue ? 'yes' : 'no'}`);
        console.log(`Stop: ${result.stopReason || '(none)'}`);
        console.log(`Morning missing: ${result.morning.missing.join(', ') || '(none)'}`);
        console.log(`Questions: ${result.morning.questions.length}`);
        if (!result.violations.length) console.log('Violations: (none)');
        for (const item of result.violations) console.log(`Violation ${item.id}: ${item.why} FIX: ${item.fix}`);
      }
    }
    if (!result.ok) process.exitCode = 1;
  } catch (err) {
    fail(err);
  }
}

function handleLearn() {
  const json = process.argv.includes('--json');
  if (args[1] === 'promote') {
    try {
      const rule = require('../lib/rules.js').promoteLearning(CWD, args[2], {
        check: argValue('--check'),
        fix: argValue('--fix'),
        why: argValue('--why'),
        by: argValue('--by'),
        scope: argValue('--scope') || 'repo',
        forbidImport: argValue('--forbid-import'),
        forbidApi: argValue('--forbid-api'),
        except: argValue('--except'),
        prove: argValue('--prove'),
        shell: !process.argv.includes('--no-shell')
      });
      if (json) console.log(JSON.stringify({ ok: true, rule }));
      else log.success(`✓ ${rule.from} promoted to rule ${rule.id}; default \`verify\` now runs: ${rule.check}`);
    } catch (err) {
      stageJsonError(err, json, 'LEARN_PROMOTE_FAILED');
    }
    return;
  }
  if (process.argv.includes('--transcripts')) return learnFromTranscripts(json);
  try {
    const maxAge = argValue('--max-age-runs');
    const result = learn(CWD, {
      dryRun: process.argv.includes('--dry-run'),
      prune: process.argv.includes('--prune'),
      ...(maxAge == null ? {} : { maxAgeRuns: parsePositiveIntegerArg('--max-age-runs', maxAge) })
    });
    const { document } = result;
    const candidates = require('../lib/rules.js').promotionCandidates(CWD, document.entries);
    if (json) {
      console.log(JSON.stringify({ ok: true, written: result.written, path: result.path, pruned: result.pruned, promotionCandidates: candidates, learnings: document }));
      return;
    }
    log.success(`✓ ${document.entries.length} learning(s) from ${document.sourceRuns} Run(s)${result.written ? ` → ${result.path}` : ' (dry run, nothing written)'}`);
    for (const entry of document.entries.slice(0, 10)) {
      console.log(`- ${entry.id} [${entry.axis}, ${entry.severity}, ×${entry.occurrences}] ${entry.lesson}`);
    }
    for (const item of result.pruned) console.log(`  pruned ${item.id} (${item.reason})`);
    for (const item of candidates) {
      console.log(`! Promote candidate ${item.id} (seen in ${item.runs} Runs): ${item.lesson}. Make it a check: learn promote ${item.id} --check "<command>" --fix "<instruction>" --by <name>`);
    }
  } catch (err) {
    stageJsonError(err, json, 'LEARN_FAILED');
  }
}

// Command: docs (read-only packaged specs)
function handleDocs() {
  const json = process.argv.includes('--json');
  const target = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'list';
  if (target === 'list') {
    const docs = listDocs();
    if (json) {
      console.log(JSON.stringify({ ok: true, docs }, null, 2));
      return;
    }
    for (const doc of docs) console.log(`${doc.name.padEnd(44)} ${String(doc.bytes).padStart(6)} B  ${doc.rel}`);
    return;
  }
  try {
    const doc = readDoc(target, { section: argValue('--section') });
    if (json) console.log(JSON.stringify({ ok: true, ...doc }, null, 2));
    else process.stdout.write(`${doc.text}\n`);
  } catch (err) {
    log.error(`${err.code || 'DOCS_FAILED'}: ${err.message}`);
    process.exitCode = 1;
  }
}

// Help Menu
function helpText() {
  return (`
AI Engineering Loop CLI (v${VERSION})
A reusable, framework-agnostic AI Engineering Operating System.

Usage:
  npx ai-engineering-loop <command>

Commands:
  init         Bootstrap .ai-engineering-loop/ context from repository discovery
  status       Check the validity, readiness, and baseline freshness of context
               --json  print context, host-skill freshness, and studioUrl (tokenless Studio identity; browser session comes from ael studio)
  refresh      Reconcile drifted context against repository non-destructively
               --non-destructive  keep filled files and write *.ael-new
               --garden [--json]  report stale learnings, dead feature-map rows, and old Runs; writes nothing
               --garden --yes     prune those learnings and move fully dead feature-map rows; Runs stay
               See docs garden.
  run [task]   Start or resume a stateful engineering run and instruct the agent (never writes to home)
               --new  start a new run even when another run is active
               --worktree  start this task in a new git worktree (use when another run is unfinished)
               --base <branch>  with --worktree, start from that local commit (stacked PRs; docs coordinator)
               --mode report-only|assisted|unattended
               --recipe <id>  bind an immutable compiled workflow plan
               --tier T0|T1|T2 --tier-reason <text>  override the automatic tier (recorded)
               --json  print runId, tier, tier reasons, subagent count, recipe, workflowSource, and studioUrl (tokenless; browser session comes from ael studio)
               --from-issue <url|#n>  read one GitHub (gh) or GitLab (glab) issue and draft a red-repro Goal, then the normal loop
                      read-only: never comments or edits the issue. No gh/glab: outcome repro --file <path>
               --from-report <path>  same draft from a pasted report (outcome repro --file)
               --abandon [--run <id>] --reason <text> --by <name> [--yes] [--force-live] [--json]
                      close a stale run as CANCELLED (kept on disk) and release current.json;
                      ASSISTED asks to confirm, UNATTENDED needs --yes from a human
  state        Inspect the current run ledger
               --run <id>  target a non-current run
               --json      print the complete machine-readable ledger
  gate <name>  Validate an artifact and advance the current run (maker: --from-git writes diff.patch first)
               goal | report | maker | verification | review | judge | delivery
               --run <id>  target a non-current run
               --json      print machine-readable gate output
  goal         Share one revision-bound Goal draft between the Agent and Studio
               show [--run <id>]
               draft --file <json> --revision <n> [--run <id>] [--by <agent>]   prints repoRoot (git toplevel)
               draft --from-design <doc.md> [--file <json>] --revision <n>   prefill from a design doc, record designRef
               freeze --revision <n> --hash <sha256> [--run <id>] --by <human>
               show --human [--run <id>]   the Goal as plain Markdown for people (STE style: short active sentences)
               freeze --latest [--run <id>] --by <human>   newest draft, after the person picked Freeze (host question). --by is that person, spaces and letters allowed (not agent or ael-agent). Policy goalFreeze strict: the person types a code in their terminal; a non-interactive shell is refused. Agents must not set AEL_GOAL_FREEZE_OK.
               diagram --view state|storyboard|lanes [--run <id>] [--revision <n>] [--lang <tag>] [--open]   draw the Goal flow as HTML
  verification Summarize verification.json for compact Judge context
               summarize [--run <id>] [--json]
               record [--run <id>] [--timeout-ms <n>] [--shell] [--json] -- <executable> [args...]
                 Captures bounded, redacted output; updates verification.json and its summary
                 --shell opts into a shell; pass one quoted command string, e.g. -- "npm test"
  scaffold     Create a private, deliberately incomplete stage-artifact template
               goal | verification | findings | delivery [--run <id>] [--json]
  validate     Check a verification, findings, or delivery JSON file without advancing a gate
               <repository-relative-file> [--type verification|findings|delivery] [--json]
  activity     Publish safe Run lifecycle summaries for Studio
               goal-drafting | goal-ready | heartbeat | waiting
               node-started | node-activity | node-completed | loop-iterated | run-completed
               [--run <id>] [--node <id>] [--phase <id>] --message <text>
  node         Operate custom nodes in a recipe-bound run
               status [--run <id>] [--json]
               start <id> [--run <id>] [--json]
               complete <id> [--artifact <repository-relative-path>] [--json]
               fail <id> [--reason <text>] [--json]
               activity <id> --message <safe progress text> [--json]
               retry <id> [--json]
               approve <id> --yes [--by <name>] [--json]
  interaction  Exchange Run-bound questions with Studio
               list --run <id> [--json]
               question --run <id> --message <text> [--by <agent>]
               answer <question-id> --run <id> --message <text> [--by <name>]
  policy       Inspect or update fail-closed runtime controls
               show [--json]
               set [--default-mode <mode>] [--allow-unattended true|false]
                   [--require-sandbox true|false]
                   [--review-profile lean|standard|thorough]
                   [--goal-freeze host-question|strict]   how a person approves a Goal freeze (default host-question)
                   [--per-run-token-limit <n>] [--daily-token-limit <n>]
  budget       Enforce actual provider-reported token usage and emergency pause
               status [--run <id>] [--node <id>] [--estimate <n>] [--json]
               record --input <n> --output <n> --model <id> [--run <id>] [--node <id>]
               record --unavailable [--run <id>] [--node <id>]
                 host exposed no usage: ASSISTED notes it and continues; UNATTENDED fails
               pause | resume
  sandbox      Isolate Maker changes in a locked disposable Git worktree
               create | capture | abort | status [--run <id>] [--json]
  context <stage> <files...>
               Build a bounded, redacted context pack for maker, devil-advocate, or judge
               index [files...]  build a private source summary index without file bodies
               query <term>      search index paths and exported symbols without source bodies
               related <file>    list nearby indexed files without reading source bodies
               diff-hunks        build a hunk-only review pack with unresolved findings
               fast-path         assess whether a small task can stay on lean review
               compact           write run-summary.md/json and open-findings.json
               claimed-vs-reality  scaffold AC rows from the frozen Goal; evidence stays blank
                 [--run <id>] [--output <repository-relative-file>]
               --run <id>  target a non-current run
               --profile lean|standard|thorough  override runtime policy for one pack
               --base <git-ref>  base ref for diff-hunks; default HEAD
               --query <term>    query term for context query
               --limit <n>       bound query/related result count
               --include-ignored include CSS, generated, lockfile, and .aelcontextignore paths
               --json      print only pack metadata; never print packed content
  eval         Validate the 25-case production evaluation catalog
               --results <dir>  score host-generated JSON results
               --cases <dir>    use another compatible fixture catalog
               --json           print machine-readable metrics
  bench        Compliance self-check for one chosen host and model
               [--host <id> --model <id>] [--scenario <id>]... [--repeat <n>]
               [--bin <path>] [--host-arg <arg>]... [--sandbox-home]
               [--mode assisted|unattended|report-only] [--timeout <seconds>] [--json]
               One target per invocation. Default mode is ASSISTED; the scenario file's
               scripted approver answers Goal freeze, impact confirm, and deliver --approve.
               --mode unattended is opt-in. Default timeout is 20 minutes.
               The host keeps the real HOME so it can authenticate. AEL_HOME is a temp dir.
               --bin and --sandbox-home give the host a temp HOME (tests use this).
               A missing binary is UNAVAILABLE, not a model failure.
               Progress lines go to stderr. Writes .ai-engineering-loop/bench/<benchId>/{results.json,report.md,hardening.md}
               bench compare <benchIdA> <benchIdB> [--json]   read-only side-by-side table
  outcome      record --run <id> --source mr-comment|revert|bug|incident --location <file[:line]> --summary <text> --by <name>
               a post-delivery problem traced to a Run (input for calibrate)
               repro --file <path> [--json]  pasted bug report -> one red-repro Goal, then the normal loop (read-only)
  calibrate    Compare recorded outcomes with each Run's Finding Ledger: DA misses, wrong dismissals, per reviewer prompt
  debt         Accepted trade-offs and L3 waivers recorded at delivery: list [--file <path>] | close <id> --by <name> [--note <text>]
  next         Next unblocked feature from .ai-engineering-loop/features.json, VCR (verified/activated), evidence audit [--json]
  worktree     Clean up AEL worktrees: prune [--audit] [--include-scratch] [--yes] [--json] (never removes changed tracked files, open PRs or foreign worktrees)
  pr           Pull request after delivery. status [--run <id> | --branch <name> | --pr <n>] [--json] reads once and records merge.json when merged. babysit --run <id> [--json] polls with backoff, starts a T0 or T1 fix on that same branch when checks fail, and leaves the merge to you
  sources      Where the agent digs before asking (read-only): show | refresh | hint | record --source <id> --ref <ref> --line <text>
  driver       Scaffold a reusable verification driver per feature-map row: scaffold [--feature <id>] [--surface web|api|cli|launch]
  feature-map  Draft .ai-engineering-loop/feature-map.md from routes, OpenAPI, pages, or the README: scaffold [--json]
  safety       Record the one fact a change is safe because of [record --fact <text> --cmd <proof>] (T2 Judge PASS needs level 4+)
  measurement  Record how a performance number was measured [record --ac <id> --runs <n> --spread <pct> --effect <pct> --limiter <text>]
  recap        Evidence-backed recap of the last N days as one HTML page [--days 7] [--for me|lead|client] [--projects <p,...>|all] [--out <file>] [--lang <tag>] [--open] [--json]
  stats        Failure causes by harness layer, false-victory rate, iterations to PASS [--last <n>] [--json]
  escalation   Compute the minimum Judge model tier from deterministic risk signals
               --run <id>  target a non-current run
               --json      print machine-readable reasons
  review       ingest --run <id> --child-id <id> --file <child-output> [--json]
               bind findings.json to the Devil's Advocate output, gate review, and gate the
               Judge too when the deterministic verdict is allowed
  quick        T0 in two calls: start creates the Run and a derived Goal; finish gates the
               working-tree diff, verifies, writes claimed-vs-reality, and runs review + judge
               start "<task>" [--mode assisted|unattended] | finish [--run <id>] [--cmd "<command>"]...
  verify       Record verification commands, gate them, compact, and scaffold claimed-vs-reality
               [--run <id>] [--cmd "<command>"]... [--shell] [--serial] [--timeout-ms <n>] [--fresh] [--json]
               default (no --cmd): build -> typecheck -> lint -> test_unit from verification.md, serial, stops at first failure
               --baseline  before the Maker gate: run the plan on the untouched tree, write baseline.json
               --related   fast lane: test_related with {files} = changed files of the gated diff
               --final     after Judge PASS: full run delivery needs when verification was related-only
               --fresh     re-run commands that already passed for the same diff and revision
  impact       Blast-radius map of the frozen Goal before Stage 3 (written to the Run on Goal freeze)
               map [--run <id>] [--limit <n>] [--force] [--json]   files, modules, endpoints, DB tables, tests
               show [--run <id>] [--json]
               confirm --by <name> [--allow <glob>]... [--remove <path>]... [--run <id>] [--json]
                 confirmed paths become the Run's allowed scope; verify reports changes outside it
               skip --by <name> --reason <text> [--run <id>]   trivial goals (copy, CSS, comments)
               drift [--run <id>] [--json]   compare the gated Maker diff with the map
  guard        Runtime guardrail for one tool call: allow | warn | block (warn/block recorded in the Run)
               check --tool edit|bash (--input -|<file> | --path <file> | --command <text>) [--run <id>] [--json]
               check --hook claude   read a Claude Code PreToolUse payload on stdin and answer deny/ask
                 edit: outside Goal scope.allowedPaths + confirmed impact map, or in scope.deniedPaths
                 bash: rm -rf, DROP TABLE/TRUNCATE, git push --force, git reset --hard, git clean -fd
                 ASSISTED warns (the host asks), UNATTENDED and REPORT_ONLY block (exit 2)
  hooks        Install native pre-tool hooks that call guard check (enforced hosts: Claude Code)
               install | uninstall | status [--host claude] [--json]   writes .claude/settings.json
  review-pack  Build the Devil's Advocate pack: fast-path, diff hunks, escalation floor, tier
               [--run <id>] [--base <git-ref>] [--profile lean|standard|thorough] [--json]
  deliver      Approve READY approval nodes, write delivery.json, and pass the delivery gate
               [--run <id>] [--destination <where> --summary <text>] [--approve --by <name>] [--json]
               ASSISTED requires --approve --by <name>, given only after explicit human approval
               [--host <id>] [--model <id>] [--head <sha>] [--evidence AC-N=<https-url>]...
               writes RUN_DIR/receipt.json + receipt.md (paste into the PR/MR body); digest stored in delivery.json
  verify-receipt  Re-check a delivery receipt: artifact hashes, frozen Goal, AC evidence, verdict, head SHA
               [--run <id> | <repository-relative-receipt.json>] [--head <sha>] [--json]   exit 1 on mismatch (CI)
  learn promote <learningId> --check "<command>" --fix "<instruction>" --by <name> [--why <text>] [--scope repo|diff] [--no-shell]
               --scope diff: the check sees only lines this change adds ($AEL_ADDED_LINES_FILE, $AEL_CHANGED_FILES)
               built-in instead of --check: --forbid-import "<fromGlob> -> <toGlob>" | --forbid-api "<regex>" [--except <glob>]
  rules check <ruleId>   run a built-in rule on the added lines (used by verify)
               turn a recurring review lesson into an executable L1 rule (.ai-engineering-loop/rules.json)
  spike        Record a throwaway prototype before the Goal freeze
               record --discarded --question <text> --learned <text> [--run <id>] [--json]
               show [--run <id>] [--json]
               Refuses a spike that is not discarded, or a Goal that is already frozen.
               See docs prototype-spike. No arena.
  overnight    Check an UNATTENDED Run against the overnight contract
               check [--run <id>] [--json]
               exit 1 when it delivered without a person, or a stop is missing the morning files
               See docs overnight-contract.
  learn        Mine past Runs' VALID findings into .ai-engineering-loop/learnings.json (+ .md) for context packs
               [--dry-run] [--prune] [--max-age-runs <n>] [--json]
               deterministic and deduped with runId provenance; --prune drops lessons whose files are gone
               or not seen in the last <n> Runs (default 20); maker / devil-advocate packs get the top entries
               --transcripts [--since 30d] [--host claude|cursor|codex|all] [--min-sessions 2] [--dry-run]: corrections you
               repeated in local agent chats become candidate lessons (redacted, read-only, never sent anywhere)
  docs         Print a packaged spec without needing the package source tree
               list [--json]
               <name> [--section <heading>] [--json]   e.g. docs grill-policy --section "When to grill"
  doctor       Check this machine: Node, git, git identity, agent skill, adapter CLI and login (every problem names its FIX)
               --package   release checks instead: schemas, host assets, package contents, eval catalog (npm run doctor)
               --harness   audit harness debt instead: entry-file size/structure, stale learnings, rule provenance, skill budget
               --json      print machine-readable diagnostics
  update       Check or apply the package update workflow
               check|plan [--json]
               apply --yes
               policy [off|notify|patch|minor|all] [--channel latest|next] [--pin 1.13.x|--no-pin]
               auto [--force] [--json]   check (cached 24 h) and apply per policy; majors notice-only
               rollback --yes            reinstall the previous version, re-sync hosts, restore legacy snapshots
  migrate      Run major-version migrations (migrations/<major>.js); update apply calls it across a major
               --from <old-version> [--dry-run] [--json]
  projects     Registry of local projects with .ai-engineering-loop/ (~/.ai-engineering-loop/projects.json)
               list|add [dir]|remove [dir] [--json]
               scan --root <dir> [--depth 4]
  workflow     Build or adapt the per-user personal recipe (writes only under the AEL home)
               interview [--json]
               propose --answers <file> [--json]
               accept --proposal <id> --by <name> [--json]
               reject --proposal <id> --by <name> [--json]
               suggest [--json]
               UNATTENDED cannot accept or reject (HUMAN_REQUIRED)
  recipe       Inspect and compile declarative workflow recipes (does not execute nodes)
               list [--json]
               catalog [--json]
               create <id> [--from <preset>] [--description <text>] [--json]
               clone <source> <target> [--description <text>] [--json]
               install <path> [--replace] [--json]
               inspect <id> [--json]
               diff <left> <right> [--json]
               show <id> [--json]
               validate <id> [--mode <mode>] [--json]
               explain | graph | simulate <id> [--mode <mode>] [--json]
  studio       Open the localhost-only, read-only bot monitor for every registered project
               [--port <0-65535>] [--no-open] [--no-notify]
               --background  keep Studio running detached; log in ~/.ai-engineering-loop/studio.log
               --stop        stop the running Studio
  handoff      Export or verify a redacted, integrity-bound knowledge transfer
               create [--run <id>] [--audience developer|agent|auditor]
                      [--output <repository-relative-file>|-] [--json]
               inspect | brief <repository-relative-file> [--json]
  setup        One-time: detect AI agents (config folder or PATH binary, never run) and install for them
               --yes  skip the prompt   --hosts <id,...>  pick hosts   --json
               --mode auto|manual  (prompt suggests auto; --yes / no TTY default to manual)
               Without a TTY and without --yes it only prints the plan
  hosts        Show or change which AI agent hosts get the loop
               list [--json]  |  doctor [--json]  |  enable <id...>  |  disable <id...> (removes unedited AEL files)
  sync-hosts   Install the loop skill and reviewer agents into every detected AI agent host
               (only hosts that already exist; DOT skills only if already installed)
               --dry-run       print the plan without writing
               --pack <list>   core, quality and spec (always), plus backend, design; saved for later syncs
               --prune         remove unmodified files of packs that are not selected
               --json          print machine-readable results
               User-edited host files are backed up to <file>.ael-backup before overwrite
  generate-adapter  Print detected forge and grill protocol for Stage 8
               --type standard|github|gitlab|dot  write .ai-engineering-loop/adapter.md (skip grill)
  generate-workflow Print grill protocol for a loop overlay (hooks + intern + lessons.md)
               --write  write .ai-engineering-loop/workflow.md and empty lessons.md (skip grill)

Options:
  -h, --help     Show this help menu
  -v, --version  Show version number

Documentation:
  https://github.com/egagofur/ai-engineering-loop
`);
}

function printHelp() {
  console.log(helpText());
}

function commandNames() {
  return [...new Set(helpText().split('\n').map((line) => (line.match(/^  ([a-z][\w-]*)(?: (?:\[[^\]]+\]|<[^>]+>))*(?:\s{2,}|\s+(?=[A-Z])|\s*$)/) || [])[1]).filter(Boolean))];
}

function shortHelp() {
  return `AI Engineering Loop v${VERSION}: a gated engineering loop for your coding agent.

Start here:
  npm i -g ai-engineering-loop   Node 18+ and git required
  ael setup                      install the ael skill (agents and scripts: ael setup --yes)
  ael init                       write .ai-engineering-loop/ for this project
  Then tell your agent: "Use AI Engineering Loop to build <your feature>"

Everyday:
  ael status                     is this project ready, and what is running?
  ael run "<task>"               start or resume a Run; the agent drives the rest
  ael quick start "<task>"       a tiny change in two calls (T0)
  ael studio                     watch every project's bot on this machine (read-only, Freeze)
  ael doctor                     check this machine (git, agent skill, gh/glab)

Help:
  ael help <command>             usage for one command
  ael help --all                 every command and flag
  ael docs list                  specs and policies

All commands: ${commandNames().join(', ')}`;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

function unknownCommand(name) {
  const best = commandNames().map((candidate) => ({ name: candidate, distance: editDistance(name, candidate) })).sort((a, b) => a.distance - b.distance)[0];
  log.error(`Unknown command: ${name}.${best && best.distance <= 2 ? ` Did you mean \`${best.name}\`?` : ''}`);
  console.error('Run `ael help` for the common commands, or `ael help --all`.');
  process.exit(2);
}

function startMenu() {
  return `AI Engineering Loop v${VERSION}
No .ai-engineering-loop/ in this folder yet. Pick one:
  1. Build my workflow    ael init    (then \`ael setup\` if your agent does not have the skill yet)
  2. Start a task         ael run "<task>"
  3. Check this project   ael status
Help: ael help. Nothing was written.`;
}

// CLI Router
const args = process.argv.slice(2);
const printNow = (text) => {
  const buffer = Buffer.from(`${text}\n`);
  let offset = 0;
  while (offset < buffer.length) {
    try {
      offset += fs.writeSync(1, buffer, offset);
    } catch (err) {
      if (err.code !== 'EAGAIN') throw err;
    }
  }
};
if (!args.length && !fs.existsSync(CONTEXT_DIR)) {
  printNow(startMenu());
  process.exit(0);
}
const command = args[0] || 'status';
if (command === 'help' || ((command === '-h' || command === '--help') && args.length === 1) || ((command === '-h' || command === '--help') && args[1] === '--all')) {
  const topic = command === 'help' ? args[1] : null;
  if (topic === '--all' || args.includes('--all')) printNow(helpText());
  else if (topic) {
    const block = commandHelp(helpText(), topic);
    if (!block) {
      log.error(`No help for "${topic}". Commands: ${commandNames().join(', ')}`);
      process.exit(2);
    }
    printNow(`Usage: npx ai-engineering-loop ${block.trim()}`);
  } else printNow(shortHelp());
  process.exit(0);
}

// Side-effect guard (issue #25): help never executes a command, and writer
// commands reject unknown flags before touching any file.
if (!['-h', '--help', '-v', '--version'].includes(command)) {
  const checked = effectiveCommand(command, args.slice(1));
  if (wantsCommandHelp(checked, args.slice(1))) {
    const block = commandHelp(helpText(), command);
    if (!block && !commandNames().includes(command) && command !== 'rules') unknownCommand(command);
    printNow(block ? `Usage: npx ai-engineering-loop ${block.trim()}` : shortHelp());
    process.exit(0);
  }
  const unknown = unknownWriterArgs(checked, args.slice(1));
  if (unknown.length > 0) {
    log.error(`Unknown argument(s) for "${command}": ${unknown.join(' ')}. Nothing was written.`);
    console.log(`Run "npx ai-engineering-loop ${command} --help" for usage.`);
    process.exit(2);
  }
}

// Registry + auto-update hooks (issue #37). Registration runs at exit so a
// fresh `init` is recorded too.
if (['init', 'run', 'status', 'refresh'].includes(command)) {
  process.once('exit', () => projectRegistry.registerProject(CWD));
  if (command === 'init') askAutoUpdatePolicyOnce();
  maybeAutoUpdate();
}

if (!['setup', 'hosts', 'sync-hosts', 'guard', 'bench', '-h', '--help', '-v', '--version'].includes(command)) maybeSetupHint();
if (command === 'status') maybeNewHostsNotice();

switch (command) {
  case 'init':
    handleInit();
    break;
  case 'projects':
    handleProjects();
    break;
  case 'status':
    handleStatus();
    break;
  case 'refresh':
    handleRefresh();
    break;
  case 'run':
    handleRun();
    break;
  case 'state':
    handleState();
    break;
  case 'gate':
    handleGate();
    break;
  case 'goal':
    handleGoal();
    break;
  case 'activity':
    handleActivity();
    break;
  case 'node':
    handleNode();
    break;
  case 'interaction':
    handleInteraction();
    break;
  case 'policy':
    handlePolicy();
    break;
  case 'budget':
    handleBudget();
    break;
  case 'verification':
    handleVerification();
    break;
  case 'scaffold':
    handleArtifactTool('scaffold');
    break;
  case 'validate':
    handleArtifactTool('validate');
    break;
  case 'sandbox':
    handleSandbox();
    break;
  case 'context':
    handleContext();
    break;
  case 'eval':
    handleEval();
    break;
  case 'bench':
    handleBench();
    break;
  case 'escalation':
    handleEscalation();
    break;
  case 'recap':
    handleRecap();
    break;
  case 'sources':
    handleSources();
    break;
  case 'pr':
    handlePr();
    break;
  case 'driver':
    handleDriver();
    break;
  case 'feature-map':
    handleFeatureMap();
    break;
  case 'worktree':
    handleWorktree();
    break;
  case 'safety':
    handleSafety();
    break;
  case 'measurement':
    handleMeasurement();
    break;
  case 'stats':
    handleStats();
    break;
  case 'rules':
    handleRules();
    break;
  case 'next':
    handleNext();
    break;
  case 'debt':
    handleDebt();
    break;
  case 'outcome':
    handleOutcome();
    break;
  case 'calibrate':
    handleCalibrate();
    break;
  case 'docs':
    handleDocs();
    break;
  case 'verify':
    handleVerify();
    break;
  case 'guard':
    handleGuard();
    break;
  case 'hooks':
    handleHooks();
    break;
  case 'impact':
    handleImpact();
    break;
  case 'review-pack':
    handleReviewPack();
    break;
  case 'learn':
    handleLearn();
    break;
  case 'overnight':
    handleOvernight();
    break;
  case 'spike':
    handleSpike();
    break;
  case 'quick':
    handleQuick();
    break;
  case 'review':
    handleReview();
    break;
  case 'verify-receipt':
    handleVerifyReceipt();
    break;
  case 'deliver':
    handleDeliver();
    break;
  case 'doctor':
    handleDoctor();
    break;
  case 'update':
    handleUpdate();
    break;
  case 'migrate':
    handleMigrate();
    break;
  case 'workflow':
    handleWorkflow();
    break;
  case 'recipe':
    handleRecipe();
    break;
  case 'studio':
    handleStudio();
    break;
  case 'handoff':
    handleHandoff();
    break;
  case 'sync-hosts':
    handleSyncHosts();
    break;
  case 'hosts':
    handleHosts();
    break;
  case 'setup':
    handleSetup();
    break;
  case 'generate-adapter':
    handleGenerateAdapter();
    break;
  case 'generate-workflow':
    handleGenerateWorkflow();
    break;
  case '-v':
  case '--version':
    console.log(`ai-engineering-loop v${VERSION}`);
    break;
  case '-h':
  case '--help':
    console.log(shortHelp());
    break;
  default:
    unknownCommand(command);
}
