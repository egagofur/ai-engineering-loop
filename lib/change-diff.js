'use strict';

// The Run's change as git sees it: everything between the Run's starting
// revision and the working tree (committed or not), plus untracked files,
// excluding .ai-engineering-loop/. `gate maker --from-git` writes it to
// diff.patch; `verify`, `gate verification` and `gate delivery` compare it with
// the gated diff.patch so the code that is verified, reviewed, judged and
// delivered is the same change.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const EXCLUDE = ':(exclude).ai-engineering-loop';

function git(rootDir, args, allowExit1 = false) {
  try {
    return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (allowExit1 && err.status === 1) return err.stdout;
    throw err;
  }
}

function isGitWorkTree(rootDir) {
  try {
    return git(rootDir, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

// The base the change is measured from: the Run's starting revision when git
// still knows it, else HEAD (legacy Runs without one).
function changeBase(rootDir, run) {
  const started = String(run?.startedRevision || '');
  if (/^[0-9a-f]{7,64}$/.test(started)) {
    try {
      git(rootDir, ['cat-file', '-e', `${started}^{commit}`]);
      return { revision: started, source: 'startedRevision' };
    } catch {
      return { revision: started, source: 'missing' };
    }
  }
  return { revision: 'HEAD', source: 'HEAD' };
}

function readFileSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// { text, untracked: [paths], base }
function captureChangeDiff(rootDir, run) {
  const base = changeBase(rootDir, run);
  if (base.source === 'missing') {
    const err = new Error(`The Run's starting revision ${base.revision.slice(0, 12)} is not in this repository`);
    err.code = 'BASE_REVISION_MISSING';
    throw err;
  }
  let text = git(rootDir, ['diff', '--binary', base.revision, '--', '.', EXCLUDE]);
  const aelOnlyIgnore = (file) => file === '.gitignore'
    && (readFileSafe(path.join(rootDir, file)) || '').trim().replace(/\/+$/, '') === '.ai-engineering-loop';
  const untracked = git(rootDir, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', EXCLUDE])
    .split('\0').filter(Boolean).filter((file) => !aelOnlyIgnore(file));
  for (const file of untracked) text += git(rootDir, ['diff', '--binary', '--no-index', '--', '/dev/null', file], true);
  return { text, untracked, base };
}

// path -> canonical change text. Keeps only what the change does (mode
// lines, binary payloads, added and removed lines), so the same change
// compares equal whether it is committed, staged, untracked, or written with
// a different context size.
function normalizeDiff(text) {
  const files = new Map();
  let current = null;
  let binary = false;
  const pathOf = (header) => {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(header);
    return match ? match[2] : header;
  };
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { path: pathOf(line), lines: [] };
      files.set(current.path, current);
      binary = false;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).replace(/^b\//, '');
      if (target !== '/dev/null' && target !== current.path) {
        files.delete(current.path);
        current.path = target;
        files.set(target, current);
      }
      continue;
    }
    if (line.startsWith('--- ') || line.startsWith('index ') || line.startsWith('@@')) continue;
    if (line === 'GIT binary patch') {
      binary = true;
      current.lines.push(line);
      continue;
    }
    if (binary) {
      if (line.trim()) current.lines.push(line);
      continue;
    }
    if (/^(new file mode|deleted file mode|old mode|new mode|rename from|rename to|Binary files) /.test(line)) {
      current.lines.push(line);
      continue;
    }
    if (line.startsWith('+') || line.startsWith('-')) current.lines.push(line);
  }
  const result = new Map();
  for (const [file, entry] of files) result.set(file, entry.lines.join('\n'));
  return result;
}

// null when there is nothing to compare (no git, no gated diff, UNATTENDED
// whose diff comes from the sandbox); otherwise { changed: [paths], base }.
// Untracked files the gated diff does not name are left to the clean-state
// check: people keep scratch files, and committing one makes it tracked, so
// it is compared then.
function diffDrift(rootDir, run) {
  const gated = run?.artifacts?.diff?.path;
  if (!gated || run.mode === 'UNATTENDED' || !isGitWorkTree(rootDir)) return null;
  const judged = normalizeDiff(readFileSafe(path.join(rootDir, gated)) || '');
  const capture = captureChangeDiff(rootDir, run);
  const current = normalizeDiff(capture.text);
  const untracked = new Set(capture.untracked);
  const changed = [];
  for (const [file, body] of current) {
    if (!judged.has(file) && untracked.has(file)) continue;
    if (judged.get(file) !== body) changed.push(file);
  }
  for (const file of judged.keys()) if (!current.has(file)) changed.push(file);
  return { changed: [...new Set(changed)].sort(), base: capture.base };
}

module.exports = { EXCLUDE, changeBase, captureChangeDiff, normalizeDiff, diffDrift, isGitWorkTree };
