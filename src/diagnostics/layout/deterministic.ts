import { COMPONENT_MIN_DIMENSIONS, OVERLAP_MIN_PROPORTION, TOLERANCE_PX, VISUAL_COMPONENT_TYPES } from '../../config.ts';
import type { DiagnosticItem, ElementRecord, Rect } from '../../types.ts';
import { round1 } from '../../util.ts';
import {
  Doc,
  FORM_CONTROL_TAGS,
  LANDMARK_ROLES,
  MEDIA_TAGS,
  SEMANTIC_TAGS,
  TABLE_PART_TAGS,
  area,
  bottom,
  fmtRect,
  intersect,
  isInlineDisplay,
  isScrollable,
  outermost,
  right,
} from '../doc.ts';

export interface StateContext {
  stateId: string;
  viewport: { width: number; height: number };
}

export interface CheckOutput {
  status: 'pass' | 'fail';
  evaluated: number;
  summary: string;
  items: DiagnosticItem[];
  secondary: { kind: string; label: string; items: DiagnosticItem[] }[];
  data?: Record<string, unknown>;
}

const TOL = TOLERANCE_PX;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const r0 = (n: number) => Math.round(n);

function item(n: number, summary: string, elements: ElementRecord[], doc: Doc, data: Record<string, unknown>): DiagnosticItem {
  return { n, summary, elements: elements.map((e) => doc.ref(e)), data };
}

// ---------- Region Overlap ----------

function isLabelForOther(doc: Doc, label: ElementRecord, other: ElementRecord): boolean {
  if (label.tag !== 'label' || label.labelFor === null) return false;
  const ctrl = doc.get(label.labelFor);
  return !!ctrl && (ctrl.id === other.id || doc.isAncestor(other, ctrl));
}

// Whether the part of `el` within `r` shows only media (images, video, canvas, svg, background
// images) and no text or controls, so something placed there is a deliberate overlay.
function onlyMediaWithin(doc: Doc, el: ElementRecord, r: Rect): boolean {
  if (MEDIA_TAGS.has(el.tag) || el.bgImage) return true;
  let media = false;
  const stack = [...doc.children(el)];
  while (stack.length) {
    const c = stack.pop()!;
    if (!c.visible || !intersect(c.rect, r)) continue;
    if (MEDIA_TAGS.has(c.tag) || c.bgImage) {
      media = true;
      continue;
    }
    if (c.interactive || c.ownText) return false;
    stack.push(...doc.children(c));
  }
  return media;
}

