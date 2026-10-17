'use strict';

// Issue #60: host certification tiers and the instruction-only AGENTS.md digest.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { CERTIFICATIONS, HOSTS } = require('../lib/hosts/registry.js');
const { renderHostTable, certificationLabel } = require('../lib/hosts/table.js');
const { formatHostsDoctor, hostsDoctor } = require('../lib/hosts/doctor.js');
const { listHosts, formatHostsList } = require('../lib/hosts/commands.js');
const { buildHostSkills, DIGEST_PATH, DIGEST_BYTE_LIMIT } = require('../lib/host-skill-build.js');
const { resolveDoc } = require('../lib/docs.js');

test('every host has a certification from the enum; full needs a run record; no numeric tier left', () => {
  assert.deepStrictEqual([...CERTIFICATIONS], ['full', 'experimental', 'instruction-only']);
  for (const host of HOSTS) {
    assert.ok(CERTIFICATIONS.includes(host.certification), `${host.id}: ${host.certification}`);
    assert.strictEqual(host.tier, undefined, `${host.id} still has tier`);
    if (host.certification === 'full') {
      const by = host.certifiedBy || {};
      assert.strictEqual(by.recipe, 'default', `${host.id}: full needs certifiedBy.recipe "default"`);
      assert.match(String(by.aelVersion), /^\d+\.\d+\.\d+$/, `${host.id}: certifiedBy.aelVersion`);
      assert.match(String(by.date), /^\d{4}-\d{2}-\d{2}$/, `${host.id}: certifiedBy.date`);
      assert.ok(host.agents, `${host.id}: full needs reviewer subagents`);
    } else {
      assert.strictEqual(host.certifiedBy, null, `${host.id}: certifiedBy only for full`);
    }
    // instruction-only exactly when the host has no file-based reviewer agents.
    assert.strictEqual(host.certification === 'instruction-only', host.agents === null, host.id);
  }
});

test('no host claims full without a recorded run (none recorded yet)', () => {
  assert.deepStrictEqual(HOSTS.filter((host) => host.certification === 'full').map((host) => host.id), []);
});

test('certificationLabel shows the run record for full', () => {
  assert.strictEqual(certificationLabel({ certification: 'experimental', certifiedBy: null }), 'experimental');
  assert.strictEqual(
    certificationLabel({ certification: 'full', certifiedBy: { recipe: 'default', aelVersion: '1.16.0', date: '2026-10-20' } }),
    'full (default, v1.16.0, 2026-10-20)'
  );
});

test('README table has a Certification column with each host tier', () => {
  const table = renderHostTable();
  assert.match(table, /\| Host \| id \| Certification \|/);
  for (const host of HOSTS) assert.ok(table.includes(`| \`${host.id}\` | ${host.certification} |`), host.id);
  assert.match(table, /docs AGENTS/);
});

test('hosts list and hosts doctor print the tier', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-cert-'));
  const selection = { enabled: new Set(['claude', 'goose']), disabled: new Set(), source: 'config', mode: 'manual' };
  const rows = listHosts({ home, env: { PATH: '' }, selection });
  assert.strictEqual(rows.find((row) => row.id === 'goose').certification, 'instruction-only');
  assert.match(formatHostsList(rows, selection), /claude\s+yes\s+experimental/);
  const report = hostsDoctor({ home, selection, plan: [] });
  assert.strictEqual(report.hosts.find((row) => row.id === 'claude').certification, 'experimental');
  const text = formatHostsDoctor(report);
  assert.match(text, /claude\s+\[experimental, guardrails enforced\]/);
  assert.match(text, /goose\s+\[instruction-only, guardrails advisory\]/);
  assert.match(formatHostsList(rows, selection), /goose\s+yes\s+instruction-only\s+advisory/);
});

test('AGENTS.md digest is generated, at most 2 KB, and served by docs AGENTS', () => {
  const digest = buildHostSkills(ROOT).find((out) => out.kind === 'digest');
  assert.strictEqual(digest.path, DIGEST_PATH);
  assert.strictEqual(DIGEST_BYTE_LIMIT, 2048);
  assert.ok(Buffer.byteLength(digest.content) <= DIGEST_BYTE_LIMIT, `${Buffer.byteLength(digest.content)} bytes`);
  const onDisk = fs.readFileSync(path.join(ROOT, DIGEST_PATH), 'utf8').replace(/\r\n?/g, '\n');
  assert.strictEqual(onDisk, digest.content, 'run npm run build:skills');
  assert.match(onDisk, /CONTEXT_ISOLATION_ONLY/);
  assert.match(onDisk, /failure table/);
  assert.match(onDisk, /never claim independent review/);
  assert.strictEqual(resolveDoc('AGENTS').rel, DIGEST_PATH);
});

test('an oversized digest source fails the build', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-digest-'));
  fs.cpSync(path.join(ROOT, 'skill-src'), path.join(tmp, 'skill-src'), { recursive: true });
  fs.appendFileSync(path.join(tmp, 'skill-src/ai-engineering-loop/digest.md'), 'x'.repeat(DIGEST_BYTE_LIMIT));
  assert.throws(() => buildHostSkills(tmp), /AGENTS\.md: \d+ bytes > 2048/);
});
