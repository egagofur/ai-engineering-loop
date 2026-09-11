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
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');
const {
  homeDir,
  applyHostSync,
  planHostSync,
  formatHostSyncReport
} = require('../lib/sync-hosts.js');
const {
  detectAdapterHints,
  writeShippedAdapter,
  formatGenerateAdapterReport,
  parseTypeArg
} = require('../lib/generate-adapter.js');
const {
  writeWorkflowOverlay,
  formatGenerateWorkflowReport,
  parseWriteArg,
  workflowMarkdown,
  lessonsMarkdown
} = require('../lib/generate-workflow.js');
const {
  RUN_MODES,
  TERMINAL_STATES,
  createOrResumeRun,
  getCurrentRun,
  loadRun,
  newRunId
} = require('../lib/run-state.js');
const {
  DEFAULT_POLICY,
  assertModeAllowed,
  loadPolicy,
  normalizeMode,
  updatePolicy
} = require('../lib/runtime-policy.js');
const {
  applyGate
} = require('../lib/gates.js');
const {
  createContextPack,
  contextPackSummary
} = require('../lib/safe-context.js');
const {
  defaultCasesDir,
  loadEvaluationCases,
  loadResults,
  scoreEvaluationResults,
  catalogSummary
} = require('../lib/evaluation.js');
const {
  assessRunEscalation
} = require('../lib/escalation.js');
const {
  runDoctor
} = require('../lib/doctor.js');
const {
  assertBudgetAvailable,
  budgetStatus,
  recordTokenUsage,
  setKillSwitch
} = require('../lib/budget.js');
const {
  PRIVATE_RUNTIME_GITIGNORE
} = require('../lib/runtime-files.js');
const {
  appendRunAnswer,
  appendRunQuestion,
  listRunInteractions
} = require('../lib/run-interactions.js');
const {
  appendRunLifecycle,
  listRunLifecycle,
  runAgentPresence
} = require('../lib/run-lifecycle.js');
const {
  freezeGoal,
  loadGoalDraft,
  saveGoalDraft
} = require('../lib/goal-runtime.js');
const {
  abortSandbox,
  captureSandbox,
  createSandbox,
  sandboxStatus
} = require('../lib/sandbox.js');
const {
  compileRecipe,
  explainPlan,
  listRecipes,
  loadRecipe,
  mermaidPlan,
  simulatePlan,
  validateRecipe
} = require('../lib/recipe.js');
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
} = require('../lib/workflow-runtime.js');
const {
  cloneRecipe,
  diffRecipes,
  inspectRecipe,
  installRecipe,
  recipeCatalog
} = require('../lib/recipe-builder.js');
const {
  createHandoff,
  handoffBrief,
  readHandoff,
  verifyHandoff
} = require('../lib/handoff.js');
const { createStudioServer } = require('../lib/studio-server.js');

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

