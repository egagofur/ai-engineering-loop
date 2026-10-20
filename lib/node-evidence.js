'use strict';

// Read-side evidence for Studio node details (#91). Built-in gates record
// proof in state.json artifacts and run files, not on workflow nodes.
// nodes[id].artifact stays authoritative for agent and artifact-check nodes.

const fs = require('fs');
const path = require('path');
const { sha256: sha256Bytes } = require('./fsutil.js');
const { runsDir } = require('./run-state.js');
const { readAllRunLifecycle } = require('./run-lifecycle.js');
const { isBlockingFinding } = require('./orchestration.js');
const { summarizeVerificationBundle } = require('./verification-summary.js');

const FILE_BY_KEY = Object.freeze({
  goalContract: 'goal-contract.json',
  diff: 'diff.patch',
  verification: 'verification.json',
  findings: 'findings.json',
  verdict: 'verdict.json',
  delivery: 'delivery.json',
  report: 'report.json',
  receipt: 'receipt.json',
  impactDrift: 'impact-drift.json',
  impactMap: 'impact-map.json',
  verificationSummary: 'verification-summary.json'
});

const PRIMARY_KEY = Object.freeze({
  'goal-contract': 'goalContract',
  maker: 'diff',
  verification: 'verification',
  'devil-advocate': 'findings',
  judge: 'verdict',
  delivery: 'delivery',
  report: 'report'
});

const FINISH_TYPES = new Set(['NODE_COMPLETED', 'NODE_FAILED', 'GATE_PASSED', 'NODE_APPROVED']);
const BOUNDARY_TYPES = new Set([
  'GATE_PASSED',
  'NODE_APPROVED',
  'NODE_COMPLETED',
  'NODE_FAILED',
  'WORKFLOW_CREATED',
  'WORKFLOW_EXECUTION_STARTED'
]);

function runDirectory(rootDir, runId) {
  return path.join(runsDir(rootDir), runId);
}

function resolveInsideRun(rootDir, runId, relativePath) {
  if (!relativePath || typeof relativePath !== 'string' || path.isAbsolute(relativePath)) return null;
  const normalized = relativePath.replace(/\\/g, '/');
  const prefix = `.ai-engineering-loop/runs/${runId}/`;
  const runRelative = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
  if (!runRelative || runRelative.split('/').includes('..')) return null;
  const directory = runDirectory(rootDir, runId);
  const requested = path.resolve(directory, runRelative);
  const relative = path.relative(directory, requested);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return { directory, requested, relative: relative.split(path.sep).join('/') };
}

function readConfined(rootDir, runId, relativePath) {
  const located = resolveInsideRun(rootDir, runId, relativePath);
  if (!located) return { state: 'rejected', code: 'UNSAFE_HISTORY_PATH' };
  let stat;
  try {
    stat = fs.lstatSync(located.requested);
  } catch {
    return { state: 'missing', path: located.relative };
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
    return { state: 'rejected', code: 'UNSAFE_HISTORY_PATH', path: located.relative };
  }
  let real;
  try {
    real = fs.realpathSync(located.requested);
  } catch {
    return { state: 'rejected', code: 'UNSAFE_HISTORY_PATH', path: located.relative };
  }
  let realDirectory;
  try {
    realDirectory = fs.realpathSync(located.directory);
  } catch {
    return { state: 'rejected', code: 'UNSAFE_HISTORY_PATH', path: located.relative };
  }
  const realRelative = path.relative(realDirectory, real);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    return { state: 'rejected', code: 'UNSAFE_HISTORY_PATH', path: located.relative };
  }
  const bytes = fs.readFileSync(real);
  return {
    state: 'present',
    path: located.relative,
    bytes,
    text: bytes.toString('utf8'),
    sha256: sha256Bytes(bytes)
  };
}

function descriptorFor(run, key, fileName) {
  const artifacts = run?.artifacts || {};
  const direct = artifacts[key];
  if (direct?.path && direct?.sha256) return direct;
  return Object.values(artifacts).find((item) =>
    item && typeof item.path === 'string' && item.sha256 &&
    item.path.replace(/\\/g, '/').endsWith(`/${fileName}`)
  ) || null;
}

