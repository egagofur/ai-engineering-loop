'use strict';

// One host+model per `ael bench` invocation (#79). Command templates live on
// each host's `bench` block. A missing binary is UNAVAILABLE, never a model
// failure. `--bin` is the test hook that points at tests/fixtures/fake-host.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { HOSTS, HOST_IDS, getHost } = require('./hosts/registry.js');
const { findOnPath } = require('./hosts/detect.js');
const { readUserConfig } = require('./user-state.js');

function benchError(message, code = 'BENCH_FAILED', details = []) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function countFlag(args, name) {
  let count = 0;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      count += 1;
      if (!String(args[index + 1] || '').startsWith('-')) index += 1;
      continue;
    }
    if (arg.startsWith(`${name}=`)) count += 1;
  }
  return count;
}

function flagValues(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name && args[index + 1] != null) {
      values.push(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith(`${name}=`)) values.push(arg.slice(name.length + 1));
  }
  return values;
}

function benchSpec(host) {
  if (host?.bench?.bin && Array.isArray(host.bench.args)) return host.bench;
  const bin = (host?.detect?.bins || [])[0];
  if (!bin) return null;
  return { bin, args: ['-m', '{{model}}', '-p', '{{prompt}}'], usageParser: 'json-usage' };
}

function expandHome(value, home) {
  const raw = String(value || '');
  if (raw === '~') return home;
  if (raw.startsWith('~/')) return path.join(home, raw.slice(2));
  return raw;
}

function resolveBenchBinary(host, { binOverride, home, env = process.env } = {}) {
  if (binOverride) {
    const resolved = path.resolve(String(binOverride));
    try {
      fs.statSync(resolved);
      return { status: 'ok', bin: resolved, override: true };
    } catch {
      return { status: 'UNAVAILABLE', bin: resolved, override: true };
    }
  }
  const spec = benchSpec(host);
  if (!spec) return { status: 'UNAVAILABLE', bin: null, override: false };
  const expanded = expandHome(spec.bin, home || os.homedir());
  try {
    if (fs.statSync(expanded).isFile()) return { status: 'ok', bin: expanded, override: false };
  } catch {
    // Fall through to PATH.
  }
  const names = [path.basename(spec.bin), ...(host.detect.bins || [])];
  for (const name of names) {
    const found = findOnPath(name, env);
    if (found) return { status: 'ok', bin: found, override: false };
  }
  return { status: 'UNAVAILABLE', bin: expanded, override: false };
}

function buildBenchCommand(host, { model, prompt, bin, spec, extraArgs = [] }) {
  const template = spec || benchSpec(host);
  if (!template) throw benchError(`Host ${host?.id || '(unknown)'} has no bench command template`, 'UNAVAILABLE');
  const args = template.args.map((part) => String(part)
    .replace(/\{\{model\}\}/g, String(model))
    .replace(/\{\{prompt\}\}/g, String(prompt)));
  for (const extra of extraArgs) args.push(String(extra));
  const usesPromptArg = template.args.some((part) => String(part).includes('{{prompt}}'));
  return {
    bin,
    args,
    input: usesPromptArg || template.promptStdin === false ? null : prompt,
    usageParser: template.usageParser || 'json-usage'
  };
}

function extractJsonObjects(text) {
  const objects = [];
  const raw = String(text || '');
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== '{') continue;
    let depth = 0;
    for (let end = index; end < raw.length; end += 1) {
      if (raw[end] === '{') depth += 1;
      else if (raw[end] === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            objects.push(JSON.parse(raw.slice(index, end + 1)));
          } catch {
            // Not a complete JSON object; keep scanning.
          }
          index = end;
          break;
        }
      }
    }
  }
  return objects;
}

function parseHostUsage(text, parser = 'json-usage') {
  if (!parser || parser === 'none') return null;
  for (const obj of extractJsonObjects(text)) {
    const usage = obj.usage && typeof obj.usage === 'object' ? obj.usage : obj;
    const input = usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens;
    const output = usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens;
    if (Number.isFinite(Number(input)) || Number.isFinite(Number(output))) {
      const inputTokens = Math.max(0, Number(input) || 0);
      const outputTokens = Math.max(0, Number(output) || 0);
      return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
    }
  }
  return null;
}

function defaultTarget({ host, model, home, env = process.env } = {}) {
  const config = readUserConfig(home);
  const saved = config.hosts && typeof config.hosts === 'object' ? config.hosts : {};
  const enabled = Array.isArray(saved.enabled) ? saved.enabled.filter((id) => HOST_IDS.includes(id)) : [];
  let hostId = host;
  if (!hostId) {
    if (enabled.length === 1) hostId = enabled[0];
    else if (enabled.length > 1) {
      throw benchError('Multiple hosts are enabled. Pass --host <id> (one target per bench).', 'BENCH_USAGE');
    } else {
      const detected = HOSTS.filter((item) => {
        try {
          return (item.detect.dirs || []).some((dir) => fs.statSync(path.join(home, dir)).isDirectory());
        } catch {
          return false;
        }
      });
      if (detected.length === 1) hostId = detected[0].id;
    }
  }
  if (!hostId) throw benchError('Pass --host <id> --model <id>. No project host is configured.', 'BENCH_USAGE');
  if (!HOST_IDS.includes(hostId)) {
    throw benchError(`Unknown host "${hostId}". Known: ${HOST_IDS.join(', ')}`, 'UNKNOWN_HOST');
  }
  const modelId = model || saved.model || saved.benchModel;
  if (!modelId) throw benchError('Pass --model <id>. No project model is configured.', 'BENCH_USAGE');
  return { host: getHost(hostId), model: String(modelId), env };
}

function assertSingleTarget(args) {
  const hosts = countFlag(args, '--host');
  const models = countFlag(args, '--model');
  if (hosts > 1 || models > 1) {
    throw benchError('ael bench accepts one --host and one --model per invocation', 'BENCH_USAGE');
  }
}

module.exports = {
  benchError,
  countFlag,
  flagValues,
  benchSpec,
  expandHome,
  resolveBenchBinary,
  buildBenchCommand,
  parseHostUsage,
  extractJsonObjects,
  defaultTarget,
  assertSingleTarget
};
