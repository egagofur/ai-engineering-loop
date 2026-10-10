'use strict';

// Host skills load SKILL.md always and references/loop-*.md on demand (issue #35).
// Content checks that describe the whole loop read the bundle; checks for the
// always-loaded core read SKILL.md alone.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SHARED_REFS = '.claude/skills/ai-engineering-loop/references';
const HOST_SKILLS = Object.freeze({
  '.claude/skills/ai-engineering-loop/SKILL.md': '.claude/skills/ai-engineering-loop/references',
  '.grok/skills/ai-engineering-loop/SKILL.md': '.grok/skills/ai-engineering-loop/references',
  '.gemini/skills/ai-engineering-loop/SKILL.md': '.gemini/skills/ai-engineering-loop/references',
  // Antigravity reads the same references through `ai-engineering-loop docs loop-*`.
  '.agents/workflows/ai-engineering-loop.md': SHARED_REFS
});

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');
}

function readSkillBundle(rel) {
  const skill = read(rel);
  const refs = HOST_SKILLS[rel];
  if (!refs) return skill;
  const dir = path.join(ROOT, refs);
  const parts = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => read(path.posix.join(refs, f)));
  return [skill, ...parts].join('\n');
}

module.exports = { ROOT, HOST_SKILLS, readSkillBundle };
