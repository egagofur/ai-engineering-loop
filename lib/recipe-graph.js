'use strict';

const { sha256 } = require('./fsutil.js');

const EDGE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_EDGES = 256;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableEdgeId(from, to) {
  const digest = sha256(`${from}\0${to}`).slice(0, 16);
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

module.exports = {
  EDGE_ID,
  MAX_EDGES,
  migrateLegacyRecipe,
  stableEdgeId,
  withDependencies
};
