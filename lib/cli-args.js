'use strict';

// Side-effect-free argument checks that run before any command handler.
// Contract: `--help`/`-h` never executes a command, and commands that write
// files reject unknown flags before touching the filesystem.

const HELP_FLAGS = new Set(['-h', '--help']);

// Commands whose handlers write files (repository, home, or package installs).
// `flags` take no value; `valued` consume the next token; `positionals` lists
// accepted bare words (null = free text allowed).
const WRITER_COMMANDS = Object.freeze({
  init: { flags: [], valued: [], positionals: [] },
  refresh: { flags: ['--non-destructive', '--json', '--garden', '--yes'], valued: [], positionals: [] },
  'sync-hosts': { flags: ['--dry-run', '--prune', '--json'], valued: ['--pack'], positionals: [] },
  setup: { flags: ['--yes', '--json'], valued: ['--hosts', '--mode'], positionals: [] },
  studio: { flags: ['--no-open', '--background', '--stop', '--no-notify'], valued: ['--port'], positionals: [] },
  hosts: { flags: ['--json'], valued: [], positionals: null },
  update: { flags: ['--json', '--yes', '--background', '--force', '--no-pin'], valued: ['--channel', '--pin'], positionals: ['check', 'plan', 'apply', 'auto', 'policy', 'rollback', ...['off', 'notify', 'patch', 'minor', 'all']] },
  projects: { flags: ['--json'], valued: ['--root', '--depth'], positionals: null },
  // `run --abandon` (issue #46) is a writer; plain `run` takes free text.
  'run:abandon': { flags: ['--abandon', '--yes', '--json', '--force-live'], valued: ['--run', '--reason', '--by'], positionals: [] },
  // `run --reopen` starts a new iteration of a gated Run (post-PASS rework).
  'run:reopen': { flags: ['--reopen', '--json'], valued: ['--run', '--reason', '--by'], positionals: [] },
  bench: {
    flags: ['--json', '--sandbox-home'],
    valued: ['--host', '--model', '--scenario', '--repeat', '--bin', '--mode', '--timeout', '--host-arg', '--without'],
    positionals: []
  },
  worktree: { flags: ['--json', '--yes', '--audit', '--include-scratch'], valued: [], positionals: ['prune'] },
  pr: { flags: ['--json'], valued: ['--run', '--branch', '--pr'], positionals: ['status', 'babysit'] },
  driver: { flags: ['--json'], valued: ['--feature', '--surface'], positionals: ['scaffold'] },
  'feature-map': { flags: ['--json'], valued: [], positionals: ['scaffold'] },
  safety: { flags: ['--json', '--live'], valued: ['--run', '--fact', '--cmd', '--level'], positionals: ['record'] },
  measurement: { flags: ['--json'], valued: ['--run', '--ac', '--runs', '--spread', '--effect', '--limiter'], positionals: ['record'] },
  recap: { flags: ['--json', '--open'], valued: ['--days', '--for', '--projects', '--out', '--now', '--lang'], positionals: [] },
  migrate: { flags: ['--json', '--dry-run'], valued: ['--from'], positionals: [] },
  debt: { flags: ['--json'], valued: ['--by', '--note', '--file'], positionals: null },
  outcome: { flags: ['--json'], valued: ['--run', '--source', '--location', '--summary', '--evidence', '--by', '--file'], positionals: ['record', 'repro'] },
  verify: { flags: ['--json', '--serial', '--shell', '--related', '--final', '--fresh', '--baseline'], valued: ['--run', '--cmd', '--timeout-ms'], positionals: [] },
  quick: { flags: ['--json', '--serial', '--shell'], valued: ['--run', '--cmd', '--timeout-ms', '--mode'], positionals: null },
  review: { flags: ['--json'], valued: ['--run', '--child-id', '--file'], positionals: ['ingest'] },
  sources: { flags: ['--json'], valued: ['--run', '--source', '--ref', '--line'], positionals: ['refresh', 'show', 'record', 'hint'] },
  learn: { flags: ['--json', '--dry-run', '--prune', '--no-shell', '--transcripts'], valued: ['--max-age-runs', '--check', '--fix', '--why', '--by', '--scope', '--forbid-import', '--forbid-api', '--except', '--prove', '--since', '--host', '--min-sessions'], positionals: null },
  spike: { flags: ['--json', '--discarded'], valued: ['--run', '--question', '--learned'], positionals: ['record', 'show'] },
  guard: { flags: ['--json'], valued: ['--run', '--tool', '--input', '--path', '--command', '--hook'], positionals: ['check'] },
  hooks: { flags: ['--json'], valued: ['--host'], positionals: ['install', 'uninstall', 'status'] },
  impact: { flags: ['--json', '--force'], valued: ['--run', '--by', '--reason', '--allow', '--remove', '--limit'], positionals: ['map', 'show', 'confirm', 'skip', 'drift'] },
  'review-pack': { flags: ['--json'], valued: ['--run', '--base', '--profile'], positionals: [] },
  deliver: { flags: ['--json', '--approve'], valued: ['--run', '--destination', '--summary', '--by', '--host', '--model', '--head', '--evidence'], positionals: [] },
  'generate-adapter': { flags: [], valued: ['--type'], positionals: [] },
  'generate-workflow': { flags: ['--write'], valued: [], positionals: [] },
  workflow: {
    flags: ['--json'],
    valued: ['--answers', '--proposal', '--by', '--mode'],
    positionals: ['interview', 'propose', 'accept', 'reject', 'suggest']
  }
});

