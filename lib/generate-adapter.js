'use strict';

const fs = require('fs');
const path = require('path');

const SHIPPED_TYPES = ['standard', 'github', 'gitlab', 'dot'];

function readGitRemote(rootDir) {
  const gitConfig = path.join(rootDir, '.git', 'config');
  try {
    const text = fs.readFileSync(gitConfig, 'utf8');
    const match = text.match(/url\s*=\s*(.*)/);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

function detectCi(rootDir) {
  if (fs.existsSync(path.join(rootDir, '.github', 'workflows'))) {
    return 'GitHub Actions';
  }
  if (fs.existsSync(path.join(rootDir, '.gitlab-ci.yml'))) {
    return 'GitLab CI';
  }
  return 'none';
}

function recommendType(remote) {
  const url = (remote || '').toLowerCase();
  if (url.includes('github.com')) return 'github';
  if (url.includes('gitlab')) return 'gitlab';
  return 'standard';
}

function detectAdapterHints(rootDir) {
  const remote = readGitRemote(rootDir);
  const ciProvider = detectCi(rootDir);
  const recommended = recommendType(remote);
  let existingType = '';
  const adapterPath = path.join(rootDir, '.ai-engineering-loop', 'adapter.md');
  try {
    const text = fs.readFileSync(adapterPath, 'utf8');
    const match = text.match(/adapter_type\*\*:\s*"?([a-z0-9-]+)/i) || text.match(/adapter_type:\s*"?([a-z0-9-]+)/i);
    if (match) existingType = match[1];
  } catch {
    /* missing */
  }
  return { remote, ciProvider, recommended, existingType };
}

function adapterMarkdown({ type, remote, ciProvider, defaultBranch = 'main' }) {
  const spec = `adapters/${type}/`;
  const remoteLine = remote ? `- **remote_repository**: "${remote}"\n` : '';
  return `# Project Delivery Adapter Configuration

## Delivery Pipeline
- **adapter_type**: "${type}"
- **spec**: "${spec}"
${remoteLine}- **default_target_branch**: "${defaultBranch}"
- **ci_provider**: "${ciProvider}"

## Stage 8
After Judge PASS, follow \`${spec}\` in the ai-engineering-loop package.
Do not start Maker. Do not skip Devil's Advocate or Judge.
Extra branches and chat notifications stay off unless this file names them.
`;
}

function writeShippedAdapter(rootDir, { type, hints }) {
  if (!SHIPPED_TYPES.includes(type)) {
    const err = new Error(`Unknown adapter type: ${type}. Use ${SHIPPED_TYPES.join('|')}`);
    err.code = 'UNKNOWN_TYPE';
    throw err;
  }
  const dir = path.join(rootDir, '.ai-engineering-loop');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'adapter.md');
  const body = adapterMarkdown({
    type,
    remote: hints.remote,
    ciProvider: hints.ciProvider
  });
  fs.writeFileSync(dest, body);
  return dest;
}

function formatGenerateAdapterReport(hints, { version, wrote } = {}) {
  const lines = [
    `Adapter generate (v${version || 'unknown'})`,
    'Detected',
    `- remote: ${hints.remote || '(none)'}`,
    `- ci: ${hints.ciProvider}`,
    `- recommended: ${hints.recommended}`,
    `- existing: ${hints.existingType || '(none)'}`,
    `Shipped: ${SHIPPED_TYPES.join(' | ')}`,
    'Next: load skill generate-adapter. Ask Q1-Q5. Wait.',
    'Headless: npx ai-engineering-loop generate-adapter --type <standard|github|gitlab|dot>'
  ];
  if (wrote) lines.push(`Wrote: ${wrote}`);
  return lines.join('\n');
}

function parseTypeArg(argv) {
  const idx = argv.indexOf('--type');
  if (idx === -1) return null;
  return argv[idx + 1] || null;
}

module.exports = {
  SHIPPED_TYPES,
  detectAdapterHints,
  recommendType,
  adapterMarkdown,
  writeShippedAdapter,
  formatGenerateAdapterReport,
  parseTypeArg
};
