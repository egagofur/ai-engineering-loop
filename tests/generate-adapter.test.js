'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  recommendType,
  detectAdapterHints,
  writeShippedAdapter,
  parseTypeArg
} = require('../lib/generate-adapter.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-adapter-'));
}

test('recommendType maps github and gitlab remotes; unknown is standard', () => {
  assert.strictEqual(recommendType('git@github.com:acme/app.git'), 'github');
  assert.strictEqual(recommendType('https://gitlab.com/acme/app.git'), 'gitlab');
  assert.strictEqual(recommendType(''), 'standard');
  assert.strictEqual(recommendType('git@example.com:acme/app.git'), 'standard');
});

test('writeShippedAdapter writes adapter.md for --type github', () => {
  const dir = tmpRepo();
  const dest = writeShippedAdapter(dir, {
    type: 'github',
    hints: { remote: 'https://github.com/acme/app.git', ciProvider: 'GitHub Actions' }
  });
  const text = fs.readFileSync(dest, 'utf8');
  assert.match(text, /adapter_type\*\*: "github"/);
  assert.match(text, /adapters\/github\//);
  assert.doesNotMatch(text, /Mattermost/);
});

test('writeShippedAdapter rejects unknown types', () => {
  const dir = tmpRepo();
  assert.throws(
    () => writeShippedAdapter(dir, { type: 'bitbucket', hints: { remote: '', ciProvider: 'none' } }),
    /Unknown adapter type/
  );
});

test('parseTypeArg reads --type', () => {
  assert.strictEqual(parseTypeArg(['generate-adapter', '--type', 'gitlab']), 'gitlab');
  assert.strictEqual(parseTypeArg(['generate-adapter']), null);
});

test('CLI generate-adapter without --type prints grill protocol', () => {
  const dir = tmpRepo();
  const out = execFileSync('node', [CLI, 'generate-adapter'], { cwd: dir, encoding: 'utf8' });
  assert.match(out, /recommended:/);
  assert.match(out, /generate-adapter/);
  assert.match(out, /Q1-Q5/);
  assert.ok(!fs.existsSync(path.join(dir, '.ai-engineering-loop', 'adapter.md')));
});

test('CLI generate-adapter --type standard writes adapter.md', () => {
  const dir = tmpRepo();
  const out = execFileSync('node', [CLI, 'generate-adapter', '--type', 'standard'], {
    cwd: dir,
    encoding: 'utf8'
  });
  assert.match(out, /Wrote:/);
  const text = fs.readFileSync(path.join(dir, '.ai-engineering-loop', 'adapter.md'), 'utf8');
  assert.match(text, /adapter_type\*\*: "standard"/);
});

test('detectAdapterHints reads existing adapter.md', () => {
  const dir = tmpRepo();
  writeShippedAdapter(dir, { type: 'gitlab', hints: { remote: '', ciProvider: 'none' } });
  const hints = detectAdapterHints(dir);
  assert.strictEqual(hints.existingType, 'gitlab');
});
