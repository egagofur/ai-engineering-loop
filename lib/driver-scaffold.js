'use strict';

const fs = require('fs');
const path = require('path');
const { FEATURE_MAP_FILE, loadFeatureMap } = require('./feature-map.js');

const DRIVER_DIR = path.join('.ai-engineering-loop', 'drivers');
const SURFACES = ['web', 'api', 'cli', 'launch'];

const fail = (message, code = 'INVALID_USAGE') => Object.assign(new Error(message), { code });

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function projectFacts(rootDir) {
  const pkg = readJson(path.join(rootDir, 'package.json')) || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  let verification = '';
  try {
    verification = fs.readFileSync(path.join(rootDir, '.ai-engineering-loop', 'verification.md'), 'utf8');
  } catch {
    verification = '';
  }
  const fromVerification = (key) => (verification.match(new RegExp(`\\*\\*${key}\\*\\*:\\s*\`([^\`]+)\``, 'i')) || [])[1] || null;
  const scripts = pkg.scripts || {};
  const startCommand = fromVerification('dev') || fromVerification('start') || (scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : null);
  return {
    playwright: Boolean(deps['@playwright/test'] || deps.playwright),
    bin: Boolean(pkg.bin),
    startCommand,
    baseUrl: fromVerification('base_url') || 'http://localhost:3000'
  };
}

function detectSurface(entry, facts) {
  if (/^(GET|POST|PUT|PATCH|DELETE)\s|^\/api\//i.test(entry.where)) return 'api';
  if (facts.playwright) return 'web';
  if (facts.bin) return 'cli';
  return 'launch';
}

const routeOf = (where) => {
  const match = String(where).match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i);
  if (match) return { method: match[1].toUpperCase(), path: match[2] };
  const slash = String(where).match(/(\/[\w\-/.:]*)/);
  return { method: 'GET', path: slash ? slash[1] : '/' };
};