function loadChecked(rootDir, run, key) {
  const fileName = FILE_BY_KEY[key];
  if (!fileName) return { key, state: 'missing' };
  const descriptor = descriptorFor(run, key, fileName);
  const relative = descriptor?.path || `.ai-engineering-loop/runs/${run.runId}/${fileName}`;
  const file = readConfined(rootDir, run.runId, relative);
  const base = { key, fileName, path: file.path || fileName };
  if (file.state === 'rejected') return { ...base, state: 'rejected', code: file.code || 'UNSAFE_HISTORY_PATH' };
  if (file.state !== 'present') return { ...base, state: 'missing' };
  if (descriptor?.sha256 && file.sha256 !== descriptor.sha256) {
    return { ...base, state: 'changed', sha256: file.sha256 };
  }
  let json = null;
  if (fileName.endsWith('.json')) {
    try { json = JSON.parse(file.text); } catch { json = null; }
  }
  return {
    ...base,
    state: descriptor?.sha256 ? 'verified' : 'unlisted',
    sha256: file.sha256,
    text: file.text,
    json
  };
}

function publicFile(loaded) {
  if (!loaded || loaded.state === 'missing') return null;
  return {
    name: loaded.fileName,
    path: loaded.path,
    state: loaded.state,
    ...(loaded.sha256 ? { sha256: loaded.sha256 } : {}),
    ...(loaded.code ? { code: loaded.code } : {})
  };
}

function changedCard(loaded) {
  return {
    id: loaded.key,
    title: loaded.fileName || loaded.key,
    state: 'changed',
    lines: [{ label: 'State', value: 'artifact changed' }]
  };
}

function usable(loaded) {
  return loaded && (loaded.state === 'verified' || loaded.state === 'unlisted') && loaded.state !== 'changed';
}

function diffStats(text) {
  const files = [];
  let current = null;
  let plus = 0;
  let minus = 0;
  for (const line of String(text || '').split('\n')) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (match) {
      current = match[2];
      if (!files.includes(current)) files.push(current);
      continue;
    }
    if (!current || line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) plus += 1;
    else if (line.startsWith('-')) minus += 1;
  }
  return { fileCount: files.length, plus, minus, files };
}

function commandDurationMs(command) {
  if (command?.durationMs != null && Number.isFinite(Number(command.durationMs))) return Number(command.durationMs);
  const start = Date.parse(command?.startTime || command?.startedAt || '');
  const end = Date.parse(command?.endTime || command?.finishedAt || '');
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start;
  return null;
}

function outputSha256(command) {
  return sha256Bytes(Buffer.from(`${command?.stdout || ''}\n${command?.stderr || ''}`));
}

function verificationDetail(loaded) {
  if (!usable(loaded)) return null;
  let summary = null;
  try {
    summary = summarizeVerificationBundle(loaded.json || {});
  } catch {
    summary = null;
  }
  const rawCommands = Array.isArray(loaded.json?.commands) ? loaded.json.commands : [];
  const commands = rawCommands.map((command, index) => {
    const summaryCommand = summary?.commands?.[index] || {};
    return {
      command: String(command.command || summaryCommand.command || ''),
      exitCode: command.exitCode == null ? null : Number(command.exitCode),
      durationMs: commandDurationMs(command),
      passed: summaryCommand.testCounts?.passed ?? null,
      failed: summaryCommand.testCounts?.failed ?? null,
      outputSha256: outputSha256(command),
      excerpt: String(command.stdout || summaryCommand.failureExcerpt || '').split('\n').find((line) => line.trim()) || ''
    };
  });
  return {
    passed: summary?.passed ?? null,
    exitCode: summary?.exitCode ?? null,
    commands
  };
}

function findingDetail(loaded) {
  if (!usable(loaded)) return null;
  const findings = Array.isArray(loaded.json?.findings) ? loaded.json.findings : [];
  const bySeverity = { BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const finding of findings) {
    if (Object.hasOwn(bySeverity, finding?.severity)) bySeverity[finding.severity] += 1;
  }
  return {
    count: findings.length,
    blocking: findings.filter(isBlockingFinding).length,
    bySeverity,
    top: findings.slice(0, 5).map((finding) => ({
      id: finding.id || '',
      severity: finding.severity || '',
      location: finding.location || '',
      failureScenario: finding.failureScenario || ''
    }))
  };
}

