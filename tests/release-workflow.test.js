const test = require('node:test');
const assert = require('node:assert');
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
