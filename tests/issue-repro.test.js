'use strict';

// Red-repro intake: `run --from-issue` and `outcome repro --file`.
// Connectors are read-only. The Goal is one failing behavior plus the
// verify command, then the normal loop (the Goal is drafted, not frozen).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { unknownWriterArgs } = require('../lib/cli-args.js');
const { validateGoalContract } = require('../lib/gates.js');
const {
  assertReadOnlyIssueView,
  issueViewPlan,
  parseIssueRef,
  parseReport,
  readIssue,
  readReportFile,
  reproContract
} = require('../lib/issue-repro.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');
const FAKE = path.join(__dirname, 'fixtures', 'fake-issue-cli.js');

function gitRepo(remote) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-repro-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  return dir;
}

test('issue refs parse to a host, and write plans are refused', () => {
  assert.deepStrictEqual(parseIssueRef('#12'), { number: 12, url: null, host: null, project: null });
  const github = parseIssueRef('https://github.com/acme/app/issues/12');
  assert.strictEqual(github.host, 'github');
  assert.strictEqual(github.number, 12);
  assert.strictEqual(github.project, 'acme/app');
  const gitlab = parseIssueRef('https://gitlab.com/acme/group/app/-/issues/4');
  assert.strictEqual(gitlab.host, 'gitlab');
  assert.strictEqual(gitlab.project, 'acme/group/app');
  assert.throws(() => parseIssueRef('https://github.com/acme/app/pull/3'), (err) => err.code === 'INVALID_ISSUE_REF');
  assert.throws(() => parseIssueRef('https://example.com/a/b/issues/1'), (err) => err.code === 'UNSUPPORTED_ISSUE_HOST');
  assert.throws(() => parseIssueRef('not a ref'), (err) => err.code === 'INVALID_ISSUE_REF');

  const ghPlan = issueViewPlan(github, 'github');
  const glPlan = issueViewPlan(gitlab, 'gitlab');
  assert.deepStrictEqual(ghPlan, { bin: 'gh', args: ['issue', 'view', github.url, '--json', 'number,title,body,url,state'] });
  assert.deepStrictEqual(glPlan.args, ['issue', 'view', '4', '--output', 'json', '--repo', 'acme/group/app']);
  assert.doesNotThrow(() => assertReadOnlyIssueView(ghPlan));
  assert.doesNotThrow(() => assertReadOnlyIssueView(glPlan));
  for (const plan of [ghPlan, glPlan]) {
    assert.ok(!plan.args.some((arg) => /comment|create|close|update|note|edit/i.test(arg)));
  }
  assert.throws(() => assertReadOnlyIssueView({ bin: 'gh', args: ['issue', 'comment', '1', '--body', 'hi'] }), (err) => err.code === 'ISSUE_WRITE_REFUSED');
  assert.throws(() => assertReadOnlyIssueView({ bin: 'glab', args: ['issue', 'view', '1', '--comments'] }), (err) => err.code === 'ISSUE_WRITE_REFUSED');
  assert.deepStrictEqual(unknownWriterArgs('outcome', ['repro', '--file', 'bug.md', '--json']), []);
  assert.ok(unknownWriterArgs('outcome', ['repro', '--comment', 'hi']).includes('--comment'));
});

