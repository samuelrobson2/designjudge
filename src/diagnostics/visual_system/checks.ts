// Visual System diagnostics: four checks (Automated Accessibility Violations, Required Contrast,
// Keyboard Focus Visibility, Minimum Pointer Target Size) and three observations (Rendered Style
// Vocabulary, Rendered Contrast Profile, Peer Visual Consistency) of visual_system_rubric.md,
// computed from a state's Visual System probe (probes.ts): its own snapshot, rendered styles,
// resolved colours, axe-core results and keyboard traversal.

import type { ContrastRecord, Rgba, StyleRecord, VisualProbeState } from '../../collect/probeTypes.ts';
import type { DiagnosticItem, ElementRecord, ElementRef } from '../../types.ts';
import { Doc, outermost } from '../doc.ts';
import type { CheckOutput } from '../layout/deterministic.ts';
import type { ObservationOutput } from '../layout/observations.ts';
import { roleKey, textElements } from '../typography/text.ts';
import { apcaLc, chroma, contrastRatio, hex, isLargeText, oklabDistance, over } from './color.ts';

// Thresholds: WCAG 2.2 AA and the rubric's reference values; the bands marked "calibrated" were
// set on the six benchmark interfaces (see visual_system_rubric.md).
export const VISUAL_REFERENCE = {
  textRatio: 4.5,
  largeTextRatio: 3,
  uiRatio: 3,
  targetPx: 24,
  apca: { body: 75, readable: 60, large: 45, ui: 30 },
  // Colours closer than this in OKLab are practically the same colour (about half a just-noticeable
  // difference); calibrated: deliberate tints on the six interfaces sit 0.014–0.025 apart.
  nearColour: 0.01,
  // A value used by at most this many elements is a one-off when a near neighbour is common; calibrated.
  rareUses: 2,
  // A near neighbour is common when it is used by at least this many elements.
  commonUses: 4,
  // Calibrated: radius scales of 8/10/12 px are deliberate on the six interfaces; 1 px steps are not.
  nearRadiusPx: 1,
  nearIconPx: 2,
  // More distinct shadows than this is more elevation levels than surfaces usually need; calibrated.
  shadows: 4,
  // A peer group is consistent when at least this share shares one treatment.
  peerMode: 2 / 3,
  peerMin: 3,
};

const MAX_EXAMPLES = 3;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r0 = (n: number) => Math.round(n);

function item(items: DiagnosticItem[], summary: string, elements: ElementRef[], data: Record<string, unknown>): void {
  items.push({ n: items.length + 1, summary, elements, data });
}

function list(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

function tally<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) out.set(key(x), [...(out.get(key(x)) ?? []), x]);
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function probeDoc(probe: VisualProbeState): Doc {
  return new Doc(probe.snapshot);
}

function refs(doc: Doc, ids: (number | null | undefined)[], n = MAX_EXAMPLES): ElementRef[] {
  const out: ElementRef[] = [];
  for (const id of ids) {
    const el = doc.get(id ?? null);
    if (el && !out.some((r) => r.id === el.id)) out.push(doc.ref(el));
    if (out.length >= n) break;
  }
  return out;
}

// "the "Save" button (×9), the "Clear" link and 2 more".
function names(doc: Doc, ids: (number | null | undefined)[], n = MAX_EXAMPLES): string {
  const els = ids.map((id) => doc.get(id ?? null)).filter((e): e is ElementRecord => !!e);
  const counts = new Map<string, number>();
  for (const e of new Map(els.map((e) => [e.id, e])).values()) counts.set(describe(e), (counts.get(describe(e)) ?? 0) + 1);
  const shown = [...counts].slice(0, n).map(([d, c]) => (c > 1 ? `${d} (×${c})` : d));
  const more = counts.size - shown.length;
  return list([...shown, ...(more > 0 ? [`${more} more`] : [])]);
}

const TAG_NOUN: Record<string, string> = { a: 'link', button: 'button', input: 'field', select: 'dropdown', textarea: 'text box', label: 'label', li: 'list item', p: 'text', span: 'text', div: 'text', dd: 'text', dt: 'term', td: 'table cell', th: 'table header', svg: 'icon', img: 'image' };

// "the "Save" button", "the text "Free cancellation…"".
export function describe(el: ElementRecord): string {
  const label = (el.name ?? el.text ?? '').replace(/\s+/g, ' ').trim();
  const short = label.length > 40 ? `${label.slice(0, 39)}…` : label;
  const noun = /^h[1-6]$/.test(el.tag) ? 'heading' : el.role === 'checkbox' || el.role === 'radio' ? el.role : (TAG_NOUN[el.tag] ?? el.tag);
  if (short) return `the "${short}" ${noun}`;
  if (el.componentId) return `the ${el.componentId} ${noun}`;
  return `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun} (${el.selector.split(' > ').pop()})`;
}

// ---------- Automated Accessibility Violations ----------

