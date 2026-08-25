#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const readmePath = path.join(rootDir, 'README.md');
const readmeNpmPath = path.join(rootDir, 'README.npm.md');
const backupPath = path.join(rootDir, '.README.github.bak.md');

if (fs.existsSync(readmeNpmPath)) {
  // Backup full GitHub README
  fs.copyFileSync(readmePath, backupPath);
  // Replace with simplified NPM README for packing
  fs.copyFileSync(readmeNpmPath, readmePath);
  console.log('[prepare-npm] Swapped README.md with simplified README.npm.md for NPM packaging.');
}
