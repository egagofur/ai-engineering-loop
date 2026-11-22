'use strict';

// Turn a bug report into one red-repro Goal, then the normal loop.
// Connectors are read-only: `gh issue view` / `glab issue view` only.
// A pasted report uses the same draft (`outcome repro --file`).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { DOT_GITLAB_HOST, detectAdapter } = require('./adapter-detect.js');

const MAX_REPORT_BYTES = 256 * 1024;
const VIEW_FLAGS = new Set(['--json', '--output', '--repo']);
const WRITE_WORDS = new Set(['comment', 'create', 'close', 'update', 'edit', 'note', 'reopen', 'delete', 'lock', 'unlock', 'merge', 'pin', 'unpin']);
const RUNNERS = /^(?:npm|npx|pnpm|yarn|bun|node|deno|python3?|pytest|go|cargo|make|mvn|gradle|dotnet|rspec|bundle|php|composer|rails|mix|just|tox|jest|vitest|mocha)(?:\s|$)/;
const FILE_FIX = 'Paste the report into `.ai-engineering-loop/drafts/bug-report.md` (a title, `Actual: <what fails>`, and `Verify: <command>`), then run `ael outcome repro --file .ai-engineering-loop/drafts/bug-report.md`.';

function fail(message, code, fix, why = null) {
  return Object.assign(new Error(message), { code, fix, why: why || message });
}

function sentence(text, max = 240) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const first = flat.split(/(?<=[.!?])\s/)[0].trim();
  return first.length > max ? first.slice(0, max).trim() : first;
}

function looksLikeCommand(value) {
  const text = String(value || '').trim();
  if (!text || /[\r\n]/.test(text) || text.length > 300) return false;
  if (/^(?:\.\/|\/|bin\/)/.test(text)) return true;
  return RUNNERS.test(text);
}

function commandText(line) {
  let text = String(line || '').trim().replace(/^\$\s*/, '').replace(/^(?:[-*]|\d+[.)])\s+/, '');
  if (text.startsWith('`') && text.endsWith('`') && text.length > 2) text = text.slice(1, -1).trim();
  if (text.endsWith('.') && looksLikeCommand(text.slice(0, -1))) text = text.slice(0, -1);
  return text;
}

function asCommand(line) {
  const text = commandText(line);
  return looksLikeCommand(text) ? text : null;
}

function assertVerifyCommand(command) {
  const value = String(command || '').trim();
  if (!looksLikeCommand(value)) {
    throw fail('The red repro needs one local verify command.', 'REPRO_COMMAND_INVALID', 'Example: `Verify: npm test -- export.test.js`, or one ```bash fence with that command.');
  }
  if (/\b(?:gh|glab)\b/i.test(value)) {
    throw fail('The verify command must be a local test or driver, not gh or glab.', 'REPRO_COMMAND_INVALID', 'Use the command that fails today, for example `npm test -- export.test.js`.');
  }
  return value;
}

function labeled(text, name) {
  const match = String(text || '').match(new RegExp(`^${name}\\s*:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : null;
}

function sections(text) {
  const blocks = [];
  let current = { heading: '', body: [] };
  for (const line of String(text || '').split(/\r?\n/)) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (heading) {
      blocks.push(current);
      current = { heading: heading[1].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  blocks.push(current);
  return blocks;
}

function paragraphOf(lines) {
  const buf = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('```')) {
      if (buf.length) break;
      continue;
    }
    if (asCommand(trimmed)) continue;
    buf.push(trimmed.replace(/^(?:[-*]|\d+[.)])\s+/, ''));
  }
  return buf.join(' ');
}

function fencedCommand(text) {
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    const lang = match[1].trim().toLowerCase().split(/\s+/)[0];
    if (!['bash', 'sh', 'shell', 'console', 'zsh'].includes(lang)) continue;
    for (const line of match[2].split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const command = asCommand(line);
      if (command) return command;
    }
  }
  return null;
}

function commandUnderHeading(text) {
  for (const block of sections(text)) {
    if (!/repro|steps|verify|command|driver/i.test(block.heading)) continue;
    for (const line of block.body) {
      const command = asCommand(line);
      if (command) return command;
    }
  }
  return null;
}

function extractCommand(text) {
  for (const name of ['verify', 'driver', 'command']) {
    const value = labeled(text, name);
    if (!value) continue;
    const command = asCommand(value);
    if (!command) {
      throw fail(`\`${name}:\` must be the local command that fails today.`, 'REPRO_COMMAND_INVALID', 'Example: `Verify: npm test -- export.test.js`.');
    }
    return assertVerifyCommand(command);
  }
  const found = fencedCommand(text) || commandUnderHeading(text);
  return found ? assertVerifyCommand(found) : '';
}

