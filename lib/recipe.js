'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { RUN_MODES, normalizeRunMode } = require('./run-state.js');
const {
  NODE_TYPES,
  CONDITION_OPERATORS,
  CONDITION_FIELDS,
  FORBIDDEN_COMMANDS,
  getNodeType
} = require('./node-registry.js');
const {
  EDGE_ID,
  MAX_EDGES,
  migrateLegacyRecipe,
  withDependencies
} = require('./recipe-graph.js');
const { validateLoopGroups } = require('./loop-groups.js');

const RECIPE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const NODE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_NODES = 64;
const BUILTIN_RECIPE_DIR = path.join(__dirname, '..', 'recipes');

function recipeError(message, details = [], code = 'INVALID_RECIPE') {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(
    typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalJson(value)
  ).digest('hex');
}

function validateCondition(condition, location, errors) {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    errors.push(`${location} must be a structured condition object`);
    return;
  }
  if (!CONDITION_FIELDS.includes(condition.field)) {
    errors.push(`${location}.field must be one of ${CONDITION_FIELDS.join(', ')}`);
  }
  if (!CONDITION_OPERATORS.includes(condition.operator)) {
    errors.push(`${location}.operator must be one of ${CONDITION_OPERATORS.join(', ')}`);
  }
  if (!['exists', 'isEmpty'].includes(condition.operator) && !Object.hasOwn(condition, 'value')) {
    errors.push(`${location}.value is required for ${condition.operator || 'this operator'}`);
  }
  if (condition.operator === 'matchesAny' && !Array.isArray(condition.value)) {
    errors.push(`${location}.value must be an array for matchesAny`);
  }
  if (['greaterThan', 'lessThan'].includes(condition.operator) && typeof condition.value !== 'number') {
    errors.push(`${location}.value must be a number for ${condition.operator}`);
  }
}

function validateRepositorySchemaPath(value, location, errors) {
  if (!String(value || '').trim()) {
    errors.push(`${location} is required`);
    return;
  }
  const schemaPath = String(value).replace(/\\/g, '/');
  if (
    /^(?:https?:|file:)/i.test(schemaPath) ||
    path.isAbsolute(schemaPath) ||
    schemaPath.split('/').includes('..')
  ) {
    errors.push(`${location} must be repository-relative`);
  }
}

function forbiddenAuthorityPaths(value, location, result = []) {
  if (!value || typeof value !== 'object') return result;
  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (/^(?:command|shell|secret|secretValue|environment|filesystem|network)$/i.test(key)) {
      result.push(childLocation);
    }
    forbiddenAuthorityPaths(child, childLocation, result);
  }
  return result;
}

