'use strict';

const fs = require('fs');
const path = require('path');
const { loadEvaluationCases } = require('./evaluation.js');
const { loadBenchScenarios } = require('./bench.js');
const { auditPackage } = require('./package-audit.js');
const { listRecipes, loadRecipe, validateRecipe } = require('./recipe.js');
const { checkAdapter } = require('./adapter-check.js');

const REQUIRED_HOST_ASSETS = [
  'adapters/project-onboarding/SKILL.md',
  'adapters/quality/skills/ael-code-simplifier/SKILL.md',
  'adapters/spec/skills/ael-spec/SKILL.md',
  '.claude/agents/devil-advocate.md',
  '.claude/agents/judge.md',
  '.grok/agents/devil-advocate.md',
  '.grok/agents/judge.md',
  '.agents/skills/ael/SKILL.md',
  '.agents/skills/ael/references/loop-hosts.md',
  '.agents/skills/backend-development/SKILL.md',
  '.agents/skills/emil-design-eng/SKILL.md',
  '.agents/skills/animate/SKILL.md',
  '.agents/skills/review-animations/SKILL.md',
  'agents/shared/devil-advocate.body.md',
  'agents/shared/judge.body.md',
  'agents/instruction-only/AGENTS.md'
];

const REQUIRED_SCHEMAS = [
  'goal-contract.schema.json',
  'verification.schema.json',
  'finding-ledger.schema.json',
  'verdict.schema.json',
  'delivery.schema.json',
  'report.schema.json',
  'recipe.schema.json',
  'node-definition.schema.json',
  'compiled-plan.schema.json',
  'workflow-state.schema.json',
  'workflow-event.schema.json',
  'handoff.schema.json',
  'impact-map.schema.json',
  'receipt.schema.json',
  'learnings.schema.json',
  'bench-scenario.schema.json',
  'bench-result.schema.json'
];

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function machineChecks(rootDir, { projectDir, hostSkills = null, run } = {}) {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push(check('node-version', nodeMajor >= 18, nodeMajor >= 18 ? `Node ${process.versions.node}` : `Node ${process.versions.node}; required >=18. FIX: install Node 18 or newer (https://nodejs.org or \`mise use node@20\`).`));
  const { gitReadiness } = require('./git-readiness.js');
  const git = gitReadiness(projectDir || process.cwd());
  if (git.code === 'GIT_MISSING') checks.push(check('git', false, `${git.message}. FIX: ${git.fix}`));
  else if (!git.ok) checks.push({ ...check('git', false, `${git.message}. FIX: ${git.fix}`), level: git.code === 'GIT_NOT_A_REPO' ? 'warn' : undefined });
  else checks.push(check('git', true, 'git installed, repository has a commit'));
  for (const warning of git.warnings || []) checks.push({ ...check('git-identity', false, warning), level: 'warn' });
  if (git.ok && !(git.warnings || []).length) checks.push(check('git-identity', true, 'user.name and user.email set'));
  if (hostSkills) {
    checks.push(hostSkills.installed
      ? check('agent-skill', !hostSkills.stale, hostSkills.stale ? `${hostSkills.staleFiles} skill file(s) behind. FIX: \`ael sync-hosts\`, then start a new agent session.` : 'ael skill installed and current')
      : { ...check('agent-skill', false, 'no coding agent on this machine has the ael skill. FIX: `ael setup`, then start a new agent session.'), level: 'warn' });
    if (hostSkills.installed && hostSkills.stale) checks[checks.length - 1].level = 'warn';
  }
  if (projectDir && fs.existsSync(path.join(projectDir, '.ai-engineering-loop'))) {
    checks.push(...checkAdapter(projectDir, { packageRoot: rootDir, ...(run ? { run } : {}) }));
  } else if (projectDir) {
    checks.push({ ...check('project', false, 'no .ai-engineering-loop/ here. FIX: `ael init` in your project.'), level: 'warn' });
  }
  return { ok: checks.every((item) => item.passed || item.level === 'warn'), checks };
}

