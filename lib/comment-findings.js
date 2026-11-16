'use strict';

const fs = require('fs');
const path = require('path');
const { isTestFile, parseDiff } = require('./verification-integrity.js');

const SOURCE = 'comment-justification';
const NO_COMMENTS_SOURCE = 'no-comments';
const SKIP_FILE = /\.(md|mdx|txt|rst|json|jsonc|lock|ya?ml|toml|ini|cfg|conf|env|csv|svg|snap|xml|plist)$|(^|\/)(CHANGELOG|LICENSE|NOTICE|README)[^/]*$/i;

const SLASH = /\.(c|h|cc|cpp|hpp|cs|java|kt|kts|scala|swift|go|rs|js|jsx|mjs|cjs|ts|tsx|mts|cts|dart|php|css|scss|less|groovy|proto|zig|sol)$/i;
const HASH = /\.(py|pyi|sh|bash|zsh|fish|rb|pl|pm|r|ps1|tf|hcl|nix|cmake|mk)$|(^|\/)(Makefile|Dockerfile|Gemfile|Rakefile|BUILD|WORKSPACE)$/i;
const MARKUP = /\.(html?|vue|svelte|astro)$/i;
const DASH = /\.(sql|lua|hs|elm)$/i;

const ALLOWED = /^#!|SPDX-License-Identifier|\bcopyright\b|@license|@preserve|@generated|^\/\/\/\s*<reference|^\/\/go:(build|generate|embed)|^\/\/\s*\+build|-\*-\s*coding|^#\s*(region|endregion)\b|^\/\/\s*#(region|endregion)\b|webpackChunkName|@vite-ignore/i;
const SUPPRESS = [
  { pattern: /eslint-disable(?:-next-line|-line)?/, reason: /eslint-disable\S*(?:\s.*?)?\s--\s+(.{10,})/ },
  { pattern: /@ts-ignore/, reason: /@ts-ignore\s+(.{10,})/ },
  { pattern: /@ts-expect-error/, reason: /@ts-expect-error\s+(.{10,})/ },
  { pattern: /#\s*type:\s*ignore/, reason: /type:\s*ignore\S*\s+#?\s*(.{10,})/ },
  { pattern: /#\s*noqa/, reason: /noqa\S*\s+#?\s*(.{10,})/ },
  { pattern: /\/\/\s*nolint/, reason: /nolint\S*\s+\/\/\s*(.{10,})/ },
  { pattern: /NOSONAR/, reason: /NOSONAR\s+(.{10,})/ },
  { pattern: /istanbul ignore|c8 ignore/, reason: /ignore \w+\s+(.{10,})/ },
  { pattern: /prettier-ignore|biome-ignore|stylelint-disable|rubocop:disable|pylint:\s*disable/, reason: /(?:prettier-ignore|biome-ignore\S*|stylelint-disable\S*|rubocop:disable\S*|pylint:\s*disable\S*)\s+.*?(?:--|:)\s*(.{10,})/ }
];
const JUSTIFICATION = /\b(work-?around|quick[- ]?fix|hack(y)?|temporary|temp fix|for now|band-?aid|kludge|until we|proper fix later|fix (this )?later)\b/i;

function commentIndex(text, marker) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (text.startsWith(marker, i)) {
      if (marker === '#' && i > 0 && !/\s/.test(text[i - 1])) continue;
      return i;
    }
  }
  return -1;
}

function commentOf(file, text) {
  if (SLASH.test(file)) {
    if (/^\s*\*(?!\*\/)/.test(text) && !/^\s*\*\s*[\w(]+\s*[=;)]/.test(text)) return text.trim();
    for (const marker of ['//', '/*']) {
      const at = commentIndex(text, marker);
      if (at !== -1) return text.slice(at).trim();
    }
    const jsx = text.indexOf('{/*');
    return jsx !== -1 ? text.slice(jsx).trim() : null;
  }
  if (HASH.test(file)) {
    const at = commentIndex(text, '#');
    return at !== -1 ? text.slice(at).trim() : null;
  }
  if (MARKUP.test(file)) {
    const at = text.indexOf('<!--');
    if (at !== -1) return text.slice(at).trim();
    const slash = commentIndex(text, '//');
    return slash !== -1 && /^\s*\/\//.test(text) ? text.slice(slash).trim() : null;
  }
  if (DASH.test(file)) {
    const at = commentIndex(text, '--');
    return at !== -1 ? text.slice(at).trim() : null;
  }
  return null;
}

function loadProjectRules(rootDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, '.ai-engineering-loop', 'rules.json'), 'utf8'));
  } catch {
    return {};
  }
}

