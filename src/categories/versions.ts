// Which prompt version of each category is the default, and which parts of a rubric each version
// reads.
//
// The versions in ADDED_CHECKS_FROM read the added checks and measurements (page-data claims,
// label in name, reduced motion, squeezed wrapping, broken images and the composition
// measurements). Until ADDED_CHECKS_DEFAULT is true they are left out of
// listPromptVersions, so nothing uses them unless it names them (--prompt v7), and the rubric
// lines they read are hidden from every other version. DJ_ADDED_CHECKS=1 makes them the default
// for one command (for example a rescore).

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';

export const ADDED_CHECKS_DEFAULT = false;

export const ADDED_CHECKS_FROM: Record<string, string> = { layout: 'v7', typography: 'v2', visual_system: 'v2', functionality: 'v2' };

export function addedChecksDefault(): boolean {
  return ADDED_CHECKS_DEFAULT || process.env.DJ_ADDED_CHECKS === '1';
}

const versionNumber = (v: string) => Number(v.replace(/^v/, ''));

export function readsAddedChecks(category: string, version: string): boolean {
  const from = ADDED_CHECKS_FROM[category];
  return !!from && versionNumber(version) >= versionNumber(from);
}

export function promptDir(version: string, category = 'layout'): string {
  return path.join(ROOT, 'src/categories', category, 'prompts', version);
}

// Every prompt version of a category, oldest first; the last is the default.
export function listPromptVersions(category = 'layout', opts: { all?: boolean } = {}): string[] {
  const dir = path.join(ROOT, 'src/categories', category, 'prompts');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((v) => fs.existsSync(path.join(promptDir(v, category), 'config.json')))
    .filter((v) => opts.all || addedChecksDefault() || !readsAddedChecks(category, v))
    .sort();
}

// Rubric lines between `<!-- added checks -->` and `<!-- end -->` are read only by the versions
// that read the added checks; lines between `<!-- before added checks -->` and `<!-- end -->`
// only by the others. The marker lines themselves are never read.
export function rubricView(raw: string, added: boolean): string {
  const out: string[] = [];
  let mode: 'all' | 'added' | 'before' = 'all';
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t === '<!-- added checks -->') mode = 'added';
    else if (t === '<!-- before added checks -->') mode = 'before';
    else if (t === '<!-- end -->' && mode !== 'all') mode = 'all';
    else if (mode === 'all' || (mode === 'added') === added) out.push(line);
  }
  return out.join('\n');
}

export function readRubric(file: string, added = addedChecksDefault()): string {
  return rubricView(fs.readFileSync(file, 'utf8'), added);
}
