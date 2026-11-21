'use strict';

const fs = require('fs');

const fixture = process.env.AEL_FAKE_GH_FILE ? JSON.parse(fs.readFileSync(process.env.AEL_FAKE_GH_FILE, 'utf8')) : {};
const args = process.argv.slice(2);
const state = args[args.indexOf('--state') + 1];
const key = args[0] === 'pr' && args[1] === 'view' ? 'view' : args[0] === 'pr' && args[1] === 'list' ? `list-${state}` : 'other';
const answer = fixture[key];
if (answer && answer.exit) {
  process.stderr.write(answer.stderr || 'failed\n');
  process.exit(answer.exit);
}
process.stdout.write(JSON.stringify(answer === undefined ? [] : answer));
