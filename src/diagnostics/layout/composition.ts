// Layout checks and measurements read by Layout v7 and later: pictures that failed to load, item
// groups whose items sit closer together than their own parts (from Spatial Grouping), text cut
// off on purpose (from Container Overflow), side-by-side boxes of very different height, scroll
// strips that hide items, a pinned layer that opens over the item just used, and headings or
// regions the phone page drops.

import type { Bundle, DiagnosticItem, DiagnosticResult, ElementRecord, Rect, StateRecord } from '../../types.ts';
import { Doc, area, intersect, truncate } from '../doc.ts';
import { loadOutline, walk } from '../outline.ts';
import type { CheckOutput } from './deterministic.ts';
import type { ObservationOutput } from './observations.ts';

export const COMPOSITION_REFERENCE = {
  // Spatial Grouping relations: items this close together, and at most this share of the gap
  // inside them, read as their parts belonging to the neighbouring item.
  inversionBetweenPx: 8,
  inversionRatio: 0.5,
  // Side-by-side boxes: the shorter leaves at least this much empty height, and the taller is
  // at least this many times its height.
  imbalancePx: 240,
  imbalanceRatio: 1.8,
  // Pinned layers: smaller than this share of the screen (a full-screen sheet is a dialog).
  pinnedMaxShare: 0.3,
};

const MIN_IMAGE_PX = 8;
const MAX_ITEMS = 5;

function item(n: number, summary: string, elements: ElementRecord[], doc: Doc, data: Record<string, unknown>): DiagnosticItem {
  return { n, summary, elements: elements.map((e) => doc.ref(e)), data };
}

function descendants(doc: Doc, el: ElementRecord): ElementRecord[] {
  const out: ElementRecord[] = [];
  const stack = [...doc.children(el)];
  while (stack.length) {
    const c = stack.pop()!;
    out.push(c);
    stack.push(...doc.children(c));
  }
  return out;
}

// A short name for an element as the page shows it: its accessible name, its first text, or its
// component name.
export function label(doc: Doc, el: ElementRecord): string {
  const text = el.name ?? (el.ownText ? el.text : null) ?? descendants(doc, el).find((d) => d.visible && d.ownText && d.text)?.text ?? el.componentId;
  return text ? `"${truncate(text.replace(/\s+/g, ' ').trim(), 40)}"` : (el.selector.split(' > ').pop() ?? el.tag).replace(/:nth-of-type\(\d+\)/, '');
}

// ---------- Broken Images (check) ----------

// A picture the browser finished loading with no pixels draws as a broken-image box.
export function brokenImages(doc: Doc): CheckOutput {
  const imgs = doc.els.filter((e) => e.tag === 'img' && e.visible && e.img && e.rect.w >= MIN_IMAGE_PX && e.rect.h >= MIN_IMAGE_PX);
  const broken = imgs.filter((e) => e.img!.complete && e.img!.naturalWidth === 0);
  const items = broken.map((e, i) =>
    item(i + 1, `The picture ${e.name ? `"${truncate(e.name, 48)}"` : label(doc, e)} failed to load and draws as a broken-image box (${Math.round(e.rect.w)}×${Math.round(e.rect.h)} px)`, [e], doc, {
      alt: e.name,
      width: Math.round(e.rect.w),
      height: Math.round(e.rect.h),
    }),
  );
  return {
    status: items.length ? 'fail' : 'pass',
    evaluated: imgs.length,
    summary: items.length ? `${items.length} of ${imgs.length} pictures failed to load.` : `All ${imgs.length} pictures loaded.`,
    items,
    secondary: [],
  };
}

// ---------- Proximity Inversion (check, from Spatial Grouping) ----------

