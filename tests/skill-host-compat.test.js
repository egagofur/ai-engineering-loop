const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Host skills are read as SKILL.md plus on-demand references (issue #35).
const { readSkillBundle, readHostSection } = require('./helpers/skill-bundle.js');
const { renderAgent } = require('../lib/hosts/agent-formats.js');

function readRepo(rel) {
  return readSkillBundle(rel);
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

test('Core skill is Kiro-safe: no mermaid, latex, HTML breaks, or Grok tool keys in SKILL.md', () => {
  const skill = readSkillBundle('.claude/skills/ai-engineering-loop/SKILL.md', { excludeHosts: true });
  parseFrontmatter(skill, 'core skill');
  assert.doesNotMatch(skill, /```mermaid/);
  assert.doesNotMatch(skill, /\$\\/);
  assert.doesNotMatch(skill, /<br\s*\/?>/i);
  // Tool keys of one host never appear outside its own loop-hosts section.
  assert.doesNotMatch(skill, /spawn_subagent|capability_mode|resume_from|invoke_subagent/);
  assert.match(skill, /devil-advocate/);
  assert.match(skill, /\bjudge\b/);
  assert.match(skill, /cannot determine the safety/);
  assert.match(skill, /current\.diff/);
  assert.match(skill, /8 tool calls/);
  assert.match(skill, /loop-hosts/);
});

test('loop-hosts: Claude section is Kiro-safe and names Task keys only', () => {
  const claude = readHostSection('Claude Code');
  assert.match(claude, /\bTask\b/);
  assert.match(claude, /subagent_type/);
  assert.match(claude, /run_in_background/);
  assert.match(claude, /cannot determine the safety/);
  assert.match(claude, /REQUEST_BODY_INVALID/);
  assert.doesNotMatch(claude, /spawn_subagent|capability_mode|resume_from|invoke_subagent/);
});

test('loop-hosts: Grok section keeps spawn_subagent rules; Antigravity section keeps invoke_subagent and no browser reviewer', () => {
  const grok = readHostSection('Grok CLI');
  assert.match(grok, /spawn_subagent/);
  assert.match(grok, /subagent_id/);
  assert.match(grok, /caveman:cavecrew-reviewer/);
  assert.match(grok, /CONTEXT_ISOLATION_ONLY/);
  const ag = readHostSection('Antigravity');
  assert.match(ag, /invoke_subagent/);
  assert.match(ag, /browser_subagent/);
  assert.match(ag, /CONTEXT_ISOLATION_ONLY/);
  assert.doesNotMatch(ag, /spawn_subagent|capability_mode|resume_from/);
  for (const heading of ['Gemini CLI', 'Codex CLI', 'Cursor, GitHub Copilot', 'Other hosts']) {
    assert.match(readHostSection(heading), /CONTEXT_ISOLATION_ONLY/, heading);
  }
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

function bodyAfterFrontmatter(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n+/);
  assert.ok(match, 'missing frontmatter');
  return content.slice(match[0].length).replace(/\s+$/, '');
}

function antigravityAgent(name) {
  return renderAgent(ROOT, 'antigravity-md', name);
}

test('DA body is identical on Claude Code, Grok, and Antigravity', () => {
  const shared = readRepo('agents/shared/devil-advocate.body.md').replace(/\s+$/, '');
  for (const [label, text] of [
    ['.claude/agents/devil-advocate.md', readRepo('.claude/agents/devil-advocate.md')],
    ['.grok/agents/devil-advocate.md', readRepo('.grok/agents/devil-advocate.md')],
    ['antigravity-md', antigravityAgent('devil-advocate')]
  ]) {
    assert.strictEqual(bodyAfterFrontmatter(text), shared, label);
  }
});

test('Judge body is identical on Claude Code, Grok, and Antigravity', () => {
  const shared = readRepo('agents/shared/judge.body.md').replace(/\s+$/, '');
  for (const [label, text] of [
    ['.claude/agents/judge.md', readRepo('.claude/agents/judge.md')],
    ['.grok/agents/judge.md', readRepo('.grok/agents/judge.md')],
    ['antigravity-md', antigravityAgent('judge')]
  ]) {
    assert.strictEqual(bodyAfterFrontmatter(text), shared, label);
  }
});

test('Judge budget is the same on Claude Code, Grok, and Antigravity', () => {
  for (const body of [readRepo('.claude/agents/judge.md'), readRepo('.grok/agents/judge.md'), antigravityAgent('judge')]) {
    assert.match(body, /Budget \(hard stop\)/);
    assert.match(body, /4 tool calls/);
    assert.match(body, /Do not run git log/);
    assert.match(body, /Do not re-review the whole diff/);
    assert.match(body, /\*report-css\*/);
  }
});

test('Antigravity reviewer agents are invoke_subagent targets, not primary agents', () => {
  for (const name of ['devil-advocate', 'judge']) {
    const text = antigravityAgent(name);
    const { fm } = parseFrontmatter(text, `antigravity ${name}`);
    assert.match(fm, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(fm, /^subagent: true$/m);
    assert.match(fm, /^mainAgent: false$/m);
  }
});

test('Parent DA and Judge prompts match across hosts', () => {
  const daPrompt = 'at most 8 tool calls; read the diff file; skip css and generated files';
  const judgePrompt = 'at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff';
  for (const rel of [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.agents/skills/ai-engineering-loop/SKILL.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, new RegExp(daPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), rel);
    assert.match(text, new RegExp(judgePrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), rel);
  }
});

test('Core skill passes Judge a 4-call ledger-only prompt and keeps the loop quality core', () => {
  const core = readRepo('.agents/skills/ai-engineering-loop/SKILL.md');
  const { fm } = parseFrontmatter(core, 'core skill');
  assert.doesNotMatch(fm, /^description:\s*>-?/m);
  assert.match(core, /4 tool calls/);
  assert.match(core, /8 tool calls/);
  assert.match(core, /browser_subagent/);
  assert.match(core, /CONTEXT_ISOLATION_ONLY/);
  assert.match(core, /grill-policy/);
  assert.match(core, /tdd-policy/);
  assert.match(core, /glossary\.md/);
  assert.match(core, /Spec and Standards/);
  assert.match(core, /task-impact-inquiry/);
  assert.match(core, /TRUE_INDEPENDENT_AGENT/);
});

test('task-impact-inquiry is Claude-safe and ships to Claude, the shared folder, and Antigravity', () => {
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
  assert.match(grill, /~\/\.agents\/skills\/task-impact-inquiry/);
  assert.match(grill, /~\/\.gemini\/config\/skills\/task-impact-inquiry/);
  const readme = readRepo('adapters/dot/README.md');
  assert.match(readme, /task-impact-inquiry/);
  assert.match(readme, /~\/\.claude\/skills\//);
  assert.doesNotMatch(readme, /not from `~\/\.claude\/skills\/`/);
  const wf = readRepo('.agents/skills/ai-engineering-loop/SKILL.md');
  assert.match(wf, /task-impact-inquiry/);
  assert.match(wf, /blast radius: lifecycle sketch/);
});

test('backend-development skill ships to Claude and the shared .agents folder with reference docs', () => {
  const hosts = [
    '.claude/skills/backend-development',
    '.agents/skills/backend-development'
  ];
  for (const host of hosts) {
    const skill = readRepo(`${host}/SKILL.md`);
    const { fm } = parseFrontmatter(skill, `${host}/SKILL.md`);
    assert.match(fm, /^name:\s*backend-development$/m, host);
    assert.doesNotMatch(fm, /^description:\s*>-?/m, host);
    assert.doesNotMatch(skill, /```mermaid/);
    assert.doesNotMatch(skill, /\$\\/);
    assert.doesNotMatch(skill, /spawn_subagent/);
    assert.match(skill, /Boolean naming/);
    assert.match(skill, /No magic numbers or strings/);
    assert.match(skill, /Query and Database Best Practices/);
    assert.match(skill, /API Design Principles/);
    assert.match(skill, /Security/);
    assert.match(readRepo(`${host}/references/api-design-guidelines.md`), /HTTP method semantics/i);
    assert.match(readRepo(`${host}/references/query-and-database-best-practices.md`), /N\+1 query prevention/i);
    assert.match(readRepo(`${host}/references/security-checklist.md`), /Common vulnerability prevention/i);
  }
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
  assert.match(skill, /Q6/);
  assert.match(skill, /maker_intern/);
  assert.match(skill, /Do not start Maker/);
  assert.match(skill, /lessons\.md/);
  assert.match(skill, /grok models/);
  assert.match(skill, /\/models/);
  assert.match(skill, /Do not type a model name/);
  assert.doesNotMatch(skill, /any host-native label \(gemini-flash/);
  for (const rel of [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.agents/skills/ai-engineering-loop/SKILL.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, /lessons\.md/, rel);
    assert.match(text, /workflow\.md/, rel);
    assert.match(text, /Do not skip Goal Contract, verification, Devil's Advocate, or Judge/, rel);
    assert.match(text, /generate-workflow/, rel);
    assert.match(text, /maker_intern/, rel);
    assert.match(text, /INVOCATION_UNAVAILABLE/, rel);
    assert.match(text, /Do not type a model name/, rel);
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

test('Host compact map names four buckets and keeps 8-stage numbers', () => {
  const readme = readRepo('README.md');
  assert.match(readme, /Specify \(stages 0-1\)/);
  assert.match(readme, /Make \(stages 2-4\)/);
  assert.match(readme, /Review \(stages 5-7\)/);
  assert.match(readme, /Deliver \(stage 8\)/);
  assert.doesNotMatch(readme, /Later phase \(not this change\): host compact pipeline/);
  const grill = readRepo('core/grill-policy.md');
  assert.doesNotMatch(grill, /Later phase \(not this loop\): host compact pipeline/);
  for (const rel of [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.agents/skills/ai-engineering-loop/SKILL.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, /Specify \(stages 0-1\)/, rel);
    assert.match(text, /Make \(stages 2-4\)/, rel);
    assert.match(text, /Review \(stages 5-7\)/, rel);
    assert.match(text, /Deliver \(stage 8\)/, rel);
    assert.match(text, /8-stage/, rel);
    assert.match(text, /not a second OS/, rel);
    assert.match(text, /Do not skip Goal Contract, verification, Devil's Advocate, or Judge/, rel);
  }
});

test('Host skills mention sync-hosts only as a stale-host remedy, not a per-run step', () => {
  for (const rel of [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.agents/skills/ai-engineering-loop/SKILL.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, /sync-hosts/, rel);
    assert.match(text, /Do not run `sync-hosts` per run/, rel);
  }
});

test('Every host enforces state, evidence, bounded context, escalation, and delivery gates', () => {
  for (const rel of [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.agents/skills/ai-engineering-loop/SKILL.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, /state --json/, rel);
    assert.match(text, /gate goal/, rel);
    assert.match(text, /gate maker/, rel);
    assert.match(text, /gate verification/, rel);
    assert.match(text, /context devil-advocate/, rel);
    assert.match(text, /gate review/, rel);
    assert.match(text, /escalation --json/, rel);
    assert.match(text, /gate judge/, rel);
    assert.match(text, /gate delivery/, rel);
    assert.match(text, /raw logs, or credentials/, rel);
  }
});

test('Every host enforces runtime mode, token accounting, sandbox, and approval controls', () => {
  for (const rel of [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.agents/skills/ai-engineering-loop/SKILL.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, /REPORT_ONLY/, rel);
    assert.match(text, /ASSISTED/, rel);
    assert.match(text, /UNATTENDED/, rel);
    assert.match(text, /budget status/, rel);
    assert.match(text, /budget record/, rel);
    assert.match(text, /sandbox create/, rel);
    assert.match(text, /sandbox capture/, rel);
    assert.match(text, /humanApproved: true/, rel);
    assert.match(text, /never infer/, rel);
  }
});

test('Sloppy prompt drafts a Goal Contract; claimed-vs-reality gates DA', () => {
  const grill = readRepo('core/grill-policy.md');
  assert.match(grill, /Sloppy \/ underspecified prompts/);
  assert.match(grill, /Do not start Maker/);
  assert.match(grill, /Do not invent a second draft/);
  const verif = readRepo('core/verification-loop.md');
  assert.match(verif, /claimed-vs-reality\.md/);
  assert.match(verif, /seems green/);
  const judge = readRepo('agents/shared/judge.body.md');
  assert.match(judge, /claimed-vs-reality\.md/);
  for (const rel of [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.agents/skills/ai-engineering-loop/SKILL.md'
  ]) {
    const text = readRepo(rel);
    assert.match(text, /If the user prompt has no numbered AC/, rel);
    assert.match(text, /claimed-vs-reality\.md/, rel);
    assert.match(text, /Do not spawn Devil's Advocate if the file is missing/, rel);
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
    '.agents/skills/ai-engineering-loop/SKILL.md'
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
    '.agents/skills/ai-engineering-loop/SKILL.md'
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
    '.agents/skills/ai-engineering-loop/SKILL.md'
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
