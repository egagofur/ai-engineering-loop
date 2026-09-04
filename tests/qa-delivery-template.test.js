'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readRepo(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const QA_HEADINGS = [
  /## Steps to Reproduce & Testing \(QA\)/,
  /### Pre-conditions/,
  /### Steps to Reproduce/,
  /### How to Test/,
  /### Actual Result/,
  /### Expected Result/
];

const HOSTS = [
  '.claude/skills/ai-engineering-loop/SKILL.md',
  '.grok/skills/ai-engineering-loop/SKILL.md',
  '.gemini/skills/ai-engineering-loop/SKILL.md',
  '.agents/workflows/ai-engineering-loop.md'
];

test('AC-1 GitHub PR and GitLab MR bodies include the QA reproduce and how-to-test block', () => {
  for (const rel of [
    'adapters/github/pull-request.md',
    'adapters/gitlab/merge-request.md'
  ]) {
    const text = readRepo(rel);
    for (const heading of QA_HEADINGS) {
      assert.match(text, heading, `${rel} missing ${heading}`);
    }
  }
});

test('AC-2 pure feature may mark Actual Result N/A; How to Test stays required', () => {
  for (const rel of [
    'adapters/github/pull-request.md',
    'adapters/gitlab/merge-request.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, /N\/A on a pure feature/, rel);
    assert.match(text, /### How to Test/, rel);
    assert.match(text, /### Expected Result/, rel);
  }
});

test('AC-3 QA block does not become a dump of diffs, tokens, or machine paths', () => {
  for (const rel of [
    'adapters/github/pull-request.md',
    'adapters/gitlab/merge-request.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, /Do not paste raw diffs, tokens, or local machine paths/, rel);
  }
});

test('AC-4 generic GitLab stays non-DOT; standard does not copy the DOT issue card; DOT issue and MR both have the QA block', () => {
  const gitlab = readRepo('adapters/gitlab/merge-request.md');
  assert.doesNotMatch(gitlab, /Coreview/);
  assert.doesNotMatch(gitlab, /Mattermost/);

  const standard = readRepo('adapters/standard/README.md');
  assert.match(standard, /Steps to Reproduce & Testing \(QA\)/);
  assert.doesNotMatch(standard, /Ready to Test/);

  const dot = readRepo('adapters/dot/gitlab.md');
  const hits = dot.split('## Steps to Reproduce & Testing (QA)').length - 1;
  assert.ok(hits >= 2, `DOT gitlab.md needs QA block on issue and MR, got ${hits}`);
  for (const heading of QA_HEADINGS) {
    assert.match(dot, heading, `DOT gitlab.md missing ${heading}`);
  }
});

test('AC-5 host Stage 8 and DOT Stage 8a require the QA block; bugfix placeholders must not stay empty', () => {
  for (const rel of HOSTS) {
    const text = readRepo(rel);
    assert.match(text, /Steps to Reproduce & Testing \(QA\)/, rel);
  }
  const delivery = readRepo('adapters/dot/skills/dot-dev-workflow/SKILL.md');
  assert.match(delivery, /Steps to Reproduce & Testing \(QA\)/);
  assert.match(delivery, /bugfix placeholders must not stay empty|do not leave those placeholders empty/i);
  assert.doesNotMatch(delivery, /```mermaid/);
});