export function proximityInversion(spatial: DiagnosticResult): CheckOutput {
  const R = COMPOSITION_REFERENCE;
  const relations = spatial.items.filter((it) => typeof it.data.betweenMedianPx === 'number' && typeof it.data.withinMedianPx === 'number');
  const inverted = relations.filter((it) => {
    const between = it.data.betweenMedianPx as number;
    const within = it.data.withinMedianPx as number;
    return within > 0 && between <= R.inversionBetweenPx && between / within <= R.inversionRatio;
  });
  const items = inverted.map((it, i) => {
    const between = Math.round(it.data.betweenMedianPx as number);
    const within = Math.round(it.data.withinMedianPx as number);
    const n = it.data.groups as number;
    const summary =
      it.data.level === 'items'
        ? `${n} items sit ${between} px apart while the parts inside each item are ${within} px apart, so each item's parts sit closer to the next item than to each other`
        : `${n} groups sit ${between} px apart while the items inside each group are ${within} px apart, so the groups do not read as separate`;
    return { n: i + 1, summary, elements: it.elements, data: { ...it.data } };
  });
  return {
    status: items.length ? 'fail' : 'pass',
    evaluated: relations.length,
    summary: items.length ? `${items.length} of ${relations.length} groups are spaced closer between items than inside them.` : `No group is spaced closer between items than inside them (${relations.length} measured).`,
    items,
    secondary: [],
  };
}

// ---------- Text Truncation (measurement, from Container Overflow) ----------

// A line clamp on running text (a description, a review) is an excerpt; on a heading, label or
// control it hides words the task needs, as a one-line ellipsis can anywhere.
const NAMING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'button', 'a', 'th', 'legend', 'summary']);
const NAMING_ROLES = new Set(['heading', 'button', 'link', 'tab', 'menuitem', 'columnheader', 'option']);

export function textTruncation(overflow: DiagnosticResult, doc: Doc): ObservationOutput {
  const all = overflow.secondary.find((s) => s.kind === 'truncated')?.items ?? [];
  const elOf = (it: DiagnosticItem) => doc.els.find((e) => e.selector === it.elements[0]?.selector);
  const naming = (a: ElementRecord) => NAMING_TAGS.has(a.tag) || NAMING_ROLES.has(a.role ?? '');
  // The element is the heading, label or control, or the only text inside one (not a
  // description beside a name in a selectable card).
  const names = (el: ElementRecord | undefined) => {
    if (!el) return false;
    if (naming(el)) return true;
    const host = [...doc.ancestors(el)].slice(0, 2).find(naming);
    return !!host && !descendants(doc, host).some((d) => d.visible && d.ownText && d.text?.trim() && d !== el && !doc.isAncestor(el, d));
  };
  const truncated = all.filter((it) => it.data.axis !== 'y' || names(elOf(it)));
  const items = truncated.map((it, i) => {
    const el = elOf(it);
    const how = it.data.axis === 'y' ? 'is clamped to fewer lines than it needs' : 'is cut off with an ellipsis';
    return { n: i + 1, summary: `The text ${el ? label(doc, el) : 'of an element'} ${how}`, elements: it.elements, data: { ...it.data, flagged: true } };
  });
  return { status: 'observed', evaluated: all.length, summary: `${items.length} text element${items.length === 1 ? ' is' : 's are'} truncated on purpose${all.length > items.length ? `; ${all.length - items.length} line-clamped excerpt${all.length - items.length === 1 ? ' is' : 's are'} not counted` : ''}.`, items };
}

// ---------- Row Height Imbalance (measurement) ----------

const boxed = (e: ElementRecord) => e.visible && (e.borderVisible || e.bg !== null) && e.position !== 'fixed' && e.position !== 'sticky';

export function rowImbalance(doc: Doc): ObservationOutput {
  const R = COMPOSITION_REFERENCE;
  const items: DiagnosticItem[] = [];
  let evaluated = 0;
  for (const parent of doc.els) {
    const kids = doc.children(parent);
    const boxes = kids.filter((k) => boxed(k) && k.rect.w >= 200 && k.rect.h >= 80);
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b || Math.abs(a.rect.y - b.rect.y) > 4) continue;
        if (a.rect.x + a.rect.w > b.rect.x + 1 && b.rect.x + b.rect.w > a.rect.x + 1) continue;
        evaluated++;
        const gap = b.rect.h - a.rect.h;
        if (gap < R.imbalancePx || b.rect.h < R.imbalanceRatio * a.rect.h) continue;
        // Something else in the row fills the space under the shorter box.
        const below: Rect = { x: a.rect.x, y: a.rect.y + a.rect.h + 1, w: a.rect.w, h: gap - 2 };
        if (kids.some((k) => k !== a && k !== b && k.visible && intersect(k.rect, below))) continue;
        // A sticky child travels down the column, so the space is not dead.
        if (descendants(doc, a).some((d) => d.position === 'sticky')) continue;
        items.push(
          item(
            items.length + 1,
            `Beside the ${Math.round(b.rect.h)} px tall ${label(doc, b)} box, the ${label(doc, a)} box is ${Math.round(a.rect.h)} px tall, leaving an empty area ${Math.round(a.rect.w)} × ${Math.round(gap)} px under it`,
            [a, b],
            doc,
            { kind: 'imbalance', flagged: true, shortPx: Math.round(a.rect.h), tallPx: Math.round(b.rect.h), emptyPx: Math.round(gap) },
          ),
        );
      }
    }
  }
  return { status: 'observed', evaluated, summary: `${items.length} of ${evaluated} side-by-side box pairs leave a large empty area under the shorter box.`, items };
}

