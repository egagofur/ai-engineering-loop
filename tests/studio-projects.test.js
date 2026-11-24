'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { discoverProjects, resolveProject, resolveRoot, contextPath } = require('../lib/studio/projects.js');
const { projectId } = require('../lib/studio/instance.js');

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function makeRepo(parent, name) {
  const dir = path.join(parent, name);
  fs.mkdirSync(path.join(dir, '.ai-engineering-loop'), { recursive: true });
  return dir;
}

function writeProjects(home, paths) {
  fs.mkdirSync(path.join(home, '.ai-engineering-loop'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.ai-engineering-loop', 'projects.json'),
    JSON.stringify({ schemaVersion: 1, projects: paths.map((p) => ({ path: p })) })
  );
}

function writeWorktrees(repo, worktrees) {
  fs.writeFileSync(
    path.join(repo, '.ai-engineering-loop', 'worktrees.json'),
    JSON.stringify({ schemaVersion: 1, worktrees })
  );
}

test('two repos and a deleted path give three projects, the deleted one missing', () => {
  const home = tempDir('ael-proj-home-');
  const work = tempDir('ael-proj-work-');
  const a = makeRepo(work, 'a');
  const b = makeRepo(work, 'b');
  const gone = path.join(work, 'gone');
  writeProjects(home, [a, b, gone]);
  const projects = discoverProjects({ home });
  assert.equal(projects.length, 3);
  const byPath = Object.fromEntries(projects.map((p) => [p.path, p]));
  assert.equal(byPath[a].missing, false);
  assert.equal(byPath[gone].missing, true);
  assert.equal(byPath[a].id, projectId(a));
  assert.match(byPath[gone].id, /^[0-9a-f]{12}$/);
  assert.equal(byPath[a].name, `${path.basename(work)}/a`);
});

test('a registry entry listed as a worktree of another project is folded under it', () => {
  const home = tempDir('ael-proj-home-');
  const work = tempDir('ael-proj-work-');
  const main = makeRepo(work, 'main');
  const wt = makeRepo(work, 'wt');
  writeWorktrees(main, [{ runId: 'run-1', path: wt, branch: 'ael/x', base: 'main', task: 't', state: 'active' }]);
  writeProjects(home, [main, wt]);
  const projects = discoverProjects({ home });
  assert.equal(projects.length, 1);
  assert.deepEqual(projects[0].worktrees, [{ id: projectId(wt), path: wt, branch: 'ael/x', runId: 'run-1' }]);
});

test('contextPath stays under the context directory and rejects escapes', () => {
  const root = tempDir('ael-proj-root-');
  fs.mkdirSync(path.join(root, '.ai-engineering-loop', 'runs'), { recursive: true });
  assert.equal(contextPath(root, 'runs'), path.join(root, '.ai-engineering-loop', 'runs'));
  assert.throws(() => contextPath(root, '..', '..', 'etc'), (e) => e.code === 'PATH_OUTSIDE_SCOPE' && Boolean(e.why) && Boolean(e.fix));
});

test('contextPath rejects a symlink that escapes the context directory', () => {
  const root = tempDir('ael-proj-root-');
  const outside = tempDir('ael-proj-outside-');
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, '.ai-engineering-loop', 'link'));
  assert.throws(() => contextPath(root, 'link', 'secret.txt'), (e) => e.code === 'PATH_OUTSIDE_SCOPE');
});

test('resolveProject returns null for an unknown id and the project for a known one', () => {
  const home = tempDir('ael-proj-home-');
  const work = tempDir('ael-proj-work-');
  const a = makeRepo(work, 'a');
  writeProjects(home, [a]);
  const projects = discoverProjects({ home });
  assert.equal(resolveProject(projects, 'deadbeef0000'), null);
  assert.equal(resolveProject(projects, projectId(a)), projects[0]);
});

test('contextPath rejects a dangling symlink pointing outside', () => {
  const root = tempDir('ael-proj-root-');
  const outside = tempDir('ael-proj-outside-');
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  fs.symlinkSync(path.join(outside, 'does-not-exist'), path.join(root, '.ai-engineering-loop', 'link'));
  assert.throws(() => contextPath(root, 'link'), (e) => e.code === 'PATH_OUTSIDE_SCOPE');
});

test('contextPath rejects a context directory that is itself a symlink elsewhere', () => {
  const root = tempDir('ael-proj-root-');
  const outside = tempDir('ael-proj-outside-');
  fs.symlinkSync(outside, path.join(root, '.ai-engineering-loop'));
  assert.throws(() => contextPath(root, 'runs'), (e) => e.code === 'PATH_OUTSIDE_SCOPE');
});

test('resolveRoot resolves project ids, worktree ids and unknown ids', () => {
  const home = tempDir('ael-proj-home-');
  const work = tempDir('ael-proj-work-');
  const main = makeRepo(work, 'main');
  const wt = makeRepo(work, 'wt');
  writeWorktrees(main, [{ runId: 'run-1', path: wt, branch: 'ael/x' }]);
  writeProjects(home, [main, wt]);
  const projects = discoverProjects({ home });
  const project = projects[0];
  assert.deepEqual(resolveRoot(projects, projectId(main)), { project, root: main, worktree: null });
  const hit = resolveRoot(projects, projectId(wt));
  assert.equal(hit.project, project);
  assert.equal(hit.root, wt);
  assert.equal(hit.worktree.runId, 'run-1');
  assert.equal(resolveRoot(projects, 'deadbeef0000'), null);
});
