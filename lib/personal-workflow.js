'use strict';

// Per-user personal workflow (issue #81). Lives only under the AEL home
// (AEL_HOME / ~/.ai-engineering-loop). Never written into a repository.
// Proposals are records only; accept --by is the sole mutator of the default.

const fs = require('fs');
const path = require('path');
const { redactHomePaths, redactSecrets } = require('./safe-context.js');
const {
  homeDir,
  sha256,
  atomicWritePrivate,
  readJsonFile,
  writeJsonFile,
  readUserConfig,
  writeUserConfig,
  personalRecipePath,
  personalHistoryDir,
  workflowHistoryPath,
  proposalsDir,
  proposalPath
} = require('./user-state.js');
const { loadPolicy, normalizeMode } = require('./runtime-policy.js');
const {
  BACKBONE_CODES,
  RECIPE_ID,
  canonicalJson,
  compileRecipe,
  listRecipes,
  loadRecipe,
  sha256: recipeHash,
  validateRecipe
} = require('./recipe.js');
const { stableEdgeId } = require('./recipe-graph.js');
const { RUN_MODES, RUN_STATES, TERMINAL_STATES, runsDir } = require('./run-state.js');

const PERSONAL_ID = 'personal';
const SUGGEST_WINDOW = 20;
const SUGGEST_RATIO = 0.8;
const RISK_WINDOW = 10;
const RISK_COUNT = 4;
const LEARNING_MIN = 3;
const ACTOR_ID = /^[A-Za-z0-9@._-]{1,64}$/;
const LEARNING_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const GATE_ID = /^[a-z0-9-]{1,40}$/;
const BACKBONE_TYPES = new Set([
  'goal-contract', 'maker', 'verification', 'devil-advocate', 'judge', 'delivery', 'report'
]);
const SUMMARY_KEYS = Object.freeze([
  'schemaVersion', 'at', 'runId', 'state', 'mode', 'tier', 'recipeId', 'iterations',
  'workflowSource', 'repoHash', 'impact', 'outOfMapCount', 'markdownOnly', 'guard', 'learningIds', 'gates'
]);

const INTERVIEW_QUESTIONS = Object.freeze([
  {
    id: 'usualTier',
    prompt: 'Usual tier',
    options: ['T0', 'T1', 'T2'],
    fallback: 'T1'
  },
  {
    id: 'mode',
    prompt: 'ASSISTED vs UNATTENDED',
    options: ['ASSISTED', 'UNATTENDED'],
    fallback: 'ASSISTED'
  },
  {
    id: 'extraApproval',
    prompt: 'Extra approval before Maker (docs-light path, design/backend pack, or extra checkpoint)',
    options: ['yes', 'no'],
    fallback: 'no'
  },
  {
    id: 'docsLight',
    prompt: 'Route markdown-only tasks onto a docs-light node',
    options: ['yes', 'no'],
    fallback: 'no'
  },
  {
    id: 'makerIntern',
    prompt: 'Maker intern (host catalog label, or none)',
    options: ['none'],
    fallback: 'none'
  },
  {
    id: 'headsUp',
    prompt: 'Stages to get a heads-up on',
    options: ['none', 'maker', 'delivery'],
    fallback: 'none'
  },
  {
    id: 'extraBeforeGrill',
    prompt: 'Extra step before grill',
    options: ['none'],
    fallback: 'none'
  },
  {
    id: 'extraAfterFreeze',
    prompt: 'Extra step after Goal Contract freeze',
    options: ['none'],
    fallback: 'none'
  },
  {
    id: 'extraAfterPass',
    prompt: 'Extra step after Judge PASS',
    options: ['none'],
    fallback: 'none'
  }
]);

function workflowError(message, code = 'PERSONAL_WORKFLOW_FAILED', details = []) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function canUseUserWorkflow(env = process.env) {
  if (env.AEL_HOME) return true;
  if (env.NODE_TEST_CONTEXT) return false;
  return true;
}

