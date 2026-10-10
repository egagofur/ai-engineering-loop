'use strict';

// Read-only access to packaged specs. Host skills cite `ai-engineering-loop docs <name>`
// instead of repository-relative paths such as `core/grill-policy.md`, because
// target repositories never contain the package's core/ or policies/ (issue #27).

const fs = require('fs');
const path = require('path');

// Loop stage references are generated host-neutral copies (issue #35).
const DOC_ROOTS = Object.freeze(['core', 'policies', 'profiles', 'agents', 'adapters', '.claude/skills/ai-engineering-loop/references']);

function packageRoot() {
  return path.join(__dirname, '..');
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(abs);
  }
}

function listDocs(root = packageRoot()) {
  const files = [];
  for (const dir of DOC_ROOTS) walk(path.join(root, dir), files);
  const counts = new Map();
  const docs = files.map((abs) => {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const base = path.basename(rel, '.md');
    counts.set(base, (counts.get(base) || 0) + 1);
    return { rel, base, bytes: fs.statSync(abs).size };
  });
  return docs
    .map((doc) => ({ ...doc, name: counts.get(doc.base) === 1 && doc.base !== 'SKILL' ? doc.base : doc.rel.replace(/\.md$/, '') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveDoc(name, root = packageRoot()) {
  const wanted = String(name || '').replace(/\.md$/, '').replace(/\\/g, '/');
  if (!wanted || wanted.includes('..')) return null;
  return listDocs(root).find((doc) => doc.name === wanted || doc.rel.replace(/\.md$/, '') === wanted) || null;
}

function extractSection(markdown, heading) {
  const lines = String(markdown).split('\n');
  const needle = String(heading).trim().toLowerCase();
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && line.replace(/^#{1,6}\s+/, '').trim().toLowerCase().includes(needle));
  if (start === -1) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const out = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s/);
    if (match && match[1].length <= level) break;
    out.push(lines[index]);
  }
  return out.join('\n').replace(/\s+$/, '');
}

function readDoc(name, { section = null, root = packageRoot() } = {}) {
  const doc = resolveDoc(name, root);
  if (!doc) {
    const err = new Error(`Unknown doc "${name}". Run "ai-engineering-loop docs list".`);
    err.code = 'UNKNOWN_DOC';
    throw err;
  }
  const text = fs.readFileSync(path.join(root, doc.rel), 'utf8').replace(/\r\n?/g, '\n');
  if (!section) return { ...doc, text };
  const part = extractSection(text, section);
  if (part == null) {
    const err = new Error(`Section "${section}" not found in ${doc.rel}`);
    err.code = 'UNKNOWN_SECTION';
    throw err;
  }
  return { ...doc, section, text: part };
}

module.exports = {
  DOC_ROOTS,
  listDocs,
  resolveDoc,
  readDoc,
  extractSection
};