export function accessibilityViolations(probe: VisualProbeState, doc: Doc): CheckOutput {
  const axe = probe.axe!;
  const items: DiagnosticItem[] = [];
  for (const v of axe.violations) {
    const ids = v.nodes.map((n) => n.id);
    const who = names(doc, ids) || v.nodes.slice(0, 2).map((n) => n.target).join(', ');
    item(items, `${v.rule} (${v.impact ?? 'unrated'}): ${v.help}. ${plural(v.nodes.length, 'element')}: ${who}`, refs(doc, ids), {
      rule: v.rule,
      impact: v.impact,
      help: v.help,
      wcag: v.tags,
      nodes: v.nodes.length,
      summary: v.nodes[0]?.summary ?? '',
      targets: v.nodes.slice(0, 3).map((n) => n.target),
    });
  }
  const incomplete = axe.incomplete.map((v, i) => ({
    n: i + 1,
    summary: `${v.rule}: ${v.help} (${plural(v.nodes.length, 'element')} axe could not decide)`,
    elements: refs(doc, v.nodes.map((n) => n.id)),
    data: { rule: v.rule, nodes: v.nodes.length },
  }));
  return {
    status: items.length ? 'fail' : 'pass',
    evaluated: axe.violations.length + axe.incomplete.length,
    summary: items.length
      ? `axe-core ${axe.version} found ${plural(items.length, 'WCAG A/AA rule')} violated: ${list(axe.violations.map((v) => v.rule))}.`
      : `axe-core ${axe.version} found no WCAG A/AA violations (colour contrast and target size are checked separately).`,
    items,
    secondary: incomplete.length ? [{ kind: 'unresolved', label: 'rules axe could not decide (needs review)', items: incomplete }] : [],
  };
}

// ---------- Required Contrast ----------

interface Pair {
  rec: ContrastRecord;
  fg: Rgba;
  bg: Rgba;
  ratio: number;
  required: number;
  part: 'text' | 'large text' | 'field boundary' | 'icon';
}

// Each contrast record with the colours that decide it, or null when it cannot be resolved.
export function resolvePairs(probe: VisualProbeState): { pairs: Pair[]; unresolved: ContrastRecord[] } {
  const pairs: Pair[] = [];
  const unresolved: ContrastRecord[] = [];
  for (const rec of probe.contrast) {
    if (!rec.bg) {
      if (rec.unresolved && !['covered', 'hidden', 'offscreen'].includes(rec.unresolved)) unresolved.push(rec);
      continue;
    }
    if (rec.kind === 'ui') {
      const fill = rec.fill ? over(rec.fill, rec.bg) : rec.bg;
      const candidates: Rgba[] = [fill, ...(rec.borders ?? []).map((b) => over(b, fill))];
      const best = candidates.map((c) => ({ c, ratio: contrastRatio(c, rec.bg!) })).sort((a, b) => b.ratio - a.ratio)[0];
      pairs.push({ rec, fg: best.c, bg: rec.bg, ratio: r2(best.ratio), required: VISUAL_REFERENCE.uiRatio, part: 'field boundary' });
      continue;
    }
    if (!rec.fg) continue;
    const fg = over(rec.fg, rec.bg);
    const large = rec.kind === 'text' && isLargeText(rec.size ?? 16, rec.weight ?? 400);
    const required = rec.kind === 'icon' ? VISUAL_REFERENCE.uiRatio : large ? VISUAL_REFERENCE.largeTextRatio : VISUAL_REFERENCE.textRatio;
    pairs.push({ rec, fg, bg: rec.bg, ratio: r2(contrastRatio(fg, rec.bg)), required, part: rec.kind === 'icon' ? 'icon' : large ? 'large text' : 'text' });
  }
  return { pairs, unresolved };
}

const PART_TEXT: Record<Pair['part'], [string, string]> = {
  text: ['text element', 'text elements'],
  'large text': ['large text element', 'large text elements'],
  'field boundary': ['form field whose border and fill', 'form fields whose borders and fills'],
  icon: ['icon-only control whose icon', 'icon-only controls whose icons'],
};

