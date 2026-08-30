'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_STAGES = ['goal_contract', 'verification', 'devil_advocate', 'judge'];
const ALLOWED_OPTIONAL_SKIPS = ['blast_radius', 'generate_adapter'];
const DEFAULT_HOOKS = {
  before_grill: 'none',
  after_freeze: 'none',
  after_pass: 'none'
};
const DEFAULT_MAKER_INTERN = 'none';

const REQUIRED_ALIASES = {
  goal_contract: 'goal_contract',
  'goal contract': 'goal_contract',
  verification: 'verification',
  devil_advocate: 'devil_advocate',
  "devil's advocate": 'devil_advocate',
  'devils advocate': 'devil_advocate',
  judge: 'judge'
};

function normalizeSkip(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/\s+/g, '_');
}

function assertNoRequiredSkip(skips) {
  for (const raw of skips || []) {
    const id = REQUIRED_ALIASES[normalizeSkip(raw)] || normalizeSkip(raw);
    if (REQUIRED_STAGES.includes(id)) {
      const err = new Error(`cannot skip required stage: ${id}`);
      err.code = 'REQUIRED_SKIP';
      throw err;
    }
  }
}

function routeDurableNote(kind) {
  const map = {
    term: 'glossary.md',
    process: 'lessons.md',
    lesson: 'lessons.md',
    convention: 'conventions.md',
    adr: 'adrs/'
  };
  return map[kind] || 'lessons.md';
}

function normalizeMakerIntern(raw) {
  const s = String(raw || '').trim();
  if (!s || /^none$/i.test(s)) return DEFAULT_MAKER_INTERN;
  if (/api[_-]?key/i.test(s) || /^sk-/i.test(s) || /https?:\/\//i.test(s)) {
    const err = new Error('maker_intern is a host-native label, not a key or URL');
    err.code = 'INTERN_SECRET';
    throw err;
  }
  return s;
}

function parseMakerInternLine(text) {
  const match = String(text || '').match(/\*\*maker_intern\*\*:\s*(.*)/i);
  if (!match) return DEFAULT_MAKER_INTERN;
  return normalizeMakerIntern(match[1]);
}

function workflowMarkdown({ hooks = DEFAULT_HOOKS, optionalSkips = [], makerIntern = DEFAULT_MAKER_INTERN } = {}) {
  const skipLine = optionalSkips.length ? optionalSkips.join(', ') : 'none';
  const intern = normalizeMakerIntern(makerIntern);
  return `# Loop Overlay

This file adds hooks around the AI Engineering Loop. It does not replace the 8-stage OS.

## Required (cannot skip)
- Goal Contract
- verification
- Devil's Advocate
- Judge

## Hooks
- **before_grill**: ${hooks.before_grill || 'none'}
- **after_freeze**: ${hooks.after_freeze || 'none'}
- **after_pass**: ${hooks.after_pass || 'none'}

## Maker intern
- **maker_intern**: ${intern}

Default \`none\` = parent is Maker. Pick \`maker_intern\` from this host's catalog (\`grok models\` or \`/models\`). Do not type a guessed slug. AEL does not store intern API keys. Devil's Advocate and Judge stay on the parent. Intern cannot skip them.

## Optional skips
${skipLine}

Allowed optional skips: \`blast_radius\` (when the change is not business logic), \`generate_adapter\` (when adapter.md already exists).
Do not list Goal Contract, verification, Devil's Advocate, or Judge here.
`;
}

function lessonsMarkdown() {
  return `# Lessons

Confirmed by a human. One row per lesson. Not a chat transcript. Not a glossary.

Route elsewhere when it fits: term → glossary.md, code ban → conventions.md, load-bearing design → adrs/.

| Date | Lesson | Do not |
|---|---|---|
`;
}

function parseHookLine(text, key) {
  const re = new RegExp(`\\*\\*${key}\\*\\*:\\s*(.+)`, 'i');
  const match = text.match(re);
  if (!match) return 'none';
  return match[1].trim() || 'none';
}

