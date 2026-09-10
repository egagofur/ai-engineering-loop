'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { NODE_ID, RECIPE_ID } = require('./recipe.js');
const { ensurePrivateRuntimeIgnores } = require('./runtime-files.js');

const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;
const MAX_COORDINATE = 1_000_000;

function layoutError(message, code = 'INVALID_STUDIO_LAYOUT') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function finiteCoordinate(value, label) {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
    throw layoutError(`${label} must be a finite coordinate within ${MAX_COORDINATE}`);
  }
  return value;
}

function normalizeStudioLayout(recipeId, value, allowedNodeIds) {
  if (!RECIPE_ID.test(String(recipeId || ''))) throw layoutError('Invalid layout recipe id');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw layoutError('Studio layout must be an object');
  }
  const allowed = allowedNodeIds ? new Set(allowedNodeIds) : null;
  const positions = {};
  for (const [nodeId, position] of Object.entries(value.positions || {})) {
    if (!NODE_ID.test(nodeId)) throw layoutError(`Invalid layout node id: ${nodeId}`);
    if (allowed && !allowed.has(nodeId)) continue;
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      throw layoutError(`Position for ${nodeId} must be an object`);
    }
    positions[nodeId] = {
      x: finiteCoordinate(position.x, `${nodeId}.x`),
      y: finiteCoordinate(position.y, `${nodeId}.y`)
    };
  }
  const viewport = value.viewport || { x: 0, y: 0, scale: 1 };
  const scale = Number(viewport.scale);
  if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
    throw layoutError(`viewport.scale must be between ${MIN_SCALE} and ${MAX_SCALE}`);
  }
  return {
    schemaVersion: 1,
    recipeId,
    positions,
    viewport: {
      x: finiteCoordinate(viewport.x, 'viewport.x'),
      y: finiteCoordinate(viewport.y, 'viewport.y'),
      scale
    }
  };
}

function layoutDirectory(rootDir) {
  return path.join(rootDir, '.ai-engineering-loop', 'studio-layouts');
}

function layoutPath(rootDir, recipeId) {
  if (!RECIPE_ID.test(String(recipeId || ''))) throw layoutError('Invalid layout recipe id');
  return path.join(layoutDirectory(rootDir), `${recipeId}.json`);
}

function loadStudioLayout(rootDir, recipeId, { nodeIds } = {}) {
  const filePath = layoutPath(rootDir, recipeId);
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw layoutError('Studio layout must be a regular file', 'UNSAFE_STUDIO_LAYOUT');
  }
  try {
    return normalizeStudioLayout(recipeId, JSON.parse(fs.readFileSync(filePath, 'utf8')), nodeIds);
  } catch (cause) {
    if (cause.code) throw cause;
    throw layoutError(`Unable to read Studio layout: ${cause.message}`);
  }
}

function saveStudioLayout(rootDir, recipeId, value, { nodeIds } = {}) {
  const layout = normalizeStudioLayout(recipeId, value, nodeIds);
  ensurePrivateRuntimeIgnores(rootDir);
  const directory = layoutDirectory(rootDir);
  if (fs.existsSync(directory) && (fs.lstatSync(directory).isSymbolicLink() || !fs.lstatSync(directory).isDirectory())) {
    throw layoutError('Studio layout directory must be a regular directory', 'UNSAFE_STUDIO_LAYOUT');
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = layoutPath(rootDir, recipeId);
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) {
    throw layoutError('Studio layout must not be a symbolic link', 'UNSAFE_STUDIO_LAYOUT');
  }
  const temporary = `${destination}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(layout, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, destination);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
  return layout;
}

module.exports = {
  MIN_SCALE,
  MAX_SCALE,
  normalizeStudioLayout,
  loadStudioLayout,
  saveStudioLayout
};
