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
const { execSync } = require('child_process');

const VERSION = '1.0.8';
const CWD = process.cwd();
const CONTEXT_DIR = path.join(CWD, '.ai-engineering-loop');

// Core files in .ai-engineering-loop/
const REQUIRED_FILES = [
  'metadata.json',
  'config.md',
  'architecture.md',
  'conventions.md',
  'verification.md',
  'adapter.md'
];

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
function generateContextFiles(rootDir, discovery, trigger = 'init', impact = 'INITIAL_BOOTSTRAP') {
  const targetDir = path.join(rootDir, '.ai-engineering-loop');
  fs.mkdirSync(targetDir, { recursive: true });

  const currentRevision = getGitRevision(rootDir);

  // 0. metadata.json (Baseline)
  const metadataJson = {
    contextVersion: '1.0.0',
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
  fs.writeFileSync(path.join(targetDir, 'metadata.json'), JSON.stringify(metadataJson, null, 2) + '\n');

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
  fs.writeFileSync(path.join(targetDir, 'config.md'), configMd);

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
  fs.writeFileSync(path.join(targetDir, 'architecture.md'), archMd);

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
  fs.writeFileSync(path.join(targetDir, 'conventions.md'), convMd);

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
  fs.writeFileSync(path.join(targetDir, 'verification.md'), verifyMd);

  // 5. adapter.md
  const adapterMd = `# Project Delivery Adapter Configuration

## Delivery Pipeline
- **adapter_type**: "${discovery.adapter.type}" # dot | github | gitlab | standard
${discovery.adapter.repoSlug ? `- **remote_repository**: "${discovery.adapter.repoSlug}"` : ''}
- **default_target_branch**: "${discovery.adapter.defaultBranch}"
- **ci_provider**: "${discovery.adapter.ciProvider}"
`;
  fs.writeFileSync(path.join(targetDir, 'adapter.md'), adapterMd);
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
    }
  }

  log.info('Analyzing repository topology and manifests...');
  const discovery = analyzeRepository(CWD);

  log.dim(`> Profile Bound: ${discovery.profile}`);
  log.dim(`> Languages: ${discovery.languages.join(', ') || 'Unspecified'}`);
  log.dim(`> Package Manager: ${discovery.packageManager}`);
  log.dim(`> Unit Test Command: ${discovery.scripts.testUnit}`);

  generateContextFiles(CWD, discovery, 'init', 'INITIAL_BOOTSTRAP');

  const validation = validateContext(CONTEXT_DIR);
  if (validation.valid) {
    log.success('\n✓ Successfully initialized .ai-engineering-loop/ with:');
    REQUIRED_FILES.forEach((f) => console.log(`  - .ai-engineering-loop/${f}`));
    log.dim('\nRecommendation: Commit .ai-engineering-loop/ to version control so team agents share context.');
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
  console.log('- Context Files: 6/6 verified (including metadata.json)');
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

  const drift = evaluateDrift(CWD, CONTEXT_DIR);
  if (drift.status === 'CURRENT') {
    log.success('✓ Context is already CURRENT. No changes required.');
    log.dim(`Reason: ${drift.reason}`);
    process.exit(0);
  }

  log.info(`Drift detected: ${drift.reason}. Reconciling context...`);
  const discovery = analyzeRepository(CWD);

  generateContextFiles(CWD, discovery, 'refresh', 'DRIFT_RECONCILIATION');

  log.success('✓ Context reconciled non-destructively.');
  handleStatus();
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

  const grok = detectGrokHost();

  console.log('\n------------------------------------------------------------');
  log.bold('AI Agent Ready:');
  console.log('1. Formulate Goal Contract (core/goal-contract.md)');
  console.log('2. Execute Root Cause Analysis & Plan');
  console.log('3. Maker Agent implements surgical code and tests');
  console.log('4. Run Deterministic Verification');
  console.log('5. Execute Devil\'s Advocate Adversarial Review');
  console.log('6. Judge Agent evaluates DoD and issues PASS verdict');
  console.log('7. Context Impact Assessment (NONE / TARGETED / MAJOR)');
  console.log('8. Delivery Adapter creates MR/PR');

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
  console.log('------------------------------------------------------------\n');
}

// Help Menu
function printHelp() {
  console.log(`
AI Engineering Loop CLI (v${VERSION})
A reusable, framework-agnostic AI Engineering Operating System.

Usage:
  npx ai-engineering-loop <command>

Commands:
  init      Bootstrap .ai-engineering-loop/ context from repository discovery
  status    Check the validity, readiness, and baseline freshness of context
  refresh   Reconcile drifted context against repository non-destructively
  run       Verify context readiness and instruct AI agent to begin loop

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