function resolveHome(home, env = process.env) {
  return home || homeDir(env);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function builtinRecipe(rootDir, id) {
  return clone(loadRecipe(rootDir, id).recipe);
}

function loadProjectWorkflowConfig(rootDir) {
  return loadPolicy(rootDir).workflow;
}

function readAdapterText(rootDir) {
  try {
    const filePath = path.join(rootDir, '.ai-engineering-loop', 'adapter.md');
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return '';
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

// One line in adapter.md pins a checkpoint the personal recipe cannot drop:
// - **required_node**: <id> approval <from> <to> <message>
function adapterRequiredFragment(rootDir) {
  const nodes = [];
  const edges = [];
  const pattern = /^\s*-\s+\*\*required_node\*\*:\s+([a-z][a-z0-9-]{0,63})\s+(approval)\s+([a-z][a-z0-9-]{0,63})\s+([a-z][a-z0-9-]{0,63})\s+(.+)$/gm;
  for (const match of readAdapterText(rootDir).matchAll(pattern)) {
    const [, id, type, from, to, message] = match;
    nodes.push({ id, type, required: true, message: message.trim() });
    edges.push({ from, to: id });
    edges.push({ from: id, to });
  }
  return { nodes, edges };
}

function projectRequiredFragment(rootDir) {
  const nodes = [];
  const edges = [];
  let entries = [];
  try {
    entries = listRecipes(rootDir).filter((entry) => entry.source === 'project');
  } catch {
    return { nodes, edges };
  }
  for (const entry of entries) {
    let loaded;
    try {
      loaded = loadRecipe(rootDir, entry.id);
    } catch {
      continue;
    }
    const required = (loaded.recipe.nodes || []).filter((node) => node.required === true);
    if (!required.length) continue;
    const ids = new Set(required.map((node) => node.id));
    nodes.push(...required.map((node) => clone(node)));
    for (const edge of loaded.recipe.edges || []) {
      if (ids.has(edge.from) || ids.has(edge.to)) edges.push(clone(edge));
    }
  }
  return { nodes, edges };
}

function repoHash(rootDir) {
  let resolved = String(rootDir || '');
  try {
    resolved = fs.realpathSync(rootDir);
  } catch {
    // Hash the given root even when it is not yet a real path.
  }
  return sha256(resolved);
}

function readPersonalRecipe(home, env = process.env) {
  if (!canUseUserWorkflow(env)) return null;
  const filePath = personalRecipePath(resolveHome(home, env));
  const recipe = readJsonFile(filePath, null);
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return null;
  if (recipe.id !== PERSONAL_ID) return null;
  return recipe;
}

function nodeCopy(node) {
  const copy = clone(node);
  delete copy.required;
  return copy;
}

// Insert a required node only when both of its neighbors are already in the
// graph, so it cannot float off the safety chain or break REPORT_ONLY.
function overlayRequiredNodes(base, fragment) {
  const recipe = clone(base);
  recipe.nodes = recipe.nodes || [];
  recipe.edges = recipe.edges || [];
  const byId = new Map(recipe.nodes.map((node) => [node.id, node]));
  const typePresent = new Set(recipe.nodes.map((node) => node.type));
  for (const node of fragment.nodes || []) {
    if (byId.has(node.id)) {
      if (node.required === true) {
        const index = recipe.nodes.findIndex((item) => item.id === node.id);
        const replacement = { ...nodeCopy(node), id: node.id };
        recipe.nodes[index] = replacement;
        byId.set(node.id, replacement);
      }
      continue;
    }
    if (BACKBONE_TYPES.has(node.type) && typePresent.has(node.type)) continue;
    const related = (fragment.edges || []).filter((edge) => edge.from === node.id || edge.to === node.id);
    const incoming = related.some((edge) => edge.to === node.id && byId.has(edge.from));
    const outgoing = related.some((edge) => edge.from === node.id && byId.has(edge.to));
    if (!incoming || !outgoing) continue;
    const copy = nodeCopy(node);
    recipe.nodes.push(copy);
    byId.set(copy.id, copy);
    typePresent.add(copy.type);
  }
  const edgeKeys = new Set(recipe.edges.map((edge) => `${edge.from}\0${edge.to}`));
  for (const edge of fragment.edges || []) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    const key = `${edge.from}\0${edge.to}`;
    if (edgeKeys.has(key)) continue;
    const id = edge.id && !recipe.edges.some((item) => item.id === edge.id)
      ? edge.id
      : stableEdgeId(edge.from, edge.to);
    recipe.edges.push({ id, from: edge.from, to: edge.to });
    edgeKeys.add(key);
  }
  return recipe;
}

function mergeRequirements(recipe, rootDir, config) {
  let next = clone(recipe);
  if (config && config.mergeRecipe) {
    next = overlayRequiredNodes(next, builtinRecipe(rootDir, config.mergeRecipe));
  }
  next = overlayRequiredNodes(next, projectRequiredFragment(rootDir));
  next = overlayRequiredNodes(next, adapterRequiredFragment(rootDir));
  return next;
}

function compileOrThrow(recipe, mode) {
  const validation = validateRecipe(recipe, mode ? { mode } : {});
  if (!validation.valid) {
    const code = (validation.codes || []).find((item) => String(item).startsWith('BACKBONE_'))
      || 'INVALID_RECIPE';
    throw workflowError(`Recipe ${recipe?.id || '(unknown)'} is invalid`, code, validation.errors);
  }
  return compileRecipe(recipe, mode ? { mode } : {});
}

function builtinFallbackId(mode) {
  return mode === RUN_MODES.REPORT_ONLY ? 'audit' : 'default';
}

function recipeCompatible(recipe, mode) {
  if (!mode) return true;
  return (recipe.compatibleModes || []).includes(mode);
}

function resolveRunWorkflow(rootDir, { mode = null, recipeId = null, home, env = process.env } = {}) {
  const config = loadProjectWorkflowConfig(rootDir);
  const normalizedMode = mode ? normalizeMode(mode) : null;
  const requested = recipeId && RECIPE_ID.test(recipeId) ? recipeId : null;
  const personal = readPersonalRecipe(home, env);
  const fallbackId = builtinFallbackId(normalizedMode);
  const finish = (recipe, source, reason) => {
    const merged = mergeRequirements(recipe, rootDir, config);
    if (source === 'personal') merged.id = PERSONAL_ID;
    return { recipe: merged, source, reason, recipeId: merged.id };
  };

  if (config.requiredRecipe) {
    const loaded = loadRecipe(rootDir, config.requiredRecipe);
    const reason = requested && requested !== loaded.recipe.id
      ? `requiredRecipe=${config.requiredRecipe} overrides --recipe ${requested}`
      : `requiredRecipe=${config.requiredRecipe}`;
    return finish(loaded.recipe, 'project-required', reason);
  }

  if (requested && requested !== PERSONAL_ID) {
    const loaded = loadRecipe(rootDir, requested);
    return finish(loaded.recipe, 'builtin', personal ? 'explicit-recipe' : null);
  }

  if (config.allowPersonal === false) {
    const loaded = loadRecipe(rootDir, fallbackId);
    return finish(loaded.recipe, 'project-required', 'allowPersonal=false');
  }

  if (requested === PERSONAL_ID && !personal) {
    throw workflowError('Personal workflow is not installed', 'PERSONAL_WORKFLOW_MISSING');
  }

  if (personal && recipeCompatible(personal, normalizedMode)) {
    return finish(personal, 'personal', null);
  }

  const loaded = loadRecipe(rootDir, fallbackId);
  return finish(loaded.recipe, 'builtin', null);
}

function majority(values, ratio = SUGGEST_RATIO) {
  if (!values.length) return null;
  const counts = {};
  for (const value of values) {
    if (value == null || value === '') continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  const ranked = Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (!ranked.length) return null;
  const [value, count] = ranked[0];
  if (count / values.length < ratio) return null;
  return { value, count, total: values.length };
}

function readHistory(home, env = process.env, limit = SUGGEST_WINDOW) {
  if (!canUseUserWorkflow(env)) return [];
  const filePath = workflowHistoryPath(resolveHome(home, env));
  let text;
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return [];
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') rows.push(row);
    } catch {
      // Skip a corrupt line; the rest of the index still counts.
    }
  }
  return rows.slice(-limit);
}

function evidenceFor(runIds, counts) {
  return {
    runIds: [...new Set(runIds || [])].sort(),
    counts: counts && typeof counts === 'object' ? counts : {}
  };
}

function activeHistory(home, env) {
  return readHistory(home, env, SUGGEST_WINDOW).filter((row) => row.state !== 'CANCELLED');
}

function interviewQuestions(home, env = process.env) {
  const history = activeHistory(home, env);
  const questions = INTERVIEW_QUESTIONS.map((spec) => {
    let value = spec.fallback;
    let evidence = evidenceFor([], { total: history.length });
    if (spec.id === 'usualTier') {
      const pick = majority(history.map((row) => row.tier).filter(Boolean));
      if (pick) {
        value = pick.value;
        evidence = evidenceFor(
          history.filter((row) => row.tier === pick.value).map((row) => row.runId),
          { [pick.value]: pick.count, total: pick.total }
        );
      }
    } else if (spec.id === 'mode') {
      const pick = majority(history.map((row) => row.mode).filter(Boolean));
      if (pick) {
        value = pick.value;
        evidence = evidenceFor(
          history.filter((row) => row.mode === pick.value).map((row) => row.runId),
          { [pick.value]: pick.count, total: pick.total }
        );
      }
    } else if (spec.id === 'extraApproval') {
      const hits = history.filter((row) => row.recipeId === 'high-risk' || row.extraApproval);
      if (history.length && hits.length / history.length >= SUGGEST_RATIO) {
        value = 'yes';
        evidence = evidenceFor(hits.map((row) => row.runId), { yes: hits.length, total: history.length });
      }
    } else if (spec.id === 'docsLight') {
      const markdown = history.filter((row) => row.markdownOnly);
      const t0 = markdown.filter((row) => row.tier === 'T0');
      if (markdown.length >= 3 && t0.length / markdown.length >= SUGGEST_RATIO) {
        value = 'yes';
        evidence = evidenceFor(t0.map((row) => row.runId), { t0: t0.length, markdown: markdown.length });
      }
    }
    return {
      id: spec.id,
      prompt: spec.prompt,
      options: spec.options.slice(),
      default: value,
      evidence
    };
  });
  return {
    questions,
    pendingProposal: listProposals(home, env)
      .filter((item) => item.status === 'pending')
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null,
    historyCount: history.length
  };
}

function isYes(value) {
  return /^(yes|true|1)$/i.test(String(value || '').trim());
}

function addEdge(recipe, from, to) {
  const key = `${from}\0${to}`;
  if ((recipe.edges || []).some((edge) => `${edge.from}\0${edge.to}` === key)) return;
  recipe.edges = recipe.edges || [];
  recipe.edges.push({ id: stableEdgeId(from, to), from, to });
}

function addNamedApproval(recipe, id, message, fromId, toId) {
  if (recipe.nodes.some((node) => node.id === id)) return;
  recipe.nodes.push({ id, type: 'approval', message });
  addEdge(recipe, fromId, id);
  addEdge(recipe, id, toId);
}

function sanitizeLabel(raw, fallback = 'none') {
  const text = redactHomePaths(redactSecrets(String(raw || '')).text).replace(/\s+/g, ' ').trim();
  if (!text || /^none$/i.test(text)) return fallback;
  if (/api[_-]?key/i.test(text) || /^sk-/i.test(text) || /https?:\/\//i.test(text)) {
    throw workflowError('maker_intern is a host-native label, not a key or URL', 'INTERN_SECRET');
  }
  return text.slice(0, 80);
}

function dropNodes(recipe, predicate) {
  recipe.nodes = recipe.nodes.filter((node) => !predicate(node));
  const ids = new Set(recipe.nodes.map((node) => node.id));
  recipe.edges = (recipe.edges || []).filter((edge) => ids.has(edge.from) && ids.has(edge.to));
}

function recipeFromAnswers(answers, { rootDir } = {}) {
  const requested = answers || {};
  const recipe = builtinRecipe(rootDir, 'default');
  recipe.id = PERSONAL_ID;
  recipe.version = 1;
  const intern = sanitizeLabel(requested.makerIntern, 'none');
  recipe.description = `Personal workflow (maker_intern: ${intern}).`;
  const drops = [].concat(requested.drop || []).map((item) => String(item));
  if (drops.length) dropNodes(recipe, (node) => drops.includes(node.type) || drops.includes(node.id));
  for (const name of [].concat(requested.conditionalSkip || []).map((item) => String(item))) {
    const node = recipe.nodes.find((item) => item.type === name || item.id === name);
    if (node) node.when = { field: 'run.iteration', operator: 'greaterThan', value: 0 };
  }
  if (isYes(requested.removeAssistedApproval) || isYes(requested.removeApproval)) {
    dropNodes(recipe, (node) => node.type === 'approval');
    if (recipe.nodes.some((node) => node.id === 'judge') && recipe.nodes.some((node) => node.id === 'delivery')) {
      addEdge(recipe, 'judge', 'delivery');
    }
  }
  if (requested.judgeModel) {
    const judge = recipe.nodes.find((node) => node.type === 'judge');
    if (judge) judge.modelTier = requested.judgeModel;
  }
  if (isYes(requested.extraApproval)) {
    addNamedApproval(
      recipe,
      'plan-approval',
      'Approve the implementation plan before repository mutation.',
      'goal',
      'maker'
    );
  }
  if (isYes(requested.docsLight)) {
    const docs = builtinRecipe(rootDir, 'docs-light');
    const node = docs.nodes.find((item) => item.id === 'documentation-context');
    if (node && !recipe.nodes.some((item) => item.id === node.id)) {
      recipe.nodes.push(clone(node));
      addEdge(recipe, 'goal', node.id);
      addEdge(recipe, node.id, 'maker');
    }
  }
  if (requested.headsUp && requested.headsUp !== 'none') {
    const stage = String(requested.headsUp);
    if (stage === 'maker') {
      addNamedApproval(recipe, 'maker-heads-up', 'Heads-up before Maker.', 'goal', 'maker');
    } else if (stage === 'delivery') {
      addNamedApproval(recipe, 'delivery-heads-up', 'Heads-up before delivery.', 'judge', 'delivery');
    }
  }
  for (const [answerKey, nodeId, fromId, toId, label] of [
    ['extraBeforeGrill', 'before-grill', 'goal', 'maker', 'Extra step before grill'],
    ['extraAfterFreeze', 'after-freeze', 'goal', 'maker', 'Extra step after Goal freeze'],
    ['extraAfterPass', 'after-pass', 'judge', 'delivery', 'Extra step after Judge PASS']
  ]) {
    const name = sanitizeLabel(requested[answerKey], 'none');
    if (name !== 'none') {
      addNamedApproval(recipe, nodeId, `${label}: ${name}`, fromId, toId);
    }
  }
  return recipe;
}

function diffRecipeObjects(left, right) {
  const leftNodes = new Map((left.nodes || []).map((node) => [node.id, node]));
  const rightNodes = new Map((right.nodes || []).map((node) => [node.id, node]));
  return {
    left: { id: left.id, version: left.version, sourceHash: recipeHash(left) },
    right: { id: right.id, version: right.version, sourceHash: recipeHash(right) },
    metadataChanged: left.description !== right.description
      || canonicalJson(left.compatibleModes) !== canonicalJson(right.compatibleModes),
    added: [...rightNodes.keys()].filter((id) => !leftNodes.has(id)),
    removed: [...leftNodes.keys()].filter((id) => !rightNodes.has(id)),
    changed: [...rightNodes.keys()].filter((id) => (
      leftNodes.has(id) && canonicalJson(leftNodes.get(id)) !== canonicalJson(rightNodes.get(id))
    ))
  };
}

function proposalId(kind, evidence) {
  const material = canonicalJson({ kind, runIds: evidence.runIds || [], counts: evidence.counts || {} });
  return `pw-${String(kind).replace(/[^a-z0-9-]/g, '').slice(0, 24)}-${sha256(material).slice(0, 8)}`;
}

function writeProposalRecord(record, home, env = process.env) {
  if (!canUseUserWorkflow(env)) {
    throw workflowError('Refusing to write personal workflow outside a sandboxed AEL_HOME during tests', 'AEL_HOME_REQUIRED');
  }
  const resolved = resolveHome(home, env);
  const filePath = proposalPath(record.id, resolved);
  writeJsonFile(filePath, record);
  return filePath;
}

function listProposals(home, env = process.env) {
  if (!canUseUserWorkflow(env)) return [];
  const directory = proposalsDir(resolveHome(home, env));
  let names;
  try {
    names = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return names.map((name) => readJsonFile(path.join(directory, name), null)).filter(Boolean);
}

function readProposal(id, home, env = process.env) {
  const record = readJsonFile(proposalPath(id, resolveHome(home, env)), null);
  if (!record) throw workflowError(`Proposal not found: ${id}`, 'PROPOSAL_NOT_FOUND');
  return record;
}

function proposeFromAnswers(answers, { rootDir, home, env = process.env, now = new Date() } = {}) {
  const recipe = recipeFromAnswers(answers || {}, { rootDir });
  compileOrThrow(recipe, answers?.mode === 'UNATTENDED' ? RUN_MODES.UNATTENDED : RUN_MODES.ASSISTED);
  const current = readPersonalRecipe(home, env) || builtinRecipe(rootDir, 'default');
  const diff = diffRecipeObjects(current, recipe);
  const evidence = evidenceFor([], { source: 'interview' });
  const record = {
    schemaVersion: 1,
    id: proposalId('interview', { runIds: [now.toISOString()], counts: { interview: 1 } }),
    status: 'pending',
    kind: 'interview',
    createdAt: now.toISOString(),
    recipe,
    diff,
    evidence,
    answers: answers || {}
  };
  const filePath = writeProposalRecord(record, home, env);
  return { proposal: record, path: filePath, diff };
}

function assertHumanAcceptor(by, mode) {
  if (!by || !ACTOR_ID.test(String(by))) {
    throw workflowError('--by <name> is required (the accepting human)', 'INVALID_APPROVER');
  }
  const normalized = mode ? normalizeMode(mode) : null;
  if (normalized === RUN_MODES.UNATTENDED) {
    throw workflowError('UNATTENDED cannot accept a personal workflow; a human must run workflow accept --by <name>', 'HUMAN_REQUIRED');
  }
}

function installPersonalRecipe(recipe, { home, env = process.env, by, now = new Date() } = {}) {
  if (!canUseUserWorkflow(env)) {
    throw workflowError('Refusing to write personal workflow outside a sandboxed AEL_HOME during tests', 'AEL_HOME_REQUIRED');
  }
  const resolved = home || homeDir(env);
  compileOrThrow(recipe, RUN_MODES.ASSISTED);
  const destination = personalRecipePath(resolved);
  const previous = readPersonalRecipe(resolved, env);
  const next = clone(recipe);
  next.id = PERSONAL_ID;
  if (previous) {
    if (!Number.isSafeInteger(next.version) || next.version <= previous.version) {
      next.version = previous.version + 1;
    }
    const historyFile = path.join(personalHistoryDir(resolved), `${previous.version}.json`);
    if (!fs.existsSync(historyFile)) writeJsonFile(historyFile, previous);
  } else if (!Number.isSafeInteger(next.version) || next.version <= 0) {
    next.version = 1;
  }
  writeJsonFile(destination, next);
  writeUserConfig({ defaultRecipe: PERSONAL_ID, defaultRecipeAcceptedBy: by, defaultRecipeAcceptedAt: now.toISOString() }, resolved);
  return { recipe: next, path: destination, replacedVersion: previous?.version || null };
}

function acceptProposal({ proposalId: id, by, home, mode, env = process.env, now = new Date() } = {}) {
  assertHumanAcceptor(by, mode);
  const record = readProposal(id, home, env);
  if (record.status === 'accepted') {
    throw workflowError(`Proposal already accepted: ${id}`, 'PROPOSAL_ALREADY_ACCEPTED');
  }
  if (!record.recipe) throw workflowError('Proposal has no recipe', 'INVALID_PROPOSAL');
  const installed = installPersonalRecipe(record.recipe, { home, env, by, now });
  const accepted = {
    ...record,
    status: 'accepted',
    acceptedBy: String(by),
    acceptedAt: now.toISOString(),
    recipe: installed.recipe
  };
  writeProposalRecord(accepted, home, env);
  return { proposal: accepted, recipe: installed.recipe, replacedVersion: installed.replacedVersion };
}

function rejectProposal({ proposalId: id, by, home, mode, env = process.env, now = new Date() } = {}) {
  assertHumanAcceptor(by, mode);
  const record = readProposal(id, home, env);
  const rejected = {
    ...record,
    status: 'rejected',
    rejectedBy: String(by),
    rejectedAt: now.toISOString(),
    evidenceHash: sha256(canonicalJson(record.evidence || {}))
  };
  writeProposalRecord(rejected, home, env);
  return { proposal: rejected };
}

function evidenceStrength(evidence) {
  return evidence && Array.isArray(evidence.runIds) ? evidence.runIds.length : 0;
}

function shouldSkipSuggestion(existing, candidate) {
  const sameKind = existing.filter((item) => item.kind === candidate.kind);
  if (sameKind.some((item) => item.status === 'pending')) return true;
  const rejected = sameKind.filter((item) => item.status === 'rejected')
    .sort((left, right) => String(right.rejectedAt || '').localeCompare(String(left.rejectedAt || '')));
  if (!rejected.length) return false;
  return evidenceStrength(candidate.evidence) <= evidenceStrength(rejected[0].evidence);
}

function candidateRecipeWithNode(base, node, fromId, toId) {
  const recipe = clone(base);
  recipe.id = PERSONAL_ID;
  if (!recipe.nodes.some((item) => item.id === node.id)) recipe.nodes.push(clone(node));
  addEdge(recipe, fromId, node.id);
  addEdge(recipe, node.id, toId);
  return recipe;
}

function suggestProposals({ home, rootDir, env = process.env, now = new Date() } = {}) {
  const history = activeHistory(home, env);
  const existing = listProposals(home, env);
  const current = readPersonalRecipe(home, env) || builtinRecipe(rootDir, 'default');
  const created = [];
  const consider = (candidate) => {
    if (shouldSkipSuggestion(existing.concat(created), candidate)) return;
    try {
      compileOrThrow(candidate.recipe, RUN_MODES.ASSISTED);
    } catch {
      return;
    }
    const record = {
      schemaVersion: 1,
      id: proposalId(candidate.kind, candidate.evidence),
      status: 'pending',
      kind: candidate.kind,
      createdAt: now.toISOString(),
      recipe: candidate.recipe,
      diff: diffRecipeObjects(current, candidate.recipe),
      evidence: candidate.evidence
    };
    writeProposalRecord(record, home, env);
    created.push(record);
  };

  const t1 = history.filter((row) => row.tier === 'T1' && row.state !== 'CANCELLED');
  const t1Confirmed = t1.filter((row) => row.impact === 'confirm' && Number(row.outOfMapCount || 0) === 0);
  if (t1.length >= 5 && t1Confirmed.length / t1.length >= SUGGEST_RATIO) {
    consider({
      kind: 'impact-confirm-t2',
      evidence: evidenceFor(t1Confirmed.map((row) => row.runId), {
        confirmed: t1Confirmed.length,
        t1: t1.length,
        ratio: t1Confirmed.length / t1.length
      }),
      recipe: candidateRecipeWithNode(current, {
        id: 'impact-confirm-t2',
        type: 'approval',
        when: { field: 'run.iteration', operator: 'greaterThan', value: 0 },
        message: 'Confirm the impact map; T1 runs in history were unchanged, so prompt mainly at T2.'
      }, 'goal', 'maker')
    });
  }

  const markdown = history.filter((row) => row.markdownOnly && row.state !== 'CANCELLED');
  const markdownT0 = markdown.filter((row) => row.tier === 'T0');
  if (markdown.length >= 3 && markdownT0.length / markdown.length >= SUGGEST_RATIO) {
    const docs = builtinRecipe(rootDir, 'docs-light');
    const node = docs.nodes.find((item) => item.id === 'documentation-context') || {
      id: 'documentation-context',
      type: 'approval',
      message: 'Docs-light path for markdown-only tasks.'
    };
    consider({
      kind: 'docs-light-markdown',
      evidence: evidenceFor(markdownT0.map((row) => row.runId), {
        t0: markdownT0.length,
        markdown: markdown.length,
        ratio: markdownT0.length / markdown.length
      }),
      recipe: candidateRecipeWithNode(current, node, 'goal', 'maker')
    });
  }

  const recentT1 = t1.slice(-RISK_WINDOW);
  const drifted = recentT1.filter((row) => Number(row.outOfMapCount || 0) > 0);
  if (recentT1.length >= RISK_WINDOW && drifted.length >= RISK_COUNT) {
    consider({
      kind: 'impact-checkpoint-t1',
      evidence: evidenceFor(drifted.map((row) => row.runId), {
        drifted: drifted.length,
        window: recentT1.length,
        ratio: drifted.length / recentT1.length
      }),
      recipe: candidateRecipeWithNode(current, {
        id: 'impact-checkpoint',
        type: 'approval',
        message: 'Confirm the blast-radius map before Maker (out-of-map T1 edits).'
      }, 'goal', 'maker')
    });
  }

  const learningCounts = {};
  for (const row of history) {
    for (const id of row.learningIds || []) {
      learningCounts[id] = learningCounts[id] || { count: 0, runIds: [] };
      learningCounts[id].count += 1;
      learningCounts[id].runIds.push(row.runId);
    }
  }
  const top = Object.entries(learningCounts)
    .filter(([, info]) => info.count >= LEARNING_MIN)
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))[0];
  if (top) {
    const [learningId, info] = top;
    consider({
      kind: 'learning-checklist',
      evidence: evidenceFor(info.runIds, { [learningId]: info.count, ratio: info.count / history.length }),
      recipe: (() => {
        const recipe = clone(current);
        recipe.id = PERSONAL_ID;
        recipe.description = `${recipe.description || 'Personal workflow'} [${learningId}]`;
        return recipe;
      })()
    });
  }

  return { proposals: created, historyCount: history.length };
}

