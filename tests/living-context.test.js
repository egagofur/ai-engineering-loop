const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'node -e ""' } }, null, 2)
  );
  return dir;
}

test('init writes glossary.md and adrs/README.md', () => {
  const dir = tmpRepo();
  execFileSync('node', [CLI, 'init'], { cwd: dir, encoding: 'utf8' });
  const glossary = path.join(dir, '.ai-engineering-loop', 'glossary.md');
  const adr = path.join(dir, '.ai-engineering-loop', 'adrs', 'README.md');
  assert.ok(fs.existsSync(glossary));
  assert.ok(fs.existsSync(adr));
  assert.match(fs.readFileSync(glossary, 'utf8'), /Ubiquitous Language/);
  assert.match(fs.readFileSync(adr, 'utf8'), /Architecture Decision Records/);
});

test('repair fills missing glossary without overwriting a filled glossary or architecture', () => {
  const dir = tmpRepo();
  execFileSync('node', [CLI, 'init'], { cwd: dir, encoding: 'utf8' });
  const glossary = path.join(dir, '.ai-engineering-loop', 'glossary.md');
  const architecture = path.join(dir, '.ai-engineering-loop', 'architecture.md');
  fs.writeFileSync(glossary, '# Custom glossary\n- Foo: bar\n');
  const archBefore = fs.readFileSync(architecture, 'utf8');
  fs.unlinkSync(glossary);
  execFileSync('node', [CLI, 'init'], { cwd: dir, encoding: 'utf8' });
  assert.ok(fs.existsSync(glossary));
  assert.strictEqual(fs.readFileSync(architecture, 'utf8'), archBefore);
  fs.writeFileSync(glossary, '# Custom glossary\n- Foo: bar\n');
  fs.unlinkSync(architecture);
  execFileSync('node', [CLI, 'init'], { cwd: dir, encoding: 'utf8' });
  assert.match(fs.readFileSync(glossary, 'utf8'), /Foo: bar/);
  assert.ok(fs.existsSync(architecture));
});