export function requiredContrast(probe: VisualProbeState, doc: Doc): CheckOutput {
  const { pairs, unresolved } = resolvePairs(probe);
  const exempt = (p: Pair) => p.rec.disabled || p.rec.decorative || p.rec.placeholder;
  const failing = pairs.filter((p) => !exempt(p) && p.ratio < p.required);
  const items: DiagnosticItem[] = [];
  for (const g of tally(failing, (p) => `${p.part}|${hex(p.fg)}|${hex(p.bg)}`).values()) {
    const p = g[0];
    const [one, many] = PART_TEXT[p.part];
    const ids = g.map((x) => x.rec.id);
    const sizes = [...new Set(g.map((x) => (x.rec.size ? `${r2(x.rec.size)} px/${x.rec.weight}` : '')).filter(Boolean))];
    const subject = p.part === 'field boundary' || p.part === 'icon' ? `${g.length === 1 ? one : `${g.length} ${many}`} reach at most` : `${g.length === 1 ? one : `${g.length} ${many}`} in ${hex(p.fg)} on ${hex(p.bg)}:`;
    item(
      items,
      `${capital(subject)} ${p.ratio}:1, below the ${p.required}:1 required${sizes.length ? ` (${sizes.slice(0, 3).join(', ')})` : ''}${p.part === 'field boundary' ? ` against ${hex(p.bg)}` : ''}: ${names(doc, ids)}`,
      refs(doc, ids),
      { part: p.part, fg: hex(p.fg), bg: hex(p.bg), ratio: p.ratio, required: p.required, elements: g.length, sizes },
    );
  }
  items.sort((a, b) => (a.data.ratio as number) - (b.data.ratio as number));
  items.forEach((it, i) => (it.n = i + 1));
  const secondary: CheckOutput['secondary'] = [];
  const notCounted = (kind: string, label: string, recs: { id: number; text: string }[]) => {
    if (recs.length) secondary.push({ kind, label, items: recs.slice(0, 6).map((r, i) => ({ n: i + 1, summary: r.text, elements: refs(doc, [r.id], 1), data: {} })) });
  };
  notCounted(
    'complex_background',
    'text on a picture or gradient, whose contrast cannot be reduced to one colour',
    unresolved.map((r) => ({ id: r.id, text: `${names(doc, [r.id], 1)} on ${r.unresolved === 'gradient' ? 'a gradient' : 'a picture'}` })),
  );
  notCounted(
    'exempt',
    'placeholder, disabled or decorative text below its ratio',
    pairs.filter((p) => exempt(p) && p.ratio < p.required).map((p) => ({ id: p.rec.id, text: `${names(doc, [p.rec.id], 1)} (${p.rec.placeholder ? 'placeholder' : p.rec.disabled ? 'disabled' : 'hidden from assistive technology'}) at ${p.ratio}:1` })),
  );
  return {
    status: items.length ? 'fail' : 'pass',
    evaluated: pairs.length,
    summary: items.length
      ? `${plural(failing.length, 'foreground')} of ${pairs.length} evaluated fall below their WCAG ratio, in ${plural(items.length, 'colour pair')}.`
      : `All ${pairs.length} resolvable text, field-boundary and icon pairs meet their WCAG ratio.`,
    items,
    secondary,
  };
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Keyboard Focus Visibility ----------

const selectorShape = (s: string) => s.replace(/:nth-of-type\(\d+\)/g, '');

export function focusVisibility(probe: VisualProbeState, doc: Doc): CheckOutput {
  const f = probe.focus!;
  const hidden = f.stops.filter((s) => !s.visible);
  const items: DiagnosticItem[] = [];
  // Focus that goes under other elements is one finding however many controls it reaches (a dialog without a focus trap).
  const covered = hidden.filter((s) => s.coveredBy);
  if (covered.length) {
    const who = covered.map((s) => {
      const el = doc.get(s.id);
      return el ? describe(el) : s.name ? `the "${s.name}" ${s.tag}` : s.selector;
    });
    const over = [...new Set(covered.map((s) => s.coveredBy!))];
    item(
      items,
      `Tab moves focus to ${plural(covered.length, 'control')} that ${covered.length === 1 ? 'lies' : 'lie'} under other elements (${list(over.slice(0, 2))}${over.length > 2 ? ' and others' : ''}), where the focus cannot be seen: ${list([...new Set(who)].slice(0, 3))}${new Set(who).size > 3 ? ` and ${new Set(who).size - 3} more` : ''} (tab stop${covered.length > 1 ? 's' : ''} ${list(covered.slice(0, 6).map((x) => String(x.n)))}${covered.length > 6 ? ' and more' : ''})`,
      covered.slice(0, MAX_EXAMPLES).map((x) => ({ id: x.id ?? 0, selector: x.selector, tag: x.tag, name: x.name, componentId: null, rect: x.rect, ...(x.fixed ? { fixed: true } : {}) })),
      { kind: 'covered', stops: covered.map((x) => x.n), elements: covered.length, coveredBy: over },
    );
  }
  for (const g of tally(hidden.filter((s) => !s.coveredBy), (s) => `${s.tag}|${s.role}|${selectorShape(s.selector)}`).values()) {
    const s = g[0];
    const el = doc.get(s.id);
    const who = el ? describe(el) : s.name ? `the "${s.name}" ${s.tag}` : s.selector;
    const styles = s.hiddenInput
      ? '; focus lands on the hidden input inside it, whose own outline cannot be seen'
      : s.changes.length
        ? `; focus styles: ${s.changes.slice(0, 2).join('; ')}`
        : '; no focus style changes';
    const subject = capital(g.length > 1 ? `${who} and ${plural(g.length - 1, 'similar control')}` : who);
    const stops = `tab stop${g.length > 1 ? 's' : ''} ${list(g.map((x) => String(x.n)))}`;
    item(
      items,
      `${subject} ${g.length > 1 ? 'show' : 'shows'} no visible change when focused with Tab (${stops}; ${Math.max(...g.map((x) => x.changedPixels ?? 0))} pixels changed${styles})`,
      g
        .slice(0, MAX_EXAMPLES)
        .map((x) => ({ id: x.id ?? 0, selector: x.selector, tag: x.tag, name: x.name, componentId: null, rect: x.rect, ...(x.fixed ? { fixed: true } : {}) })),
      { kind: 'unchanged', stops: g.map((x) => x.n), elements: g.length, changedPixels: g.map((x) => x.changedPixels), changes: s.changes, tolerancePx: f.tolerancePx },
    );
  }
  return {
    status: items.length ? 'fail' : 'pass',
    evaluated: f.stops.length,
    summary: items.length
      ? `${hidden.length} of ${f.stops.length} tab stops show no visible focus indication.`
      : `All ${f.stops.length} tab stops show a visible change when focused${f.ended === 'limit' ? ` (the first ${f.stops.length} were checked)` : ''}.`,
    items,
    secondary: [],
    data: { stops: f.stops.length, ended: f.ended },
  };
}

// ---------- Minimum Pointer Target Size ----------

interface Target {
  el: ElementRecord;
  rect: { x: number; y: number; w: number; h: number };
}

export function targetSize(probe: VisualProbeState, doc: Doc): CheckOutput {
  const styles = new Map(probe.styles.map((s) => [s.id, s]));
  const labels = new Map<number, ElementRecord>();
  for (const el of doc.els) if (el.tag === 'label' && el.labelFor !== null) labels.set(el.labelFor, el);
  const usable = (el: ElementRecord) => el.visible && !el.disabled && !el.inert && !el.ariaHidden && !el.hiddenAttr && !el.closedDetails && el.rect.w > 0 && el.rect.h > 0;
  const excluded = { inline: 0, native: 0 };
  const targets: Target[] = [];
  const seen = new Set<number>();
  // While a modal dialog is open, only its own targets can be used.
  const vw = probe.viewport.width;
  const vh = probe.viewport.height;
  const modals = doc.els.filter((e) => (e.role === 'dialog' || e.role === 'alertdialog') && usable(e) && e.rect.w * e.rect.h >= 0.15 * vw * vh);
  const inModal = (el: ElementRecord) => !modals.length || modals.some((m) => m.id === el.id || doc.isAncestor(m, el));
  for (const el of doc.els) {
    if (!el.interactive || !usable(el) || !inModal(el)) continue;
    let t = el;
    // A form control inside or tied to a label is clicked through the label as well.
    const label = labels.get(el.id) ?? [...doc.ancestors(el)].find((a) => a.tag === 'label');
    if (doc.visuallyHiddenChain(el) || el.rect.w <= 2 || el.rect.h <= 2) {
      if (!label || !usable(label) || doc.visuallyHiddenChain(label)) continue;
      t = label;
    } else if (label && usable(label) && (el.tag === 'input' || el.tag === 'select') && doc.isAncestor(label, el)) {
      t = label;
    }
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    // A link inside a sentence is exempt (its size is set by the text).
    const parent = doc.parent(t);
    if (t.tag === 'a' && t.display === 'inline' && parent?.ownText) {
      excluded.inline++;
      continue;
    }
    // Checkboxes and radio buttons drawn by the browser at its own size are exempt.
    if (t.tag === 'input' && (t.role === 'checkbox' || t.role === 'radio') && (styles.get(t.id)?.appearance ?? 'auto') !== 'none' && t.rect.w <= 14 && t.rect.h <= 14) {
      excluded.native++;
      continue;
    }
    targets.push({ el: t, rect: t.rect });
  }
  const R = VISUAL_REFERENCE.targetPx / 2;
  const centre = (r: Target['rect']) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const small = targets.filter((t) => t.rect.w < VISUAL_REFERENCE.targetPx || t.rect.h < VISUAL_REFERENCE.targetPx);
  const circleHitsRect = (c: { x: number; y: number }, r: Target['rect']) => {
    const dx = Math.max(r.x - c.x, 0, c.x - (r.x + r.w));
    const dy = Math.max(r.y - c.y, 0, c.y - (r.y + r.h));
    return dx * dx + dy * dy < R * R;
  };
  const edgeDistance = (c: { x: number; y: number }, r: Target['rect']) => Math.hypot(Math.max(r.x - c.x, 0, c.x - (r.x + r.w)), Math.max(r.y - c.y, 0, c.y - (r.y + r.h)));
  const failing: { t: Target; nearest: Target; how: 'edge' | 'circle'; distance: number }[] = [];
  for (const t of small) {
    const c = centre(t.rect);
    let conflict: { other: Target; how: 'edge' | 'circle'; d: number } | null = null;
    for (const o of targets) {
      if (o === t || doc.related(o.el, t.el)) continue;
      const oc = centre(o.rect);
      const hit = circleHitsRect(c, o.rect) ? { how: 'edge' as const, d: edgeDistance(c, o.rect) } : small.includes(o) && Math.hypot(c.x - oc.x, c.y - oc.y) < 2 * R ? { how: 'circle' as const, d: Math.hypot(c.x - oc.x, c.y - oc.y) } : null;
      if (hit && (!conflict || hit.d < conflict.d)) conflict = { other: o, ...hit };
    }
    if (conflict) failing.push({ t, nearest: conflict.other, how: conflict.how, distance: r0(conflict.d) });
  }
  const items: DiagnosticItem[] = [];
  for (const g of tally(failing, (f) => `${f.t.el.tag}|${selectorShape(f.t.el.selector)}|${r0(f.t.rect.w)}x${r0(f.t.rect.h)}`).values()) {
    const f = g[0];
    const why =
      f.how === 'edge'
        ? `the edge of ${describe(f.nearest.el)} is ${f.distance} px from its centre (the spacing exception needs ${R} px)`
        : `its centre is ${f.distance} px from that of ${describe(f.nearest.el)}, also undersized (the spacing exception needs ${2 * R} px)`;
    item(
      items,
      `${capital(g.length > 1 ? `${describe(f.t.el)} and ${plural(g.length - 1, 'similar target')}` : describe(f.t.el))}: ${r0(f.t.rect.w)}×${r0(f.t.rect.h)} px, below 24×24, and ${why}`,
      [doc.ref(f.t.el), doc.ref(f.nearest.el)],
      { w: r0(f.t.rect.w), h: r0(f.t.rect.h), elements: g.length, nearest: f.nearest.el.name ?? f.nearest.el.selector, conflict: f.how, distance: f.distance },
    );
  }
  return {
    status: items.length ? 'fail' : 'pass',
    evaluated: targets.length,
    summary: items.length
      ? `${plural(failing.length, 'target')} of ${targets.length} are smaller than 24×24 px without the spacing exception.`
      : `All ${targets.length} pointer targets are at least 24×24 px or spaced as the exception allows (${small.length} smaller ones are spaced).`,
    items,
    secondary: [],
    data: { targets: targets.length, small: small.length, excluded },
  };
}

// ---------- Rendered Style Vocabulary ----------

interface Use {
  key: string;
  ids: number[];
  uses: Set<string>;
}

function addUse(map: Map<string, Use>, key: string, id: number, use: string) {
  const u = map.get(key) ?? { key, ids: [], uses: new Set<string>() };
  if (!u.ids.includes(id)) u.ids.push(id);
  u.uses.add(use);
  map.set(key, u);
}

const radiusKey = (r: NonNullable<StyleRecord['radius']>) => (r.full ? 'full' : String(r2(Math.max(...r.px))));

export function styleVocabulary(probe: VisualProbeState, doc: Doc): ObservationOutput {
  const V = VISUAL_REFERENCE;
  const items: DiagnosticItem[] = [];
  const colours = new Map<string, Use & { rgba: Rgba }>();
  const addColour = (c: Rgba | null, id: number, use: string) => {
    if (!c || c[3] === 0) return;
    const flat = over(c, [255, 255, 255, 1]);
    const key = hex(c);
    const u = colours.get(key) ?? { key, ids: [], uses: new Set<string>(), rgba: flat };
    if (!u.ids.includes(id)) u.ids.push(id);
    u.uses.add(use);
    colours.set(key, u);
  };
  const radii = new Map<string, Use>();
  const shadows = new Map<string, Use>();
  const icons = new Map<string, Use>();
  const iconSizes = new Map<string, Use>();
  const strokes = new Map<string, Use>();
  const durations = new Map<string, Use>();
  for (const s of probe.styles) {
    const el = doc.get(s.id);
    if (!el || el.ariaHidden && !s.icon) continue;
    if (el.ownText && s.color) addColour(s.color, s.id, 'text');
    if (s.bg) addColour(s.bg, s.id, 'background');
    for (const side of s.border ?? []) if (side) addColour(side[1], s.id, 'border');
    if (s.icon) {
      addUse(icons, s.icon.kind, s.id, s.icon.kind);
      if (s.icon.kind === 'svg' || s.icon.kind === 'img') addUse(iconSizes, `${r0(Math.max(s.icon.w, s.icon.h))}`, s.id, 'icon');
      if (s.icon.stroke) addColour(s.icon.stroke, s.id, 'icon');
      else if (s.icon.fill && s.icon.kind === 'svg') addColour(s.icon.fill, s.id, 'icon');
      if (s.icon.strokeWidth) addUse(strokes, String(s.icon.strokeWidth), s.id, 'stroke');
    }
    if (s.radius) addUse(radii, radiusKey(s.radius), s.id, el.tag);
    if (s.shadow) addUse(shadows, s.shadow.replace(/\s+/g, ' '), s.id, el.tag);
    if (s.transition) {
      const ms = s.transition.match(/(\d*\.?\d+)(ms|s)\b/);
      if (ms) addUse(durations, String(Math.round(Number(ms[1]) * (ms[2] === 's' ? 1000 : 1))), s.id, 'transition');
    }
  }
  const byUse = (use: string) => [...colours.values()].filter((c) => c.uses.has(use));
  const sortedRadii = [...radii.values()].sort((a, b) => (a.key === 'full' ? 1e6 : Number(a.key)) - (b.key === 'full' ? 1e6 : Number(b.key)));

  // Profile lines (not flagged).
  const colourList = (use: string) => byUse(use).sort((a, b) => b.ids.length - a.ids.length);
  for (const use of ['text', 'background', 'border', 'icon']) {
    const cs = colourList(use);
    if (!cs.length) continue;
    item(items, `${plural(cs.length, `${use} colour`)}: ${cs.slice(0, 8).map((c) => `${c.key} (${c.ids.length})`).join(', ')}${cs.length > 8 ? ` and ${cs.length - 8} more` : ''}`, [], {
      kind: 'colours',
      use,
      colours: cs.map((c) => ({ colour: c.key, elements: c.ids.length, chroma: r2(chroma(c.rgba)) })),
    });
  }
  if (sortedRadii.length) item(items, `Corner radii: ${sortedRadii.map((r) => `${r.key === 'full' ? 'fully rounded' : `${r.key} px`} (${r.ids.length})`).join(', ')}`, [], { kind: 'radii', radii: sortedRadii.map((r) => ({ radius: r.key, elements: r.ids.length })) });
  if (shadows.size) item(items, `${plural(shadows.size, 'distinct shadow')}: ${[...shadows.values()].map((s) => `${s.key} (${s.ids.length})`).join('; ')}`, [], { kind: 'shadows', shadows: [...shadows.values()].map((s) => ({ shadow: s.key, elements: s.ids.length })) });
  if (icons.size) item(items, `Icons: ${[...icons.values()].map((i) => `${i.key === 'glyph' ? 'text symbols' : i.key === 'font' ? 'icon font' : i.key === 'img' ? 'small images' : 'SVG'} (${i.ids.length})`).join(', ')}${iconSizes.size ? `; sizes ${[...iconSizes.values()].sort((a, b) => Number(a.key) - Number(b.key)).map((s) => `${s.key} px (${s.ids.length})`).join(', ')}` : ''}${strokes.size ? `; stroke widths ${[...strokes.values()].map((s) => `${s.key} (${s.ids.length})`).join(', ')}` : ''}`, [], {
    kind: 'icons',
    kinds: Object.fromEntries([...icons.values()].map((i) => [i.key, i.ids.length])),
    sizes: Object.fromEntries([...iconSizes.values()].map((i) => [i.key, i.ids.length])),
    strokes: Object.fromEntries([...strokes.values()].map((i) => [i.key, i.ids.length])),
  });

  // Flags: one-off near-duplicates of a common value, and mixed icon families.
  const all = [...colours.values()];
  const nearColours: { a: (typeof all)[number]; b: (typeof all)[number]; d: number }[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [a, b] = all[i].ids.length <= all[j].ids.length ? [all[i], all[j]] : [all[j], all[i]];
      const shared = [...a.uses].some((u) => b.uses.has(u));
      const d = oklabDistance(a.rgba, b.rgba);
      if (shared && d > 0.0001 && d < V.nearColour && a.ids.length <= V.rareUses && b.ids.length >= V.commonUses) nearColours.push({ a, b, d });
    }
  }
  // Each one-off colour once, next to its closest common neighbour.
  for (const g of tally(nearColours, (x) => x.a.key).values()) {
    const { a, b, d } = g.sort((x, y) => x.d - y.d)[0];
    const use = [...a.uses].find((u) => b.uses.has(u))!;
    item(items, `The ${use} colour ${a.key} is used by ${plural(a.ids.length, 'element')} (${names(doc, a.ids, 2)}) and is a near-duplicate of ${b.key}, used by ${b.ids.length} (OKLab distance ${d.toFixed(3)})`, refs(doc, a.ids, 2), {
      kind: 'near_colour',
      flagged: true,
      colour: a.key,
      common: b.key,
      distance: Math.round(d * 1000) / 1000,
      elements: a.ids.length,
      commonElements: b.ids.length,
    });
  }
  const styleOf = new Map(probe.styles.map((s) => [s.id, s]));
  // A container whose radius is its rounded child's plus the inset between them is drawn to match it.
  const matchesNested = (id: number, r: number) =>
    doc.els.some((c) => {
      const cs = styleOf.get(c.id);
      const el = doc.get(id);
      if (!el || !cs?.radius || cs.radius.full || c.parent !== id) return false;
      const inset = Math.min(c.rect.x - el.rect.x, c.rect.y - el.rect.y);
      return inset >= 0 && Math.abs(Math.max(...cs.radius.px) + inset - r) <= 1;
    });
  const numeric = sortedRadii.filter((r) => r.key !== 'full' && Number(r.key) > 0);
  for (const a of numeric) {
    if (a.ids.length > V.rareUses) continue;
    const near = numeric.filter((b) => b !== a && b.ids.length >= V.commonUses && Math.abs(Number(a.key) - Number(b.key)) <= V.nearRadiusPx).sort((x, y) => y.ids.length - x.ids.length)[0];
    const drift = a.ids.filter((id) => !matchesNested(id, Number(a.key)));
    if (!near || !drift.length) continue;
    item(items, `A ${a.key} px corner radius is used by ${plural(drift.length, 'element')} (${names(doc, drift, 2)}), next to ${near.key} px used by ${near.ids.length}`, refs(doc, drift, 2), {
      kind: 'near_radius',
      flagged: true,
      radius: Number(a.key),
      common: Number(near.key),
      elements: drift.length,
      commonElements: near.ids.length,
    });
  }
  // An inner corner more rounded than the rounded box it sits in, close to that box's corner.
  const nested = new Map<string, { inner: ElementRecord; outer: ElementRecord; ri: number; ro: number }[]>();
  for (const s of probe.styles) {
    if (!s.radius || s.radius.full) continue;
    const el = doc.get(s.id);
    if (!el) continue;
    const ri = Math.max(...s.radius.px);
    for (const a of doc.ancestors(el)) {
      const as = styleOf.get(a.id);
      if (!as?.radius || as.radius.full) continue;
      if (!(as.bg || as.border || as.shadow)) continue;
      const ro = Math.max(...as.radius.px);
      const inset = Math.min(el.rect.x - a.rect.x, el.rect.y - a.rect.y, a.rect.x + a.rect.w - (el.rect.x + el.rect.w), a.rect.y + a.rect.h - (el.rect.y + el.rect.h));
      if (inset >= 0 && inset < ro && ri > ro + 1) {
        const key = `${ri}>${ro}`;
        nested.set(key, [...(nested.get(key) ?? []), { inner: el, outer: a, ri, ro }]);
      }
      break;
    }
  }
  for (const g of nested.values()) {
    const x = g[0];
    item(items, `${capital(describe(x.inner))}${g.length > 1 ? ` and ${plural(g.length - 1, 'other element')}` : ''} ${g.length > 1 ? 'have' : 'has'} ${x.ri} px corners inside ${describe(x.outer)}, whose corners are ${x.ro} px, ${Math.max(0, r0(Math.min(x.inner.rect.x - x.outer.rect.x, x.inner.rect.y - x.outer.rect.y)))} px away`, [doc.ref(x.inner), doc.ref(x.outer)], {
      kind: 'nested_radius',
      flagged: true,
      inner: x.ri,
      outer: x.ro,
      elements: g.length,
    });
  }
  if (shadows.size > V.shadows) {
    const oneOff = [...shadows.values()].filter((s) => s.ids.length <= V.rareUses);
    item(items, `${shadows.size} distinct shadows are drawn${oneOff.length ? `; ${oneOff.length} ${oneOff.length === 1 ? 'is' : 'are'} used by ${V.rareUses} elements or fewer` : ''}`, refs(doc, oneOff.flatMap((s) => s.ids), 3), {
      kind: 'shadow_count',
      flagged: true,
      shadows: shadows.size,
      oneOff: oneOff.length,
    });
  }
  const iconKinds = [...icons.values()].filter((i) => i.key !== 'img');
  if (iconKinds.length > 1) {
    const minor = iconKinds.sort((a, b) => a.ids.length - b.ids.length)[0];
    item(items, `Icons are drawn in ${list(iconKinds.map((i) => (i.key === 'glyph' ? `text symbols (${i.ids.length}, such as ${names(doc, i.ids, 2)})` : i.key === 'font' ? `an icon font (${i.ids.length})` : `SVG (${i.ids.length})`)))}`, refs(doc, minor.ids, 3), {
      kind: 'icon_kinds',
      flagged: true,
      kinds: Object.fromEntries(iconKinds.map((i) => [i.key, i.ids.length])),
    });
  }
  const sizes = [...iconSizes.values()].sort((a, b) => Number(a.key) - Number(b.key));
  for (const a of sizes) {
    const b = sizes.find((x) => x !== a && Math.abs(Number(x.key) - Number(a.key)) <= V.nearIconPx && x.ids.length >= V.commonUses);
    if (!b || a.ids.length > V.rareUses) continue;
    item(items, `${plural(a.ids.length, 'icon')} ${a.ids.length === 1 ? 'is' : 'are'} ${a.key} px (${names(doc, a.ids, 2)}) while ${b.ids.length} are ${b.key} px`, refs(doc, a.ids, 2), { kind: 'near_icon_size', flagged: true, size: Number(a.key), common: Number(b.key), elements: a.ids.length });
  }
  const strokeList = [...strokes.values()];
  if (strokeList.length > 1) {
    const rare = strokeList.filter((s) => s.ids.length <= V.rareUses);
    const common = strokeList.find((s) => s.ids.length >= V.commonUses);
    if (rare.length && common) {
      item(items, `Icon strokes: ${strokeList.map((s) => `${s.key} px (${s.ids.length})`).join(', ')}; the ${list(rare.map((s) => `${s.key} px`))} ${rare.length === 1 ? 'stroke is' : 'strokes are'} used by ${V.rareUses} icons or fewer`, refs(doc, rare.flatMap((s) => s.ids), 3), {
        kind: 'stroke_widths',
        flagged: true,
        strokes: Object.fromEntries(strokeList.map((s) => [s.key, s.ids.length])),
      });
    }
  }
  if (probe.motion) {
    const running = probe.motion.animations.filter((a) => a.infinite);
    const still = (probe.motion.reduced ?? []).filter((a) => a.infinite);
    item(items, `Motion: ${plural(durations.size, 'transition duration')} (${[...durations.values()].sort((a, b) => Number(a.key) - Number(b.key)).map((d) => `${d.key} ms ×${d.ids.length}`).join(', ') || 'none'}); ${plural(running.length, 'animation')} that keeps running at load`, [], {
      kind: 'motion',
      durations: Object.fromEntries([...durations.values()].map((d) => [d.key, d.ids.length])),
      infinite: running.length,
    });
    if (still.length && probe.motion.reduced) {
      const kinds = [...tally(still, (a) => `${a.name || 'an animation'} on ${a.selector.split(' > ').pop()}`)].map(([k, xs]) => (xs.length > 1 ? `${k} (×${xs.length})` : k));
      item(items, `${plural(still.length, 'animation')} ${still.length === 1 ? 'keeps' : 'keep'} running when reduced motion is requested: ${list(kinds.slice(0, 3))}`, refs(doc, still.map((a) => a.id), 3), {
        kind: 'motion_reduced',
        flagged: true,
        animations: still.length,
      });
    }
  }
  return {
    status: 'observed',
    evaluated: probe.styles.length,
    summary: `${byUse('text').length} text, ${byUse('background').length} background and ${byUse('border').length} border colours; radii ${sortedRadii.map((r) => (r.key === 'full' ? 'full' : `${r.key}`)).join(', ') || 'none'}; ${plural(shadows.size, 'shadow')}; icons ${[...icons.values()].map((i) => `${i.key} ×${i.ids.length}`).join(', ') || 'none'}.`,
    items,
    data: { colours: colours.size, radii: sortedRadii.length, shadows: shadows.size },
  };
}