function countsFromRun(rootDir, run) {
  const runDir = path.join(runsDir(rootDir), run.runId);
  let impact = null;
  let outOfMapCount = 0;
  let markdownOnly = false;
  try {
    const map = JSON.parse(fs.readFileSync(path.join(runDir, 'impact-map.json'), 'utf8'));
    if (map.status === 'CONFIRMED') impact = 'confirm';
    else if (map.status === 'SKIPPED') impact = 'skip';
  } catch {
    // Optional artifact.
  }
  try {
    const drift = JSON.parse(fs.readFileSync(path.join(runDir, 'impact-drift.json'), 'utf8'));
    const out = Array.isArray(drift.outOfMap) ? drift.outOfMap : [];
    outOfMapCount = out.length;
    const changed = Array.isArray(drift.changedFiles) ? drift.changedFiles : [];
    markdownOnly = changed.length > 0 && changed.every((file) => /\.(md|markdown)$/i.test(String(file).split(/[/\\]/).pop() || ''));
  } catch {
    // Optional artifact.
  }
  let guardWarn = 0;
  let guardBlock = 0;
  try {
    const summary = require('./guard.js').guardSummary(rootDir, run.runId);
    guardWarn = summary.warn;
    guardBlock = summary.block;
  } catch {
    // Optional artifact.
  }
  let learningIds = [];
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(rootDir, '.ai-engineering-loop', 'learnings.json'), 'utf8'));
    learningIds = (doc.entries || [])
      .filter((entry) => Array.isArray(entry.runIds) && entry.runIds.includes(run.runId))
      .map((entry) => entry.id)
      .filter((id) => LEARNING_ID.test(String(id || '')));
  } catch {
    // Optional artifact.
  }
  const gates = {};
  for (const entry of run.history || []) {
    if (!GATE_ID.test(String(entry.gate || '')) || !RUN_STATES[entry.to]) continue;
    gates[String(entry.gate)] = String(entry.to);
  }
  return {
    impact,
    outOfMapCount,
    markdownOnly,
    guardWarn,
    guardBlock,
    learningIds,
    gates
  };
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let descriptor;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY | noFollow,
      0o600
    );
    if (!fs.fstatSync(descriptor).isFile()) throw new Error('history is not a regular file');
    fs.writeSync(descriptor, `${JSON.stringify(value)}\n`);
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
  }
}

