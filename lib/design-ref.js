'use strict';

// Design documents as Goal input (#97). `goal draft --from-design <doc.md>`
// turns a reviewed design (for example from the `spec` pack, #96) into a
// Goal draft with placeholder rows, and records `designRef` so later stages
// can tell which design a Run implements and whether it changed.

const fs = require('fs');
const path = require('path');
const { sha256 } = require('./fsutil.js');

const MAX_BYTES = 256 * 1024;
const PLACEHOLDER = '<fill:';

function designError(message, code) {
  return Object.assign(new Error(message), { code });
}

function toPosix(file) {
  return file.split(path.sep).join('/');
}

// Bounded, repository-local Markdown file. Returns { path, sha256, text }.
function readDesignDoc(rootDir, fileName) {
  if (!fileName) throw designError('--from-design requires a Markdown file path', 'INVALID_USAGE');
  const file = path.resolve(rootDir, fileName);
  const relative = path.relative(rootDir, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw designError('Design document must stay inside the repository', 'UNSAFE_DESIGN_PATH');
  }
  if (!/\.(md|markdown)$/i.test(file)) throw designError('Design document must be a .md file', 'INVALID_DESIGN_DOC');
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw designError(`Design document not found: ${toPosix(relative)}`, 'DESIGN_DOC_MISSING');
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_BYTES) {
    throw designError('Design document must be a regular file of at most 256 KB', 'INVALID_DESIGN_DOC');
  }
  const buf = fs.readFileSync(file);
  return { path: toPosix(relative), sha256: sha256(buf), text: buf.toString('utf8').replace(/\r\n?/g, '\n') };
}

const SECTION_KINDS = [
  ['nonGoals', /\b(non[- ]?goals?|out of scope|anti[- ]?goals?)\b/],
  ['goals', /^(\d+[.)]\s*)?(goals?|objectives?)\b/],
  ['targetFiles', /\b(target scope|affected files|files? (to )?(change|changed|touch|touched|modify)|file changes|file plan)\b/],
  ['testCases', /\b(test plan|testing|test cases|verification plan)\b/]
];

function sectionKind(heading) {
  const text = heading.toLowerCase().replace(/[*_`]/g, '').trim();
  const hit = SECTION_KINDS.find(([, pattern]) => pattern.test(text));
  return hit ? hit[0] : null;
}

function cleanItem(line) {
  return line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '').replace(/\*\*/g, '').trim();
}

// Lenient: any heading level; top-level bullets (indent <= 1) are items.
function parseDesignDoc(text) {
  const parsed = { title: null, goals: [], nonGoals: [], targetFiles: [], testCases: [], warnings: [] };
  let kind = null;
  let kindLevel = 0;
  let inFence = false;
  const files = new Set();
  for (const line of String(text).split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      if (!parsed.title && level === 1) parsed.title = heading[2].replace(/[*_`]/g, '').trim();
      const next = sectionKind(heading[2]);
      if (next) {
        kind = next;
        kindLevel = level;
      } else if (kind && level <= kindLevel) {
        kind = null;
      }
      continue;
    }
    if (!kind) continue;
    if (kind === 'targetFiles') {
      for (const match of line.matchAll(/`([^`\s]+)`/g)) {
        const candidate = match[1].replace(/^\.\//, '');
        if (/[/.]/.test(candidate) && !candidate.startsWith('/') && !candidate.split('/').includes('..') && !/[()=:]/.test(candidate)) files.add(candidate);
      }
      continue;
    }
    if (/^\s{0,1}(?:[-*+]|\d+[.)])\s+\S/.test(line)) {
      const item = cleanItem(line);
      if (item) parsed[kind].push(item);
    }
  }
  parsed.targetFiles = [...files];
  if (!parsed.testCases.length) parsed.warnings.push('No Test Plan section with bullet items: acceptance rows come from Goals or are placeholders.');
  if (!parsed.targetFiles.length) parsed.warnings.push('No Target Scope section with `file` paths: designRef.targetFiles is empty, so design drift cannot be checked.');
  return parsed;
}

function placeholderRow(index, statement) {
  return {
    id: `AC-${index + 1}`,
    statement,
    evidenceRequired: `${PLACEHOLDER} test file and command that prove this>`,
    failureCases: [`${PLACEHOLDER} what would still look green if this broke>`]
  };
}

function designRefFrom(doc, parsed) {
  return { path: doc.path, sha256: doc.sha256, targetFiles: parsed.targetFiles };
}

// A draft contract built from the document. Never frozen here.
function draftFromDesign(doc, parsed) {
  const rows = parsed.testCases.length ? parsed.testCases : parsed.goals;
  const objective = parsed.goals[0] || parsed.title || `Implement ${doc.path}`;
  return {
    objective: parsed.title && parsed.goals[0] ? `${parsed.title}: ${parsed.goals[0]}` : objective,
    acceptanceCriteria: rows.length
      ? rows.map((row, index) => placeholderRow(index, row))
      : [placeholderRow(0, `${PLACEHOLDER} acceptance criterion from ${doc.path}>`)],
    ...(parsed.nonGoals.length ? { outOfScope: parsed.nonGoals } : {}),
    designRef: designRefFrom(doc, parsed)
  };
}

function validateDesignRef(ref) {
  if (ref === undefined) return [];
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return ['designRef must be an object'];
  const errors = [];
  if (typeof ref.path !== 'string' || !ref.path || ref.path.startsWith('/') || ref.path.split('/').includes('..')) {
    errors.push('designRef.path must be a repository-relative path');
  }
  if (!/^[a-f0-9]{64}$/.test(String(ref.sha256 || ''))) errors.push('designRef.sha256 must be a sha256 hex digest');
  if (ref.targetFiles !== undefined && (!Array.isArray(ref.targetFiles) || ref.targetFiles.some((item) => typeof item !== 'string' || !item))) {
    errors.push('designRef.targetFiles must be an array of paths');
  }
  return errors;
}

// AC ids that still hold `<fill:` placeholders; freeze refuses them.
function placeholderRows(contract) {
  return (contract?.acceptanceCriteria || [])
    .filter((row) => [row.statement, row.evidenceRequired, ...(row.failureCases || [])].some((value) => String(value || '').includes(PLACEHOLDER)))
    .map((row) => row.id);
}

// Whether the referenced design still matches the hash recorded in the contract.
function designStatus(rootDir, ref) {
  if (!ref) return null;
  const file = path.resolve(rootDir, ref.path);
  let current = null;
  try {
    const stat = fs.lstatSync(file);
    if (stat.isFile() && !stat.isSymbolicLink()) current = sha256(fs.readFileSync(file));
  } catch {
    current = null;
  }
  return { path: ref.path, missing: current === null, designChanged: current !== ref.sha256 };
}

module.exports = {
  PLACEHOLDER,
  readDesignDoc,
  parseDesignDoc,
  draftFromDesign,
  designRefFrom,
  validateDesignRef,
  placeholderRows,
  designStatus
};
