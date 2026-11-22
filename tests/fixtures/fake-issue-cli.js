'use strict';

// Test double for `gh` and `glab`. Records argv and prints a canned issue.
// It has no write commands: a comment/create/update/close exits 2.

const fs = require('fs');

const args = process.argv.slice(2);
if (process.env.AEL_ISSUE_LOG) fs.appendFileSync(process.env.AEL_ISSUE_LOG, `${JSON.stringify(args)}\n`);
if (args.some((arg) => /^(comment|create|close|update|edit|note|reopen|delete)$/i.test(arg))) {
  process.stderr.write('refusing a write\n');
  process.exit(2);
}
if (process.env.AEL_ISSUE_EXIT) {
  process.stderr.write(process.env.AEL_ISSUE_STDERR || 'failed\n');
  process.exit(Number(process.env.AEL_ISSUE_EXIT));
}
const file = process.env.AEL_ISSUE_BODY_FILE;
const body = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : (process.env.AEL_ISSUE_JSON || '{}\n');
process.stdout.write(body);
