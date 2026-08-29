'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  parseWorkflowFile,
  writeWorkflowOverlay,
  assertNoRequiredSkip,
  routeDurableNote,
  parseWriteArg
} = require('../lib/generate-workflow.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-workflow-'));
}

test('AC-1 writeWorkflowOverlay writes workflow.md and empty lessons.md', () => {
  const dir = tmpRepo();
  const wrote = writeWorkflowOverlay(dir, {});
  const workflow = fs.readFileSync(wrote.workflow, 'utf8');
  const lessons = fs.readFileSync(wrote.lessons, 'utf8');
  assert.match(workflow, /Goal Contract/);
  assert.match(workflow, /Devil's Advocate/);
  assert.match(workflow, /Judge/);
  assert.match(workflow, /verification/);
  assert.match(workflow, /before_grill/);
  assert.doesNotMatch(workflow, /skip Devil's Advocate/i);
  assert.match(lessons, /# Lessons/);
  assert.doesNotMatch(lessons, /\| 20\d{2}-/);
});

test('AC-2 missing workflow.md returns default overlay', () => {
  const dir = tmpRepo();
  const parsed = parseWorkflowFile(dir);
  assert.strictEqual(parsed.missing, true);
  assert.strictEqual(parsed.hooks.before_grill, 'none');
  assert.strictEqual(parsed.hooks.after_freeze, 'none');
  assert.strictEqual(parsed.hooks.after_pass, 'none');
  assert.deepStrictEqual(parsed.optionalSkips, []);
  assert.deepStrictEqual(parsed.required, [
    'goal_contract',
    'verification',
    'devil_advocate',
    'judge'
  ]);
});

test('AC-3 skip devil_advocate is rejected and does not write', () => {
  const dir = tmpRepo();
  assert.throws(
    () => writeWorkflowOverlay(dir, { optionalSkips: ['devil_advocate'] }),
    /cannot skip/
  );
  assert.ok(!fs.existsSync(path.join(dir, '.ai-engineering-loop', 'workflow.md')));
  assert.throws(() => assertNoRequiredSkip(['judge']), /cannot skip/);
  assert.throws(() => assertNoRequiredSkip(['goal_contract']), /cannot skip/);
  assert.throws(() => assertNoRequiredSkip(['verification']), /cannot skip/);
  assert.doesNotThrow(() => assertNoRequiredSkip(['blast_radius']));
});

test('AC-4 routeDurableNote sends term to glossary and process to lessons', () => {
  assert.strictEqual(routeDurableNote('term'), 'glossary.md');
  assert.strictEqual(routeDurableNote('process'), 'lessons.md');
  assert.strictEqual(routeDurableNote('convention'), 'conventions.md');
  assert.strictEqual(routeDurableNote('adr'), 'adrs/');
});

test('AC-5 --write does not overwrite filled lessons.md', () => {
  const dir = tmpRepo();
  const ctx = path.join(dir, '.ai-engineering-loop');
  fs.mkdirSync(ctx, { recursive: true });
  const lessonsPath = path.join(ctx, 'lessons.md');
  fs.writeFileSync(lessonsPath, '# Lessons\n\n| Date | Lesson | Do not |\n|---|---|---|\n| 2026-08-30 | Keep the Figma step | skip Figma |\n');
  writeWorkflowOverlay(dir, {});
  const after = fs.readFileSync(lessonsPath, 'utf8');
  assert.match(after, /Keep the Figma step/);
  assert.ok(fs.existsSync(path.join(ctx, 'workflow.md')));
});

test('parseWriteArg reads --write', () => {
  assert.strictEqual(parseWriteArg(['generate-workflow', '--write']), true);
  assert.strictEqual(parseWriteArg(['generate-workflow']), false);
});

test('CLI generate-workflow without --write prints grill protocol', () => {
  const dir = tmpRepo();
  const out = execFileSync('node', [CLI, 'generate-workflow'], { cwd: dir, encoding: 'utf8' });
  assert.match(out, /generate-workflow/);
  assert.match(out, /Q1-Q5/);
  assert.ok(!fs.existsSync(path.join(dir, '.ai-engineering-loop', 'workflow.md')));
});

test('CLI generate-workflow --write writes overlay files', () => {
  const dir = tmpRepo();
  const out = execFileSync('node', [CLI, 'generate-workflow', '--write'], {
    cwd: dir,
    encoding: 'utf8'
  });
  assert.match(out, /Wrote:/);
  assert.ok(fs.existsSync(path.join(dir, '.ai-engineering-loop', 'workflow.md')));
  assert.ok(fs.existsSync(path.join(dir, '.ai-engineering-loop', 'lessons.md')));
});
