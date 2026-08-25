#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const readmePath = path.join(rootDir, 'README.md');
const readmeNpmPath = path.join(rootDir, 'README.npm.md');
const backupPath = path.join(rootDir, '.README.github.bak.md');

try {
  console.log('[publish-npm] 1. Backing up full GitHub README.md...');
  fs.copyFileSync(readmePath, backupPath);

  console.log('[publish-npm] 2. Replacing README.md with simplified README.npm.md...');
  fs.copyFileSync(readmeNpmPath, readmePath);

  console.log('[publish-npm] 3. Running npm publish --access public...');
  execSync('npm publish --access public', { cwd: rootDir, stdio: 'inherit' });

  console.log('[publish-npm] 4. Publishing completed successfully.');
} catch (error) {
  console.error('[publish-npm] Publishing failed:', error.message);
} finally {
  if (fs.existsSync(backupPath)) {
    console.log('[publish-npm] 5. Restoring full GitHub README.md...');
    fs.copyFileSync(backupPath, readmePath);
    fs.unlinkSync(backupPath);
    console.log('[publish-npm] Full GitHub README.md restored.');
  }
}
