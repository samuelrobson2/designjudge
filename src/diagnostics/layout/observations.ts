import type { DiagnosticItem, ElementRecord, Rect, ShiftEntry, Snapshot } from '../../types.ts';
import { median, round1, round2 } from '../../util.ts';
import { Doc, MEDIA_TAGS, SEMANTIC_TAGS, LANDMARK_ROLES, TABLE_PART_TAGS, area, bottom, intersect, isInlineDisplay, right } from '../doc.ts';

export interface ObservationOutput {
  status: 'observed';
  evaluated: number;
  summary: string;
  items: DiagnosticItem[];
  data?: Record<string, unknown>;
}

const r0 = (n: number) => Math.round(n);

function item(n: number, summary: string, elements: ElementRecord[], doc: Doc, data: Record<string, unknown>): DiagnosticItem {
  return { n, summary, elements: elements.map((e) => doc.ref(e)), data };
}

function inFlowChildren(doc: Doc, el: ElementRecord): ElementRecord[] {
  return doc
    .children(el)
    .filter(
      (c) =>
        c.visible &&
        !isInlineDisplay(c.display) &&
        c.position !== 'absolute' &&
        c.position !== 'fixed' &&
        !c.overlay &&
        !c.visuallyHidden &&
        c.rect.w > 0 &&
        c.rect.h > 0,
    );
}

function signature(el: ElementRecord): string {
  if (el.componentType) return `type:${el.componentType}`;
  const cls = el.selector.split(' > ').pop() ?? el.tag;
  return cls.replace(/:nth-of-type\(\d+\)/, '');
}

// Median of each item's nearest edge-to-edge gap to a neighbour to its right or below.
function nearestGaps(items: ElementRecord[]): number[] {
  const gaps: number[] = [];
  for (const a of items) {
    let best = Infinity;
    for (const b of items) {
      if (a === b) continue;
      const vOverlap = Math.min(bottom(a.rect), bottom(b.rect)) - Math.max(a.rect.y, b.rect.y) > 0;
      const hOverlap = Math.min(right(a.rect), right(b.rect)) - Math.max(a.rect.x, b.rect.x) > 0;
      if (vOverlap && b.rect.x >= right(a.rect) - 1) best = Math.min(best, b.rect.x - right(a.rect));
      if (hOverlap && b.rect.y >= bottom(a.rect) - 1) best = Math.min(best, b.rect.y - bottom(a.rect));
    }
    if (Number.isFinite(best)) gaps.push(Math.max(0, best));
  }
  return gaps;
}

// Gaps between parts stacked vertically: for each part, the nearest part below it that overlaps
// it horizontally. Parts side by side in one row are aligned, not grouped, so they are ignored.
function nearestVerticalGaps(items: ElementRecord[]): number[] {
  const gaps: number[] = [];
  for (const a of items) {
    let best = Infinity;
    for (const b of items) {
      if (a === b) continue;
      const hOverlap = Math.min(right(a.rect), right(b.rect)) - Math.max(a.rect.x, b.rect.x) > 0;
      if (hOverlap && b.rect.y >= bottom(a.rect) - 1) best = Math.min(best, b.rect.y - bottom(a.rect));
    }
    if (Number.isFinite(best)) gaps.push(Math.max(0, best));
  }
  return gaps;
}

function rectGap(a: Rect, b: Rect): number | null {
  const vOverlap = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y) > 0;
  const hOverlap = Math.min(right(a), right(b)) - Math.max(a.x, b.x) > 0;
  if (hOverlap) return Math.max(a.y, b.y) - Math.min(bottom(a), bottom(b));
  if (vOverlap) return Math.max(a.x, b.x) - Math.min(right(a), right(b));
  return null;
}

function edgeGap(a: ElementRecord, b: ElementRecord): number | null {
  return rectGap(a.rect, b.rect);
}

function union(rects: Rect[]): Rect {
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => right(r)));
  const y2 = Math.max(...rects.map((r) => bottom(r)));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// ---------- Spatial Grouping and Separation ----------

interface Group {
  root: ElementRecord;
  items: ElementRecord[];
  basis: string;
  within: number;
}

