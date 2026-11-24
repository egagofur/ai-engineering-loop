'use strict';

// DOT delivery must never close the card. GitLab closes an issue on merge to
// the default branch when a commit message or MR description says
// "Closes #n", "Fixes #n", "Resolves #n" or "Implements #n". The DOT adapter
// moves the card to "Ready to review" and leaves closing to humans.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOT = path.join(ROOT, 'adapters/dot');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

// GitLab's default closing pattern, followed by an issue reference, an issue
// URL, or a template placeholder an agent would fill with one.
const CLOSING = /\b(?:clos(?:e[sd]?|ing)|fix(?:e[sd]|ing)?|resolv(?:e[sd]?|ing)|implement(?:s|ed|ing)?):? +(?:issues? +)?(?:[\w.\/-]*#\d|#<|<|https?:\/\/\S*\/issues\/)/i;

test('no DOT template or example uses a GitLab closing keyword', () => {
  const hits = [];
  for (const file of markdownFiles(DOT)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (CLOSING.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepStrictEqual(hits, [], `closing keywords would auto-close the card on merge:\n${hits.join('\n')}`);
});

test('gitlab.md and the DOT workflow skill forbid closing the card', () => {
  for (const rel of ['adapters/dot/gitlab.md', 'adapters/dot/skills/dot-dev-workflow/SKILL.md']) {
    const text = read(rel);
    assert.match(text, /never closes the card/i, `${rel}: states the no-close rule`);
    assert.match(text, /`Refs #<issue-iid>`/, `${rel}: names the safe reference form`);
  }
});
