'use strict';

const { spawnSync } = require('child_process');

function ghCommand() {
  const custom = process.env.AEL_GH_BIN;
  if (custom && /\.(c|m)?js$/.test(custom)) return [process.execPath, [custom]];
  return [custom || 'gh', []];
}

function ghJson(args, { cwd, timeoutMs = 20000 } = {}) {
  const [bin, prefix] = ghCommand();
  const result = spawnSync(bin, [...prefix, ...args], { cwd, encoding: 'utf8', timeout: timeoutMs });
  if (result.error?.code === 'ENOENT') return { ok: false, reason: 'missing', message: 'GitHub CLI (gh) is not installed' };
  if (result.status !== 0) {
    const text = `${result.stderr || ''}${result.stdout || ''}`.trim();
    const reason = /auth login|not logged|authentication/i.test(text) ? 'auth' : /no pull requests? found|could not resolve/i.test(text) ? 'not-found' : 'failed';
    return { ok: false, reason, message: text.split('\n')[0] || `gh exited ${result.status}` };
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout || 'null') };
  } catch {
    return { ok: false, reason: 'failed', message: 'gh returned output that is not JSON' };
  }
}

module.exports = { ghJson };
