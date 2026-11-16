'use strict';

// Verification integrity (C-11). The cheapest way for an agent to turn a gate
// green is to weaken the proof: skip a test, delete it, drop assertions, or
// edit the verification config. This deterministic scan of the gated diff
// turns each of those into a VALID ledger finding the reviewer cannot drop.

const fs = require('fs');
const path = require('path');

const SOURCE = 'verification-integrity';
const TEST_FILE = /(^|\/)(tests?|__tests__|spec|specs)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$|Test\.java$/;
const SKIP_MARKER = /\b(?:it|test|describe|context)\.(?:skip|only|todo)\s*\(|\bx(?:it|describe|test)\s*\(|\bf(?:it|describe)\s*\(|@Disabled\b|@Ignore\b|pytest\.mark\.(?:skip|xfail)|@unittest\.skip|\bt\.Skip(?:Now)?\(|\{\s*skip\s*:\s*true/;
const ASSERTION = /\b(?:assert(?:\.\w+)?|expect|should|t\.(?:equal|deepEqual|ok|is|true|false|throws))\s*\(|\bassert\s+\w|\bself\.assert\w*\(/;
const CONFIG_FILE = /(^|\/)(\.ai-engineering-loop\/verification\.md|(jest|vitest|playwright|cypress|karma)\.config\.[cm]?[jt]s|pytest\.ini|tox\.ini|\.nycrc(\.json)?|\.c8rc(\.json)?|codecov\.ya?ml|\.mocharc\.[a-z]+)$/;

function isTestFile(file) {
  return TEST_FILE.test(file);
}

// Split a unified diff into per-file entries with added/removed lines.
function parseDiff(diffText) {
  const files = [];
  let current = null;
  let newLine = 0;
  for (const line of String(diffText || '').split('\n')) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      current = { oldPath: header[1], path: header[2], deleted: false, added: [], removed: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('deleted file mode')) current.deleted = true;
    else if (line.startsWith('new file mode')) current.created = true;
    else if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    else if (line.startsWith('@@')) {
      const hunk = line.match(/\+(\d+)/);
      newLine = hunk ? Number(hunk[1]) : 0;
    } else if (line.startsWith('+')) {
      current.added.push({ text: line.slice(1), line: newLine });
      newLine += 1;
    } else if (line.startsWith('-')) {
      current.removed.push({ text: line.slice(1) });
    } else {
      newLine += 1;
    }
  }
  return files;
}

function finding(id, location, failureScenario, evidence, concreteAlternativeDiff, severity) {
  return {
    id,
    axis: 'spec',
    location,
    failureScenario,
    evidence,
    severity,
    validity: 'VALID',
    disposition: 'STRONG',
    concreteAlternativeDiff,
    source: SOURCE,
    fix: 'Restore the proof (un-skip, keep the assertion, restore the test or config). A human may dismiss it with dismissal: {by, evidence} when the change is intended.'
  };
}

// `goalText` exempts config files the frozen Goal Contract names explicitly.
function scanDiff(diffText, { tier = null, goalText = '' } = {}) {
  const severity = tier === 'T2' ? 'BLOCKER' : 'HIGH';
  const files = parseDiff(diffText);
  const findings = [];
  const createdTests = files.filter((file) => file.created && isTestFile(file.path));
  let n = 0;
  const next = () => `INTEGRITY-${++n}`;

  for (const file of files) {
    if (file.deleted && isTestFile(file.oldPath)) {
      const dir = path.posix.dirname(file.oldPath);
      const replaced = createdTests.some((created) => path.posix.dirname(created.path) === dir);
      if (!replaced) {
        findings.push(finding(next(), file.oldPath,
          `Test file ${file.oldPath} was deleted with no replacement test in ${dir}/; the behaviour it covered is no longer verified`,
          `diff marks ${file.oldPath} as deleted file mode`,
          `Restore ${file.oldPath} (git checkout <base> -- ${file.oldPath}) or add a replacement test in ${dir}/`, severity));
      }
      continue;
    }
    if (isTestFile(file.path)) {
      for (const added of file.added) {
        if (SKIP_MARKER.test(added.text)) {
          findings.push(finding(next(), `${file.path}:${added.line}`,
            `A skip/only/todo marker was added, so tests stop running while the suite still reports green`,
            `added line: ${added.text.trim().slice(0, 160)}`,
            `- ${added.text.trim()}\n+ ${added.text.trim().replace(/\.(skip|only|todo)\s*\(/, '(').replace(/\bx(it|describe|test)\s*\(/, '$1(').replace(/\bf(it|describe)\s*\(/, '$1(')}`,
            severity));
        }
      }
      const removedAsserts = file.removed.filter((line) => ASSERTION.test(line.text));
      const addedAsserts = file.added.filter((line) => ASSERTION.test(line.text));
      if (!file.deleted && removedAsserts.length > addedAsserts.length) {
        findings.push(finding(next(), file.path,
          `${removedAsserts.length - addedAsserts.length} assertion(s) removed from ${file.path} without replacement; the test proves less than before`,
          `removed ${removedAsserts.length} assertion line(s), added ${addedAsserts.length}; first removed: ${removedAsserts[0].text.trim().slice(0, 120)}`,
          `+ ${removedAsserts[0].text.trim()}`, severity));
      }
    }
    if (CONFIG_FILE.test(file.path) && !goalText.includes(file.path)) {
      findings.push(finding(next(), file.path,
        `Verification config ${file.path} changed during the run; the rules that judge this change were rewritten by the change itself`,
        `diff touches ${file.path} (+${file.added.length}/-${file.removed.length} lines); the frozen Goal Contract does not name it`,
        `Revert ${file.path}, or freeze a Goal Contract that names it as in scope`, severity));
    }
  }
  return findings;
}

function scanRun(rootDir, run) {
  const artifact = run.artifacts?.diff;
  if (!artifact?.path) return [];
  let diffText;
  try {
    diffText = fs.readFileSync(path.join(rootDir, artifact.path), 'utf8');
  } catch {
    return [];
  }
  let goalText = '';
  try {
    goalText = fs.readFileSync(path.join(rootDir, run.artifacts.goalContract.path), 'utf8');
  } catch {
    goalText = '';
  }
  return scanDiff(diffText, { tier: run.tier?.current || null, goalText });
}

// Merge into the Finding Ledger. A finding already present may only be
// downgraded with a human dismissal ({by, evidence}); anything else throws.
function mergeIntegrityIntoLedger(ledger, findings) {
  const errors = [];
  const existing = new Map((ledger.findings || []).filter((item) => item.source === SOURCE).map((item) => [item.location, item]));
  const additions = [];
  for (const item of findings) {
    const present = existing.get(item.location);
    if (!present) {
      additions.push(item);
      continue;
    }
    const downgraded = present.validity !== 'VALID' || !['BLOCKER', 'HIGH'].includes(present.severity);
    const dismissal = present.dismissal || {};
    if (downgraded && !(String(dismissal.by || '').trim() && String(dismissal.evidence || '').trim())) {
      errors.push(`${present.id} (${present.location}) was downgraded without a human dismissal. FIX: restore it, or add dismissal: {by: "<human>", evidence: "<why the weaker test is intended>"}.`);
    }
  }
  return { ledger: { ...ledger, findings: [...(ledger.findings || []), ...additions] }, added: additions.length, errors };
}

module.exports = {
  SOURCE,
  isTestFile,
  mergeIntegrityIntoLedger,
  parseDiff,
  scanDiff,
  scanRun
};