test('a report becomes one red-repro acceptance criterion', () => {
  const report = parseReport([
    '# Export ignores the active filter',
    '',
    'Actual: The CSV contains rows the filter hid.',
    '',
    '```bash',
    'npm test -- export.test.js',
    '```',
    ''
  ].join('\n'), { source: 'file', ref: '.ai-engineering-loop/drafts/bug.md' });
  assert.strictEqual(report.command, 'npm test -- export.test.js');
  assert.strictEqual(report.failingBehavior, 'The CSV contains rows the filter hid.');
  assert.strictEqual(report.title, 'Export ignores the active filter');
  const contract = reproContract('run-1', report);
  assert.strictEqual(validateGoalContract(contract).valid, true, validateGoalContract(contract).errors.join('; '));
  assert.strictEqual(contract.acceptanceCriteria.length, 1);
  assert.strictEqual(contract.acceptanceCriteria[0].verify.command, report.command);
  assert.deepStrictEqual(contract.acceptanceCriteria[0].failureCases, [report.failingBehavior]);
  assert.strictEqual(contract.repro.readOnly, true);
  assert.throws(() => parseReport('# Title only\n\nNo command here.\n'), (err) => err.code === 'REPRO_COMMAND_MISSING' && !/issue comment/.test(err.fix));
  assert.throws(() => parseReport('Verify: gh issue comment 1 --body hi\nActual: broken\n# Bug\n'), (err) => err.code === 'REPRO_COMMAND_INVALID');

  const calls = [];
  const fromGitlab = readIssue(os.tmpdir(), 'https://gitlab.com/acme/group/app/-/issues/4', {
    run(plan) {
      calls.push(plan);
      return {
        ok: true,
        value: {
          iid: 4,
          title: 'Save drops the last row',
          description: 'Actual: The last row disappears.\n\n```bash\npytest tests/test_save.py\n```\n',
          web_url: 'https://gitlab.com/acme/group/app/-/issues/4'
        }
      };
    }
  });
  assert.strictEqual(calls[0].bin, 'glab');
  assert.ok(!calls[0].args.includes('comment'));
  assert.strictEqual(fromGitlab.command, 'pytest tests/test_save.py');
  assert.match(fromGitlab.failingBehavior, /last row disappears/);

  const githubRepo = gitRepo('git@github.com:acme/app.git');
  const viewed = [];
  const fromHash = readIssue(githubRepo, '#12', {
    run(plan) {
      viewed.push(plan);
      return {
        ok: true,
        value: {
          number: 12,
          title: 'Export ignores the active filter',
          body: 'Verify: node tools/export-test.js\nActual: The CSV contains rows the filter hid.\n',
          url: 'https://github.com/acme/app/issues/12'
        }
      };
    }
  });
  assert.deepStrictEqual(viewed, [{ bin: 'gh', args: ['issue', 'view', '12', '--json', 'number,title,body,url,state'] }]);
  assert.strictEqual(fromHash.source, 'github');
  assert.strictEqual(fromHash.command, 'node tools/export-test.js');
  assert.throws(() => readIssue(gitRepo(), '#3', { run: () => ({ ok: true, value: {} }) }), (err) => err.code === 'ISSUE_HOST_UNKNOWN');
  assert.throws(() => readIssue(githubRepo, '#3', { run: () => ({ ok: false, reason: 'missing', message: 'no gh' }) }), (err) => err.code === 'ISSUE_TOOL_MISSING' && /outcome repro --file/.test(err.fix));
});

test('a pasted report file stays inside the repository', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-repro-file-'));
  const drafts = path.join(root, '.ai-engineering-loop', 'drafts');
  fs.mkdirSync(drafts, { recursive: true });
  const relative = path.join('.ai-engineering-loop', 'drafts', 'bug-report.md');
  fs.writeFileSync(path.join(root, relative), '# Export ignores the active filter\n\nActual: The CSV contains rows the filter hid.\n\nVerify: node tools/export-test.js\n');
  const report = readReportFile(root, relative);
  assert.strictEqual(report.source, 'file');
  assert.strictEqual(report.ref, '.ai-engineering-loop/drafts/bug-report.md');
  assert.strictEqual(report.command, 'node tools/export-test.js');
  const outside = path.join(os.tmpdir(), `ael-outside-${process.pid}.md`);
  fs.writeFileSync(outside, '# x\nVerify: node ok.js\n');
  assert.throws(() => readReportFile(root, outside), (err) => err.code === 'UNSAFE_REPORT_PATH');
  const link = path.join(drafts, 'link.md');
  fs.symlinkSync(path.join(root, relative), link);
  assert.throws(() => readReportFile(root, path.join('.ai-engineering-loop', 'drafts', 'link.md')), (err) => err.code === 'INVALID_REPORT');
});