export function regionOverlap(doc: Doc, _ctx: StateContext): CheckOutput {
  const vis = new Map<number, Rect>();
  const eligible: ElementRecord[] = [];
  for (const el of doc.els) {
    if (!el.visible || el.overlay || el.tag === 'body' || TABLE_PART_TAGS.has(el.tag)) continue;
    if (el.display === 'contents' || el.display === 'none') continue;
    if (el.display === 'inline' && !(el.interactive && el.lineBoxes <= 1)) continue;
    if (doc.visuallyHiddenChain(el) || doc.isHostBadge(el)) continue;
    const semantic = SEMANTIC_TAGS.has(el.tag) || (el.role !== null && LANDMARK_ROLES.has(el.role));
    const parent = doc.parent(el);
    const layoutChild = !!parent && !isInlineDisplay(parent.display) && !isInlineDisplay(el.display);
    if (!(el.interactive || el.componentId || semantic || MEDIA_TAGS.has(el.tag) || layoutChild)) continue;
    const vr = doc.visibleRect(el);
    if (!vr || vr.w <= 0 || vr.h <= 0) continue;
    vis.set(el.id, vr);
    eligible.push(el);
  }

  const sorted = [...eligible].sort((a, b) => vis.get(a.id)!.x - vis.get(b.id)!.x);
  type Pair = { a: ElementRecord; b: ElementRecord; inter: Rect; proportion: number };
  const failing = new Map<string, Pair>();
  const intentional: Pair[] = [];
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const ra = vis.get(a.id)!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const rb = vis.get(b.id)!;
      if (rb.x >= right(ra) - TOL) break;
      const inter = intersect(ra, rb);
      if (!inter || inter.w <= TOL || inter.h <= TOL) continue;
      if (doc.related(a, b)) continue;
      const proportion = area(inter) / Math.min(area(ra), area(rb));
      if (proportion < OVERLAP_MIN_PROPORTION) continue;
      const pair = { a, b, inter, proportion };
      if (doc.isDecorative(a) || doc.isDecorative(b) || onlyMediaWithin(doc, a, inter) || onlyMediaWithin(doc, b, inter) || isLabelForOther(doc, a, b) || isLabelForOther(doc, b, a)) {
        intentional.push(pair);
      } else {
        failing.set(key(a.id, b.id), pair);
      }
    }
  }

  // Report only the outermost failing pair when ancestors also collide.
  const selfAndAncestors = (el: ElementRecord) => [el, ...doc.ancestors(el)];
  const reported: Pair[] = [];
  let nested = 0;
  for (const pair of failing.values()) {
    const as = selfAndAncestors(pair.a);
    const bs = selfAndAncestors(pair.b);
    let covered = false;
    outer: for (const x of as)
      for (const y of bs) {
        if (x.id === pair.a.id && y.id === pair.b.id) continue;
        if (x.id !== y.id && failing.has(key(x.id, y.id))) {
          covered = true;
          break outer;
        }
      }
    if (covered) nested++;
    else reported.push(pair);
  }
  reported.sort((p, q) => q.proportion - p.proportion);
  intentional.sort((p, q) => q.proportion - p.proportion);

  const toItem = (p: Pair, n: number) =>
    item(
      n,
      `${doc.describe(p.a)} overlaps ${doc.describe(p.b)} by ${r0(p.inter.w)}×${r0(p.inter.h)} px (${pct(p.proportion)} of the smaller element)`,
      [p.a, p.b],
      doc,
      {
        a: vis.get(p.a.id),
        b: vis.get(p.b.id),
        intersection: { x: round1(p.inter.x), y: round1(p.inter.y), w: round1(p.inter.w), h: round1(p.inter.h) },
        intersectionArea: r0(area(p.inter)),
        proportion: Math.round(p.proportion * 1000) / 1000,
      },
    );

  const items = reported.map((p, i) => toItem(p, i + 1));
  return {
    status: items.length ? 'fail' : 'pass',
    evaluated: eligible.length,
    summary: items.length
      ? `${items.length} colliding pair${items.length > 1 ? 's' : ''} among ${eligible.length} eligible elements${nested ? ` (${nested} nested pairs folded into their outermost pair)` : ''}. Largest: ${items[0].summary}.`
      : `No collisions among ${eligible.length} eligible elements.`,
    items,
    secondary: intentional.length
      ? [{ kind: 'media_decorative_overlap', label: 'Media/decorative overlaps (not failures)', items: intentional.map((p, i) => toItem(p, i + 1)) }]
      : [],
  };
}

// ---------- Container Overflow ----------

const CONTAINER_DISPLAYS = new Set([
  'block', 'flow-root', 'inline-block', 'list-item', 'flex', 'inline-flex', 'grid', 'inline-grid', 'table', 'inline-table', 'table-cell',
]);

type Axis = 'x' | 'y';

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

function extendsBeyond(r: Rect, box: Rect, axis: Axis): number {
  if (axis === 'x') return Math.max(right(r) - right(box), box.x - r.x);
  return Math.max(bottom(r) - bottom(box), box.y - r.y);
}

// Descendants whose box extends beyond `box` on `axis`, excluding content clipped by an
// intermediate container, overlay layers, host badges, and absolutely positioned content whose
// containing block lies outside the container.
function overflowOffenders(doc: Doc, container: ElementRecord, box: Rect, axis: Axis): ElementRecord[] {
  const out: ElementRecord[] = [];
  for (const d of descendants(doc, container)) {
    if (!d.visible || d.overlay || doc.isHostBadge(d) || d.visuallyHidden) continue;
    if (d.display === 'contents') continue;
    if (d.position === 'absolute') {
      const cb = doc.containingBlock(d);
      if (!cb || !(cb.id === container.id || doc.isAncestor(container, cb))) continue;
    }
    const clipped = doc.clipChain(d).clippers.some(
      (c) => c.id !== container.id && doc.isAncestor(container, c) && (axis === 'x' ? c.overflowX : c.overflowY) !== 'visible',
    );
    if (clipped) continue;
    const r = d.textRect && d.display === 'inline' ? d.textRect : d.rect;
    if (r.w <= 0 && r.h <= 0) continue;
    if (extendsBeyond(r, box, axis) > TOL) out.push(d);
  }
  return outermost(doc, out);
}

