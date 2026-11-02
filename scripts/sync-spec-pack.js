#!/usr/bin/env node
'use strict';

// Vendors the Elephant-Goldfish Model (EGM) fork and generates the opt-in,
// host-neutral `spec` host pack (issue #96).
//
//   node scripts/sync-spec-pack.js            regenerate adapters/spec/ from vendor/egm/
//   node scripts/sync-spec-pack.js --check    fail when adapters/spec/ is stale
//   node scripts/sync-spec-pack.js --pull [ref] [--repo <url>]
//                                             refresh vendor/egm/ from the fork, then regenerate
//
// EGM is Apache-2.0, Copyright Google LLC. The generated files are a modified
// derivative: see vendor/egm/NOTICE-AEL.md and THIRD_PARTY_NOTICES.md.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor', 'egm');
const OUT = path.join(ROOT, 'adapters', 'spec');
const DEFAULT_REPO = 'https://github.com/egagofur/elephant-goldfish-model';

// Upstream skill -> AEL skill. egm-bootstrap is not shipped.
const SKILLS = Object.freeze({
  'egm-brainstorm': 'ael-spec-brainstorm',
  'egm-draft': 'ael-spec-draft',
  'egm-review': 'ael-spec-review',
  'egm-review-loop': 'ael-spec-review-loop',
  'egm-resolve': 'ael-spec-resolve',
  'egm-drift-report': 'ael-spec-drift'
});
// Extra files kept beside a skill's SKILL.md.
const SKILL_EXTRAS = Object.freeze({ 'egm-draft': ['references/design_doc.md'] });
// Upstream persona file -> persona name (its frontmatter `name`, renamed).
const PERSONAS = Object.freeze({
  'codebase_details.md': 'ael-spec-codebase-details',
  'comprehension.md': 'ael-spec-comprehension',
  'design_critic.md': 'ael-spec-design',
  'implementation_readiness.md': 'ael-spec-implementation-readiness',
  'structural.md': 'ael-spec-structural',
  'style.md': 'ael-spec-style',
  'synthesizer.md': 'ael-spec-synthesizer',
  'zoom_out.md': 'ael-spec-zoom-out'
});
const STANDARDS = Object.freeze([
  'feature-spec-standard',
  'heilmeier-standard',
  'implementation-readiness-standard',
  're-implementation-standard',
  'zoom-out-standard'
]);

const NAME_MAP = Object.freeze({
  ...SKILLS,
  'egm-zoom-out': 'ael-spec-zoom-out',
  'egm-comprehension': 'ael-spec-comprehension',
  'egm-design': 'ael-spec-design',
  'egm-structural': 'ael-spec-structural',
  'egm-style': 'ael-spec-style',
  'egm-implementation-readiness': 'ael-spec-implementation-readiness',
  'egm-codebase-details': 'ael-spec-codebase-details',
  'egm-synthesizer': 'ael-spec-synthesizer'
});

const DOCS = 'npx ai-engineering-loop docs';
const HOST_RULES = `Host rules: spawn each Goldfish reviewer as a fresh sibling subagent with your host's subagent tool, as described in \`${DOCS} loop-hosts\` (read only your host's section). Personas and standards named below resolve with \`${DOCS} <name>\`.`;
const FALLBACK = 'If your host has no subagent tool, do not stop: run each reviewer one at a time in this session, reading only its persona, the standard, and the document (not the earlier conversation), label every report `Review Method: CONTEXT_ISOLATION_ONLY (not an independent Goldfish review)`, and tell the user.';

const PERSONA_DOC = '`' + DOCS + ' ael-spec-<persona>`, where `<persona>` is the shortname with `_` written as `-` (`design_critic` is `ael-spec-design`), or an `ael-spec-*` name as is';

