const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readRepo(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function parseFrontmatter(content, label) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${label} is missing YAML frontmatter`);
  const fm = match[1];
  assert.match(fm, /^name:\s*[a-z0-9-]+$/m, `${label} name must be kebab-case`);
  assert.match(fm, /^description:\s+\S/m, `${label} description must be a single-line value`);
  assert.doesNotMatch(fm, /^description:\s*>-?/m, `${label} must not use folded YAML description`);
  const desc = fm.split('\n').find((line) => line.startsWith('description:'));
  assert.ok(desc.length <= 500, `${label} description exceeds 500 chars (${desc.length})`);
  return { fm, body: content.slice(match[0].length) };
}

test('Claude Code skill is Kiro-safe: no mermaid, latex, HTML breaks, or Grok tool keys', () => {
  const content = readRepo('.claude/skills/ai-engineering-loop/SKILL.md');
  const { fm } = parseFrontmatter(content, 'claude skill');

  assert.match(fm, /^allowed-tools:/m);
  assert.match(fm, /Bash\(npm run \*\)/);
  assert.doesNotMatch(content, /```mermaid/);
  assert.doesNotMatch(content, /\$\\/);
  assert.doesNotMatch(content, /<br\s*\/?>/i);
  assert.doesNotMatch(content, /spawn_subagent/);
  assert.doesNotMatch(content, /capability_mode/);
  assert.doesNotMatch(content, /resume_from/);
  assert.match(content, /\bTask\b/);
  assert.match(content, /subagent_type/);
  assert.match(content, /devil-advocate/);
  assert.match(content, /\bjudge\b/);
  assert.match(content, /cannot determine the safety/);
  assert.match(content, /run_in_background/);
  assert.match(content, /current\.diff/);
  assert.match(content, /8 tool calls/);
});

test('Claude Code agents exist with Claude tool names and Finding Ledger / verdict contracts', () => {
  const da = readRepo('.claude/agents/devil-advocate.md');
  const judge = readRepo('.claude/agents/judge.md');
  parseFrontmatter(da, 'devil-advocate agent');
  parseFrontmatter(judge, 'judge agent');

  assert.match(da, /^tools:\s*Read, Grep, Glob, Bash$/m);
  assert.match(judge, /^tools:\s*Read, Grep, Glob, Bash$/m);
  assert.doesNotMatch(da, /spawn_subagent|capability_mode|resume_from/);
  assert.doesNotMatch(judge, /spawn_subagent|capability_mode|resume_from/);
  assert.match(da, /Finding Ledger/);
  assert.match(da, /8 tool calls/);
  assert.match(da, /Skip: `\*\.css`/);
  assert.match(da, /Do not run git log/);
  assert.match(judge, /PASS/);
  assert.match(judge, /ITERATE/);
  assert.match(judge, /ESCALATE/);
  assert.match(judge, /4 tool calls/);
});

test('Claude Code slash command does not embed Grok spawn keys', () => {
  const cmd = readRepo('.claude/commands/ai-engineering-loop.md');
  const { fm } = parseFrontmatter(cmd, 'claude command');
  assert.match(fm, /^allowed-tools:/m);
  assert.match(fm, /Bash\(npm run \*\)/);
  assert.doesNotMatch(cmd, /spawn_subagent|capability_mode|resume_from/);
  assert.match(cmd, /ai-engineering-loop/);
});

test('Grok skill may use spawn_subagent; Claude skill must not', () => {
  const grok = readRepo('.grok/skills/ai-engineering-loop/SKILL.md');
  const claude = readRepo('.claude/skills/ai-engineering-loop/SKILL.md');
  assert.match(grok, /spawn_subagent/);
  assert.doesNotMatch(claude, /spawn_subagent/);
});

test('Judge budget is the same on Claude Code, Grok, and Antigravity', () => {
  const hosts = [
    '.claude/agents/judge.md',
    '.grok/agents/judge.md',
    '.agents/judge.md'
  ];
  for (const rel of hosts) {
    const body = readRepo(rel);
    assert.match(body, /Budget \(hard stop\)/);
    assert.match(body, /4 tool calls/);
    assert.match(body, /Do not run git log/);
    assert.match(body, /Do not re-review the whole diff/);
    assert.match(body, /\*report-css\*/);
  }
});

test('Antigravity workflow waits and never uses browser_subagent as reviewer', () => {
  const wf = readRepo('.agents/workflows/ai-engineering-loop.md');
  parseFrontmatter(wf, 'antigravity workflow');
  assert.match(wf, /8 tool calls/);
  assert.match(wf, /4 tool calls/);
  assert.match(wf, /browser_subagent/);
  assert.match(wf, /CONTEXT_ISOLATION_ONLY/);
});

test('Claude and Grok parent skills pass Judge a 4-call ledger-only prompt', () => {
  const claude = readRepo('.claude/skills/ai-engineering-loop/SKILL.md');
  const grok = readRepo('.grok/skills/ai-engineering-loop/SKILL.md');
  assert.match(claude, /4 tool calls/);
  assert.match(grok, /4 tool calls/);
});
