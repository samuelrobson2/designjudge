// Visible text and the role each piece of text plays, inferred from markup and rendering.

import type { ElementRecord, RenderedFont, Snapshot, TypeRecord } from '../../types.ts';
import type { Doc } from '../doc.ts';

export type RoleKind = 'heading' | 'body' | 'label' | 'control' | 'field' | 'value' | 'display' | 'supporting' | 'text';

export interface TextRole {
  kind: RoleKind;
  // Heading level for headings.
  level?: number;
  // Part of a parent's run of text (a link or bold phrase inside a paragraph).
  inline?: boolean;
}

export interface TextEl {
  el: ElementRecord;
  t: TypeRecord;
  role: TextRole;
  family: FamilyInfo;
}

export interface FamilyInfo {
  // The family as written first in the stack, unquoted.
  declared: string;
  // What the text renders in: the font Chromium used for this stack, weight and style when
  // sampled, else the declared family.
  rendered: string;
  icon: boolean;
  mono: boolean;
  // A web font declared with @font-face that did not render (its fallback did).
  fellBack: boolean;
}

const LABEL_TAGS = new Set(['label', 'legend', 'th', 'dt']);
const BODY_TAGS = new Set(['p', 'li', 'dd', 'blockquote', 'td']);
const CONTROL_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'switch', 'checkbox', 'radio', 'treeitem']);
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', '-apple-system', 'blinkmacsystemfont', 'math', 'emoji']);
const MONO = /mono|code|courier|consolas|menlo|monaco|inconsolata|fira code|ui-monospace|^monospace$/i;
const ICON = /icon|symbols|awesome|glyph|emoji|fontello|ionicons|feather/i;
// Numbers, prices, dates, times and percentages, optionally with a short unit.
const VALUE = /^[\s$€£¥₹+\-−–~≈#]*\d[\d\s.,:/%\-–×x]*\s*(%|[A-Za-z]{1,4}\.?|[A-Za-z]{1,4}\s*\/\s*[A-Za-z]{1,4})?$/;

export const ROLE_NAME: Record<RoleKind, string> = {
  heading: 'heading',
  body: 'body text',
  label: 'labels',
  control: 'control text',
  field: 'form field text',
  value: 'values',
  display: 'large text not marked up as a heading',
  supporting: 'supporting text',
  text: 'other short text',
};

export function roleKey(r: TextRole): string {
  return r.kind === 'heading' ? `h${r.level}` : r.kind;
}

export function roleLabel(key: string): string {
  if (/^h\d$/.test(key)) return `${key} headings`;
  return ROLE_NAME[key as RoleKind] ?? key;
}

// Whether the role's label is a plural noun ("labels use", "body text uses").
export function rolePlural(key: string): boolean {
  return /^h\d$/.test(key) || key === 'label' || key === 'value';
}

// Most common value by count (ties go to the larger value).
export function mode(values: number[]): number {
  return weightedMode(values.map((v) => ({ v, w: 1 }))) ?? NaN;
}

export function firstFamily(stack: string): string {
  return (stack.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function familyInfo(t: TypeRecord, rendered: Map<string, RenderedFont>, webFonts: Set<string>): FamilyInfo {
  const declared = firstFamily(t.family);
  const sample = rendered.get(`${t.family}|${t.weight}|${t.style}`) ?? rendered.get(`${t.family}|400|normal`);
  const top = sample?.fonts.slice().sort((a, b) => b.glyphs - a.glyphs)[0];
  const isWeb = webFonts.has(norm(declared));
  const fellBack = !!top && isWeb && !top.custom;
  // Generic and system families depend on the reader's platform, so they are named as such
  // rather than by the font this machine happens to supply.
  const generic = GENERIC_FAMILIES.has(declared.toLowerCase());
  const systemUi = ['system-ui', '-apple-system', 'blinkmacsystemfont', 'ui-sans-serif'].includes(declared.toLowerCase());
  const name = systemUi ? 'the system UI font' : generic ? `the generic ${declared} font` : fellBack ? (top?.family ?? declared) : declared;
  return {
    declared,
    rendered: name,
    icon: ICON.test(declared),
    mono: MONO.test(declared) || MONO.test(top?.family ?? ''),
    fellBack,
  };
}

// Text that is shown: visible, not hidden from people, with characters (or a form field).
function shown(doc: Doc, el: ElementRecord): boolean {
  const t = el.type;
  if (!t || !el.visible || el.hiddenAttr || el.closedDetails || el.ariaHidden) return false;
  if (doc.visuallyHiddenChain(el)) return false;
  if (!t.field && t.chars === 0) return false;
  // Text with no letters or digits (icon-font glyphs, ♡, ✓, →, a lone dash) acts as an icon or mark,
  // and often renders in whichever font has the glyph.
  if (!t.field && el.text && !/[\p{L}\p{N}]/u.test(el.text)) return false;
  return true;
}

function insideControl(doc: Doc, el: ElementRecord): boolean {
  if (el.interactive) return true;
  for (const a of doc.ancestors(el)) {
    if (a.interactive || (a.role && CONTROL_ROLES.has(a.role))) return true;
  }
  return false;
}

function insideLabel(doc: Doc, el: ElementRecord): boolean {
  if (LABEL_TAGS.has(el.tag)) return true;
  for (const a of doc.ancestors(el)) if (LABEL_TAGS.has(a.tag)) return true;
  return false;
}

// Chars-weighted most common value.
export function weightedMode(values: { v: number; w: number }[]): number | null {
  const tally = new Map<number, number>();
  for (const { v, w } of values) tally.set(v, (tally.get(v) ?? 0) + w);
  let best: number | null = null;
  let bestW = -1;
  for (const [v, w] of tally) if (w > bestW || (w === bestW && best !== null && v > best)) [best, bestW] = [v, w];
  return best;
}

export function roundSize(n: number): number {
  return Math.round(n * 10) / 10;
}

// One distinct text style: a row of the type specimen sheet.
export function styleKey(x: TextEl): string {
  return `${x.family.rendered}|${roundSize(x.t.size)}|${x.t.weight}|${x.t.style}|${x.t.transform}`;
}

const looksLikeBody = (el: ElementRecord, t: TypeRecord) => BODY_TAGS.has(el.tag) || t.lineCount >= 2 || t.chars >= 80;

export interface TextSet {
  items: TextEl[];
  bodySize: number | null;
}

// Every shown text element with its inferred role. The body size is the most common size (by
// characters) of paragraph-like text, used to tell supporting text and unmarked headings apart.
export function textElements(doc: Doc): TextSet {
  const snap: Snapshot = doc.snap;
  const rendered = new Map((snap.renderedFonts ?? []).map((f) => [`${f.stack}|${f.weight}|${f.style}`, f]));
  const webFonts = new Set((snap.webFonts ?? []).map((f) => norm(f)));
  const els = doc.els.filter((el) => shown(doc, el));
  const base = new Map<number, TextRole>();
  for (const el of els) {
    const t = el.type!;
    if (t.field) base.set(el.id, { kind: 'field' });
    else if (t.heading !== null) base.set(el.id, { kind: 'heading', level: t.heading });
    else if (insideControl(doc, el)) base.set(el.id, { kind: 'control' });
    else if (insideLabel(doc, el)) base.set(el.id, { kind: 'label' });
  }
  const bodyCandidates = els.filter((el) => !base.has(el.id) && looksLikeBody(el, el.type!));
  const pool = bodyCandidates.length ? bodyCandidates : els.filter((el) => !base.has(el.id));
  const bodySize = weightedMode(pool.map((el) => ({ v: roundSize(el.type!.size), w: el.type!.chars })));

  const roleOf = (el: ElementRecord): TextRole => {
    const known = base.get(el.id);
    const t = el.type!;
    // A link or emphasis inside a run of text belongs to that run.
    const parent = doc.parent(el);
    if (el.display.startsWith('inline') && parent?.type && !parent.type.field && shown(doc, parent) && known?.kind !== 'heading') {
      return { ...roleOf(parent), inline: true };
    }
    if (known) return known;
    if (el.text && el.text.length <= 24 && VALUE.test(el.text)) return { kind: 'value' };
    // A short paragraph clearly smaller than body text is a note or caption.
    if (bodySize !== null && t.size < bodySize - 0.5 && t.lineCount <= 2 && t.chars < 160) return { kind: 'supporting' };
    if (looksLikeBody(el, t)) return { kind: 'body' };
    if (bodySize !== null && (t.size >= bodySize * 1.25 || (t.size >= bodySize * 1.1 && t.weight >= 600))) return { kind: 'display' };
    if (bodySize !== null && t.size < bodySize - 0.5) return { kind: 'supporting' };
    return { kind: 'text' };
  };
  const items = els.map((el) => ({ el, t: el.type!, role: roleOf(el), family: familyInfo(el.type!, rendered, webFonts) }));
  return { items, bodySize };
}
