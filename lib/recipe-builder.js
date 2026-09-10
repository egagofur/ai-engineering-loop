'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NODE_TYPES } = require('./node-registry.js');
const { ensurePrivateRuntimeIgnores } = require('./runtime-files.js');
const {
  RECIPE_ID,
  canonicalJson,
  compileRecipe,
  listRecipes,
  loadRecipe,
  sha256,
  validateRecipe
} = require('./recipe.js');

function builderError(message, code = 'RECIPE_BUILDER_FAILED', details = []) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function recipeDirectory(rootDir) {
  return path.join(rootDir, '.ai-engineering-loop', 'recipes');
}

function assertSafeDirectory(rootDir, directory) {
  const relative = path.relative(rootDir, directory);
  let current = rootDir;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw builderError(`${path.relative(rootDir, current)} must be a regular directory`, 'UNSAFE_RECIPE_PATH');
    }
  }
}

function atomicWriteJson(filePath, value, { replace = false } = {}) {
  if (!replace && fs.existsSync(filePath)) {
    throw builderError(`Recipe already exists: ${path.basename(filePath, '.json')}`, 'RECIPE_EXISTS');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function assertProjectId(rootDir, id) {
  if (!RECIPE_ID.test(String(id || ''))) throw builderError(`Invalid recipe id: ${id || '(empty)'}`, 'INVALID_RECIPE');
  if (listRecipes(rootDir).some((entry) => entry.id === id && entry.source === 'builtin')) {
    throw builderError(`Built-in recipe id is reserved: ${id}`, 'RESERVED_RECIPE_ID');
  }
}

function validateCandidate(recipe) {
  const result = validateRecipe(recipe);
  if (!result.valid) throw builderError(`Recipe ${recipe?.id || '(unknown)'} is invalid`, 'INVALID_RECIPE', result.errors);
  return result;
}

function cloneRecipe(rootDir, sourceId, targetId, { description } = {}) {
  assertProjectId(rootDir, targetId);
  const source = loadRecipe(rootDir, sourceId).recipe;
  const candidate = {
    ...JSON.parse(JSON.stringify(source)),
    id: targetId,
    version: 1,
    description: description || `Project workflow based on ${sourceId}.`
  };
  validateCandidate(candidate);
  ensurePrivateRuntimeIgnores(rootDir);
  const directory = recipeDirectory(rootDir);
  assertSafeDirectory(rootDir, directory);
  const filePath = path.join(directory, `${targetId}.json`);
  atomicWriteJson(filePath, candidate);
  return { recipe: candidate, path: filePath, sourceHash: sha256(candidate) };
}

function readCandidate(rootDir, candidatePath) {
  const absolute = path.resolve(rootDir, candidatePath);
  if (path.relative(rootDir, absolute).split(path.sep).includes('..')) {
    throw builderError('Candidate must stay inside the repository', 'UNSAFE_RECIPE_PATH');
  }
  assertSafeDirectory(rootDir, path.dirname(absolute));
  const realRoot = fs.realpathSync(rootDir);
  const realFile = fs.realpathSync(absolute);
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) {
    throw builderError('Candidate must stay inside the repository', 'UNSAFE_RECIPE_PATH');
  }
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw builderError('Candidate must be a regular file', 'UNSAFE_RECIPE_PATH');
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (cause) {
    throw builderError(`Candidate JSON is invalid: ${cause.message}`, 'INVALID_RECIPE_JSON');
  }
}

function installRecipe(rootDir, candidatePath, { replace = false } = {}) {
  const candidate = readCandidate(rootDir, candidatePath);
  assertProjectId(rootDir, candidate.id);
  validateCandidate(candidate);
  ensurePrivateRuntimeIgnores(rootDir);
  const directory = recipeDirectory(rootDir);
  assertSafeDirectory(rootDir, directory);
  const destination = path.join(directory, `${candidate.id}.json`);
  let previous = null;
  if (fs.existsSync(destination)) {
    previous = loadRecipe(rootDir, candidate.id).recipe;
    if (!replace) throw builderError(`Recipe already exists: ${candidate.id}`, 'RECIPE_EXISTS');
    if (candidate.version <= previous.version) {
      throw builderError(
        `Replacement version must be greater than ${previous.version}`,
        'RECIPE_VERSION_NOT_INCREMENTED'
      );
    }
    const history = path.join(directory, '.history', candidate.id, `${previous.version}.json`);
    assertSafeDirectory(rootDir, path.dirname(history));
    if (!fs.existsSync(history)) atomicWriteJson(history, previous);
  }
  atomicWriteJson(destination, candidate, { replace: Boolean(previous) });
  return {
    recipe: candidate,
    path: destination,
    sourceHash: sha256(candidate),
    replacedVersion: previous?.version || null
  };
}

function recipeCatalog() {
  return Object.entries(NODE_TYPES).map(([type, definition]) => ({
    type,
    label: definition.label,
    category: definition.category,
    capabilities: {
      repositoryMutation: definition.mutation,
      remoteSideEffect: definition.sideEffect,
      modelRequired: definition.modelRequired
    },
    executable: type !== 'command'
  }));
}

function inspectRecipe(rootDir, id) {
  const loaded = loadRecipe(rootDir, id);
  const plans = loaded.recipe.compatibleModes.map((mode) => compileRecipe(loaded.recipe, { mode }));
  return {
    id,
    source: loaded.source,
    version: loaded.recipe.version,
    description: loaded.recipe.description,
    sourceHash: sha256(loaded.recipe),
    modes: plans.map((plan) => ({
      mode: plan.mode,
      graphHash: plan.graphHash,
      nodes: plan.nodes.length,
      modelCalls: plan.nodes.filter((node) => node.capabilities.modelRequired).length,
      mutations: plan.nodes.filter((node) => node.capabilities.repositoryMutation).length,
      remoteSideEffects: plan.nodes.filter((node) => node.capabilities.remoteSideEffect).length,
      approvals: plan.nodes.filter((node) => node.type === 'approval').length,
      declaredTokenCeiling: plan.nodes.reduce((sum, node) => sum + (node.context?.maxTokens || 0), 0)
    }))
  };
}

function diffRecipes(rootDir, leftId, rightId) {
  const left = loadRecipe(rootDir, leftId).recipe;
  const right = loadRecipe(rootDir, rightId).recipe;
  const leftNodes = new Map(left.nodes.map((node) => [node.id, node]));
  const rightNodes = new Map(right.nodes.map((node) => [node.id, node]));
  return {
    left: { id: left.id, version: left.version, sourceHash: sha256(left) },
    right: { id: right.id, version: right.version, sourceHash: sha256(right) },
    metadataChanged: left.description !== right.description ||
      canonicalJson(left.compatibleModes) !== canonicalJson(right.compatibleModes),
    added: [...rightNodes.keys()].filter((id) => !leftNodes.has(id)),
    removed: [...leftNodes.keys()].filter((id) => !rightNodes.has(id)),
    changed: [...rightNodes.keys()].filter((id) => (
      leftNodes.has(id) && canonicalJson(leftNodes.get(id)) !== canonicalJson(rightNodes.get(id))
    ))
  };
}

module.exports = {
  cloneRecipe,
  installRecipe,
  recipeCatalog,
  inspectRecipe,
  diffRecipes
};
