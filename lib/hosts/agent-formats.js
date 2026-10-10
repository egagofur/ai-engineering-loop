'use strict';

// Reviewer subagents (devil-advocate, judge) rendered per host format (#48+).
// One body (agents/shared/<name>.body.md) and one description per agent; each
// formatter only adds the host's frontmatter or wrapper, so the reviewer
// contract stays identical everywhere.

const fs = require('fs');
const path = require('path');

const AGENTS = Object.freeze(['devil-advocate', 'judge']);

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

// Description comes from the canonical Claude agent file so it is written once.
function agentSpec(root, name) {
  if (!AGENTS.includes(name)) throw new Error(`Unknown reviewer agent "${name}"`);
  const body = readText(path.join(root, 'agents', 'shared', `${name}.body.md`)).replace(/\s+$/, '\n');
  const claude = readText(path.join(root, '.claude', 'agents', `${name}.md`));
  const line = claude.split('\n').find((l) => l.startsWith('description:'));
  if (!line) throw new Error(`.claude/agents/${name}.md has no description`);
  return { name, description: line.slice('description:'.length).trim(), body };
}

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}:\n${value.map((v) => `  - ${v}`).join('\n')}`;
    return `${key}: ${value}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n`;
}

// TOML multi-line literal string: no escapes, so the body must not contain '''.
function tomlLiteral(text) {
  if (text.includes("'''")) throw new Error("agent body must not contain ''' for codex-toml");
  return `'''\n${text}'''`;
}

function tomlString(text) {
  return JSON.stringify(text);
}

const FORMATS = Object.freeze({
  // Canonical files committed in the repo (their frontmatter is host-tuned).
  // https://code.claude.com/docs/en/sub-agents
  'claude-md': { file: (name) => `${name}.md`, src: (name) => `.claude/agents/${name}.md` },
  // https://docs.x.ai/build/features/subagents
  'grok-md': { file: (name) => `${name}.md`, src: (name) => `.grok/agents/${name}.md` },
  // https://developers.openai.com/codex/subagents: name, description,
  // developer_instructions required; reviewers run read-only.
  'codex-toml': {
    file: (name) => `${name}.toml`,
    render: (spec) => [
      `name = ${tomlString(spec.name)}`,
      `description = ${tomlString(spec.description)}`,
      'sandbox_mode = "read-only"',
      `developer_instructions = ${tomlLiteral(spec.body)}`,
      ''
    ].join('\n')
  },
  // https://geminicli.com/docs/core/subagents/: tools omitted = inherit.
  'gemini-md': {
    file: (name) => `${name}.md`,
    render: (spec) => frontmatter({ name: spec.name, description: spec.description, kind: 'local' }) + spec.body
  },
  // https://cursor.com/docs/subagents
  'cursor-md': {
    file: (name) => `${name}.md`,
    render: (spec) => frontmatter({ name: spec.name, description: spec.description, model: 'inherit', readonly: true }) + spec.body
  },
  // https://docs.github.com/en/copilot/reference/custom-agents-configuration
  'copilot-agent-md': {
    file: (name) => `${name}.agent.md`,
    render: (spec) => frontmatter({ name: spec.name, description: spec.description }) + spec.body
  },
  // https://antigravity.google/docs/subagents (tool names from the documented example only:
  // an unknown tool name can hang the subagent).
  'antigravity-md': {
    file: (name) => `${name}.md`,
    render: (spec) => frontmatter({
      name: spec.name,
      description: spec.description,
      tools: ['view_file', 'grep_search', 'run_command'],
      subagent: true,
      mainAgent: false
    }) + spec.body
  }
});

function renderAgent(root, format, name) {
  const fmt = FORMATS[format];
  if (!fmt) throw new Error(`Unknown agent format "${format}"`);
  if (fmt.src) return readText(path.join(root, fmt.src(name)));
  return fmt.render(agentSpec(root, name));
}

function agentFileName(format, name) {
  const fmt = FORMATS[format];
  if (!fmt) throw new Error(`Unknown agent format "${format}"`);
  return fmt.file(name);
}

module.exports = { AGENTS, FORMATS, agentSpec, renderAgent, agentFileName };