function validateNodeConfiguration(node, index, errors, warnings) {
  const location = `nodes[${index}]`;
  const definition = getNodeType(node.type);
  if (!definition) return;
  if (node.when != null) validateCondition(node.when, `${location}.when`, errors);
  if (definition.builtIn && node.when != null) {
    errors.push(`${location}.when cannot conditionally skip a required safety node`);
  }

  if (node.type === 'condition') {
    validateCondition(node.expression, `${location}.expression`, errors);
  }

  if (node.type === 'agent' && node.prompt != null) {
    const allowedCapabilities = new Set([
      'repository-read',
      'repository-write',
      'artifact-read',
      'artifact-write',
      'mcp-invoke',
      'network-declared'
    ]);
    if (!String(node.displayName || '').trim() || String(node.displayName).length > 120) {
      errors.push(`${location}.displayName must be between 1 and 120 characters`);
    }
    if (!String(node.prompt || '').trim() || String(node.prompt).length > 20_000) {
      errors.push(`${location}.prompt must be between 1 and 20000 characters`);
    }
    if (!Array.isArray(node.capabilityRefs) ||
      node.capabilityRefs.some((ref) => !allowedCapabilities.has(ref))) {
      errors.push(`${location}.capabilityRefs contains unsupported authority`);
    }
    if (!Array.isArray(node.mcpRefs) || node.mcpRefs.some((ref) => !NODE_ID.test(String(ref)))) {
      errors.push(`${location}.mcpRefs must contain declared reference ids`);
    }
    if (!Array.isArray(node.inputArtifacts) ||
      node.inputArtifacts.some((ref) => !NODE_ID.test(String(ref)))) {
      errors.push(`${location}.inputArtifacts must contain artifact reference ids`);
    }
    if (!Array.isArray(node.outputArtifacts) || node.outputArtifacts.length === 0) {
      errors.push(`${location}.outputArtifacts must not be empty`);
    } else {
      node.outputArtifacts.forEach((output, outputIndex) => {
        if (!NODE_ID.test(String(output?.artifact || ''))) {
          errors.push(`${location}.outputArtifacts[${outputIndex}].artifact is invalid`);
        }
        validateRepositorySchemaPath(
          output?.schema,
          `${location}.outputArtifacts[${outputIndex}].schema`,
          errors
        );
      });
    }
    if (!Number.isSafeInteger(node.tokenLimit) || node.tokenLimit < 1 || node.tokenLimit > 1_000_000) {
      errors.push(`${location}.tokenLimit must be between 1 and 1000000`);
    }
    if (!Number.isSafeInteger(node.timeoutMs) || node.timeoutMs < 1_000 || node.timeoutMs > 30 * 60 * 1_000) {
      errors.push(`${location}.timeoutMs must be between 1000 and 1800000`);
    }
    if (
      !Number.isSafeInteger(node.retry?.maxAttempts) ||
      node.retry.maxAttempts < 1 ||
      node.retry.maxAttempts > 10 ||
      !Number.isSafeInteger(node.retry?.backoffMs) ||
      node.retry.backoffMs < 0 ||
      node.retry.backoffMs > 300_000
    ) {
      errors.push(`${location}.retry must define bounded maxAttempts and backoffMs`);
    }
    if (forbiddenAuthorityPaths(node, location).length) {
      errors.push(`${location} cannot persist commands, secret values, or unrestricted authority`);
    }
  } else if (node.type === 'agent') {
    if (!String(node.role || '').trim()) errors.push(`${location}.role is required`);
    if (!node.output || typeof node.output !== 'object') {
      errors.push(`${location}.output artifact contract is required`);
    } else {
      if (!String(node.output.artifact || '').trim()) errors.push(`${location}.output.artifact is required`);
      if (!String(node.output.schema || '').trim()) errors.push(`${location}.output.schema is required`);
      const schemaPath = String(node.output.schema || '').replace(/\\/g, '/');
      if (
        /^(?:https?:|file:)/i.test(schemaPath) ||
        path.isAbsolute(schemaPath) ||
        schemaPath.split('/').includes('..')
      ) {
        errors.push(`${location}.output.schema must be repository-relative`);
      }
    }
    if (!Number.isSafeInteger(node.context?.maxFiles) || node.context.maxFiles <= 0) {
      errors.push(`${location}.context.maxFiles must be a positive integer`);
    }
    if (!Number.isSafeInteger(node.context?.maxTokens) || node.context.maxTokens <= 0) {
      errors.push(`${location}.context.maxTokens must be a positive integer`);
    }
  }

  if (node.type === 'command') {
    const executable = String(node.command?.executable || '');
    if (!/^[a-zA-Z0-9._-]+$/.test(executable)) {
      errors.push(`${location}.command.executable must be a bare executable name`);
    } else if (FORBIDDEN_COMMANDS.has(executable.toLowerCase())) {
      errors.push(`${location}.command.executable cannot be a shell or interpreter`);
    }
    if (
      !Array.isArray(node.command?.args) ||
      node.command.args.some((arg) => typeof arg !== 'string' || /[\0\r\n]/.test(arg))
    ) {
      errors.push(`${location}.command.args must be an array of strings`);
    }
    if (!Number.isSafeInteger(node.timeoutMs) || node.timeoutMs < 1_000 || node.timeoutMs > 30 * 60 * 1_000) {
      errors.push(`${location}.timeoutMs must be between 1000 and 1800000`);
    }
    if (
      !Array.isArray(node.expectedExitCodes) ||
      node.expectedExitCodes.length === 0 ||
      node.expectedExitCodes.some((code) => !Number.isSafeInteger(code) || code < 0 || code > 255)
    ) {
      errors.push(`${location}.expectedExitCodes must not be empty`);
    }
    warnings.push(`${node.id}: project commands execute trusted repository scripts`);
  }

  if (node.type === 'approval' && !String(node.message || '').trim()) {
    errors.push(`${location}.message is required`);
  }
}