function goalDetail(loaded, run, workflowEvents) {
  if (!usable(loaded)) return null;
  const criteria = Array.isArray(loaded.json?.acceptanceCriteria) ? loaded.json.acceptanceCriteria : [];
  const frozenEvent = (workflowEvents || []).find((event) => event.type === 'GATE_PASSED' && event.gate === 'goal');
  return {
    version: run?.goal?.version || loaded.json?.version || 1,
    acceptanceCriteria: criteria.length,
    frozenBy: run?.goal?.actor || null,
    frozenAt: run?.goal?.frozenAt || frozenEvent?.at || null,
    criteria: criteria.map((item) => ({ id: item.id, statement: item.statement || '' }))
  };
}

function eventAt(event) {
  const value = Date.parse(event?.at || '');
  return Number.isFinite(value) ? value : null;
}

function eventsForNode(node, workflowEvents, lifecycleEvents) {
  const legacy = node?.legacyGate || null;
  const selected = [];
  for (const event of workflowEvents || []) {
    if (event?.nodeId === node.id || (legacy && event?.gate === legacy)) selected.push(event);
  }
  for (const event of lifecycleEvents || []) {
    if (event?.nodeId === node.id) selected.push(event);
  }
  return selected.sort((left, right) => (eventAt(left) || 0) - (eventAt(right) || 0));
}

function latestOf(events, types) {
  let found = null;
  for (const event of events) {
    if (!types.has(event.type)) continue;
    const at = eventAt(event);
    if (at == null) continue;
    if (!found || at >= eventAt(found)) found = event;
  }
  return found;
}

function nodeTiming({ nodeId, status, workflowEvents = [], lifecycleEvents = [], now = Date.now() } = {}) {
  const node = { id: nodeId, legacyGate: null };
  const own = eventsForNode(node, workflowEvents, lifecycleEvents)
    .filter((event) => event.nodeId === nodeId);
  const normalized = String(status || '').toUpperCase();
  if (normalized !== 'PASSED' && normalized !== 'FAILED') {
    return { durationMs: null, finishedAt: null };
  }
  const workflowCompletions = (workflowEvents || []).filter((event) =>
    event.nodeId === nodeId && (event.type === 'NODE_COMPLETED' || event.type === 'NODE_FAILED')
  );
  const workflowStarts = (workflowEvents || []).filter((event) => event.nodeId === nodeId && event.type === 'NODE_STARTED');
  const lifecycleCompletions = (lifecycleEvents || []).filter((event) =>
    event.nodeId === nodeId && (event.type === 'NODE_COMPLETED' || event.type === 'NODE_FAILED')
  );
  const lifecycleStarts = (lifecycleEvents || []).filter((event) => event.nodeId === nodeId && event.type === 'NODE_STARTED');
  const paired = pairDuration(workflowStarts, workflowCompletions) || pairDuration(lifecycleStarts, lifecycleCompletions);
  if (paired && paired > 0) {
    const finish = latestOf(workflowCompletions, FINISH_TYPES) || latestOf(lifecycleCompletions, FINISH_TYPES);
    return { durationMs: paired, finishedAt: finish?.at || null };
  }
  const finish = latestOf(own, FINISH_TYPES);
  if (!finish) return { durationMs: null, finishedAt: null };
  const finishAt = eventAt(finish);
  const startAt = startBefore(nodeId, workflowEvents, lifecycleEvents, finishAt);
  if (startAt == null || finishAt <= startAt) return { durationMs: null, finishedAt: finish.at };
  return { durationMs: finishAt - startAt, finishedAt: finish.at };
}

function pairDuration(starts, finishes) {
  if (!starts.length || !finishes.length) return null;
  const finish = finishes[finishes.length - 1];
  const finishAt = eventAt(finish);
  const start = [...starts].reverse().find((event) => eventAt(event) != null && eventAt(event) <= finishAt);
  if (!start || finishAt == null) return null;
  return finishAt - eventAt(start);
}

