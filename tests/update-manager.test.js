'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildUpdatePlan,
  checkForUpdate,
  compareVersions,
  updateCommands
} = require('../lib/update-manager.js');

function tempPackage(version = '1.11.0') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-update-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'ai-engineering-loop',
    version
  }, null, 2));
  return root;
}

test('compares semantic versions without treating equal versions as updates', () => {
  assert.equal(compareVersions('1.11.0', '1.11.0'), 0);
  assert.equal(compareVersions('1.11.0', '1.12.0'), -1);
  assert.equal(compareVersions('1.12.1', '1.12.0'), 1);
});

test('global update plan keeps package install separate from host sync and diagnostics', () => {
  const plan = buildUpdatePlan({
    packageName: 'ai-engineering-loop',
    currentVersion: '1.11.0',
    latestVersion: '1.12.0',
    installScope: 'global'
  });

  assert.equal(plan.updateAvailable, true);
  assert.deepEqual(plan.commands.map((item) => item.display), [
    'npm install --global ai-engineering-loop@latest',
    'ai-engineering-loop sync-hosts',
    'ai-engineering-loop refresh',
    'ai-engineering-loop doctor'
  ]);
});

test('project update plan uses local dependency install and npx follow-up commands', () => {
  assert.deepEqual(updateCommands('ai-engineering-loop', 'project').map((item) => item.display), [
    'npm install ai-engineering-loop@latest --save-dev',
    'npx ai-engineering-loop sync-hosts',
    'npx ai-engineering-loop refresh',
    'npx ai-engineering-loop doctor'
  ]);
});

test('checkForUpdate can be resolved deterministically without network access', () => {
  const root = tempPackage('1.11.0');
  const plan = checkForUpdate(root, {
    latestVersion: '1.12.0',
    installScope: 'global'
  });

  assert.equal(plan.packageName, 'ai-engineering-loop');
  assert.equal(plan.currentVersion, '1.11.0');
  assert.equal(plan.latestVersion, '1.12.0');
  assert.equal(plan.updateAvailable, true);
});
