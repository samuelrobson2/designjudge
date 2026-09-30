// Findings-only evidence (packet v4): what each failing check found, and the observation
// measurements outside or close to their reference, in plain words. Passing checks, in-range
// measurements and how the evidence was collected are left out; selectors, boxes and raw data
// stay in the stored diagnostics.

import { FIXTURES } from '../../config.ts';
import { DIAG_NAMES } from '../../diagnostics/run.ts';
import type { Bundle, DiagnosticItem, DiagnosticResult, Diagnostics, ElementRef, Rect, StateRecord } from '../../types.ts';
import type { EvidenceIndexEntry } from '../types.ts';
import { DIAGNOSTIC_HOME } from './homes.ts';
import type { ParsedRubric } from './rubric.ts';

// An observation measurement is shown only when it is outside its rubric reference or inside
// one of these bands close to it.
export const CLOSE_TO_REFERENCE = {
  // Between-group ÷ within-group spacing below this (reference ~2×).
  groupingRatio: 2.5,
  // Edge-to-edge clearance between neighbouring controls or boxes below this (reference ~12 px).
  // The observation itemises only pairs below 12 px, so every itemised pair qualifies.
  clearancePx: 15,
  // Inline inset of text or controls from the screen edge at narrow widths below this (reference ~16 px).
  narrowInsetPx: 20,
  // Deviation from peers sharing a component-type label at or above this (reference 25%). The
  // observation itemises only deviations above 25%, so every itemised peer qualifies.
  peerDeviation: 0.2,
  // Size changes across widths. Shrinking with the viewport is ordinary, so a change is large
  // only when a component keeps under a tenth of its widest area, ends narrower than
  // compressedWidthPx after being at least twice that wide, or is an image, video, canvas or svg
  // whose aspect ratio changes by mediaAspectChange or more (distortion).
  areaShrink: 0.9,
  compressedWidthPx: 120,
  mediaAspectChange: 0.25,
};

const MAX_ISSUES_PER_CHECK = 8;
const MAX_LINES_PER_OBSERVATION = 10;
const MAX_TRANSITIONS = 5;
const MAX_NAMES = 3;

export interface FindingLine {
  // The first ID is the one to cite; the others are the same issue in other states.
  ids: string[];
  text: string;
  where: string;
  // Page boxes of the elements involved, in states that have a screenshot (not rendered).
  boxes?: { stateId: string; rect: Rect; fixed?: boolean }[];
  // Whether the issue belongs to particular states (sweep-wide results do not).
  located?: boolean;
  // How bad the issue is in each state (overflow px, share hidden, …), to pick a screenshot.
  severity?: Record<string, number>;
  // Set when screenshots are marked: the finding's label and the screenshots showing it.
  marker?: string;
  marked_in?: string[];
}

export interface CheckBlock {
  check: string;
  detects: string;
  issues: FindingLine[];
  more_issues?: number;
  not_counted: string[];
}

export interface ObservationBlock {
  observation: string;
  measures: string;
  reference: string;
  lines: FindingLine[];
}

export interface FindingsCriterion {
  criterion: string;
  name: string;
  checks: CheckBlock[];
  observations: ObservationBlock[];
}

export interface FindingsState {
  state: string;
  text: string;
  pseudo: boolean;
}

// Where the rubric gives no "what it measures" text.
const MEASURES_FALLBACK: Record<string, string> = {
  interactive_reachability: 'interactive elements that cannot be fully revealed by scrolling, because a container or the screen edge cuts them off',
  spatial_grouping: 'spacing inside and between groups, clearance between neighbouring controls and boxes, and inset from the screen edge on narrow screens',
  alignment_outliers: 'whether repeated peer elements share edges or centres',
  responsive_adaptation: 'how components change size and structure as the width changes',
  layout_stability: 'unexpected layout shifts while the page loads',
};

const CHECK_ORDER = ['region_overlap', 'container_overflow', 'page_horizontal_overflow', 'interactive_reachability', 'collapsed_dimensions', 'occluded_content', 'responsive_layout_failures'];
const OBSERVATION_ORDER = ['spatial_grouping', 'alignment_outliers', 'responsive_adaptation', 'layout_stability'];
const ANCHORS = ['desktop', 'tablet', 'mobile', 'stress-desktop'];

// ---------- States in plain words ----------

const DEVICE: Record<string, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Phone' };
const FIXTURE_WORDS: Record<string, string> = {
  empty: 'empty content',
  typical: 'typical content',
  dense: 'dense content',
  expanded: 'longer pseudo-localized text',
  stress: 'stress content',
};
const ROLE_NOUN: Record<string, string> = { a: 'link', radio: 'option', tr: 'row', menuitem: 'menu item', combobox: 'dropdown', li: 'list item' };

function clickedControl(description: string | undefined): { phrase: string; effects: string[] } | null {
  const m = description?.match(/^After clicking (\S+) "(.+?)"(?=:|$)/);
  if (!m) return null;
  // What the interaction did, not how much of the screen changed.
  const effects = description!
    .slice(m[0].length)
    .replace(/^:\s*/, '')
    .split(/;\s*/)
    .filter((e) => e && !/%|\bpx\b|moved or resized|content appeared|content was removed|became \d+/.test(e));
  return { phrase: `after clicking the "${m[2]}" ${ROLE_NOUN[m[1]] ?? m[1]}`, effects };
}

export function stateName(s: StateRecord): string {
  const device = DEVICE[s.viewportId] ?? s.viewportId;
  if (s.kind === 'baseline') return `${device} ${s.viewport.width}×${s.viewport.height}`;
  if (s.kind === 'stress') return `Stress (${s.viewportId})`;
  if (s.kind === 'sweep') return `Width ${s.viewport.width} px`;
  if (s.kind === 'fixture') return `${device} with ${FIXTURE_WORDS[s.fixture ?? ''] ?? s.fixture}`;
  const click = clickedControl(s.interactiveDescription);
  return click ? `${device} ${click.phrase}` : `${device}: ${s.interactiveDescription ?? s.label}`;
}

