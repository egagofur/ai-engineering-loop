'use strict';

const LOOP_ID = /^[a-z][a-z0-9-]{0,63}$/;
const OUTCOME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const MAX_LOOP_GROUPS = 16;
const MAX_LOOP_ITERATIONS = 100;
const MAX_LOOP_LABEL = 40;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reachable(edges, from, to, allowed) {
  const pending = [from];
  const seen = new Set();
  while (pending.length) {
    const current = pending.shift();
    if (current === to) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of edges) {
      if (edge.from === current && allowed.has(edge.to)) pending.push(edge.to);
    }
  }
  return false;
}

function validateLoopGroups(recipe) {
  const errors = [];
  if (recipe.loopGroups == null) return { valid: true, errors };
  if (!Array.isArray(recipe.loopGroups)) return { valid: false, errors: ['loopGroups must be an array'] };
  if (recipe.loopGroups.length > MAX_LOOP_GROUPS) {
    errors.push(`loopGroups exceeds the maximum of ${MAX_LOOP_GROUPS}`);
  }
  const nodes = new Map((recipe.nodes || []).map((node) => [node.id, node]));
  const edges = Array.isArray(recipe.edges) ? recipe.edges : [];
  const groupIds = new Set();
  const owner = new Map();

  recipe.loopGroups.forEach((group, index) => {
    const location = `loopGroups[${index}]`;
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      errors.push(`${location} must be an object`);
      return;
    }
    if (!LOOP_ID.test(String(group.id || ''))) errors.push(`${location}.id is invalid`);
    else if (groupIds.has(group.id)) errors.push(`duplicate Loop Group id: ${group.id}`);
    else groupIds.add(group.id);
    if (!String(group.displayName || '').trim() || String(group.displayName).length > 80) {
      errors.push(`${location}.displayName must be between 1 and 80 characters`);
    }
    if (!Array.isArray(group.nodeIds) || group.nodeIds.length < 2) {
      errors.push(`${location}.nodeIds must contain at least two nodes`);
    }
    const members = new Set(group.nodeIds || []);
    if (members.size !== (group.nodeIds || []).length) errors.push(`${location}.nodeIds must be unique`);
    for (const nodeId of members) {
      if (!nodes.has(nodeId)) errors.push(`${location}.nodeIds references unknown node ${nodeId}`);
      if (owner.has(nodeId)) errors.push(`${nodeId} belongs to multiple Loop Groups`);
      else owner.set(nodeId, group.id);
    }
    for (const field of ['entryNodeId', 'decisionNodeId', 'repeatTargetId']) {
      if (!nodes.has(group[field])) errors.push(`${location}.${field} references unknown node ${group[field] || '(missing)'}`);
      else if (!members.has(group[field])) errors.push(`${location}.${field} must belong to the group`);
    }
    if (!nodes.has(group.exitTargetId)) {
      errors.push(`${location}.exitTargetId references unknown node ${group.exitTargetId || '(missing)'}`);
    } else if (members.has(group.exitTargetId)) {
      errors.push(`${location}.exitTargetId must be outside the group`);
    }
    if (group.entryNodeId === group.decisionNodeId) {
      errors.push(`${location}.entryNodeId and decisionNodeId must be different`);
    }
    if (!Number.isSafeInteger(group.maxIterations) ||
        group.maxIterations < 1 || group.maxIterations > MAX_LOOP_ITERATIONS) {
      errors.push(`${location}.maxIterations must be an integer from 1 to ${MAX_LOOP_ITERATIONS}`);
    }
    for (const field of ['repeatOutcome', 'exitOutcome']) {
      if (!OUTCOME.test(String(group[field] || ''))) errors.push(`${location}.${field} is invalid`);
    }
    if (group.repeatOutcome === group.exitOutcome) errors.push(`${location} outcomes must be different`);
    for (const field of ['repeatLabel', 'exitLabel']) {
      const value = String(group[field] || '').trim();
      if (!value || value.length > MAX_LOOP_LABEL || /[\u0000-\u001f\u007f]/.test(value)) {
        errors.push(`${location}.${field} must be 1-${MAX_LOOP_LABEL} printable characters`);
      }
    }

    for (const edge of edges) {
      const fromInside = members.has(edge.from);
      const toInside = members.has(edge.to);
      if (!fromInside && toInside && edge.to !== group.entryNodeId) {
        errors.push(`${location} may enter only through ${group.entryNodeId}`);
      }
      if (fromInside && !toInside &&
          (edge.from !== group.decisionNodeId || edge.to !== group.exitTargetId)) {
        errors.push(`${location} may exit only from ${group.decisionNodeId} to ${group.exitTargetId}`);
      }
    }
    if (!edges.some((edge) => edge.from === group.decisionNodeId && edge.to === group.exitTargetId)) {
      errors.push(`${location} requires an Edge from decisionNodeId to exitTargetId`);
    }
    if (nodes.has(group.entryNodeId) && nodes.has(group.decisionNodeId)) {
      for (const nodeId of members) {
        if (!reachable(edges, group.entryNodeId, nodeId, members)) {
          errors.push(`${location}.${nodeId} must be reachable from entryNodeId`);
        }
        if (!reachable(edges, nodeId, group.decisionNodeId, members)) {
          errors.push(`${location}.${nodeId} must lead to decisionNodeId`);
        }
      }
    }
  });
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function createLoopGroup(recipe, group) {
  const next = clone(recipe);
  next.loopGroups = [...(next.loopGroups || []), clone(group)];
  const validation = validateLoopGroups(next);
  if (!validation.valid) {
    const error = new Error(`Loop Group is invalid: ${validation.errors.join('; ')}`);
    error.code = 'INVALID_LOOP_GROUP';
    error.details = validation.errors;
    throw error;
  }
  return next;
}

function removeLoopGroup(recipe, groupId) {
  const next = clone(recipe);
  next.loopGroups = (next.loopGroups || []).filter((group) => group.id !== groupId);
  return next;
}

module.exports = {
  LOOP_ID,
  MAX_LOOP_GROUPS,
  MAX_LOOP_ITERATIONS,
  MAX_LOOP_LABEL,
  createLoopGroup,
  removeLoopGroup,
  validateLoopGroups
};