function beforeSeparator(args) {
  const index = args.indexOf('--');
  return index === -1 ? args : args.slice(0, index);
}

// `run --abandon ...` is checked as its own writer command.
function effectiveCommand(command, rest) {
  if (command === 'run' && beforeSeparator(rest).includes('--abandon')) return 'run:abandon';
  if (command === 'run' && beforeSeparator(rest).includes('--reopen')) return 'run:reopen';
  if (command === 'bench' && beforeSeparator(rest)[0] === 'compare') return 'bench:compare';
  return command;
}

function wantsCommandHelp(command, rest) {
  const scoped = beforeSeparator(rest);
  // `run` takes free-text task words; only a leading help flag counts.
  if (command === 'run') return scoped.length > 0 && HELP_FLAGS.has(scoped[0]);
  return scoped.some((arg) => HELP_FLAGS.has(arg));
}

function unknownWriterArgs(command, rest) {
  const spec = WRITER_COMMANDS[command];
  if (!spec) return [];
  const scoped = beforeSeparator(rest);
  const unknown = [];
  for (let index = 0; index < scoped.length; index += 1) {
    const arg = scoped[index];
    if (arg.startsWith('-')) {
      const [name] = arg.split('=');
      if (spec.valued.includes(name)) {
        if (!arg.includes('=')) index += 1;
        continue;
      }
      if (spec.flags.includes(arg)) continue;
      unknown.push(arg);
      continue;
    }
    if (spec.positionals === null) continue;
    if (!spec.positionals.includes(arg)) unknown.push(arg);
  }
  return unknown;
}

function commandHelp(helpText, command) {
  const lines = String(helpText).split('\n');
  const blocks = [];
  lines.forEach((line, start) => {
    const match = line.match(/^  (\S+)/);
    if (!match || match[1] !== command) return;
    const block = [line];
    for (let index = start + 1; index < lines.length; index += 1) {
      const next = lines[index];
      if (/^  \S/.test(next) || /^\S/.test(next) || next.trim() === '') break;
      block.push(next);
    }
    blocks.push(block.join('\n'));
  });
  if (!blocks.length) return null;
  const main = blocks.findIndex((block) => /^  \S+\s{2,}/.test(block));
  if (main > 0) blocks.unshift(...blocks.splice(main, 1));
  return blocks.join('\n');
}

module.exports = {
  HELP_FLAGS,
  WRITER_COMMANDS,
  beforeSeparator,
  effectiveCommand,
  wantsCommandHelp,
  unknownWriterArgs,
  commandHelp
};
