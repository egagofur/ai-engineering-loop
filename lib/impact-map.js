'use strict';

// Blast-radius impact map (#71). A deterministic, heuristic scan of the
// frozen Goal against the repository index, written to the Run before
// Stage 3 (Maker). A human confirms or edits it; the confirmed paths become
// the Run's allowed scope (#59), and verify reports drift outside it.

const fs = require('fs');
const path = require('path');
const { ACTOR_ID, readJsonOptional, sha256: hashBytes } = require('./fsutil.js');
const { atomicWriteJson, getCurrentRun, loadRun, runsDir } = require('./run-state.js');
const { sha256 } = require('./recipe.js');

const IMPACT_MAP_FILE = 'impact-map.json';
const IMPACT_DRIFT_FILE = 'impact-drift.json';
const MAP_STATUSES = Object.freeze(['DRAFT', 'CONFIRMED', 'SKIPPED']);
const DEFAULT_FILE_LIMIT = 20;
const MAX_SCAN_BYTES = 256 * 1024;
const MAX_ENTRIES = 50;

// English + Indonesian filler words; never used as match keywords.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'then', 'than', 'must', 'should',
  'will', 'shall', 'have', 'has', 'are', 'was', 'were', 'not', 'only', 'each', 'every', 'any', 'all',
  'returns', 'return', 'show', 'shows', 'make', 'makes', 'add', 'adds', 'new', 'use', 'uses', 'used',
  'can', 'cannot', 'does', 'still', 'also', 'more', 'less', 'after', 'before', 'without', 'within',
  'yang', 'dan', 'untuk', 'dengan', 'dari', 'pada', 'harus', 'tidak', 'akan', 'bisa', 'atau', 'ini', 'itu',
  'saat', 'jika', 'kalau', 'agar', 'supaya', 'sudah', 'belum', 'tambah', 'buat', 'ubah'
]);

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs)\/|\.(test|spec)\.[a-z0-9]+$/i;
const MIGRATION_PATH = /(^|\/)(migrations?|migrate|db\/migrate)\/|\.sql$/i;
const ROUTE_PATTERNS = [
  /\b(?:app|router|server|route|api)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi,
  /@(Get|Post|Put|Patch|Delete)\(\s*['"`]([^'"`]*)['"`]/g
];
const TABLE_PATTERN = /\b(?:create|alter|drop)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?[`"']?([A-Za-z_][\w.]*)/gi;

function impactError(message, code = 'IMPACT_MAP_ERROR', details = []) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, runId);
  const current = getCurrentRun(rootDir);
  if (!current) throw impactError('No current Run. Pass --run <id>.', 'NO_CURRENT_RUN');
  return current;
}

function mapPath(rootDir, runId) {
  return path.join(runsDir(rootDir), runId, IMPACT_MAP_FILE);
}

function driftPath(rootDir, runId) {
  return path.join(runsDir(rootDir), runId, IMPACT_DRIFT_FILE);
}

function relative(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function normalizeRepoPath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
}

// `**` crosses directories, `*` and `?` stay inside one segment, a trailing
// `/` means "this directory and everything below it".
function globToRegExp(pattern) {
  const glob = normalizeRepoPath(pattern);
  if (glob.endsWith('/')) return globToRegExp(`${glob}**`);
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      const slash = glob[index + 2] === '/';
      source += slash ? '(?:.*/)?' : '.*';
      index += slash ? 2 : 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesGlob(filePath, pattern) {
  return globToRegExp(pattern).test(normalizeRepoPath(filePath));
}

function matchesAnyGlob(filePath, patterns) {
  return (patterns || []).some((pattern) => matchesGlob(filePath, pattern));
}

function readGoal(rootDir, run) {
  const filePath = path.join(runsDir(rootDir), run.runId, 'goal-contract.json');
  if (!run.goal?.frozen && !run.artifacts?.goalContract) {
    throw impactError('The impact map needs a frozen Goal. Freeze the Goal first.', 'GOAL_NOT_FROZEN');
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw impactError(`Unable to read the frozen Goal: ${cause.message}`, 'GOAL_NOT_FROZEN');
  }
}

function goalKeywords(goal) {
  const text = [
    goal.objective,
    ...(goal.acceptanceCriteria || []).flatMap((criterion) => [criterion.statement, ...(criterion.failureCases || [])])
  ].join(' ');
  const words = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
  return [...new Set(words)].sort();
}

function tokensOf(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

// Keyword vs token match; a 4+ letter keyword also matches a plural/suffixed
// token ("page" ~ "pages", "pagination" ~ "paginate" share a 6-letter stem).
function keywordHits(keywords, tokens) {
  const set = new Set(tokens);
  return keywords.filter((keyword) => set.has(keyword) || tokens.some((token) => (
    (keyword.length >= 4 && token.startsWith(keyword)) ||
    (token.length >= 4 && keyword.startsWith(token)) ||
    (keyword.length >= 6 && token.length >= 6 && keyword.slice(0, 6) === token.slice(0, 6))
  )));
}

function loadIndex(rootDir) {
  try {
    const { buildContextIndex } = require('./smart-context.js');
    return { files: buildContextIndex(rootDir).index.files, warning: null };
  } catch (cause) {
    return { files: [], warning: `Repository index unavailable: ${cause.message}` };
  }
}

function readBounded(rootDir, relativePath) {
  try {
    const absolute = path.join(rootDir, relativePath);
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SCAN_BYTES) return '';
    const raw = fs.readFileSync(absolute);
    return raw.includes(0) ? '' : raw.toString('utf8');
  } catch {
    return '';
  }
}

function confidence(score, top) {
  if (!top) return 0;
  return Math.round(Math.min(0.95, Math.max(0.1, score / top)) * 100) / 100;
}

function stem(relativePath) {
  return path.posix.basename(relativePath).replace(/\.(test|spec)(?=\.)/i, '').replace(/\.[^.]+$/, '').toLowerCase();
}

function scoreFiles(index, keywords) {
  return index
    .map((file) => {
      const pathHits = keywordHits(keywords, tokensOf(file.path));
      const symbolHits = keywordHits(keywords, (file.symbols || []).flatMap(tokensOf))
        .filter((keyword) => !pathHits.includes(keyword));
      return { file, pathHits, symbolHits, score: pathHits.length * 3 + symbolHits.length * 2 };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path));
}

function reasonFor({ pathHits, symbolHits }) {
  const parts = [];
  if (pathHits.length) parts.push(`path matches ${pathHits.join(', ')}`);
  if (symbolHits.length) parts.push(`symbols match ${symbolHits.join(', ')}`);
  return parts.join('; ');
}

function buildImpactMap(rootDir, { run, goal, limit = DEFAULT_FILE_LIMIT, now = new Date() }) {
  const keywords = goalKeywords(goal);
  const { files: index, warning } = loadIndex(rootDir);
  const scored = scoreFiles(index, keywords);
  const top = scored[0]?.score || 0;
  const sourceHits = scored.filter((entry) => !TEST_PATH.test(entry.file.path) && !MIGRATION_PATH.test(entry.file.path)).slice(0, limit);
  const files = sourceHits.map((entry) => ({
    path: entry.file.path,
    confidence: confidence(entry.score, top),
    reason: reasonFor(entry)
  }));

  const tests = new Map();
  for (const entry of scored.filter((item) => TEST_PATH.test(item.file.path)).slice(0, limit)) {
    tests.set(entry.file.path, { path: entry.file.path, confidence: confidence(entry.score, top), reason: reasonFor(entry) });
  }
  const sourceStems = new Map(files.map((file) => [stem(file.path), file.path]));
  for (const file of index.filter((item) => TEST_PATH.test(item.path))) {
    const target = sourceStems.get(stem(file.path));
    if (target && !tests.has(file.path)) {
      tests.set(file.path, { path: file.path, confidence: 0.6, reason: `test file named after ${target}` });
    }
  }

  const modules = new Map();
  for (const file of files) {
    const directory = path.posix.dirname(file.path);
    const name = directory === '.' ? '.' : directory.split('/').slice(0, 2).join('/');
    const current = modules.get(name);
    if (!current) modules.set(name, { name, confidence: file.confidence, reason: `contains ${file.path}` });
    else if (file.confidence > current.confidence) current.confidence = file.confidence;
  }

  const endpoints = [];
  const dbTables = new Map();
  for (const entry of scored.filter((item) => MIGRATION_PATH.test(item.file.path)).slice(0, limit)) {
    dbTables.set(`migration:${entry.file.path}`, {
      name: path.posix.basename(entry.file.path),
      kind: 'migration',
      path: entry.file.path,
      confidence: confidence(entry.score, top),
      reason: reasonFor(entry)
    });
  }
  for (const entry of [...sourceHits, ...scored.filter((item) => MIGRATION_PATH.test(item.file.path)).slice(0, limit)]) {
    const text = readBounded(rootDir, entry.file.path);
    if (!text) continue;
    for (const pattern of ROUTE_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        endpoints.push({
          method: match[1].toUpperCase(),
          route: match[2] || '/',
          path: entry.file.path,
          confidence: confidence(entry.score, top),
          reason: `route declared in ${entry.file.path}`
        });
      }
    }
    for (const match of text.matchAll(TABLE_PATTERN)) {
      const key = `table:${match[1].toLowerCase()}`;
      if (!dbTables.has(key)) {
        dbTables.set(key, {
          name: match[1],
          kind: 'table',
          path: entry.file.path,
          confidence: confidence(entry.score, top),
          reason: `table statement in ${entry.file.path}`
        });
      }
    }
  }

  const byConfidence = (left, right) => right.confidence - left.confidence ||
    String(left.path || left.name).localeCompare(String(right.path || right.name));
  return {
    schemaVersion: 1,
    runId: run.runId,
    goalHash: sha256(goal),
    status: 'DRAFT',
    generator: 'heuristic-v1',
    generatedAt: now.toISOString(),
    keywords,
    ...(warning ? { warnings: [warning] } : {}),
    files,
    modules: [...modules.values()].sort(byConfidence).slice(0, MAX_ENTRIES),
    endpoints: endpoints.sort(byConfidence).slice(0, MAX_ENTRIES),
    dbTables: [...dbTables.values()].sort(byConfidence).slice(0, MAX_ENTRIES),
    tests: [...tests.values()].sort(byConfidence).slice(0, MAX_ENTRIES),
    scope: null
  };
}

function loadImpactMap(rootDir, runId) {
  const filePath = mapPath(rootDir, runId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw impactError(`impact-map.json is invalid: ${cause.message}`, 'INVALID_IMPACT_MAP');
  }
}

function validateImpactMap(map, run) {
  const errors = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return ['impact map must be an object'];
  if (map.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (run && map.runId !== run.runId) errors.push(`runId must be ${run.runId}`);
  if (!MAP_STATUSES.includes(map.status)) errors.push(`status must be one of ${MAP_STATUSES.join(', ')}`);
  for (const key of ['files', 'modules', 'endpoints', 'dbTables', 'tests']) {
    if (!Array.isArray(map[key])) {
      errors.push(`${key} must be an array`);
      continue;
    }
    map[key].forEach((entry, index) => {
      if (!String(entry?.reason || '').trim()) errors.push(`${key}[${index}].reason is required`);
      if (typeof entry?.confidence !== 'number' || entry.confidence < 0 || entry.confidence > 1) {
        errors.push(`${key}[${index}].confidence must be between 0 and 1`);
      }
      if (!String(entry?.path || entry?.name || '').trim()) errors.push(`${key}[${index}] needs a path or name`);
    });
  }
  if (map.status === 'SKIPPED' && !String(map.skipReason || '').trim()) errors.push('skipReason is required when SKIPPED');
  if (map.status === 'CONFIRMED') {
    if (!Array.isArray(map.scope?.allowedPaths)) errors.push('scope.allowedPaths is required when CONFIRMED');
    if (!String(map.confirmedBy || '').trim()) errors.push('confirmedBy is required when CONFIRMED');
  }
  return errors;
}

function writeMap(rootDir, run, map) {
  const errors = validateImpactMap(map, run);
  if (errors.length) throw impactError('Impact map is invalid', 'INVALID_IMPACT_MAP', errors);
  const filePath = mapPath(rootDir, run.runId);
  atomicWriteJson(filePath, map);
  return { map, path: relative(rootDir, filePath) };
}

function actorId(actor) {
  const value = String(actor || '').trim();
  if (!ACTOR_ID.test(value)) {
    throw impactError('--by <name> must be a short account identifier', 'INVALID_USAGE');
  }
  return value;
}

function generateImpactMap(rootDir, { runId, force = false, limit, now = new Date() } = {}) {
  const run = resolveRun(rootDir, runId);
  const existing = loadImpactMap(rootDir, run.runId);
  if (existing && existing.status !== 'DRAFT' && !force) {
    throw impactError(`Impact map is already ${existing.status}; pass --force to regenerate it`, 'IMPACT_MAP_LOCKED');
  }
  const goal = readGoal(rootDir, run);
  return writeMap(rootDir, run, buildImpactMap(rootDir, { run, goal, limit, now }));
}

function mappedPaths(map) {
  return [...new Set([
    ...(map.files || []).map((entry) => entry.path),
    ...(map.tests || []).map((entry) => entry.path),
    ...(map.dbTables || []).filter((entry) => entry.kind === 'migration').map((entry) => entry.path)
  ].filter(Boolean).map(normalizeRepoPath))].sort();
}

function confirmImpactMap(rootDir, { runId, by, allow = [], remove = [], now = new Date() } = {}) {
  const run = resolveRun(rootDir, runId);
  const map = loadImpactMap(rootDir, run.runId);
  if (!map) throw impactError('No impact map yet. Run `impact map` first.', 'IMPACT_MAP_MISSING');
  const goal = readGoal(rootDir, run);
  if (map.goalHash !== sha256(goal)) {
    throw impactError('Impact map was built for another Goal version; regenerate it with `impact map --force`', 'IMPACT_MAP_STALE');
  }
  const removed = new Set(remove.map(normalizeRepoPath));
  const allowedPaths = [...new Set([...mappedPaths(map), ...allow.map(normalizeRepoPath)])]
    .filter((entry) => entry && !removed.has(entry))
    .sort();
  const { skipReason: _skip, skippedBy: _by, skippedAt: _at, ...rest } = map;
  return writeMap(rootDir, run, {
    ...rest,
    status: 'CONFIRMED',
    confirmedBy: actorId(by),
    confirmedAt: now.toISOString(),
    scope: { allowedPaths }
  });
}

function skipImpactMap(rootDir, { runId, by, reason, now = new Date() } = {}) {
  const run = resolveRun(rootDir, runId);
  const why = String(reason || '').trim();
  if (!why || why.length > 500) throw impactError('--reason must be 1-500 characters', 'INVALID_USAGE');
  const goal = readGoal(rootDir, run);
  const existing = loadImpactMap(rootDir, run.runId);
  return writeMap(rootDir, run, {
    schemaVersion: 1,
    runId: run.runId,
    goalHash: sha256(goal),
    status: 'SKIPPED',
    generator: existing?.generator || 'heuristic-v1',
    generatedAt: existing?.generatedAt || now.toISOString(),
    keywords: existing?.keywords || goalKeywords(goal),
    files: [],
    modules: [],
    endpoints: [],
    dbTables: [],
    tests: [],
    scope: null,
    skipReason: why,
    skippedBy: actorId(by),
    skippedAt: now.toISOString()
  });
}

// Allowed scope for the guardrail (#59): only a CONFIRMED map defines one.
function impactScope(map) {
  if (!map || map.status !== 'CONFIRMED' || !Array.isArray(map.scope?.allowedPaths)) return null;
  return { allowedPaths: [...map.scope.allowedPaths] };
}

function changedFilesFromDiff(diff) {
  const files = new Set();
  for (const line of String(diff || '').split('\n')) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (match) files.add(normalizeRepoPath(match[2]));
  }
  return [...files].filter((file) => !file.startsWith('.ai-engineering-loop/')).sort();
}

// Diff the gated Maker diff against the map. DRAFT maps compare against the
// mapped paths but say so; SKIPPED or missing maps record no drift.
function detectImpactDrift(rootDir, { runId, now = new Date() } = {}) {
  const run = resolveRun(rootDir, runId);
  const diffFile = path.join(runsDir(rootDir), run.runId, 'diff.patch');
  if (!fs.existsSync(diffFile)) throw impactError('No Maker diff to compare. Pass the Maker gate first.', 'MAKER_NOT_GATED');
  const raw = fs.readFileSync(diffFile);
  const diff = raw.toString('utf8');
  const map = loadImpactMap(rootDir, run.runId);
  const changedFiles = changedFilesFromDiff(diff);
  let allowed = [];
  if (map?.status === 'CONFIRMED') allowed = map.scope?.allowedPaths || [];
  else if (map?.status === 'DRAFT') allowed = mappedPaths(map);
  const compared = map && map.status !== 'SKIPPED';
  const outOfMap = compared ? changedFiles.filter((file) => !matchesAnyGlob(file, allowed)) : [];
  const drift = {
    schemaVersion: 1,
    runId: run.runId,
    diffHash: hashBytes(raw),
    mapStatus: map ? map.status : 'MISSING',
    ...(map?.status === 'SKIPPED' ? { skipReason: map.skipReason } : {}),
    checkedAt: now.toISOString(),
    changedFiles,
    outOfMap
  };
  const filePath = driftPath(rootDir, run.runId);
  atomicWriteJson(filePath, drift);
  return { drift, path: relative(rootDir, filePath) };
}

function loadImpactDrift(rootDir, runId) {
  const filePath = driftPath(rootDir, runId);
  return readJsonOptional(filePath);
}

function driftFindings(drift) {
  return (drift?.outOfMap || []).map((file, index) => ({
    id: `IMPACT-DRIFT-${index + 1}`,
    axis: 'spec',
    location: file,
    failureScenario: `${file} changed outside the ${drift.mapStatus === 'CONFIRMED' ? 'confirmed' : 'unconfirmed'} blast-radius map; reviewers did not plan for its side effects`,
    evidence: `${IMPACT_DRIFT_FILE} lists ${file} in outOfMap (map status ${drift.mapStatus})`,
    severity: 'LOW',
    validity: 'VALID',
    disposition: 'ACCEPTABLE',
    source: 'impact-map'
  }));
}

// Called by the review gate: drift becomes LOW ledger warnings, added once.
function mergeDriftIntoLedger(ledger, drift) {
  if (!drift || drift.diffHash !== ledger.diffHash || !Array.isArray(ledger.findings)) return { ledger, added: 0 };
  const present = new Set(ledger.findings.filter((item) => item.source === 'impact-map').map((item) => item.location));
  const additions = driftFindings(drift).filter((item) => !present.has(item.location));
  return { ledger: { ...ledger, findings: [...ledger.findings, ...additions] }, added: additions.length };
}

module.exports = {
  IMPACT_MAP_FILE,
  IMPACT_DRIFT_FILE,
  MAP_STATUSES,
  globToRegExp,
  matchesGlob,
  matchesAnyGlob,
  goalKeywords,
  buildImpactMap,
  generateImpactMap,
  confirmImpactMap,
  skipImpactMap,
  loadImpactMap,
  validateImpactMap,
  impactScope,
  changedFilesFromDiff,
  detectImpactDrift,
  loadImpactDrift,
  driftFindings,
  mergeDriftIntoLedger
};