function driverSource(entry, surface, facts) {
  const header = `const FEATURE = ${JSON.stringify(entry.id)};
const WHERE = ${JSON.stringify(entry.where)};
const HOW = ${JSON.stringify(entry.how)};
const BASE_URL = process.env.AEL_BASE_URL || ${JSON.stringify(facts.baseUrl)};
const START = process.env.AEL_START_COMMAND || ${JSON.stringify(facts.startCommand)};
const EXPECT = null;
`;
  const common = `import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

${header}
function evidenceDir() {
  let runId = process.env.AEL_RUN_ID;
  if (!runId) {
    try {
      runId = JSON.parse(fs.readFileSync('.ai-engineering-loop/runs/current.json', 'utf8')).runId;
    } catch {
      runId = 'no-run';
    }
  }
  const dir = path.join('.ai-engineering-loop', 'runs', runId, 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function ready(url, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return false;
}

async function launch() {
  if (process.env.AEL_BASE_URL) return null;
  if (!START) throw new Error('No start command: set AEL_START_COMMAND or add - **dev**: \`<command>\` to .ai-engineering-loop/verification.md');
  const child = spawn(START, { shell: true, stdio: 'ignore', detached: process.platform !== 'win32' });
  if (!(await ready(BASE_URL))) {
    child.kill();
    throw new Error(\`App did not answer at \${BASE_URL} within 60s\`);
  }
  return child;
}

function finish(child, ok, message) {
  if (child) {
    try {
      if (process.platform === 'win32') child.kill();
      else process.kill(-child.pid);
    } catch {
      child.kill();
    }
  }
  console.log(\`\${ok ? 'PASS' : 'FAIL'} \${FEATURE}: \${message}\`);
  process.exit(ok ? 0 : 1);
}
`;
  if (surface === 'web') {
    return `${common}
const { chromium } = await import('playwright').catch(() => import('@playwright/test'));

const child = await launch().catch((error) => finish(null, false, error.message));
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(new URL(${JSON.stringify(routeOf(entry.where).path)}, BASE_URL).toString());
  await drive(page);
  const shot = path.join(evidenceDir(), \`\${FEATURE}-\${Date.now()}.png\`);
  await page.screenshot({ path: shot, fullPage: true });
  const ok = await observe(page);
  await browser.close();
  finish(child, ok, ok ? \`matches EXPECT; screenshot \${shot}\` : \`EXPECT not met; screenshot \${shot}\`);
} catch (error) {
  await browser.close();
  finish(child, false, error.message);
}

async function drive(page) {
  throw new Error(\`Write the user steps for "\${HOW}" in drive() of this file\`);
}

async function observe(page) {
  if (EXPECT == null) throw new Error('Set EXPECT (the text or state that proves the feature works) and check it in observe()');
  return (await page.content()).includes(EXPECT);
}
`;
  }
  if (surface === 'api') {
    const route = routeOf(entry.where);
    return `${common}
const child = await launch().catch((error) => finish(null, false, error.message));
try {
  const response = await fetch(new URL(${JSON.stringify(route.path)}, BASE_URL), { method: ${JSON.stringify(route.method)}, headers: { 'content-type': 'application/json' }, ...request() });
  const body = await response.text();
  const file = path.join(evidenceDir(), \`\${FEATURE}-\${Date.now()}.json\`);
  fs.writeFileSync(file, JSON.stringify({ status: response.status, body }, null, 2));
  const ok = observe(response.status, body);
  finish(child, ok, \`\${response.status}; evidence \${file}\`);
} catch (error) {
  finish(child, false, error.message);
}

function request() {
  return {};
}

function observe(status, body) {
  if (EXPECT == null) throw new Error('Set EXPECT (status code or a string the body must contain) and check it in observe()');
  return typeof EXPECT === 'number' ? status === EXPECT : body.includes(EXPECT);
}
`;
  }
  if (surface === 'cli') {
    return `import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

${header}
const COMMAND = null;

if (COMMAND == null || EXPECT == null) {
  console.log(\`FAIL \${FEATURE}: set COMMAND (what the user runs for "\${HOW}") and EXPECT (text the output must contain)\`);
  process.exit(1);
}
const result = spawnSync(COMMAND, { shell: true, encoding: 'utf8' });
const output = \`\${result.stdout || ''}\${result.stderr || ''}\`;
let runId = process.env.AEL_RUN_ID || 'no-run';
const dir = path.join('.ai-engineering-loop', 'runs', runId, 'evidence');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, \`\${FEATURE}-\${Date.now()}.txt\`);
fs.writeFileSync(file, \`$ \${COMMAND}\\nexit \${result.status}\\n\${output}\`);
const ok = result.status === 0 && output.includes(EXPECT);
console.log(\`\${ok ? 'PASS' : 'FAIL'} \${FEATURE}: exit \${result.status}; evidence \${file}\`);
process.exit(ok ? 0 : 1);
`;
  }
  return `${common}
const child = await launch().catch((error) => finish(null, false, error.message));
try {
  const response = await fetch(new URL(${JSON.stringify(routeOf(entry.where).path)}, BASE_URL));
  const body = await response.text();
  const file = path.join(evidenceDir(), \`\${FEATURE}-\${Date.now()}.html\`);
  fs.writeFileSync(file, body);
  if (EXPECT == null) finish(child, false, \`app answered \${response.status}; set EXPECT and add a browser or API runner to drive "\${HOW}"\`);
  finish(child, body.includes(EXPECT), \`\${response.status}; evidence \${file}\`);
} catch (error) {
  finish(child, false, error.message);
}
`;
}

