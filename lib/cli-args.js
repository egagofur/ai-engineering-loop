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
  refresh: { flags: ['--non-destructive', '--json'], valued: [], positionals: [] },
  'sync-hosts': { flags: ['--dry-run', '--prune', '--json'], valued: ['--pack'], positionals: [] },
  setup: { flags: ['--yes', '--json'], valued: ['--hosts', '--mode'], positionals: [] },
  hosts: { flags: ['--json'], valued: [], positionals: null },
  update: { flags: ['--json', '--yes', '--background', '--force', '--no-pin'], valued: ['--channel', '--pin'], positionals: ['check', 'plan', 'apply', 'auto', 'policy', 'rollback', ...['off', 'notify', 'patch', 'minor', 'all']] },
  projects: { flags: ['--json'], valued: ['--root', '--depth'], positionals: null },
  // `run --abandon` (issue #46) is a writer; plain `run` takes free text.
  'run:abandon': { flags: ['--abandon', '--yes', '--json'], valued: ['--run', '--reason', '--by'], positionals: [] },
  migrate: { flags: ['--json', '--dry-run'], valued: ['--from'], positionals: [] },
  verify: { flags: ['--json', '--serial', '--shell'], valued: ['--run', '--cmd', '--timeout-ms'], positionals: [] },
  guard: { flags: ['--json'], valued: ['--run', '--tool', '--input', '--path', '--command', '--hook'], positionals: ['check'] },
  hooks: { flags: ['--json'], valued: ['--host'], positionals: ['install', 'uninstall', 'status'] },
  impact: { flags: ['--json', '--force'], valued: ['--run', '--by', '--reason', '--allow', '--remove', '--limit'], positionals: ['map', 'show', 'confirm', 'skip', 'drift'] },
  'review-pack': { flags: ['--json'], valued: ['--run', '--base', '--profile'], positionals: [] },
  deliver: { flags: ['--json', '--approve'], valued: ['--run', '--destination', '--summary', '--by'], positionals: [] },
  'generate-adapter': { flags: [], valued: ['--type'], positionals: [] },
  'generate-workflow': { flags: ['--write'], valued: [], positionals: [] }
});

function beforeSeparator(args) {
  const index = args.indexOf('--');
  return index === -1 ? args : args.slice(0, index);
}

// `run --abandon ...` is checked as its own writer command.
function effectiveCommand(command, rest) {
  if (command === 'run' && beforeSeparator(rest).includes('--abandon')) return 'run:abandon';
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
  const start = lines.findIndex((line) => {
    const match = line.match(/^  (\S+)/);
    return match && match[1] === command;
  });
  if (start === -1) return null;
  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^  \S/.test(line) || /^\S/.test(line) || line.trim() === '') break;
    block.push(line);
  }
  return block.join('\n');
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