function loadExtraPatterns(rootDir) {
  return (loadProjectRules(rootDir).justificationPatterns || []).map((text) => new RegExp(text, 'i'));
}

function scanComments(diffText, { extraPatterns = [], noComments = true } = {}) {
  const findings = [];
  let n = 0;
  for (const file of parseDiff(diffText)) {
    if (file.deleted || isTestFile(file.path) || SKIP_FILE.test(file.path)) continue;
    const plain = [];
    for (const added of file.added) {
      const comment = commentOf(file.path, added.text);
      if (!comment) continue;
      const location = `${file.path}:${added.line}`;
      const suppress = SUPPRESS.find((item) => item.pattern.test(comment));
      if (suppress) {
        const reasoned = suppress.reason.test(comment);
        findings.push({
          id: `COMMENT-${++n}`,
          axis: 'standards',
          location,
          failureScenario: reasoned
            ? 'A lint/type/coverage suppression was added; it hides the signal instead of fixing what the check found'
            : 'A lint/type/coverage suppression was added with no reason; the next agent will copy it as the established pattern',
          evidence: `added line: ${added.text.trim().slice(0, 160)}`,
          severity: reasoned ? 'MEDIUM' : 'HIGH',
          validity: 'VALID',
          disposition: 'WEAK',
          concreteAlternativeDiff: `- ${added.text.trim()}\n+ (remove the suppression and fix the code the check flagged)`,
          source: SOURCE
        });
        continue;
      }
      if (ALLOWED.test(comment)) continue;
      if (JUSTIFICATION.test(comment) || extraPatterns.some((pattern) => pattern.test(comment))) {
        findings.push({
          id: `COMMENT-${++n}`,
          axis: 'standards',
          location,
          failureScenario: 'A comment justifies a workaround instead of fixing the root cause; comments cannot be enforced and the workaround spreads',
          evidence: `added line: ${added.text.trim().slice(0, 160)}`,
          severity: 'MEDIUM',
          validity: 'VALID',
          disposition: 'WEAK',
          source: SOURCE
        });
        continue;
      }
      plain.push(added);
    }
    if (noComments && plain.length) {
      const lines = plain.map((added) => added.line);
      findings.push({
        id: `NOCOMMENT-${++n}`,
        axis: 'standards',
        hardConvention: true,
        location: `${file.path}:${lines[0]}`,
        failureScenario: `${plain.length} comment line(s) added in product code; comments go stale, cannot be enforced, and agents copy them as license to explain instead of fix`,
        evidence: `comment lines ${lines.slice(0, 12).join(', ')}${lines.length > 12 ? ', ...' : ''}; first: ${plain[0].text.trim().slice(0, 120)}`,
        severity: 'HIGH',
        validity: 'VALID',
        disposition: 'WEAK',
        concreteAlternativeDiff: `- ${plain[0].text.trim()}\n+ (delete it: put intent in names, types, tests or a lint rule; put rationale in the commit message or docs/)`,
        source: NO_COMMENTS_SOURCE
      });
    }
  }
  return findings;
}

function scanRunComments(rootDir, run) {
  const rules = loadProjectRules(rootDir);
  try {
    return scanComments(fs.readFileSync(path.join(rootDir, run.artifacts.diff.path), 'utf8'), {
      extraPatterns: (rules.justificationPatterns || []).map((text) => new RegExp(text, 'i')),
      noComments: rules.comments !== 'allow'
    });
  } catch {
    return [];
  }
}

function mergeCommentFindings(ledger, findings) {
  const errors = [];
  const sources = new Set([SOURCE, NO_COMMENTS_SOURCE]);
  const existing = new Map((ledger.findings || []).filter((item) => sources.has(item.source)).map((item) => [`${item.source}|${item.location}`, item]));
  const additions = [];
  for (const item of findings) {
    const present = existing.get(`${item.source}|${item.location}`);
    if (!present) {
      additions.push(item);
      continue;
    }
    const downgraded = present.validity !== 'VALID' || present.severity !== item.severity || (item.hardConvention && present.hardConvention !== true);
    if (downgraded && !String(present.dismissal?.evidence || '').trim()) {
      errors.push(`${present.id} (${present.location}) was downgraded without dismissal.evidence. FIX: restore it, or add dismissal: {by, evidence} explaining why this comment or suppression must stay.`);
    }
  }
  return { ledger: { ...ledger, findings: [...(ledger.findings || []), ...additions] }, added: additions.length, errors };
}

module.exports = { NO_COMMENTS_SOURCE, SOURCE, commentOf, loadExtraPatterns, mergeCommentFindings, scanComments, scanRunComments };