function startBefore(nodeId, workflowEvents, lifecycleEvents, finishAt) {
  const ownStarts = [...(workflowEvents || []), ...(lifecycleEvents || [])]
    .filter((event) => event.nodeId === nodeId && event.type === 'NODE_STARTED')
    .map(eventAt)
    .filter((value) => value != null && value < finishAt);
  if (ownStarts.length) return Math.max(...ownStarts);
  const boundaries = (workflowEvents || [])
    .filter((event) => BOUNDARY_TYPES.has(event.type) && event.nodeId !== nodeId)
    .map(eventAt)
    .filter((value) => value != null && value < finishAt);
  if (!boundaries.length) return null;
  return Math.max(...boundaries);
}

function humanEventLabel(event, context = {}) {
  const gate = event?.gate;
  if (event?.type === 'GATE_PASSED') {
    if (gate === 'goal') return context.frozenBy ? `Goal frozen by ${context.frozenBy}` : 'Goal frozen';
    if (gate === 'maker') {
      return context.fileCount ? `Maker gate passed · ${context.fileCount} files` : 'Maker gate passed';
    }
    if (gate === 'verification') return 'Verification gate passed';
    if (gate === 'review') return 'Review gate passed';
    if (gate === 'judge') return context.verdict ? `Judge verdict ${context.verdict}` : 'Judge gate passed';
    if (gate === 'delivery') return 'Delivery gate passed';
    if (gate === 'report') return 'Report gate passed';
    return 'Gate passed';
  }
  if (event?.type === 'NODE_APPROVED') return `Approved by ${event.approvedBy || context.approvedBy || 'human'}`;
  if (event?.type === 'NODE_STARTED') return 'Started';
  if (event?.type === 'NODE_COMPLETED') return event.message || 'Completed';
  if (event?.type === 'NODE_FAILED') return event.message || 'Failed';
  if (event?.type === 'NODE_ACTIVITY') return event.message || 'Activity';
  if (event?.type === 'GOAL_FROZEN') return context.frozenBy ? `Goal frozen by ${context.frozenBy}` : 'Goal frozen';
  if (event?.type === 'PHASE_COMPLETED') return `${event.phase || 'Phase'} completed`;
  return String(event?.type || 'event').replaceAll('_', ' ').toLowerCase();
}

function groupNodeTimeline({ node, workflowEvents = [], lifecycleEvents = [], evidence = null, run = null } = {}) {
  const context = {
    frozenBy: evidence?.goal?.frozenBy || run?.goal?.actor || null,
    fileCount: evidence?.diff?.fileCount || null,
    verdict: evidence?.verdict?.verdict || null,
    approvedBy: evidence?.approval?.approvedBy || null
  };
  const events = eventsForNode(node, workflowEvents, lifecycleEvents);
  const groups = [];
  let current = null;
  let attempt = 0;
  for (const event of events) {
    const iteration = Number(event.iteration || event.loopIteration || current?.iteration || 1);
    if (event.type === 'NODE_STARTED') attempt += 1;
    if (!current || current.iteration !== iteration) {
      attempt = Math.max(attempt, 1);
      current = {
        id: `iteration-${iteration}`,
        iteration,
        attempt,
        label: `Iteration ${iteration}`,
        events: []
      };
      groups.push(current);
    }
    current.events.push({
      at: event.at || null,
      type: event.type || '',
      nodeId: event.nodeId || node?.id || null,
      label: humanEventLabel(event, context)
    });
  }
  for (const group of groups) {
    if (group.attempt > 1) group.label = `Iteration ${group.iteration} · attempt ${group.attempt}`;
  }
  return groups;
}

function fileList(items) {
  return items.map(publicFile).filter(Boolean);
}

function evidenceResult({ source, status, summary, cards, files, extra = {} }) {
  return {
    source,
    status,
    summary,
    cards,
    files,
    count: cards.length,
    message: status === 'changed' ? 'artifact changed' : (extra.message || null),
    ...extra
  };
}

