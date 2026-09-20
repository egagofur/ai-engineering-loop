'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_UPDATE_TIMEOUT_MS = 8_000;

function updateError(message, code = 'UPDATE_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function loadPackageMetadata(rootDir) {
  const packagePath = path.join(rootDir, 'package.json');
  const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (!metadata.name || !metadata.version) {
    throw updateError('package.json must include name and version', 'INVALID_PACKAGE_METADATA');
  }
  return {
    name: metadata.name,
    version: metadata.version
  };
}

function parseVersion(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) throw updateError(`Invalid semantic version: ${version || '(empty)'}`, 'INVALID_VERSION');
  return match.slice(1).map((part) => Number(part));
}

function compareVersions(leftVersion, rightVersion) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);
  for (let index = 0; index < left.length; index++) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function npmViewLatestVersion(packageName, { timeoutMs = DEFAULT_UPDATE_TIMEOUT_MS } = {}) {
  if (process.env.AEL_UPDATE_LATEST_VERSION) return process.env.AEL_UPDATE_LATEST_VERSION;
  try {
    const output = execFileSync('npm', ['view', `${packageName}@latest`, 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs
    }).trim();
    return JSON.parse(output);
  } catch (cause) {
    throw updateError(`Unable to check npm for ${packageName}@latest: ${cause.message}`, 'UPDATE_CHECK_FAILED');
  }
}

function detectInstallScope(rootDir) {
  const override = process.env.AEL_INSTALL_SCOPE;
  if (override === 'global' || override === 'project') return override;
  try {
    const globalRoot = execFileSync('npm', ['root', '--global'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3_000
    }).trim();
    const packageRoot = fs.realpathSync(rootDir);
    const realGlobalRoot = fs.realpathSync(globalRoot);
    const relative = path.relative(realGlobalRoot, packageRoot);
    const isGlobalPackage = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    return isGlobalPackage ? 'global' : 'project';
  } catch {
    return 'project';
  }
}

function command(cmd, args) {
  return {
    cmd,
    args,
    display: [cmd, ...args].join(' ')
  };
}

function updateCommands(packageName, installScope) {
  if (installScope === 'global') {
    return [
      command('npm', ['install', '--global', `${packageName}@latest`]),
      command('ai-engineering-loop', ['sync-hosts']),
      command('ai-engineering-loop', ['refresh']),
      command('ai-engineering-loop', ['doctor'])
    ];
  }
  return [
    command('npm', ['install', `${packageName}@latest`, '--save-dev']),
    command('npx', ['ai-engineering-loop', 'sync-hosts']),
    command('npx', ['ai-engineering-loop', 'refresh']),
    command('npx', ['ai-engineering-loop', 'doctor'])
  ];
}

function buildUpdatePlan({ packageName, currentVersion, latestVersion, installScope }) {
  const comparison = compareVersions(currentVersion, latestVersion);
  return {
    schemaVersion: 1,
    packageName,
    currentVersion,
    latestVersion,
    installScope,
    updateAvailable: comparison < 0,
    upToDate: comparison >= 0,
    commands: updateCommands(packageName, installScope)
  };
}

function checkForUpdate(rootDir, {
  latestVersion,
  installScope,
  timeoutMs = DEFAULT_UPDATE_TIMEOUT_MS
} = {}) {
  const metadata = loadPackageMetadata(rootDir);
  const resolvedLatestVersion = latestVersion || npmViewLatestVersion(metadata.name, { timeoutMs });
  const resolvedInstallScope = installScope || detectInstallScope(rootDir);
  return buildUpdatePlan({
    packageName: metadata.name,
    currentVersion: metadata.version,
    latestVersion: resolvedLatestVersion,
    installScope: resolvedInstallScope
  });
}

function executeUpdatePlan(plan, { stdio = 'inherit' } = {}) {
  for (const item of plan.commands) {
    execFileSync(item.cmd, item.args, { stdio });
  }
}

module.exports = {
  DEFAULT_UPDATE_TIMEOUT_MS,
  buildUpdatePlan,
  checkForUpdate,
  compareVersions,
  detectInstallScope,
  executeUpdatePlan,
  npmViewLatestVersion,
  parseVersion,
  updateCommands
};
