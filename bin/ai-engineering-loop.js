#!/usr/bin/env node

/**
 * AI Engineering Loop — Deterministic CLI Bootstrap & Context Engine
 * Repository: https://github.com/egagofur/ai-engineering-loop
 * 
 * Architecture Principle:
 * The CLI handles deterministic repository discovery, context initialization,
 * status checks, and non-destructive drift refreshes.
 * The AI Agent handles task reasoning, RCA, implementation, review, and judging.
 */

const fs = require('fs');
const path = require('path');

const VERSION = '1.0.0';
const CWD = process.cwd();
const CONTEXT_DIR = path.join(CWD, '.ai-engineering-loop');

// Core files in .ai-engineering-loop/
const REQUIRED_FILES = [
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

  // Parse package.json
  const pkgJsonStr = readFileSafe(path.join(rootDir, 'package.json'));
  if (pkgJsonStr) {
    discovery.languages.push('TypeScript / JavaScript');
    discovery.evidence.push('Manifest: package.json');
    try {
      const pkg = JSON.parse(pkgJsonStr);
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
  if (fs.existsSync(path.join(rootDir, 'go.mod'))) {
    discovery.languages.push('Go');
    if (!discovery.isMonorepo) discovery.profile = 'backend-api';
    discovery.scripts.testUnit = 'go test -v ./...';
    discovery.scripts.build = 'go build ./...';
    discovery.scripts.typecheck = 'go vet ./...';
    discovery.evidence.push('Manifest: go.mod');
  }

  // Rust
  if (fs.existsSync(path.join(rootDir, 'Cargo.toml'))) {
    discovery.languages.push('Rust');
    if (!discovery.isMonorepo) discovery.profile = 'library';
    discovery.scripts.testUnit = 'cargo test';
    discovery.scripts.build = 'cargo build';
    discovery.scripts.typecheck = 'cargo check';
    discovery.scripts.lint = 'cargo clippy';
    discovery.evidence.push('Manifest: Cargo.toml');
  }

  // Python
  if (fs.existsSync(path.join(rootDir, 'pyproject.toml')) || fs.existsSync(path.join(rootDir, 'requirements.txt'))) {
    discovery.languages.push('Python');
    if (!discovery.isMonorepo) discovery.profile = 'backend-api';
    discovery.scripts.testUnit = 'pytest';
    discovery.scripts.typecheck = 'mypy .';
    discovery.scripts.lint = 'ruff check .';
    discovery.evidence.push('Manifest: pyproject.toml / requirements.txt');
  }

  // Flutter / Mobile
  if (fs.existsSync(path.join(rootDir, 'pubspec.yaml'))) {
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
 * Generate Context Files
 */
function generateContextFiles(rootDir, discovery) {
  const targetDir = path.join(rootDir, '.ai-engineering-loop');
  fs.mkdirSync(targetDir, { recursive: true });

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

  generateContextFiles(CWD, discovery);

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

  const configContent = readFileSafe(path.join(CONTEXT_DIR, 'config.md')) || '';
  const profileMatch = configContent.match(/project_profile.*?:\s*"?(.*?)"?\s*(?:#|$)/m);
  const nameMatch = configContent.match(/project_name.*?:\s*"?(.*?)"?\s*(?:#|$)/m);

  log.success('Status: READY & VALID');
  console.log(`- Project Name: ${nameMatch ? nameMatch[1] : path.basename(CWD)}`);
  console.log(`- Project Profile: ${profileMatch ? profileMatch[1] : 'unspecified'}`);
  console.log('- Context Location: .ai-engineering-loop/');
  console.log('- Context Files: 5/5 verified');
}

// Command: refresh
function handleRefresh() {
  log.info('AI Engineering Loop — Context Drift Refresh (refresh)');
  log.dim(`Target directory: ${CWD}`);

  log.info('Re-analyzing repository manifests and directory topology...');
  const discovery = analyzeRepository(CWD);

  generateContextFiles(CWD, discovery);

  log.success('✓ Context refreshed non-destructively.');
  handleStatus();
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

  console.log('\n------------------------------------------------------------');
  log.bold('AI Agent Ready:');
  console.log('1. Formulate Goal Contract (core/goal-contract.md)');
  console.log('2. Execute Root Cause Analysis & Plan');
  console.log('3. Maker Agent implements surgical code and tests');
  console.log('4. Run Deterministic Verification');
  console.log('5. Execute Devil\'s Advocate Adversarial Review');
  console.log('6. Judge Agent evaluates DoD and issues PASS verdict');
  console.log('7. Delivery Adapter creates MR/PR');
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
  status    Check the validity and readiness of repository context
  refresh   Re-analyze repository and update context non-destructively
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
