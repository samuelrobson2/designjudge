// Typography diagnostics: Invalid Text Rendering (deterministic) and the six quantitative
// observations of typography_rubric.md. Every result describes text by role; see text.ts.

import type { DiagnosticItem, ElementRef } from '../../types.ts';
import type { Doc } from '../doc.ts';
import type { CheckOutput } from '../layout/deterministic.ts';
import type { ObservationOutput } from '../layout/observations.ts';
import { mode, roleKey, roleLabel, rolePlural, roundSize, styleKey, textElements, type TextEl, type TextRole } from './text.ts';

// Thresholds from the rubric's reference values.
export const TYPE_REFERENCE = {
  // Text below this size should be unusual.
  smallPx: 12,
  // Below this size, weights under 400 are flagged as light small text.
  lightBelowPx: 18,
  lightWeight: 400,
  // Text of three or more lines should generally have at least this line-height ratio.
  multilineMinRatio: 1.4,
  multilineLines: 3,
  // Multi-line headings looser than this are noted.
  headingLooseRatio: 1.5,
  // A multi-line heading whose shortest line is under this share of its longest is imbalanced.
  headingBalance: 0.4,
  // Sizes this close together are near-duplicates.
  nearDuplicatePx: 1,
  // A family is an isolated deviation when it styles at most this many elements and this share of text.
  isolatedElements: 2,
  isolatedShare: 0.03,
  // A page with more of these than the reference is flagged.
  coreSizes: 5,
  textFamilies: 2,
  weights: 3,
  // About five sizes, each in one or two weights.
  styles: 10,
  // Weights this close together are near-duplicates.
  nearDuplicateWeight: 50,
  // Body text lines longer than this many characters are flagged.
  measureChars: 90,
};

const ROLE_ORDER = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'display', 'body', 'label', 'control', 'field', 'value', 'supporting', 'text'];
const MAX_EXAMPLES = 3;

