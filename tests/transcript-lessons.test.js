'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { mineTranscripts } = require('../lib/transcript-lessons.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');
const SECRET = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd';
const NOW = new Date('2026-11-21T12:00:00Z');
const at = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();

function setup() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-tx-home-')));
  const repo = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-tx-'))), 'shop.app');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.js'), 'console.log("debug");\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'add debug log');
  const claudeDir = path.join(home, '.claude', 'projects', repo.replace(/[\\/:.]/g, '-'));
  fs.mkdirSync(claudeDir, { recursive: true });
  const claude = (id, corrections, day = 1) => fs.writeFileSync(path.join(claudeDir, `${id}.jsonl`), [
    { type: 'user', message: { role: 'user', content: 'Add the export button' }, timestamp: at(day) },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }, timestamp: at(day) },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'jangan pakai console.log lagi' }] }, timestamp: at(day) },
    { type: 'user', message: { role: 'user', content: '<system-reminder>jangan pakai console.log</system-reminder>' }, timestamp: at(day) },
    ...corrections.map((text) => ({ type: 'user', message: { role: 'user', content: text }, timestamp: at(day) }))
  ].map((line) => JSON.stringify(line)).join('\n'));
  claude('s1', ['jangan pakai `console.log` di service, pakai logger kita']);
  claude('s2', ['kok masih pakai `console.log` di service? pakai logger kita']);
  claude('s3', [`don't use \`console.log\` in the service again, token ${SECRET} lives in ${home}/secrets, use our logger`]);
  claude('s4', ['jangan ubah README tanpa ditanya dulu ya, itu dokumen klien']);
  claude('old', ['jangan pakai `console.log` di service, pakai logger kita'], 90);
  const codexDir = path.join(home, '.codex', 'sessions', '2026', '11', '20');
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(codexDir, 'rollout-x.jsonl'), [
    { type: 'session_meta', payload: { cwd: repo } },
    { type: 'response_item', timestamp: at(2), payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Start the refund task' }] } },
    { type: 'response_item', timestamp: at(2), payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'why did you use console.log in the service again, use the logger' }] } }
  ].map((line) => JSON.stringify(line)).join('\n'));
  return { home, repo };
}

function withHome(home, fn) {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('C-44 a correction repeated across sessions and hosts becomes one candidate; one-offs and old sessions do not', () => {
  const { home, repo } = setup();
  const result = withHome(home, () => mineTranscripts(repo, { since: 30, now: NOW }));
  assert.deepStrictEqual(result.scanned, { claude: 5, cursor: 'not found', codex: 1 });
  assert.strictEqual(result.entries.length, 1);
  const [entry] = result.entries;
  assert.strictEqual(entry.sessions, 4);
  assert.deepStrictEqual(entry.hosts, ['claude', 'codex']);
  assert.match(entry.id, /^L-T[0-9a-f]{8}$/);
  assert.ok(entry.lesson.length <= 200);
  assert.strictEqual(entry.suggestedFix.level, 'lint');
  assert.match(entry.suggestedFix.command, /--forbid-api "console\\.log"/);
  assert.match(entry.suggestedFix.command, /--prove [0-9a-f]{12}/);
});

test('C-44 tool results, system text and the first task message are never treated as corrections', () => {
  const { home, repo } = setup();
  const result = withHome(home, () => mineTranscripts(repo, { since: 30, minSessions: 1, now: NOW }));
  const lessons = result.entries.map((entry) => entry.lesson).join('\n');
  assert.ok(!/Add the export button|Start the refund task|system-reminder/.test(lessons));
});

test('C-44 the CLI saves only redacted examples, and the lesson can be promoted', () => {
  const { home, repo } = setup();
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  const out = cli('learn', '--transcripts', '--since', '30d', '--json');
  assert.strictEqual(out.status, 0, out.stdout + out.stderr);
  const saved = fs.readFileSync(path.join(repo, '.ai-engineering-loop', 'transcript-lessons.json'), 'utf8');
  const everything = fs.readdirSync(path.join(repo, '.ai-engineering-loop'), { recursive: true })
    .map((name) => path.join(repo, '.ai-engineering-loop', name))
    .filter((file) => fs.statSync(file).isFile())
    .map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.ok(!everything.includes(SECRET), 'secret never stored');
  assert.ok(!everything.includes(`${home}/secrets`), 'home path never stored');
  assert.ok(!everything.includes('Add the export button'), 'non-correction text never stored');
  const id = JSON.parse(saved).entries[0].id;
  const promoted = cli('learn', 'promote', id, '--forbid-api', 'console\\.log', '--fix', 'use the logger', '--by', 'ega', '--json');
  assert.strictEqual(promoted.status, 0, promoted.stdout + promoted.stderr);
  assert.strictEqual(JSON.parse(promoted.stdout).rule.from, id);
});

test('C-44 missing hosts are skipped, bad options are refused', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-tx-empty-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-tx-repo-'));
  const result = withHome(home, () => mineTranscripts(repo, { now: NOW }));
  assert.deepStrictEqual(result, { scanned: { claude: 'not found', cursor: 'not found', codex: 'not found' }, corrections: 0, entries: [] });
  assert.throws(() => mineTranscripts(repo, { hosts: ['vim'] }), /--host/);
  assert.throws(() => mineTranscripts(repo, { since: 0 }), /--since/);
});
