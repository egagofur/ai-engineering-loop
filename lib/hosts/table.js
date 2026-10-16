'use strict';

// README host table generated from the registry (#52); `npm test` fails on drift.

const { HOSTS, OUT_OF_SCOPE, SHARED_SKILLS_DIR, usesSharedSkills } = require('./registry.js');

const START = '<!-- hosts-table:start (generated from lib/hosts/registry.js; run npm run build:hosts-table) -->';
const END = '<!-- hosts-table:end -->';

// `full (default, v1.16.0, 2026-10-20)` when certified, else the bare tier.
function certificationLabel(host) {
  const by = host.certifiedBy;
  return by ? `${host.certification} (${by.recipe}, v${by.aelVersion}, ${by.date})` : host.certification;
}

function renderHostTable() {
  const rows = HOSTS.map((host) => {
    const skills = usesSharedSkills(host) ? `\`~/${SHARED_SKILLS_DIR}\` (shared)` : `\`~/${host.skills.dir}\``;
    const agents = host.agents ? `\`~/${host.agents.dir}\`` : 'none (in-session review)';
    const detect = [...host.detect.dirs.map((d) => `\`~/${d}\``), ...(host.detect.bins || []).map((b) => `\`${b}\``)].join(', ');
    return `| ${host.name} | \`${host.id}\` | ${certificationLabel(host)} | ${skills} | ${agents} | ${detect} |`;
  });
  return [
    START,
    '| Host | id | Certification | Skill folder | Reviewer agents | Detected by |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    'Certification: **full** = a real `default` recipe run with reviewer subagents and every gate is recorded for this host; **experimental** = reviewer subagents install, no recorded run; **instruction-only** = no subagents, review runs in-session (`CONTEXT_ISOLATION_ONLY`; compact digest: `npx ai-engineering-loop docs AGENTS`).',
    '',
    `Not supported (no native skills): ${OUT_OF_SCOPE.map((h) => h.name).join(', ')}.`,
    END
  ].join('\n');
}

function replaceHostTable(text) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start === -1 || end === -1 || end < start) throw new Error('README has no hosts-table markers');
  return text.slice(0, start) + renderHostTable() + text.slice(end + END.length);
}

module.exports = { START, END, certificationLabel, renderHostTable, replaceHostTable };