function readme(entry, surface, facts, relative) {
  const gaps = [];
  if (!facts.startCommand) gaps.push('No start command found: add `- **dev**: `<command>`` to `.ai-engineering-loop/verification.md`, or set `AEL_START_COMMAND`.');
  if (surface === 'launch') gaps.push('No browser or API runner found: the driver only launches the app and fetches the page. Add Playwright (`npm i -D playwright`) and re-scaffold with `--surface web`, or use `--surface api`.');
  return `# Driver: ${entry.id}

Surface: ${surface}. Where: ${entry.where}. How to reach: ${entry.how}.

Run: \`node ${relative}\` (exit 0 only when the observed result matches \`EXPECT\`). It starts the app with \`${facts.startCommand || '<none>'}\` unless \`AEL_BASE_URL\` points at a running one, and writes evidence to \`.ai-engineering-loop/runs/<runId>/evidence/\`.

Fill in before use:
- \`EXPECT\`: the text, state or status that proves the feature works.
- the user steps (${surface === 'web' ? '`drive()`' : surface === 'api' ? '`request()`' : surface === 'cli' ? '`COMMAND`' : 'not available for this surface'}).
${gaps.length ? `\nGaps:\n${gaps.map((gap) => `- ${gap}`).join('\n')}\n` : ''}`;
}

function setDriverCell(rootDir, featureId, command) {
  const file = path.join(rootDir, FEATURE_MAP_FILE);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let changed = false;
  const next = lines.map((raw) => {
    const line = raw.trim();
    if (!line.startsWith('|') || /^\|\s*-/.test(line)) return raw;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells[0] !== featureId) return raw;
    while (cells.length < 5) cells.push('');
    if (cells[4]) return raw;
    cells[4] = `\`${command}\``;
    changed = true;
    return `| ${cells.join(' | ')} |`;
  });
  if (changed) fs.writeFileSync(file, next.join('\n'));
  return changed;
}

function scaffoldDriver(rootDir, { feature = null, surface = null } = {}) {
  if (surface && !SURFACES.includes(surface)) throw fail(`--surface must be ${SURFACES.join(', ')}`);
  const entries = loadFeatureMap(rootDir);
  if (!entries.length) throw fail('No feature map yet: add rows to .ai-engineering-loop/feature-map.md (Feature | Where | Paths | How to reach | Driver) first', 'FEATURE_MAP_MISSING');
  const targets = feature ? entries.filter((entry) => entry.id === feature) : entries.filter((entry) => !entry.driver);
  if (feature && !targets.length) throw fail(`No feature "${feature}" in the feature map; known: ${entries.map((entry) => entry.id).join(', ')}`, 'NOT_FOUND');
  const facts = projectFacts(rootDir);
  const results = [];
  for (const entry of targets) {
    const kind = surface || detectSurface(entry, facts);
    const slug = entry.id.replace(/[^\w.-]+/g, '-');
    const relative = path.posix.join('.ai-engineering-loop', 'drivers', `${slug}.mjs`);
    const file = path.join(rootDir, relative);
    const source = driverSource(entry, kind, facts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let written = relative;
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== source) {
      written = `${relative}.ael-new`;
      fs.writeFileSync(path.join(rootDir, written), source);
    } else if (!fs.existsSync(file)) {
      fs.writeFileSync(file, source);
      fs.writeFileSync(path.join(rootDir, DRIVER_DIR, `${slug}.md`), readme(entry, kind, facts, relative));
    } else {
      written = null;
    }
    const command = `node ${relative}`;
    const mapped = setDriverCell(rootDir, entry.id, command);
    results.push({ feature: entry.id, surface: kind, file: relative, written, featureMapUpdated: mapped, startCommand: facts.startCommand, gaps: [...(facts.startCommand ? [] : ['start command']), ...(kind === 'launch' ? ['browser or API runner'] : [])] });
  }
  return results;
}

function driverProblems(rootDir) {
  const problems = [];
  for (const entry of loadFeatureMap(rootDir)) {
    if (!entry.driver) continue;
    const local = String(entry.driver).match(/^node\s+(\S+)/);
    if (local && !fs.existsSync(path.join(rootDir, local[1]))) problems.push({ feature: entry.id, problem: `driver file ${local[1]} is missing` });
  }
  return problems;
}

module.exports = { SURFACES, driverProblems, scaffoldDriver };
