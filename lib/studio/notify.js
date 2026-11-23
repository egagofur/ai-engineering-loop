'use strict';

const { execFile, spawnSync } = require('node:child_process');

const NOTIFY_TIMEOUT_MS = 5000;

const WAIT_COPY = {
  freeze: 'Goal waiting for Freeze',
  approval: 'Delivery waiting for approval',
  question: 'Agent has a question',
};

function quoteAppleScript(text) {
  const flat = String(text).replace(/\r?\n|\r/g, ' ');
  return `"${flat.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function onPath(name) {
  return spawnSync('which', [name], { stdio: 'ignore', timeout: NOTIFY_TIMEOUT_MS }).status === 0;
}

function ignoreResult() {
  return undefined;
}

function osNotifier({ platform = process.platform, run = execFile, which = onPath } = {}) {
  let notifySend;
  const hasNotifySend = () => {
    if (notifySend === undefined) notifySend = Boolean(which('notify-send'));
    return notifySend;
  };
  const launch = (command, args) => run(command, args, { timeout: NOTIFY_TIMEOUT_MS }, ignoreResult);
  return (title, body) => {
    try {
      if (platform === 'darwin') {
        launch('osascript', ['-e', `display notification ${quoteAppleScript(body)} with title ${quoteAppleScript(title)}`]);
      } else if (platform === 'linux' && hasNotifySend()) {
        launch('notify-send', [title, body]);
      }
    } catch {
      return;
    }
  };
}

function waitsOf(project) {
  const runs = [project.run, ...(project.worktreeRuns || [])].filter(Boolean);
  return runs.filter((run) => run.waiting && WAIT_COPY[run.waiting.kind]);
}

function createWaitTracker({ notify }) {
  let seen = null;
  return {
    update(projectSummaries) {
      const current = new Set();
      for (const project of projectSummaries) {
        for (const run of waitsOf(project)) {
          const key = `${project.id}:${run.runId}:${run.waiting.kind}`;
          current.add(key);
          if (seen && !seen.has(key)) notify(`AEL: ${project.name}`, WAIT_COPY[run.waiting.kind]);
        }
      }
      seen = current;
    },
  };
}

module.exports = { createWaitTracker, osNotifier, quoteAppleScript };