function appendRunSummary(rootDir, run, { home, env = process.env, now = new Date() } = {}) {
  if (!run || !TERMINAL_STATES.has(run.state)) return null;
  if (!canUseUserWorkflow(env) && !env.AEL_HOME) return null;
  const resolved = resolveHome(home, env);
  const counts = countsFromRun(rootDir, run);
  const summary = {
    schemaVersion: 1,
    at: (now && typeof now.toISOString === 'function' ? now : new Date()).toISOString(),
    runId: run.runId,
    state: run.state,
    mode: run.mode || null,
    tier: run.tier && run.tier.current ? run.tier.current : null,
    recipeId: run.workflow && run.workflow.recipeId ? run.workflow.recipeId : null,
    workflowSource: run.workflow && run.workflow.workflowSource ? run.workflow.workflowSource : null,
    iterations: run.iteration || 1,
    repoHash: repoHash(rootDir),
    impact: counts.impact,
    outOfMapCount: counts.outOfMapCount,
    markdownOnly: counts.markdownOnly,
    guard: { warn: counts.guardWarn, block: counts.guardBlock },
    learningIds: counts.learningIds,
    gates: counts.gates
  };
  const line = redactHomePaths(redactSecrets(JSON.stringify(summary)).text);
  const parsed = JSON.parse(line);
  const clean = {};
  for (const key of SUMMARY_KEYS) clean[key] = parsed[key];
  appendJsonl(workflowHistoryPath(resolved), clean);
  return clean;
}

module.exports = {
  PERSONAL_ID,
  SUGGEST_WINDOW,
  SUGGEST_RATIO,
  BACKBONE_CODES,
  INTERVIEW_QUESTIONS,
  canUseUserWorkflow,
  repoHash,
  readPersonalRecipe,
  loadProjectWorkflowConfig,
  resolveRunWorkflow,
  interviewQuestions,
  recipeFromAnswers,
  proposeFromAnswers,
  acceptProposal,
  rejectProposal,
  suggestProposals,
  listProposals,
  appendRunSummary,
  diffRecipeObjects,
  compileOrThrow
};