// ---------- Hidden Scroll Items (measurement) ----------

const NAV_CUE = /\b(next|previous|prev|more|scroll|later|earlier)\b|[›‹→←»«]/i;

export function hiddenScrollItems(doc: Doc): ObservationOutput {
  const items: DiagnosticItem[] = [];
  let evaluated = 0;
  for (const e of doc.els) {
    if (!e.visible || !['auto', 'scroll'].includes(e.overflowX) || e.scroll.sw <= e.scroll.cw + 8 || e.rect.w < 100) continue;
    const shown = (x: ElementRecord) => x.visible && area(x.rect) > 0;
    let parts = doc.children(e).filter(shown);
    if (parts.length === 1) parts = doc.children(parts[0]).filter(shown);
    if (parts.length < 3) continue;
    evaluated++;
    const left = e.rect.x + e.border[3];
    const right = left + e.scroll.cw;
    const full = parts.filter((c) => c.rect.x >= left - 1 && c.rect.x + c.rect.w <= right + 1).length;
    const cut = parts.filter((c) => c.rect.x < right - 1 && c.rect.x + c.rect.w > right + 1).length;
    const hidden = parts.length - full - cut;
    if (!hidden && !cut) continue;
    const scope = [...doc.ancestors(e)].slice(0, 3);
    const cue = scope.some((a) => descendants(doc, a).some((d) => d.interactive && d.visible && NAV_CUE.test(`${d.name ?? ''} ${d.text ?? ''}`) && !doc.isAncestor(e, d)));
    if (cue) continue;
    items.push(
      item(
        items.length + 1,
        `${label(doc, e)} scrolls sideways with no next, previous or "more" control beside it: ${full} of its ${parts.length} items are fully in view, ${cut} ${cut === 1 ? 'is' : 'are'} cut at the edge and ${hidden} ${hidden === 1 ? 'is' : 'are'} out of view`,
        [e],
        doc,
        { kind: 'hidden_items', flagged: true, items: parts.length, full, cut, hidden },
      ),
    );
  }
  return { status: 'observed', evaluated, summary: `${items.length} of ${evaluated} sideways-scrolling strips hide items without a cue.`, items };
}

// ---------- Pinned Layer Over Used Item (measurement) ----------

const CLICKED = /(?:clicking|then|choices \() ?([\w-]+) "((?:[^"\\]|\\.)*)"/g;

function pinnedLayers(doc: Doc): ElementRecord[] {
  return doc.els.filter((e) => e.visible && e.position === 'fixed' && ![...doc.ancestors(e)].some((a) => a.position === 'fixed') && area(e.rect) > 0);
}