function ownTextBeyond(el: ElementRecord, box: Rect, axis: Axis): number {
  return el.textRect ? extendsBeyond(el.textRect, box, axis) : 0;
}

export function containerOverflow(doc: Doc, ctx: StateContext): CheckOutput {
  const failures: { container: ElementRecord | null; axis: Axis; overflow: number; mode: string; kind: string; offenders: ElementRecord[] }[] = [];
  const truncated: DiagnosticItem[] = [];
  const visibleCandidates: { container: ElementRecord; axis: Axis; overflow: number; offenders: ElementRecord[]; ownText: boolean }[] = [];
  let evaluated = 0;

  for (const el of doc.els) {
    if (!el.visible || el.tag === 'body' || MEDIA_TAGS.has(el.tag) || FORM_CONTROL_TAGS.has(el.tag)) continue;
    if (!(CONTAINER_DISPLAYS.has(el.display) || el.componentId)) continue;
    if (doc.visuallyHiddenChain(el)) continue;
    evaluated++;
    for (const axis of ['x', 'y'] as Axis[]) {
      const overflow = axis === 'x' ? el.scroll.sw - el.scroll.cw : el.scroll.sh - el.scroll.ch;
      const mode = axis === 'x' ? el.overflowX : el.overflowY;
      if (isScrollable(mode)) continue;

      if (mode === 'hidden' || mode === 'clip') {
        if (overflow <= TOL) continue;
        const offenders = overflowOffenders(doc, el, doc.clientBox(el), axis);
        const isTruncation =
          (axis === 'x' && el.textOverflow === 'ellipsis') || (axis === 'y' && el.lineClamp !== 'none' && el.lineClamp !== '');
        if (isTruncation) {
          truncated.push(
            item(truncated.length + 1, `${doc.describe(el)} truncates its text (${axis === 'x' ? 'ellipsis' : 'line clamp'})`, [el], doc, {
              axis,
              overflowPx: r0(overflow),
              fullText: el.text,
            }),
          );
          continue;
        }
        failures.push({ container: el, axis, overflow, mode, kind: 'clipped', offenders });
      } else {
        const box = el.rect;
        const offenders = overflowOffenders(doc, el, box, axis);
        const ownText = ownTextBeyond(el, box, axis) > TOL;
        if (!offenders.length && !ownText) continue;
        const measured = Math.max(
          overflow,
          ...offenders.map((o) => extendsBeyond(o.textRect && o.display === 'inline' ? o.textRect : o.rect, box, axis)),
          ownText ? ownTextBeyond(el, box, axis) : 0,
        );
        if (measured <= TOL) continue;
        visibleCandidates.push({ container: el, axis, overflow: measured, offenders, ownText });
      }
    }
  }

  // Attribute each visible-overflow offender to the innermost container it overflows.
  const deepest = new Map<string, { depth: number; containerId: number }>();
  for (const c of visibleCandidates) {
    for (const o of c.offenders) {
      const k = `${c.axis}:${o.id}`;
      const prev = deepest.get(k);
      if (!prev || c.container.depth > prev.depth) deepest.set(k, { depth: c.container.depth, containerId: c.container.id });
    }
  }
  for (const c of visibleCandidates) {
    const kept = c.offenders.filter((o) => deepest.get(`${c.axis}:${o.id}`)?.containerId === c.container.id);
    if (!kept.length && !c.ownText) continue;
    failures.push({ container: c.container, axis: c.axis, overflow: c.overflow, mode: 'visible', kind: 'visible', offenders: kept });
  }

  // Masked page overflow: html/body clip horizontally, so the document cannot scroll.
  const d = doc.snap.doc;
  const rootClipsX = ['hidden', 'clip'].includes(d.htmlOverflowX) || ['hidden', 'clip'].includes(d.bodyOverflowX);
  if (rootClipsX) {
    const vw = d.clientWidth;
    const beyond = doc.els.filter((el) => {
      if (!el.visible || el.overlay || el.visuallyHidden || el.tag === 'body') return false;
      const vr = visibleRectIgnoringRoot(doc, el);
      return !!vr && (right(vr) > vw + TOL || vr.x < -TOL);
    });
    const offenders = outermost(doc, beyond);
    if (offenders.length) {
      const maxRight = Math.max(...offenders.map((o) => right(o.rect)));
      failures.push({ container: null, axis: 'x', overflow: Math.max(maxRight - vw, ...offenders.map((o) => -o.rect.x)), mode: `root ${d.bodyOverflowX}`, kind: 'root_clipped', offenders });
    }
  }

  failures.sort((a, b) => b.overflow - a.overflow);
  const items = failures.map((f, i) => {
    const where = f.container ? doc.describe(f.container) : 'the document root (viewport)';
    const offenderText = f.offenders.length
      ? `; caused by ${f.offenders.slice(0, 3).map((o) => doc.describe(o)).join(', ')}${f.offenders.length > 3 ? ` and ${f.offenders.length - 3} more` : ''}`
      : '';
    const what = f.kind === 'visible' ? 'content spills outside' : 'content is clipped by';
    return item(
      i + 1,
      `${r0(f.overflow)} px ${f.axis === 'x' ? 'horizontal' : 'vertical'} overflow: ${what} ${where} (overflow-${f.axis}: ${f.mode})${offenderText}`,
      [...(f.container ? [f.container] : []), ...f.offenders.slice(0, 5)],
      doc,
      {
        axis: f.axis,
        overflowPx: r0(f.overflow),
        overflowStyle: f.mode,
        kind: f.kind,
        container: f.container ? f.container.rect : null,
        offenders: f.offenders.slice(0, 8).map((o) => ({ selector: o.selector, rect: o.rect })),
        viewportWidth: ctx.viewport.width,
      },
    );
  });

  return {
    status: items.length ? 'fail' : 'pass',
    evaluated,
    summary: items.length
      ? `${items.length} container overflow${items.length > 1 ? 's' : ''} across ${evaluated} evaluated containers. Largest: ${items[0].summary}.`
      : `No container overflow beyond ${TOL} px on a non-scrollable axis across ${evaluated} containers.`,
    items,
    secondary: truncated.length ? [{ kind: 'truncated', label: 'Deliberate truncation (not failures)', items: truncated }] : [],
  };
}

