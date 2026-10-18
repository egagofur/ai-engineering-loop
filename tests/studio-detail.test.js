'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createStudioServer } = require('../lib/studio-server.js');
const { studioContext, waitFor } = require('./helpers/studio-dom.js');

async function withApp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-detail-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements } = studioContext(base, instance.token);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => vm.runInContext('validationState.status', context) === 'valid');
    await fn({ elements, run: (code) => vm.runInContext(code, context) });
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
}

test('times read as relative dates with an exact tooltip and never as Nm ago', async () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8');
  assert.equal(app.includes('m ago'), false);
  assert.equal(app.includes('No artifact'), false);
  await withApp(({ run }) => {
    const samples = run(`(() => {
      const now = new Date(2026, 9, 18, 12, 0, 0).getTime();
      const at = (days, hours, minutes, seconds = 0) => new Date(2026, 9, 18 - days, hours, minutes, seconds).toISOString();
      return {
        justNow: humanizeTime(new Date(now - 1000).toISOString(), now),
        fourSeconds: humanizeTime(new Date(now - 4000).toISOString(), now),
        fourteenSeconds: humanizeTime(new Date(now - 14000).toISOString(), now),
        fiveMinutes: humanizeTime(new Date(now - 5 * 60000).toISOString(), now),
        threeHours: humanizeTime(new Date(now - 3 * 3600000).toISOString(), now),
        yesterday: humanizeTime(at(1, 15, 41, 56), now),
        twoDays: humanizeTime(at(2, 15, 41, 56), now),
        eightDays: humanizeTime(at(8, 15, 41, 0), now),
        lastYear: humanizeTime(new Date(2025, 9, 16, 15, 41, 0).toISOString(), now),
        stale: heartbeatAge(new Date(now - 2753 * 60000).toISOString(), now),
        missing: heartbeatAge(''),
        hour: formatDuration(64 * 60 * 1000),
        minutes: formatDuration(2 * 60 * 1000 + 20 * 1000),
        twelve: formatDuration(12 * 60 * 1000),
        zero: formatDuration(0),
        tag: timeTag(at(2, 15, 41, 56), now)
      };
    })()`);
    assert.equal(samples.justNow, 'just now');
    assert.equal(samples.fourSeconds, 'just now');
    assert.equal(samples.fourteenSeconds, '14s ago');
    assert.equal(samples.fiveMinutes, '5 min ago');
    assert.equal(samples.threeHours, '3 h ago');
    assert.equal(samples.yesterday, 'yesterday · Oct 17, 15:41');
    assert.equal(samples.twoDays, '2 days ago · Oct 16, 15:41');
    assert.equal(samples.eightDays.includes('ago'), false);
    assert.equal(samples.eightDays, 'Oct 10, 15:41');
    assert.equal(samples.lastYear, 'Oct 16, 2025, 15:41');
    assert.doesNotMatch(samples.stale, /\d+m ago/);
    assert.match(samples.stale, /Oct /);
    assert.equal(samples.missing, 'no heartbeat');
    assert.equal(samples.hour, '1h 04m');
    assert.equal(samples.minutes, '2m 20s');
    assert.equal(samples.twelve, '12m 00s');
    assert.equal(samples.zero, '');
    assert.match(samples.tag, /<time datetime="[^"]+" title="[^"]*2026[^"]*15:41:56/);
    assert.equal(samples.tag.includes('style='), false);
  });
});