function topologicalOrder(nodes, byId, errors) {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const dependents = new Map(nodes.map((node) => [node.id, []]));
  for (const node of nodes) {
    for (const dependency of node.dependsOn || []) {
      if (!byId.has(dependency)) continue;
      indegree.set(node.id, indegree.get(node.id) + 1);
      dependents.get(dependency).push(node.id);
    }
  }
  const position = new Map(nodes.map((node, index) => [node.id, index]));
  const ready = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const ordered = [];
  while (ready.length) {
    ready.sort((left, right) => position.get(left) - position.get(right));
    const id = ready.shift();
    ordered.push(id);
    for (const dependent of dependents.get(id)) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) ready.push(dependent);
    }
  }
  if (ordered.length !== nodes.length) errors.push('recipe graph contains a dependency cycle');
  return ordered;
}

function dependsTransitively(byId, nodeId, requiredId) {
  const pending = [nodeId];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (current === requiredId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(byId.get(current)?.dependsOn || []));
  }
  return false;
}

function firstNodeOfType(nodes, type) {
  return nodes.find((node) => node.type === type);
}

function validateSafetyBackbone(recipe, mode, byId, errors) {
  const nodes = recipe.nodes || [];
  for (const type of ['goal-contract', 'maker', 'verification', 'devil-advocate', 'judge', 'report', 'delivery']) {
    if (nodes.filter((node) => node.type === type).length > 1) {
      errors.push(`only one ${type} node is allowed`);
    }
  }
  const goal = firstNodeOfType(nodes, 'goal-contract');
  if (!goal) errors.push('a goal-contract node is required');

  if (mode === RUN_MODES.REPORT_ONLY) {
    const report = firstNodeOfType(nodes, 'report');
    if (!report) errors.push('REPORT_ONLY requires a report node');
    if (nodes.some((node) => getNodeType(node.type)?.mutation)) {
      errors.push('REPORT_ONLY cannot contain mutation nodes');
    }
    if (nodes.some((node) => getNodeType(node.type)?.sideEffect)) {
      errors.push('REPORT_ONLY cannot contain side-effect nodes');
    }
    if (goal && report && !dependsTransitively(byId, report.id, goal.id)) {
      errors.push('report must depend on goal-contract');
    }
    return;
  }

  if (nodes.some((node) => node.type === 'report')) {
    errors.push(`${mode} recipe cannot contain a report terminal`);
  }
  const chainTypes = ['goal-contract', 'maker', 'verification', 'devil-advocate', 'judge', 'delivery'];
  const chain = chainTypes.map((type) => firstNodeOfType(nodes, type));
  chain.forEach((node, index) => {
    if (!node) errors.push(`${chainTypes[index]} node is required for ${mode}`);
  });
  for (let index = 1; index < chain.length; index++) {
    if (chain[index] && chain[index - 1] && !dependsTransitively(byId, chain[index].id, chain[index - 1].id)) {
      errors.push(`${chain[index].type} must depend on ${chain[index - 1].type}`);
    }
  }
  if (mode === RUN_MODES.ASSISTED) {
    const judge = firstNodeOfType(nodes, 'judge');
    const approval = nodes.find((node) => (
      node.type === 'approval' && (!node.when || (
        node.when.field === 'run.mode' &&
        node.when.operator === 'equals' &&
        node.when.value === RUN_MODES.ASSISTED
      )) && judge && dependsTransitively(byId, node.id, judge.id)
    ));
    const delivery = firstNodeOfType(nodes, 'delivery');
    if (!approval) errors.push('ASSISTED requires a human approval node');
    if (delivery && approval && !dependsTransitively(byId, delivery.id, approval.id)) {
      errors.push('delivery must depend on ASSISTED approval');
    }
  }
}