// After an interaction, a newly pinned layer (a bar, toast or tray) that covers the item whose
// control was used, in the screen the interaction left.
export function pinnedOverUsed(state: StateRecord, doc: Doc, baseline: Doc): ObservationOutput | null {
  const R = COMPOSITION_REFERENCE;
  const used = [...(state.interactiveDescription ?? '').matchAll(CLICKED)].at(-1)?.[2];
  if (!used) return null;
  const before = new Set(pinnedLayers(baseline).map((e) => e.selector));
  const vw = doc.snap.viewport.width;
  const vh = doc.snap.viewport.height;
  const scrollY = state.screenshots.find((x) => x.kind === 'viewport')?.scrollY ?? doc.snap.scroll.y;
  const screen: Rect = { x: 0, y: scrollY, w: vw, h: vh };
  const fresh = pinnedLayers(doc).filter((e) => !before.has(e.selector) && area(e.rect) < R.pinnedMaxShare * vw * vh);
  const clicked = doc.els.find((e) => e.name === used && e.interactive);
  const items: DiagnosticItem[] = [];
  if (clicked && fresh.length) {
    // The item the control belongs to: the nearest ancestor repeated among its siblings.
    const owner =
      [clicked, ...doc.ancestors(clicked)].find((a) => {
        const p = doc.parent(a);
        return !!p && doc.children(p).filter((x) => x.tag === a.tag).length >= 3 && a.rect.h > clicked.rect.h * 2;
      }) ?? clicked;
    const ownerOnScreen = intersect(owner.rect, screen);
    for (const f of ownerOnScreen ? fresh : []) {
      if (!intersect(f.rect, ownerOnScreen!)) continue;
      const covered = descendants(doc, owner).filter((d) => {
        if (!d.visible || !(d.ownText || d.interactive) || area(d.rect) <= 0) return false;
        const hit = intersect(d.rect, f.rect);
        return !!hit && area(hit) >= 0.5 * area(d.rect);
      });
      if (!covered.length) continue;
      const share = Math.round((100 * area(intersect(f.rect, screen) ?? f.rect)) / (vw * vh));
      items.push(
        item(
          items.length + 1,
          `After "${truncate(used, 40)}" is used, the pinned ${label(doc, f)} layer (${Math.round(f.rect.h)} px tall, ${share}% of the screen) opens over the ${owner === clicked ? 'control' : `item it belongs to (${label(doc, owner)})`}, covering ${covered.length} of its text or controls`,
          [f, owner],
          doc,
          { kind: 'covers_used', flagged: true, covered: covered.length, heightPx: Math.round(f.rect.h), screenShare: share },
        ),
      );
    }
  }
  return { status: 'observed', evaluated: fresh.length, summary: `${items.length} newly pinned layer${items.length === 1 ? '' : 's'} cover the item just used.`, items };
}

// ---------- Viewport Content Parity (measurement) ----------

const PARITY_ROLES = new Set(['heading', 'region', 'complementary', 'navigation', 'table', 'form', 'dialog']);

// Headings and named regions of the desktop page (and the tablet page, when collected) that the
// phone page shows nowhere, neither at load nor in any phone interactive state.
export function viewportParity(bundle: Bundle): ObservationOutput | null {
  const st = (id: string) => bundle.states.find((s) => s.id === id && s.status === 'collected');
  const desktop = st('desktop');
  const tablet = st('tablet');
  const phone = st('mobile');
  if (!desktop || !phone) return null;
  const named = (s: StateRecord | undefined) => {
    const o = s ? loadOutline(bundle, s) : null;
    const out = new Map<string, string>();
    for (const n of o ? walk(o) : []) {
      const name = (n.name ?? n.text ?? '').replace(/\s+/g, ' ').trim();
      if (PARITY_ROLES.has(n.role) && name) out.set(name.toLowerCase(), `${n.role} "${truncate(name, 48)}"`);
    }
    return out;
  };
  const d = named(desktop);
  const t = tablet ? named(tablet) : null;
  const onPhone = new Set<string>();
  for (const s of [phone, ...bundle.states.filter((x) => x.viewportId === 'mobile' && x.kind === 'interactive' && x.status === 'collected')]) {
    for (const k of named(s).keys()) onPhone.add(k);
  }
  const missing = [...d.entries()].filter(([k]) => !onPhone.has(k) && (!t || t.has(k))).sort(([a], [b]) => a.localeCompare(b));
  const items: DiagnosticItem[] = missing.slice(0, MAX_ITEMS).map(([k, v], i) => ({
    n: i + 1,
    summary: `The ${v} on the desktop${t ? ' and tablet' : ''} page is not on the phone page, nor in any phone state captured`,
    elements: [],
    data: { kind: 'missing_on_phone', flagged: true, name: k },
  }));
  if (missing.length > MAX_ITEMS) {
    items.push({ n: items.length + 1, summary: `${missing.length - MAX_ITEMS} more headings or regions are missing from the phone page`, elements: [], data: { kind: 'missing_on_phone', flagged: true, more: missing.length - MAX_ITEMS } });
  }
  return { status: 'observed', evaluated: d.size, summary: `${missing.length} of ${d.size} desktop headings and regions are missing from the phone page.`, items };
}
