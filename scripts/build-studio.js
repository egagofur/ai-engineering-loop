#!/usr/bin/env node
'use strict';

// Usage: node scripts/build-studio.js [--check]
// Builds the Svelte Studio from studio/src into studio/app (committed and shipped).
// --check rebuilds into a temp folder and fails if studio/app drifted from the sources.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'studio', 'app');
const CONFIG = path.join(ROOT, 'studio', 'vite.config.mjs');
const LICENSES = [
  ['three.LICENSE', path.join(ROOT, 'studio', 'vendor', 'three.LICENSE')],
  ['svelte.LICENSE', path.join(ROOT, 'node_modules', 'svelte', 'LICENSE.md')]
];

async function build(outDir) {
  let vite;
  try {
    vite = await import('vite');
  } catch {
    throw new Error('Vite is not installed. Run `npm ci` first, then `npm run build:studio`.');
  }
  process.env.AEL_STUDIO_OUT = outDir;
  await vite.build({ configFile: CONFIG, logLevel: 'warn' });
  const licenses = path.join(outDir, 'licenses');
  fs.mkdirSync(licenses, { recursive: true });
  for (const [name, source] of LICENSES) fs.copyFileSync(source, path.join(licenses, name));
}

function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  }).sort();
}

function drift(expectedDir, actualDir) {
  const expected = listFiles(expectedDir);
  const actual = listFiles(actualDir);
  const problems = [];
  for (const file of expected) {
    if (!actual.includes(file)) problems.push(`missing studio/app/${file}`);
    else if (!fs.readFileSync(path.join(expectedDir, file)).equals(fs.readFileSync(path.join(actualDir, file)))) problems.push(`stale studio/app/${file}`);
  }
  for (const file of actual) if (!expected.includes(file)) problems.push(`extra studio/app/${file}`);
  return problems;
}

async function main() {
  if (!process.argv.includes('--check')) {
    await build(APP);
    console.log(`Built Studio into studio/app (${listFiles(APP).length} files).`);
    return;
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-'));
  try {
    await build(temp);
    const problems = drift(temp, APP);
    if (problems.length) {
      console.error(`Studio build drifts from studio/src (run npm run build:studio):\n${problems.map((item) => `- ${item}`).join('\n')}`);
      process.exitCode = 1;
      return;
    }
    console.log('Studio build matches studio/src.');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