function project(remote) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-repro-home-'));
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-repro-cli-')));
  const log = path.join(repo, 'issue-log.txt');
  const bodyFile = path.join(repo, 'issue.json');
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    AEL_HOME: home,
    AEL_NO_SETUP_HINT: '1',
    AEL_NO_AUTO_UPDATE: '1',
    AEL_GH_BIN: FAKE,
    AEL_GLAB_BIN: FAKE,
    AEL_ISSUE_LOG: log,
    AEL_ISSUE_BODY_FILE: bodyFile
  };
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.js'), 'module.exports = 1;\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  if (remote) git('remote', 'add', 'origin', remote);
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0, 'init');
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx');
  fs.writeFileSync(log, '');
  return { repo, env, cli, log, bodyFile };
}

const jsonOf = (result) => {
  const start = String(result.stdout || '').indexOf('{');
  assert.ok(start !== -1, result.stderr || result.stdout);
  return JSON.parse(result.stdout.slice(start));
};

const callsOf = (log) => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

test('run --from-issue drafts one red repro and does not freeze or write the issue', () => {
  const ctx = project('git@github.com:acme/app.git');
  fs.writeFileSync(ctx.bodyFile, `${JSON.stringify({
    number: 12,
    title: 'Export ignores the active filter',
    body: 'Actual: The CSV contains rows the filter hid.\n\nVerify: node tools/export-test.js\n',
    url: 'https://github.com/acme/app/issues/12',
    state: 'OPEN'
  })}\n`);
  const started = ctx.cli('run', '--from-issue', '#12', '--json');
  const body = jsonOf(started);
  assert.strictEqual(started.status, 0, started.stdout || started.stderr);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.state, 'STARTED');
  assert.strictEqual(body.resumed, false);
  assert.strictEqual(body.repro.readOnly, true);
  assert.strictEqual(body.repro.drafted, true);
  assert.strictEqual(body.repro.command, 'node tools/export-test.js');
  assert.match(body.repro.failingBehavior, /CSV contains rows the filter hid/);
  const runDir = path.join(ctx.repo, '.ai-engineering-loop', 'runs', body.runId);
  const draft = JSON.parse(fs.readFileSync(path.join(runDir, 'goal-draft.json'), 'utf8'));
  assert.strictEqual(draft.contract.acceptanceCriteria.length, 1);
  assert.strictEqual(draft.contract.acceptanceCriteria[0].verify.command, 'node tools/export-test.js');
  assert.match(draft.contract.acceptanceCriteria[0].failureCases[0], /CSV contains rows/);
  assert.strictEqual(draft.contract.repro.readOnly, true);
  assert.ok(fs.existsSync(path.join(runDir, 'goal.md')));
  assert.ok(!fs.existsSync(path.join(runDir, 'goal-contract.json')), 'the Goal stays a draft; the loop is not skipped');
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  assert.strictEqual(state.state, 'STARTED');
  assert.notStrictEqual(state.goal && state.goal.frozen, true);
  const calls = callsOf(ctx.log);
  assert.ok(calls.length >= 1);
  for (const args of calls) {
    assert.strictEqual(args[0], 'issue');
    assert.strictEqual(args[1], 'view');
    assert.ok(!args.some((arg) => /comment|create|close|update|note/i.test(arg)));
  }
  const again = jsonOf(ctx.cli('run', '--from-issue', '#12', '--json'));
  assert.strictEqual(again.runId, body.runId);
  assert.strictEqual(again.resumed, true);
  assert.strictEqual(again.repro.drafted, false);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(runDir, 'goal-draft.json'), 'utf8')).metadata.revision, 1);
});

