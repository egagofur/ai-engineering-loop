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
// - `docs` / `verified`: sources checked, and when.

const SHARED_SKILLS_DIR = '.agents/skills';

const HOSTS = Object.freeze([
  {
    id: 'claude',
    name: 'Claude Code',
    tier: 1,
    detect: { dirs: ['.claude'], bins: ['claude'] },
    skills: { dir: '.claude/skills' },
    reads: ['.claude/skills'],
    agents: { format: 'claude-md', dir: '.claude/agents' },
    docs: ['https://code.claude.com/docs/en/skills', 'https://code.claude.com/docs/en/sub-agents'],
    verified: '2026-10-11'
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    tier: 1,
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
    tier: 1,
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
    tier: 1,
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
    tier: 1,
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
    tier: 1,
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
    tier: 1,
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
    tier: 1,
    detect: { dirs: ['.copilot'], bins: ['copilot'] },
    skills: 'shared',
    reads: ['.copilot/skills', '.agents/skills'],
    agents: { format: 'copilot-agent-md', dir: '.copilot/agents' },
    docs: ['https://docs.github.com/en/copilot/concepts/agents/about-agent-skills', 'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli'],
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

module.exports = { HOSTS, HOST_IDS, OUT_OF_SCOPE, SHARED_SKILLS_DIR, getHost, usesSharedSkills };