function effectiveBg(doc: Doc, el: ElementRecord): string | null {
  for (const a of doc.ancestors(el)) if (a.bg) return a.bg;
  return 'rgb(255, 255, 255)';
}

export function spatialGrouping(doc: Doc, viewport: { width: number; height: number }): ObservationOutput {
  const groups: Group[] = [];
  for (const el of doc.els) {
    if (!el.visible || el.overlay || isInlineDisplay(el.display) || el.tag === 'body') continue;
    // A table is one group whose items are its rows; its internal parts are never groups.
    if (TABLE_PART_TAGS.has(el.tag)) continue;
    const kids =
      el.tag === 'table'
        ? doc.children(el).flatMap((part) => (part.tag === 'tr' ? [part] : doc.children(part).filter((r) => r.tag === 'tr'))).filter((r) => r.visible && r.rect.h > 0)
        : inFlowChildren(doc, el);
    if (kids.length < 2) continue;
    const semantic =
      ['fieldset', 'section', 'ul', 'ol', 'form', 'table'].includes(el.tag) || el.role === 'group' || el.role === 'radiogroup';
    let items: ElementRecord[] = [];
    let basis = '';
    if (semantic) {
      items = kids;
      basis = el.role === 'group' || el.role === 'radiogroup' ? `semantic role=${el.role}` : `semantic <${el.tag}>`;
    } else {
      const bySig = new Map<string, ElementRecord[]>();
      for (const k of kids) bySig.set(signature(k), [...(bySig.get(signature(k)) ?? []), k]);
      const best = [...bySig.entries()].sort((a, b) => b[1].length - a[1].length)[0];
      if (best && best[1].length >= 3) {
        items = best[1];
        basis = best[0].startsWith('type:') ? `component-type label "${best[0].slice(5)}"` : `repeated siblings "${best[0]}"`;
      }
    }
    if (items.length < 2) continue;
    const gaps = nearestGaps(items);
    if (!gaps.length) continue;
    groups.push({ root: el, items, basis, within: median(gaps) });
  }

  // Between-group gaps for sibling groups under the same parent.
  const byParent = new Map<number, Group[]>();
  for (const g of groups) {
    if (g.root.parent === null) continue;
    byParent.set(g.root.parent, [...(byParent.get(g.root.parent) ?? []), g]);
  }
  const relations: DiagnosticItem[] = [];
  for (const [parentId, gs] of byParent) {
    if (gs.length < 2) continue;
    const parent = doc.get(parentId)!;
    const ordered = [...gs].sort((a, b) => a.root.rect.y - b.root.rect.y || a.root.rect.x - b.root.rect.x);
    // Only adjacent groups (neighbouring siblings) are compared. Separation is measured between
    // the groups' visible content, not their boxes, so padding and dividers are counted.
    const siblingIndex = new Map(inFlowChildren(doc, parent).map((s, i) => [s.id, i]));
    const between: number[] = [];
    for (let i = 1; i < ordered.length; i++) {
      const ia = siblingIndex.get(ordered[i - 1].root.id);
      const ib = siblingIndex.get(ordered[i].root.id);
      if (ia === undefined || ib === undefined || Math.abs(ia - ib) !== 1) continue;
      const g = rectGap(union(ordered[i - 1].items.map((e) => e.rect)), union(ordered[i].items.map((e) => e.rect)));
      if (g !== null && g >= 0) between.push(g);
    }
    if (!between.length) continue;
    const withinMedian = median(ordered.map((g) => g.within));
    const betweenMedian = median(between);
    // Groups whose items touch (within-gap 0) have no meaningful ratio.
    const ratio = withinMedian > 0 ? betweenMedian / withinMedian : null;
    relations.push(
      item(
        0,
        `Under ${doc.describe(parent)}: ${ordered.length} groups (${ordered[0].basis}) use a ${r0(withinMedian)} px median internal gap and ${r0(betweenMedian)} px between groups${ratio !== null ? ` (${round1(ratio)}×)` : ''}`,
        [parent, ...ordered.map((g) => g.root)].slice(0, 6),
        doc,
        { withinMedianPx: round1(withinMedian), betweenMedianPx: round1(betweenMedian), ratio: ratio === null ? null : round2(ratio), groups: ordered.length, basis: ordered.map((g) => g.basis) },
      ),
    );
  }
  // The same proximity relation one level down: the items of a group (cards in a grid, rows of a
  // list) should sit further from each other than their own parts do. Separation is measured
  // between each item's content, so padding and dividers count. Inside an item only stacked parts
  // count (a title and a link at opposite ends of one row are aligned, not spaced apart); tables
  // are excluded, since rows are separated by rules rather than space.
  for (const g of groups) {
    if (g.root.tag === 'table') continue;
    const blocks = (el: ElementRecord) => doc.children(el).filter((c) => c.visible && !c.overlay && !isInlineDisplay(c.display) && c.rect.w > 0 && c.rect.h > 0);
    const parts = g.items.map((it) => {
      let kids = blocks(it);
      while (kids.length === 1) kids = blocks(kids[0]);
      return kids;
    });
    const inside = parts
      .map((p, i) => (TABLE_PART_TAGS.has(g.items[i].tag) || g.items[i].tag === 'table' ? [] : p))
      .filter((p) => p.length >= 2)
      .map((p) => nearestVerticalGaps(p))
      .filter((gs) => gs.length)
      .map(median);
    if (!inside.length) continue;
    const extents = g.items.map((it, i) => (parts[i].length ? union(parts[i].map((c) => c.rect)) : it.rect));
    const between: number[] = [];
    extents.forEach((a, i) => {
      let best = Infinity;
      extents.forEach((b, j) => {
        if (i === j) return;
        const gap = rectGap(a, b);
        if (gap !== null && gap >= 0) best = Math.min(best, gap);
      });
      if (Number.isFinite(best)) between.push(best);
    });
    if (!between.length) continue;
    const insideMedian = median(inside);
    const betweenMedian = median(between);
    const ratio = insideMedian > 0 ? betweenMedian / insideMedian : null;
    relations.push(
      item(
        0,
        `Items of ${doc.describe(g.root)} (${g.items.length}, ${g.basis}): ${r0(betweenMedian)} px between neighbouring items' content and ${insideMedian > 0 ? `a ${r0(insideMedian)} px median gap inside items (${round1(ratio!)}×)` : 'no gap between the parts inside items'}`,
        [g.root, ...g.items].slice(0, 6),
        doc,
        { level: 'items', withinMedianPx: round1(insideMedian), betweenMedianPx: round1(betweenMedian), ratio: ratio === null ? null : round2(ratio), groups: g.items.length, basis: [g.basis] },
      ),
    );
  }
  // Without a gap inside items there is no ratio; such relations are ordered by the separation itself.
  const sortKey = (it: DiagnosticItem) => (it.data.ratio as number | null) ?? (it.data.betweenMedianPx as number);
  relations.sort((a, b) => sortKey(a) - sortKey(b));

  // Clearance between neighbouring bounded elements: controls, and boxes such as cards whose
  // edge is drawn (a border on every side, or a fill that differs from what is behind them).
  const drawnEdge = (el: ElementRecord) => el.borderVisible || (el.bg !== null && el.bg !== effectiveBg(doc, el));
  const boxEdge = (el: ElementRecord) =>
    (el.borderVisible && el.border.every((w) => w > 0)) || (el.bg !== null && el.bg !== effectiveBg(doc, el));
  const controls = doc.els.filter(
    (el) =>
      el.visible &&
      !el.visuallyHidden &&
      !el.overlay &&
      el.rect.w > 0 &&
      ((el.interactive && drawnEdge(el)) ||
        (!isInlineDisplay(el.display) && !TABLE_PART_TAGS.has(el.tag) && el.tag !== 'table' && el.rect.w >= 24 && el.rect.h >= 24 && boxEdge(el))),
  );
  const clearances: { a: ElementRecord; b: ElementRecord; gap: number }[] = [];
  const nearest: number[] = [];
  for (const a of controls) {
    let best: { b: ElementRecord; gap: number } | null = null;
    for (const b of controls) {
      if (a === b || doc.related(a, b)) continue;
      if (intersect(a.rect, b.rect)) continue;
      const gap = edgeGap(a, b);
      if (gap === null || gap < 0 || gap > 48) continue;
      if (!best || gap < best.gap) best = { b, gap };
    }
    if (best) {
      nearest.push(best.gap);
      if (best.gap < 12 && a.id < best.b.id) clearances.push({ a, b: best.b, gap: best.gap });
    }
  }
  clearances.sort((p, q) => p.gap - q.gap);
  const clearanceItems = clearances.map((c) =>
    item(0, `${doc.describe(c.a)} and ${doc.describe(c.b)} are ${round1(c.gap)} px apart`, [c.a, c.b], doc, { gapPx: round1(c.gap) }),
  );

  // Inline inset of text and controls from the viewport edge at narrow viewports.
  const insetItems: DiagnosticItem[] = [];
  let insetSummary = '';
  if (viewport.width <= 480) {
    const vw = doc.snap.doc.clientWidth;
    // Content inside horizontal scrollers is clipped at the scroller edge by design; skip it.
    const inXScroller = (el: ElementRecord) => doc.clipChain(el).clippers.some((c) => c.overflowX === 'auto' || c.overflowX === 'scroll');
    const content = doc.els.filter(
      (el) =>
        el.visible &&
        !el.overlay &&
        !el.visuallyHidden &&
        !MEDIA_TAGS.has(el.tag) &&
        (el.interactive || el.ownText) &&
        el.rect.w > 0 &&
        right(el.rect) > 0 &&
        el.rect.x < vw &&
        doc.visibleRect(el) !== null &&
        !inXScroller(el),
    );
    const leftMin = content.reduce<ElementRecord | null>((m, el) => (!m || el.rect.x < m.rect.x ? el : m), null);
    const rightMin = content.reduce<ElementRecord | null>((m, el) => (!m || vw - right(el.rect) < vw - right(m.rect) ? el : m), null);
    if (leftMin && rightMin) {
      const l = leftMin.rect.x;
      const r = vw - right(rightMin.rect);
      insetSummary = ` At ${viewport.width} px, the smallest inline inset of text or controls is ${r0(l)} px on the left and ${r0(r)} px on the right.`;
      insetItems.push(item(0, `Smallest left inset: ${doc.describe(leftMin)} at ${r0(l)} px from the viewport edge`, [leftMin], doc, { side: 'left', insetPx: round1(l) }));
      insetItems.push(item(0, `Smallest right inset: ${doc.describe(rightMin)} at ${r0(r)} px from the viewport edge`, [rightMin], doc, { side: 'right', insetPx: round1(r) }));
    }
  }

  const items = [...relations.slice(0, 12), ...clearanceItems.slice(0, 10), ...insetItems].map((it, i) => ({ ...it, n: i + 1 }));
  const weakest = relations[0];
  const summary =
    `${groups.length} groups detected; ${relations.length} parents contain sibling groups.` +
    (weakest ? ` Weakest separation: ${weakest.summary}.` : '') +
    (nearest.length ? ` Neighbouring bounded elements (controls and bordered or filled boxes): median clearance ${r0(median(nearest))} px, minimum ${r0(Math.min(...nearest))} px; ${clearances.length} pairs below 12 px.` : '') +
    insetSummary;
  return {
    status: 'observed',
    evaluated: groups.length,
    summary,
    items,
    data: {
      groups: groups.map((g) => ({ root: g.root.selector, basis: g.basis, items: g.items.length, withinMedianPx: round1(g.within) })),
      relationsTotal: relations.length,
      clearancePairsBelow12: clearances.length,
    },
  };
}