function firstProse(text) {
  const stripped = String(text || '').replace(/```[\s\S]*?```/g, '');
  const buf = [];
  for (const line of stripped.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) {
      if (buf.length) break;
      continue;
    }
    if (/^(?:verify|driver|command|repro|actual|current|failure|fails|bug|observed|symptom|title|expected)\s*:/i.test(line)) continue;
    if (!line.trim()) {
      if (buf.length) break;
      continue;
    }
    if (asCommand(line)) continue;
    buf.push(line.trim().replace(/^(?:[-*]|\d+[.)])\s+/, ''));
  }
  return buf.join(' ');
}

function extractFailure(text) {
  for (const name of ['actual', 'current', 'failure', 'fails', 'bug', 'observed', 'symptom']) {
    const value = labeled(text, name);
    if (value && !asCommand(value)) return value;
  }
  for (const block of sections(text)) {
    if (!/actual|current|what happens|symptom|observed|failure|^bug\b/i.test(block.heading)) continue;
    const paragraph = paragraphOf(block.body);
    if (paragraph) return paragraph;
  }
  return firstProse(text);
}

function headingTitle(text) {
  for (const block of sections(text)) {
    if (!block.heading || /actual|expected|current|repro|steps|verify|command|driver|what happens|description|symptom|observed|failure|^bug\b/i.test(block.heading)) continue;
    return block.heading;
  }
  return '';
}

function parseReport(text, { title = '', source = 'file', ref = null } = {}) {
  const body = String(text || '').replace(/^\uFEFF/, '');
  const command = extractCommand(body);
  if (!command) {
    throw fail('The report has no verify command that fails today.', 'REPRO_COMMAND_MISSING', `Add \`Verify: <command>\` or one \`\`\`bash fence. ${FILE_FIX}`, 'A red-repro Goal names the command that is red now. AEL does not invent one.');
  }
  const resolvedTitle = sentence(title || labeled(body, 'title') || headingTitle(body), 120);
  const failing = sentence(extractFailure(body) || resolvedTitle);
  if (!resolvedTitle && !failing) {
    throw fail('The report has no title.', 'REPRO_TITLE_MISSING', 'Add a first line `# <bug title>`.', 'The Run task is the bug title.');
  }
  if (!failing) {
    throw fail('The report has no failing behavior.', 'REPRO_BEHAVIOR_MISSING', 'Add `Actual: <what fails today>`.', 'The Goal needs one concrete failure, not a sunny-path statement.');
  }
  return { title: (resolvedTitle || failing).replace(/[.]+$/, ''), failingBehavior: failing, command, source, ref };
}

function reproContract(runId, report) {
  const failing = sentence(report.failingBehavior);
  const command = assertVerifyCommand(report.command);
  const title = sentence(report.title, 120).replace(/[.]+$/, '');
  return {
    schemaVersion: 1,
    runId,
    objective: `Fix the reported failure: ${title}.`,
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'The verify command exits 0.',
      evidenceRequired: `red repro turns green: ${command}`,
      failureCases: [failing],
      verify: { command, layer: 'L2' }
    }],
    outOfScope: ['A change that leaves this red repro failing'],
    repro: {
      source: report.source,
      ref: report.ref,
      readOnly: true,
      command,
      failingBehavior: failing,
      title
    }
  };
}

function hostnameOf(url) {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

function safeProject(project) {
  const parts = String(project || '').split('/');
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('-'))) return null;
  return parts.join('/');
}

