'use strict';

// C-18: suppressions and justification comments in the diff become findings.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanComments, mergeCommentFindings } = require('../lib/comment-findings.js');

const diff = (file, lines) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`;

test('AC-1 an unexplained eslint-disable is a HIGH finding at file:line; a reasoned one is MEDIUM', () => {
  const [bare] = scanComments(diff('src/a.ts', ['const x = 1;', '// eslint-disable-next-line no-explicit-any']));
  assert.strictEqual(bare.severity, 'HIGH');
  assert.strictEqual(bare.location, 'src/a.ts:2');
  assert.strictEqual(bare.axis, 'standards');
  assert.match(bare.concreteAlternativeDiff, /remove the suppression/);
  const [reasoned] = scanComments(diff('src/a.ts', ['// eslint-disable-next-line no-explicit-any -- third-party typings are wrong, tracked in #42']));
  assert.strictEqual(reasoned.severity, 'MEDIUM');
  for (const line of ['// @ts-ignore', 'x = f()  # type: ignore', 'import os  # noqa', '/* istanbul ignore next */']) {
    assert.strictEqual(scanComments(diff('src/b.py', [line]))[0].severity, 'HIGH', line);
  }
});

test('justification comments are MEDIUM; plain "why" comments, tests and docs are ignored', () => {
  const [work] = scanComments(diff('src/a.js', ['setTimeout(fix, 0); // quick fix until the store is declarative']));
  assert.strictEqual(work.severity, 'MEDIUM');
  assert.match(work.failureScenario, /justifies a workaround/);
  assert.deepStrictEqual(scanComments(diff('src/a.js', ['// Retries cap at 3 because the upstream API rate-limits at 5/s'])), []);
  assert.deepStrictEqual(scanComments(diff('tests/a.test.js', ['// eslint-disable-next-line'])), []);
  assert.deepStrictEqual(scanComments(diff('docs/guide.md', ['a temporary workaround'])), []);
  assert.deepStrictEqual(scanComments(diff('src/a.js', ["const label = 'quick fix';"])), [], 'not a comment');
});

test('AC-3 projects can add their own justification patterns', () => {
  const extra = [/\bbypass the guard\b/i];
  assert.strictEqual(scanComments(diff('src/a.js', ['// bypass the guard here']), { extraPatterns: extra }).length, 1);
});

test('reviewers may dismiss a comment finding only with evidence', () => {
  const [item] = scanComments(diff('src/a.ts', ['// @ts-ignore']));
  assert.strictEqual(mergeCommentFindings({ findings: [] }, [item]).added, 1);
  assert.match(mergeCommentFindings({ findings: [{ ...item, validity: 'INVALID' }] }, [item]).errors[0], /without dismissal\.evidence/);
  const ok = { findings: [{ ...item, validity: 'INVALID', dismissal: { by: 'da', evidence: 'generated file from openapi; regenerated each build' } }] };
  assert.deepStrictEqual(mergeCommentFindings(ok, [item]).errors, []);
});