function visibleRectIgnoringRoot(doc: Doc, el: ElementRecord): Rect | null {
  let r: Rect = { ...el.rect };
  for (const a of doc.clipChain(el).clippers) {
    if (a.tag === 'body') continue;
    const box = doc.clientBox(a);
    if (a.overflowX !== 'visible') {
      const x1 = Math.max(r.x, box.x);
      const x2 = Math.min(right(r), right(box));
      if (x2 <= x1) return null;
      r = { ...r, x: x1, w: x2 - x1 };
    }
  }
  return r;
}

// ---------- Page-Level Horizontal Overflow ----------

export function pageHorizontalOverflow(doc: Doc, ctx: StateContext): CheckOutput {
  const d = doc.snap.doc;
  const overflow = d.scrollWidth - d.clientWidth;
  const data = {
    documentWidth: d.scrollWidth,
    viewportWidth: d.clientWidth,
    overflowPx: Math.max(0, overflow),
    viewportMeta: d.viewportMeta,
  };
  const metaNote = d.viewportMeta ? '' : ' The page declares no viewport meta tag, so a phone browser would lay it out at 980 px and scale it down.';
  if (overflow <= TOL) {
    return {
      status: 'pass',
      evaluated: 1,
      summary: `Document width ${d.scrollWidth} px fits the ${d.clientWidth} px viewport.${metaNote}`,
      items: [],
      secondary: [],
      data,
    };
  }
  const beyond = doc.els.filter((el) => {
    if (!el.visible || el.overlay || el.tag === 'body') return false;
    const vr = doc.visibleRect(el);
    return !!vr && (right(vr) > d.clientWidth + TOL || vr.x < -TOL);
  });
  const offenders = outermost(doc, beyond).sort((a, b) => right(b.rect) - right(a.rect));
  const top = offenders.slice(0, 8);
  return {
    status: 'fail',
    evaluated: 1,
    summary: `The page scrolls horizontally: document is ${d.scrollWidth} px wide in a ${d.clientWidth} px viewport (${overflow} px overflow). Likely offenders: ${top.slice(0, 3).map((o) => doc.describe(o)).join(', ') || 'unattributed'}.${metaNote}`,
    items: [
      item(1, `Document ${d.scrollWidth} px wide vs ${d.clientWidth} px viewport (${overflow} px horizontal overflow at ${ctx.viewport.width} px)`, top, doc, {
        ...data,
        offenders: top.map((o) => ({ selector: o.selector, rect: o.rect, rightEdge: r0(right(o.rect)) })),
      }),
    ],
    secondary: [],
    data,
  };
}

