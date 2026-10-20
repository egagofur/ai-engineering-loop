'use strict';

// Major-version migrations (decision 6 on #37). A release that crosses a major
// may ship `migrations/<major>.js`:
//
//   module.exports = {
//     major: 2,
//     description: 'one line',
//     migrateHome({ home }) {},          // optional, user-level state
//     migrateProject({ projectDir }) {}  // optional, once per registered project
//   };
//
// `update apply` runs `ai-engineering-loop migrate --from <old>` with the NEW
// version after a major install. Each step must be idempotent; applied steps
// are also recorded in ~/.ai-engineering-loop/migrations.json so re-runs skip
// them (projects registered later are still migrated).

const fs = require('fs');
const path = require('path');
const { parseVersion } = require('./update-manager.js');
const { homeDir, userStatePath, readJsonFile, writeJsonFile } = require('./user-state.js');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function loadMigrations(dir = MIGRATIONS_DIR) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => /^\d+\.js$/.test(name));
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const major = Number(name.replace(/\.js$/, ''));
      const migration = require(path.join(dir, name));
      if (!migration || migration.major !== major) {
        throw Object.assign(new Error(`migrations/${name} must export { major: ${major}, ... }`), { code: 'INVALID_MIGRATION' });
      }
      return migration;
    })
    .sort((a, b) => a.major - b.major);
}

function pendingMigrations({ from, to, dir = MIGRATIONS_DIR }) {
  const fromMajor = parseVersion(from)[0];
  const toMajor = parseVersion(to)[0];
  return loadMigrations(dir).filter((m) => m.major > fromMajor && m.major <= toMajor);
}

function runMigrations({ from, to, projects = [], home = homeDir(), dir = MIGRATIONS_DIR, dryRun = false, now = new Date() }) {
  const statePath = userStatePath('migrations.json', home);
  const state = readJsonFile(statePath, { schemaVersion: 1, applied: {} });
  const applied = state.applied || {};
  const report = [];
  for (const migration of pendingMigrations({ from, to, dir })) {
    const key = String(migration.major);
    const record = applied[key] || { home: false, projects: [] };
    const step = { major: migration.major, description: migration.description || '', home: 'skipped', projects: [] };
    if (typeof migration.migrateHome === 'function' && !record.home) {
      if (!dryRun) migration.migrateHome({ home });
      record.home = true;
      step.home = dryRun ? 'would-run' : 'ran';
    }
    if (typeof migration.migrateProject === 'function') {
      for (const project of projects) {
        const projectDir = project.path || project;
        if (record.projects.includes(projectDir)) continue;
        if (!dryRun) migration.migrateProject({ projectDir, home });
        record.projects.push(projectDir);
        step.projects.push(projectDir);
      }
    }
    if (!dryRun) applied[key] = { ...record, at: record.at || now.toISOString() };
    report.push(step);
  }
  if (!dryRun && report.length) writeJsonFile(statePath, { schemaVersion: 1, applied });
  return { from, to, migrations: report };
}

module.exports = { MIGRATIONS_DIR, loadMigrations, pendingMigrations, runMigrations };