function parseOptionalSkips(text) {
  const block = text.split(/## Optional skips/i)[1];
  if (!block) return [];
  const line = block.split('\n').find((row) => row.trim() && !row.startsWith('#'));
  if (!line) return [];
  const raw = line.replace(/^-\s*/, '').trim();
  if (!raw || /^none$/i.test(raw)) return [];
  return raw.split(/,|\|/).map((item) => normalizeSkip(item)).filter(Boolean);
}

function parseWorkflowMarkdown(text) {
  return {
    missing: false,
    required: REQUIRED_STAGES.slice(),
    hooks: {
      before_grill: parseHookLine(text, 'before_grill'),
      after_freeze: parseHookLine(text, 'after_freeze'),
      after_pass: parseHookLine(text, 'after_pass')
    },
    makerIntern: parseMakerInternLine(text),
    optionalSkips: parseOptionalSkips(text)
  };
}

function parseWorkflowFile(rootDir) {
  const dest = path.join(rootDir, '.ai-engineering-loop', 'workflow.md');
  try {
    const text = fs.readFileSync(dest, 'utf8');
    return parseWorkflowMarkdown(text);
  } catch {
    return {
      missing: true,
      required: REQUIRED_STAGES.slice(),
      hooks: { ...DEFAULT_HOOKS },
      makerIntern: DEFAULT_MAKER_INTERN,
      optionalSkips: []
    };
  }
}

function lessonsAreFilled(text) {
  if (!text || !text.trim()) return false;
  return /\| 20\d{2}-/.test(text);
}

function writeWorkflowOverlay(rootDir, { hooks, optionalSkips, makerIntern } = {}) {
  const skips = optionalSkips || [];
  assertNoRequiredSkip(skips);
  for (const skip of skips) {
    const id = normalizeSkip(skip);
    if (!ALLOWED_OPTIONAL_SKIPS.includes(id)) {
      const err = new Error(`Unknown optional skip: ${skip}. Use ${ALLOWED_OPTIONAL_SKIPS.join('|')}`);
      err.code = 'UNKNOWN_SKIP';
      throw err;
    }
  }
  const intern = normalizeMakerIntern(makerIntern);
  const dir = path.join(rootDir, '.ai-engineering-loop');
  fs.mkdirSync(dir, { recursive: true });
  const workflowPath = path.join(dir, 'workflow.md');
  const lessonsPath = path.join(dir, 'lessons.md');
  fs.writeFileSync(
    workflowPath,
    workflowMarkdown({
      hooks: { ...DEFAULT_HOOKS, ...(hooks || {}) },
      optionalSkips: skips,
      makerIntern: intern
    })
  );
  if (!fs.existsSync(lessonsPath) || !lessonsAreFilled(fs.readFileSync(lessonsPath, 'utf8'))) {
    if (!fs.existsSync(lessonsPath)) {
      fs.writeFileSync(lessonsPath, lessonsMarkdown());
    }
  }
  return { workflow: workflowPath, lessons: lessonsPath };
}

function formatGenerateWorkflowReport({ version, wrote } = {}) {
  const lines = [
    `Workflow overlay generate (v${version || 'unknown'})`,
    'This is not a second OS. Required: Goal Contract, verification, Devil\'s Advocate, Judge.',
    'Files: .ai-engineering-loop/workflow.md and lessons.md',
    'Next: load skill generate-workflow. Ask Q1-Q6. Wait.',
    'Q6: pick from host catalog (grok models or /models). Do not type a model name. Recommended: none',
    'Headless: npx ai-engineering-loop generate-workflow --write'
  ];
  if (wrote) {
    lines.push(`Wrote: ${wrote.workflow}`);
    lines.push(`Lessons: ${wrote.lessons}`);
  }
  return lines.join('\n');
}

function parseWriteArg(argv) {
  return argv.includes('--write');
}

module.exports = {
  REQUIRED_STAGES,
  ALLOWED_OPTIONAL_SKIPS,
  DEFAULT_HOOKS,
  DEFAULT_MAKER_INTERN,
  assertNoRequiredSkip,
  normalizeMakerIntern,
  routeDurableNote,
  workflowMarkdown,
  lessonsMarkdown,
  parseWorkflowMarkdown,
  parseWorkflowFile,
  writeWorkflowOverlay,
  formatGenerateWorkflowReport,
  parseWriteArg
};
