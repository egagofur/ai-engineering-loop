'use strict';

// Feature map (C-22, "All Code Is Slop (Except Mine)" 10:06-10:46): a
// site map of what users can do, so agents stop guessing what "the thingy in
// the left sidebar" means and runtime verification has a shared vocabulary.
// .ai-engineering-loop/feature-map.md holds one Markdown table:
//
// | Feature | Where (UI or endpoint) | Paths | How to reach | Driver |
// |---|---|---|---|---|
// | export-csv | Reports > Export button | src/reports/**, src/export/** | open Reports, click Export | npm run drive -- export |
//
// `Paths` are globs (comma separated) used to pick the entries a diff
// touches; `Driver` is an optional reusable command that runs the flow.
// `ael feature-map scaffold` drafts the table from routes, OpenAPI, pages,
// or README headings and never overwrites an edited map.

const fs = require('fs');
const path = require('path');
const { matchesGlob } = require('./impact-map.js');

const FEATURE_MAP_FILE = path.join('.ai-engineering-loop', 'feature-map.md');

function parseFeatureMap(text) {
  const entries = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|') || /^\|\s*-/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 4 || /^feature$/i.test(cells[0])) continue;
    entries.push({
      id: cells[0],
      where: cells[1],
      paths: cells[2].split(',').map((glob) => glob.trim().replace(/`/g, '')).filter(Boolean),
      how: cells[3],
      driver: (cells[4] || '').replace(/`/g, '').trim() || null
    });
  }
  return entries;
}

function loadFeatureMap(rootDir) {
  try {
    return parseFeatureMap(fs.readFileSync(path.join(rootDir, FEATURE_MAP_FILE), 'utf8'));
  } catch {
    return [];
  }
}

function featuresForFiles(rootDir, files) {
  return loadFeatureMap(rootDir).filter((entry) => files.some((file) => entry.paths.some((glob) => matchesGlob(file, glob))));
}

function renderForPack(entries) {
  if (!entries.length) return '';
  return ['', '## Features this change touches (feature map)', '',
    ...entries.map((entry) => `- ${entry.id}: ${entry.where}. Reach: ${entry.how}.${entry.driver ? ` Driver: \`${entry.driver}\`` : ''}`)].join('\n');
}

// Same route declarations the impact map reads (lib/impact-map.js ROUTE_PATTERNS).
const ROUTE_PATTERNS = [
  /\b(?:app|router|server|route|api)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi,
  /@(Get|Post|Put|Patch|Delete)\(\s*['"`]([^'"`]*)['"`]/g
];
const NEXT_HANDLER = /\bexport\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'vendor', 'dist', 'build', 'coverage', '.next', '.ai-engineering-loop', 'target', '__pycache__', '.venv', 'venv', 'out', '.cache', '.turbo']);
const CODE_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.go', '.rb', '.java', '.kt', '.php']);
const OPENAPI_NAME = /^(openapi|swagger)\.(json|ya?ml)$/i;
const README_SKIP = new Set(['table of contents', 'contents', 'toc', 'installation', 'install', 'getting started', 'quick start', 'usage', 'contributing', 'contribute', 'license', 'licence', 'changelog', 'prerequisites', 'requirements', 'development', 'developing', 'testing', 'tests', 'build', 'setup', 'configuration', 'config', 'acknowledgements', 'acknowledgments', 'credits', 'authors', 'support', 'faq', 'roadmap', 'status', 'overview', 'introduction', 'about', 'features', 'feature', 'documentation', 'docs', 'deploy', 'deployment', 'scripts', 'commands', 'api']);
const MAX_FILES = 2000;
const MAX_BYTES = 256 * 1024;
const MAX_ROWS = 40;
const HEADER = '| Feature | Where (UI or endpoint) | Paths | How to reach | Driver |\n|---|---|---|---|---|';

