'use strict';

const { execFileSync, spawnSync } = require('node:child_process');

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
  return spawnSync('which', [name], { stdio: 'ignore' }).status === 0;
}

function osNotifier({ platform = process.platform, run = execFileSync, which = onPath } = {}) {
  return (title, body) => {
    try {
      if (platform === 'darwin') {
        run('osascript', ['-e', `display notification ${quoteAppleScript(body)} with title ${quoteAppleScript(title)}`]);
      } else if (platform === 'linux' && which('notify-send')) {
        run('notify-send', [title, body]);
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
  let seen = new Set();
  return {
    update(projectSummaries) {
      const current = new Set();
      for (const project of projectSummaries) {
        for (const run of waitsOf(project)) {
          const key = `${project.id}:${run.runId}:${run.waiting.kind}`;
          current.add(key);
          if (!seen.has(key)) notify(`AEL: ${project.name}`, WAIT_COPY[run.waiting.kind]);
        }
      }
      seen = current;
    },
  };
}

module.exports = { createWaitTracker, osNotifier, quoteAppleScript };