// ---------- Interactive Element Reachability ----------

interface ReachResult {
  ok: boolean;
  clippedBy: ElementRecord | 'viewport' | null;
  mode: string | null;
  edges: string[];
  visibleFraction: number;
}

function reachability(doc: Doc, el: ElementRecord, vw: number, vh: number): ReachResult {
  let box = { ...el.rect };
  let needW = el.rect.w;
  let needH = el.rect.h;
  let clippedBy: ElementRecord | 'viewport' | null = null;
  let mode: string | null = null;
  const edges = new Set<string>();
  let fracX = 1;
  let fracY = 1;
  const { clippers, inFixed } = doc.clipChain(el);

  const applyRange = (axis: Axis, start: number, len: number, scrollable: boolean, by: ElementRecord | 'viewport', m: string) => {
    const bStart = axis === 'x' ? box.x : box.y;
    const bLen = axis === 'x' ? box.w : box.h;
    const need = axis === 'x' ? needW : needH;
    const vs = Math.max(bStart, start);
    const ve = Math.min(bStart + bLen, start + len);
    const visible = Math.max(0, ve - vs);
    const required = scrollable ? Math.min(need, len) : need;
    if (visible < required - TOL) {
      if (!clippedBy) {
        clippedBy = by;
        mode = m;
      }
      if (bStart < start - TOL) edges.add(axis === 'x' ? 'left' : 'top');
      if (bStart + bLen > start + len + TOL) edges.add(axis === 'x' ? 'right' : 'bottom');
      const f = need > 0 ? visible / need : 0;
      if (axis === 'x') fracX = Math.min(fracX, f);
      else fracY = Math.min(fracY, f);
    }
    return { vs, visible };
  };

  for (const a of clippers) {
    const cb = doc.clientBox(a);
    for (const axis of ['x', 'y'] as Axis[]) {
      const ov = axis === 'x' ? a.overflowX : a.overflowY;
      if (ov === 'visible') continue;
      const cStart = axis === 'x' ? cb.x : cb.y;
      const cLen = axis === 'x' ? cb.w : cb.h;
      if (isScrollable(ov)) {
        const scrollPos = axis === 'x' ? a.scroll.sl : a.scroll.st;
        const scrollSize = Math.max(axis === 'x' ? a.scroll.sw : a.scroll.sh, cLen);
        applyRange(axis, cStart - scrollPos, scrollSize, true, a, ov);
        // Once scrolled into view, the element occupies part of this scrollport.
        if (axis === 'x') {
          needW = Math.min(needW, cLen);
          box = { ...box, x: cStart, w: cLen };
        } else {
          needH = Math.min(needH, cLen);
          box = { ...box, y: cStart, h: cLen };
        }
      } else {
        const { vs, visible } = applyRange(axis, cStart, cLen, false, a, ov);
        if (axis === 'x') {
          box = { ...box, x: vs, w: visible };
          needW = Math.min(needW, visible);
        } else {
          box = { ...box, y: vs, h: visible };
          needH = Math.min(needH, visible);
        }
      }
    }
  }

  const d = doc.snap.doc;
  const rootClipsX = ['hidden', 'clip'].includes(d.htmlOverflowX) || ['hidden', 'clip'].includes(d.bodyOverflowX);
  const rootClipsY = ['hidden', 'clip'].includes(d.htmlOverflowY) || ['hidden', 'clip'].includes(d.bodyOverflowY);
  if (inFixed) {
    // Fixed elements are positioned against the visible viewport, which mobile browsers widen
    // when they zoom out to fit overflowing content (innerWidth > clientWidth).
    applyRange('x', 0, Math.max(vw, doc.snap.viewport.width), false, 'viewport', 'fixed');
    applyRange('y', 0, Math.max(vh, doc.snap.viewport.height), false, 'viewport', 'fixed');
  } else {
    const docScrollsX = !rootClipsX && d.scrollWidth > d.clientWidth + TOL;
    applyRange('x', 0, docScrollsX ? d.scrollWidth : vw, docScrollsX, 'viewport', docScrollsX ? 'page scroll' : 'viewport');
    applyRange('y', 0, rootClipsY ? vh : Math.max(d.scrollHeight, vh), !rootClipsY, 'viewport', rootClipsY ? 'viewport (page scroll locked)' : 'page scroll');
  }
  const visibleFraction = Math.max(0, Math.min(1, fracX * fracY));
  return { ok: clippedBy === null, clippedBy, mode, edges: [...edges], visibleFraction };
}