function nodeArtifactEvidence(rootDir, run, node, runtime) {
  const artifact = runtime.artifact;
  const loaded = readConfined(rootDir, run.runId, artifact.path);
  if (loaded.state === 'rejected') {
    return evidenceResult({
      source: 'node',
      status: 'rejected',
      summary: 'Node artifact path is outside the run directory.',
      cards: [{ id: 'artifact', title: 'NODE ARTIFACT', state: 'rejected', lines: [{ label: 'State', value: 'path rejected' }] }],
      files: [{ name: path.posix.basename(String(artifact.path)), path: artifact.path, state: 'rejected', code: 'UNSAFE_HISTORY_PATH' }],
      extra: { message: 'path rejected' }
    });
  }
  if (artifact.sha256 && loaded.state === 'present' && loaded.sha256 !== artifact.sha256) {
    return evidenceResult({
      source: 'node',
      status: 'changed',
      summary: 'artifact changed',
      cards: [{ id: 'artifact', title: 'NODE ARTIFACT', state: 'changed', lines: [{ label: 'State', value: 'artifact changed' }] }],
      files: [{ name: path.posix.basename(loaded.path || artifact.path), path: loaded.path || artifact.path, state: 'changed' }]
    });
  }
  const name = path.posix.basename(loaded.path || artifact.path);
  return evidenceResult({
    source: 'node',
    status: loaded.state === 'present' ? 'present' : 'missing',
    summary: loaded.state === 'present'
      ? `Recorded node artifact ${name}.`
      : 'The node artifact descriptor is set, but the file is missing.',
    cards: [{
      id: 'artifact',
      title: 'NODE ARTIFACT',
      state: loaded.state === 'present' ? 'verified' : 'missing',
      lines: [{ label: 'Path', value: name }]
    }],
    files: loaded.state === 'present'
      ? [{ name, path: loaded.path, state: artifact.sha256 ? 'verified' : 'unlisted', sha256: loaded.sha256 }]
      : []
  });
}

function resolveNodeEvidence({ rootDir, run, node, runtime = {}, workflowEvents = [] } = {}) {
  if (runtime?.artifact?.path) return nodeArtifactEvidence(rootDir, run, node, runtime);
  const type = node?.type;
  const primaryKey = PRIMARY_KEY[type] || null;
  const primary = primaryKey ? loadChecked(rootDir, run, primaryKey) : null;
  if (primary?.state === 'changed' || primary?.state === 'rejected') {
    return evidenceResult({
      source: 'run',
      status: primary.state === 'rejected' ? 'rejected' : 'changed',
      summary: primary.state === 'rejected' ? 'Artifact path is outside the run directory.' : 'artifact changed',
      cards: [changedCard(primary)],
      files: fileList([primary]),
      extra: { message: primary.state === 'rejected' ? 'path rejected' : 'artifact changed' }
    });
  }

  if (type === 'goal-contract') return goalEvidence(primary, run, workflowEvents);
  if (type === 'maker') return makerEvidence(rootDir, run, primary);
  if (type === 'verification') return verificationEvidence(rootDir, run, primary, workflowEvents);
  if (type === 'devil-advocate') return reviewEvidence(primary);
  if (type === 'judge') return judgeEvidence(rootDir, run, primary, workflowEvents);
  if (type === 'approval') return approvalEvidence(runtime, workflowEvents, node);
  if (type === 'delivery') return deliveryEvidence(rootDir, run, primary);
  if (type === 'report') return reportEvidence(primary);
  return evidenceResult({
    source: 'run',
    status: 'missing',
    summary: 'No evidence recorded for this node yet.',
    cards: [],
    files: []
  });
}

function goalEvidence(primary, run, workflowEvents) {
  if (!usable(primary)) {
    return evidenceResult({
      source: 'run',
      status: 'missing',
      summary: 'No evidence recorded for this node yet.',
      cards: [],
      files: []
    });
  }
  const goal = goalDetail(primary, run, workflowEvents);
  const frozen = goal.frozenBy ? `frozen by ${goal.frozenBy}` : 'frozen';
  return evidenceResult({
    source: 'run',
    status: 'present',
    summary: `Goal contract version ${goal.version} with ${goal.acceptanceCriteria} acceptance criteria, ${frozen}.`,
    cards: [{
      id: 'goal',
      title: 'GOAL CONTRACT',
      state: primary.state,
      lines: [
        { label: 'Version', value: String(goal.version) },
        { label: 'Acceptance criteria', value: String(goal.acceptanceCriteria) },
        { label: 'Frozen by', value: goal.frozenBy || 'not recorded' },
        { label: 'Frozen at', value: goal.frozenAt || 'not recorded' }
      ]
    }],
    files: fileList([primary]),
    extra: { goal }
  });
}

