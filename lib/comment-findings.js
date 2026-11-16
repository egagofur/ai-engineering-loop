'use strict';

// C-18 ("All Code Is Slop (Except Mine)", 06:46-08:46): agents write comments
// to justify not doing the right thing, and comments cannot be enforced.
// New suppressions and justification comments in product code become
// standards findings, so the reviewer must decide: root cause or patch?
// Unlike C-11 integrity findings, a reviewer may dismiss these with evidence.

const fs = require('fs');
const path = require('path');
const { isTestFile, parseDiff } = require('./verification-integrity.js');

const SOURCE = 'comment-justification';
const SKIP_FILE = /\.(md|mdx|txt|rst|json|lock|ya?ml|toml|csv|svg|snap)$|(^|\/)(CHANGELOG|LICENSE)/i;
const COMMENT = /(\/\/|\/\*|^\s*\*|(^|\s)#|<!--|(^|\s)--\s)/;
const SUPPRESS = [
  { pattern: /eslint-disable(?:-next-line|-line)?/, reason: /eslint-disable\S*(?:\s.*?)?\s--\s+(.{10,})/ },
  { pattern: /@ts-ignore/, reason: /@ts-ignore\s+(.{10,})/ },
  { pattern: /@ts-expect-error/, reason: /@ts-expect-error\s+(.{10,})/ },
  { pattern: /#\s*type:\s*ignore/, reason: /type:\s*ignore\S*\s+#?\s*(.{10,})/ },
  { pattern: /#\s*noqa/, reason: /noqa\S*\s+#?\s*(.{10,})/ },
  { pattern: /\/\/\s*nolint/, reason: /nolint\S*\s+\/\/\s*(.{10,})/ },
  { pattern: /NOSONAR/, reason: /NOSONAR\s+(.{10,})/ },
  { pattern: /istanbul ignore|c8 ignore/, reason: /ignore \w+\s+(.{10,})/ }
];
const JUSTIFICATION = /\b(work-?around|quick[- ]?fix|hack(y)?|temporary|temp fix|for now|band-?aid|kludge|until we|proper fix later|fix (this )?later)\b/i;

function loadExtraPatterns(rootDir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(rootDir, '.ai-engineering-loop', 'rules.json'), 'utf8'));
    return (value.justificationPatterns || []).map((text) => new RegExp(text, 'i'));
  } catch {
    return [];
  }
}

function scanComments(diffText, { extraPatterns = [] } = {}) {
  const findings = [];
  let n = 0;
  for (const file of parseDiff(diffText)) {
    if (file.deleted || isTestFile(file.path) || SKIP_FILE.test(file.path)) continue;
    for (const added of file.added) {
      const text = added.text;
      if (!COMMENT.test(text)) continue;
      const location = `${file.path}:${added.line}`;
      const suppress = SUPPRESS.find((item) => item.pattern.test(text));
      if (suppress) {
        const reasoned = suppress.reason.test(text);
        findings.push({
          id: `COMMENT-${++n}`,
          axis: 'standards',
          location,
          failureScenario: reasoned
            ? 'A lint/type/coverage suppression was added; it hides the signal instead of fixing what the check found'
            : 'A lint/type/coverage suppression was added with no reason; the next agent will copy it as the established pattern',
          evidence: `added line: ${text.trim().slice(0, 160)}`,
          severity: reasoned ? 'MEDIUM' : 'HIGH',
          validity: 'VALID',
          disposition: 'WEAK',
          concreteAlternativeDiff: `- ${text.trim()}\n+ (remove the suppression and fix the code the check flagged)`,
          source: SOURCE
        });
        continue;
      }
      const custom = extraPatterns.find((pattern) => pattern.test(text));
      if (JUSTIFICATION.test(text) || custom) {
        findings.push({
          id: `COMMENT-${++n}`,
          axis: 'standards',
          location,
          failureScenario: 'A comment justifies a workaround instead of fixing the root cause; comments cannot be enforced and the workaround spreads',
          evidence: `added line: ${text.trim().slice(0, 160)}`,
          severity: 'MEDIUM',
          validity: 'VALID',
          disposition: 'WEAK',
          source: SOURCE
        });
      }
    }
  }
  return findings;
}

function scanRunComments(rootDir, run) {
  try {
    return scanComments(fs.readFileSync(path.join(rootDir, run.artifacts.diff.path), 'utf8'), { extraPatterns: loadExtraPatterns(rootDir) });
  } catch {
    return [];
  }
}

// Reviewers may downgrade these, but only with dismissal.evidence.
function mergeCommentFindings(ledger, findings) {
  const errors = [];
  const existing = new Map((ledger.findings || []).filter((item) => item.source === SOURCE).map((item) => [item.location, item]));
  const additions = [];
  for (const item of findings) {
    const present = existing.get(item.location);
    if (!present) {
      additions.push(item);
      continue;
    }
    const downgraded = present.validity !== 'VALID' || present.severity !== item.severity;
    if (downgraded && !String(present.dismissal?.evidence || '').trim()) {
      errors.push(`${present.id} (${present.location}) was downgraded without dismissal.evidence. FIX: restore it, or add dismissal: {by, evidence} explaining why the suppression or workaround is the right call here.`);
    }
  }
  return { ledger: { ...ledger, findings: [...(ledger.findings || []), ...additions] }, added: additions.length, errors };
}

module.exports = { SOURCE, mergeCommentFindings, scanComments, scanRunComments };
