#!/usr/bin/env node
'use strict';

// Usage: node scripts/build-host-skills.js [--check]
const { writeHostSkills, checkHostSkills } = require('../lib/host-skill-build.js');

if (process.argv.includes('--check')) {
  const drift = checkHostSkills();
  if (drift.length) {
    console.error(`Host skills drift from skill-src/ (run npm run build:skills):\n${drift.map((p) => `- ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('Host skills match skill-src/.');
} else {
  const written = writeHostSkills();
  console.log(written.length ? `Wrote:\n${written.map((p) => `- ${p}`).join('\n')}` : 'Host skills already up to date.');
}