test('node panel shows a summary, labeled chips, and a grouped node timeline', async () => {
  await withApp(({ elements, run }) => {
    const panel = elements.get('node-panel');
    run(`(() => {
      panelNodeId = 'verification';
      panelTab = 'output';
      panelView = {
        status: 'ready',
        io: {
          durationMs: 140000,
          finishedAt: '2026-10-16T08:27:00.000Z',
          output: {
            status: 'PASSED',
            summary: 'npm test · 3 passed, 0 failed.',
            loopGroupId: 'engineering-loop',
            loopIteration: 1
          },
          nodeEvidence: {
            status: 'present',
            summary: 'npm test · 3 passed, 0 failed.',
            count: 2,
            cards: [{
              id: 'verification',
              title: 'VERIFICATION · 1 COMMANDS',
              lines: [{ label: 'npm test', value: '3 passed · 0 failed', detail: 'exit 0', durationMs: 48000 }],
              note: 'output sha256 recorded'
            }],
            files: [{ name: 'verification.json', path: 'verification.json', state: 'verified' }]
          },
          timelineGroups: [{
            id: 'iteration-1',
            iteration: 1,
            attempt: 1,
            label: 'Iteration 1',
            events: [{ at: '2026-10-16T08:27:00.000Z', type: 'GATE_PASSED', label: 'Verification gate passed' }]
          }]
        }
      };
      renderNodePanel();
    })()`);
    assert.match(panel.innerHTML, />Overview</);
    assert.match(panel.innerHTML, />Output</);
    assert.match(panel.innerHTML, />Evidence<span class="tab-count">2<\/span></);
    assert.match(panel.innerHTML, />Timeline</);
    assert.match(panel.innerHTML, /npm test · 3 passed, 0 failed\./);
    assert.match(panel.innerHTML, /Duration/);
    assert.match(panel.innerHTML, /2m 20s/);
    assert.match(panel.innerHTML, /engineering-loop · 1\/3/);
    assert.match(panel.innerHTML, /Stage 05 · verification · default v2/);
    assert.equal(panel.innerHTML.includes('No artifact'), false);
    assert.equal(panel.innerHTML.includes('<ol'), false);
    run(`panelTab = 'timeline'; renderNodePanel()`);
    assert.match(panel.innerHTML, /Iteration 1/);
    assert.match(panel.innerHTML, /Verification gate passed/);
    assert.match(panel.innerHTML, /<ul class="panel-timeline">/);
    assert.match(panel.innerHTML, /<time /);
    assert.match(panel.innerHTML, /title="/);
    assert.equal(panel.innerHTML.includes('GATE_PASSED'), false);
    assert.equal(panel.innerHTML.includes('WORKFLOW_CREATED'), false);
    run(`panelTab = 'evidence'; renderNodePanel()`);
    assert.match(panel.innerHTML, /VERIFICATION · 1 COMMANDS/);
    assert.match(panel.innerHTML, /data-artifact-path="verification.json"/);
    assert.match(panel.innerHTML, /48s/);
  });
});

test('live meta is labeled chips and unknown tokens are not zero', async () => {
  await withApp(({ elements, run }) => {
    run(`catalog.live = {
      run: { displayName: 'Pagination', state: 'DELIVERED', iteration: 1, mode: 'ASSISTED', tier: { current: 'CHEAP_MODEL' } },
      presence: { lastHeartbeatAt: '2026-10-16T08:41:56.000Z' },
      budget: { spentThisRun: 0, perRunTokenLimit: 1000 },
      artifacts: { 'artifact.guard': { warn: 1, block: 0 }, 'artifact.drift': { outOfMapCount: 0 } },
      journey: { steps: [], degradedSources: [] },
      nodes: {}
    }; renderLive()`);
    const meta = elements.get('live-meta').innerHTML;
    assert.match(meta, />Tier</);
    assert.match(meta, /CHEAP_MODEL/);
    assert.match(meta, />Iteration</);
    assert.match(meta, />1</);
    assert.match(meta, />Tokens</);
    assert.match(meta, /unknown \/ 1000/);
    assert.match(meta, /host reports no usage/);
    assert.match(meta, /1 warn · 0 block/);
    assert.match(meta, />Drift</);
    assert.match(meta, />none</);
    assert.match(meta, /no receipt: run predates receipts/);
    assert.equal(meta.includes('0 / 1000 tokens'), false);
    const summary = elements.get('run-summary').innerHTML;
    assert.match(summary, /<time /);
    assert.match(summary, /title="/);
    assert.doesNotMatch(summary, /\d+m ago/);
    run(`catalog.live.run.state = 'RUNNING'; renderLive()`);
    assert.match(elements.get('live-meta').innerHTML, /receipt pending/);
  });
});

test('live tab shows the rail, current step, questions, and grouped timeline', async () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8');
  assert.match(app, /fetch\(`\/api\/events/);
  assert.match(app, /scheduleLiveRender\(/);
  assert.equal(app.includes('setInterval'), false);
  await withApp(async ({ elements, run }) => {
    const view = run(`(() => {
      const now = Date.now();
      const iso = (delta) => new Date(now + delta).toISOString();
      catalog.live = {
        run: {
          runId: 'run-91',
          displayName: 'Pagination',
          state: 'RUNNING',
          iteration: 2,
          mode: 'ASSISTED',
          tier: { current: 'CHEAP_MODEL' },
          createdAt: iso(-10 * 60000)
        },
        presence: { lastHeartbeatAt: iso(-4000) },
        budget: { spentThisRun: 0, perRunTokenLimit: 1000 },
        artifacts: {
          'artifact.guard': { warn: 1, block: 0 },
          'artifact.drift': { outOfMapCount: 0 },
          'artifact.findings': { count: 2, blocking: 1 },
          'artifact.verification': { failed: 0, commandCount: 3 }
        },
        journey: {
          steps: [{ id: 'review', status: 'active' }],
          degradedSources: ['lifecycle'],
          pendingQuestions: 1
        },
        interactions: { pending: [{ questionId: 'q1', number: 1, actor: 'agent', message: 'Which page size?' }] },
        plan: { nodes: draft.nodes, edges: draft.edges },
        loopGroups: { 'engineering-loop': { iteration: 2 } },
        nodes: {
          goal: { status: 'PASSED', updatedAt: iso(-9 * 60000) },
          maker: { status: 'PASSED', updatedAt: iso(-5 * 60000) },
          verification: { status: 'PASSED', updatedAt: iso(-2 * 60000) },
          review: { status: 'RUNNING', updatedAt: iso(-60000), activity: 'Reading the diff' }
        },
        events: [
          { at: iso(-9 * 60000), type: 'GATE_PASSED', gate: 'goal', nodeId: 'goal' },
          { at: iso(-2 * 60000), type: 'GATE_PASSED', gate: 'verification', nodeId: 'verification' }
        ]
      };
      renderLive();
      return {
        rail: document.getElementById('stage-rail').innerHTML,
        banner: document.getElementById('question-banner').innerHTML,
        bannerHidden: document.getElementById('question-banner').hidden,
        current: document.getElementById('live-current').innerHTML,
        meta: document.getElementById('live-meta').innerHTML,
        journey: document.getElementById('run-journey').innerHTML
      };
    })()`);
    assert.match(view.rail, /<li class="passed"><strong>goal<\/strong><span>1m 00s<\/span><\/li>/);
    assert.match(view.rail, /<li class="passed"><strong>maker<\/strong><span>4m 00s<\/span><\/li>/);
    assert.match(view.rail, /<li class="passed"><strong>verify<\/strong><span>3m 00s<\/span><\/li>/);
    assert.match(view.rail, /<li class="active"><strong>review<\/strong><span>2m 0\ds<\/span><\/li>/);
    assert.match(view.rail, /<li class="pending"><strong>judge<\/strong><span>—<\/span><\/li>/);
    assert.match(view.rail, /<li class="pending"><strong>deliver<\/strong><span>—<\/span><\/li>/);
    assert.equal(view.bannerHidden, false);
    assert.match(view.banner, /Which page size\?/);
    assert.match(view.banner, /Answer in Studio/);
    assert.match(view.current, /review · devil-advocate/);
    assert.match(view.current, /Stage 06/);
    assert.match(view.current, /iteration 2 \/ 3/);
    assert.match(view.current, /running 2m 0\ds/);
    assert.match(view.current, /Reading the diff/);
    assert.match(view.current, /data-open-node="review"/);
    assert.match(view.current, /Open node details/);
    assert.match(view.current, /Start with AI Agent/);
    assert.match(view.current, /Next: judge → delivery-approval → delivery/);
    assert.match(view.current, />Findings</);
    assert.match(view.current, /2 \/ 1/);
    assert.match(view.current, />Tests</);
    assert.match(view.current, /3 passed \/ 0 failed/);
    assert.match(view.current, />Scope</);
    assert.match(view.current, /in map/);
    assert.match(view.meta, /Compliance &amp; budget/);
    assert.match(view.meta, />Mode</);
    assert.match(view.meta, /ASSISTED/);
    assert.match(view.meta, /host reports no usage/);
    assert.match(view.meta, /Latest events/);
    assert.match(view.meta, /Goal frozen/);
    assert.match(view.meta, /Verification gate passed/);
    assert.match(view.meta, /<time datetime="[^"]+" title="[^"]+">\d{2}:\d{2}<\/time>/);
    assert.doesNotMatch(view.meta, /\d+m ago/);
    assert.equal(view.meta.includes('style='), false);
    assert.match(view.journey, /class="step-group"/);
    assert.match(view.journey, />goal</);
    assert.match(view.journey, />verification</);
    assert.match(view.journey, /Goal frozen/);
    assert.match(view.journey, /class="unknown"/);
    assert.match(view.journey, /lifecycle unavailable — journey may be incomplete/);
    const posted = await run(`(async () => {
      const calls = [];
      fetch = async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || 'GET', body: options.body || '' });
        return { ok: true, json: async () => ({ ok: true, live: catalog.live }) };
      };
      await submitAnswer('q1', '   ');
      const skipped = calls.length;
      await submitAnswer('q1', 'forty');
      return { skipped, calls, notice: document.getElementById('message').textContent };
    })()`);
    assert.equal(posted.skipped, 0);
    assert.equal(posted.calls[0].method, 'POST');
    assert.match(posted.calls[0].url, /\/api\/runs\/run-91\/questions\/q1\/answer$/);
    assert.deepEqual(JSON.parse(posted.calls[0].body), { message: 'forty', actor: 'human' });
    assert.equal(posted.notice, 'Answer recorded.');
  });
});
