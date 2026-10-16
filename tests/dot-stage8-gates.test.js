'use strict';

// Issue #65: DOT Stage 8 adds a pipeline + Sonar gate and a "Ready to review"
// card move, in a fixed order, with glab-only commands and no tokens.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');

function inOrder(text, labels, file) {
  let at = -1;
  for (const label of labels) {
    const next = text.indexOf(label, at + 1);
    assert.ok(next > at, `${file}: "${label}" must come after the previous step`);
    at = next;
  }
}

test('README documents the Stage 8 order and lists sonar.md', () => {
  const readme = read('adapters/dot/README.md');
  assert.match(readme, /issue → MR → pipeline \+ Sonar gate → Coreview triage → card to "Ready to review" → Mattermost/);
  inOrder(readme, ['1. GitLab Issue Card', '2. One Merge Request', '3. Pipeline + Sonar', '4. External @coreview-bot', '5. Move card to Ready to review', '6. Mattermost'], 'README.md');
  assert.match(readme, /\(sonar\.md\)/);
  assert.ok(fs.existsSync(path.join(ROOT, 'adapters/dot/sonar.md')));
});

test('Sonar FAIL blocks the card move and the notification; no Sonar is SKIPPED, not PASS', () => {
  const sonar = read('adapters/dot/sonar.md');
  assert.match(sonar, /Do \*\*not\*\* move the card to "Ready to review"/);
  assert.match(sonar, /Do \*\*not\*\* send Mattermost/);
  assert.match(sonar, /SKIPPED/);
  assert.match(sonar, /Do not invent a PASS/);
  const gitlab = read('adapters/dot/gitlab.md');
  assert.match(gitlab, /If the Sonar gate is FAIL, stop here/);
  const mattermost = read('adapters/dot/mattermost.md');
  assert.match(mattermost, /On `FAIL`, do not send/);
  inOrder(mattermost, ['Preconditions', 'Channel Resolution & Dispatch Flow'], 'mattermost.md');
  const workflow = read('adapters/dot/skills/dot-dev-workflow/SKILL.md');
  inOrder(workflow, ['Stage 8a', 'Stage 8b — Pipeline and Sonar gate', 'Stage 8c — Coreview', 'Stage 8d — Card to "Ready to review"', 'Stage 8e — Mattermost'], 'dot-dev-workflow');
  assert.match(workflow, /While FAIL, do not move the card and do not send Mattermost/);
});

test('board move is idempotent and skips cleanly with no linked card', () => {
  const gitlab = read('adapters/dot/gitlab.md');
  assert.match(gitlab, /Card: none linked \(skipped\)/);
  assert.match(gitlab, /Card: already in Ready to review/);
  assert.match(gitlab, /remove only the \*\*other board-list labels\*\*/);
  assert.match(gitlab, /Running Step 4 twice must not change anything/);
});

test('Stage 8 commands use glab only and never carry tokens', () => {
  for (const rel of ['adapters/dot/sonar.md', 'adapters/dot/gitlab.md', 'adapters/dot/skills/dot-dev-workflow/SKILL.md']) {
    const text = read(rel);
    const blocks = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
    const commands = blocks.flatMap((block) => block.split('\n')).map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('--') && !line.startsWith('-F'));
    assert.ok(commands.length >= 2, `${rel}: expected bash commands, got ${commands.length}`);
    for (const line of commands) {
      assert.match(line, /^(glab|git|npx)\b/, `${rel}: unexpected command "${line}"`);
      assert.doesNotMatch(line, /curl|PRIVATE-TOKEN|SONAR_TOKEN|api\/qualitygates|sonar\.login/i, `${rel}: ${line}`);
    }
    assert.doesNotMatch(text, /curl\s/, rel);
  }
  assert.match(read('adapters/dot/sonar.md'), /Use `glab` only/);
});
