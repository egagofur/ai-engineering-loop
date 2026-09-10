'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  listPackageFiles,
  auditText,
  auditPackage
} = require('../lib/package-audit.js');

const ROOT = path.join(__dirname, '..');

test('package privacy audit scans the npm allowlist without findings', () => {
  const result = auditPackage(ROOT);
  assert.strictEqual(result.ok, true, JSON.stringify(result.findings));
  assert.ok(result.filesScanned > 50);
});

test('package privacy audit detects local paths and private keys', () => {
  const fixtures = [
    'Read file:///Users/alice/project/secret.md',
    'Cache: C:\\Users\\alice\\project\\cache.json',
    'Home: /home/alice/project',
    '-----BEGIN PRIVATE KEY-----'
  ];
  for (const fixture of fixtures) {
    assert.ok(auditText(fixture, 'fixture.md').length > 0, fixture);
  }
});

test('package file listing includes runtime assets and excludes development tests', () => {
  const files = listPackageFiles(ROOT);
  assert.ok(files.includes('lib/gates.js'));
  assert.ok(files.includes('recipes/default.json'));
  assert.ok(files.includes('schemas/goal-contract.schema.json'));
  assert.ok(!files.includes('tests/gates.test.js'));
  assert.ok(!files.some((file) => file.startsWith('.delta/')));
});