function offCanvasContainer(doc: Doc, el: ElementRecord, vw: number): ElementRecord | null {
  for (const c of [el, ...doc.ancestors(el)]) {
    if (!(c.transform || c.position === 'fixed' || c.position === 'absolute')) continue;
    if (right(c.rect) <= 0 || c.rect.x >= vw || bottom(c.rect) <= 0) return c;
  }
  return null;
}

export function interactiveReachability(doc: Doc, ctx: StateContext): CheckOutput {
  const vw = doc.snap.doc.clientWidth || ctx.viewport.width;
  const vh = ctx.viewport.height;
  const failures: DiagnosticItem[] = [];
  const disclosed: DiagnosticItem[] = [];
  let evaluated = 0;
  for (const el of doc.els) {
    if (!el.interactive || !el.visible || el.disabled || el.inert || el.ariaHidden || el.hiddenAttr || el.closedDetails) continue;
    if (doc.visuallyHiddenChain(el) || el.rect.w <= 0 || el.rect.h <= 0) continue;
    evaluated++;
    const res = reachability(doc, el, vw, vh);
    if (res.ok) continue;
    const by = res.clippedBy === 'viewport' ? 'the viewport' : doc.describe(res.clippedBy as ElementRecord);
    const data = {
      clippedFraction: Math.round((1 - res.visibleFraction) * 100) / 100,
      edges: res.edges,
      clippingAncestor: res.clippedBy === 'viewport' ? 'viewport' : (res.clippedBy as ElementRecord).selector,
      overflowMode: res.mode,
    };
    const offCanvas = offCanvasContainer(doc, el, vw);
    if (offCanvas) {
      disclosed.push(
        item(disclosed.length + 1, `${doc.describe(el)} sits in off-canvas container ${doc.describe(offCanvas)}`, [el, offCanvas], doc, {
          ...data,
          offCanvasContainer: offCanvas.selector,
        }),
      );
      continue;
    }
    const elements = res.clippedBy && res.clippedBy !== 'viewport' ? [el, res.clippedBy as ElementRecord] : [el];
    failures.push(
      item(
        failures.length + 1,
        `${doc.describe(el)} cannot be fully revealed: ${pct(1 - res.visibleFraction)} clipped at the ${res.edges.join('/') || 'edge'} by ${by} (${res.mode})`,
        elements,
        doc,
        data,
      ),
    );
  }
  return {
    status: failures.length ? 'fail' : 'pass',
    evaluated,
    summary: failures.length
      ? `${failures.length} of ${evaluated} interactive elements cannot be fully revealed. First: ${failures[0].summary}.`
      : `All ${evaluated} evaluated interactive elements can be fully revealed${disclosed.length ? ` (${disclosed.length} off-canvas controls listed separately)` : ''}.`,
    items: failures,
    secondary: disclosed.length ? [{ kind: 'possibly_disclosed', label: 'Possibly disclosed (off-canvas, not failures)', items: disclosed }] : [],
  };
}

// ---------- Collapsed Component Dimensions ----------

export function collapsedDimensions(doc: Doc, _ctx: StateContext): CheckOutput {
  const failures: DiagnosticItem[] = [];
  let evaluated = 0;
  for (const el of doc.els) {
    const ctype = el.componentType?.toLowerCase() ?? null;
    const isVisualType = ctype !== null && VISUAL_COMPONENT_TYPES.includes(ctype);
    if (!(['img', 'canvas', 'svg', 'video'].includes(el.tag) || isVisualType)) continue;
    if (!el.visible) continue;
    if (el.tag === 'svg' && el.svgOnlyDefs) continue;
    if (el.tag === 'img' && el.ariaHidden && el.rect.w <= 1 && el.rect.h <= 1) continue;
    evaluated++;
    const { w, h } = el.rect;
    const threshold = ctype ? COMPONENT_MIN_DIMENSIONS[ctype] : undefined;
    const invalid = !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0;
    const belowMin = !!threshold && (w < threshold.width || h < threshold.height);
    if (!invalid && !belowMin) continue;
    failures.push(
      item(
        failures.length + 1,
        `${doc.describe(el)} (${ctype ?? el.tag}) renders at ${r0(w)}×${r0(h)} px${belowMin && threshold ? ` (minimum ${threshold.width}×${threshold.height})` : ''}`,
        [el],
        doc,
        { componentType: ctype ?? el.tag, width: w, height: h, threshold: threshold ?? null },
      ),
    );
  }
  return {
    status: failures.length ? 'fail' : 'pass',
    evaluated,
    summary: failures.length
      ? `${failures.length} of ${evaluated} visual components render at invalid or collapsed dimensions. First: ${failures[0].summary}.`
      : `All ${evaluated} visual components (img, canvas, svg, video, annotated visuals) have valid dimensions.`,
    items: failures,
    secondary: [],
  };
}