// Ordered textual rewrites. Each is [pattern, replacement].
const REWRITES = [
  [/When running in Codex or ChatGPT Work, first read \[Codex integration\]\([^)]*\)\.\s*\n\s*In Claude Code or Cowork, read `\$\{CLAUDE_PLUGIN_ROOT\}\/docs\/claude\.md` first\./g, HOST_RULES],
  [/If your harness has no subagent tool, stop and tell the user: a review in the same\s+context is not a Goldfish review\./g, FALLBACK],
  [/\(Antigravity: `invoke_subagent`; Claude Code: `Agent`; Codex: `spawn_agent`\)/g, '(per host in `' + DOCS + ' loop-hosts`; for example Grok CLI `spawn_subagent`, Claude Code `Task` or `Agent`, Codex `spawn_agent`, Antigravity `invoke_subagent`)'],
  [/Each subagent is defined in `agents\/<file>\.md`, and its\s*\n?\s*frontmatter `name`/g, 'Each subagent is a persona doc (`' + DOCS + ' <name>`), and its\nfrontmatter `name`'],
  [/See `docs\/harnesses\.md`\./g, 'See `' + DOCS + ' loop-hosts`.'],
  [/`docs\/harnesses\.md`/g, '`' + DOCS + ' loop-hosts`'],
  [/`agents\/\{name\}\.md`/g, PERSONA_DOC],
  [/`resources\/document_standards\/\{([a-z_]+)\}\.md`/g, '`' + DOCS + ' ael-spec-{$1}`'],
  [/`resources\/document_standards\/\{name\}\.md`/g, '`' + DOCS + ' ael-spec-{name}`'],
  [/`?resources\/document_standards\/([a-z-]+)\.md`?/g, '`' + DOCS + ' ael-spec-$1`'],
  [/`resources\/document_standards\/`/g, 'the `ael-spec-*-standard` docs'],
  [/`resources\/execution_instructions\.md`/g, '`' + DOCS + ' ael-spec-execution-instructions`'],
  [/`?agents\/([a-z_]+\.md)`?/g, (match, file) => (PERSONAS[file] ? '`' + DOCS + ' ' + PERSONAS[file] + '`' : match)],
  [/\/egm:egm-/g, '/egm-'],
  [/\begm-(review-loop|drift-report|brainstorm|draft|review|resolve|zoom-out|comprehension|design|structural|style|implementation-readiness|codebase-details|synthesizer)(?![\w-])/g, (match) => NAME_MAP[match]]
];

// Left-overs that would break on a non-Claude host or collide with an installed EGM plugin.
const FORBIDDEN = [/no subagent tool, stop/, /\begm-[a-z]/, /CLAUDE_PLUGIN_ROOT/, /docs\/(claude|codex|harnesses)\.md/, /\bresources\//, /`agents\//, /\]\(\.\.\//];

function upstream() {
  return JSON.parse(fs.readFileSync(path.join(VENDOR, 'UPSTREAM.json'), 'utf8'));
}

function header(meta) {
  return `<!-- Generated by scripts/sync-spec-pack.js from ${meta.repo.replace(/^https:\/\/github\.com\//, '')}@${meta.commit.slice(0, 12)}. ` +
    'Derived from the Elephant-Goldfish Model, Copyright Google LLC, Apache-2.0; modified: renamed to ael-spec-*, host-neutral references. ' +
    'Do not edit; run the script. -->';
}

function transform(text, meta) {
  let out = text.replace(/\r\n?/g, '\n');
  for (const [pattern, replacement] of REWRITES) out = out.replace(pattern, replacement);
  const lines = out.split('\n');
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    lines.splice(end + 1, 0, '', header(meta));
  } else {
    lines.unshift(header(meta), '');
  }
  return lines.join('\n');
}

// path relative to adapters/spec -> content
function generate() {
  const meta = upstream();
  const files = new Map();
  const read = (rel) => fs.readFileSync(path.join(VENDOR, rel), 'utf8').replace(/\r\n?/g, '\n');
  for (const [from, to] of Object.entries(SKILLS)) {
    files.set(`skills/${to}/SKILL.md`, transform(read(`skills/${from}/SKILL.md`), meta));
    for (const extra of SKILL_EXTRAS[from] || []) files.set(`skills/${to}/${extra}`, transform(read(`skills/${from}/${extra}`), meta));
  }
  for (const [file, name] of Object.entries(PERSONAS)) files.set(`agents/${name}.md`, transform(read(`agents/${file}`), meta));
  for (const standard of STANDARDS) {
    files.set(`standards/ael-spec-${standard}.md`, transform(read(`resources/document_standards/${standard}.md`), meta));
  }
  files.set('standards/ael-spec-execution-instructions.md', transform(read('resources/execution_instructions.md'), meta));
  files.set('LICENSE', read('LICENSE'));
  files.set('NOTICE-AEL.md', read('NOTICE-AEL.md'));
  return files;
}