test('outcome repro --file drafts the same Goal and does not call gh or glab', () => {
  const ctx = project();
  const report = path.join('.ai-engineering-loop', 'drafts', 'bug-report.md');
  fs.mkdirSync(path.join(ctx.repo, '.ai-engineering-loop', 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(ctx.repo, report), '# Export ignores the active filter\n\n## Actual behavior\n\nThe CSV contains rows the filter hid.\n\n## Repro\n\n```bash\nnpm test -- export.test.js\n```\n');
  const started = ctx.cli('outcome', 'repro', '--file', report, '--json');
  const body = jsonOf(started);
  assert.strictEqual(started.status, 0, started.stdout || started.stderr);
  assert.strictEqual(body.repro.source, 'file');
  assert.strictEqual(body.repro.command, 'npm test -- export.test.js');
  assert.strictEqual(body.state, 'STARTED');
  const draft = JSON.parse(fs.readFileSync(path.join(ctx.repo, '.ai-engineering-loop', 'runs', body.runId, 'goal-draft.json'), 'utf8'));
  assert.strictEqual(draft.contract.acceptanceCriteria.length, 1);
  assert.strictEqual(draft.contract.acceptanceCriteria[0].verify.command, 'npm test -- export.test.js');
  assert.strictEqual(callsOf(ctx.log).length, 0);
  const help = ctx.cli('help', 'outcome');
  assert.match(help.stdout, /repro --file/);
  assert.match(ctx.cli('help', 'run').stdout, /--from-issue/);
});

test('a report with no command does not start a Run, and a missing gh points at the file', () => {
  const ctx = project('git@github.com:acme/app.git');
  const report = path.join('.ai-engineering-loop', 'drafts', 'notes.md');
  fs.mkdirSync(path.dirname(path.join(ctx.repo, report)), { recursive: true });
  fs.writeFileSync(path.join(ctx.repo, report), '# Something broke\n\nNo command in this note.\n');
  const missing = ctx.cli('outcome', 'repro', '--file', report, '--json');
  const missingBody = jsonOf(missing);
  assert.notStrictEqual(missing.status, 0);
  assert.strictEqual(missingBody.code, 'REPRO_COMMAND_MISSING');
  assert.match(missingBody.fix, /Verify:/);
  assert.ok(!fs.existsSync(path.join(ctx.repo, '.ai-engineering-loop', 'runs', 'current.json')));

  ctx.env.AEL_GH_BIN = path.join(ctx.repo, 'missing-gh');
  const unread = spawnSync(process.execPath, [CLI, 'run', '--from-issue', '#4', '--json'], { cwd: ctx.repo, env: ctx.env, encoding: 'utf8' });
  const unreadBody = jsonOf(unread);
  assert.notStrictEqual(unread.status, 0);
  assert.strictEqual(unreadBody.code, 'ISSUE_TOOL_MISSING');
  assert.match(unreadBody.fix, /outcome repro --file/);
  assert.ok(!fs.existsSync(path.join(ctx.repo, '.ai-engineering-loop', 'runs', 'current.json')));
});

test('a GitLab #n is read with glab issue view and gh is not called', () => {
  const ctx = project('https://gitlab.com/acme/app.git');
  const touched = path.join(ctx.repo, 'gh-touched');
  const gh = path.join(ctx.repo, 'no-gh.js');
  fs.writeFileSync(gh, `require('fs').writeFileSync(process.env.AEL_GH_TOUCHED, 'called');\nprocess.exit(9);\n`);
  ctx.env.AEL_GH_BIN = gh;
  ctx.env.AEL_GH_TOUCHED = touched;
  fs.writeFileSync(ctx.bodyFile, `${JSON.stringify({
    iid: 7,
    title: 'Save drops the last row',
    description: 'Actual: The last row disappears.\n\nVerify: pytest tests/test_save.py\n',
    web_url: 'https://gitlab.com/acme/app/-/issues/7'
  })}\n`);
  const started = spawnSync(process.execPath, [CLI, 'run', '--from-issue', '#7', '--json'], { cwd: ctx.repo, env: ctx.env, encoding: 'utf8' });
  const body = jsonOf(started);
  assert.strictEqual(started.status, 0, started.stdout || started.stderr);
  assert.strictEqual(body.repro.command, 'pytest tests/test_save.py');
  assert.strictEqual(body.repro.source, 'gitlab');
  assert.deepStrictEqual(callsOf(ctx.log), [['issue', 'view', '7', '--output', 'json']]);
  assert.ok(!fs.existsSync(touched));
});