function validateRecipe(recipe, { mode } = {}) {
  const errors = [];
  const warnings = [];
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    return { valid: false, errors: ['recipe must be a JSON object'], warnings, order: [] };
  }
  recipe = migrateLegacyRecipe(recipe);
  if (recipe.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!RECIPE_ID.test(String(recipe.id || ''))) errors.push('id must match [a-z][a-z0-9-]{0,63}');
  if (!Number.isSafeInteger(recipe.version) || recipe.version <= 0) errors.push('version must be a positive integer');
  if (!String(recipe.description || '').trim()) errors.push('description is required');
  if (!Array.isArray(recipe.compatibleModes) || recipe.compatibleModes.length === 0) {
    errors.push('compatibleModes must not be empty');
  }
  const compatibleModes = [];
  for (const candidate of recipe.compatibleModes || []) {
    try {
      compatibleModes.push(normalizeRunMode(candidate));
    } catch (cause) {
      errors.push(cause.message);
    }
  }
  if (!Array.isArray(recipe.nodes) || recipe.nodes.length === 0) {
    errors.push('nodes must not be empty');
  } else if (recipe.nodes.length > MAX_NODES) {
    errors.push(`nodes exceeds the maximum of ${MAX_NODES}`);
  }

  const nodes = Array.isArray(recipe.nodes) ? recipe.nodes : [];
  const byId = new Map();
  nodes.forEach((node, index) => {
    const location = `nodes[${index}]`;
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      errors.push(`${location} must be an object`);
      return;
    }
    if (!NODE_ID.test(String(node.id || ''))) errors.push(`${location}.id is invalid`);
    else if (byId.has(node.id)) errors.push(`duplicate node id: ${node.id}`);
    else byId.set(node.id, node);
    if (!Object.hasOwn(NODE_TYPES, node.type)) errors.push(`${location}.type is unknown: ${node.type}`);
    if (node.dependsOn != null && (
      !Array.isArray(node.dependsOn) ||
      node.dependsOn.some((dependency) => typeof dependency !== 'string')
    )) {
      errors.push(`${location}.dependsOn must be an array of node ids`);
    }
    validateNodeConfiguration(node, index, errors, warnings);
  });
  if (!Array.isArray(recipe.edges)) {
    errors.push('edges must be an array');
  } else if (recipe.edges.length > MAX_EDGES) {
    errors.push(`edges exceeds the maximum of ${MAX_EDGES}`);
  }
  const edgeIds = new Set();
  const connections = new Set();
  for (const [index, edge] of (recipe.edges || []).entries()) {
    const location = `edges[${index}]`;
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
      errors.push(`${location} must be an object`);
      continue;
    }
    if (!EDGE_ID.test(String(edge.id || ''))) errors.push(`${location}.id is invalid`);
    else if (edgeIds.has(edge.id)) errors.push(`duplicate edge id: ${edge.id}`);
    else edgeIds.add(edge.id);
    const connection = `${edge.from}\0${edge.to}`;
    if (connections.has(connection)) errors.push(`duplicate edge connection: ${edge.from} -> ${edge.to}`);
    else connections.add(connection);
    if (!byId.has(edge.from)) errors.push(`${edge.id || location} references unknown from node ${edge.from}`);
    if (!byId.has(edge.to)) errors.push(`${edge.id || location} references unknown to node ${edge.to}`);
    if (edge.from === edge.to) errors.push(`${edge.id || location} cannot connect a node to itself`);
  }
  recipe = withDependencies(recipe);
  const projectedNodes = recipe.nodes;
  byId.clear();
  for (const node of projectedNodes) byId.set(node.id, node);
  for (const node of projectedNodes) {
    for (const dependency of node.dependsOn || []) {
      if (!byId.has(dependency)) errors.push(`${node.id} depends on unknown node ${dependency}`);
      if (dependency === node.id) errors.push(`${node.id} cannot depend on itself`);
    }
  }
  const loopValidation = validateLoopGroups(recipe);
  errors.push(...loopValidation.errors);
  const order = topologicalOrder(projectedNodes, byId, errors);
  const terminals = projectedNodes.filter((node) => ['report', 'delivery'].includes(node.type));
  for (const terminal of terminals) {
    if (projectedNodes.some((node) => (node.dependsOn || []).includes(terminal.id))) {
      errors.push(`${terminal.type} must be a terminal node`);
    }
  }
  for (const node of projectedNodes) {
    if (!terminals.some((terminal) => dependsTransitively(byId, terminal.id, node.id))) {
      errors.push(`${node.id} must lead to a report or delivery terminal`);
    }
  }
  const modesToCheck = mode ? [normalizeRunMode(mode)] : [...new Set(compatibleModes)];
  for (const selectedMode of modesToCheck) {
    if (!compatibleModes.includes(selectedMode)) {
      errors.push(`recipe ${recipe.id || '(unknown)'} is not compatible with ${selectedMode}`);
      continue;
    }
    validateSafetyBackbone(recipe, selectedMode, byId, errors);
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], order };
}

