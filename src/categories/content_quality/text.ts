// The words of each state as a text outline, from the accessibility snapshot taken at collection
// (states/<id>/aria.yml): one line per element in page order, with its role, accessible name and
// text. The element snapshot cannot give this: it keeps each element's own text without the
// inline elements inside it, so sentences around a link or bold phrase come apart.

import fs from 'node:fs';
import path from 'node:path';
import { bundleDir } from '../../store.ts';
import type { Bundle, StateRecord } from '../../types.ts';
import type { EvidenceIndexEntry } from '../types.ts';
import { stateName } from '../layout/findings.ts';
import type { PageTextBlock } from '../no-checks/packet.ts';

// About 3k tokens for the complete outline and 1k for each state's changes.
export const MAX_OUTLINE_CHARS = 12_000;
export const MAX_CHANGES_CHARS = 4_000;
const MAX_LINE_CHARS = 300;
const OPTIONS_SHOWN = 5;
// Outlines longer than this are compared line by line without alignment.
const MAX_DIFF_CELLS = 4_000_000;
// The prompt's own section tags, neutralised where interface text contains them.
const PROMPT_TAGS = /<(\/?)(page_text|outline|criterion|rubric_criterion|notes|task|states|screenshots)\b/gi;

const indentOf = (l: string) => l.length - l.trimStart().length;
const unquote = (s: string) => (/^".*"$/.test(s) ? s.slice(1, -1).replace(/\\"/g, '"') : s);
const nameOf = (l: string) => l.match(/^\s*- [\w-]+ "((?:[^"\\]|\\.)*)"/)?.[1].replace(/\\"/g, '"');
const textOf = (l: string) => {
  const m = l.match(/^\s*- text: (.*)$/);
  return m ? unquote(m[1]) : undefined;
};