// ---------- Alignment Outliers ----------

function cluster(items: ElementRecord[], coord: (e: ElementRecord) => number, tol: number): ElementRecord[][] {
  const sorted = [...items].sort((a, b) => coord(a) - coord(b));
  const out: ElementRecord[][] = [];
  for (const el of sorted) {
    const last = out[out.length - 1];
    if (last && coord(el) - coord(last[0]) <= tol) last.push(el);
    else out.push([el]);
  }
  return out;
}

export function alignmentOutliers(doc: Doc): ObservationOutput {
  const peerGroups: { basis: string; parent: ElementRecord | null; items: ElementRecord[] }[] = [];
  for (const el of doc.els) {
    if (!el.visible || el.overlay) continue;
    const kids = inFlowChildren(doc, el);
    if (kids.length < 3) continue;
    const bySig = new Map<string, ElementRecord[]>();
    for (const k of kids) bySig.set(signature(k), [...(bySig.get(signature(k)) ?? []), k]);
    for (const [sig, list] of bySig) if (list.length >= 3) peerGroups.push({ basis: `repeated siblings "${sig}"`, parent: el, items: list });
  }
  const byType = new Map<string, ElementRecord[]>();
  for (const el of doc.els) {
    if (el.componentType && el.visible && !el.overlay && el.rect.w > 0) byType.set(el.componentType, [...(byType.get(el.componentType) ?? []), el]);
  }
  for (const [t, list] of byType) {
    if (list.length < 3) continue;
    const parents = new Set(list.map((e) => e.parent));
    if (parents.size === 1) continue; // already covered as repeated siblings
    peerGroups.push({ basis: `component-type label "${t}"`, parent: null, items: list });
  }

  const outliers: DiagnosticItem[] = [];
  let comparedClusters = 0;
  let consistentClusters = 0;
  const coords: Record<string, (e: ElementRecord) => number> = {
    left: (e) => e.rect.x,
    right: (e) => right(e.rect),
    'horizontal-center': (e) => e.rect.x + e.rect.w / 2,
    top: (e) => e.rect.y,
    bottom: (e) => bottom(e.rect),
  };

  for (const g of peerGroups) {
    const medW = median(g.items.map((e) => e.rect.w));
    const medH = median(g.items.map((e) => e.rect.h));
    const columns = cluster(g.items, (e) => e.rect.x, Math.max(8, medW * 0.25));
    const rows = cluster(g.items, (e) => e.rect.y, Math.max(8, medH * 0.25));
    const plans: [ElementRecord[][], string[], string][] = [
      [columns, ['left', 'right', 'horizontal-center'], 'column'],
      [rows, ['top', 'bottom'], 'row'],
    ];
    for (const [clusters, names, kind] of plans) {
      for (const c of clusters) {
        if (c.length < 3) continue;
        comparedClusters++;
        // Alignment lines this cluster shares: coordinates where at least 2/3 of peers sit within
        // 2 px of the median. An element is an outlier only when it sits on none of them.
        const lines = names
          .map((name) => {
            const f = coords[name];
            const m = median(c.map(f));
            const consistent = c.filter((e) => Math.abs(f(e) - m) <= 2).length;
            return { name, f, m, consistent };
          })
          .filter((l) => l.consistent / c.length >= 2 / 3);
        if (!lines.length) continue;
        let clusterClean = true;
        const size = (e: ElementRecord) => (kind === 'column' ? e.rect.w : e.rect.h);
        const medSize = median(c.map(size));
        for (const e of c) {
          const devs = lines.map((l) => ({ name: l.name, dev: Math.abs(l.f(e) - l.m), consistent: l.consistent }));
          // Peers of similar size should sit on every shared line; peers of clearly different
          // size (e.g. a half-width field) need share only one.
          const similarSize = medSize > 0 && Math.abs(size(e) - medSize) / medSize <= 0.1;
          const decisive = similarSize
            ? devs.reduce((a, b) => (b.dev > a.dev ? b : a))
            : devs.reduce((a, b) => (b.dev < a.dev ? b : a));
          if (decisive.dev <= 4) continue;
          clusterClean = false;
          outliers.push(
            item(
              0,
              `${decisive.consistent} of ${c.length} peers in a ${kind} (${g.basis}) share ${decisive.name} edges within 2 px; ${doc.describe(e)} is offset by ${round1(decisive.dev)} px`,
              [e, ...c.filter((x) => x !== e).slice(0, 3)],
              doc,
              {
                coordinate: decisive.name,
                deviationPx: round1(decisive.dev),
                deviations: Object.fromEntries(devs.map((d) => [d.name, round1(d.dev)])),
                similarSize,
                clusterSize: c.length,
                consistentPeers: decisive.consistent,
                basis: g.basis,
                clusterKind: kind,
              },
            ),
          );
        }
        if (clusterClean) consistentClusters++;
      }
    }
  }
  outliers.sort((a, b) => (b.data.deviationPx as number) - (a.data.deviationPx as number));
  const items = outliers.map((it, i) => ({ ...it, n: i + 1 }));
  return {
    status: 'observed',
    evaluated: peerGroups.length,
    summary: items.length
      ? `${items.length} alignment outlier${items.length > 1 ? 's' : ''} across ${peerGroups.length} peer groups (${comparedClusters} row/column comparisons). Largest: ${items[0].summary}.`
      : `${peerGroups.length} peer groups; every peer in all ${comparedClusters} compared rows/columns sits within 4 px of a shared edge or center.`,
    items,
    data: { peerGroups: peerGroups.length, comparedClusters, consistentClusters },
  };
}