function compileRecipe(recipe, { mode } = {}) {
  recipe = withDependencies(recipe);
  const selectedMode = normalizeRunMode(mode || recipe?.compatibleModes?.[0]);
  const validation = validateRecipe(recipe, { mode: selectedMode });
  if (!validation.valid) {
    throw recipeError(`Recipe ${recipe?.id || '(unknown)'} is invalid`, validation.errors);
  }
  const byId = new Map(recipe.nodes.map((node) => [node.id, node]));
  const compiledNodes = validation.order.map((id, index) => {
    const node = byId.get(id);
    const definition = getNodeType(node.type);
    const customAgentRuntime = node.type === 'agent' && node.prompt != null
      ? {
          context: { ...(node.context || {}), maxTokens: node.tokenLimit },
          output: node.outputArtifacts[0]
        }
      : {};
    return {
      ...canonicalize(node),
      ...canonicalize(customAgentRuntime),
      order: index + 1,
      status: (node.dependsOn || []).length === 0 ? 'READY' : 'BLOCKED',
      capabilities: {
        repositoryMutation: definition.mutation,
        remoteSideEffect: definition.sideEffect,
        modelRequired: definition.modelRequired
      },
      ...(definition.legacyGate ? { legacyGate: definition.legacyGate } : {})
    };
  });
  const graphMaterial = {
    schemaVersion: 1,
    compilerVersion: 1,
    recipe: {
      id: recipe.id,
      version: recipe.version,
      sourceHash: sha256(recipe)
    },
    mode: selectedMode,
    nodes: compiledNodes,
    loopGroups: canonicalize(recipe.loopGroups || [])
  };
  return {
    ...graphMaterial,
    graphHash: sha256(graphMaterial),
    warnings: validation.warnings
  };
}

function readRecipeFile(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (cause) {
    if (cause.code === 'ENOENT') return null;
    throw recipeError(`Unable to inspect recipe: ${cause.message}`, [], 'RECIPE_READ_FAILED');
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw recipeError('Recipe must be a regular file, not a symlink', [], 'UNSAFE_RECIPE_PATH');
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw recipeError(`Recipe JSON is invalid: ${cause.message}`, [], 'INVALID_RECIPE_JSON');
  }
}

function recipePath(directory, id) {
  if (!RECIPE_ID.test(String(id || ''))) throw recipeError(`Invalid recipe id: ${id || '(empty)'}`);
  return path.join(directory, `${id}.json`);
}

function builtinRecipeIds() {
  return fs.readdirSync(BUILTIN_RECIPE_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -5))
    .sort();
}

function projectRecipeIds(directory) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (cause) {
    if (cause.code === 'ENOENT') return [];
    throw recipeError(`Unable to inspect recipe directory: ${cause.message}`, [], 'RECIPE_READ_FAILED');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw recipeError('Project recipe directory must be a regular directory, not a symlink', [], 'UNSAFE_RECIPE_PATH');
  }
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json') && RECIPE_ID.test(name.slice(0, -5)))
    .map((name) => name.slice(0, -5))
    .sort();
}

