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
  hostSkillStatus,
  formatHostSyncReport
} = require('../lib/sync-hosts.js');
const { listDocs, readDoc } = require('../lib/docs.js');
const {
  wantsCommandHelp,
  unknownWriterArgs,
  commandHelp
} = require('../lib/cli-args.js');
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
} = require('../lib/gates.js');
const { initialTierState } = require('../lib/tier.js');
const {
  createContextPack,
  contextPackSummary
} = require('../lib/safe-context.js');
const {
  assessSmallTaskFastPath,
  buildContextIndex,
  createDiffHunkPack,
  queryContextIndex,
  relatedContextIndex,
  smartContextSummary
} = require('../lib/smart-context.js');
const {
  compactRun
} = require('../lib/run-compaction.js');
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
  writeVerificationSummary
} = require('../lib/verification-summary.js');
const {
  recordVerificationCommands,
  recordVerificationCommand
} = require('../lib/verification-recorder.js');
const {
  scaffoldArtifact,
  validateArtifactFile
} = require('../lib/agent-artifacts.js');
const {
  createClaimedVsRealityTemplate
} = require('../lib/claimed-vs-reality.js');
const {
  runDoctor
} = require('../lib/doctor.js');
const {
  checkForUpdate,
  detectInstallScope,
  executeUpdatePlan
} = require('../lib/update-manager.js');
const autoUpdate = require('../lib/auto-update.js');
const projectRegistry = require('../lib/project-registry.js');
const {
  assertBudgetAvailable,
  budgetStatus,
  recordTokenUsage,
  recordUsageUnavailable,
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

// Non-destructive mode (issue #37, `refresh --non-destructive`): a context file
// is overwritten only if it still matches what AEL last generated (hash in
// .ael-generated.json) or is package-owned; otherwise the new template goes to
// `<file>.ael-new` and the user's file is left alone.
// Legacy projects (no .ael-generated.json yet, decision 5 on #37): the first
// such refresh overwrites AEL-managed files directly and deletes obsolete
// AEL-managed files, after copying the old content into a snapshot under
// .ai-engineering-loop/.ael-backup/<timestamp>/. Hashes are recorded so later
// refreshes use the normal flow. Only paths this writer generates (or lists in
// OBSOLETE_CONTEXT_FILES) are touched; files written with overwrite:false
// (lessons, glossary, ...) and every other user file are left alone.
let CONTEXT_WRITE_SAFE = false;
let CONTEXT_WRITE_LEGACY = null; // { root, snapshotDir } during a legacy refresh
const CONTEXT_WRITE_REPORT = { updated: [], aelNew: [], kept: [], seen: new Set(), snapshot: [], removed: [], obsoleteKept: [] };
const PACKAGE_OWNED_CONTEXT = new Set(['metadata.json']);
// Context files older AEL versions generated and this one no longer does
// (relative to .ai-engineering-loop/). Deleted on the first legacy refresh.
const OBSOLETE_CONTEXT_FILES = Object.freeze([]);
const GENERATED_HASHES_FILE = '.ael-generated.json';

function generatedHashesPath(filePath) {
  return path.join(path.dirname(filePath), GENERATED_HASHES_FILE);
}

function readGeneratedHashes(filePath) {
  try {
    return JSON.parse(fs.readFileSync(generatedHashesPath(filePath), 'utf8'));
  } catch {
    return {};
  }
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
  hashes[path.basename(filePath)] = require('crypto').createHash('sha256').update(content).digest('hex');
  writeGeneratedHashes(filePath, hashes);
}

function sha256Text(content) {
  return require('crypto').createHash('sha256').update(content).digest('hex');
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
// (edited ones are reported and kept). Legacy flow: OBSOLETE_CONTEXT_FILES,
// snapshotted first.
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
  if (CONTEXT_WRITE_LEGACY) {
    for (const rel of OBSOLETE_CONTEXT_FILES) {
      const abs = path.resolve(root, rel);
      if (abs.startsWith(root + path.sep)) candidates.set(abs, { hash: null, dir: path.dirname(abs), name: path.basename(abs), legacy: true });
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
      if (!info.legacy && sha256Text(fs.readFileSync(abs)) !== info.hash) {
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
function statusJson() {
  const result = {
    ok: false,
    status: 'NOT_INITIALIZED',
    packageVersion: VERSION,
    project: path.basename(CWD),
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
    }
  }
  return result;
}

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
  console.log(`- Context Baseline Git: ${metadata.repositoryRevision ? metadata.repositoryRevision.slice(0, 8) : 'unknown'}`);
  console.log(`- Living Freshness: \x1b[32m${drift.status}\x1b[0m (${drift.reason})`);
  console.log(`- Context Files: ${REQUIRED_FILES.length}/${REQUIRED_FILES.length} verified (including metadata.json, glossary.md, adrs/)`);

  const hosts = hostSkillStatus({ home: homeDir(), version: VERSION });
  if (hosts.stale) {
    log.warn(`- Host skills: STALE (${hosts.staleFiles} file(s) behind package v${VERSION}${hosts.installedVersion ? `, installed v${hosts.installedVersion}` : ''})`);
    log.dim('  Run "npx ai-engineering-loop sync-hosts" (or "update apply --yes" after a package upgrade), then start a new session.');
  } else {
    console.log(`- Host skills: CURRENT (${hosts.managedFiles} managed file(s) match v${VERSION}; packs: ${hosts.packs.join(', ')})`);
  }
}

// Command: refresh
function handleRefresh() {
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
function handleRun() {
  const runJson = process.argv.includes('--json');
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
    if (runArgs[index] === '--new' || runArgs[index] === '--json') continue;
    if (['--mode', '--recipe', '--tier', '--tier-reason'].includes(runArgs[index])) {
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
  } catch (err) {
    console.log = realLog;
    if (runJson) {
      realLog(JSON.stringify({ ok: false, code: err.code || 'RUN_FAILED', error: err.message }));
      process.exit(1);
    }
    log.error(err.message);
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
      })()
    }, null, 2));
    return;
  }
  console.log(`- Run: ${runResult.run.runId} (${runResult.resumed ? 'resumed' : 'created'})`);
  if (runResult.run.tier) {
    const t = runResult.run.tier;
    console.log(`- Tier: ${t.current} (${t.source}; ${t.reasons.map((r) => r.code).join(', ')})`);
  }
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
  console.log('1. Grill if needed (docs grill-policy), then freeze a failure-table Goal Contract');
  if (runResult.run.mode === RUN_MODES.REPORT_ONLY) {
    console.log('2. Analyze evidence without changing repository files');
    console.log('3. Write report.json and finish with `ai-engineering-loop gate report`');
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
      const reviewProfile = argValue('--review-profile');
      const perRunLimit = argValue('--per-run-token-limit');
      const dailyLimit = argValue('--daily-token-limit');
      if (mode != null) changes.defaultMode = normalizeMode(mode);
      if (reviewProfile != null) changes.reviewProfile = normalizeReviewProfile(reviewProfile);
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
    throw new Error('Use scaffold <verification|findings|delivery> or validate <file>');
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
  const run = target.workflow
    ? applyWorkflowGate(CWD, gate, { runId: target.runId }).run
    : applyGate(CWD, gate, { runId: target.runId });
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

// `gate maker --from-git` (issue #35): write the working-tree diff (tracked and
// untracked files, excluding .ai-engineering-loop/) to RUN_DIR/diff.patch so the
// agent does not need a separate write step. ASSISTED/REPORT_ONLY only;
// UNATTENDED diffs come from `sandbox capture`.
function captureMakerDiff(run) {
  if (run.mode === 'UNATTENDED') throw new Error('--from-git is not allowed in UNATTENDED; use `sandbox capture`.');
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
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', '.', exclude]).split('\0').filter(Boolean);
  for (const file of untracked) diff += git(['diff', '--binary', '--no-index', '--', '/dev/null', file], true);
  if (!diff.trim()) throw new Error('--from-git found no changes against HEAD.');
  const target = path.join(CWD, '.ai-engineering-loop', 'runs', run.runId, 'diff.patch');
  fs.writeFileSync(target, diff);
  return { path: path.relative(CWD, target).split(path.sep).join('/'), files: untracked.length };
}

function handleGate() {
  const gate = process.argv[3];
  const runId = argValue('--run');
  const json = process.argv.includes('--json');
  let targetRunId = runId;
  try {
    const target = runId ? loadRun(CWD, runId) : getCurrentRun(CWD);
    if (!target) throw new Error('No current run. Start one with `ai-engineering-loop run`.');
    targetRunId = target.runId;
    if (process.argv.includes('--from-git')) {
      if (gate !== 'maker') throw new Error('--from-git only applies to `gate maker`.');
      captureMakerDiff(target);
    }
    const run = executeGate(gate, target.runId);
    const judge = gate === 'review' && run.tier ? judgeRequirement(CWD, run) : null;
    if (json) {
      console.log(JSON.stringify({
        ok: true,
        runId: run.runId,
        state: run.state,
        iteration: run.iteration,
        gate,
        ...(run.tier ? { tier: run.tier.current } : {}),
        ...(judge ? { judgeRequired: judge.required, judgeReasons: judge.reasons } : {})
      }));
    } else {
      log.success(`✓ ${gate} gate passed`);
      console.log(`- Run: ${run.runId}`);
      console.log(`- State: ${run.state}, iteration ${run.iteration}`);
      if (run.tier) console.log(`- Tier: ${run.tier.current}`);
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
        details
      }));
    } else {
      log.error(err.message);
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
  out({ ok: true, policy: policy.policy, policySource: policy.source, scope, offline: cache.error || null, decision, result });
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
      for (const p of result.projects) console.log(`- ${p.path} (context ${p.contextVersion || '?'}, seen ${p.lastSeen})`);
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
        actor: argValue('--by') || 'human',
        expectedRevision: latest ? latestDraft.metadata.revision : requiredIntegerArg('--revision'),
        expectedHash
      });
      appendRunLifecycle(CWD, runId, {
        type: goalNode ? 'NODE_COMPLETED' : 'GOAL_FROZEN',
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
    console.log(JSON.stringify({ ok: false, code: err.code || code, error: err.message, details: err.details || [] }));
  } else {
    log.error(err.message);
    for (const detail of err.details || []) console.error(`- ${detail}`);
  }
  process.exit(1);
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

async function handleVerify() {
  const json = process.argv.includes('--json');
  try {
    const runId = requiredRunId('verify');
    const shell = process.argv.includes('--shell');
    let texts = repeatedArg('--cmd');
    if (texts.length === 0) {
      const fallback = defaultVerificationCommand();
      if (!fallback) throw Object.assign(new Error('No --cmd given and no test_unit command in .ai-engineering-loop/verification.md'), { code: 'INVALID_COMMAND' });
      texts = [fallback];
    }
    const timeoutValue = argValue('--timeout-ms');
    const recorded = await recordVerificationCommands(CWD, {
      runId,
      commands: texts.map((text) => splitCommand(text, shell)),
      serial: process.argv.includes('--serial'),
      ...(timeoutValue == null ? {} : { timeoutMs: parsePositiveIntegerArg('--timeout-ms', timeoutValue) })
    });
    const commands = recorded.commands.map((c) => ({ command: c.command, exitCode: c.exitCode, timeoutStatus: c.timeoutStatus }));
    if (!recorded.passed) {
      autoHeartbeat(runId, 'verification', 'Verification failed; Maker must fix before review');
      const result = { ok: false, code: 'VERIFICATION_FAILED', runId, commands, gate: null };
      if (json) console.log(JSON.stringify(result));
      else {
        log.error('Verification failed; the gate was not attempted.');
        for (const c of commands) console.log(`- ${c.command}: exit ${c.exitCode} (${c.timeoutStatus})`);
      }
      process.exitCode = 1;
      return;
    }
    const run = executeGate('verification', runId);
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
      compact: compact.paths,
      claimedVsReality: claimed,
      next: run.tier && run.tier.current === 'T0'
        ? 'Fill claimed-vs-reality, then gate review and gate judge'
        : 'Fill claimed-vs-reality, then review-pack and spawn the Devil\'s Advocate'
    };
    if (json) console.log(JSON.stringify(result));
    else {
      log.success('✓ verification recorded and gated');
      for (const c of commands) console.log(`- ${c.command}: exit ${c.exitCode}`);
      console.log(`- State: ${run.state}`);
      console.log(`- Claimed-vs-reality: ${claimed.path}${claimed.created ? ' (scaffolded; fill it from the command output)' : ''}`);
      console.log(`- Next: ${result.next}`);
    }
  } catch (err) {
    stageJsonError(err, json, 'VERIFY_FAILED');
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
      fastPath: { eligible: fastPath.eligible, reasons: fastPath.reasons },
      escalation: { requiredTier: escalation.requiredTier, reasons: escalation.reasons.map((r) => r.code) }
    };
    if (json) console.log(JSON.stringify(result));
    else {
      log.success('✓ review pack ready');
      console.log(`- Pack: ${result.packPath} (${result.reviewProfile}, ~${result.estimatedTokens} tokens)`);
      console.log(`- Tier: ${tier || 'none'}; Devil's Advocate ${result.devilAdvocateRequired ? 'required' : 'not used (T0)'}`);
      console.log(`- Judge tier floor: ${result.escalation.requiredTier}${result.escalation.reasons.length ? ` (${result.escalation.reasons.join(', ')})` : ''}`);
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
      console.error('ASSISTED delivery needs the human\'s explicit approval: deliver --approve --by <name>. Nothing was written.');
      process.exit(2);
    }
    if (approve && !by) {
      throw Object.assign(new Error('--approve requires --by <name> (the approving human).'), { code: 'INVALID_USAGE' });
    }
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
    delivery = {
      ...(delivery || {}),
      schemaVersion: 1,
      runId,
      ...(destination ? { destination } : {}),
      ...(summary ? { summary } : {}),
      ...(approve ? { humanApproved: true, approvedBy: by } : {})
    };
    fs.writeFileSync(deliveryPath, `${JSON.stringify(delivery, null, 2)}\n`, { mode: 0o600 });
    const next = executeGate('delivery', runId);
    const result = { ok: true, runId, state: next.state, approvedNodes: approved, humanApproved: delivery.humanApproved === true };
    if (json) console.log(JSON.stringify(result));
    else {
      log.success('✓ delivery gate passed');
      console.log(`- State: ${next.state}`);
      if (approved.length) console.log(`- Approved: ${approved.join(', ')} by ${by}`);
    }
  } catch (err) {
    stageJsonError(err, json, 'DELIVER_FAILED');
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
               --json  print context and host-skill freshness as JSON (no writes)
  refresh      Reconcile drifted context against repository non-destructively
  run [task]   Start or resume a stateful engineering run and instruct the agent (never writes to home)
               --new  start a new run even when another run is active
               --mode report-only|assisted|unattended
               --recipe <id>  bind an immutable compiled workflow plan
               --tier T0|T1|T2 --tier-reason <text>  override the automatic tier (recorded)
               --json  print runId, tier, tier reasons, and subagent count only
  state        Inspect the current run ledger
               --run <id>  target a non-current run
               --json      print the complete machine-readable ledger
  gate <name>  Validate an artifact and advance the current run (maker: --from-git writes diff.patch first)
               goal | report | maker | verification | review | judge | delivery
               --run <id>  target a non-current run
               --json      print machine-readable gate output
  goal         Share one revision-bound Goal draft between the Agent and Studio
               show [--run <id>]
               draft --file <json> --revision <n> [--run <id>] [--by <agent>]
               freeze --revision <n> --hash <sha256> [--run <id>] [--by <name>]
               freeze --latest [--run <id>] --by <name>   freeze the newest draft (CLI resolves revision/hash)
  verification Summarize verification.json for compact Judge context
               summarize [--run <id>] [--json]
               record [--run <id>] [--timeout-ms <n>] [--shell] [--json] -- <executable> [args...]
                 Captures bounded, redacted output; updates verification.json and its summary
                 --shell opts into a shell; pass one quoted command string, e.g. -- "npm test"
  scaffold     Create a private, deliberately incomplete stage-artifact template
               verification | findings | delivery [--run <id>] [--json]
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
  eval         Validate the 24-case production evaluation catalog
               --results <dir>  score host-generated JSON results
               --cases <dir>    use another compatible fixture catalog
               --json           print machine-readable metrics
  escalation   Compute the minimum Judge model tier from deterministic risk signals
               --run <id>  target a non-current run
               --json      print machine-readable reasons
  verify       Record verification commands, gate them, compact, and scaffold claimed-vs-reality
               [--run <id>] [--cmd "<command>"]... [--shell] [--serial] [--timeout-ms <n>] [--json]
               default command: test_unit from .ai-engineering-loop/verification.md; commands run in parallel
  review-pack  Build the Devil's Advocate pack: fast-path, diff hunks, escalation floor, tier
               [--run <id>] [--base <git-ref>] [--profile lean|standard|thorough] [--json]
  deliver      Approve READY approval nodes, write delivery.json, and pass the delivery gate
               [--run <id>] [--destination <where> --summary <text>] [--approve --by <name>] [--json]
               ASSISTED requires --approve --by <name>, given only after explicit human approval
  docs         Print a packaged spec without needing the package source tree
               list [--json]
               <name> [--section <heading>] [--json]   e.g. docs grill-policy --section "When to grill"
  doctor       Check runtime, schemas, host assets, package contents, and eval catalog
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
               --dry-run       print the plan without writing
               --pack <list>   core (always), backend, design, quality; saved for later syncs
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

// CLI Router
const args = process.argv.slice(2);
const command = args[0] || 'init';

// Side-effect guard (issue #25): help never executes a command, and writer
// commands reject unknown flags before touching any file.
if (!['-h', '--help', '-v', '--version'].includes(command)) {
  if (wantsCommandHelp(command, args.slice(1))) {
    const block = commandHelp(helpText(), command);
    console.log(block
      ? `Usage: npx ai-engineering-loop ${block.trim()}`
      : helpText());
    process.exit(0);
  }
  const unknown = unknownWriterArgs(command, args.slice(1));
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
  case 'escalation':
    handleEscalation();
    break;
  case 'docs':
    handleDocs();
    break;
  case 'verify':
    handleVerify();
    break;
  case 'review-pack':
    handleReviewPack();
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
