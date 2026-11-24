import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let compiler = null;

export async function load(url, context, next) {
  if (!url.startsWith('file:') || !url.endsWith('.svelte')) return next(url, context);
  compiler ??= await import('svelte/compiler');
  const filename = fileURLToPath(url);
  const source = await readFile(filename, 'utf8');
  const { js } = compiler.compile(source, { filename, generate: 'server' });
  return { format: 'module', source: js.code, shortCircuit: true };
}
