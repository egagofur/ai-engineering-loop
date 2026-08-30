'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  HOST_MODEL_LIST_COMMANDS,
  parseGrokModelsOutput,
  codingInternModels,
  formatInternPickList,
  internInCatalog
} = require('../lib/intern-catalog.js');

const GROK_MODELS_FIXTURE = `You are logged in with grok.com.

Default model: grok-4.6

Available models:
  - grok-4.20-0309-non-reasoning
  - grok-4.20-0309-reasoning
  - grok-4.20-multi-agent-0309
  - grok-4.3
  - grok-4.5
  * grok-4.6 (default)
  - grok-build-0.1
  - grok-imagine-image
  - grok-imagine-image-2.0
  - grok-imagine-image-quality
  - grok-imagine-video
  - grok-imagine-video-1.5
`;

test('host list commands include grok models and /models', () => {
  assert.ok(HOST_MODEL_LIST_COMMANDS.includes('grok models'));
  assert.ok(HOST_MODEL_LIST_COMMANDS.includes('/models'));
});

test('AC-1 parse grok models into ids plus default', () => {
  const parsed = parseGrokModelsOutput(GROK_MODELS_FIXTURE);
  assert.strictEqual(parsed.defaultModel, 'grok-4.6');
  assert.ok(parsed.models.includes('grok-build-0.1'));
  assert.ok(parsed.models.includes('grok-4.6'));
});

test('AC-2 empty catalog pick list is only none', () => {
  assert.strictEqual(formatInternPickList([]), '0) none (Recommended)');
  assert.strictEqual(internInCatalog('none', []), true);
  assert.strictEqual(internInCatalog('', []), true);
});

test('AC-3 Claude has no grok catalog so only none is in-catalog', () => {
  assert.strictEqual(internInCatalog('gemini-flash', []), false);
  assert.strictEqual(internInCatalog('grok-build-0.1', []), false);
});

test('AC-4 imagine and video models are not coding intern picks', () => {
  const { models } = parseGrokModelsOutput(GROK_MODELS_FIXTURE);
  const coding = codingInternModels(models);
  assert.ok(coding.includes('grok-build-0.1'));
  assert.ok(!coding.includes('grok-imagine-image'));
  assert.ok(!coding.includes('grok-imagine-video'));
  const list = formatInternPickList(models);
  assert.match(list, /0\) none \(Recommended\)/);
  assert.match(list, /grok-build-0.1/);
  assert.doesNotMatch(list, /imagine/);
});

test('AC-5 unknown slug is not in catalog', () => {
  const { models } = parseGrokModelsOutput(GROK_MODELS_FIXTURE);
  assert.strictEqual(internInCatalog('grok-build-0.1', models), true);
  assert.strictEqual(internInCatalog('not-a-real-model', models), false);
  assert.strictEqual(internInCatalog('sk-abc', models), false);
});
