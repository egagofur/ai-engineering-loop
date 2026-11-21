'use strict';

// Clean state at delivery (C-06, learn-harness-engineering L12): the next
// session must start from a tree it can trust. Checked at `gate delivery`.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { runsDir } = require('./run-state.js');
const { parseDiff } = require('./verification-integrity.js');

const DEBUG_MARKERS = [
  { pattern: /^\s*debugger\s*;?\s*$/, label: 'debugger statement' },
  { pattern: /^(<{7}|={7}|>{7})( |$)/, label: 'merge conflict marker' },
  { pattern: /\bbreakpoint\(\)|\bpdb\.set_trace\(\)|\bbinding\.pry\b/, label: 'interactive breakpoint' }
];
const SECRET_FILE = /(^|\/)\.env(\.(?!example$|sample$|template$)[\w-]+)?$|(^|\/)(id_rsa|id_ed25519)$|\.(pem|p12|pfx|key)$/;

function untrackedFiles(rootDir) {
  try {
    return execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ':(exclude).ai-engineering-loop'], {
      cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function uncommittedChange(rootDir, run, files) {
  const paths = files.map((file) => file.path).filter((file) => !file.startsWith('.ai-engineering-loop/'));
  if (!paths.length) return [];
  let status = '';
  try {
    status = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all', '--', ...paths], {
      cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return [];
  }
  return [...new Set(status.split('\0').filter((entry) => /^.. /.test(entry)).map((entry) => entry.slice(3)))]
    .filter((file) => paths.includes(file));
}

function templateOnlyArtifacts(rootDir, run) {
  const found = [];
  const dirs = [path.join(runsDir(rootDir), run.runId), path.join(rootDir, '.ai-engineering-loop', 'tasks')];
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    } catch {
      continue;
    }
    for (const name of entries) {
      try {
        if (JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))?._templateOnly === true) {
          found.push(path.relative(rootDir, path.join(dir, name)).split(path.sep).join('/'));
        }
      } catch {
        // Not JSON we own; ignore.
      }
    }
  }
  return found;
}

// { errors, warnings }: errors always block delivery; stray untracked files
// block in UNATTENDED and warn in ASSISTED (people keep scratch files).
function checkCleanState(rootDir, run, { mode = 'ASSISTED' } = {}) {
  const errors = [];
  const warnings = [];
  let diffText = '';
  try {
    diffText = fs.readFileSync(path.join(rootDir, run.artifacts.diff.path), 'utf8');
  } catch {
    diffText = '';
  }
  const files = parseDiff(diffText);
  for (const file of files) {
    if (!file.deleted && SECRET_FILE.test(file.path)) {
      errors.push(`${file.path}: secret-like file is part of the change. FIX: remove it from the change and add it to .gitignore; ship an .env.example instead.`);
    }
    for (const added of file.added) {
      const hit = DEBUG_MARKERS.find((marker) => marker.pattern.test(added.text));
      if (hit) errors.push(`${file.path}:${added.line}: ${hit.label} left in the change. FIX: remove it, re-run the Maker gate and verify.`);
    }
  }
  for (const artifact of templateOnlyArtifacts(rootDir, run)) {
    errors.push(`${artifact}: still a _templateOnly scaffold. FIX: fill it with observed facts and remove _templateOnly, or delete it.`);
  }
  const pending = uncommittedChange(rootDir, run, files);
  if (pending.length) {
    const list = pending.slice(0, 10).join(' ');
    errors.push(`the reviewed change is not committed (${pending.length} file(s): ${pending.slice(0, 10).join(', ')}${pending.length > 10 ? ', ...' : ''}); the receipt would bind a HEAD without it. FIX: \`git add ${list} && git commit -m "<message>"\`, then rerun \`deliver\`.`);
  }
  const inDiff = new Set(files.map((file) => file.path));
  const strays = untrackedFiles(rootDir).filter((file) => !inDiff.has(file));
  if (strays.length) {
    const message = `untracked file(s) not part of the reviewed change: ${strays.slice(0, 10).join(', ')}${strays.length > 10 ? ', ...' : ''}. FIX: delete them, add them to .gitignore, or include them and re-run the Maker gate.`;
    (mode === 'UNATTENDED' ? errors : warnings).push(message);
  }
  return { errors, warnings };
}

module.exports = { checkCleanState, untrackedFiles };
