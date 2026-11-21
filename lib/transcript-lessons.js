'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { redactHomePaths, redactSecrets } = require('./safe-context.js');

const FILE = path.join('.ai-engineering-loop', 'transcript-lessons.json');
const HOSTS = ['claude', 'cursor', 'codex'];
const MAX_EXAMPLE = 200;
const MAX_TURN = 600;
const THRESHOLD = 0.6;
const DAY = 86400000;
const CORRECTION = /\b(don'?t|do not|never|stop doing|(same|still|keeps?|why)\b.{0,30}\bagain|already (said|told)|i (said|told) you|wrong|not what i|instead of|revert|undo|why did you|jangan|kok\b|(masih|kenapa)\b.{0,30}\blagi|sudah (di|aku |ku)?bilang|udah (di|aku |ku)?bilang|salah|kenapa (kamu|malah)|bukan (itu|begitu|gitu)|harusnya|seharusnya|malah)\b/i;
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'you', 'your', 'please', 'again', 'don', 'not', 'dont', 'never', 'stop', 'already', 'said', 'told', 'wrong', 'why', 'did',
  'yang', 'dan', 'untuk', 'dengan', 'dari', 'pada', 'tidak', 'akan', 'bisa', 'atau', 'ini', 'itu', 'jangan', 'kok', 'lagi', 'sudah', 'udah', 'bilang', 'salah', 'kenapa', 'kamu', 'malah', 'bukan', 'harusnya', 'seharusnya', 'aku', 'tolong', 'pakai', 'pake', 'use', 'using'
]);

const home = () => process.env.HOME || process.env.USERPROFILE || os.homedir();
const fail = (message, code = 'INVALID_USAGE') => Object.assign(new Error(message), { code });

function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function listFiles(dir, match, depth = 4) {
  const out = [];
  const walk = (current, level) => {
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && level < depth) walk(full, level + 1);
      else if (entry.isFile() && match(entry.name)) out.push(full);
    }
  };
  walk(dir, 0);
  return out;
}

const textOf = (content) => (typeof content === 'string'
  ? content
  : Array.isArray(content) ? content.filter((part) => part && ['text', 'input_text'].includes(part.type)).map((part) => part.text).join('\n') : '');

const humanText = (text) => {
  const value = String(text || '').trim();
  return value && !value.startsWith('<') && !/^caveat:/i.test(value) ? value : '';
};

function claudeSessions(repo) {
  const slug = repo.replace(/[\\/:.]/g, '-');
  const base = path.join(home(), '.claude', 'projects');
  let dirs = [];
  try {
    dirs = fs.readdirSync(base).filter((name) => name === slug || name.startsWith(`${slug}--`));
  } catch {
    return { found: false, sessions: [] };
  }
  const sessions = [];
  for (const dir of dirs) {
    for (const file of listFiles(path.join(base, dir), (name) => name.endsWith('.jsonl'), 0)) {
      const turns = readLines(file)
        .filter((line) => line.type === 'user' && line.message && !line.isMeta && !line.isSidechain)
        .map((line) => ({ text: humanText(textOf(line.message.content)), at: Date.parse(line.timestamp) || null }))
        .filter((turn) => turn.text);
      sessions.push({ host: 'claude', id: path.basename(file, '.jsonl'), turns });
    }
  }
  return { found: dirs.length > 0, sessions };
}

function cursorSessions(repo) {
  const slug = repo.replace(/^[\\/]+/, '').replace(/[\\/:.]/g, '-');
  const dir = path.join(home(), '.cursor', 'projects', slug, 'agent-transcripts');
  if (!fs.existsSync(dir)) return { found: false, sessions: [] };
  const sessions = listFiles(dir, (name) => name.endsWith('.jsonl'), 2).map((file) => {
    const at = fs.statSync(file).mtimeMs;
    const turns = readLines(file)
      .filter((line) => line.role === 'user')
      .map((line) => ({ text: humanText(textOf(line.message?.content)), at }))
      .filter((turn) => turn.text);
    return { host: 'cursor', id: path.basename(file, '.jsonl'), turns };
  });
  return { found: true, sessions };
}

function codexSessions(repo) {
  const dir = path.join(home(), '.codex', 'sessions');
  if (!fs.existsSync(dir)) return { found: false, sessions: [] };
  const target = path.resolve(repo);
  const sessions = [];
  for (const file of listFiles(dir, (name) => name.endsWith('.jsonl'), 4)) {
    const lines = readLines(file);
    const cwd = lines.find((line) => line.type === 'session_meta')?.payload?.cwd;
    if (!cwd || (path.resolve(cwd) !== target && !path.resolve(cwd).startsWith(`${target}${path.sep}`))) continue;
    const turns = lines
      .filter((line) => line.type === 'response_item' && line.payload?.type === 'message' && line.payload.role === 'user')
      .map((line) => ({ text: humanText(textOf(line.payload.content)), at: Date.parse(line.timestamp) || null }))
      .filter((turn) => turn.text);
    sessions.push({ host: 'codex', id: path.basename(file, '.jsonl'), turns });
  }
  return { found: true, sessions };
}

