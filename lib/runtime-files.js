'use strict';

const fs = require('fs');
const path = require('path');

const PRIVATE_RUNTIME_PATTERNS = Object.freeze([
  'runs/',
  'usage/',
  'worktrees/',
  'locks/',
  'drafts/',
  'recipes/.history/',
  'tasks/current.diff',
  'tasks/*.log'
]);

const PRIVATE_RUNTIME_GITIGNORE =
  `# Runtime artifacts may contain source excerpts and verification logs.\n${PRIVATE_RUNTIME_PATTERNS.join('\n')}\n`;

function assertNotSymlink(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (cause) {
    if (cause.code !== 'ENOENT') throw cause;
  }
  if (stat?.isSymbolicLink()) {
    const err = new Error(`${label} must not be a symbolic link`);
    err.code = 'UNSAFE_RUNTIME_PATH';
    throw err;
  }
}

function ensurePrivateRuntimeIgnores(rootDir) {
  const contextDir = path.join(rootDir, '.ai-engineering-loop');
  assertNotSymlink(contextDir, '.ai-engineering-loop');
  fs.mkdirSync(contextDir, { recursive: true });
  const filePath = path.join(contextDir, '.gitignore');
  assertNotSymlink(filePath, '.ai-engineering-loop/.gitignore');
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const missing = PRIVATE_RUNTIME_PATTERNS.filter((pattern) => (
    !existing.split(/\r?\n/).includes(pattern)
  ));
  if (missing.length === 0) return false;
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  const header = existing ? '' : '# Runtime artifacts may contain source excerpts and verification logs.\n';
  fs.writeFileSync(filePath, `${existing}${separator}${header}${missing.join('\n')}\n`);
  return true;
}

module.exports = {
  PRIVATE_RUNTIME_PATTERNS,
  PRIVATE_RUNTIME_GITIGNORE,
  ensurePrivateRuntimeIgnores
};
