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
  const workflow = path.join(dir, '.ai-engineering-loop', 'workflow.md');
  const lessons = path.join(dir, '.ai-engineering-loop', 'lessons.md');
  assert.ok(fs.existsSync(glossary));
  assert.ok(fs.existsSync(adr));
  assert.ok(fs.existsSync(workflow));
  assert.ok(fs.existsSync(lessons));
  assert.match(fs.readFileSync(glossary, 'utf8'), /Ubiquitous Language/);
  assert.match(fs.readFileSync(adr, 'utf8'), /Architecture Decision Records/);
  assert.match(fs.readFileSync(workflow, 'utf8'), /before_grill/);
  assert.match(fs.readFileSync(lessons, 'utf8'), /# Lessons/);
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

test('init does not overwrite filled lessons.md', () => {
  const dir = tmpRepo();
  execFileSync('node', [CLI, 'init'], { cwd: dir, encoding: 'utf8' });
  const lessons = path.join(dir, '.ai-engineering-loop', 'lessons.md');
  fs.writeFileSync(lessons, '# Lessons\n\n| Date | Lesson | Do not |\n|---|---|---|\n| 2026-08-30 | Keep Figma | skip Figma |\n');
  execFileSync('node', [CLI, 'init'], { cwd: dir, encoding: 'utf8' });
  assert.match(fs.readFileSync(lessons, 'utf8'), /Keep Figma/);
});