const READERS = { claude: claudeSessions, cursor: cursorSessions, codex: codexSessions };

function words(text) {
  return [...new Set(String(text).toLowerCase().replace(/[`'"]/g, '').split(/[^a-z0-9_]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word)))].sort();
}

function similarity(left, right) {
  if (!left.length || !right.length) return 0;
  const set = new Set(left);
  const shared = right.filter((word) => set.has(word)).length;
  return shared >= 3 ? shared / Math.min(left.length, right.length) : 0;
}

const redact = (text) => {
  const clean = redactHomePaths(redactSecrets(String(text)).text).replace(/\s+/g, ' ').trim();
  return clean.length > MAX_EXAMPLE ? `${clean.slice(0, MAX_EXAMPLE - 1)}…` : clean;
};

function codeToken(text) {
  const tick = String(text).match(/`([^`]{2,60})`/);
  if (tick) return tick[1].trim();
  const call = String(text).match(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\(?/);
  return call ? call[1] : null;
}

function provingCommit(repo, token) {
  if (!token) return null;
  try {
    return execFileSync('git', ['log', '-S', token, '-n', '1', '--format=%H', '--', '.', ':(exclude).ai-engineering-loop'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function suggestedFix(repo, id, text) {
  const token = codeToken(text);
  if (token) {
    const pattern = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const commit = provingCommit(repo, token);
    return {
      level: 'lint',
      why: `names code (${token}); a rule can block new uses`,
      command: `ai-engineering-loop learn promote ${id} --forbid-api "${pattern}" --fix "<what to use instead>" --by <name>${commit ? ` --prove ${commit.slice(0, 12)}` : ''}`
    };
  }
  if (/\btest|tes\b/i.test(text)) return { level: 'test', why: 'about tests; a test that fails on the mistake enforces it' };
  return { level: 'docs', why: 'a judgment call; record it in lessons.md or a skill until it can be enforced' };
}

function mineTranscripts(repo, { hosts = HOSTS, since = 30, minSessions = 2, now = new Date() } = {}) {
  const unknown = hosts.filter((host) => !HOSTS.includes(host));
  if (unknown.length) throw fail(`--host must be ${HOSTS.join(', ')} or all (got ${unknown.join(', ')})`);
  if (!Number.isInteger(since) || since < 1) throw fail('--since must be a number of days, such as 30 or 30d');
  const cutoff = now.getTime() - since * DAY;
  const scanned = {};
  const corrections = [];
  for (const host of hosts) {
    const { found, sessions } = READERS[host](repo);
    scanned[host] = found ? sessions.length : 'not found';
    for (const session of sessions) {
      session.turns.slice(1).forEach((turn) => {
        if (turn.at && turn.at < cutoff) return;
        if (turn.text.length > MAX_TURN || !CORRECTION.test(turn.text)) return;
        const key = words(turn.text);
        if (key.length >= 3) corrections.push({ host, session: `${host}:${session.id}`, text: turn.text, key, at: turn.at });
      });
    }
  }
  const groups = [];
  for (const item of corrections) {
    const group = groups.find((entry) => similarity(entry.key, item.key) >= THRESHOLD);
    if (group) group.items.push(item);
    else groups.push({ key: item.key, items: [item] });
  }
  const entries = groups
    .map((group) => ({ group, sessions: new Set(group.items.map((item) => item.session)) }))
    .filter(({ sessions }) => sessions.size >= minSessions)
    .map(({ group, sessions }) => {
      const id = `L-T${require('crypto').createHash('sha256').update(group.key.join(' ')).digest('hex').slice(0, 8)}`;
      const latest = [...group.items].sort((a, b) => (b.at || 0) - (a.at || 0))[0];
      return {
        id,
        source: 'transcripts',
        lesson: redact(latest.text),
        sessions: sessions.size,
        occurrences: group.items.length,
        hosts: [...new Set(group.items.map((item) => item.host))].sort(),
        lastSeenAt: latest.at ? new Date(latest.at).toISOString() : null,
        suggestedFix: suggestedFix(repo, id, latest.text)
      };
    })
    .sort((a, b) => b.sessions - a.sessions || b.occurrences - a.occurrences);
  return { scanned, corrections: corrections.length, entries };
}

function writeTranscriptLessons(repo, result, { since, now = new Date() }) {
  const file = path.join(repo, FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, generatedAt: now.toISOString(), sinceDays: since, scanned: result.scanned, entries: result.entries }, null, 2)}\n`, { mode: 0o600 });
  return FILE;
}

function loadTranscriptLessons(repo) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repo, FILE), 'utf8')).entries || [];
  } catch {
    return [];
  }
}

module.exports = { FILE, HOSTS, loadTranscriptLessons, mineTranscripts, writeTranscriptLessons };
