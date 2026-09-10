'use strict';

const fs = require('fs');
const path = require('path');
const { loadEvaluationCases } = require('./evaluation.js');
const { auditPackage } = require('./package-audit.js');
const { listRecipes, loadRecipe, validateRecipe } = require('./recipe.js');

const REQUIRED_HOST_ASSETS = [
  '.claude/skills/ai-engineering-loop/SKILL.md',
  '.claude/agents/devil-advocate.md',
  '.claude/agents/judge.md',
  '.grok/skills/ai-engineering-loop/SKILL.md',
  '.grok/agents/devil-advocate.md',
  '.grok/agents/judge.md',
  '.gemini/skills/ai-engineering-loop/SKILL.md',
  '.agents/workflows/ai-engineering-loop.md',
  '.agents/devil-advocate.md',
  '.agents/judge.md'
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
  'workflow-event.schema.json'
];

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function runDoctor(rootDir = path.join(__dirname, '..')) {
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
    checks.push(check('evaluation-catalog', fixtures.length === 20, `${fixtures.length} valid cases; required 20`));
  } catch (cause) {
    checks.push(check('evaluation-catalog', false, cause.message));
  }

  const packageFiles = new Set(pkg.files || []);
  const requiredPackageEntries = ['bin/', 'lib/', 'core/', 'policies/', 'recipes/', 'schemas/', 'evals/'];
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

  return {
    ok: checks.every((item) => item.passed),
    checks
  };
}

module.exports = {
  REQUIRED_HOST_ASSETS,
  REQUIRED_SCHEMAS,
  runDoctor
};