function problems(files) {
  const found = [];
  for (const [rel, text] of files) {
    if (!rel.endsWith('.md') || rel === 'NOTICE-AEL.md') continue;
    const body = text.split('\n').filter((line) => !line.startsWith('<!-- Generated by')).join('\n');
    for (const pattern of FORBIDDEN) {
      const match = body.match(pattern);
      if (match) found.push(`${rel}: forbidden "${match[0]}"`);
    }
    if (!rel.startsWith('standards/') && !/^license: Apache-2\.0$/m.test(text) && rel.endsWith('SKILL.md')) found.push(`${rel}: missing license line`);
  }
  return found;
}

function listOut(dir = OUT, base = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listOut(path.join(dir, entry.name), rel) : [rel];
  });
}

function check(files) {
  const stale = [];
  for (const [rel, text] of files) {
    const file = path.join(OUT, rel);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n') !== text) stale.push(rel);
  }
  for (const rel of listOut()) if (!files.has(rel)) stale.push(`${rel} (not generated)`);
  return stale;
}

function write(files) {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const [rel, text] of files) {
    const file = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

function pull(ref, repo) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-egm-'));
  try {
    execFileSync('git', ['clone', '--quiet', repo, tmp], { stdio: 'inherit' });
    if (ref) execFileSync('git', ['-C', tmp, 'checkout', '--quiet', ref], { stdio: 'inherit' });
    const commit = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const wanted = [
      'LICENSE', 'NOTICE-AEL.md', 'resources/execution_instructions.md',
      ...Object.keys(SKILLS).flatMap((skill) => [`skills/${skill}/SKILL.md`, ...(SKILL_EXTRAS[skill] || []).map((x) => `skills/${skill}/${x}`)]),
      ...Object.keys(PERSONAS).map((file) => `agents/${file}`),
      ...STANDARDS.map((s) => `resources/document_standards/${s}.md`)
    ];
    fs.rmSync(VENDOR, { recursive: true, force: true });
    for (const rel of wanted) {
      const src = path.join(tmp, rel);
      if (!fs.existsSync(src)) throw new Error(`upstream file missing: ${rel}`);
      fs.mkdirSync(path.dirname(path.join(VENDOR, rel)), { recursive: true });
      fs.copyFileSync(src, path.join(VENDOR, rel));
    }
    fs.writeFileSync(path.join(VENDOR, 'UPSTREAM.json'), `${JSON.stringify({ repo, commit, upstream: 'https://github.com/google/elephant-goldfish-model', license: 'Apache-2.0' }, null, 2)}\n`);
    return commit;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main(argv) {
  const repoIndex = argv.indexOf('--repo');
  const repo = repoIndex === -1 ? DEFAULT_REPO : argv[repoIndex + 1];
  const pullIndex = argv.indexOf('--pull');
  if (pullIndex !== -1) {
    const next = argv[pullIndex + 1];
    const commit = pull(next && !next.startsWith('--') ? next : null, repo);
    console.log(`vendor/egm updated to ${commit}`);
  }
  const files = generate();
  const bad = problems(files);
  if (bad.length) {
    for (const line of bad) console.error(line);
    return 1;
  }
  if (argv.includes('--check')) {
    const stale = check(files);
    if (stale.length) {
      console.error(`adapters/spec is stale; run node scripts/sync-spec-pack.js:\n  ${stale.join('\n  ')}`);
      return 1;
    }
    console.log(`adapters/spec is up to date (${files.size} files)`);
    return 0;
  }
  write(files);
  console.log(`adapters/spec written (${files.size} files) from ${upstream().commit.slice(0, 12)}`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { SKILLS, PERSONAS, STANDARDS, generate, problems, check, transform };
