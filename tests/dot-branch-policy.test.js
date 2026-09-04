'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readRepo(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const MULTI = 'adapters/dot/multi-branch.md';
const README = 'adapters/dot/README.md';
const WORKFLOW = 'adapters/dot/skills/dot-dev-workflow/SKILL.md';

test('AC-1 unrelated HEAD and in-use develop: new topic branch from origin/develop after fetch/pull', () => {
  const text = `${readRepo(MULTI)}\n${readRepo(WORKFLOW)}`;
  assert.match(text, /unrelated|not related/i);
  assert.match(text, /git fetch origin/);
  assert.match(text, /origin\/develop/);
  assert.match(text, /git checkout -b/);
  assert.match(text, /Do not `git pull` into the current HEAD/);
  assert.doesNotMatch(readRepo(MULTI), /git pull origin develop/);
  assert.match(text, /HEAD being `main` does not override an in-use `develop` default/);
});

test('AC-2 related feat/fix branch stays; do not create another topic branch or three MRs', () => {
  const text = `${readRepo(MULTI)}\n${readRepo(WORKFLOW)}`;
  assert.match(text, /feat\//);
  assert.match(text, /fix\//);
  assert.match(text, /Stay on that branch|keep the current branch/i);
  assert.match(text, /Do not create a new topic branch/i);
  assert.match(text, /Do not open three MRs|one MR/i);
});

test('AC-3 main or unused leftover develop: new topic branch from origin/main', () => {
  const text = `${readRepo(MULTI)}\n${readRepo(WORKFLOW)}`;
  assert.match(text, /unused leftover/i);
  assert.match(text, /origin\/main/);
  assert.match(text, /Do not force leftover develop/);
  assert.match(text, /even if HEAD is `develop`/);
});

test('AC-4 generic GitHub/GitLab stay non-DOT; extra envs only if adapter.md lists them', () => {
  const gitlab = readRepo('adapters/gitlab/README.md');
  const github = readRepo('adapters/github/README.md');
  assert.match(gitlab, /not the DOT adapter/);
  assert.match(gitlab, /No extra environment cherry-picks unless/);
  assert.doesNotMatch(gitlab, /Coreview/);
  assert.match(github, /Extra branches, review bots, and chat are \*\*off\*\*/);
});

test('AC-5 chat setuju is not propagate; extra env MRs only if named this turn', () => {
  const text = `${readRepo(MULTI)}\n${readRepo(WORKFLOW)}\n${readRepo(README)}`;
  assert.match(text, /setuju/);
  assert.match(text, /this turn/);
  assert.match(text, /Do not cherry-pick to `staging` or `develop` unless/i);
  const workflow = readRepo(WORKFLOW);
  assert.doesNotMatch(workflow, /```mermaid/);
  assert.doesNotMatch(workflow, /commit, propagate, reply/);
  assert.match(workflow, /push to the same topic MR/);
  assert.doesNotMatch(readRepo(README), /fix & propagate/);
});