// ---------- Rendered Contrast Profile ----------

export function contrastProfile(probe: VisualProbeState, doc: Doc): ObservationOutput {
  const A = VISUAL_REFERENCE.apca;
  const roles = new Map(textElements(doc).items.map((x) => [x.el.id, roleKey(x.role)]));
  const { pairs } = resolvePairs(probe);
  // Pairs below their WCAG ratio are already failures of Required Contrast.
  const measured = pairs
    .filter((p) => !p.rec.disabled && !p.rec.decorative && !p.rec.placeholder && p.ratio >= p.required)
    .map((p) => {
      const role = p.part === 'field boundary' || p.part === 'icon' ? 'ui' : p.part === 'large text' ? 'large' : roles.get(p.rec.id) === 'body' ? 'body' : 'readable';
      const lc = r0(apcaLc(p.fg, p.bg));
      return { p, role, lc, reference: A[role as keyof typeof A] };
    });
  const items: DiagnosticItem[] = [];
  const ROLE_TEXT: Record<string, string> = { body: 'Body text', readable: 'Other readable text', large: 'Large text', ui: 'Form-field boundaries and icon-only controls' };
  const below = measured.filter((m) => m.lc < m.reference);
  for (const g of tally(below, (m) => `${m.role}|${hex(m.p.fg)}|${hex(m.p.bg)}`).values()) {
    const m = g[0];
    const sizes = [...new Set(g.map((x) => (x.p.rec.size ? `${r2(x.p.rec.size)} px/${x.p.rec.weight}` : '')).filter(Boolean))];
    item(
      items,
      `${ROLE_TEXT[m.role]} in ${hex(m.p.fg)} on ${hex(m.p.bg)}: Lc ${m.lc} (reference ${m.reference}+)${sizes.length ? `, ${sizes.slice(0, 3).join(', ')}` : ''}, ${plural(g.length, 'element')}: ${names(doc, g.map((x) => x.p.rec.id))}`,
      refs(doc, g.map((x) => x.p.rec.id)),
      { kind: 'below', flagged: true, role: m.role, lc: m.lc, reference: m.reference, fg: hex(m.p.fg), bg: hex(m.p.bg), elements: g.length, wcag: m.p.ratio },
    );
  }
  items.sort((a, b) => (a.data.lc as number) - (b.data.lc as number));
  const text = measured.filter((m) => m.role !== 'ui').map((m) => m.lc).sort((a, b) => a - b);
  const median = text.length ? text[Math.floor(text.length / 2)] : null;
  items.unshift({ n: 0, summary: text.length ? `Text that meets its WCAG ratio: median Lc ${median}; lowest five ${text.slice(0, 5).join(', ')}` : 'No resolvable text', elements: [], data: { kind: 'profile', median, lowest: text.slice(0, 5) } });
  items.forEach((it, i) => (it.n = i + 1));
  return {
    status: 'observed',
    evaluated: measured.length,
    summary: `${measured.length} foregrounds that meet their WCAG ratio measured; median text Lc ${median ?? '—'}; ${below.length} below the APCA reference for their role.`,
    items,
  };
}

