const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'publish.yml'),
  'utf8'
);

test('release workflow uses pinned OIDC-capable tooling without a long-lived npm token', () => {
  assert.match(workflow, /release:\s*\n\s*types: \[published\]/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /node-version: 22\.14\.0/);
  assert.match(workflow, /npm install --global npm@11\.6\.2/);
  assert.match(workflow, /scripts\/verify-release\.js/);
  assert.match(workflow, /npm publish --access public --provenance/);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN|npm_[A-Za-z0-9]{20,}/);
  assert.ok(
    workflow.indexOf('scripts/verify-release.js') < workflow.indexOf('npm publish'),
    'release identity must be checked before publish'
  );
});

test('release identity matches the package and public CLI versions', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'verify-release.js'), `v${pkg.version}`],
    { encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`v${pkg.version} = ${pkg.version}`));
});