function writeContextFile(filePath, content, { overwrite = true } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!overwrite && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return false;
  }
  fs.writeFileSync(filePath, content);
  return true;
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
const log = {
  info: (msg) => console.log('\x1b[36m%s\x1b[0m', msg),
  success: (msg) => console.log('\x1b[32m%s\x1b[0m', msg),
  warn: (msg) => console.log('\x1b[33m%s\x1b[0m', msg),
  error: (msg) => console.log('\x1b[31m%s\x1b[0m', msg),
  bold: (msg) => console.log('\x1b[1m%s\x1b[0m', msg),
  dim: (msg) => console.log('\x1b[2m%s\x1b[0m', msg)
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
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
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
function analyzeRepository(rootDir) {
  const discovery = {
    projectName: path.basename(rootDir),
    isMonorepo: false,
    profile: 'backend-api',
    languages: [],
    frameworks: [],
    packageManager: 'npm',
    scripts: {
      testUnit: 'npm test',
      testAll: 'npm test',
      typecheck: 'npx tsc --noEmit',
      lint: 'npx eslint --fix',
      build: 'npm run build',
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
    discovery.languages.push('TypeScript / JavaScript');
    discovery.evidence.push('Manifest: package.json');
    try {
      const pkg = JSON.parse(readFileSafe(pkgPath) || '{}');
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      if (allDeps['next']) { discovery.frameworks.push('Next.js'); if (!discovery.isMonorepo) discovery.profile = 'web-app'; }
      if (allDeps['react']) { discovery.frameworks.push('React'); if (!discovery.isMonorepo) discovery.profile = 'web-app'; }
      if (allDeps['vue']) { discovery.frameworks.push('Vue'); if (!discovery.isMonorepo) discovery.profile = 'web-app'; }
      if (allDeps['svelte'] || allDeps['@sveltejs/kit']) { discovery.frameworks.push('Svelte'); if (!discovery.isMonorepo) discovery.profile = 'web-app'; }
      if (allDeps['@nestjs/core']) { discovery.frameworks.push('NestJS'); if (!discovery.isMonorepo) discovery.profile = 'backend-api'; }
      if (allDeps['express']) { discovery.frameworks.push('Express'); if (!discovery.isMonorepo) discovery.profile = 'backend-api'; }
      if (allDeps['fastify']) { discovery.frameworks.push('Fastify'); if (!discovery.isMonorepo) discovery.profile = 'backend-api'; }
      if (allDeps['@prisma/client'] || allDeps['prisma']) { discovery.frameworks.push('Prisma ORM'); }

      // Script mapping
      const scripts = pkg.scripts || {};
      const pm = discovery.packageManager;
      if (scripts['test:unit']) discovery.scripts.testUnit = `${pm} run test:unit`;
      else if (scripts['test']) discovery.scripts.testUnit = `${pm} test`;

      if (scripts['typecheck']) discovery.scripts.typecheck = `${pm} run typecheck`;
      else if (scripts['type-check']) discovery.scripts.typecheck = `${pm} run type-check`;
      else if (scripts['check']) discovery.scripts.typecheck = `${pm} run check`;

      if (scripts['lint']) discovery.scripts.lint = `${pm} run lint`;
      if (scripts['build']) discovery.scripts.build = `${pm} run build`;
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

  // 3. Adapter / CI Detection
  if (fs.existsSync(path.join(rootDir, '.github', 'workflows'))) {
    discovery.adapter.ciProvider = 'GitHub Actions';
    discovery.adapter.type = 'github';
  } else if (fs.existsSync(path.join(rootDir, '.gitlab-ci.yml'))) {
    discovery.adapter.ciProvider = 'GitLab CI';
    discovery.adapter.type = 'gitlab';
  }

  // Check git remote if git folder exists
  const gitConfigStr = readFileSafe(path.join(rootDir, '.git', 'config'));
  if (gitConfigStr) {
    const urlMatch = gitConfigStr.match(/url\s*=\s*(.*)/);
    if (urlMatch) {
      discovery.adapter.repoSlug = urlMatch[1].trim();
      if (discovery.adapter.repoSlug.includes('gitlab.dot.co.id')) {
        discovery.adapter.type = 'dot';
      }
    }
  }

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
- Confidence: HIGH
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
- **typecheck**: \`${discovery.scripts.typecheck}\`
- **lint**: \`${discovery.scripts.lint}\`
- **build**: \`${discovery.scripts.build}\`
${discovery.scripts.e2e ? `- **e2e**: \`${discovery.scripts.e2e}\`` : ''}

## Verification Protocol
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

  log.dim(`> Profile Bound: ${discovery.profile}`);
  log.dim(`> Languages: ${discovery.languages.join(', ') || 'Unspecified'}`);
  log.dim(`> Package Manager: ${discovery.packageManager}`);
  log.dim(`> Unit Test Command: ${discovery.scripts.testUnit}`);

  if (firstInitialization) ignoreProjectContextOnFirstInit(CWD);
  generateContextFiles(CWD, discovery, trigger, impact, { overwriteCore });

  const validation = validateContext(CONTEXT_DIR);
  if (validation.valid) {
    log.success('\n✓ Successfully initialized .ai-engineering-loop/ with:');
    REQUIRED_FILES.forEach((f) => console.log(`  - .ai-engineering-loop/${f}`));
    log.dim('\nProject context is private by default. Remove .ai-engineering-loop/ from .gitignore if you want to share it.');
  } else {
    log.error(`\n✗ Initialization validation failed: ${validation.reason}`);
    process.exit(1);
  }
}

// Command: status
function handleStatus() {
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
  console.log(`- Context Baseline Git: ${metadata.repositoryRevision ? metadata.repositoryRevision.slice(0, 8) : 'unknown'}`);
  console.log(`- Living Freshness: \x1b[32m${drift.status}\x1b[0m (${drift.reason})`);
  console.log(`- Context Files: ${REQUIRED_FILES.length}/${REQUIRED_FILES.length} verified (including metadata.json, glossary.md, adrs/)`);

  const hostPlan = planHostSync({ home: homeDir() });
  const hostCopy = hostPlan.filter((item) => item.action === 'copy').length;
  if (hostCopy > 0) {
    log.warn(`- Host skills: STALE (${hostCopy} file(s) behind package v${VERSION})`);
    log.dim('  Run "npx ai-engineering-loop sync-hosts" then start a new session.');
  } else {
    const hostCurrent = hostPlan.filter((item) => item.action === 'current').length;
    console.log(`- Host skills: CURRENT (${hostCurrent} managed file(s) match v${VERSION})`);
  }
}

// Command: refresh
function handleRefresh() {
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

function syncHostsQuiet() {
  const results = applyHostSync({ home: homeDir(), dryRun: false });
  const copied = results.filter((item) => item.action === 'copy').length;
  if (copied === 0) return;
  console.log(formatHostSyncReport(results, { version: VERSION }));
}

function handleSyncHosts() {
  const dryRun = process.argv.includes('--dry-run');
  log.info(`AI Engineering Loop — Sync host skills (sync-hosts)${dryRun ? ' [dry-run]' : ''}`);
  const results = applyHostSync({ home: homeDir(), dryRun });
  console.log(formatHostSyncReport(results, { version: VERSION, dryRun }));
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

// Command: run
function handleRun() {
  log.info('AI Engineering Loop — Task Execution Entrypoint (run)');

  if (!fs.existsSync(CONTEXT_DIR)) {
    log.warn('Project context missing. Auto-initializing before task execution...');
    handleInit();
  } else {
    handleStatus();
  }

  syncHostsQuiet();

  const runArgs = process.argv.slice(3);
  const forceNew = runArgs.includes('--new');
  const modeArg = argValue('--mode');
  const recipeArg = argValue('--recipe');
  const taskParts = [];
  for (let index = 0; index < runArgs.length; index++) {
    if (runArgs[index] === '--new') continue;
    if (runArgs[index] === '--mode') {
      index += 1;
      continue;
    }
    if (runArgs[index] === '--recipe') {
      index += 1;
      continue;
    }
    taskParts.push(runArgs[index]);
  }
  const task = taskParts.join(' ').trim();
  let runResult;
  try {
    const current = getCurrentRun(CWD);
    const policy = loadPolicy(CWD);
    const startsNewRun = forceNew || !current || TERMINAL_STATES.has(current.state);
    let mode = modeArg ? normalizeMode(modeArg) : (startsNewRun ? policy.defaultMode : null);
    let workflow = null;
    let requestedRunId = null;
    const selectedRecipeId = recipeArg || (
      startsNewRun
        ? (mode === RUN_MODES.REPORT_ONLY ? 'audit' : 'default')
        : null
    );
    if (selectedRecipeId) {
      const { recipe } = loadRecipe(CWD, selectedRecipeId);
      if (!mode && current) mode = current.mode;
      if (startsNewRun && !modeArg && !recipe.compatibleModes.includes(mode)) {
        if (recipe.compatibleModes.length !== 1) {
          throw new Error(`Recipe ${recipe.id} requires an explicit compatible --mode.`);
        }
        mode = recipe.compatibleModes[0];
      }
      const plan = compileRecipe(recipe, { mode });
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
      } else {
        workflow = { plan };
      }
    }
    if (mode) assertModeAllowed(CWD, mode);
    runResult = createOrResumeRun(CWD, {
      task,
      forceNew,
      mode,
      workflow,
      ...(requestedRunId ? { runId: requestedRunId } : {})
    });
    assertBudgetAvailable(CWD, { runId: runResult.run.runId });
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }
  console.log(`- Run: ${runResult.run.runId} (${runResult.resumed ? 'resumed' : 'created'})`);
  console.log(`- State: ${runResult.run.state}, iteration ${runResult.run.iteration}`);
  console.log(`- Mode: ${runResult.run.mode || RUN_MODES.ASSISTED}`);
  if (runResult.run.workflow) {
    const runtime = workflowStatus(CWD, { runId: runResult.run.runId });
    const ready = runtime.plan.nodes
      .filter((node) => runtime.state.nodes[node.id].status === 'READY')
      .map((node) => node.id);
    console.log(`- Recipe: ${runResult.run.workflow.recipeId} (${runResult.run.workflow.graphHash})`);
    console.log(`- Ready nodes: ${ready.join(', ') || 'none'}`);
  }

  const grok = detectGrokHost();

  console.log('\n------------------------------------------------------------');
  log.bold('AI Agent Ready:');
  console.log('1. Grill if needed, then freeze Goal Contract (core/grill-policy.md, core/goal-contract.md)');
  if (runResult.run.mode === RUN_MODES.REPORT_ONLY) {
    console.log('2. Analyze evidence without changing repository files');
    console.log('3. Write report.json and finish with `ai-engineering-loop gate report`');
  } else {
    console.log('2. Root Cause Analysis (core/root-cause-analysis.md) & Plan');
    console.log('3. Maker TDD at named seams (policies/tdd-policy.md)');
    console.log('4. Run Deterministic Verification');
    console.log('5. Execute Devil\'s Advocate Adversarial Review');
    console.log('6. Judge Agent evaluates DoD and issues PASS verdict');
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
    console.log('- Skill: .grok/skills/ai-engineering-loop/SKILL.md');
  }

  const claudeSkill = path.join(CWD, '.claude', 'skills', 'ai-engineering-loop', 'SKILL.md');
  const claudeAgent = path.join(CWD, '.claude', 'agents', 'devil-advocate.md');
  if (fs.existsSync(claudeSkill) || fs.existsSync(claudeAgent)) {
    console.log('------------------------------------------------------------');
    log.bold('Claude Code host:');
    console.log('- Subagent tool: Task (or Agent). Keys allowed: subagent_type, description, prompt');
    console.log('- Devil\'s Advocate: Task subagent_type=devil-advocate');
    console.log('- Judge: Task subagent_type=judge (sibling, not nested)');
    console.log('- Do not pass spawn_subagent, capability_mode, isolation, resume_from (Kiro 400 REQUEST_BODY_INVALID)');
    console.log('- Skill: .claude/skills/ai-engineering-loop/SKILL.md');
  }

  const agAgent = path.join(CWD, '.agents', 'judge.md');
  if (fs.existsSync(agAgent)) {
    console.log('------------------------------------------------------------');
    log.bold('Antigravity host:');
    console.log('- Subagent: invoke_subagent or Task; wait; never browser_subagent');
    console.log('- Devil\'s Advocate: 8 tool calls, diff file, skip css');
    console.log('- Judge: 4 tool calls, ledger + contract only');
    console.log('- Workflow: .agents/workflows/ai-engineering-loop.md');
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
      const perRunLimit = argValue('--per-run-token-limit');
      const dailyLimit = argValue('--daily-token-limit');
      if (mode != null) changes.defaultMode = normalizeMode(mode);
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
    } else if (action === 'record') {
      result = recordTokenUsage(CWD, {
        runId,
        nodeId,
        inputTokens: parseNonNegativeIntegerArg('--input', argValue('--input')),
        outputTokens: parseNonNegativeIntegerArg('--output', argValue('--output')),
        model: argValue('--model')
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

function handleGate() {
  const gate = process.argv[3];
  const runId = argValue('--run');
  const json = process.argv.includes('--json');
  try {
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
    const run = target.workflow
      ? applyWorkflowGate(CWD, gate, { runId: target.runId }).run
      : applyGate(CWD, gate, { runId: target.runId });
    appendRunLifecycle(CWD, target.runId, {
      type: run.state === 'DELIVERED' || run.state === 'REPORTED' ? 'RUN_COMPLETED' : 'NODE_COMPLETED',
      ...(lifecycleNode ? { nodeId: lifecycleNode.id } : {}),
      phase: gate,
      actor: 'agent',
      message: `${lifecycleNode?.displayName || gate} completed`
    });
    if (json) {
      console.log(JSON.stringify({
        ok: true,
        runId: run.runId,
        state: run.state,
        iteration: run.iteration,
        gate
      }));
    } else {
      log.success(`✓ ${gate} gate passed`);
      console.log(`- Run: ${run.runId}`);
      console.log(`- State: ${run.state}, iteration ${run.iteration}`);
    }
  } catch (err) {
    if (json) {
      console.log(JSON.stringify({
        ok: false,
        code: err.code || 'GATE_FAILED',
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
  const json = process.argv.includes('--json');
  const files = commandFiles(4, ['--run']);
  try {
    const result = createContextPack(CWD, { runId, stage, files });
    const summary = contextPackSummary(result);
    if (json) {
      console.log(JSON.stringify({ ok: true, ...summary }));
    } else {
      log.success(`✓ ${stage} context pack created`);
      console.log(`- Path: ${summary.path}`);
      console.log(`- Files: ${summary.files}, estimated tokens: ${summary.estimatedTokens}`);
      console.log(`- Redactions: ${summary.redactions}, truncated files: ${summary.truncatedFiles}`);
    }
  } catch (err) {
    if (json) {
      console.log(JSON.stringify({ ok: false, code: err.code || 'UNSAFE_CONTEXT', error: err.message }));
    } else {
      log.error(err.message);
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
    }
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, code: err.code || 'STATE_FAILED', error: err.message }));
    else log.error(err.message);
    process.exit(1);
  }
}

function handleDoctor() {
  const json = process.argv.includes('--json');
  const result = runDoctor(path.join(__dirname, '..'));
  if (json) console.log(JSON.stringify(result));
  else {
    console.log(`AI Engineering Loop doctor: ${result.ok ? 'READY' : 'NOT READY'}`);
    for (const check of result.checks) {
      console.log(`${check.passed ? '✓' : '✗'} ${check.id}: ${check.detail}`);
    }
  }
  if (!result.ok) process.exit(1);
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
    const error = new Error('goal draft requires --file <json>');
    error.code = 'INVALID_USAGE';
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

function handleGoal() {
  const action = args[1] || 'show';
  try {
    const runId = requiredRunId('goal');
    let result;
    if (action === 'show') {
      result = loadGoalDraft(CWD, runId);
    } else if (action === 'draft') {
      appendRunLifecycle(CWD, runId, {
        type: 'GOAL_DRAFTING',
        phase: 'goal',
        actor: argValue('--by') || 'agent',
        message: argValue('--message') || 'Updating the Goal draft'
      });
      result = saveGoalDraft(CWD, runId, readBoundedJsonInput(argValue('--file')), {
        actor: argValue('--by') || 'agent',
        expectedRevision: requiredIntegerArg('--revision')
      });
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
    } else if (action === 'freeze') {
      const expectedHash = argValue('--hash');
      if (!expectedHash) {
        const error = new Error('--hash is required');
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
        actor: argValue('--by') || 'human',
        expectedRevision: requiredIntegerArg('--revision'),
        expectedHash
      });
      appendRunLifecycle(CWD, runId, {
        type: 'NODE_COMPLETED',
        ...(goalNode ? { nodeId: goalNode.id } : {}),
        phase: 'goal',
        actor: argValue('--by') || 'human',
        message: 'Goal Contract frozen'
      });
    } else {
      const error = new Error('goal must be show, draft, or freeze');
      error.code = 'INVALID_USAGE';
      throw error;
    }
    console.log(JSON.stringify({ ok: true, runId, [action === 'show' ? 'draft' : 'result']: result }, null, 2));
  } catch (error) {
    log.error(`${error.code || 'GOAL_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
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
      message: argValue('--message') || 'Agent is working'
    });
    console.log(JSON.stringify({ ok: true, event, presence: runAgentPresence(CWD, runId) }, null, 2));
  } catch (error) {
    log.error(`${error.code || 'ACTIVITY_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}

function handleStudio() {
  const requestedPort = argValue('--port');
  const port = requestedPort == null ? 4317 : Number(requestedPort);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    log.error('--port must be an integer from 0 to 65535');
    process.exitCode = 1;
    return;
  }
  const { server, token } = createStudioServer(CWD);
  server.on('error', (error) => {
    log.error(`Unable to start Studio: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/?token=${token}`;
    log.success('✓ Workflow Studio is running locally');
    console.log(url);
    console.log('Press Ctrl+C to stop. The session token is valid only for this process.');
    if (!process.argv.includes('--no-open')) openStudio(url);
  });
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

// Help Menu
function printHelp() {
  console.log(`
AI Engineering Loop CLI (v${VERSION})
A reusable, framework-agnostic AI Engineering Operating System.

Usage:
  npx ai-engineering-loop <command>

Commands:
  init         Bootstrap .ai-engineering-loop/ context from repository discovery
  status       Check the validity, readiness, and baseline freshness of context
  refresh      Reconcile drifted context against repository non-destructively
  run [task]   Start or resume a stateful engineering run, sync hosts, and instruct the agent
               --new  start a new run even when another run is active
               --mode report-only|assisted|unattended
               --recipe <id>  bind an immutable compiled workflow plan
  state        Inspect the current run ledger
               --run <id>  target a non-current run
               --json      print the complete machine-readable ledger
  gate <name>  Validate an artifact and advance the current run
               goal | report | maker | verification | review | judge | delivery
               --run <id>  target a non-current run
               --json      print machine-readable gate output
  goal         Share one revision-bound Goal draft between the Agent and Studio
               show [--run <id>]
               draft --file <json> --revision <n> [--run <id>] [--by <agent>]
               freeze --revision <n> --hash <sha256> [--run <id>] [--by <name>]
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
                   [--per-run-token-limit <n>] [--daily-token-limit <n>]
  budget       Enforce actual provider-reported token usage and emergency pause
               status [--run <id>] [--node <id>] [--estimate <n>] [--json]
               record --input <n> --output <n> --model <id> [--run <id>] [--node <id>]
               pause | resume
  sandbox      Isolate Maker changes in a locked disposable Git worktree
               create | capture | abort | status [--run <id>] [--json]
  context <stage> <files...>
               Build a bounded, redacted context pack for maker, devil-advocate, or judge
               --run <id>  target a non-current run
               --json      print only pack metadata; never print packed content
  eval         Validate the 20-case production evaluation catalog
               --results <dir>  score host-generated JSON results
               --cases <dir>    use another compatible fixture catalog
               --json           print machine-readable metrics
  escalation   Compute the minimum Judge model tier from deterministic risk signals
               --run <id>  target a non-current run
               --json      print machine-readable reasons
  doctor       Check runtime, schemas, host assets, package contents, and eval catalog
               --json      print machine-readable diagnostics
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
  studio       Open the localhost-only visual workflow editor
               [--port <0-65535>] [--no-open]
  handoff      Export or verify a redacted, integrity-bound knowledge transfer
               create [--run <id>] [--audience developer|agent|auditor]
                      [--output <repository-relative-file>|-] [--json]
               inspect | brief <repository-relative-file> [--json]
  sync-hosts   Copy package skills/agents/commands into ~/.claude ~/.grok ~/.gemini ~/.agents
               (only hosts that already exist; DOT skills only if already installed)
               --dry-run  print the plan without writing
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

// CLI Router
const args = process.argv.slice(2);
const command = args[0] || 'init';

switch (command) {
  case 'init':
    handleInit();
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
  case 'sandbox':
    handleSandbox();
    break;
  case 'context':
    handleContext();
    break;
  case 'eval':
    handleEval();
    break;
  case 'escalation':
    handleEscalation();
    break;
  case 'doctor':
    handleDoctor();
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
  default:
    if (command && command !== '-h' && command !== '--help') {
      log.error(`Unknown command: ${command}`);
    }
    printHelp();
    break;
}