// ---------- Peer Visual Consistency ----------

const STATE_CLASS = /^(is-|has-)|active|selected|open|checked|current|disabled|invalid|error/;

function classesOf(selector: string): string {
  const last = selector.split(' > ').pop() ?? '';
  return [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]).filter((c) => !STATE_CLASS.test(c)).sort().join('.');
}

function stateOf(el: ElementRecord, selector: string): string {
  const last = selector.split(' > ').pop() ?? '';
  const cls = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]).filter((c) => STATE_CLASS.test(c));
  return [el.disabled ? 'disabled' : '', ...cls].filter(Boolean).sort().join('.');
}

export function peerConsistency(probe: VisualProbeState, doc: Doc): ObservationOutput {
  const V = VISUAL_REFERENCE;
  const styleOf = new Map(probe.styles.map((s) => [s.id, s]));
  const signature = (s: StyleRecord, el: ElementRecord) => {
    const sides = (s.border ?? []).map((b) => (b ? `${b[0]} px ${hex(b[1])}` : 'none'));
    const border = new Set(sides).size === 1 ? sides[0] : sides.join(' / ');
    return {
      background: s.bg ? hex(s.bg) : 'none',
      text: s.color && (el.ownText || el.interactive) ? hex(s.color) : '',
      border: border || 'none',
      radius: s.radius ? radiusKey(s.radius) : '0',
      shadow: s.shadow ?? 'none',
      height: String(Math.round(el.rect.h / 4) * 4),
    };
  };
  // Peers: elements sharing a component-type label, or controls and surfaces sharing tag, role and classes.
  const peers = new Map<string, { el: ElementRecord; s: StyleRecord }[]>();
  for (const el of doc.els) {
    const s = styleOf.get(el.id);
    if (!s || !el.visible || el.rect.w < 4 || el.rect.h < 4) continue;
    const surface = !!(s.bg || s.border || s.shadow);
    let key: string | null = null;
    if (el.componentType) key = `type:${el.componentType}`;
    else if (el.interactive && el.tag !== 'a') key = `control:${el.tag}|${el.role}|${classesOf(el.selector)}`;
    else if (surface && classesOf(el.selector)) key = `surface:${el.tag}|${classesOf(el.selector)}`;
    if (!key) continue;
    key += `|${stateOf(el, el.selector)}`;
    peers.set(key, [...(peers.get(key) ?? []), { el, s }]);
  }
  const items: DiagnosticItem[] = [];
  let groups = 0;
  for (const [key, members] of peers) {
    if (members.length < V.peerMin) continue;
    groups++;
    const sigs = members.map((m) => ({ m, sig: signature(m.s, m.el) }));
    const byKey = tally(sigs, (x) => JSON.stringify(x.sig));
    const [modalKey, modal] = [...byKey.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (modal.length === members.length || modal.length / members.length < V.peerMode) continue;
    const modalSig = JSON.parse(modalKey) as Record<string, string>;
    const deviants = sigs.filter((x) => JSON.stringify(x.sig) !== modalKey);
    const diffs = new Map<string, Set<string>>();
    for (const d of deviants) {
      for (const [k, v] of Object.entries(d.sig)) if (v !== modalSig[k]) diffs.set(k, (diffs.get(k) ?? new Set()).add(`${modalSig[k] || 'none'} vs ${v || 'none'}`));
    }
    // A height that alone differs follows content length, not a separate treatment.
    if ([...diffs.keys()].every((k) => k === 'height')) continue;
    const what = key.startsWith('type:') ? `"${key.slice(5).split('|')[0]}" components` : `${describe(members[0].el).replace(/^the ".*?" /, '').replace(/^a /, '')}s (${classesOf(members[0].el.selector) || members[0].el.tag})`;
    const outliers = outermost(doc, deviants.map((d) => d.m.el));
    item(
      items,
      `${modal.length} of ${members.length} ${what} share one treatment; ${names(doc, outliers.map((e) => e.id))} ${deviants.length === 1 ? 'differs' : 'differ'} in ${list([...diffs.entries()].filter(([k]) => k !== 'height').map(([k, v]) => `${k} (${[...v].slice(0, 2).join('; ')})`))}`,
      refs(doc, outliers.map((e) => e.id)),
      { kind: 'deviation', flagged: true, group: key, size: members.length, modal: modal.length, deviants: deviants.length, properties: [...diffs.keys()] },
    );
  }
  return {
    status: 'observed',
    evaluated: groups,
    summary: `${plural(groups, 'peer group')} of three or more; ${plural(items.length, 'group')} with members that depart from the shared treatment.`,
    items,
  };
}
