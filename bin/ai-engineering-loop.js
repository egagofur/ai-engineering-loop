#!/usr/bin/env node

/**
 * AI Engineering Loop — Project Context Initializer CLI
 * Repository: https://github.com/egagofur/ai-engineering-loop
 */

const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const targetDir = path.join(cwd, '.ai-engineering-loop');

console.log('\x1b[36m%s\x1b[0m', 'AI Engineering Loop — Project Context Discovery');
console.log('Working Directory:', cwd);

if (fs.existsSync(targetDir)) {
  console.log('\x1b[32m%s\x1b[0m', '✓ .ai-engineering-loop/ already exists in this repository.');
  console.log('Loading existing configuration...\n');
  const configPath = path.join(targetDir, 'config.md');
  if (fs.existsSync(configPath)) {
    console.log(fs.readFileSync(configPath, 'utf8'));
  }
  process.exit(0);
}

console.log('\x1b[33m%s\x1b[0m', 'Analyzing repository topology and manifests...');

// 1. Detect topology
const hasApps = fs.existsSync(path.join(cwd, 'apps'));
const hasPackages = fs.existsSync(path.join(cwd, 'packages'));
const hasPnpmWorkspace = fs.existsSync(path.join(cwd, 'pnpm-workspace.yaml'));
const hasTurbo = fs.existsSync(path.join(cwd, 'turbo.json'));

let isMonorepo = hasPnpmWorkspace || hasTurbo || (hasApps && hasPackages);
let profile = isMonorepo ? 'monorepo' : 'backend-api';

// 2. Detect manifests & languages
let languages = [];
let frameworks = [];
let pkgManager = 'npm';

if (fs.existsSync(path.join(cwd, 'package.json'))) {
  languages.push('TypeScript / JavaScript');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (allDeps['next']) { frameworks.push('Next.js'); if (!isMonorepo) profile = 'web-app'; }
    if (allDeps['react']) { frameworks.push('React'); if (!isMonorepo) profile = 'web-app'; }
    if (allDeps['vue']) { frameworks.push('Vue'); if (!isMonorepo) profile = 'web-app'; }
    if (allDeps['@nestjs/core']) { frameworks.push('NestJS'); if (!isMonorepo) profile = 'backend-api'; }
    if (allDeps['express']) { frameworks.push('Express'); if (!isMonorepo) profile = 'backend-api'; }
  } catch (e) {}
}

if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) pkgManager = 'pnpm';
else if (fs.existsSync(path.join(cwd, 'yarn.lock'))) pkgManager = 'yarn';
else if (fs.existsSync(path.join(cwd, 'bun.lockb'))) pkgManager = 'bun';

if (fs.existsSync(path.join(cwd, 'go.mod'))) {
  languages.push('Go');
  if (!isMonorepo) profile = 'backend-api';
}
if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
  languages.push('Rust');
}
if (fs.existsSync(path.join(cwd, 'pubspec.yaml'))) {
  languages.push('Dart / Flutter');
  profile = 'mobile-app';
}
if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'requirements.txt'))) {
  languages.push('Python');
  if (!isMonorepo) profile = 'backend-api';
}

const projectName = path.basename(cwd);

console.log(`Detected Profile: ${profile}`);
console.log(`Languages: ${languages.join(', ') || 'Unknown'}`);
console.log(`Package Manager: ${pkgManager}`);

// Create .ai-engineering-loop directory
fs.mkdirSync(targetDir, { recursive: true });

// 1. config.md
const configContent = `# Project Configuration

## Metadata
- **project_name**: "${projectName}"
- **project_profile**: "${profile}" # Archetype from profiles/${profile}.md
- **languages**:
${languages.map(l => `  - ${l}`).join('\n') || '  - Unspecified'}
- **frameworks**:
${frameworks.map(f => `  - ${f}`).join('\n') || '  - Standard'}
- **package_manager**: "${pkgManager}"
- **default_base_branch**: "main"

## Inferred Evidence
- Generated automatically by AI Engineering Loop discovery pass.
`;
fs.writeFileSync(path.join(targetDir, 'config.md'), configContent);

// 2. architecture.md
const archContent = `# Project Architecture

## System Overview
Discovered architecture for ${projectName} (${profile}).

## Layers & Structure
- Root workspace inspection: ${isMonorepo ? 'Monorepo workspace' : 'Single application'}
- Directory structure: ${fs.readdirSync(cwd).filter(f => !f.startsWith('.')).slice(0, 10).join(', ')}

## Boundary Invariants
- Preserve existing component boundaries and module isolation.
- Zero cyclic dependencies between packages.
`;
fs.writeFileSync(path.join(targetDir, 'architecture.md'), archContent);

// 3. conventions.md
const convContent = `# Project Conventions

## Code Standards
- File naming: kebab-case or standard project convention.
- Error handling: Use domain-specific errors; zero empty catch blocks.

## Forbidden Anti-Patterns
- Zero speculative TODOs or dead code in pull requests.
- Never commit private secrets or credentials.
`;
fs.writeFileSync(path.join(targetDir, 'conventions.md'), convContent);

// 4. verification.md
const testCmd = pkgManager === 'pnpm' ? 'pnpm test' : `${pkgManager} test`;
const buildCmd = pkgManager === 'pnpm' ? 'pnpm build' : `${pkgManager} run build`;
const typeCmd = pkgManager === 'pnpm' ? 'pnpm typecheck' : 'npx tsc --noEmit';
const lintCmd = pkgManager === 'pnpm' ? 'pnpm lint' : 'npx eslint --fix';

const verifyContent = `# Project Verification Commands

## Discovered Commands
- **test_unit**: \`${testCmd}\`
- **typecheck**: \`${typeCmd}\`
- **lint**: \`${lintCmd}\`
- **build**: \`${buildCmd}\`

## Rules
- 100% deterministic checks must pass before Devil's Advocate review.
`;
fs.writeFileSync(path.join(targetDir, 'verification.md'), verifyContent);

// 5. adapter.md
const adapterContent = `# Project Delivery Adapter Configuration

## Delivery Pipeline
- **adapter_type**: "standard" # dot | github | gitlab | custom
- **default_target_branch**: "main"
`;
fs.writeFileSync(path.join(targetDir, 'adapter.md'), adapterContent);

console.log('\x1b[32m%s\x1b[0m', '\n✓ Successfully generated .ai-engineering-loop/ with:');
console.log('  - .ai-engineering-loop/config.md');
console.log('  - .ai-engineering-loop/architecture.md');
console.log('  - .ai-engineering-loop/conventions.md');
console.log('  - .ai-engineering-loop/verification.md');
console.log('  - .ai-engineering-loop/adapter.md\n');
console.log('Project context is ready! You can now formulate Goal Contracts and run the AI Engineering Loop.');