function parseIssueRef(input) {
  const text = String(input || '').trim();
  const hash = text.match(/^#(\d+)$/);
  if (hash) return { number: Number(hash[1]), url: null, host: null, project: null };
  let url;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (!url || !['http:', 'https:'].includes(url.protocol)) {
    throw fail('Pass an issue URL or #number.', 'INVALID_ISSUE_REF', 'ael run --from-issue https://github.com/owner/repo/issues/12', 'A #number uses the origin host. A URL names the host.');
  }
  const host = hostnameOf(url);
  if (host === 'github.com') {
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/);
    if (!match) {
      throw fail('That GitHub URL is not an issue.', 'INVALID_ISSUE_REF', 'Use https://github.com/<owner>/<repo>/issues/<n>, or paste the report with `ael outcome repro --file <path>`.');
    }
    const project = safeProject(`${match[1]}/${match[2]}`);
    if (!project) throw fail('That GitHub URL is not an issue.', 'INVALID_ISSUE_REF', FILE_FIX);
    return { host: 'github', number: Number(match[3]), url: url.href, project };
  }
  if (host === DOT_GITLAB_HOST || host.includes('gitlab')) {
    const match = url.pathname.match(/^(.*)\/-\/issues\/(\d+)\/?$/);
    const project = match ? safeProject(match[1].replace(/^\//, '')) : null;
    if (!match || !project) {
      throw fail('That GitLab URL is not an issue.', 'INVALID_ISSUE_REF', 'Use https://gitlab.com/<group>/<repo>/-/issues/<n>, or paste the report with `ael outcome repro --file <path>`.');
    }
    return { host: 'gitlab', number: Number(match[2]), url: url.href, project };
  }
  throw fail(`No read-only issue reader for ${host}.`, 'UNSUPPORTED_ISSUE_HOST', FILE_FIX, 'GitHub uses gh. GitLab uses glab. Anything else is a pasted report.');
}

function issueViewPlan(ref, host) {
  if (host === 'github') {
    return { bin: 'gh', args: ['issue', 'view', ref.url || String(ref.number), '--json', 'number,title,body,url,state'] };
  }
  if (host === 'gitlab') {
    const args = ['issue', 'view', String(ref.number), '--output', 'json'];
    if (ref.project) args.push('--repo', ref.project);
    return { bin: 'glab', args };
  }
  throw fail(`No read-only issue reader for ${host}.`, 'UNSUPPORTED_ISSUE_HOST', FILE_FIX);
}

function assertReadOnlyIssueView(plan) {
  const bin = plan && plan.bin;
  const args = plan && Array.isArray(plan.args) ? plan.args : [];
  if (!['gh', 'glab'].includes(bin) || args[0] !== 'issue' || args[1] !== 'view') {
    throw fail('Issue connectors are read-only: only `issue view` is allowed.', 'ISSUE_WRITE_REFUSED', 'AEL never comments on or edits the issue. Paste a report with `ael outcome repro --file <path>`.');
  }
  for (const arg of args) {
    const token = String(arg).toLowerCase();
    if (WRITE_WORDS.has(token) || (token.startsWith('-') && !VIEW_FLAGS.has(token))) {
      throw fail(`Refusing \`${arg}\` on an issue connector.`, 'ISSUE_WRITE_REFUSED', 'AEL never comments on or edits the issue.');
    }
  }
  return plan;
}

function hostForRef(rootDir, ref) {
  if (ref.host) return ref.host;
  const type = detectAdapter(rootDir).type;
  if (type === 'github') return 'github';
  if (type === 'gitlab' || type === 'dot') return 'gitlab';
  throw fail('This checkout has no GitHub or GitLab remote, so #n cannot be read.', 'ISSUE_HOST_UNKNOWN', 'Pass a full issue URL, or paste the report: `ael outcome repro --file <path>`.', 'A bare #number uses the origin host.');
}

function toolFailure(host, result) {
  const name = host === 'github' ? 'gh' : 'glab';
  if (result.reason === 'missing') {
    throw fail(`${name} is not installed, so the issue was not read.`, 'ISSUE_TOOL_MISSING', FILE_FIX, `${name} is the read-only connector for this host.`);
  }
  if (result.reason === 'auth') {
    throw fail(`${name} is not signed in, so the issue was not read.`, 'ISSUE_TOOL_AUTH', `${FILE_FIX} Or run \`${name} auth login\` and retry.`, 'The connector only reads. It does not log in for you.');
  }
  if (result.reason === 'not-found') {
    throw fail('No issue found for that reference.', 'ISSUE_NOT_FOUND', 'Check the URL or number, or paste the report and use `ael outcome repro --file <path>`.');
  }
  throw fail(`${name} could not read the issue: ${result.message || 'unknown error'}`, 'ISSUE_READ_FAILED', FILE_FIX);
}

function glabJson(args, cwd) {
  const custom = process.env.AEL_GLAB_BIN;
  const js = custom && /\.(c|m)?js$/.test(custom);
  const bin = js ? process.execPath : (custom || 'glab');
  const argv = js ? [custom, ...args] : args;
  const result = spawnSync(bin, argv, { cwd, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error?.code === 'ENOENT') return { ok: false, reason: 'missing', message: 'GitLab CLI (glab) is not installed' };
  if (result.status !== 0) {
    const text = `${result.stderr || ''}${result.stdout || ''}`.trim();
    const reason = /auth|not logged|401|403/i.test(text) ? 'auth' : /not found|404/i.test(text) ? 'not-found' : 'failed';
    return { ok: false, reason, message: text.split('\n')[0] || `glab exited ${result.status}` };
  }
  try {
    return { ok: true, value: JSON.parse(String(result.stdout || '').trim()) };
  } catch {
    return { ok: false, reason: 'failed', message: 'glab returned output that is not JSON' };
  }
}

function defaultRun(plan, rootDir) {
  assertReadOnlyIssueView(plan);
  if (plan.bin === 'gh') {
    const { ghJson } = require('./gh.js');
    return ghJson(plan.args, { cwd: rootDir });
  }
  return glabJson(plan.args, rootDir);
}

function normalizeIssue(host, value, ref) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail('The issue tool returned no issue.', 'ISSUE_READ_FAILED', FILE_FIX);
  }
  const title = String(value.title || '').trim();
  const body = String(host === 'github' ? (value.body || '') : (value.description || value.body || ''));
  const url = value.url || value.web_url || ref.url || null;
  const number = value.number || value.iid || ref.number || null;
  return parseReport(body, {
    title,
    source: host === 'github' ? 'github' : 'gitlab',
    ref: url || (number ? `#${number}` : null)
  });
}

function readIssue(rootDir, input, { run = defaultRun } = {}) {
  const ref = parseIssueRef(input);
  const host = hostForRef(rootDir, ref);
  const plan = assertReadOnlyIssueView(issueViewPlan(ref, host));
  const result = run(plan, rootDir);
  if (!result || !result.ok) toolFailure(host, result || { reason: 'failed', message: 'no result' });
  return normalizeIssue(host, result.value, ref);
}

function readReportFile(rootDir, fileName) {
  const file = path.resolve(rootDir, String(fileName || ''));
  const relative = path.relative(rootDir, file);
  if (!fileName || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw fail('The report file must stay inside the repository.', 'UNSAFE_REPORT_PATH', 'Copy it to `.ai-engineering-loop/drafts/bug-report.md` and pass that path.', 'Run files stay in the project. A path outside it is not read.');
  }
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw fail(`Report file not found: ${relative}`, 'REPORT_NOT_FOUND', `Create the file, then \`ael outcome repro --file ${relative.split(path.sep).join('/')}\`.`);
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > MAX_REPORT_BYTES) {
    throw fail('The report must be one regular file of at most 256KB.', 'INVALID_REPORT', FILE_FIX);
  }
  const ref = relative.split(path.sep).join('/');
  return parseReport(fs.readFileSync(file, 'utf8'), { source: 'file', ref });
}

