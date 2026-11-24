'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { DINERS_FILE, FALLBACK_DINERS, MAX_DINERS, defaultDiners, parseDiners, studioDiners, validDiners } = require('../lib/studio/diners.js');

const studio = path.join(__dirname, '..', 'studio');

test('the shipped diners file holds the valid default diners and is an allowlisted asset', () => {
  const shipped = JSON.parse(fs.readFileSync(DINERS_FILE, 'utf8'));
  assert.deepStrictEqual(validDiners(shipped), shipped, 'every shipped entry passes validation');
  assert.ok(shipped.length >= 1 && shipped.length <= MAX_DINERS);
  assert.deepStrictEqual(shipped, [{ name: 'Matt Pocock', note: 'Skills For Real Engineers' }, { name: 'Claude', note: 'Loop engineering' }]);
  assert.deepStrictEqual(defaultDiners(), shipped);
  const server = fs.readFileSync(path.join(__dirname, '..', 'lib', 'studio-server.js'), 'utf8');
  assert.ok(server.includes("['/diners.json', 'diners.json']"));
  assert.ok(server.includes("['/js/diners.js', 'js/diners.js']"));
});

test('a missing or invalid diners file leaves only generic, unnamed seats', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-diners-'));
  const broken = path.join(dir, 'diners.json');
  fs.writeFileSync(broken, '{not json');
  assert.deepStrictEqual(FALLBACK_DINERS, []);
  assert.deepStrictEqual(defaultDiners(broken), []);
  fs.writeFileSync(broken, JSON.stringify([{ name: '' }, 5, { name: 'Ok', note: 7 }]));
  assert.deepStrictEqual(defaultDiners(broken), [{ name: 'Ok' }]);
  assert.deepStrictEqual(defaultDiners(path.join(dir, 'missing.json')), []);
});

test('studio.diners in the local config overrides the defaults after validation', () => {
  const long = 'x'.repeat(41);
  const config = {
    studio: {
      diners: [
        { name: '  Ada\nLovelace ', note: 'Debugging the menu' },
        { name: long },
        { name: 'Grace', note: 'n'.repeat(61) },
        { name: '<b>Linus</b>' },
        'nope',
        null,
        { note: 'no name' },
        { name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }
      ]
    }
  };
  const diners = parseDiners(config);
  assert.equal(diners.length, MAX_DINERS);
  assert.deepStrictEqual(diners.slice(0, 3), [{ name: 'Ada Lovelace', note: 'Debugging the menu' }, { name: 'Grace' }, { name: '<b>Linus</b>' }]);
  assert.deepStrictEqual(studioDiners(config).customDiners, true);
  assert.deepStrictEqual(parseDiners({}), []);
  assert.deepStrictEqual(parseDiners({ studio: { diners: 'Ada' } }), []);
  const fallback = studioDiners({ studio: { diners: [{ name: '' }] } });
  assert.equal(fallback.customDiners, false);
  assert.deepStrictEqual(fallback.diners.map((diner) => diner.name), ['Matt Pocock', 'Claude']);
});

test('diner name tags escape names and carry the fixed subtitle; the layout seats at most six', async () => {
  const { renderDiners, DINER_SUBTITLE } = await import(pathToFileURL(path.join(studio, 'js', 'ring2d.js')).href);
  assert.equal(DINER_SUBTITLE, 'Eating while their workflow cooks');
  const html = renderDiners([{ name: '<b>Linus</b>', note: 'Reads "diffs"' }, { name: 'Ada' }]);
  assert.match(html, /<ul class="diners" aria-label="Diners">/);
  assert.match(html, /<b class="diner-name">&lt;b&gt;Linus&lt;\/b&gt;<\/b><span class="diner-note">Reads &quot;diffs&quot;<\/span><span class="diner-sub">Eating while their workflow cooks<\/span>/);
  assert.equal((html.match(/class="diner-tag"/g) || []).length, 2);
  assert.equal(renderDiners([]), '');
  const { dinerLayout, dinerPose, DINER_LOOPS } = await import(pathToFileURL(path.join(studio, 'js', 'kitchen.js')).href);
  assert.equal(dinerLayout(9).length, 6);
  const { dinerSeats, GENERIC_SEATS } = await import(pathToFileURL(path.join(studio, 'js', 'kitchen.js')).href);
  assert.equal(dinerSeats(2), GENERIC_SEATS, 'generic diners fill the empty chairs');
  assert.equal(dinerSeats(0), GENERIC_SEATS);
  assert.equal(dinerSeats(9), 6);
  assert.deepStrictEqual(dinerLayout(3).map((seat) => seat.loop), DINER_LOOPS);
  assert.notDeepStrictEqual(dinerLayout(3)[0].phase, dinerLayout(3)[1].phase, 'staggered timing');
  assert.deepStrictEqual(dinerPose('fork', 1.2, 0, { reducedMotion: true }), dinerPose('sip', 3, 0.5, { reducedMotion: true }), 'reduced motion is one static pose');
  assert.ok(dinerPose('fork', 0.7).armR < dinerPose('fork', 0).armR, 'the fork lifts');
  const css = fs.readFileSync(path.join(studio, 'styles.css'), 'utf8');
  assert.match(css, /\.diner-tag:focus-visible \.diner-card\{opacity:1/);
});