function makerEvidence(rootDir, run, primary) {
  if (!usable(primary)) {
    return evidenceResult({
      source: 'run',
      status: 'missing',
      summary: 'No evidence recorded for this node yet.',
      cards: [],
      files: []
    });
  }
  const diff = diffStats(primary.text);
  const drift = loadChecked(rootDir, run, 'impactDrift');
  const map = loadChecked(rootDir, run, 'impactMap');
  const outOfMap = Array.isArray(drift.json?.outOfMap) ? drift.json.outOfMap : [];
  const driftValue = !usable(drift)
    ? 'not recorded'
    : outOfMap.length === 0 ? 'none' : `${outOfMap.length} out of map`;
  const coverage = !usable(drift)
    ? 'no drift file'
    : outOfMap.length === 0 ? 'in map' : `${outOfMap.length} outside the impact map`;
  const cards = [{
    id: 'diff',
    title: 'CHANGE · diff.patch',
    state: primary.state,
    lines: [
      { label: 'Files', value: String(diff.fileCount) },
      { label: 'Added', value: `+${diff.plus}` },
      { label: 'Removed', value: `−${diff.minus}` },
      { label: 'Files touched', value: diff.files.join(' · ') || 'none' },
      { label: 'Drift', value: driftValue },
      { label: 'Impact map', value: coverage }
    ]
  }];
  if (drift.state === 'changed') cards.push(changedCard(drift));
  const mapNote = usable(map) ? map.json?.status || 'recorded' : null;
  if (mapNote) cards[0].lines.push({ label: 'Map status', value: String(mapNote) });
  return evidenceResult({
    source: 'run',
    status: 'present',
    summary: `Changed ${diff.fileCount} files, +${diff.plus} −${diff.minus}. Drift: ${driftValue}.`,
    cards,
    files: fileList([primary, drift, map]),
    extra: { diff: { ...diff, drift: driftValue, coverage } }
  });
}

function verificationEvidence(rootDir, run, primary, workflowEvents) {
  if (!usable(primary)) {
    return evidenceResult({
      source: 'run',
      status: 'missing',
      summary: 'No evidence recorded for this node yet.',
      cards: [],
      files: []
    });
  }
  const detail = verificationDetail(primary);
  const lines = (detail?.commands || []).map((command) => {
    const counts = command.passed == null && command.failed == null
      ? `exit ${command.exitCode ?? '—'}`
      : `${command.passed ?? 0} passed · ${command.failed ?? 0} failed`;
    return {
      label: command.command || 'command',
      value: counts,
      detail: `exit ${command.exitCode ?? '—'}`,
      durationMs: command.durationMs,
      outputSha256: command.outputSha256
    };
  });
  const cards = [{
    id: 'verification',
    title: `VERIFICATION · ${lines.length} COMMANDS`,
    state: primary.state,
    lines,
    note: 'output sha256 recorded'
  }];
  const diff = loadChecked(rootDir, run, 'diff');
  let diffStatsValue = null;
  if (usable(diff)) {
    diffStatsValue = diffStats(diff.text);
    cards.push({
      id: 'diff',
      title: 'CHANGE · diff.patch',
      state: diff.state,
      lines: [
        { label: 'Files', value: String(diffStatsValue.fileCount) },
        { label: 'Added', value: `+${diffStatsValue.plus}` },
        { label: 'Removed', value: `−${diffStatsValue.minus}` },
        { label: 'Files touched', value: diffStatsValue.files.join(' · ') || 'none' }
      ]
    });
  } else if (diff.state === 'changed') cards.push(changedCard(diff));
  const goal = loadChecked(rootDir, run, 'goalContract');
  const goalInfo = usable(goal) ? goalDetail(goal, run, workflowEvents) : null;
  if (goalInfo) {
    const passed = detail?.passed === true;
    cards.push({
      id: 'claimed',
      title: 'CLAIMED VS REALITY',
      state: goal.state,
      lines: goalInfo.criteria.map((item) => ({
        label: item.id,
        value: item.statement,
        detail: passed ? 'verification passed' : 'verification not green'
      }))
    });
  }
  const summaryFile = loadChecked(rootDir, run, 'verificationSummary');
  const first = detail?.commands?.[0];
  const summary = first
    ? `${first.command || 'Verification'} · ${first.passed ?? '—'} passed, ${first.failed ?? '—'} failed.`
    : 'Verification evidence recorded.';
  return evidenceResult({
    source: 'run',
    status: 'present',
    summary,
    cards,
    files: fileList([primary, diff, goal, summaryFile]),
    extra: { verification: detail, diff: diffStatsValue }
  });
}