function stateLine(s: StateRecord): FindingsState {
  const name = stateName(s);
  const pseudo = s.fixture === 'stress' || s.fixture === 'expanded';
  if (s.fixture === 'stress') {
    const k = s.stressFill?.kept;
    const filled = !!k && Object.values(k).some((n) => typeof n === 'number' && n > 0);
    return { state: s.id, text: `${name}: dense content, longer pseudo-localized text${filled ? ', form controls filled in' : ''}`, pseudo };
  }
  const effects = s.kind === 'interactive' ? clickedControl(s.interactiveDescription)?.effects ?? [] : [];
  return { state: s.id, text: effects.length ? `${name}: ${effects.join('; ')}` : name, pseudo };
}

// ---------- Elements in plain words ----------

const TAG_NOUN: Record<string, string> = {
  a: 'link', button: 'button', input: 'field', select: 'dropdown', textarea: 'text box', img: 'image', svg: 'graphic', video: 'video',
  canvas: 'canvas', table: 'table', tr: 'table row', td: 'table cell', th: 'table header', ul: 'list', ol: 'list', dl: 'list', li: 'list item',
  nav: 'navigation', header: 'header', footer: 'footer', aside: 'side panel', main: 'main area', form: 'form', fieldset: 'group',
  legend: 'legend', label: 'label', section: 'section', article: 'card', dialog: 'dialog', p: 'text', option: 'option', summary: 'summary',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
};
// Controls, headings and text are named by their label (the "Search" button); containers by what
// they are (the compare bar "Compare cars").
const LABEL_FIRST = new Set(['a', 'button', 'input', 'select', 'textarea', 'img', 'label', 'li', 'tr', 'td', 'th', 'p', 'legend', 'option', 'summary', 'fieldset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
// Class words ending in one of these already say what the element is.
const STRUCTURAL = new Set([
  'card', 'bar', 'topbar', 'panel', 'list', 'table', 'section', 'grid', 'row', 'group', 'menu', 'header', 'footer', 'form', 'button', 'field',
  'chip', 'item', 'body', 'strip', 'layout', 'nav', 'sidebar', 'container', 'wrapper', 'box', 'area', 'region', 'toolbar', 'dialog', 'modal',
  'banner', 'chart', 'plot', 'image', 'label', 'link', 'actions', 'foot', 'head', 'price', 'name', 'badge', 'tile', 'inner',
]);
// Class words too generic on their own; the parent's words are prefixed.
const GENERIC = new Set(['grid', 'list', 'row', 'body', 'inner', 'wrapper', 'container', 'content', 'items', 'wrap']);
const MEDIA_TAGS = new Set(['img', 'svg', 'video', 'canvas', 'picture']);

interface Named {
  key: string;
  noun: string;
  label: string | null;
  labelFirst: boolean;
  // The data-component ID, used only when the element has no label.
  component?: string | null;
}

function humanize(token: string): string {
  return token
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => (w === 'btn' ? 'button' : w === 'img' ? 'image' : w.toLowerCase()))
    .join(' ');
}

function segmentTag(seg: string): string {
  return seg.match(/^[a-z][a-z0-9-]*/i)?.[0].toLowerCase() ?? 'element';
}

function segmentWords(seg: string, allowId: boolean): string | null {
  const classes = [...seg.matchAll(/\.([\w-]+)/g)].map((m) => m[1]).filter((c) => !c.includes('--') && !/^(is|has|js|u)-/.test(c));
  const last = classes[classes.length - 1];
  if (last) return humanize(last);
  const id = seg.match(/#([\w-]+)/)?.[1];
  return allowId && id ? humanize(id) : null;
}

function cleanLabel(s: string | null | undefined): string | null {
  const t = s?.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The element's label as the check's summary gives it: accessible name, else visible text.
function labelIn(summary: string, selector: string): string | null {
  const m = summary.match(new RegExp(`${escapeRe(selector)}(?: \\[[^\\]]*\\])? "([^"]*)"`));
  return m ? cleanLabel(m[1]) : null;
}

function namedFromSelector(selector: string, label: string | null, componentId: string | null = null): Named {
  const segs = selector.split(' > ');
  const last = segs[segs.length - 1];
  const tag = segmentTag(last);
  const tagNoun = TAG_NOUN[tag] ?? '';
  const parent = segs.length > 1 ? segmentWords(segs[segs.length - 2], true) : null;
  if (LABEL_FIRST.has(tag) && label) return { key: selector, noun: tagNoun, label, labelFirst: true };
  let own = segmentWords(last, !tagNoun);
  if (own && GENERIC.has(own) && parent) own = `${parent} ${own}`;
  let noun: string;
  if (own) noun = tagNoun && !STRUCTURAL.has(own.split(' ').pop()!) && !own.endsWith(tagNoun) ? `${own} ${tagNoun}` : own;
  else noun = tagNoun ? (parent ? `${parent} ${tagNoun}` : tagNoun) : parent ? `${parent} element` : 'element';
  return { key: selector, noun, label, labelFirst: LABEL_FIRST.has(tag), component: label ? null : componentId };
}

function named(e: ElementRef, summary = ''): Named {
  return namedFromSelector(e.selector, cleanLabel(e.name) ?? labelIn(summary, e.selector), e.componentId);
}

function one(n: Named): string {
  if (n.label) return n.labelFirst ? `the "${n.label}" ${n.noun}` : `the ${n.noun} "${n.label}"`;
  return n.component ? `the ${n.noun} (${n.component})` : `the ${n.noun}`;
}

// "the topbar (mobile-topbar)" + "sticky" → "the topbar (mobile-topbar, sticky)".
function withNote(text: string, note: string): string {
  return text.endsWith(')') ? `${text.slice(0, -1)}, ${note})` : `${text} (${note})`;
}

function plural(noun: string): string {
  return /(s|x|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`;
}

function orList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function quoted(labels: string[]): string {
  const shown = labels.slice(0, MAX_NAMES).map((l) => `"${l}"`);
  return labels.length > shown.length ? `${shown.join(', ')} and ${labels.length - shown.length} more` : andList(shown);
}

function firstByKey<T>(list: T[], key: (x: T) => string): T[] {
  const out = new Map<string, T>();
  for (const x of list) if (!out.has(key(x))) out.set(key(x), x);
  return [...out.values()];
}

function isPlural(list: Named[], instances = 1): boolean {
  return instances > 1 || firstByKey(list, (n) => n.key).length > 1;
}

// Several elements in plain words. The same element seen in several states is named once (with
// its label from the first state); elements of the same kind are grouped; `instances` counts
// repeats of an unlabelled element, such as the same part of several cards.
function names(list: Named[], instances = 1): string {
  const unique = firstByKey(list, (n) => n.key);
  const byNoun = new Map<string, { labelFirst: boolean; labels: string[]; components: string[] }>();
  for (const n of unique) {
    const g = byNoun.get(n.noun) ?? { labelFirst: n.labelFirst, labels: [], components: [] };
    if (n.label && !g.labels.includes(n.label)) g.labels.push(n.label);
    else if (n.component && !g.components.includes(n.component)) g.components.push(n.component);
    byNoun.set(n.noun, g);
  }
  const parts = [...byNoun.entries()].map(([noun, g]) => {
    if (g.labels.length === 1) return one({ key: '', noun, label: g.labels[0], labelFirst: g.labelFirst });
    if (g.labels.length) return g.labelFirst ? `the ${quoted(g.labels)} ${plural(noun)}` : `the ${plural(noun)} ${quoted(g.labels)}`;
    if (g.components.length === 1) return one({ key: '', noun, label: null, labelFirst: false, component: g.components[0] });
    if (g.components.length) return `the ${plural(noun)} (${andList(g.components.slice(0, MAX_NAMES))}${g.components.length > MAX_NAMES ? ` and ${g.components.length - MAX_NAMES} more` : ''})`;
    return `the ${noun}${instances > 1 ? ` (${instances} instances)` : ''}`;
  });
  return andList(parts.slice(0, MAX_NAMES)) + (parts.length > MAX_NAMES ? ` and ${parts.length - MAX_NAMES} more` : '');
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const px = (n: number) => String(Math.round(n));
const px1 = (n: number) => String(Math.round(n * 10) / 10);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const ratio = (r: number) => `${r < 0.1 ? r.toFixed(2) : r.toFixed(1).replace(/\.0$/, '')}×`;

// "27%" or "27–100%".
function span(values: number[], fmt: (n: number) => string, unit = ''): string {
  const lo = fmt(Math.min(...values));
  const hi = fmt(Math.max(...values));
  return lo === hi ? `${hi}${unit}` : `${lo.replace(/[^\d.]+$/, '')}–${hi}${unit}`;
}

// Identity of an element across states: the last three selector segments without state classes.
// Without positions too (`peers`), repeated peers such as the same part of every card share it.
function norm(selector: string, peers = true): string {
  return selector
    .split(' > ')
    .slice(-3)
    .map((seg) => {
      const id = seg.match(/#[\w-]+/)?.[0] ?? '';
      const cls = [...seg.matchAll(/\.([\w-]+)/g)].map((m) => m[1]).find((c) => !/^(is|has|js)-/.test(c));
      const at = peers ? '' : (seg.match(/:nth-of-type\(\d+\)/)?.[0] ?? '');
      return `${segmentTag(seg)}${id}${cls ? `.${cls}` : ''}${at}`;
    })
    .join('>');
}

// ---------- Builder ----------

interface Entry {
  r: DiagnosticResult;
  it: DiagnosticItem;
}

interface Group {
  key: string;
  entries: Entry[];
}

const NOT_COUNTED: Record<string, string> = {
  truncated: 'deliberate text truncation',
  media_decorative_overlap: 'overlap with media or decorative elements',
  possibly_disclosed: 'controls inside a closed off-canvas panel',
};

export function buildFindingsEvidence(
  bundle: Bundle,
  diags: Diagnostics,
  rubric: ParsedRubric,
  screenshotStates: Set<string>,
  index: Record<string, EvidenceIndexEntry>,
  // States whose screenshots could show an issue (element boxes are kept for these).
  boxStates: Set<string> = screenshotStates,
): { states: FindingsState[]; criteria: FindingsCriterion[] } {
  const byId = new Map(bundle.states.map((s) => [s.id, s]));
  const sweepWidths = [...(bundle.sweep?.widths ?? [])].sort((a, b) => a - b);
  const interactiveOrder = bundle.states.filter((s) => s.kind === 'interactive').map((s) => s.id);
  const stateRank = (id: string | null): number => {
    if (id === null) return 10_000;
    const a = ANCHORS.indexOf(id);
    if (a >= 0) return a;
    const s = byId.get(id);
    if (!s) return 9_000;
    if (s.kind === 'interactive') return 10 + interactiveOrder.indexOf(id);
    if (s.kind === 'fixture') return 100 + ['desktop', 'tablet', 'mobile'].indexOf(s.viewportId) * 10 + FIXTURES.indexOf(s.fixture!);
    if (s.kind === 'sweep') return 1_000 + s.viewport.width;
    return 5_000;
  };
  const byRank = (a: DiagnosticResult, b: DiagnosticResult) => stateRank(a.stateId) - stateRank(b.stateId);
  const statesWithFindings = new Set<string>();
  const shortName = (id: string | null) => {
    const s = byId.get(id ?? '');
    if (!s) return id ?? 'all widths';
    if (s.kind === 'baseline') return (DEVICE[s.viewportId] ?? s.viewportId).toLowerCase();
    return s.kind === 'stress' ? 'stress' : stateName(s);
  };

  // Where an issue occurs, in plain words: named states, content variants grouped by device,
  // and runs of consecutive sweep widths.
  const where = (stateIds: (string | null)[]): string => {
    const ids = [...new Set(stateIds)].sort((a, b) => stateRank(a) - stateRank(b));
    const parts: string[] = [];
    const fixtures = new Map<string, string[]>();
    const widths: number[] = [];
    for (const id of ids) {
      if (id === null) {
        parts.push('across widths');
        continue;
      }
      statesWithFindings.add(id);
      const s = byId.get(id);
      if (!s) parts.push(id);
      else if (s.kind === 'sweep') widths.push(s.viewport.width);
      else if (s.kind === 'fixture') fixtures.set(s.viewportId, [...(fixtures.get(s.viewportId) ?? []), FIXTURE_WORDS[s.fixture!] ?? s.fixture!]);
      else parts.push(stateName(s));
    }
    for (const [vp, words] of fixtures) parts.push(`${(DEVICE[vp] ?? vp).toLowerCase()} with ${orList(words)}`);
    if (widths.length) {
      const runs: number[][] = [];
      for (const w of widths) {
        const last = runs[runs.length - 1];
        if (last && sweepWidths.indexOf(w) === sweepWidths.indexOf(last[last.length - 1]) + 1) last.push(w);
        else runs.push([w]);
      }
      parts.push(`at ${widths.length === 1 ? 'width' : 'widths'} ${andList(runs.map((r) => (r.length === 1 ? `${r[0]}` : `${r[0]}–${r[r.length - 1]}`)))} px`);
    }
    return parts.join('; ');
  };

  const resultId = (r: DiagnosticResult) => `${r.kind === 'deterministic' ? 'C' : 'O'}-${r.diagId}${r.stateId ? `-${r.stateId}` : ''}`;
  const itemId = (r: DiagnosticResult, it: DiagnosticItem) =>
    r.kind === 'deterministic' ? `F-${r.diagId}${r.stateId ? `-${r.stateId}` : ''}-${it.n}` : `${resultId(r)}-${it.n}`;
  const registerResult = (r: DiagnosticResult) => {
    index[resultId(r)] = { type: r.kind === 'deterministic' ? 'check' : 'observation', stateId: r.stateId, resultKey: r.key, status: r.status };
  };
  const register = (entries: Entry[]) => {
    for (const { r, it } of entries) {
      registerResult(r);
      index[itemId(r, it)] = { type: r.kind === 'deterministic' ? 'check_item' : 'observation_item', stateId: r.stateId, resultKey: r.key, itemN: it.n };
    }
  };
  // One ID per state: the group's first item in that state.
  const lineIds = (entries: Entry[]) => {
    const seen = new Set<string | null>();
    return entries.filter((e) => !seen.has(e.r.stateId) && seen.add(e.r.stateId)).map((e) => itemId(e.r, e.it));
  };
  // Checks mark up to three of their elements (the container, the offenders, what covers what);
  // observations mark the group, pair or element measured.
  const boxesOf = (g: Group) => {
    const out: { stateId: string; rect: Rect; fixed?: boolean }[] = [];
    const seen = new Set<string>();
    for (const { r, it } of g.entries) {
      if (!r.stateId || !boxStates.has(r.stateId)) continue;
      const els = it.elements.slice(0, r.kind === 'deterministic' ? 3 : r.diagId === 'alignment_outliers' ? 1 : 2);
      for (const el of els) {
        const k = `${r.stateId}|${el.selector}`;
        if (seen.has(k) || !(el.rect?.w > 0) || !(el.rect?.h > 0)) continue;
        seen.add(k);
        out.push({ stateId: r.stateId, rect: el.rect, ...(el.fixed ? { fixed: true } : {}) });
      }
    }
    return out;
  };
  const severityOf = (g: Group) => {
    const out: Record<string, number> = {};
    for (const { r, it } of g.entries) {
      if (!r.stateId) continue;
      const d = it.data as Record<string, unknown>;
      const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : null);
      const v = num('overflowPx') ?? ((num('maxHiddenFraction') ?? num('clippedFraction') ?? num('proportion') ?? 0) * 1000 || 1);
      out[r.stateId] = Math.max(out[r.stateId] ?? 0, v);
    }
    return out;
  };
  const line = (g: Group, text: string): FindingLine => {
    register(g.entries);
    return {
      ids: lineIds(g.entries),
      text,
      where: where(g.entries.map((e) => e.r.stateId)),
      boxes: boxesOf(g),
      located: g.entries.some((e) => e.r.stateId !== null),
      severity: severityOf(g),
    };
  };
  const groupBy = (entries: Entry[], keyOf: (e: Entry) => string): Group[] => {
    const groups = new Map<string, Group>();
    for (const e of entries) {
      const key = keyOf(e);
      const g = groups.get(key) ?? { key, entries: [] };
      g.entries.push(e);
      groups.set(key, g);
    }
    return [...groups.values()];
  };
  // The most items of one group in a single state (repeated peers merged into one line).
  const instances = (g: Group) => {
    const perState = new Map<string | null, number>();
    for (const e of g.entries) perState.set(e.r.stateId, (perState.get(e.r.stateId) ?? 0) + 1);
    return Math.max(...perState.values());
  };
  const elementsOf = (g: Group, pick: (it: DiagnosticItem) => ElementRef[]) => g.entries.flatMap((e) => pick(e.it).map((el) => named(el, e.it.summary)));
  const nums = (g: Group, key: string) => g.entries.map((e) => e.it.data[key]).filter((v): v is number => typeof v === 'number');

  const results = diags.results.filter((r) => r.stateId === null || byId.get(r.stateId)?.status === 'collected');

  // ----- Failing checks -----

  const issueKey: Record<string, (e: Entry) => string> = {
    region_overlap: ({ it }) => it.elements.slice(0, 2).map((e) => norm(e.selector)).sort().join('|'),
    container_overflow: ({ it }) => `${it.data.kind}:${it.data.axis}:${it.data.kind === 'root_clipped' ? 'root' : norm(it.elements[0]?.selector ?? '')}`,
    page_horizontal_overflow: () => 'page',
    interactive_reachability: ({ it }) =>
      `${norm(it.elements[0]?.selector ?? '')}:${(it.data.edges as string[] | undefined)?.join('/')}:${it.data.clippingAncestor === 'viewport' ? 'viewport' : norm(String(it.data.clippingAncestor))}`,
    collapsed_dimensions: ({ it }) => norm(it.elements[0]?.selector ?? ''),
    occluded_content: ({ it }) => {
      const byElement = it.data.obstruction === 'element';
      const hidden = [...new Set((byElement ? it.elements.slice(1) : it.elements).map((e) => norm(e.selector)))].sort();
      return `${byElement ? norm(it.elements[0]?.selector ?? '') : it.data.obstruction}:${it.data.pinned}:${hidden.join(',')}`;
    },
  };
  const direction = (axis: unknown) => (axis === 'y' ? 'vertically' : 'horizontally');

  const issueText: Record<string, (g: Group) => string> = {
    region_overlap: (g) => {
      const n = instances(g);
      const first = elementsOf(g, (it) => it.elements.slice(0, 1));
      return `${capital(names(first))} ${isPlural(first, n) ? 'overlap' : 'overlaps'} ${names(elementsOf(g, (it) => it.elements.slice(1, 2)))}${
        n > 1 ? ` (${n} pairs)` : ''
      }, covering ${span(nums(g, 'proportion'), pct)} of the smaller element.`;
    },
    container_overflow: (g) => {
      const first = g.entries[0].it;
      const amount = `${span(nums(g, 'overflowPx'), px)} px`;
      if (first.data.kind === 'root_clipped') {
        return `Content extends ${amount} beyond the screen edge but the page cannot scroll sideways, so it is cut off: ${names(elementsOf(g, (it) => it.elements))}.`;
      }
      const containers = elementsOf(g, (it) => it.elements.slice(0, 1));
      const container = names(containers, instances(g));
      const offenders = elementsOf(g, (it) => it.elements.slice(1));
      const cause = offenders.length ? ` Content that does not fit: ${names(offenders)}.` : '';
      const pl = isPlural(containers, instances(g));
      return first.data.kind === 'clipped'
        ? `${capital(container)} ${pl ? 'cut' : 'cuts'} off ${amount} of ${pl ? 'their' : 'its'} content ${direction(first.data.axis)} (${pl ? 'their' : 'its'} overflow is hidden).${cause}`
        : `Content spills ${amount} ${direction(first.data.axis)} out of ${container}.${cause}`;
    },
    page_horizontal_overflow: (g) => {
      const offenders = elementsOf(g, (it) => it.elements.slice(0, 3));
      const noMeta = g.entries.some((e) => !e.it.data.viewportMeta);
      return `The page scrolls sideways: it is ${span(nums(g, 'documentWidth'), px)} px wide, ${span(nums(g, 'overflowPx'), px)} px wider than the screen.${
        offenders.length ? ` Widest content: ${names(offenders)}.` : ''
      }${noMeta ? ' The page declares no viewport meta tag, so a phone browser would lay it out at 980 px and scale it down.' : ''}`;
    },
    interactive_reachability: (g) => {
      const first = g.entries[0].it;
      const els = elementsOf(g, (it) => it.elements.slice(0, 1));
      const el = names(els, instances(g));
      const edges = (first.data.edges as string[] | undefined)?.join(' and ') || 'edge';
      const mode = String(first.data.overflowMode ?? '');
      let by: string;
      if (first.data.clippingAncestor === 'viewport') {
        by =
          mode === 'fixed'
            ? 'the screen edge (it is fixed in place, so scrolling cannot reveal it)'
            : mode.includes('locked')
              ? 'the screen edge (the page cannot scroll)'
              : 'the end of the scrollable page';
      } else {
        const clipper = first.elements[1] ? one(named(first.elements[1], first.summary)) : 'its container';
        by = ['auto', 'scroll'].includes(mode) ? `${clipper}, a scroll area that cannot scroll far enough` : `${clipper}, which hides its overflow`;
      }
      return `${capital(el)} cannot be fully revealed: ${span(nums(g, 'clippedFraction'), pct)} of ${isPlural(els, instances(g)) ? 'the worst one' : 'it'} is cut off at the ${edges} by ${by}.`;
    },
    collapsed_dimensions: (g) => {
      const first = g.entries[0].it;
      const t = first.data.threshold as { width: number; height: number } | null;
      const sizes = [...new Set(g.entries.map((e) => `${px(e.it.data.width as number)}×${px(e.it.data.height as number)}`))];
      const els = elementsOf(g, (it) => it.elements.slice(0, 1));
      return `${capital(names(els, instances(g)))} (${first.data.componentType}) ${isPlural(els, instances(g)) ? 'render' : 'renders'} at ${sizes.slice(0, 3).join(', ')} px${
        t ? `, below its minimum of ${t.width}×${t.height} px` : ''
      }.`;
    },
    occluded_content: (g) => {
      const first = g.entries[0].it;
      const byElement = first.data.obstruction === 'element';
      const hiddenEls = elementsOf(g, (it) => (byElement ? it.elements.slice(1) : it.elements));
      const count = Math.max(...nums(g, 'hiddenElements'));
      const listed = new Set(hiddenEls.map((n) => n.key)).size;
      const hidden = count > listed ? `${count} elements, including ${names(hiddenEls)},` : names(hiddenEls);
      const when = first.data.pinned ? 'while it is pinned in place' : 'at every scroll position';
      const pos = first.data.obstructionPosition;
      const layer = byElement ? one(named(first.elements[0], first.summary)) : '';
      const by = byElement
        ? `covered by ${pos === 'fixed' || pos === 'sticky' ? withNote(layer, String(pos)) : layer}`
        : ({
            off_page: 'cut off by the page edge, where the page cannot scroll',
            off_screen: 'cut off by the screen edge (a pinned element extends past it)',
            unsafe_area: "under the device's unsafe area (the page draws under it with viewport-fit=cover)",
          }[String(first.data.obstruction)] ?? `hidden by ${first.data.obstruction}`);
      const fractions = nums(g, 'maxHiddenFraction');
      return `${capital(hidden)} ${count > 1 ? 'are' : 'is'} ${by} ${when}; ${
        count > 1 ? `up to ${pct(Math.max(...fractions))} of each` : `${span(fractions, pct)} of it`
      } is never visible.`;
    },
  };

  const secondaryText = (kind: string, it: DiagnosticItem): string => {
    const els = it.elements.map((e) => one(named(e, it.summary)));
    if (kind === 'truncated') return `${els[0]} truncates its text (${it.data.axis === 'y' ? 'line clamp' : 'ellipsis'})`;
    if (kind === 'possibly_disclosed') return `${els[0]} sits in ${els[1] ?? 'an off-canvas container'}`;
    return `${els[0]} overlaps ${els[1] ?? 'another element'}`;
  };

  const controlAvailability = (): CheckBlock | null => {
    const r = results.find((x) => x.diagId === 'responsive_layout_failures' && x.status === 'fail');
    const items = r?.items.filter((it) => it.data.check === 'control_availability') ?? [];
    if (!r || !items.length) return null;
    return {
      check: DIAG_NAMES.responsive_layout_failures,
      detects: 'controls that can be used at narrower and at wider widths but not in a band of widths between them',
      issues: items.map((it) => {
        const role = String(it.data.control ?? '').split('|')[0];
        const control = one({ key: '', noun: TAG_NOUN[role] ?? ROLE_NOUN[role] ?? (role || 'control'), label: cleanLabel(it.summary.match(/"(.+?)"/)?.[1]), labelFirst: true });
        const missing = it.data.missingWidths as number[];
        const band = missing.length > 1 ? `widths ${missing[0]}–${missing[missing.length - 1]} px` : `${missing[0]} px`;
        return line({ key: '', entries: [{ r, it }] }, `${capital(control)} can be used at ${it.data.availableBelow} px and at ${it.data.availableAbove} px but not at ${band}.`);
      }),
      not_counted: [],
    };
  };

  const checkBlock = (diagId: string): CheckBlock | null => {
    if (diagId === 'responsive_layout_failures') return controlAvailability();
    const failed = results.filter((r) => r.diagId === diagId && r.kind === 'deterministic' && r.status === 'fail' && r.stateId !== null).sort(byRank);
    if (!failed.length) return null;
    const groups = groupBy(
      failed.flatMap((r) => r.items.map((it) => ({ r, it }))),
      issueKey[diagId] ?? (({ it }) => it.summary),
    );
    const shown = groups.slice(0, MAX_ISSUES_PER_CHECK);
    const notCounted = new Map<string, { states: (string | null)[]; examples: string[]; count: number }>();
    for (const r of failed) {
      for (const sec of r.secondary) {
        if (!sec.items.length) continue;
        const e = notCounted.get(sec.kind) ?? { states: [], examples: [], count: 0 };
        e.states.push(r.stateId);
        e.count = Math.max(e.count, sec.items.length);
        for (const it of sec.items) {
          const t = secondaryText(sec.kind, it);
          if (e.examples.length < 2 && !e.examples.includes(t)) e.examples.push(t);
        }
        notCounted.set(sec.kind, e);
      }
    }
    return {
      check: DIAG_NAMES[diagId] ?? diagId,
      detects: rubric.diagnostics.find((d) => d.diagId === diagId)?.measures ?? MEASURES_FALLBACK[diagId] ?? '',
      issues: shown.map((g) => line(g, issueText[diagId]?.(g) ?? g.entries[0].it.summary)),
      ...(groups.length > shown.length ? { more_issues: groups.length - shown.length } : {}),
      not_counted: [...notCounted.entries()].map(
        ([kind, e]) => `${capital(NOT_COUNTED[kind] ?? kind)}: ${e.count} item${e.count > 1 ? 's' : ''}, for example ${andList(e.examples)} (${where(e.states)}).`,
      ),
    };
  };

  // ----- Observations -----

  const C = CLOSE_TO_REFERENCE;
  const observed = (diagId: string) => results.filter((r) => r.diagId === diagId && r.status === 'observed').sort(byRank);
  const entriesOf = (diagId: string, keep: (it: DiagnosticItem) => boolean) => observed(diagId).flatMap((r) => r.items.filter(keep).map((it) => ({ r, it })));
  const lines = (groups: Group[], text: (g: Group) => string) => groups.slice(0, MAX_LINES_PER_OBSERVATION).map((g) => line(g, text(g)));

  const spatialGrouping = (): FindingLine[] => {
    const isRelation = (it: DiagnosticItem) => typeof it.data.ratio === 'number' && it.data.gapPx === undefined && it.data.side === undefined;
    const relations = groupBy(
      entriesOf('spatial_grouping', (it) => isRelation(it) && (it.data.ratio as number) < C.groupingRatio),
      ({ it }) => `${it.data.level ?? 'groups'}:${norm(it.elements[0]?.selector ?? '', false)}`,
    );
    const relationText = (g: Group) => {
      const it = g.entries[0].it;
      const root = it.elements[0];
      const legend = it.elements.find((e) => e.tag === 'legend' && e.name);
      const rootName = root
        ? one(namedFromSelector(root.selector, cleanLabel(root.name) ?? labelIn(it.summary, root.selector) ?? cleanLabel(legend?.name), root.componentId))
        : 'a group';
      const n = Math.max(...nums(g, 'groups'));
      // A value that is the same in every state reads once; otherwise each state's value is given.
      const perState = firstByKey(g.entries, (e) => String(e.r.stateId));
      const value = (key: string, fmt: (v: number) => string) => {
        const vals = perState.map((e) => fmt(e.it.data[key] as number));
        return new Set(vals).size === 1 ? vals[0] : andList(vals.map((v, i) => `${v} on ${shortName(perState[i].r.stateId)}`));
      };
      const between = value('betweenMedianPx', (v) => `${px(v)} px`);
      const within = value('withinMedianPx', (v) => `${px(v)} px`);
      const r = value('ratio', ratio);
      return it.data.level === 'items'
        ? `The ${n} items of ${rootName}: ${between} between neighbouring items; ${within} between the parts inside each item (ratio ${r}; reference ~2×).`
        : `The ${n} groups in ${rootName}: ${within} inside each group; ${between} between groups (ratio ${r}; reference ~2×).`;
    };
    const clearances = groupBy(
      entriesOf('spatial_grouping', (it) => typeof it.data.gapPx === 'number' && (it.data.gapPx as number) < C.clearancePx),
      ({ it }) => it.elements.map((e) => norm(e.selector)).sort().join('|'),
    );
    const pairText = (it: DiagnosticItem) => {
      const [a, b] = it.elements.map((e) => named(e, it.summary));
      if (a && b && a.noun === b.noun && (a.label || a.component) && (b.label || b.component)) return names([a, b]);
      return andList(it.elements.map((e) => one(named(e, it.summary))));
    };
    const clearanceText = (g: Group) => {
      const pairs = firstByKey(g.entries, (e) => e.it.elements.map((x) => x.selector).join('|')).map((e) => pairText(e.it));
      const gap = span(nums(g, 'gapPx'), px1, ' px');
      const n = instances(g);
      return n > 1
        ? `${n} pairs are ${gap} apart, for example ${pairs.slice(0, 2).join('; ')} (reference ~12 px).`
        : `${capital(pairs[0])} are ${gap} apart (reference ~12 px).`;
    };
    const insets = observed('spatial_grouping').flatMap((r) => {
      const sides = r.items.filter((it) => typeof it.data.insetPx === 'number' && (it.data.insetPx as number) < C.narrowInsetPx);
      return sides.length ? [{ key: String(r.stateId), entries: sides.map((it) => ({ r, it })) }] : [];
    });
    const insetText = (g: Group) =>
      `Smallest inset from the screen edge: ${andList(
        g.entries.map(({ it }) => {
          const v = it.data.insetPx as number;
          const el = it.elements[0] ? one(named(it.elements[0], it.summary)) : 'content';
          return v < 0 ? `on the ${it.data.side}, ${el} extends ${px(-v)} px past the edge` : `${px(v)} px on the ${it.data.side} (${el})`;
        }),
      )} (reference ~16 px).`;
    return [...lines(relations, relationText), ...lines(clearances, clearanceText), ...lines(insets, insetText)];
  };

  const alignmentOutliers = (): FindingLine[] =>
    lines(
      groupBy(entriesOf('alignment_outliers', () => true), ({ it }) => `${norm(it.elements[0]?.selector ?? '', false)}:${it.data.coordinate}`),
      (g) => {
        const it = g.entries[0].it;
        const els = elementsOf(g, (x) => x.elements.slice(0, 1));
        const pl = isPlural(els, instances(g));
        return `${capital(names(els, instances(g)))} ${pl ? 'are' : 'is'} ${span(nums(g, 'deviationPx'), px1, ' px')} off the ${it.data.coordinate} line that ${it.data.consistentPeers} of the ${it.data.clusterSize} peers in ${pl ? 'their' : 'its'} ${it.data.clusterKind} share.`;
      },
    );

  const responsiveAdaptation = (): FindingLine[] => {
    const r = observed('responsive_adaptation')[0];
    if (!r) return [];
    const single = (it: DiagnosticItem, text: string) => line({ key: '', entries: [{ r, it }] }, text);
    const out: FindingLine[] = [];
    const structure = (s: string) => {
      const grid = s.match(/^grid (\d+) col$/);
      if (grid) return `${grid[1]} column${grid[1] === '1' ? '' : 's'}`;
      if (s.startsWith('flex row')) return 'a row';
      if (s.startsWith('flex column')) return 'a column';
      return s === 'block' ? 'stacked' : s;
    };
    const transitions = r.items.filter((it) => typeof it.data.from === 'string').slice(0, MAX_TRANSITIONS);
    if (transitions.length) {
      const changes = line(
        { key: '', entries: transitions.map((it) => ({ r, it })) },
        `Layout changes (context, no reference): ${transitions
          .map((it) => `${namedFromSelector(String(it.data.parent), null).noun}: ${structure(String(it.data.from))} → ${structure(String(it.data.to))} at ${it.data.toWidth} px`)
          .join('; ')}.`,
      );
      out.push({ ...changes, ids: transitions.map((it) => itemId(r, it)) });
    }
    const isLarge = (it: DiagnosticItem) => {
      if (typeof it.data.areaChange !== 'number') return false;
      const samples = (it.data.samples as { w: number }[] | undefined) ?? [];
      const narrowW = samples[0]?.w ?? Infinity;
      const widestW = Math.max(0, ...samples.map((s) => s.w));
      const tag = segmentTag(String(it.data.selector ?? '').split(' > ').pop() ?? '');
      const aspect = Math.abs((it.data.aspectTo as number) / (it.data.aspectFrom as number) - 1);
      return (
        (it.data.areaChange as number) <= -C.areaShrink ||
        (narrowW < C.compressedWidthPx && widestW >= 2 * C.compressedWidthPx) ||
        (MEDIA_TAGS.has(tag) && aspect >= C.mediaAspectChange)
      );
    };
    for (const it of r.items.filter(isLarge).slice(0, MAX_LINES_PER_OBSERVATION)) {
      const samples = it.data.samples as { width: number; w: number; h: number }[];
      const narrow = samples[0];
      const wide = samples[samples.length - 1];
      const el = one(namedFromSelector(String(it.data.selector ?? ''), null, (it.data.componentId as string | null) ?? null));
      out.push(
        single(
          it,
          `${capital(el)} changes from ${wide.w}×${wide.h} px at ${wide.width} px to ${narrow.w}×${narrow.h} px at ${narrow.width} px (area ${pct(it.data.areaChange as number)}, aspect ratio ${it.data.aspectFrom} → ${it.data.aspectTo}).`,
        ),
      );
    }
    const DEV_KEYS = [
      ['widthDeviation', 'width'],
      ['heightDeviation', 'height'],
      ['aspectDeviation', 'aspect ratio'],
    ] as const;
    const peers = r.items.filter((it) => typeof it.data.widthDeviation === 'number' && DEV_KEYS.some(([k]) => Math.abs(it.data[k] as number) >= C.peerDeviation));
    for (const it of peers.slice(0, MAX_LINES_PER_OBSERVATION)) {
      const label = it.summary.split(' (')[0];
      const el = `the "${it.data.componentType}" component ${label.startsWith('[') ? label.slice(1, -1) : `(${namedFromSelector(label, null).noun})`}`;
      const devs = DEV_KEYS.filter(([k]) => Math.abs(it.data[k] as number) >= C.peerDeviation).map(([k, word]) => {
        const v = it.data[k] as number;
        return `${v > 0 ? '+' : ''}${pct(v)} in ${word}`;
      });
      out.push(
        single(
          it,
          `${capital(el)} differs from the median of its peers by up to ${andList(devs)} (largest at ${it.data.atWidth} px; more than 25% at ${it.data.widthsAbove25} of ${sweepWidths.length} widths; reference 25%).`,
        ),
      );
    }
    return out;
  };

  const layoutStability = (): FindingLine[] =>
    observed('layout_stability')
      .filter((r) => Number(r.data?.shiftCount ?? 0) > 0)
      .map((r) => {
        registerResult(r);
        const moved = r.items.slice(0, MAX_NAMES).map((it) => {
          const d = it.data as { selector: string; name: string | null };
          return one(namedFromSelector(d.selector, cleanLabel(d.name)));
        });
        const n = Number(r.data!.shiftCount);
        const text = `${n} unexpected layout shift${n > 1 ? 's' : ''} while loading, cumulative score ${r.data!.cumulativeScore}, largest ${r.data!.largestShift}${moved.length ? `; moved: ${andList(moved)}` : ''}.`;
        if (!r.items.length) return { ids: [resultId(r)], text, where: where([r.stateId]) };
        return line({ key: '', entries: r.items.map((it) => ({ r, it })) }, text);
      });

  const observationLines: Record<string, () => FindingLine[]> = {
    spatial_grouping: spatialGrouping,
    alignment_outliers: alignmentOutliers,
    responsive_adaptation: responsiveAdaptation,
    layout_stability: layoutStability,
  };

  const observationBlock = (diagId: string): ObservationBlock | null => {
    const found = observationLines[diagId]?.() ?? [];
    if (!found.length) return null;
    const def = rubric.diagnostics.find((d) => d.diagId === diagId);
    return { observation: DIAG_NAMES[diagId] ?? diagId, measures: def?.measures ?? MEASURES_FALLBACK[diagId] ?? '', reference: def?.reference ?? '', lines: found };
  };

  const criteria = rubric.criteria.map((c) => {
    const home = (id: string) => c.diagIds.includes(id) && (DIAGNOSTIC_HOME[id] ?? c.id) === c.id;
    return {
      criterion: c.id,
      name: c.name,
      checks: CHECK_ORDER.filter(home).map(checkBlock).filter((b): b is CheckBlock => b !== null),
      observations: OBSERVATION_ORDER.filter(home).map(observationBlock).filter((b): b is ObservationBlock => b !== null),
    };
  });

  // States with a screenshot or a finding, in reading order; sweep widths without a screenshot
  // share one line.
  const listed = bundle.states
    .filter((s) => s.status === 'collected' && (screenshotStates.has(s.id) || statesWithFindings.has(s.id)))
    .sort((a, b) => stateRank(a.id) - stateRank(b.id));
  const otherWidths = listed.filter((s) => s.kind === 'sweep' && !screenshotStates.has(s.id));
  const states: FindingsState[] = listed.filter((s) => !otherWidths.includes(s)).map(stateLine);
  if (otherWidths.length) {
    states.push({ state: otherWidths.map((s) => s.id).join(', '), text: capital(where(otherWidths.map((s) => s.id)).replace(/^at /, '')), pseudo: false });
  }
  return { states, criteria };
}