function parseCliJson(stdout) {
  const text = String(stdout || '');
  const start = text.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

function reproSummary(report, extra) {
  return {
    drafted: false,
    revision: null,
    source: report.source,
    ref: report.ref,
    readOnly: true,
    command: report.command,
    failingBehavior: report.failingBehavior,
    ...extra
  };
}

// Writes the contract through `goal draft` (revision, goal.md, freeze question).
// Does not freeze. The Run stays on the normal loop.
function attachReproGoal(rootDir, runId, report) {
  const { loadRun } = require('./run-state.js');
  const { loadGoalDraft } = require('./goal-runtime.js');
  const run = loadRun(rootDir, runId);
  if (run.goal?.frozen) return reproSummary(report, { reason: 'frozen', revision: run.goal.version || null });
  const existing = loadGoalDraft(rootDir, runId);
  if (existing) return reproSummary(report, { reason: 'draft-exists', revision: existing.metadata.revision });
  const contract = reproContract(runId, report);
  const validation = require('./gates.js').validateGoalContract(contract);
  if (!validation.valid) {
    throw fail(`Red-repro Goal is invalid: ${validation.errors[0]}`, 'GATE_FAILED', FILE_FIX);
  }
  const relative = '.ai-engineering-loop/drafts/repro-goal.json';
  const absolute = path.join(rootDir, '.ai-engineering-loop', 'drafts', 'repro-goal.json');
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  fs.writeFileSync(absolute, `${JSON.stringify(contract, null, 2)}\n`, { mode: 0o600 });
  const cli = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');
  const result = spawnSync(process.execPath, [
    cli, 'goal', 'draft', '--json', '--run', runId, '--file', relative, '--revision', '0', '--by', 'agent'
  ], {
    cwd: rootDir,
    encoding: 'utf8',
    env: { ...process.env, AEL_NO_AUTO_UPDATE: '1' },
    maxBuffer: 8 * 1024 * 1024
  });
  const parsed = parseCliJson(result.stdout);
  if (result.status !== 0 || !parsed || parsed.ok === false) {
    const message = parsed?.error || String(result.stderr || result.stdout || 'goal draft failed').trim().split('\n').pop();
    throw fail(`goal draft failed: ${message}`, parsed?.code || 'GOAL_DRAFT_FAILED', parsed?.fix || `ael goal draft --run ${runId} --file ${relative} --revision 0`, parsed?.why || null);
  }
  return reproSummary(report, {
    drafted: true,
    revision: parsed.result?.metadata?.revision || 1,
    show: `goal show --run ${runId} --human`
  });
}

module.exports = {
  assertReadOnlyIssueView,
  attachReproGoal,
  issueViewPlan,
  parseIssueRef,
  parseReport,
  readIssue,
  readReportFile,
  reproContract
};
