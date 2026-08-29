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

function bodyAfterFrontmatter(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n+/);
  assert.ok(match, 'missing frontmatter');
  return content.slice(match[0].length).replace(/\s+$/, '');
}

test('DA body is identical on Claude Code, Grok, and Antigravity', () => {
  const shared = readRepo('agents/shared/devil-advocate.body.md').replace(/\s+$/, '');
  for (const rel of ['.claude/agents/devil-advocate.md', '.grok/agents/devil-advocate.md', '.agents/devil-advocate.md']) {
    assert.strictEqual(bodyAfterFrontmatter(readRepo(rel)), shared, rel);
  }
});

test('Judge body is identical on Claude Code, Grok, and Antigravity', () => {
  const shared = readRepo('agents/shared/judge.body.md').replace(/\s+$/, '');
  for (const rel of ['.claude/agents/judge.md', '.grok/agents/judge.md', '.agents/judge.md']) {
    assert.strictEqual(bodyAfterFrontmatter(readRepo(rel)), shared, rel);
  }
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

test('Parent DA and Judge prompts match across hosts', () => {
  const daPrompt = 'at most 8 tool calls; read the diff file; skip css and generated files';
  const judgePrompt = 'at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff';
  for (const rel of [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.grok/skills/ai-engineering-loop/SKILL.md',
    '.agents/workflows/ai-engineering-loop.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, new RegExp(daPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), rel);
    assert.match(text, new RegExp(judgePrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), rel);
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

test('Gemini Antigravity skill matches the loop and never uses Grok spawn keys or browser_subagent as reviewer', () => {
  const gemini = readRepo('.gemini/skills/ai-engineering-loop/SKILL.md');
  const { fm } = parseFrontmatter(gemini, 'gemini skill');
  assert.doesNotMatch(fm, /^description:\s*>-?/m);
  assert.doesNotMatch(gemini, /```mermaid/);
  assert.doesNotMatch(gemini, /\$\\/);
  assert.doesNotMatch(gemini, /spawn_subagent/);
  assert.doesNotMatch(gemini, /capability_mode/);
  assert.doesNotMatch(gemini, /resume_from/);
  assert.match(gemini, /browser_subagent/);
  assert.match(gemini, /CONTEXT_ISOLATION_ONLY/);
  assert.match(gemini, /grill-policy/);
  assert.match(gemini, /tdd-policy/);
  assert.match(gemini, /glossary\.md/);
  assert.match(gemini, /Spec and Standards/);
  assert.match(gemini, /task-impact-inquiry/);
  assert.match(gemini, /8 tool calls/);
  assert.match(gemini, /4 tool calls/);
  assert.match(gemini, /TRUE_INDEPENDENT_AGENT/);
});

test('task-impact-inquiry is Claude-safe and ships to Claude, Grok, and Gemini', () => {
  const skill = readRepo('adapters/dot/skills/task-impact-inquiry/SKILL.md');
  const { fm } = parseFrontmatter(skill, 'task-impact-inquiry');
  assert.doesNotMatch(fm, /^description:\s*>-?/m);
  assert.doesNotMatch(skill, /```mermaid/);
  assert.doesNotMatch(skill, /\$\\/);
  assert.doesNotMatch(skill, /spawn_subagent/);
  assert.match(skill, /lifecycle/);
  assert.match(skill, /ASCII/);
  assert.match(skill, /failure table/);
  assert.match(skill, /Do not interview again/);
  assert.match(skill, /Passing unit tests are not isolation proof|Green unit tests/);
  assert.match(skill, /New-dev briefing/);
  assert.match(skill, /Hit map|Where it hits/);
  assert.match(skill, /Do not generate an FSD/);
  const grill = readRepo('core/grill-policy.md');
  assert.match(grill, /Business blast radius/);
  assert.match(grill, /~\/\.claude\/skills\/task-impact-inquiry/);
  assert.match(grill, /~\/\.grok\/skills\/task-impact-inquiry/);
  assert.match(grill, /~\/\.gemini\/config\/skills\/task-impact-inquiry/);
  const readme = readRepo('adapters/dot/README.md');
  assert.match(readme, /task-impact-inquiry/);
  assert.match(readme, /~\/\.claude\/skills\//);
  assert.doesNotMatch(readme, /not from `~\/\.claude\/skills\/`/);
  const wf = readRepo('.agents/workflows/ai-engineering-loop.md');
  assert.match(wf, /task-impact-inquiry/);
  assert.match(wf, /blast radius: lifecycle sketch/);
});

test('DOT router sends commit-bound work to ai-engineering-loop; workflow is Stage 8 only', () => {
  const router = readRepo('adapters/dot/skills/dot-dev-skill-router/SKILL.md');
  const delivery = readRepo('adapters/dot/skills/dot-dev-workflow/SKILL.md');
  const readme = readRepo('adapters/dot/README.md');
  assert.match(router, /ai-engineering-loop/);
  assert.match(router, /Do not use dot-dev-workflow as a parallel engineering OS/);
  assert.doesNotMatch(router, /task-impact-inquiry` → `dot-dev-workflow/);
  assert.match(delivery, /Not a substitute for ai-engineering-loop/);
  assert.match(delivery, /Judge `PASS`/);
  assert.doesNotMatch(delivery, /```mermaid/);
  assert.match(readme, /run `ai-engineering-loop`/);
  assert.match(readme, /Stage 8 delivery only/);
  assert.doesNotMatch(readme, /Pre-commit multi-round adversarial review gate \(Phase 6\)/);
});

test('generate-workflow skill is Claude-safe and host skills read the overlay', () => {
  const skill = readRepo('adapters/generate-workflow/SKILL.md');
  const { fm } = parseFrontmatter(skill, 'generate-workflow');
  assert.doesNotMatch(fm, /^description:\s*>-?/m);
  assert.doesNotMatch(skill, /```mermaid/);
  assert.doesNotMatch(skill, /\$\\/);
  assert.doesNotMatch(skill, /spawn_subagent/);
  assert.match(skill, /Q1/);
  assert.match(skill, /Do not start Maker/);
  assert.match(skill, /lessons\.md/);
  for (const rel of [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.grok/skills/ai-engineering-loop/SKILL.md',
    '.gemini/skills/ai-engineering-loop/SKILL.md',
    '.agents/workflows/ai-engineering-loop.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, /lessons\.md/, rel);
    assert.match(text, /workflow\.md/, rel);
    assert.match(text, /Do not skip Goal Contract, verification, Devil's Advocate, or Judge/, rel);
    assert.match(text, /generate-workflow/, rel);
  }
});

test('generate-adapter skill is Claude-safe and shipped adapters stay generic', () => {
  const skill = readRepo('adapters/generate-adapter/SKILL.md');
  const { fm } = parseFrontmatter(skill, 'generate-adapter');
  assert.doesNotMatch(fm, /^description:\s*>-?/m);
  assert.doesNotMatch(skill, /```mermaid/);
  assert.doesNotMatch(skill, /\$\\/);
  assert.doesNotMatch(skill, /spawn_subagent/);
  assert.match(skill, /Q1/);
  assert.match(skill, /Do not start Maker/);
  const catalog = readRepo('adapters/README.md');
  assert.match(catalog, /standard/);
  assert.match(catalog, /github/);
  assert.match(catalog, /gitlab/);
  const gitlab = readRepo('adapters/gitlab/README.md');
  assert.match(gitlab, /not the DOT adapter/);
  assert.doesNotMatch(gitlab, /Coreview/);
  assert.doesNotMatch(gitlab, /Mattermost/);
  const standard = readRepo('adapters/standard/README.md');
  assert.match(standard, /Judge `PASS`/);
});

test('Host skills Stage 0 runs sync-hosts before status', () => {
  for (const rel of [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.grok/skills/ai-engineering-loop/SKILL.md',
    '.gemini/skills/ai-engineering-loop/SKILL.md',
    '.agents/workflows/ai-engineering-loop.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, /sync-hosts/, rel);
  }
});

test('Grill freeze gate and idea menu are in the loop, not a parallel product', () => {
  const grill = readRepo('core/grill-policy.md');
  assert.match(grill, /Idea and menu requests/);
  assert.match(grill, /Do not implement/);
  assert.match(grill, /is \*\*not\*\* a freeze/);
  assert.match(grill, /numbered AC/);
  const contract = readRepo('core/goal-contract.md');
  assert.match(contract, /Chat is not the contract/);
  assert.match(contract, /The Chat Contract/);
  assert.match(contract, /The Wrong Artifact/);
  const judge = readRepo('agents/shared/judge.body.md');
  assert.match(judge, /Goal Contract \*\*file\*\* only/);
  assert.match(judge, /source grep/);
  const tdd = readRepo('policies/tdd-policy.md');
  assert.match(tdd, /Source grep/);
  for (const rel of [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.grok/skills/ai-engineering-loop/SKILL.md',
    '.gemini/skills/ai-engineering-loop/SKILL.md',
    '.agents/workflows/ai-engineering-loop.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, /list a short menu and wait/, rel);
    assert.match(text, /Chat agreement is not freeze/, rel);
  }
});

test('Failure table is required to freeze, TDD, verify, and Judge', () => {
  const grill = readRepo('core/grill-policy.md');
  assert.match(grill, /failure table/);
  assert.match(grill, /sunny path is not frozen/);
  const contract = readRepo('core/goal-contract.md');
  assert.match(contract, /The Happy-Path Contract/);
  assert.match(contract, /Empty \/ omitted field/);
  const tdd = readRepo('policies/tdd-policy.md');
  assert.match(tdd, /Coverage as a map, not a score/);
  assert.match(tdd, /Happy-path only/);
  assert.match(tdd, /Coverage theater/);
  const verif = readRepo('core/verification-loop.md');
  assert.match(verif, /non-happy-path AC/);
  const judge = readRepo('agents/shared/judge.body.md');
  assert.match(judge, /happy-path-only/);
  const da = readRepo('agents/shared/devil-advocate.body.md');
  assert.match(da, /happy-path-only suite vs written failure table/);
  for (const rel of [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.grok/skills/ai-engineering-loop/SKILL.md',
    '.gemini/skills/ai-engineering-loop/SKILL.md',
    '.agents/workflows/ai-engineering-loop.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, /failure table/, rel);
    assert.match(text, /One red test per AC row/, rel);
    assert.match(text, /Do not freeze sunny-path-only/, rel);
    assert.match(text, /blast radius: lifecycle sketch/, rel);
  }
});

test('Host skills absorb grill, TDD, glossary, and two-axis review without splitting the loop', () => {
  for (const rel of [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.grok/skills/ai-engineering-loop/SKILL.md',
    '.agents/workflows/ai-engineering-loop.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, /grill-policy/, rel);
    assert.match(text, /tdd-policy/, rel);
    assert.match(text, /glossary\.md/, rel);
    assert.match(text, /Spec and Standards/, rel);
    assert.match(text, /adapter_type: dot/, rel);
  }
  const da = readRepo('agents/shared/devil-advocate.body.md');
  assert.match(da, /"axis": "spec"/);
  assert.match(da, /hardConvention/);
  assert.match(da, /standards/);
  const judge = readRepo('agents/shared/judge.body.md');
  assert.match(judge, /hardConvention is true/);
  assert.match(judge, /Do not merge Spec and Standards/);
});
