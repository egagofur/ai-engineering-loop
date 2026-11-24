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
  const { appAssets } = require('../lib/studio-server.js');
  assert.equal(appAssets().get('/diners.json'), 'diners.json');
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

test('diner names are a visually hidden list with the fixed subtitle and no hover card; the layout seats at most six', async () => {
  const { DINER_SUBTITLE } = await import(pathToFileURL(path.join(studio, 'js', 'ring2d.js')).href);
  assert.equal(DINER_SUBTITLE, 'Eating while their workflow cooks');
  const { renderComponent } = require('./helpers/svelte.js');
  const renderDiners = async (diners) => {
    const html = await renderComponent('components/Ring.svelte', { summary: { ring: [] }, diners, freeze: { source: null, phase: 'idle' } });
    const list = html.match(/<ul class="visually-hidden diners"[\s\S]*?<\/ul>/);
    return list ? list[0] : '';
  };
  const html = await renderDiners([{ name: '<b>Linus</b>', note: 'Reads "diffs"' }, { name: 'Ada' }]);
  assert.match(html, /<ul class="visually-hidden diners" aria-label="Diners, eating while their workflow cooks">/);
  assert.match(html, /<li>&lt;b>Linus&lt;\/b>, Reads "diffs"<\/li><li>Ada<\/li>/);
  assert.doesNotMatch(html, /button|diner-card/);
  assert.equal(await renderDiners([]), '');
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
  assert.doesNotMatch(css, /\.diner-(tag|card)/);
});

test('diners blink with the bot eye shape: closed mid-blink, open again after, still under reduced motion', async () => {
  const { blinkDiner } = await import(pathToFileURL(path.join(studio, 'js', 'diners.js')).href);
  const { BLINK_SECONDS, blinkOpenness } = await import(pathToFileURL(path.join(studio, 'js', 'bot.js')).href);
  assert.equal(blinkOpenness(-1), 1);
  assert.ok(blinkOpenness(BLINK_SECONDS / 2) < 0.05);
  assert.equal(blinkOpenness(BLINK_SECONDS), 1);
  const shapes = [];
  const figure = { open: 1, blinkAt: null, decals: [{ shape: (open) => shapes.push(open) }, { shape: () => {} }] };
  blinkDiner(figure, 0, false, () => 0);
  const start = figure.blinkAt;
  assert.ok(start > 0);
  assert.equal(blinkDiner(figure, start + BLINK_SECONDS / 2, false), true);
  assert.ok(figure.open < 0.05);
  blinkDiner(figure, start + BLINK_SECONDS + 0.01, false, () => 0);
  assert.equal(figure.open, 1);
  assert.ok(figure.blinkAt > start + BLINK_SECONDS);
  const still = { open: 1, blinkAt: null, decals: [] };
  assert.equal(blinkDiner(still, 5, true), false);
  assert.deepStrictEqual(shapes.slice(-1), [1]);
});