function runDoctor(rootDir = path.join(__dirname, '..'), { projectDir = null, run } = {}) {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push(check('node-version', nodeMajor >= 18, `Node ${process.versions.node}; required >=18`));

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    checks.push(check('package-json', true, `${pkg.name}@${pkg.version}`));
  } catch (cause) {
    checks.push(check('package-json', false, cause.message));
    pkg = {};
  }

  const missingHosts = REQUIRED_HOST_ASSETS.filter((file) => !fs.existsSync(path.join(rootDir, file)));
  checks.push(check(
    'host-assets',
    missingHosts.length === 0,
    missingHosts.length ? `missing: ${missingHosts.join(', ')}` : `${REQUIRED_HOST_ASSETS.length} required assets present`
  ));

  const schemaErrors = [];
  for (const file of REQUIRED_SCHEMAS) {
    try {
      JSON.parse(fs.readFileSync(path.join(rootDir, 'schemas', file), 'utf8'));
    } catch (cause) {
      schemaErrors.push(`${file}: ${cause.message}`);
    }
  }
  checks.push(check(
    'artifact-schemas',
    schemaErrors.length === 0,
    schemaErrors.length ? schemaErrors.join('; ') : `${REQUIRED_SCHEMAS.length} schemas parse`
  ));

  try {
    const recipes = listRecipes(rootDir).filter(({ source }) => source === 'builtin');
    const recipeErrors = recipes.flatMap(({ id }) => {
      const { recipe } = loadRecipe(rootDir, id);
      return recipe.compatibleModes.flatMap((mode) => (
        validateRecipe(recipe, { mode }).errors.map((error) => `${id} (${mode}): ${error}`)
      ));
    });
    checks.push(check(
      'workflow-recipes',
      recipes.length > 0 && recipeErrors.length === 0,
      recipeErrors.length ? recipeErrors.join('; ') : `${recipes.length} built-in recipes validate`
    ));
  } catch (cause) {
    checks.push(check('workflow-recipes', false, cause.message));
  }

  try {
    const fixtures = loadEvaluationCases(path.join(rootDir, 'evals', 'cases'));
    checks.push(check('evaluation-catalog', fixtures.length === 25, `${fixtures.length} valid cases; required 25`));
  } catch (cause) {
    checks.push(check('evaluation-catalog', false, cause.message));
  }

  try {
    const scenarios = loadBenchScenarios(path.join(rootDir, 'evals', 'scenarios'));
    const trapCount = scenarios.filter((item) => (item.traps || []).length > 0).length;
    checks.push(check(
      'bench-catalog',
      scenarios.length >= 6 && scenarios.length <= 8 && trapCount >= 2,
      `${scenarios.length} bench scenarios; ${trapCount} with traps`
    ));
  } catch (cause) {
    checks.push(check('bench-catalog', false, cause.message));
  }

  const packageFiles = new Set(pkg.files || []);
  const requiredPackageEntries = ['bin/', 'lib/', 'core/', 'policies/', 'recipes/', 'schemas/', 'evals/', 'studio/app/', 'studio/diners.json'];
  const missingPackageEntries = requiredPackageEntries.filter((entry) => !packageFiles.has(entry));
  checks.push(check(
    'package-assets',
    missingPackageEntries.length === 0,
    missingPackageEntries.length ? `not packed: ${missingPackageEntries.join(', ')}` : 'runtime assets are allowlisted'
  ));

  try {
    const audit = auditPackage(rootDir);
    checks.push(check(
      'package-privacy',
      audit.ok,
      audit.ok ? `${audit.filesScanned} packaged files scanned` : audit.findings.map((item) => `${item.file}: ${item.reason}`).join('; ')
    ));
  } catch (cause) {
    checks.push(check('package-privacy', false, cause.message));
  }

  const binPath = path.join(rootDir, 'bin', 'ai-engineering-loop.js');
  const executable = fs.existsSync(binPath) &&
    (process.platform === 'win32' || (fs.statSync(binPath).mode & 0o111) !== 0);
  checks.push(check('cli-executable', executable, executable ? 'CLI is executable' : 'CLI executable bit is missing'));

  // Project adapter (#63): only where a project has been initialized.
  if (projectDir && fs.existsSync(path.join(projectDir, '.ai-engineering-loop'))) {
    checks.push(...checkAdapter(projectDir, { packageRoot: rootDir, ...(run ? { run } : {}) }));
  }

  return {
    ok: checks.every((item) => item.passed || item.level === 'warn'),
    checks
  };
}

module.exports = {
  REQUIRED_HOST_ASSETS,
  REQUIRED_SCHEMAS,
  machineChecks,
  runDoctor
};
