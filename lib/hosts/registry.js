'use strict';

// Host registry (#49). One data entry per AI coding agent: how to detect it,
// where its skills and reviewer subagents go, and which skill folders it scans.
// Code per host is only an agent formatter in agent-formats.js.
//
// - `detect.dirs`: config directories under $HOME (any present = detected).
// - `detect.bins`: executable names looked up on PATH with stat only; a binary
//   is never executed.
// - `skills`: 'shared' = the host reads ~/.agents/skills (one copy for every
//   such host), or { dir } for a host that needs its own copy.
// - `reads`: every user-level skill folder the host scans (official docs);
//   used by `hosts doctor` and the one-copy-per-host test.
// - `agents`: reviewer subagent format and directory, or null when the host
//   has no file-based custom subagents.
// - `docs` / `verified`: sources checked, and when (docs only, not a run).
// - `certification` (#60): 'full' = a real recipes/default.json run completed
//   on this host with reviewer subagents and every gate, recorded in
//   `certifiedBy: { recipe, aelVersion, date }`; 'experimental' = reviewer
//   subagents are installed but no such run is recorded; 'instruction-only' =
//   no file-based subagents, the loop runs CONTEXT_ISOLATION_ONLY. Promote a
//   host to 'full' only with a run record.
// - `hooks` (#59): native pre-tool hook API that `ael hooks install` writes
//   to, or absent. A host with hooks gets **enforced** runtime guardrails;
//   every other host is **advisory** (the loop instructions only).

const SHARED_SKILLS_DIR = '.agents/skills';
const CERTIFICATIONS = Object.freeze(['full', 'experimental', 'instruction-only']);

