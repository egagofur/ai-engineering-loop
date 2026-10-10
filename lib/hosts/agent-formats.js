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

const FORMATS = Object.freeze({
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
  return fmt.render(agentSpec(root, name));
}

function agentFileName(format, name) {
  const fmt = FORMATS[format];
  if (!fmt) throw new Error(`Unknown agent format "${format}"`);
  return fmt.file(name);
}

module.exports = { AGENTS, FORMATS, agentSpec, renderAgent, agentFileName };
