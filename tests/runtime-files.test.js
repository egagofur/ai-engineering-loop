const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  PRIVATE_RUNTIME_PATTERNS,
  ensurePrivateRuntimeIgnores
} = require('../lib/runtime-files.js');

test('runtime ignore repair preserves user rules and adds every private path once', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-runtime-files-'));
  const context = path.join(root, '.ai-engineering-loop');
  fs.mkdirSync(context, { recursive: true });
  fs.writeFileSync(path.join(context, '.gitignore'), 'custom/\nruns/\n');
  assert.strictEqual(ensurePrivateRuntimeIgnores(root), true);
  assert.strictEqual(ensurePrivateRuntimeIgnores(root), false);
  const lines = fs.readFileSync(path.join(context, '.gitignore'), 'utf8').split(/\r?\n/);
  assert.ok(lines.includes('custom/'));
  for (const pattern of PRIVATE_RUNTIME_PATTERNS) {
    assert.strictEqual(lines.filter((line) => line === pattern).length, 1);
  }
});

test('runtime ignore repair rejects a symlink destination', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-runtime-link-'));
  const context = path.join(root, '.ai-engineering-loop');
  fs.mkdirSync(context, { recursive: true });
  const target = path.join(root, 'missing-target');
  try {
    fs.symlinkSync(target, path.join(context, '.gitignore'), 'file');
  } catch (cause) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(cause.code)) {
      t.skip('file symlinks require Windows developer mode');
      return;
    }
    throw cause;
  }
  assert.throws(
    () => ensurePrivateRuntimeIgnores(root),
    (err) => err.code === 'UNSAFE_RUNTIME_PATH'
  );
  assert.strictEqual(fs.existsSync(target), false);
});