function listRecipes(rootDir) {
  const builtin = builtinRecipeIds();
  const projectDirectory = path.join(rootDir, '.ai-engineering-loop', 'recipes');
  const project = projectRecipeIds(projectDirectory).filter((id) => !builtin.includes(id));
  return [
    ...builtin.map((id) => ({ id, source: 'builtin' })),
    ...project.map((id) => ({ id, source: 'project' }))
  ];
}

function loadRecipe(rootDir, id) {
  const builtins = builtinRecipeIds();
  const source = builtins.includes(id) ? 'builtin' : 'project';
  const directory = source === 'builtin'
    ? BUILTIN_RECIPE_DIR
    : path.join(rootDir, '.ai-engineering-loop', 'recipes');
  if (source === 'project') projectRecipeIds(directory);
  const recipe = readRecipeFile(recipePath(directory, id));
  if (!recipe) throw recipeError(`Recipe not found: ${id}`, [], 'RECIPE_NOT_FOUND');
  if (recipe.id !== id) throw recipeError(`Recipe id must match file name: ${id}`, ['id mismatch']);
  return { recipe: migrateLegacyRecipe(recipe), source, path: recipePath(directory, id) };
}

function explainPlan(plan) {
  const lines = [
    `Workflow: ${plan.recipe.id} v${plan.recipe.version}`,
    `Mode: ${plan.mode}`,
    `Graph: ${plan.graphHash}`,
    '',
    'Execution plan:'
  ];
  for (const node of plan.nodes) {
    const definition = getNodeType(node.type);
    const conditions = node.when ? ` when ${node.when.field} ${node.when.operator} ${JSON.stringify(node.when.value)}` : '';
    lines.push(`${node.order}. ${definition.label} [${node.id}]${conditions}`);
  }
  lines.push('', 'Capabilities:');
  lines.push(`- Model-backed nodes: ${plan.nodes.filter((node) => node.capabilities.modelRequired).length}`);
  lines.push(`- Repository mutation nodes: ${plan.nodes.filter((node) => node.capabilities.repositoryMutation).length}`);
  lines.push(`- Remote side-effect nodes: ${plan.nodes.filter((node) => node.capabilities.remoteSideEffect).length}`);
  if (plan.warnings.length) {
    lines.push('', 'Warnings:', ...plan.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join('\n');
}

function mermaidPlan(plan) {
  const lines = ['flowchart TD'];
  for (const node of plan.nodes) {
    const label = `${node.order}. ${getNodeType(node.type).label}`.replace(/"/g, '\\"');
    lines.push(`    ${node.id.replace(/-/g, '_')}["${label}"]`);
  }
  for (const node of plan.nodes) {
    for (const dependency of node.dependsOn || []) {
      lines.push(`    ${dependency.replace(/-/g, '_')} --> ${node.id.replace(/-/g, '_')}`);
    }
  }
  return lines.join('\n');
}

function simulatePlan(plan) {
  return {
    schemaVersion: 1,
    recipe: plan.recipe,
    mode: plan.mode,
    graphHash: plan.graphHash,
    executable: true,
    executionPerformed: false,
    nodeCount: plan.nodes.length,
    readyNodes: plan.nodes.filter((node) => node.status === 'READY').map((node) => node.id),
    terminalNodes: plan.nodes
      .filter((candidate) => !plan.nodes.some((node) => (node.dependsOn || []).includes(candidate.id)))
      .map((node) => node.id),
    capabilities: {
      modelCalls: plan.nodes.filter((node) => node.capabilities.modelRequired).length,
      repositoryMutations: plan.nodes.filter((node) => node.capabilities.repositoryMutation).length,
      remoteSideEffects: plan.nodes.filter((node) => node.capabilities.remoteSideEffect).length
    },
    warnings: plan.warnings
  };
}

module.exports = {
  RECIPE_ID,
  NODE_ID,
  MAX_NODES,
  MAX_EDGES,
  BUILTIN_RECIPE_DIR,
  canonicalize,
  canonicalJson,
  sha256,
  migrateLegacyRecipe,
  validateRecipe,
  compileRecipe,
  listRecipes,
  loadRecipe,
  explainPlan,
  mermaidPlan,
  simulatePlan
};
