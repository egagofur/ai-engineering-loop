'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  loadStudioLayout,
  normalizeStudioLayout,
  saveStudioLayout
} = require('../lib/studio-layout.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-layout-'));
}

test('Studio layout persists viewport and positions outside recipe semantics', () => {
  const root = tempRepo();
  const saved = saveStudioLayout(root, 'project-flow', {
    positions: {
      goal: { x: -240.5, y: 80 },
      maker: { x: 420, y: 180 }
    },
    viewport: { x: 100, y: -50, scale: 1.25 }
  }, { nodeIds: ['goal', 'maker'] });
  assert.deepEqual(loadStudioLayout(root, 'project-flow', { nodeIds: ['goal', 'maker'] }), saved);
  assert.match(
    fs.readFileSync(path.join(root, '.ai-engineering-loop', '.gitignore'), 'utf8'),
    /^studio-layouts\/$/m
  );
});

test('Studio layout rejects unsafe ids, coordinates, scale, and symlink destinations', () => {
  assert.throws(
    () => normalizeStudioLayout('../escape', { positions: {}, viewport: { x: 0, y: 0, scale: 1 } }),
    { code: 'INVALID_STUDIO_LAYOUT' }
  );
  assert.throws(
    () => normalizeStudioLayout('flow', { positions: { goal: { x: Infinity, y: 0 } }, viewport: { x: 0, y: 0, scale: 1 } }),
    /finite coordinate/
  );
  assert.throws(
    () => normalizeStudioLayout('flow', { positions: {}, viewport: { x: 0, y: 0, scale: 9 } }),
    /viewport.scale/
  );
  const root = tempRepo();
  const layouts = path.join(root, '.ai-engineering-loop', 'studio-layouts');
  fs.mkdirSync(path.dirname(layouts), { recursive: true });
  fs.symlinkSync(os.tmpdir(), layouts);
  assert.throws(
    () => saveStudioLayout(root, 'flow', { positions: {}, viewport: { x: 0, y: 0, scale: 1 } }),
    { code: 'UNSAFE_STUDIO_LAYOUT' }
  );
});

test('Studio layout drops stale positions that are not in the current recipe', () => {
  const normalized = normalizeStudioLayout('flow', {
    positions: {
      goal: { x: 0, y: 0 },
      removed: { x: 10, y: 10 }
    },
    viewport: { x: 0, y: 0, scale: 1 }
  }, ['goal']);
  assert.deepEqual(Object.keys(normalized.positions), ['goal']);
});
