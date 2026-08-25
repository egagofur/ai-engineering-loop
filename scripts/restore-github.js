#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const readmePath = path.join(rootDir, 'README.md');
const backupPath = path.join(rootDir, '.README.github.bak.md');

if (fs.existsSync(backupPath)) {
  // Restore full GitHub README
  fs.copyFileSync(backupPath, readmePath);
  fs.unlinkSync(backupPath);
  console.log('[restore-github] Restored full GitHub README.md successfully.');
}
