'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function runCli(root, args, env = {}) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
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

test('CLI run binds a recipe snapshot and node status reads its scheduler state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-cli-recipe-run-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-cli-home-'));
  runCli(root, ['init'], { AEL_HOME: home });
  const output = runCli(root, ['run', '--recipe', 'audit', 'audit this repository'], { AEL_HOME: home });
  assert.match(output, /Recipe: audit/);
  assert.match(output, /Mode: REPORT_ONLY/);
  const status = JSON.parse(runCli(root, ['node', 'status', '--json'], { AEL_HOME: home }));
  assert.equal(status.recipe.id, 'audit');
  assert.equal(status.nodes.find((node) => node.id === 'goal').status, 'READY');
  const runDirectory = path.join(root, '.ai-engineering-loop', 'runs', status.runId);
  assert.equal(fs.existsSync(path.join(runDirectory, 'plan.json')), true);
  assert.equal(fs.existsSync(path.join(runDirectory, 'events.jsonl')), true);
});

test('CLI run automatically binds a Studio-visible workflow when no recipe is specified', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-cli-default-run-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-cli-home-'));
  runCli(root, ['init'], { AEL_HOME: home });

  const assisted = runCli(root, ['run', 'build a searchable settings page'], { AEL_HOME: home });
  assert.match(assisted, /Recipe: default/);
  let status = JSON.parse(runCli(root, ['node', 'status', '--json'], { AEL_HOME: home }));
  assert.equal(status.recipe.id, 'default');

  const reportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-cli-report-run-'));
  runCli(reportRoot, ['init'], { AEL_HOME: home });
  const report = runCli(reportRoot, [
    'run',
    '--mode',
    'report-only',
    'audit this repository'
  ], { AEL_HOME: home });
  assert.match(report, /Recipe: audit/);
  status = JSON.parse(runCli(reportRoot, ['node', 'status', '--json'], { AEL_HOME: home }));
  assert.equal(status.recipe.id, 'audit');
});

test('CLI scaffolds and inspects a project recipe for AI authoring', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-cli-builder-'));
  const created = JSON.parse(runCli(root, [
    'recipe',
    'create',
    'project-audit',
    '--from',
    'audit',
    '--json'
  ]));
  assert.equal(created.recipe.id, 'project-audit');
  assert.equal(created.path, '.ai-engineering-loop/recipes/project-audit.json');
  const inspection = JSON.parse(runCli(root, ['recipe', 'inspect', 'project-audit', '--json']));
  assert.equal(inspection.source, 'project');
  assert.equal(inspection.modes[0].mode, 'REPORT_ONLY');
  const difference = JSON.parse(runCli(root, ['recipe', 'diff', 'audit', 'project-audit', '--json']));
  assert.equal(difference.metadataChanged, true);
});
