'use strict';

// Host skills load SKILL.md always and references/loop-*.md on demand (issue #35).
// Since #48 one host-neutral skill ships byte-identical in .claude/skills and
// .agents/skills. Content checks that describe the whole loop read the bundle;
// checks for the always-loaded core read SKILL.md alone.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HOST_SKILLS = Object.freeze({
  '.claude/skills/ai-engineering-loop/SKILL.md': '.claude/skills/ai-engineering-loop/references',
  '.agents/skills/ai-engineering-loop/SKILL.md': '.agents/skills/ai-engineering-loop/references'
});

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');
}

function readSkillBundle(rel, { excludeHosts = false } = {}) {
  const skill = read(rel);
  const refs = HOST_SKILLS[rel];
  if (!refs) return skill;
  const dir = path.join(ROOT, refs);
  const parts = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !(excludeHosts && f === 'loop-hosts.md'))
    .sort()
    .map((f) => read(path.posix.join(refs, f)));
  return [skill, ...parts].join('\n');
}

// One host's section of references/loop-hosts.md (heading text prefix match).
function readHostSection(heading) {
  const text = read('.agents/skills/ai-engineering-loop/references/loop-hosts.md');
  const sections = text.split(/\n(?=## )/);
  const found = sections.find((s) => s.startsWith(`## ${heading}`));
  if (!found) throw new Error(`loop-hosts.md has no "## ${heading}" section`);
  return found;
}

module.exports = { ROOT, HOST_SKILLS, readSkillBundle, readHostSection };
