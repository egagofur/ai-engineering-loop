#!/usr/bin/env node
'use strict';

// Writes the README host table from lib/hosts/registry.js (#52). --check fails on drift.
const fs = require('fs');
const path = require('path');
const { replaceHostTable } = require('../lib/hosts/table.js');

const readme = path.join(__dirname, '..', 'README.md');
const current = fs.readFileSync(readme, 'utf8').replace(/\r\n?/g, '\n');
const next = replaceHostTable(current);
if (process.argv.includes('--check')) {
  if (next !== current) {
    console.error('README host table is out of date. Run: npm run build:hosts-table');
    process.exit(1);
  }
  console.log('README host table matches the registry.');
} else if (next !== current) {
  fs.writeFileSync(readme, next);
  console.log('Wrote README host table.');
}
