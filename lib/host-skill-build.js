'use strict';

// Host skill build (issues #35, #48). One template plus one overlay produces a
// single host-neutral ai-engineering-loop skill and its references/. The same
// bytes are written to every output directory, so a host that reads several
// skill folders (Grok, Cursor, OpenCode, Amp, Augment) only ever sees identical
// copies. Host-specific spawn rules live in references/loop-hosts.md. The
// generated files are committed (they ship in the npm package); a drift test
// fails when a generated file is edited by hand instead of skill-src/.

const fs = require('fs');
const path = require('path');

const SOURCE_DIR = 'skill-src/ai-engineering-loop';
const SKILL_CHAR_LIMIT = 4000;
// Compact digest for instruction-only hosts (#60), served by `docs AGENTS`.
const DIGEST_SOURCE = 'digest.md';
const DIGEST_PATH = 'agents/instruction-only/AGENTS.md';
const DIGEST_BYTE_LIMIT = 2048;
const GENERATED_NOTE = '<!-- Generated from skill-src/ by npm run build:skills; do not edit. -->';

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

// Overlay format: `@@ key: value` (one line) or `@@ key` followed by a block
// that runs until the next `@@` line.
function parseOverlay(text) {
  const values = {};
  let current = null;
  for (const line of text.split('\n')) {
    const header = line.match(/^@@ ([a-zA-Z]+)(?::\s?(.*))?$/);
    if (header) {
      current = null;
      if (header[2] !== undefined) values[header[1]] = header[2];
      else {
        current = header[1];
        values[current] = [];
      }
      continue;
    }
    if (current) values[current].push(line);
  }
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) values[key] = value.join('\n').replace(/\s+$/, '');
  }
  return values;
}

function render(template, values, label) {
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`${label}: missing overlay value "${key}"`);
    return values[key];
  });
}

function insertNote(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n/);
  if (!match) return `${GENERATED_NOTE}\n${content}`;
  return `${match[0]}${GENERATED_NOTE}\n${content.slice(match[0].length)}`;
}

// Returns [{ path, content }] relative to the package root.
function buildHostSkills(root = path.join(__dirname, '..')) {
  const src = path.join(root, SOURCE_DIR);
  const template = readText(path.join(src, 'SKILL.template.md'));
  const refDir = path.join(src, 'references');
  const references = fs.readdirSync(refDir).filter((f) => f.endsWith('.md')).sort()
    .map((name) => ({ name, content: readText(path.join(refDir, name)) }));
  const overlay = parseOverlay(readText(path.join(src, 'overlay.md')));
  const dirs = String(overlay.outputs || '').split(',').map((d) => d.trim()).filter(Boolean);
  if (!dirs.length) throw new Error('overlay needs "@@ outputs: <dir>[, <dir>]"');
  const body = insertNote(render(template, overlay, 'overlay').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n'));
  const outputs = [];
  for (const dir of dirs) {
    outputs.push({ path: path.posix.join(dir, 'SKILL.md'), content: body, kind: 'skill' });
    for (const ref of references) {
      outputs.push({ path: path.posix.join(dir, 'references', ref.name), content: ref.content, kind: 'reference' });
    }
  }
  const digest = `${GENERATED_NOTE}\n${readText(path.join(src, DIGEST_SOURCE)).replace(/\s*$/, '\n')}`;
  const bytes = Buffer.byteLength(digest, 'utf8');
  if (bytes > DIGEST_BYTE_LIMIT) throw new Error(`${DIGEST_PATH}: ${bytes} bytes > ${DIGEST_BYTE_LIMIT}`);
  outputs.push({ path: DIGEST_PATH, content: digest, kind: 'digest' });
  return outputs;
}

function checkHostSkills(root = path.join(__dirname, '..')) {
  const drift = [];
  for (const out of buildHostSkills(root)) {
    let actual = null;
    try {
      actual = readText(path.join(root, out.path));
    } catch {
      // Missing file counts as drift.
    }
    if (actual !== out.content) drift.push(out.path);
  }
  return drift;
}

function writeHostSkills(root = path.join(__dirname, '..')) {
  const written = [];
  for (const out of buildHostSkills(root)) {
    const abs = path.join(root, out.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    let actual = null;
    try {
      actual = readText(abs);
    } catch {
      // New file.
    }
    if (actual !== out.content) {
      fs.writeFileSync(abs, out.content);
      written.push(out.path);
    }
  }
  return written;
}

module.exports = {
  SOURCE_DIR,
  SKILL_CHAR_LIMIT,
  DIGEST_PATH,
  DIGEST_BYTE_LIMIT,
  GENERATED_NOTE,
  parseOverlay,
  buildHostSkills,
  checkHostSkills,
  writeHostSkills
};
