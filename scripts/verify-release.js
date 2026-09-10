#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const requestedTag = String(process.argv[2] || process.env.GITHUB_REF_NAME || '').trim();
const tagVersion = requestedTag.replace(/^v/, '');
let cliVersion = '';
try {
  cliVersion = execFileSync(
    process.execPath,
    [path.join(root, 'bin', 'ai-engineering-loop.js'), '--version'],
    { encoding: 'utf8' }
  ).trim().replace(/^ai-engineering-loop v/, '');
} catch {
  cliVersion = 'unavailable';
}

const errors = [];
if (!requestedTag) errors.push('release tag is required');
if (tagVersion && tagVersion !== pkg.version) {
  errors.push(`tag ${requestedTag} does not match package ${pkg.version}`);
}
if (cliVersion !== pkg.version) {
  errors.push(`CLI version ${cliVersion} does not match package ${pkg.version}`);
}
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log(`Release versions agree: ${requestedTag} = ${pkg.version}`);
