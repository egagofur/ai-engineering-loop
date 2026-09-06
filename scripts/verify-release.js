#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const requestedTag = String(process.argv[2] || process.env.GITHUB_REF_NAME || '').trim();
const tagVersion = requestedTag.replace(/^v/, '');
const cli = fs.readFileSync(path.join(root, 'bin', 'ai-engineering-loop.js'), 'utf8');
const cliMatch = cli.match(/const VERSION = '([^']+)'/);

const errors = [];
if (!requestedTag) errors.push('release tag is required');
if (tagVersion && tagVersion !== pkg.version) {
  errors.push(`tag ${requestedTag} does not match package ${pkg.version}`);
}
if (!cliMatch || cliMatch[1] !== pkg.version) {
  errors.push(`CLI version ${cliMatch?.[1] || 'missing'} does not match package ${pkg.version}`);
}
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log(`Release versions agree: ${requestedTag} = ${pkg.version}`);