function reviewEvidence(primary) {
  if (!usable(primary)) {
    return evidenceResult({
      source: 'run',
      status: 'missing',
      summary: 'No evidence recorded for this node yet.',
      cards: [],
      files: []
    });
  }
  const findings = findingDetail(primary);
  const severity = Object.entries(findings.bySeverity)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${count} ${name}`)
    .join(' · ');
  return evidenceResult({
    source: 'run',
    status: 'present',
    summary: `${findings.count} findings, ${findings.blocking} blocking.`,
    cards: [{
      id: 'findings',
      title: 'FINDINGS',
      state: primary.state,
      lines: [
        { label: 'Count', value: String(findings.count) },
        { label: 'Blocking', value: String(findings.blocking) },
        { label: 'Severity', value: severity || 'none' },
        ...findings.top.map((finding) => ({
          label: `${finding.severity || 'FINDING'} ${finding.id}`.trim(),
          value: finding.failureScenario || finding.location || finding.id
        }))
      ]
    }],
    files: fileList([primary]),
    extra: { findings }
  });
}

function judgeEvidence(rootDir, run, primary, workflowEvents) {
  if (!usable(primary)) {
    return evidenceResult({
      source: 'run',
      status: 'missing',
      summary: 'No evidence recorded for this node yet.',
      cards: [],
      files: []
    });
  }
  const verdict = primary.json || {};
  const goal = loadChecked(rootDir, run, 'goalContract');
  const verification = loadChecked(rootDir, run, 'verification');
  const goalInfo = usable(goal) ? goalDetail(goal, run, workflowEvents) : null;
  const verificationInfo = usable(verification) ? verificationDetail(verification) : null;
  const criteria = (goalInfo?.criteria || []).map((item) => ({
    id: item.id,
    statement: item.statement,
    reality: verificationInfo?.passed ? 'verification passed' : 'verification not recorded as green'
  }));
  const cards = [{
    id: 'verdict',
    title: 'VERDICT',
    state: primary.state,
    lines: [
      { label: 'Verdict', value: String(verdict.verdict || '—') },
      { label: 'Reason', value: String(verdict.reason || '—') },
      { label: 'Action', value: String(verdict.action || '—') }
    ]
  }];
  if (criteria.length) {
    cards.push({
      id: 'claimed',
      title: 'CLAIMED VS REALITY',
      state: 'verified',
      lines: criteria.map((item) => ({
        label: item.id,
        value: item.statement,
        detail: item.reality
      }))
    });
  }
  return evidenceResult({
    source: 'run',
    status: 'present',
    summary: `Judge verdict ${verdict.verdict || 'recorded'}.`,
    cards,
    files: fileList([primary, goal, verification]),
    extra: { verdict: { verdict: verdict.verdict || null, reason: verdict.reason || '', criteria } }
  });
}

function approvalEvidence(runtime, workflowEvents, node) {
  const event = (workflowEvents || []).findLast?.((item) => item.type === 'NODE_APPROVED' && item.nodeId === node?.id)
    || (workflowEvents || []).filter((item) => item.type === 'NODE_APPROVED' && item.nodeId === node?.id).at(-1);
  const approvedBy = runtime?.approvedBy || event?.approvedBy || null;
  const at = event?.at || (approvedBy ? runtime?.updatedAt : null) || null;
  if (!approvedBy && String(runtime?.status || '').toUpperCase() !== 'PASSED') {
    return evidenceResult({
      source: 'run',
      status: 'missing',
      summary: 'No evidence recorded for this node yet.',
      cards: [],
      files: []
    });
  }
  return evidenceResult({
    source: 'run',
    status: 'present',
    summary: `Approved by ${approvedBy || 'human'}.`,
    cards: [{
      id: 'approval',
      title: 'APPROVAL',
      state: 'verified',
      lines: [
        { label: 'Approver', value: approvedBy || 'human' },
        { label: 'Time', value: at || 'not recorded' }
      ]
    }],
    files: [],
    extra: { approval: { approvedBy: approvedBy || 'human', at } }
  });
}

function deliveryEvidence(rootDir, run, primary) {
  if (!usable(primary)) {
    return evidenceResult({
      source: 'run',
      status: 'missing',
      summary: 'No evidence recorded for this node yet.',
      cards: [],
      files: []
    });
  }
  const delivery = primary.json || {};
  const receipt = loadChecked(rootDir, run, 'receipt');
  let receiptMessage = null;
  let receiptState = receipt.state;
  if (receipt.state === 'missing') {
    receiptMessage = ['DELIVERED', 'REPORTED'].includes(run?.state)
      ? 'no receipt: run predates receipts'
      : 'receipt pending';
    receiptState = 'missing';
  } else if (receipt.state === 'changed' || receipt.state === 'rejected') {
    receiptMessage = 'artifact changed';
  } else {
    const digest = delivery.receipt?.digest;
    if (digest && receipt.json?.digest && digest !== receipt.json.digest) {
      receiptState = 'changed';
      receiptMessage = 'artifact changed';
    } else {
      receiptMessage = 'receipt recorded';
    }
  }
  const cards = [{
    id: 'delivery',
    title: 'DELIVERY',
    state: primary.state,
    lines: [
      { label: 'Destination', value: String(delivery.destination || '—') },
      { label: 'Summary', value: String(delivery.summary || '—') },
      { label: 'Approved', value: delivery.humanApproved === true ? (delivery.approvedBy || 'yes') : 'not recorded' }
    ]
  }, {
    id: 'receipt',
    title: 'RECEIPT',
    state: receiptState,
    lines: [{ label: 'Receipt', value: receiptMessage }]
  }];
  const summary = `Delivered to ${delivery.destination || 'the recorded destination'}. ${receiptMessage}.`;
  return evidenceResult({
    source: 'run',
    status: receiptState === 'changed' ? 'present' : 'present',
    summary,
    cards,
    files: fileList([primary, receipt]),
    extra: {
      message: receiptMessage,
      receipt: { state: receiptState, message: receiptMessage, destination: delivery.destination || null }
    }
  });
}

function reportEvidence(primary) {
  if (!usable(primary)) {
    return evidenceResult({
      source: 'run',
      status: 'missing',
      summary: 'No evidence recorded for this node yet.',
      cards: [],
      files: []
    });
  }
  return evidenceResult({
    source: 'run',
    status: 'present',
    summary: String(primary.json?.summary || 'Report recorded.'),
    cards: [{
      id: 'report',
      title: 'REPORT',
      state: primary.state,
      lines: [{ label: 'Summary', value: String(primary.json?.summary || '—') }]
    }],
    files: fileList([primary])
  });
}

function inspectNodeRun(rootDir, run, node, runtime, workflowEvents, now = Date.now()) {
  let lifecycleEvents = [];
  try {
    lifecycleEvents = readAllRunLifecycle(rootDir, run.runId);
  } catch {
    lifecycleEvents = [];
  }
  const timing = nodeTiming({
    nodeId: node.id,
    status: runtime?.status || 'PENDING',
    workflowEvents,
    lifecycleEvents,
    now
  });
  const nodeEvidence = resolveNodeEvidence({ rootDir, run, node, runtime, workflowEvents });
  const timelineGroups = groupNodeTimeline({ node, workflowEvents, lifecycleEvents, evidence: nodeEvidence, run });
  return { ...timing, nodeEvidence, timelineGroups };
}

module.exports = {
  diffStats,
  groupNodeTimeline,
  humanEventLabel,
  inspectNodeRun,
  nodeTiming,
  resolveNodeEvidence
};