const cell = (value) => String(value || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

function slug(text) {
  const id = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return id || 'feature';
}

function normRoute(route) {
  let value = String(route || '/').trim().replace(/\{([^}]+)\}/g, ':$1');
  if (!value.startsWith('/')) value = `/${value}`;
  value = value.replace(/\/{2,}/g, '/');
  if (value.length > 1) value = value.replace(/\/+$/, '');
  return value || '/';
}

function dynamicSeg(segment) {
  return segment.replace(/^\[\[\.\.\.(.+?)\]\]$/, ':$1').replace(/^\[\.\.\.(.+?)\]$/, ':$1').replace(/^\[(.+?)\]$/, ':$1');
}

function urlFromSegments(body) {
  const parts = String(body || '').split('/').filter((segment) => segment && !/^\(.+\)$/.test(segment)).map(dynamicSeg);
  const url = `/${parts.join('/')}`.replace(/\/+/g, '/');
  return url === '/' ? '/' : url.replace(/\/$/, '') || '/';
}

function isTestPath(rel) {
  return /(^|\/)(tests?|__tests__|spec|specs)\//.test(rel) || /\.(test|spec)\.[a-z0-9]+$/i.test(rel);
}

function walkFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length && files.length < MAX_FILES) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(abs);
      } else if (entry.isFile()) files.push(abs);
    }
  }
  return files;
}

function readBounded(abs) {
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) return '';
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}

