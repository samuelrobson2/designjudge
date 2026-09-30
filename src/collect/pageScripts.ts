import path from 'node:path';
import { build } from 'esbuild';
import { ROOT } from '../config.ts';

const cache = new Map<string, string>();

async function bundle(entry: string): Promise<string> {
  const cached = cache.get(entry);
  if (cached) return cached;
  const result = await build({
    entryPoints: [path.join(ROOT, 'src/collect/page', entry)],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'chrome120',
    keepNames: false,
    minify: false,
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  cache.set(entry, code);
  return code;
}

export async function initScript(fixture: string | null): Promise<string> {
  const code = await bundle('init.ts');
  const fixtureLine = fixture ? `window.__DJ_FIXTURE__ = ${JSON.stringify(fixture)};\n` : '';
  return fixtureLine + code;
}

export async function snapshotScript(): Promise<string> {
  return bundle('snapshot.ts');
}
