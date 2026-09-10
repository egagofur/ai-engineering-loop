'use strict';

const crypto = require('crypto');

const EDGE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_EDGES = 256;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableEdgeId(from, to) {
  const digest = crypto.createHash('sha256').update(`${from}\0${to}`).digest('hex').slice(0, 16);
  return `edge-${digest}`;
}

function migrateLegacyRecipe(recipe) {
  const migrated = clone(recipe);
  if (!migrated || typeof migrated !== 'object' || Array.isArray(migrated)) return migrated;
  if (!Array.isArray(migrated.edges)) {
    migrated.edges = [];
    for (const node of Array.isArray(migrated.nodes) ? migrated.nodes : []) {
      for (const dependency of Array.isArray(node?.dependsOn) ? node.dependsOn : []) {
        migrated.edges.push({ id: stableEdgeId(dependency, node.id), from: dependency, to: node.id });
      }
    }
  }
  for (const node of Array.isArray(migrated.nodes) ? migrated.nodes : []) {
    if (node && typeof node === 'object') delete node.dependsOn;
  }
  return migrated;
}

function withDependencies(recipe) {
  const projected = migrateLegacyRecipe(recipe);
  const byId = new Map((projected.nodes || []).map((node) => [node.id, node]));
  for (const node of projected.nodes || []) node.dependsOn = [];
  for (const edge of projected.edges || []) {
    if (byId.has(edge?.to)) byId.get(edge.to).dependsOn.push(edge.from);
  }
  return projected;
}

function uniqueId(preferred, occupied) {
  if (!occupied.has(preferred)) {
    occupied.add(preferred);
    return preferred;
  }
  for (let suffix = 2; ; suffix++) {
    const ending = `-${suffix}`;
    const candidate = `${preferred.slice(0, 64 - ending.length)}${ending}`;
    if (!occupied.has(candidate)) {
      occupied.add(candidate);
      return candidate;
    }
  }
}

function planGraphMerge(existingRecipe, importedRecipe) {
  const existing = migrateLegacyRecipe(existingRecipe);
  const imported = migrateLegacyRecipe(importedRecipe);
  const nodeIds = new Set((existing.nodes || []).map((node) => node.id));
  const edgeIds = new Set((existing.edges || []).map((edge) => edge.id));
  const nodeIdMap = {};
  const edgeIdMap = {};
  for (const node of imported.nodes || []) nodeIdMap[node.id] = uniqueId(node.id, nodeIds);
  for (const edge of imported.edges || []) edgeIdMap[edge.id] = uniqueId(edge.id, edgeIds);
  return { nodeIdMap, edgeIdMap };
}

function mergeGraphs(existingRecipe, importedRecipe, plan) {
  const existing = migrateLegacyRecipe(existingRecipe);
  const imported = migrateLegacyRecipe(importedRecipe);
  const nodes = imported.nodes.map((node) => ({ ...node, id: plan.nodeIdMap[node.id] }));
  const edges = imported.edges.map((edge) => ({
    ...edge,
    id: plan.edgeIdMap[edge.id],
    from: plan.nodeIdMap[edge.from],
    to: plan.nodeIdMap[edge.to]
  }));
  return { ...existing, nodes: [...existing.nodes, ...nodes], edges: [...existing.edges, ...edges] };
}

module.exports = {
  EDGE_ID,
  MAX_EDGES,
  mergeGraphs,
  migrateLegacyRecipe,
  planGraphMerge,
  stableEdgeId,
  withDependencies
};
