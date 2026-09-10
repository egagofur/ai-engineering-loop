'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function runCli(root, args) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

test('CLI lists and validates built-in workflow recipes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-cli-recipe-'));
  const list = JSON.parse(runCli(root, ['recipe', 'list', '--json']));
  assert.equal(list.ok, true);
  assert.ok(list.recipes.some((recipe) => recipe.id === 'default' && recipe.source === 'builtin'));

  const validation = JSON.parse(runCli(root, [
    'recipe',
    'validate',
    'default',
    '--mode',
    'ASSISTED',
    '--json'
  ]));
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);
});

test('CLI explains, graphs, and simulates without executing workflow nodes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-cli-recipe-'));
  const explanation = JSON.parse(runCli(root, [
    'recipe',
    'explain',
    'default',
    '--mode',
    'UNATTENDED',
    '--json'
  ]));
  assert.equal(explanation.ok, true);
  assert.equal(explanation.plan.mode, 'UNATTENDED');
  assert.equal(explanation.plan.nodes.find((node) => node.id === 'maker').capabilities.repositoryMutation, true);

  const graph = JSON.parse(runCli(root, ['recipe', 'graph', 'audit', '--json']));
  assert.match(graph.mermaid, /^flowchart TD/);

  const simulation = JSON.parse(runCli(root, ['recipe', 'simulate', 'audit', '--json']));
  assert.equal(simulation.executionPerformed, false);
  assert.equal(simulation.capabilities.repositoryMutations, 0);
  assert.deepEqual(simulation.terminalNodes, ['report']);
});