// ---------- Occluded Content ----------

const OBSTRUCTION_TEXT: Record<string, string> = {
  off_page: 'the page edge (it extends where the page cannot be scrolled)',
  off_screen: 'the screen edge (a pinned element extends past it)',
  unsafe_area: "the device's unsafe area (the page opts into drawing under it with viewport-fit=cover)",
};

// Content that can never be seen unobstructed, from the occlusion probe collected in the page.
// One item per obstruction, listing the content it hides.
export function occludedContent(doc: Doc, _ctx: StateContext): CheckOutput {
  const probe = doc.snap.occlusion;
  if (!probe) throw new Error('Occlusion probe data was not collected for this state.');
  const groups = new Map<string, { by: (typeof probe.records)[number]['by'][number]; records: typeof probe.records }>();
  for (const r of probe.records) {
    const by = r.by[0];
    const k = by.id !== null ? `el:${by.id}` : by.selector;
    const g = groups.get(k) ?? { by, records: [] };
    g.records.push(r);
    groups.set(k, g);
  }
  const describeRec = (r: (typeof probe.records)[number]) => {
    const el = doc.get(r.id);
    return el ? doc.describe(el) : `${r.element.selector}${r.element.name ? ` "${r.element.name.slice(0, 48)}"` : ''}`;
  };
  const describeBy = (by: (typeof probe.records)[number]['by'][number]) => {
    if (by.id === null) return OBSTRUCTION_TEXT[by.selector] ?? by.selector;
    const el = doc.get(by.id);
    const base = el ? doc.describe(el) : `${by.selector}${by.name ? ` "${by.name.slice(0, 48)}"` : ''}`;
    return by.position === 'fixed' || by.position === 'sticky' ? `${base} (${by.position})` : base;
  };
  const items = [...groups.values()]
    .sort((a, b) => Math.max(...b.records.map((r) => r.hiddenFraction)) - Math.max(...a.records.map((r) => r.hiddenFraction)))
    .map((g, i) => {
      const recs = [...g.records].sort((a, b) => b.hiddenFraction - a.hiddenFraction);
      const when = recs.every((r) => r.pinned) ? 'while pinned in place' : 'at every scroll position';
      const listed = recs.slice(0, 3).map((r) => `${describeRec(r)} (${pct(r.hiddenFraction)} never visible)`).join('; ');
      const els = [g.by.id !== null ? doc.get(g.by.id) : undefined, ...recs.slice(0, 3).map((r) => doc.get(r.id))].filter((e): e is ElementRecord => !!e);
      return item(
        i + 1,
        `${recs.length} element${recs.length > 1 ? 's are' : ' is'} hidden by ${describeBy(g.by)} ${when}: ${listed}${recs.length > 3 ? `; and ${recs.length - 3} more` : ''}`,
        els,
        doc,
        {
          obstruction: g.by.id === null ? g.by.selector : 'element',
          obstructionPosition: g.by.position || null,
          hiddenElements: recs.length,
          maxHiddenFraction: recs[0].hiddenFraction,
          pinned: recs.every((r) => r.pinned),
        },
      );
    });
  return {
    status: items.length ? 'fail' : 'pass',
    evaluated: probe.candidates,
    summary: items.length
      ? `${probe.records.length} of ${probe.candidates} content elements can never be seen unobstructed. Largest: ${items[0].summary}.`
      : `All ${probe.candidates} content elements (text, controls, media) can be seen unobstructed at some scroll position${probe.topLayers.length ? `; only content inside the open ${probe.topLayers.length > 1 ? 'layers' : 'layer'} was judged` : ''}.`,
    items,
    secondary: [],
    data: { scrollPositions: probe.positions.length, topLayers: probe.topLayers.map((t) => t.selector), unsafeArea: probe.unsafeArea },
  };
}