// ---------- Runtime Layout Stability ----------

export function layoutStability(shifts: ShiftEntry[] | undefined): ObservationOutput & { elementsless: true } {
  const entries = (shifts ?? []).filter((s) => !s.hadRecentInput);
  const cls = entries.reduce((s, e) => s + e.value, 0);
  const largest = entries.reduce((m, e) => Math.max(m, e.value), 0);
  const sources = new Map<string, { selector: string; tag: string | null; name: string | null; componentId: string | null; previousRect: unknown; currentRect: unknown; value: number }>();
  for (const e of entries) {
    for (const s of e.sources) {
      const k = s.selector ?? '(unattributed)';
      const prev = sources.get(k);
      if (!prev || e.value > prev.value)
        sources.set(k, { selector: k, tag: s.tag, name: s.name, componentId: s.componentId, previousRect: s.previousRect, currentRect: s.currentRect, value: e.value });
    }
  }
  const items: DiagnosticItem[] = [...sources.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((s, i) => ({
      n: i + 1,
      summary: `${s.selector}${s.name ? ` "${s.name.slice(0, 40)}"` : ''} moved (shift value ${round2(s.value)})`,
      elements: [],
      data: s,
    }));
  return {
    status: 'observed',
    evaluated: entries.length,
    elementsless: true,
    summary: entries.length
      ? `Initial render produced ${entries.length} unexpected layout shift${entries.length > 1 ? 's' : ''} with a cumulative score of ${round2(cls)}; the largest was ${round2(largest)}${items.length ? `, affecting ${items.map((i) => (i.data as { selector: string }).selector).slice(0, 3).join(', ')}` : ''}.`
      : 'No unexpected layout shifts were recorded before the render settled.',
    items,
    data: { cumulativeScore: round2(cls), largestShift: round2(largest), shiftCount: entries.length },
  };
}

// ---------- Responsive Component Adaptation (across sweep widths) ----------

interface Sample {
  width: number;
  el: ElementRecord;
  parent: ElementRecord | undefined;
}

function isTracked(doc: Doc, el: ElementRecord, vpArea: number, annotated: boolean): boolean {
  if (!el.visible || el.overlay || el.rect.w <= 0 || el.rect.h <= 0) return false;
  if (annotated) return el.componentId !== null;
  if (SEMANTIC_TAGS.has(el.tag) || (el.role !== null && LANDMARK_ROLES.has(el.role))) return true;
  if (MEDIA_TAGS.has(el.tag)) return area(el.rect) >= 400;
  const parent = doc.parent(el);
  if (parent && (parent.display.includes('grid') || parent.display.includes('flex')) && !isInlineDisplay(el.display)) {
    return area(el.rect) >= vpArea * 0.02;
  }
  return false;
}

function structure(p: ElementRecord | undefined): string {
  if (!p) return 'none';
  if (p.gridColumns) return `grid ${p.gridColumns} col`;
  if (p.flexDirection) return `flex ${p.flexDirection}${p.flexWrap === 'wrap' ? ' wrap' : ''}`;
  return p.display;
}

export function responsiveAdaptation(snaps: { width: number; snap: Snapshot }[]): ObservationOutput & { transitions: { width: number; reason: string }[] } {
  const docs = snaps.map((s) => ({ width: s.width, doc: new Doc(s.snap), vpArea: s.snap.viewport.width * s.snap.viewport.height }));
  const annotated = docs.some((d) => d.doc.els.some((e) => e.componentId !== null));
  const series = new Map<string, Sample[]>();
  for (const { width, doc, vpArea } of docs) {
    for (const el of doc.els) {
      if (!isTracked(doc, el, vpArea, annotated)) continue;
      const key = annotated ? `c:${el.componentId}` : `e:${el.id}`;
      series.set(key, [...(series.get(key) ?? []), { width, el, parent: doc.parent(el) }]);
    }
  }

  const transitions: { width: number; reason: string }[] = [];
  const structuralItems: DiagnosticItem[] = [];
  const seenParentChange = new Set<string>();
  const sizeItems: DiagnosticItem[] = [];
  const widths = docs.map((d) => d.width);

  for (const [key, samples] of series) {
    // Parent structure changes between adjacent widths.
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const sa = structure(a.parent);
      const sb = structure(b.parent);
      if (sa !== sb && a.parent && b.parent) {
        const k = `${b.parent.id}:${b.width}`;
        if (!seenParentChange.has(k)) {
          seenParentChange.add(k);
          transitions.push({ width: b.width, reason: `${b.parent.selector}: ${sa} → ${sb}` });
          structuralItems.push({
            n: 0,
            summary: `Between ${a.width} and ${b.width} px, ${b.parent.selector} changes from ${sa} to ${sb}`,
            elements: [],
            data: { fromWidth: a.width, toWidth: b.width, parent: b.parent.selector, from: sa, to: sb },
          });
        }
      }
    }
    // Presence changes.
    const present = new Set(samples.map((s) => s.width));
    for (let i = 1; i < widths.length; i++) {
      const was = present.has(widths[i - 1]);
      const is = present.has(widths[i]);
      if (was !== is && samples.length >= 1) {
        const label = samples[0].el.componentId ?? samples[0].el.selector;
        transitions.push({ width: widths[i], reason: `${label} ${is ? 'appears' : 'disappears'}` });
      }
    }
    // Size and aspect change from widest to narrowest presence.
    if (samples.length >= 2) {
      const narrow = samples[0];
      const wide = samples[samples.length - 1];
      const aw = area(wide.el.rect);
      const an = area(narrow.el.rect);
      if (aw <= 0) continue;
      const areaChange = (an - aw) / aw;
      const aspW = wide.el.rect.w / wide.el.rect.h;
      const aspN = narrow.el.rect.w / narrow.el.rect.h;
      const label = narrow.el.componentId ? `[${narrow.el.componentId}]` : narrow.el.selector;
      sizeItems.push({
        n: 0,
        summary: `${label} changes from ${r0(wide.el.rect.w)}×${r0(wide.el.rect.h)} px at ${wide.width} px to ${r0(narrow.el.rect.w)}×${r0(narrow.el.rect.h)} px at ${narrow.width} px (area ${areaChange >= 0 ? '+' : ''}${r0(areaChange * 100)}%, aspect ratio ${round2(aspW)} → ${round2(aspN)}); parent ${structure(wide.parent)} → ${structure(narrow.parent)}`,
        elements: [],
        data: {
          key,
          componentId: narrow.el.componentId,
          selector: narrow.el.selector,
          areaChange: round2(areaChange),
          aspectFrom: round2(aspW),
          aspectTo: round2(aspN),
          relWidthNarrow: narrow.parent ? round2(narrow.el.rect.w / Math.max(1, narrow.parent.rect.w)) : null,
          samples: samples.map((s) => ({
            width: s.width,
            x: r0(s.el.rect.x),
            y: r0(s.el.rect.y),
            w: r0(s.el.rect.w),
            h: r0(s.el.rect.h),
            aspect: round2(s.el.rect.w / Math.max(1, s.el.rect.h)),
            relW: s.parent ? round2(s.el.rect.w / Math.max(1, s.parent.rect.w)) : null,
            relH: s.parent ? round2(s.el.rect.h / Math.max(1, s.parent.rect.h)) : null,
            order: s.el.order,
            parent: structure(s.parent),
          })),
        },
      });
    }
  }

  // Peer comparisons require explicit component-type labels. Deviations are aggregated per
  // component across widths (largest deviation and the widths where it exceeds 25%).
  let peerAvailable = false;
  const peerAgg = new Map<string, { label: string; type: string; maxDev: number; dw: number; dh: number; da: number; at: number; widths: number[] }>();
  for (const { width, doc } of docs) {
    const byType = new Map<string, ElementRecord[]>();
    for (const el of doc.els) if (el.componentType && el.visible && el.rect.w > 0) byType.set(el.componentType, [...(byType.get(el.componentType) ?? []), el]);
    for (const [t, list] of byType) {
      if (list.length < 2) continue;
      peerAvailable = true;
      const mw = median(list.map((e) => e.rect.w));
      const mh = median(list.map((e) => e.rect.h));
      const ma = median(list.map((e) => e.rect.w / Math.max(1, e.rect.h)));
      for (const el of list) {
        const dw = (el.rect.w - mw) / mw;
        const dh = (el.rect.h - mh) / mh;
        const da = (el.rect.w / Math.max(1, el.rect.h) - ma) / ma;
        const dev = Math.max(Math.abs(dw), Math.abs(dh), Math.abs(da));
        if (dev <= 0.25) continue;
        const key = annotated ? `c:${el.componentId ?? el.selector}` : `e:${el.id}`;
        const prev = peerAgg.get(key) ?? { label: el.componentId ? `[${el.componentId}]` : el.selector, type: t, maxDev: 0, dw: 0, dh: 0, da: 0, at: width, widths: [] };
        prev.widths.push(width);
        if (dev > prev.maxDev) Object.assign(prev, { maxDev: dev, dw, dh, da, at: width });
        peerAgg.set(key, prev);
      }
    }
  }
  const peerItems: DiagnosticItem[] = [...peerAgg.values()]
    .sort((a, b) => b.maxDev - a.maxDev)
    .map((p) => ({
      n: 0,
      summary: `${p.label} (${p.type}) deviates from its peer median by up to ${r0(p.dw * 100)}% in width, ${r0(p.dh * 100)}% in height and ${r0(p.da * 100)}% in aspect ratio (at ${p.at} px; above 25% at ${p.widths.length} of ${docs.length} widths)`,
      elements: [],
      data: { componentType: p.type, widthDeviation: round2(p.dw), heightDeviation: round2(p.dh), aspectDeviation: round2(p.da), atWidth: p.at, widthsAbove25: p.widths.length },
    }));

  sizeItems.sort((a, b) => Math.abs(b.data.areaChange as number) - Math.abs(a.data.areaChange as number));
  const items = [...structuralItems.slice(0, 15), ...sizeItems.slice(0, 10), ...peerItems.slice(0, 10)].map((it, i) => ({ ...it, n: i + 1 }));
  return {
    status: 'observed',
    evaluated: series.size,
    summary:
      `${series.size} components tracked across ${docs.length} widths (${annotated ? 'matched by data-component-id' : 'matched by harness identity during an in-place resize'}). ` +
      `${structuralItems.length} layout-structure transitions.` +
      (sizeItems[0] ? ` Largest size change: ${sizeItems[0].summary}.` : '') +
      (peerAvailable ? ` ${peerItems.length} labelled components deviate more than 25% from their peer median at some width.` : ' Peer comparison unavailable: no data-component-type labels.'),
    items,
    data: { annotated, peerComparison: peerAvailable ? 'available' : 'unavailable', structuralTransitions: structuralItems.length, fullSeries: sizeItems.map((s) => s.data) },
    transitions,
  };
}
