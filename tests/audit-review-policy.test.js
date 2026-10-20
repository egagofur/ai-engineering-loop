'use strict';

// #57: recipe `audit` / REPORT_ONLY review policy.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { HOSTS } = require('../lib/hosts/registry.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('audit policy is documented once for every host and reaches every installed skill copy', () => {
  for (const rel of ['.claude/skills/ai-engineering-loop', '.agents/skills/ai-engineering-loop']) {
    const maker = read(`${rel}/references/loop-maker.md`);
    assert.match(maker, /## REPORT_ONLY report review \(recipe `audit`\)/);
    assert.match(maker, /ONE fresh `devil-advocate`/);
    assert.match(maker, /No Judge/);
    assert.match(maker, /"reason"/);
    assert.match(read(`${rel}/references/loop-hosts.md`), /REPORT_ONLY \(`audit`\) uses the same spawn tool/);
    assert.match(read(`${rel}/references/loop-review.md`), /REPORT_ONLY runs skip these stages/);
    assert.match(read(`${rel}/SKILL.md`), /\(reason: <why>\)/);
  }
  // Every host with a reviewer agent can run the audit review with the same agent.
  for (const host of HOSTS.filter((h) => h.agents)) assert.ok(host.agents.format, host.id);
  assert.match(read('core/orchestration-model.md'), /REPORT_ONLY \(recipe `audit`\) policy/);
});