// ---------- Control availability across widths (part of Responsive Layout Failures) ----------

// A control, matched by role and accessible name, that can be used at narrower and at wider
// widths but not in a band between them. Any instance counts, so a control that moves (for
// example from a phone action bar into a desktop summary) stays available.
export function controlAvailability(sweep: { width: number; stateId: string; doc: Doc }[]) {
  const usable = (doc: Doc, el: ElementRecord) => {
    if (!el.interactive || !el.visible || el.disabled || el.inert || el.ariaHidden || el.hiddenAttr || el.closedDetails) return false;
    if (doc.visuallyHiddenChain(el) || el.rect.w <= 0 || el.rect.h <= 0) return false;
    // Hidden by a clipping ancestor that cannot be scrolled (scroll containers can reveal it).
    for (const c of doc.clipChain(el).clippers) {
      const box = doc.clientBox(c);
      const hidX = !isScrollable(c.overflowX) && c.overflowX !== 'visible' && (right(el.rect) <= box.x || el.rect.x >= right(box));
      const hidY = !isScrollable(c.overflowY) && c.overflowY !== 'visible' && (bottom(el.rect) <= box.y || el.rect.y >= bottom(box));
      if (hidX || hidY) return false;
    }
    const pageWidth = Math.max(doc.snap.doc.scrollWidth, doc.snap.viewport.width);
    return right(el.rect) > 0 && el.rect.x < pageWidth;
  };
  const keyOf = (el: ElementRecord) => (el.name ? `${el.role ?? el.tag}|${el.name.replace(/\s+/g, ' ').trim().toLowerCase()}` : null);
  const sorted = [...sweep].sort((a, b) => a.width - b.width);
  const avail = new Map<string, { label: string; at: boolean[] }>();
  sorted.forEach(({ doc }, i) => {
    for (const el of doc.els) {
      const key = keyOf(el);
      if (!key || !usable(doc, el)) continue;
      const entry = avail.get(key) ?? { label: `${el.role ?? el.tag} "${truncateName(el.name!)}"`, at: sorted.map(() => false) };
      entry.at[i] = true;
      avail.set(key, entry);
    }
  });
  const gaps: { key: string; label: string; missing: number[]; below: number; above: number }[] = [];
  for (const [key, { label, at }] of avail) {
    let i = 0;
    while (i < at.length) {
      if (at[i] || i === 0 || !at.slice(0, i).some(Boolean)) {
        i++;
        continue;
      }
      let j = i;
      while (j < at.length && !at[j]) j++;
      if (j < at.length) gaps.push({ key, label, missing: sorted.slice(i, j).map((s) => s.width), below: sorted[i - 1].width, above: sorted[j].width });
      i = j;
    }
  }
  const items: DiagnosticItem[] = gaps.map((g, n) => ({
    n: n + 1,
    summary: `${g.label} can be used at ${g.below} px and at ${g.above} px but not at ${g.missing[0]}${g.missing.length > 1 ? `–${g.missing[g.missing.length - 1]}` : ''} px`,
    elements: [],
    data: { check: 'control_availability', control: g.key, missingWidths: g.missing, availableBelow: g.below, availableAbove: g.above },
  }));
  const cells = sorted.map((s) => {
    const n = gaps.filter((g) => g.missing.includes(s.width)).length;
    return { column: `${s.width}px`, stateId: s.stateId, status: (n ? 'fail' : 'pass') as 'fail' | 'pass', failures: n };
  });
  return { items, cells, evaluated: avail.size };
}

function truncateName(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

export const STATE_CHECKS = [
  { diagId: 'region_overlap', name: 'Region Overlap', fn: regionOverlap },
  { diagId: 'container_overflow', name: 'Container Overflow', fn: containerOverflow },
  { diagId: 'page_horizontal_overflow', name: 'Page-Level Horizontal Overflow', fn: pageHorizontalOverflow },
  { diagId: 'interactive_reachability', name: 'Interactive Element Reachability', fn: interactiveReachability },
  { diagId: 'collapsed_dimensions', name: 'Collapsed Component Dimensions', fn: collapsedDimensions },
  { diagId: 'occluded_content', name: 'Occluded Content', fn: occludedContent },
] as const;

export { fmtRect };