const sz = (n: number) => `${roundSize(n)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const r2 = (n: number) => Math.round(n * 100) / 100;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function tally<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) out.set(key(x), [...(out.get(key(x)) ?? []), x]);
  return out;
}

const roleRank = (k: string) => (ROLE_ORDER.indexOf(k) < 0 ? 99 : ROLE_ORDER.indexOf(k));

function examples(doc: Doc, xs: TextEl[], n = MAX_EXAMPLES): ElementRef[] {
  return [...xs]
    .sort((a, b) => b.t.chars - a.t.chars)
    .slice(0, n)
    .map((x) => doc.ref(x.el));
}

function roleCounts(xs: TextEl[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[roleKey(x.role)] = (out[roleKey(x.role)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

function rolesText(counts: Record<string, number>, n = 3): string {
  return Object.entries(counts)
    .slice(0, n)
    .map(([k, c]) => `${roleLabel(k)} ${c}`)
    .join(', ');
}

const validSize = (x: TextEl) => typeof x.t.size === 'number' && Number.isFinite(x.t.size) && x.t.size > 0;

function measured(doc: Doc): { all: TextEl[]; valid: TextEl[]; own: TextEl[]; bodySize: number | null } {
  const { items, bodySize } = textElements(doc);
  const valid = items.filter((x) => validSize(x) && !x.family.icon);
  // Runs inside a parent's text (links, bold phrases) share the parent's role; role profiles
  // count each run of text once.
  const own = valid.filter((x) => !x.role.inline);
  return { all: items, valid, own, bodySize };
}

function item(items: DiagnosticItem[], summary: string, elements: ElementRef[], data: Record<string, unknown>): void {
  items.push({ n: items.length + 1, summary, elements, data });
}

// ---------- Invalid Text Rendering ----------

export function invalidTextRendering(doc: Doc, ctx: { stateId: string; viewport: { width: number; height: number } }): CheckOutput {
  const { all } = measured(doc);
  const items: DiagnosticItem[] = [];
  for (const x of all) {
    const problems: string[] = [];
    const size = x.t.size as number | null;
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) problems.push(`font size ${size ?? 'not a number'}${typeof size === 'number' ? ' px' : ''}`);
    const lh = x.t.lineHeight as number | null;
    if (lh !== null && (typeof lh !== 'number' || !Number.isFinite(lh) || lh <= 0)) problems.push(`line height ${lh ?? 'not a number'}${typeof lh === 'number' ? ' px' : ''}`);
    if (!x.t.field && x.t.lineCount === 0) problems.push('no rendered width or height');
    if (!problems.length) continue;
    item(items, `${doc.describe(x.el)} (${roleLabel(roleKey(x.role))}): ${problems.join(', ')}`, [doc.ref(x.el)], {
      role: roleKey(x.role),
      size,
      lineHeight: lh,
      bounds: x.el.textRect,
      problems,
      viewport: `${ctx.viewport.width}×${ctx.viewport.height}`,
    });
  }
  return {
    status: items.length ? 'fail' : 'pass',
    evaluated: all.length,
    summary: items.length
      ? `${items.length} of ${all.length} text elements have invalid metrics or no rendered size.`
      : `All ${all.length} visible text elements have valid computed metrics and rendered dimensions.`,
    items,
    secondary: [],
  };
}

// ---------- Type Scale & Reuse ----------

export function typeScale(doc: Doc): ObservationOutput {
  const { valid, own } = measured(doc);
  const items: DiagnosticItem[] = [];
  const total = valid.reduce((s, x) => s + x.t.chars, 0) || 1;
  const bySize = [...tally(valid, (x) => sz(x.t.size)).entries()].map(([size, xs]) => ({
    size: Number(size),
    xs,
    chars: xs.reduce((s, x) => s + x.t.chars, 0),
  }));
  bySize.sort((a, b) => a.size - b.size);
  for (const s of bySize) {
    const roles = roleCounts(s.xs);
    item(items, `${s.size} px: ${s.xs.length} element${s.xs.length > 1 ? 's' : ''}, ${pct(s.chars / total)} of text (${rolesText(roles)})`, examples(doc, s.xs), {
      kind: 'size',
      size: s.size,
      elements: s.xs.length,
      share: r2(s.chars / total),
      roles,
    });
  }
  const byShare = [...bySize].sort((a, b) => b.chars - a.chars);
  let k = 0;
  let covered = 0;
  while (k < byShare.length && covered / total < 0.9) covered += byShare[k++].chars;
  const oneOffs = bySize.filter((s) => s.xs.length === 1).map((s) => s.size);

  // Runs of sizes each within 1 px of the next (13, 14, 15 px) are one item.
  const chains: (typeof bySize)[] = [];
  for (let i = 1; i < bySize.length; i++) {
    if (bySize[i].size - bySize[i - 1].size > TYPE_REFERENCE.nearDuplicatePx) continue;
    const last = chains[chains.length - 1];
    if (last && last[last.length - 1] === bySize[i - 1]) last.push(bySize[i]);
    else chains.push([bySize[i - 1], bySize[i]]);
  }
  for (const chain of chains) {
    const text = chain.map((s) => `${s.size} px (${s.xs.length})`);
    item(
      items,
      chain.length === 2 ? `${list(text)} are ${r2(chain[1].size - chain[0].size)} px apart` : `${list(text)} step up 1 px or less at a time`,
      chain.flatMap((s) => examples(doc, s.xs, 1)).slice(0, MAX_EXAMPLES),
      { kind: 'near_duplicate', sizes: chain.map((s) => s.size), counts: chain.map((s) => s.xs.length) },
    );
  }

  const byRole = [...tally(own, (x) => roleKey(x.role)).entries()].sort((a, b) => roleRank(a[0]) - roleRank(b[0]));
  for (const [role, xs] of byRole) {
    const sizes = [...tally(xs, (x) => sz(x.t.size)).entries()].map(([s, g]) => ({ size: Number(s), count: g.length, xs: g })).sort((a, b) => b.count - a.count || b.size - a.size);
    if (xs.length < 2 || sizes.length < 2) continue;
    const minority = sizes.slice(1).flatMap((s) => s.xs);
    item(
      items,
      `${roleLabel(role)} ${rolePlural(role) ? 'use' : 'uses'} ${sizes.length} sizes: ${sizes.map((s) => `${s.size} px (${s.count})`).join(', ')}`,
      examples(doc, minority),
      { kind: 'role_sizes', role, sizes: sizes.map((s) => ({ size: s.size, count: s.count })) },
    );
  }

  const sizesText = list(bySize.map((s) => sz(s.size)));
  const summary = bySize.length
    ? `${bySize.length} size${bySize.length > 1 ? 's are' : ' is'} rendered: ${sizesText} px. ${k} account${k === 1 ? 's' : ''} for ${pct(covered / total)} of text${
        oneOffs.length ? `; ${list(oneOffs.map(sz))} px ${oneOffs.length > 1 ? 'occur' : 'occurs'} once` : ''
      }.`
    : 'No visible text.';
  if (bySize.length > TYPE_REFERENCE.coreSizes) {
    item(items, summary, examples(doc, bySize.filter((s) => s.xs.length === 1).flatMap((s) => s.xs)), {
      kind: 'size_count',
      sizes: bySize.map((s) => s.size),
      coverage: { sizes: k, share: r2(covered / total) },
      oneOffs,
    });
  }

  // Distinct styles as the specimen sheet counts them, and the formats among them.
  const texts = valid.filter((x) => !x.t.field);
  const styles = [...tally(texts, styleKey).values()];
  if (styles.length > TYPE_REFERENCE.styles) {
    const single = styles.filter((xs) => xs.length === 1).map((xs) => xs[0]).sort((a, b) => b.t.size - a.t.size);
    const formats = [
      ['italic', texts.filter((x) => x.t.style !== 'normal')],
      ['uppercase', texts.filter((x) => x.t.transform === 'uppercase')],
      ['letter-spacing', texts.filter((x) => Math.abs(x.t.letterSpacing) >= 0.25)],
    ] as const;
    const used = formats.filter(([, xs]) => xs.length);
    const families = new Set(texts.map((x) => x.family.rendered)).size;
    const parts = families > 1 ? 'font, size, weight, italic and letter case' : 'size, weight, italic and letter case';
    item(
      items,
      `${styles.length} distinct text styles (${parts}) are rendered${
        single.length ? `; ${single.length} ${single.length === 1 ? 'is' : 'are'} used by one element only: ${list([...single.slice(0, 4).map((x) => `${sz(x.t.size)} px/${x.t.weight}${x.t.style !== 'normal' ? ' italic' : ''}${x.t.transform === 'uppercase' ? ' uppercase' : ''} (${roleLabel(roleKey(x.role))})`), ...(single.length > 4 ? [`${single.length - 4} more`] : [])])}` : ''
      }${used.length ? `. Formats: ${list(used.map(([f, xs]) => `${f} on ${xs.length} element${xs.length > 1 ? 's' : ''}`))}` : ''}`,
      single.slice(0, MAX_EXAMPLES).map((x) => doc.ref(x.el)),
      { kind: 'style_count', styles: styles.length, singleUse: single.length, formats: Object.fromEntries(formats.map(([f, xs]) => [f, xs.length])) },
    );
  }

  return {
    status: 'observed',
    evaluated: valid.length,
    summary,
    items,
    data: { sizes: bySize.map((s) => s.size), coverage: { sizes: k, share: r2(covered / total) }, oneOffs, styles: styles.length },
  };
}

// ---------- Font Family Usage ----------

export function fontFamilies(doc: Doc): ObservationOutput {
  const { all, valid } = measured(doc);
  const icons = all.filter((x) => x.family.icon).length;
  const items: DiagnosticItem[] = [];
  const total = valid.reduce((s, x) => s + x.t.chars, 0) || 1;
  const families = [...tally(valid, (x) => x.family.rendered).entries()]
    .map(([family, xs]) => ({ family, xs, chars: xs.reduce((s, x) => s + x.t.chars, 0), mono: xs.every((x) => x.family.mono), declared: [...new Set(xs.map((x) => x.family.declared))] }))
    .sort((a, b) => b.chars - a.chars);
  const textFamilies = families.filter((f) => !f.mono);
  const lead = textFamilies[0];
  for (const f of families) {
    const roles = roleCounts(f.xs);
    item(
      items,
      `${f.family}${f.mono ? ' (monospace)' : ''}: ${pct(f.chars / total)} of text, ${f.xs.length} element${f.xs.length > 1 ? 's' : ''} (${rolesText(roles)})${
        f.declared.some((d) => d !== f.family) ? `; declared as ${list(f.declared.map((d) => `"${d}"`))}` : ''
      }`,
      examples(doc, f.xs),
      { kind: 'family', family: f.family, declared: f.declared, share: r2(f.chars / total), elements: f.xs.length, roles, mono: f.mono },
    );
  }
  for (const f of textFamilies.slice(1)) {
    if (!lead || lead.chars / total < 0.5) break;
    if (f.xs.length > TYPE_REFERENCE.isolatedElements || f.chars / total > TYPE_REFERENCE.isolatedShare) continue;
    item(items, `${f.family} is used only by ${list(f.xs.map((x) => doc.describe(x.el)))}`, examples(doc, f.xs), {
      kind: 'isolated',
      family: f.family,
      elements: f.xs.length,
      roles: roleCounts(f.xs),
    });
  }
  const fellBack = [...tally(valid.filter((x) => x.family.fellBack), (x) => `${x.family.declared}→${x.family.rendered}`).values()];
  for (const xs of fellBack) {
    const f = xs[0].family;
    item(items, `The web font "${f.declared}" did not render; ${xs.length} element${xs.length > 1 ? 's' : ''} fell back to ${f.rendered}`, examples(doc, xs), {
      kind: 'fallback',
      declared: f.declared,
      rendered: f.rendered,
      elements: xs.length,
    });
  }
  const mono = families.filter((f) => f.mono);
  const summary = lead
    ? `${textFamilies.length} text famil${textFamilies.length === 1 ? 'y' : 'ies'}: ${list(textFamilies.slice(0, 4).map((f) => `${f.family} ${pct(f.chars / total)}`))}${
        mono.length ? `. Monospace: ${list(mono.map((f) => `${f.family} ${pct(f.chars / total)}`))}` : ''
      }${icons ? `. ${icons} icon-font element${icons > 1 ? 's' : ''} excluded` : ''}.`
    : 'No visible text.';
  if (textFamilies.length > TYPE_REFERENCE.textFamilies) {
    item(items, summary, textFamilies.slice(1).map((f) => doc.ref(f.xs[0].el)).slice(0, MAX_EXAMPLES), {
      kind: 'family_count',
      families: textFamilies.map((f) => ({ family: f.family, share: r2(f.chars / total), elements: f.xs.length })),
    });
  }
  return {
    status: 'observed',
    evaluated: valid.length,
    summary,
    items,
    data: { families: families.map((f) => ({ family: f.family, share: r2(f.chars / total), mono: f.mono })), icons },
  };
}

// ---------- Text Size & Weight Profile ----------

export function sizeWeightProfile(doc: Doc): ObservationOutput {
  const { valid, own, bodySize } = measured(doc);
  const items: DiagnosticItem[] = [];
  const roles = [...tally(own, (x) => roleKey(x.role)).entries()].sort((a, b) => roleRank(a[0]) - roleRank(b[0]));
  const profile: Record<string, { count: number; size: number; min: number; max: number; weights: Record<string, number> }> = {};
  for (const [role, xs] of roles) {
    const sizes = xs.map((x) => x.t.size);
    const weights: Record<string, number> = {};
    for (const x of xs) weights[x.t.weight] = (weights[x.t.weight] ?? 0) + 1;
    const ws = Object.entries(weights).sort((a, b) => b[1] - a[1]);
    const p = { count: xs.length, size: roundSize(mode(sizes.map(roundSize))), min: roundSize(Math.min(...sizes)), max: roundSize(Math.max(...sizes)), weights: Object.fromEntries(ws) };
    profile[role] = p;
    const sizeText = p.min !== p.max ? `mostly ${sz(p.size)} px (${sz(p.min)}–${sz(p.max)})` : `${sz(p.size)} px`;
    const weightText = ws.length === 1 ? `weight ${ws[0][0]}` : `weights ${ws.map(([w, c]) => `${w} ×${c}`).join(', ')}`;
    item(items, `${roleLabel(role)} ${sizeText}, ${weightText} (${p.count} element${p.count > 1 ? 's' : ''})`, examples(doc, xs, 2), { kind: 'role', role, ...p });
  }

  const recurring = [...tally(valid, (x) => sz(x.t.size)).entries()].filter(([, xs]) => xs.length >= 2).map(([s]) => Number(s)).sort((a, b) => a - b);

  const small = valid.filter((x) => x.t.size < TYPE_REFERENCE.smallPx);
  for (const [size, xs] of [...tally(small, (x) => sz(x.t.size)).entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    item(items, `${xs.length} element${xs.length > 1 ? 's' : ''} at ${size} px, below 12 px (${rolesText(roleCounts(xs))})`, examples(doc, xs), {
      kind: 'small',
      size: Number(size),
      elements: xs.length,
      roles: roleCounts(xs),
    });
  }
  const light = valid.filter((x) => x.t.size < TYPE_REFERENCE.lightBelowPx && x.t.weight < TYPE_REFERENCE.lightWeight);
  for (const [key, xs] of tally(light, (x) => `${sz(x.t.size)}|${x.t.weight}`)) {
    const [size, weight] = key.split('|');
    item(items, `${xs.length} element${xs.length > 1 ? 's' : ''} at ${size} px use weight ${weight} (${rolesText(roleCounts(xs))})`, examples(doc, xs), {
      kind: 'light_small',
      size: Number(size),
      weight: Number(weight),
      elements: xs.length,
      roles: roleCounts(xs),
    });
  }

  // How many weights the page uses, and runs of weights within 50 of the next (600, 620, 650).
  const byWeight = [...tally(valid, (x) => String(x.t.weight)).entries()].map(([w, xs]) => ({ weight: Number(w), xs })).sort((a, b) => a.weight - b.weight);
  const weightText = (w: (typeof byWeight)[number]) => `${w.weight} (${w.xs.length})`;
  if (byWeight.length > TYPE_REFERENCE.weights) {
    item(items, `${byWeight.length} font weights are used (elements in brackets): ${list(byWeight.map(weightText))}`, examples(doc, byWeight.filter((w) => w.xs.length <= 2).flatMap((w) => w.xs)), {
      kind: 'weight_count',
      weights: byWeight.map((w) => ({ weight: w.weight, count: w.xs.length })),
    });
  }
  const weightChains: (typeof byWeight)[] = [];
  for (let i = 1; i < byWeight.length; i++) {
    if (byWeight[i].weight - byWeight[i - 1].weight > TYPE_REFERENCE.nearDuplicateWeight) continue;
    const last = weightChains[weightChains.length - 1];
    if (last && last[last.length - 1] === byWeight[i - 1]) last.push(byWeight[i]);
    else weightChains.push([byWeight[i - 1], byWeight[i]]);
  }
  for (const chain of weightChains) {
    item(
      items,
      chain.length === 2 ? `Weights ${list(chain.map(weightText))} are ${chain[1].weight - chain[0].weight} apart` : `Weights ${list(chain.map(weightText))} step up ${TYPE_REFERENCE.nearDuplicateWeight} or less at a time`,
      chain.flatMap((w) => examples(doc, w.xs, 1)).slice(0, MAX_EXAMPLES),
      { kind: 'near_duplicate_weights', weights: chain.map((w) => w.weight), counts: chain.map((w) => w.xs.length) },
    );
  }

  // Equivalent roles that mostly share one weight, with a few exceptions.
  for (const [role, xs] of roles) {
    const ws = Object.entries(profile[role].weights);
    if (xs.length < 3 || ws.length < 2 || ws[0][1] / xs.length < 0.6) continue;
    const odd = xs.filter((x) => String(x.t.weight) !== ws[0][0]);
    item(items, `${roleLabel(role)}: ${ws[0][1]} use weight ${ws[0][0]}; ${list(ws.slice(1).map(([w, c]) => `${c} use ${w}`))}`, examples(doc, odd), {
      kind: 'role_weights',
      role,
      weights: ws.map(([w, c]) => ({ weight: Number(w), count: c })),
    });
  }

  // Deeper headings set larger than shallower ones; headings no larger or bolder than body text.
  const levels = Object.keys(profile).filter((k) => /^h\d$/.test(k)).sort();
  for (let i = 0; i < levels.length; i++) {
    for (let j = i + 1; j < levels.length; j++) {
      const a = profile[levels[i]];
      const b = profile[levels[j]];
      if (b.size > a.size) {
        item(items, `${levels[j]} headings (${sz(b.size)} px) are set larger than ${levels[i]} headings (${sz(a.size)} px)`, [], {
          kind: 'inversion',
          upper: levels[i],
          lower: levels[j],
          sizes: [a.size, b.size],
        });
      }
    }
  }
  const body = profile.body;
  if (body) {
    const bodyWeight = Number(Object.keys(body.weights)[0]);
    for (const lv of levels) {
      const h = profile[lv];
      const hw = Number(Object.keys(h.weights)[0]);
      if (h.size <= body.size && hw <= bodyWeight) {
        item(items, `${lv} headings (${sz(h.size)} px, weight ${hw}) are no larger or bolder than body text (${sz(body.size)} px, weight ${bodyWeight})`, [], {
          kind: 'heading_like_body',
          role: lv,
          heading: { size: h.size, weight: hw },
          body: { size: body.size, weight: bodyWeight },
        });
      }
    }
  }

  return {
    status: 'observed',
    evaluated: own.length,
    summary: roles.length
      ? `${roles
          .filter(([r]) => r !== 'text')
          .slice(0, 6)
          .map(([r]) => `${roleLabel(r)} ${sz(profile[r].size)} px/${Object.keys(profile[r].weights)[0]}`)
          .join('; ')}. Smallest recurring size${recurring.length ? `: ${sz(recurring[0])} px` : ': none'}${small.length ? `; ${small.length} element${small.length > 1 ? 's' : ''} below 12 px` : ''}${
          light.length ? `; ${light.length} small element${light.length > 1 ? 's' : ''} in a light weight` : ''
        }.`
      : 'No visible text.',
    items,
    data: { profile, bodySize, smallestRecurring: recurring.slice(0, 2) },
  };
}

// ---------- Line Height ----------

function band(lines: number): string {
  return lines >= 3 ? '3+ lines' : lines === 2 ? '2 lines' : '1 line';
}

export function lineHeight(doc: Doc): ObservationOutput {
  const { own } = measured(doc);
  const items: DiagnosticItem[] = [];
  const texts = own.filter((x) => !x.t.field && x.t.lineCount > 0);
  const ratio = (x: TextEl) => (x.t.lineHeight === null ? null : x.t.lineHeight / x.t.size);
  const kindOf = (x: TextEl) => (x.role.kind === 'heading' ? 'heading' : roleKey(x.role));
  const groups = [...tally(texts, (x) => `${kindOf(x)}|${band(x.t.lineCount)}`).entries()].sort(
    (a, b) => roleRank(a[0].split('|')[0] === 'heading' ? 'h1' : a[0].split('|')[0]) - roleRank(b[0].split('|')[0] === 'heading' ? 'h1' : b[0].split('|')[0]) || a[0].localeCompare(b[0]),
  );
  for (const [key, xs] of groups) {
    const [role, lines] = key.split('|');
    const rs = xs.map(ratio).filter((r): r is number => r !== null);
    const normal = xs.length - rs.length;
    const range = rs.length ? (r2(Math.min(...rs)) === r2(Math.max(...rs)) ? `${r2(rs[0])}` : `${r2(Math.min(...rs))}–${r2(Math.max(...rs))}`) : null;
    item(
      items,
      `${role === 'heading' ? 'headings' : roleLabel(role)}, ${lines}: ${range ?? 'normal'}${range && normal ? ` (${normal} normal)` : ''} (${xs.length} element${xs.length > 1 ? 's' : ''})`,
      examples(doc, xs, 2),
      { kind: 'group', role, lines, count: xs.length, ratioMedian: rs.length ? r2(median(rs)) : null, ratioMin: rs.length ? r2(Math.min(...rs)) : null, ratioMax: rs.length ? r2(Math.max(...rs)) : null, normal },
    );
  }
  const tight = texts.filter((x) => x.role.kind !== 'heading' && x.role.kind !== 'display' && x.t.lineCount >= TYPE_REFERENCE.multilineLines && (ratio(x) ?? 9) < TYPE_REFERENCE.multilineMinRatio);
  for (const [key, xs] of tally(tight, (x) => `${roleKey(x.role)}|${r2(ratio(x)!)}`)) {
    const [role, r] = key.split('|');
    item(items, `${roleLabel(role)}: ${xs.length} element${xs.length > 1 ? 's' : ''} of ${Math.min(...xs.map((x) => x.t.lineCount))}+ lines ${xs.length > 1 ? 'use' : 'uses'} line-height ${r}`, examples(doc, xs), {
      kind: 'tight_multiline',
      role,
      ratio: Number(r),
      elements: xs.length,
      lines: xs.map((x) => x.t.lineCount),
    });
  }
  const loose = texts.filter((x) => (x.role.kind === 'heading' || x.role.kind === 'display') && x.t.lineCount >= 2 && (ratio(x) ?? 0) >= TYPE_REFERENCE.headingLooseRatio);
  for (const x of loose) {
    item(items, `${doc.describe(x.el)} (${roleLabel(roleKey(x.role))}) wraps to ${x.t.lineCount} lines with line-height ${r2(ratio(x)!)}`, [doc.ref(x.el)], {
      kind: 'loose_heading',
      role: roleKey(x.role),
      ratio: r2(ratio(x)!),
      lines: x.t.lineCount,
    });
  }
  // Characters on the longest line of body text: its share of the rendered line widths.
  const perLine = (x: TextEl) => {
    const total = x.t.lines.reduce((s, w) => s + w, 0);
    return x.t.lines.length === x.t.lineCount && total > 0 ? Math.round((x.t.chars * Math.max(...x.t.lines)) / total) : Math.round(x.t.chars / x.t.lineCount);
  };
  const wide = texts.filter((x) => x.role.kind === 'body' && perLine(x) > TYPE_REFERENCE.measureChars).sort((a, b) => perLine(b) - perLine(a));
  for (const x of wide.slice(0, MAX_EXAMPLES)) {
    item(items, `${doc.describe(x.el)} (${roleLabel(roleKey(x.role))}) runs to about ${perLine(x)} characters on its longest line (${Math.round(Math.max(...x.t.lines))} px, ${x.t.lineCount} line${x.t.lineCount > 1 ? 's' : ''})`, [doc.ref(x.el)], {
      kind: 'wide_measure',
      role: roleKey(x.role),
      chars: perLine(x),
      px: Math.round(Math.max(...x.t.lines)),
      lines: x.t.lineCount,
    });
  }
  if (wide.length > MAX_EXAMPLES) item(items, `${wide.length - MAX_EXAMPLES} more body text element${wide.length - MAX_EXAMPLES > 1 ? 's run' : ' runs'} past ${TYPE_REFERENCE.measureChars} characters per line`, examples(doc, wide.slice(MAX_EXAMPLES)), { kind: 'wide_measure', elements: wide.length - MAX_EXAMPLES });
  const body = texts.filter((x) => x.role.kind === 'body').map(ratio).filter((r): r is number => r !== null);
  const heads = texts.filter((x) => x.role.kind === 'heading').map(ratio).filter((r): r is number => r !== null);
  return {
    status: 'observed',
    evaluated: texts.length,
    summary: texts.length
      ? `${body.length ? `Body text uses ${r2(median(body))}${range(body).includes('–') ? ` (${range(body)})` : ''}` : 'No body text with a numeric line-height'}. ${
          heads.length ? `Headings use ${range(heads)}` : 'No headings with a numeric line-height'
        }.${tight.length ? ` ${tight.length} text element${tight.length > 1 ? 's' : ''} of 3+ lines below 1.4.` : ''}`
      : 'No visible text.',
    items,
  };
}

function range(values: number[]): string {
  const lo = r2(Math.min(...values));
  const hi = r2(Math.max(...values));
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

// ---------- Heading Line Balance ----------

export function headingLineBalance(doc: Doc): ObservationOutput {
  const { own } = measured(doc);
  const items: DiagnosticItem[] = [];
  const multi = own.filter((x) => (x.role.kind === 'heading' || x.role.kind === 'display') && !x.t.field && x.t.lineCount >= 2 && x.t.avail > 0 && x.t.lines.length >= 2);
  let imbalanced = 0;
  for (const x of multi) {
    const shares = x.t.lines.map((w) => r2(Math.min(1, w / x.t.avail)));
    const balance = Math.min(...x.t.lines) / Math.max(...x.t.lines);
    const flagged = balance < TYPE_REFERENCE.headingBalance;
    if (flagged) imbalanced++;
    item(
      items,
      `${doc.describe(x.el)} (${roleLabel(roleKey(x.role))}) wraps to ${x.t.lineCount} lines occupying ${list(shares.map(pct))} of the available width; text-wrap is ${x.t.wrap}`,
      [doc.ref(x.el)],
      { kind: 'heading', role: roleKey(x.role), lines: x.t.lineCount, shares, balance: r2(balance), imbalanced: flagged, wrap: x.t.wrap, availPx: Math.round(x.t.avail) },
    );
  }
  return {
    status: 'observed',
    evaluated: own.filter((x) => x.role.kind === 'heading' || x.role.kind === 'display').length,
    summary: multi.length
      ? `${multi.length} heading${multi.length > 1 ? 's wrap' : ' wraps'} to several lines; ${imbalanced} ${imbalanced === 1 ? 'has' : 'have'} a line under 40% of the longest.`
      : 'No heading wraps to more than one line.',
    items,
  };
}

// ---------- Responsive Typography Adaptation ----------

interface RoleAtWidth {
  size: number;
  weight: number;
  ratio: number | null;
}

// Runs of consecutive widths sharing a value: "48 px at 1280–1920 px, 32 px at 320–767 px".
function runs<T>(series: { width: number; v: T }[], same: (a: T, b: T) => boolean): { from: number; to: number; v: T }[] {
  const out: { from: number; to: number; v: T }[] = [];
  for (const s of series) {
    const last = out[out.length - 1];
    if (last && same(last.v, s.v)) last.to = s.width;
    else out.push({ from: s.width, to: s.width, v: s.v });
  }
  return out;
}

const widthSpan = (from: number, to: number) => (from === to ? `${from} px` : `${from}–${to} px`);

// Above this many steps an element's size is treated as fluid (clamp(), vw units).
const FLUID_STEPS = 4;

export function responsiveTypography(sweep: { width: number; doc: Doc }[]): ObservationOutput {
  const widths = [...sweep].sort((a, b) => a.width - b.width);
  const items: DiagnosticItem[] = [];
  const perWidth = widths.map(({ width, doc }) => ({ width, doc, m: measured(doc) }));
  // The same text is matched across widths by selector and content: pages that re-render on
  // resize get new elements (and IDs). Repeats of one key are told apart by order.
  const keys = new Map<TextEl, string>();
  for (const { m } of perWidth) {
    const seen = new Map<string, number>();
    for (const x of [...m.own, ...m.valid]) {
      if (keys.has(x)) continue;
      const base = `${x.el.selector}|${x.el.text ?? ''}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      keys.set(x, `${base}#${n}`);
    }
  }
  const keyOf = (x: TextEl) => keys.get(x)!;
  // Each element keeps the role it has at the widest width, so a role's values follow the same
  // text across widths (roles relative to the body size could otherwise flip as it changes).
  const fixedRole = new Map<string, TextRole>((perWidth.at(-1)?.m.own ?? []).map((x) => [keyOf(x), x.role]));
  const roleAt = (x: TextEl) => fixedRole.get(keyOf(x)) ?? x.role;
  const roles = new Map<string, { width: number; v: RoleAtWidth }[]>();
  const bodyMeasure: { width: number; px: number }[] = [];
  // Per element, its size and weight at every width where it is shown.
  const perEl = new Map<string, { x: TextEl; series: { width: number; v: { size: number; weight: number } }[] }>();
  for (const { width, m } of perWidth) {
    for (const [role, xs] of tally(m.own, (x) => roleKey(roleAt(x)))) {
      const rs = xs.map((x) => (x.t.lineHeight === null ? null : x.t.lineHeight / x.t.size)).filter((r): r is number => r !== null);
      roles.set(role, [...(roles.get(role) ?? []), { width, v: { size: mode(xs.map((x) => roundSize(x.t.size))), weight: mode(xs.map((x) => x.t.weight)), ratio: rs.length ? r2(median(rs)) : null } }]);
    }
    for (const x of m.own) {
      if (!fixedRole.has(keyOf(x))) continue;
      const e = perEl.get(keyOf(x)) ?? { x, series: [] };
      e.series.push({ width, v: { size: roundSize(x.t.size), weight: x.t.weight } });
      perEl.set(keyOf(x), e);
    }
    const body = m.own.filter((x) => roleAt(x).kind === 'body' && x.t.lines.length);
    if (body.length) bodyMeasure.push({ width, px: Math.round(Math.max(...body.flatMap((x) => x.t.lines))) });
  }

  // Elements of a role that change size or weight, grouped by how they change.
  const byRole = tally([...perEl.values()], (e) => roleKey(roleAt(e.x)));
  const ordered = [...byRole.entries()].filter(([r]) => r !== 'text').sort((a, b) => roleRank(a[0]) - roleRank(b[0]));
  const steady: string[] = [];
  const changing: string[] = [];
  for (const [role, els] of ordered) {
    const patterns = new Map<string, { els: typeof els; text: string; fluid: boolean }>();
    for (const e of els) {
      const rr = runs(e.series, (a, b) => a.size === b.size && a.weight === b.weight);
      if (rr.length < 2) continue;
      const wide = rr[rr.length - 1];
      const narrow = rr[0];
      const fluid = rr.length > FLUID_STEPS;
      const text = fluid
        ? `scale from ${sz(wide.v.size)} px/${wide.v.weight} at ${wide.to} px to ${sz(narrow.v.size)} px/${narrow.v.weight} at ${narrow.from} px in ${rr.length} steps`
        : [...rr].reverse().map((r) => `${sz(r.v.size)} px/${r.v.weight} at ${widthSpan(r.from, r.to)}`).join(', ');
      const p = patterns.get(text) ?? { els: [], text, fluid };
      p.els.push(e);
      patterns.set(text, p);
    }
    const changed = [...patterns.values()].reduce((n, p) => n + p.els.length, 0);
    const sizes = els.map((e) => e.series[e.series.length - 1].v.size);
    if (!changed) {
      steady.push(`${roleLabel(role)} (${els.length})`);
      continue;
    }
    changing.push(roleLabel(role));
    const groups = [...patterns.values()].sort((a, b) => b.els.length - a.els.length);
    const shown = groups.slice(0, 3).map((p) => `${p.els.length}: ${p.text}`);
    const rest = groups.length > 3 ? `; ${groups.slice(3).reduce((n, p) => n + p.els.length, 0)} change in other ways` : '';
    item(
      items,
      `${roleLabel(role)}: ${changed} of ${els.length} change with width (${shown.join('; ')}${rest})${changed < els.length ? `; the other ${els.length - changed} keep their size` : ''}`,
      groups.slice(0, 3).map((p) => perWidth.at(-1)!.doc.ref(p.els[0].x.el)),
      {
        kind: 'role_changes',
        role,
        elements: els.length,
        changed,
        sizesAtWidest: [...new Set(sizes)].sort((a, b) => b - a),
        patterns: groups.map((p) => ({ elements: p.els.length, fluid: p.fluid, runs: runs(p.els[0].series, (a, b) => a.size === b.size && a.weight === b.weight) })),
      },
    );
  }
  if (steady.length) item(items, `Keep the same size and weight at every width: ${list(steady)}`, [], { kind: 'role_steady', roles: steady });

  // Text that drops below 12 px only at narrower widths.
  if (perWidth.length) {
    const widest = perWidth[perWidth.length - 1];
    const wideSize = new Map(widest.m.valid.map((x) => [keyOf(x), x]));
    const shrunk = new Map<string, { x: TextEl; width: number; size: number; doc: Doc }>();
    for (const { width, doc, m } of perWidth) {
      for (const x of m.valid) {
        const wide = wideSize.get(keyOf(x));
        if (!wide || wide.t.size < TYPE_REFERENCE.smallPx || x.t.size >= TYPE_REFERENCE.smallPx) continue;
        const cur = shrunk.get(keyOf(x));
        if (!cur || width > cur.width) shrunk.set(keyOf(x), { x, width, size: x.t.size, doc });
      }
    }
    for (const [key, group] of tally([...shrunk.values()], (s) => `${roleKey(roleAt(s.x))}|${sz(wideSize.get(keyOf(s.x))!.t.size)}|${sz(s.size)}`)) {
      const [role, from, to] = key.split('|');
      const below = Math.max(...group.map((g) => g.width));
      item(items, `${roleLabel(role)}: ${group.length} element${group.length > 1 ? 's' : ''} ${group.length > 1 ? 'change' : 'changes'} from ${from} px to ${to} px at ${below} px and narrower`, group.slice(0, MAX_EXAMPLES).map((g) => g.doc.ref(g.x.el)), {
        kind: 'shrinks_below_12',
        role,
        from: Number(from),
        to: Number(to),
        belowWidth: below,
        elements: group.length,
      });
    }
  }

  // How the largest heading relates to body text at the widest and narrowest widths.
  const topRole = ordered.map(([r]) => r).find((r) => /^h\d$/.test(r) || r === 'display');
  const top = topRole ? ([topRole, roles.get(topRole) ?? []] as const) : null;
  const body = roles.get('body');
  if (top && body && widths.length >= 2) {
    const at = (series: { width: number; v: RoleAtWidth }[], w: number) => series.find((s) => s.width === w)?.v.size;
    const wide = widths[widths.length - 1].width;
    const narrow = widths[0].width;
    const [tw, bw, tn, bn] = [at(top[1], wide), at(body, wide), at(top[1], narrow), at(body, narrow)];
    if (tw && bw && tn && bn) {
      item(items, `${roleLabel(top[0])} ${rolePlural(top[0]) ? 'are' : 'is'} ${r2(tw / bw)}× body text at ${wide} px and ${r2(tn / bn)}× at ${narrow} px`, [], {
        kind: 'hierarchy',
        // The largest heading is no larger than body text at one end.
        flagged: tw <= bw || tn <= bn,
        role: top[0],
        wide: { width: wide, ratio: r2(tw / bw) },
        narrow: { width: narrow, ratio: r2(tn / bn) },
      });
    }
  }
  if (bodyMeasure.length >= 2) {
    const w = bodyMeasure[bodyMeasure.length - 1];
    const n = bodyMeasure[0];
    item(items, `The longest line of body text is ${w.px} px at ${w.width} px and ${n.px} px at ${n.width} px`, [], { kind: 'measure', wide: w, narrow: n });
  }

  return {
    status: 'observed',
    evaluated: widths.length,
    summary: `${widths.length} widths (${widths[0]?.width}–${widths[widths.length - 1]?.width} px). ${
      changing.length ? `Sizes change with width for ${list(changing)}` : 'No text role changes size across widths'
    }${items.some((i) => i.data.kind === 'shrinks_below_12') ? '; some text drops below 12 px at narrow widths' : ''}. Each element is followed across widths; its sizes are listed from the widest width down.`,
    items,
  };
}