function routesIn(text, rel) {
  if (!text) return [];
  const found = [];
  for (const pattern of ROUTE_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const route = match[2] || '/';
      if (route !== '' && route !== '*' && !String(route).startsWith('/')) continue;
      found.push({ method: match[1].toUpperCase(), route: normRoute(route || '/'), file: rel, summary: '' });
    }
  }
  if (/^(src\/)?app\/.*\/route\.(jsx?|tsx?)$/.test(rel)) {
    const route = urlFromSegments(rel.replace(/^src\//, '').replace(/^app\//, '').replace(/\/route\.(jsx?|tsx?)$/, ''));
    for (const match of text.matchAll(new RegExp(NEXT_HANDLER.source, NEXT_HANDLER.flags))) {
      found.push({ method: match[1].toUpperCase(), route, file: rel, summary: '' });
    }
  }
  if (!found.length && /^(src\/)?pages\/api\/.+\.(jsx?|tsx?)$/.test(rel) && !path.posix.basename(rel).startsWith('_')) {
    const route = urlFromSegments(rel.replace(/^src\//, '').replace(/^pages\//, '').replace(/\.(jsx?|tsx?)$/, ''));
    found.push({ method: 'GET', route, file: rel, summary: '' });
  }
  return found;
}

function pageOf(rel) {
  if (/(^|\/)(?:pages|app)\/api\//.test(rel)) return null;
  const file = rel.split('/').pop();
  if (/^_(app|document|error)\./.test(file)) return null;
  let body = null;
  if (/^(src\/)?app\/(?:.*\/)?page\.(jsx?|tsx?)$/.test(rel)) body = rel.replace(/^src\//, '').replace(/^app\//, '').replace(/\/page\.(jsx?|tsx?)$/, '');
  else if (/^(src\/)?pages\/.+\.(jsx?|tsx?|vue|svelte)$/.test(rel)) body = rel.replace(/^src\//, '').replace(/^pages\//, '').replace(/\.(jsx?|tsx?|vue|svelte)$/, '').replace(/\/index$/, '').replace(/^index$/, '');
  else if (/^(src\/)?routes\/(?:.*\/)?\+page\.(svelte|js|ts)$/.test(rel)) body = rel.replace(/^src\//, '').replace(/^routes\//, '').replace(/\/\+page\.(svelte|js|ts)$/, '');
  if (body == null) return null;
  return { method: 'PAGE', route: urlFromSegments(body), file: rel, summary: '' };
}

function operationsFromOpenApi(doc, rel) {
  const paths = doc && doc.paths;
  if (!paths || typeof paths !== 'object') return [];
  const found = [];
  for (const route of Object.keys(paths).sort()) {
    const item = paths[route];
    if (!item || typeof item !== 'object') continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item[method];
      if (!operation || typeof operation !== 'object') continue;
      found.push({
        method: method.toUpperCase(),
        route: normRoute(route),
        file: rel,
        summary: cell(operation.summary || operation.operationId || '')
      });
    }
  }
  return found;
}

function operationsFromOpenApiYaml(text, rel) {
  const lines = String(text || '').split('\n');
  const start = lines.findIndex((line) => /^paths:\s*(?:#.*)?$/.test(line));
  if (start === -1) return [];
  const found = [];
  let route = null;
  let method = null;
  let summary = '';
  const flush = () => {
    if (route && method) found.push({ method, route: normRoute(route), file: rel, summary: cell(summary) });
  };
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S/.test(line) && line.trim() && !line.trim().startsWith('#')) break;
    const pathMatch = line.match(/^ {2}(\/[^:#\s]+):\s*(?:#.*)?$/);
    if (pathMatch) {
      flush();
      route = pathMatch[1];
      method = null;
      summary = '';
      continue;
    }
    const methodMatch = line.match(/^ {4}(get|post|put|patch|delete):\s*(?:#.*)?$/i);
    if (methodMatch && route) {
      flush();
      method = methodMatch[1].toUpperCase();
      summary = '';
      continue;
    }
    const summaryMatch = line.match(/^ {6}(?:summary|operationId):\s*(.+?)\s*(?:#.*)?$/);
    if (summaryMatch && method && !summary) summary = summaryMatch[1].replace(/^['"]|['"]$/g, '');
  }
  flush();
  return found;
}

function readOpenApi(abs, rel) {
  const text = readBounded(abs);
  if (!text) return [];
  if (rel.endsWith('.json')) {
    try {
      return operationsFromOpenApi(JSON.parse(text), rel);
    } catch {
      return [];
    }
  }
  return operationsFromOpenApiYaml(text, rel);
}

function readmeRows(abs, rel) {
  const found = [];
  for (const match of readBounded(abs).matchAll(/^#{2,3}[ \t]+(.+?)\s*$/gm)) {
    const title = match[1].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').trim();
    const key = title.toLowerCase().replace(/[:.!?]+$/g, '');
    if (title.length < 3 || README_SKIP.has(key)) continue;
    found.push({ method: 'DOC', route: title, file: rel, summary: title });
  }
  return found;
}

function mergeSignals(openapi, routes, pages) {
  const byKey = new Map();
  const add = (row, signal) => {
    const key = `${row.method} ${normRoute(row.route)}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { ...row, route: normRoute(row.route), signal });
    else {
      if (!prev.summary && row.summary) prev.summary = row.summary;
      if (signal === 'routes' && prev.signal === 'openapi') prev.file = row.file;
    }
  };
  for (const row of openapi) add(row, 'openapi');
  for (const row of routes) add(row, 'routes');
  for (const row of pages) add(row, 'pages');
  return [...byKey.values()].sort((a, b) => a.file.localeCompare(b.file) || a.route.localeCompare(b.route) || a.method.localeCompare(b.method));
}

function baseId(row) {
  if (row.method === 'DOC') return slug(row.summary);
  const parts = normRoute(row.route).split('/').filter(Boolean).map((segment) => segment.replace(/^:/, ''));
  return slug(parts.join('-') || 'home');
}

function assignIds(rows) {
  const used = new Set();
  return rows.map((row) => {
    let id = baseId(row);
    if (used.has(id)) id = `${id}-${row.method.toLowerCase()}`;
    let next = id;
    let n = 2;
    while (used.has(next)) {
      next = `${id}-${n}`;
      n += 1;
    }
    used.add(next);
    return { ...row, id: next };
  });
}

function whereOf(row) {
  if (row.method === 'PAGE') return `page ${row.route}`;
  if (row.method === 'DOC') return row.summary;
  const endpoint = `${row.method} ${row.route}`;
  return row.summary ? `${endpoint} — ${row.summary}` : endpoint;
}

function howOf(row) {
  if (row.method === 'PAGE') return `open ${row.route}`;
  if (row.method === 'DOC') return `read the README section "${row.summary}"`;
  return `call ${row.method} ${row.route}`;
}

function renderTable(signals, rows, total) {
  const from = signals.join(', ');
  const note = total > rows.length ? ` Showing the first ${rows.length} of ${total}.` : '';
  const body = rows.map((row) => `| ${cell(row.id)} | ${cell(whereOf(row))} | ${cell(row.file)} | ${cell(howOf(row))} | |`);
  return [
    '# Feature map',
    '',
    `Drafted by \`ael feature-map scaffold\` from ${from}.${note} Each row is a user-facing feature: where it lives, the file that implements it, and how a user reaches it. Edit the rows, then run \`ael driver scaffold\` to add a driver per feature. Re-running scaffold leaves this file alone and writes \`feature-map.md.ael-new\` when the draft differs.`,
    '',
    HEADER,
    ...body,
    ''
  ].join('\n');
}

const STUB = `# Feature map

\`ael feature-map scaffold\` found no routes, OpenAPI document, pages, or README feature headings.
Fill one row per user-facing feature (what it does, and how a user reaches it). \`review-pack\` and \`doctor --harness\` read this table; \`driver scaffold\` needs at least one row.

${HEADER}

Example (the leading \`>\` keeps it out of the table until you delete it and add a real row):

> | export-csv | Reports > Export | src/reports/** | open Reports, click Export | |
`;

function draftFeatureMap(rootDir) {
  const openapi = [];
  const routes = [];
  const pages = [];
  let readme = null;
  for (const abs of walkFiles(rootDir).sort()) {
    const rel = path.relative(rootDir, abs).split(path.sep).join('/');
    if (isTestPath(rel)) continue;
    const base = path.posix.basename(rel);
    if (/^readme\.md$/i.test(base) && !rel.includes('/')) readme = { abs, rel };
    if (OPENAPI_NAME.test(base)) {
      openapi.push(...readOpenApi(abs, rel));
      continue;
    }
    const page = pageOf(rel);
    if (page) pages.push(page);
    if (!CODE_EXT.has(path.extname(rel).toLowerCase())) continue;
    routes.push(...routesIn(readBounded(abs), rel));
  }
  const signals = [];
  if (openapi.length) signals.push('openapi');
  if (routes.length) signals.push('routes');
  if (pages.length) signals.push('pages');
  let rows = mergeSignals(openapi, routes, pages);
  if (!rows.length && readme) {
    rows = readmeRows(readme.abs, readme.rel);
    if (rows.length) signals.push('readme');
  }
  if (!rows.length) return { content: STUB, signals: [], rows: [] };
  const total = rows.length;
  const kept = assignIds(rows.slice(0, MAX_ROWS));
  return { content: renderTable(signals, kept, total), signals, rows: kept };
}

// Same safe write as driver scaffold: an edited map stays put and the new
// draft lands beside it as feature-map.md.ael-new.
function scaffoldFeatureMap(rootDir) {
  const draft = draftFeatureMap(rootDir);
  const content = draft.content.endsWith('\n') ? draft.content : `${draft.content}\n`;
  const relative = FEATURE_MAP_FILE.split(path.sep).join('/');
  const file = path.join(rootDir, FEATURE_MAP_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let written = relative;
  let preserved = false;
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== content) {
    written = `${relative}.ael-new`;
    fs.writeFileSync(path.join(rootDir, written), content);
    preserved = true;
  } else if (!fs.existsSync(file)) {
    fs.writeFileSync(file, content);
  } else {
    written = null;
  }
  return {
    file: relative,
    written,
    preserved,
    source: draft.signals.length > 1 ? 'mixed' : (draft.signals[0] || 'stub'),
    signals: draft.signals,
    rows: draft.rows.length
  };
}

module.exports = { FEATURE_MAP_FILE, featuresForFiles, loadFeatureMap, parseFeatureMap, renderForPack, scaffoldFeatureMap };