// Link targets are dropped, a `text:` line repeating the name of the control beside it (a label
// and its field) is dropped, and option lists keep their first options and any selected one.
export function cleanOutline(raw: string): string[] {
  const src = raw.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() && !/^\s*- \/url:/.test(l));
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const l = src[i];
    const text = textOf(l);
    const sibling = (j: number) => (src[j] && indentOf(src[j]) === indentOf(l) ? nameOf(src[j]) : undefined);
    if (text !== undefined && (sibling(i - 1) === text || sibling(i + 1) === text)) continue;
    if (/^\s*- option /.test(l)) {
      let end = i;
      while (end + 1 < src.length && indentOf(src[end + 1]) === indentOf(l) && /^\s*- option /.test(src[end + 1])) end++;
      const run = src.slice(i, end + 1);
      const kept = run.filter((o, k) => k < OPTIONS_SHOWN || o.includes('[selected]'));
      out.push(...kept);
      if (run.length > kept.length) out.push(`${' '.repeat(indentOf(l))}- (${run.length - kept.length} more options)`);
      i = end;
      continue;
    }
    out.push(l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS - 1)}…` : l);
  }
  return out.map((l) => l.replace(PROMPT_TAGS, '‹$1$2'));
}

export function readOutline(bundle: Bundle, state: StateRecord): string[] | null {
  if (!state.files.aria) return null;
  const file = path.join(bundleDir(bundle.caseId, bundle.bundleId), state.files.aria);
  return fs.existsSync(file) ? cleanOutline(fs.readFileSync(file, 'utf8')) : null;
}

// The lines of `lines` that are not in `base`, each marked + and preceded by the elements it sits
// in (unmarked), and how many lines of `base` are gone.
export function outlineChanges(base: string[], lines: string[]): { lines: string[]; removed: number } {
  const common = new Set<number>();
  if (base.length * lines.length <= MAX_DIFF_CELLS) {
    const n = base.length;
    const m = lines.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = base[i] === lines[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    for (let i = 0, j = 0; i < n && j < m; ) {
      if (base[i] === lines[j]) {
        common.add(j);
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
      else j++;
    }
  } else {
    const left = new Map<string, number>();
    for (const l of base) left.set(l, (left.get(l) ?? 0) + 1);
    lines.forEach((l, j) => {
      if (left.get(l)) {
        left.set(l, left.get(l)! - 1);
        common.add(j);
      }
    });
  }
  const shown = new Map<number, boolean>();
  lines.forEach((l, k) => {
    if (common.has(k)) return;
    shown.set(k, true);
    let indent = indentOf(l);
    for (let p = k - 1; p >= 0 && indent > 0; p--) {
      if (indentOf(lines[p]) >= indent) continue;
      if (!shown.has(p)) shown.set(p, false);
      indent = indentOf(lines[p]);
    }
  });
  return {
    lines: [...shown.keys()].sort((a, b) => a - b).map((k) => `${shown.get(k) ? '+' : ' '} ${lines[k]}`),
    removed: base.length - common.size,
  };
}

function capped(lines: string[], maxChars: number): { lines: string[]; more?: number } {
  let used = 0;
  const kept: string[] = [];
  for (const l of lines) {
    if (used + l.length + 1 > maxChars) break;
    kept.push(l);
    used += l.length + 1;
  }
  return kept.length < lines.length ? { lines: kept, more: lines.length - kept.length } : { lines: kept };
}

// The desktop baseline's outline in full; every other state's changes against the baseline of
// its own device (the desktop baseline when that has no outline).
export function pageTextBlocks(bundle: Bundle, states: StateRecord[], index: Record<string, EvidenceIndexEntry>): { blocks: PageTextBlock[]; notes: string[] } {
  const outlines = new Map(states.map((s) => [s.id, readOutline(bundle, s)]));
  const blocks: PageTextBlock[] = [];
  const notes: string[] = [];
  const baseline = (vp: string) => states.find((s) => s.kind === 'baseline' && s.viewportId === vp && outlines.get(s.id));
  const full = baseline('desktop') ?? states.find((s) => outlines.get(s.id));
  const changesSeen = new Map<string, string>();
  for (const s of states) {
    const lines = outlines.get(s.id);
    if (!lines) {
      notes.push(`No page text was captured for ${stateName(s)}.`);
      continue;
    }
    const id = `T-${s.id}`;
    if (s === full) {
      blocks.push({ id, state: s.id, heading: `${stateName(s)}: the whole page.`, ...capped(lines, MAX_OUTLINE_CHARS) });
      index[id] = { type: 'page_text', stateId: s.id };
      continue;
    }
    const base = (s.kind !== 'baseline' ? baseline(s.viewportId) : undefined) ?? full!;
    const diff = outlineChanges(outlines.get(base.id)!, lines);
    const baseName = stateName(base);
    const gone = diff.removed ? ` ${diff.removed} line${diff.removed > 1 ? 's' : ''} of ${baseName} ${diff.removed > 1 ? 'are' : 'is'} not in this state.` : '';
    if (!diff.lines.length) {
      blocks.push({ state: s.id, heading: `${stateName(s)}: ${gone ? `nothing is added to ${baseName}.${gone}` : `the same text as ${baseName}.`}`, lines: [] });
      continue;
    }
    const key = diff.lines.filter((l) => l.startsWith('+')).join('\n');
    const same = changesSeen.get(key);
    if (same) {
      blocks.push({ state: s.id, heading: `${stateName(s)}: compared with ${baseName}, the same lines are new or changed as in ${same}.${gone}`, lines: [] });
      continue;
    }
    changesSeen.set(key, id);
    blocks.push({ id, state: s.id, heading: `${stateName(s)}: what differs from ${baseName}. Lines marked + are new or changed; the others are the elements they sit in.${gone}`, ...capped(diff.lines, MAX_CHANGES_CHARS) });
    index[id] = { type: 'page_text', stateId: s.id };
  }
  return { blocks, notes };
}

export function renderPageText(blocks: PageTextBlock[]): string {
  return blocks
    .map((b) => {
      const more = b.more ? [`(${b.more} further line${b.more > 1 ? 's' : ''} not shown.)`] : [];
      if (!b.id) return b.heading;
      return [`<outline id="${b.id}" state="${b.state}">`, b.heading, ...b.lines, ...more, '</outline>'].join('\n');
    })
    .join('\n\n');
}
