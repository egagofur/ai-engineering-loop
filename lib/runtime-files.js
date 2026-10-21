'use strict';

const fs = require('fs');
const path = require('path');

const PRIVATE_RUNTIME_PATTERNS = Object.freeze([
  'runs/',
  'usage/',
  'bench/',
  'worktrees/',
  'locks/',
  'drafts/',
  'studio-layouts/',
  'studio.json',
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

// A crash mid-append can leave an unterminated last line in a JSONL ledger.
// Readers keep complete lines and a tail that still parses; an unparseable
// tail is reported as torn instead of failing the whole ledger.
function splitJsonlLines(text) {
  const lines = String(text).split('\n');
  const tail = lines.pop();
  const complete = lines.filter(Boolean);
  if (!tail) return { lines: complete, tornTail: null };
  try {
    JSON.parse(tail);
    return { lines: [...complete, tail], tornTail: null };
  } catch {
    return { lines: complete, tornTail: tail };
  }
}

// Writers call this before appending so a new record never fuses with a torn
// tail. A parseable tail only lacks its newline; an unparseable one is moved
// to a quarantine file next to the ledger and truncated away.
function repairJsonlTail(filePath) {
  let buffer;
  try {
    if (!fs.lstatSync(filePath).isFile()) return null;
    buffer = fs.readFileSync(filePath);
  } catch (cause) {
    if (cause.code === 'ENOENT') return null;
    throw cause;
  }
  if (buffer.length === 0 || buffer[buffer.length - 1] === 0x0a) return null;
  const end = buffer.lastIndexOf(0x0a) + 1;
  const tail = buffer.subarray(end).toString('utf8');
  try {
    JSON.parse(tail);
    fs.appendFileSync(filePath, '\n');
    return { repaired: 'newline' };
  } catch {}
  const quarantine = `${filePath}.torn-${Date.now()}-${process.pid}`;
  fs.writeFileSync(quarantine, tail, { mode: 0o600 });
  fs.truncateSync(filePath, end);
  return { repaired: 'quarantined', quarantine };
}

module.exports = {
  PRIVATE_RUNTIME_PATTERNS,
  PRIVATE_RUNTIME_GITIGNORE,
  ensurePrivateRuntimeIgnores,
  repairJsonlTail,
  splitJsonlLines
};