const HOSTS = Object.freeze([
  {
    id: 'claude',
    name: 'Claude Code',
    certification: 'experimental',
    certifiedBy: null,
    detect: { dirs: ['.claude'], bins: ['claude'] },
    skills: { dir: '.claude/skills' },
    reads: ['.claude/skills'],
    agents: { format: 'claude-md', dir: '.claude/agents' },
    hooks: { format: 'claude-pretooluse', settings: '.claude/settings.json' },
    docs: ['https://code.claude.com/docs/en/skills', 'https://code.claude.com/docs/en/sub-agents', 'https://code.claude.com/docs/en/hooks'],
    verified: '2026-10-11'
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    certification: 'experimental',
    certifiedBy: null,
    detect: { dirs: ['.codex'], bins: ['codex'] },
    skills: 'shared',
    reads: ['.agents/skills'],
    agents: { format: 'codex-toml', dir: '.codex/agents' },
    docs: ['https://developers.openai.com/codex/skills', 'https://developers.openai.com/codex/subagents'],
    verified: '2026-10-11'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    certification: 'experimental',
    certifiedBy: null,
    detect: { dirs: ['.gemini'], bins: ['gemini'] },
    skills: 'shared',
    reads: ['.gemini/skills', '.agents/skills'],
    agents: { format: 'gemini-md', dir: '.gemini/agents' },
    docs: ['https://geminicli.com/docs/cli/skills/', 'https://geminicli.com/docs/core/subagents/'],
    verified: '2026-10-11'
  },
  {
    id: 'antigravity',
    name: 'Antigravity (IDE / 2.0)',
    certification: 'experimental',
    certifiedBy: null,
    detect: { dirs: ['.gemini/antigravity'], bins: ['antigravity'] },
    skills: { dir: '.gemini/config/skills' },
    reads: ['.gemini/config/skills'],
    agents: { format: 'antigravity-md', dir: '.gemini/config/agents' },
    docs: ['https://antigravity.google/docs/skills/', 'https://antigravity.google/docs/subagents/'],
    verified: '2026-10-11'
  },
  {
    id: 'antigravity-cli',
    name: 'Antigravity CLI (agy)',
    certification: 'experimental',
    certifiedBy: null,
    detect: { dirs: ['.gemini/antigravity-cli'], bins: ['agy'] },
    skills: { dir: '.gemini/antigravity-cli/skills' },
    reads: ['.gemini/antigravity-cli/skills'],
    agents: { format: 'antigravity-md', dir: '.gemini/config/agents' },
    docs: ['https://antigravity.google/docs/cli/install/', 'https://antigravity.google/docs/cli/plugins/'],
    verified: '2026-10-11'
  },
  {
    id: 'grok',
    name: 'Grok CLI',
    certification: 'experimental',
    certifiedBy: null,
    detect: { dirs: ['.grok'], bins: ['grok'] },
    skills: 'shared',
    reads: ['.grok/skills', '.claude/skills', '.agents/skills'],
    agents: { format: 'grok-md', dir: '.grok/agents' },
    docs: ['https://docs.x.ai/build/features/skills-plugins-marketplaces', 'https://docs.x.ai/build/features/subagents'],
    verified: '2026-10-11'
  },
  {
    id: 'cursor',
    name: 'Cursor (editor + CLI)',
    certification: 'experimental',
    certifiedBy: null,
    // The CLI installs `agent` plus a legacy `cursor-agent` link; `agent` is too
    // generic to count as evidence on its own.
    detect: { dirs: ['.cursor'], bins: ['cursor-agent', 'cursor'] },
    skills: 'shared',
    reads: ['.cursor/skills', '.agents/skills', '.claude/skills', '.codex/skills'],
    agents: { format: 'cursor-md', dir: '.cursor/agents' },
    docs: ['https://cursor.com/docs/context/skills', 'https://cursor.com/docs/subagents', 'https://cursor.com/docs/cli/installation'],
    verified: '2026-10-11'
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot (CLI / VS Code)',
    certification: 'experimental',
    certifiedBy: null,
    detect: { dirs: ['.copilot'], bins: ['copilot'] },
    skills: 'shared',
    reads: ['.copilot/skills', '.agents/skills'],
    agents: { format: 'copilot-agent-md', dir: '.copilot/agents' },
    docs: ['https://docs.github.com/en/copilot/concepts/agents/about-agent-skills', 'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli'],
    verified: '2026-10-11'
  },
  // Phase 2 (#50): hosts that read the shared ~/.agents/skills folder.
  {
    id: 'opencode',
    name: 'OpenCode',
    certification: 'experimental',
    certifiedBy: null,
    detect: { dirs: ['.config/opencode'], bins: ['opencode'] },
    skills: 'shared',
    reads: ['.config/opencode/skills', '.claude/skills', '.agents/skills'],
    agents: { format: 'opencode-md', dir: '.config/opencode/agents' },
    docs: ['https://opencode.ai/docs/skills/', 'https://opencode.ai/docs/agents/'],
    verified: '2026-10-11'
  },
  {
    id: 'windsurf',
    name: 'Windsurf / Devin Desktop',
    certification: 'instruction-only',
    certifiedBy: null,
    // No CLI binary is documented; detect by config folder only.
    detect: { dirs: ['.codeium/windsurf', '.config/devin'], bins: [] },
    skills: 'shared',
    reads: ['.codeium/windsurf/skills', '.config/devin/skills', '.agents/skills'],
    agents: null,
    docs: ['https://docs.devin.ai/desktop/cascade/skills'],
    verified: '2026-10-11'
  },
  {
    id: 'amp',
    name: 'Amp',
    certification: 'instruction-only',
    certifiedBy: null,
    detect: { dirs: ['.config/amp'], bins: ['amp'] },
    skills: 'shared',
    reads: ['.config/agents/skills', '.agents/skills', '.config/amp/skills', '.claude/skills'],
    // Custom subagents are TypeScript plugins (amp.createAgent), not files.
    agents: null,
    docs: ['https://ampcode.com/manual/agent-skills.md', 'https://ampcode.com/news/custom-agents'],
    verified: '2026-10-11'
  },
  {
    id: 'factory',
    name: 'Factory Droid',
    certification: 'experimental',
    certifiedBy: null,
    detect: { dirs: ['.factory'], bins: ['droid'] },
    skills: 'shared',
    reads: ['.factory/skills', '.agents/skills'],
    agents: { format: 'factory-md', dir: '.factory/droids' },
    docs: ['https://docs.factory.ai/cli/configuration/skills', 'https://docs.factory.ai/harness/subagents'],
    verified: '2026-10-11'
  },
  {
    id: 'augment',
    name: 'Augment (Auggie)',
    certification: 'experimental',
    certifiedBy: null,
    detect: { dirs: ['.augment'], bins: ['auggie'] },
    skills: 'shared',
    reads: ['.augment/skills', '.claude/skills', '.agents/skills'],
    agents: { format: 'augment-md', dir: '.augment/agents' },
    docs: ['https://docs.augmentcode.com/cli/skills', 'https://docs.augmentcode.com/cli/subagents'],
    verified: '2026-10-11'
  },
  {
    id: 'zed',
    name: 'Zed',
    certification: 'instruction-only',
    certifiedBy: null,
    detect: { dirs: ['.config/zed', 'Library/Application Support/Zed'], bins: ['zed'] },
    skills: 'shared',
    reads: ['.agents/skills'],
    agents: null,
    docs: ['https://zed.dev/docs/ai/skills'],
    verified: '2026-10-11'
  },
  {
    id: 'goose',
    name: 'Goose',
    certification: 'instruction-only',
    certifiedBy: null,
    detect: { dirs: ['.config/goose'], bins: ['goose'] },
    skills: 'shared',
    reads: ['.agents/skills', '.config/goose/skills', '.config/agents/skills', '.claude/skills'],
    // Subrecipes, not file-based reviewer agents.
    agents: null,
    docs: ['https://goose-docs.ai/docs/guides/context-engineering/using-skills'],
    verified: '2026-10-11'
  },
  // Phase 3 (#51): hosts verified to need their own skill folder (Cline, Kiro,
  // Qwen), plus Roo and Junie, which the docs show also read ~/.agents/skills.
  {
    id: 'cline',
    name: 'Cline',
    certification: 'instruction-only',
    certifiedBy: null,
    detect: { dirs: ['.cline'], bins: ['cline'] },
    skills: { dir: '.cline/skills' },
    reads: ['.cline/skills'],
    // Subagents use built-in tools only; no documented reviewer agent file.
    agents: null,
    docs: ['https://docs.cline.bot/customization/skills', 'https://docs.cline.bot/features/subagents'],
    verified: '2026-10-11'
  },
  {
    id: 'roo',
    name: 'Roo Code',
    certification: 'instruction-only',
    certifiedBy: null,
    detect: { dirs: ['.roo'], bins: [] },
    skills: 'shared',
    reads: ['.roo/skills', '.agents/skills'],
    // Modes, not file-based subagents.
    agents: null,
    docs: ['https://docs.roocode.com/features/skills'],
    verified: '2026-10-11'
  },
  {
    id: 'kiro',
    name: 'Kiro (IDE + CLI)',
    certification: 'experimental',
    certifiedBy: null,
    detect: { dirs: ['.kiro'], bins: ['kiro-cli', 'kiro'] },
    skills: { dir: '.kiro/skills' },
    reads: ['.kiro/skills'],
    agents: { format: 'kiro-md', dir: '.kiro/agents' },
    docs: ['https://kiro.dev/docs/skills/', 'https://kiro.dev/docs/cli/custom-agents/configuration-reference/'],
    verified: '2026-10-11'
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    certification: 'experimental',
    certifiedBy: null,
    detect: { dirs: ['.qwen'], bins: ['qwen'] },
    skills: { dir: '.qwen/skills' },
    reads: ['.qwen/skills'],
    agents: { format: 'qwen-md', dir: '.qwen/agents' },
    // Pages: Features > Agent Skills, Features > Subagents (the page path
    // contains a segment the package privacy audit treats as a home folder).
    docs: ['https://qwenlm.github.io/qwen-code-docs/'],
    verified: '2026-10-11'
  },
  {
    id: 'junie',
    name: 'JetBrains Junie',
    certification: 'experimental',
    certifiedBy: null,
    detect: { dirs: ['.junie'], bins: ['junie'] },
    skills: 'shared',
    reads: ['.junie/skills', '.agents/skills'],
    agents: { format: 'junie-md', dir: '.junie/agents' },
    docs: ['https://junie.jetbrains.com/docs/agent-skills.html', 'https://junie.jetbrains.com/docs/junie-cli-subagents.html'],
    verified: '2026-10-11'
  }
]);

// Out of scope (no native SKILL.md support): Aider, Continue.
const OUT_OF_SCOPE = Object.freeze([
  { id: 'aider', name: 'Aider', reason: 'no native skills; use --read or .aider.conf.yml' },
  { id: 'continue', name: 'Continue', reason: 'no native skills; joined Cursor' }
]);

const HOST_IDS = Object.freeze(HOSTS.map((host) => host.id));

function getHost(id) {
  return HOSTS.find((host) => host.id === id) || null;
}

function usesSharedSkills(host) {
  return host.skills === 'shared';
}

// 'enforced' = native hooks block or ask before a tool runs; 'advisory' = the
// guardrail lives in the loop instructions only.
function guardrailSupport(host) {
  return host?.hooks ? 'enforced' : 'advisory';
}

module.exports = {
  CERTIFICATIONS,
  HOSTS,
  HOST_IDS,
  OUT_OF_SCOPE,
  SHARED_SKILLS_DIR,
  getHost,
  guardrailSupport,
  usesSharedSkills
};
