'use strict';

// Built-in rule kinds (C-20, "All Code Is Slop (Except Mine)" 05:24-06:46):
// the two corrections teams make most often, without hand-written grep.
// - forbid-import "<fromGlob> -> <toGlob>": files under fromGlob may not
//   import modules under toGlob (relative paths are resolved; bare names
//   such as `fs` or `react` are matched as written).
// - forbid-api "<regex>" except "<glob>": the API may only appear inside
//   the excepted paths (for example a framework folder).
// Both judge only lines the change adds (the C-17 ratchet env).

const fs = require('fs');
const path = require('path');
const { matchesGlob } = require('./impact-map.js');

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/g;
const EXTENSIONS = ['', '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '/index.js', '/index.ts'];

function parseImportSpec(spec) {
  const parts = String(spec || '').split('->').map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw Object.assign(new Error('--forbid-import needs "<fromGlob> -> <toGlob>", e.g. "src/renderer/** -> src/main/**"'), { code: 'INVALID_USAGE' });
  }
  return { from: parts[0], to: parts[1] };
}

function readAddedLines(env = process.env) {
  const file = env.AEL_ADDED_LINES_FILE;
  if (!file) return [];
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').filter(Boolean).flatMap((raw) => {
    const match = raw.match(/^(.+?):(\d+):(.*)$/);
    return match ? [{ file: match[1].replace(/\\/g, '/'), line: Number(match[2]), text: match[3] }] : [];
  });
}

function importTargets(file, text) {
  const targets = [];
  for (const match of text.matchAll(IMPORT_SPECIFIER)) {
    const spec = match[1];
    if (spec.startsWith('.')) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      targets.push({ spec, candidates: EXTENSIONS.map((ext) => `${resolved}${ext}`) });
    } else {
      targets.push({ spec, candidates: [spec] });
    }
  }
  return targets;
}

// [{ file, line, message }]
function checkRule(rule, lines) {
  const violations = [];
  if (rule.kind === 'forbid-import') {
    const { from, to } = parseImportSpec(rule.spec);
    for (const added of lines) {
      if (!matchesGlob(added.file, from)) continue;
      for (const target of importTargets(added.file, added.text)) {
        if (target.candidates.some((candidate) => matchesGlob(candidate, to) || candidate === to)) {
          violations.push({ file: added.file, line: added.line, message: `imports "${target.spec}" (${to}), forbidden from ${from}` });
        }
      }
    }
  } else if (rule.kind === 'forbid-api') {
    const pattern = new RegExp(rule.pattern);
    for (const added of lines) {
      if (rule.except && matchesGlob(added.file, rule.except)) continue;
      if (pattern.test(added.text)) {
        violations.push({ file: added.file, line: added.line, message: `uses /${rule.pattern}/ outside ${rule.except || 'the allowed paths'}` });
      }
    }
  } else {
    throw Object.assign(new Error(`Rule ${rule.id} has no built-in kind`), { code: 'INVALID_RULE' });
  }
  return violations;
}

// Shell text that runs `rules check <id>` with this very CLI, so a rules.json
// shared across machines never stores a machine-specific path.
function builtinCommand(rule) {
  const bin = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');
  return `"${process.execPath}" "${bin}" rules check ${rule.id}`;
}

module.exports = { builtinCommand, checkRule, importTargets, parseImportSpec, readAddedLines };
