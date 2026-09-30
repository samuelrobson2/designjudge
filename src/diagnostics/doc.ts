import type { ElementRecord, ElementRef, Rect, Snapshot } from '../types.ts';

export const SEMANTIC_TAGS = new Set(['header', 'nav', 'main', 'aside', 'footer', 'section', 'article', 'form', 'fieldset', 'table', 'figure']);
export const LANDMARK_ROLES = new Set(['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'region', 'search', 'form']);
export const MEDIA_TAGS = new Set(['img', 'picture', 'video', 'canvas', 'svg']);
export const FORM_CONTROL_TAGS = new Set(['input', 'textarea', 'select']);
export const TABLE_PART_TAGS = new Set(['thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col']);

export function right(r: Rect): number {
  return r.x + r.w;
}
export function bottom(r: Rect): number {
  return r.y + r.h;
}
export function area(r: Rect): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(right(a), right(b));
  const y2 = Math.min(bottom(a), bottom(b));
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function clipsAxis(value: string): boolean {
  return value !== 'visible';
}

export function isScrollable(value: string): boolean {
  return value === 'auto' || value === 'scroll';
}

export function isInlineDisplay(display: string): boolean {
  return display === 'inline' || display === 'contents' || display === 'none';
}

export class Doc {
  readonly snap: Snapshot;
  readonly els: ElementRecord[];
  private byId = new Map<number, ElementRecord>();
  private kids = new Map<number, ElementRecord[]>();
  private hasTextCache = new Map<number, boolean>();
  private hasControlCache = new Map<number, boolean>();

  constructor(snap: Snapshot) {
    this.snap = snap;
    this.els = snap.elements;
    for (const el of snap.elements) {
      this.byId.set(el.id, el);
      if (el.parent !== null) {
        const list = this.kids.get(el.parent) ?? [];
        list.push(el);
        this.kids.set(el.parent, list);
      }
    }
  }

  get(id: number | null | undefined): ElementRecord | undefined {
    return id === null || id === undefined ? undefined : this.byId.get(id);
  }

  parent(el: ElementRecord): ElementRecord | undefined {
    return this.get(el.parent);
  }

  children(el: ElementRecord): ElementRecord[] {
    return this.kids.get(el.id) ?? [];
  }

  *ancestors(el: ElementRecord): Generator<ElementRecord> {
    let cur = this.parent(el);
    while (cur) {
      yield cur;
      cur = this.parent(cur);
    }
  }

  isAncestor(a: ElementRecord, b: ElementRecord): boolean {
    for (const anc of this.ancestors(b)) if (anc.id === a.id) return true;
    return false;
  }

  related(a: ElementRecord, b: ElementRecord): boolean {
    return a.id === b.id || this.isAncestor(a, b) || this.isAncestor(b, a);
  }

  hasText(el: ElementRecord): boolean {
    const cached = this.hasTextCache.get(el.id);
    if (cached !== undefined) return cached;
    const v = el.ownText || this.children(el).some((c) => this.hasText(c));
    this.hasTextCache.set(el.id, v);
    return v;
  }

  hasControl(el: ElementRecord): boolean {
    const cached = this.hasControlCache.get(el.id);
    if (cached !== undefined) return cached;
    const v = this.children(el).some((c) => c.interactive || this.hasControl(c));
    this.hasControlCache.set(el.id, v);
    return v;
  }

  visuallyHiddenChain(el: ElementRecord): boolean {
    if (el.visuallyHidden) return true;
    for (const a of this.ancestors(el)) if (a.visuallyHidden) return true;
    return false;
  }

  // Nearest ancestor that establishes a containing block for an absolutely positioned element.
  containingBlock(el: ElementRecord): ElementRecord | undefined {
    for (const a of this.ancestors(el)) if (a.position !== 'static' || a.transform) return a;
    return undefined;
  }

  // Ancestors whose overflow can clip this element, honouring how absolute and fixed positioning
  // escape the overflow of non-containing-block ancestors.
  clipChain(el: ElementRecord): { clippers: ElementRecord[]; inFixed: boolean } {
    const clippers: ElementRecord[] = [];
    let mode: 'flow' | 'absolute' | 'fixed' = el.position === 'fixed' ? 'fixed' : el.position === 'absolute' ? 'absolute' : 'flow';
    for (const a of this.ancestors(el)) {
      if (mode === 'fixed') {
        if (!a.transform) continue;
        mode = 'flow';
      } else if (mode === 'absolute') {
        if (a.position === 'static' && !a.transform) continue;
        mode = 'flow';
      }
      if (clipsAxis(a.overflowX) || clipsAxis(a.overflowY)) clippers.push(a);
      if (a.position === 'fixed') mode = 'fixed';
      else if (a.position === 'absolute') mode = 'absolute';
    }
    return { clippers, inFixed: mode === 'fixed' };
  }

  clientBox(a: ElementRecord): Rect {
    return { x: a.rect.x + a.border[3], y: a.rect.y + a.border[0], w: a.scroll.cw, h: a.scroll.ch };
  }

  // Bounding box clipped by every ancestor that clips overflow on the relevant axis.
  visibleRect(el: ElementRecord): Rect | null {
    let r: Rect = { ...el.rect };
    for (const a of this.clipChain(el).clippers) {
      const box = this.clientBox(a);
      if (clipsAxis(a.overflowX)) {
        const x1 = Math.max(r.x, box.x);
        const x2 = Math.min(right(r), right(box));
        if (x2 <= x1) return null;
        r = { ...r, x: x1, w: x2 - x1 };
      }
      if (clipsAxis(a.overflowY)) {
        const y1 = Math.max(r.y, box.y);
        const y2 = Math.min(bottom(r), bottom(box));
        if (y2 <= y1) return null;
        r = { ...r, y: y1, h: y2 - y1 };
      }
    }
    return r;
  }

  // Absolutely positioned small element overlapping its own host (e.g. a notification badge).
  isHostBadge(el: ElementRecord): boolean {
    if (el.position !== 'absolute') return false;
    if (el.rect.w > 48 || el.rect.h > 48) return false;
    const host = this.containingBlock(el);
    if (!host) return false;
    const parent = this.parent(el);
    if (!parent || (parent.id !== host.id && this.parent(parent)?.id !== host.id)) return false;
    return intersect(el.rect, host.rect) !== null && (el.ownText || this.hasText(el) || el.bg !== null);
  }

  // Media, and boxes whose only content is media: things placed over them are deliberate overlays.
  isDecorative(el: ElementRecord): boolean {
    if (MEDIA_TAGS.has(el.tag) || el.ariaHidden) return true;
    return (el.bgImage || this.hasMedia(el)) && !this.hasText(el) && !this.hasControl(el);
  }

  hasMedia(el: ElementRecord): boolean {
    return this.children(el).some((c) => (MEDIA_TAGS.has(c.tag) && !c.svgOnlyDefs) || this.hasMedia(c));
  }

  ref(el: ElementRecord): ElementRef {
    const fixed = el.position === 'fixed' || this.clipChain(el).inFixed;
    return { id: el.id, selector: el.selector, tag: el.tag, name: el.name, componentId: el.componentId, rect: el.rect, ...(fixed ? { fixed: true } : {}) };
  }

  describe(el: ElementRecord): string {
    const label = el.name ?? el.text;
    const base = el.componentId ? `${el.selector} [${el.componentId}]` : el.selector;
    return label ? `${base} "${truncate(label, 48)}"` : base;
  }
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function fmtRect(r: Rect): string {
  return `${Math.round(r.w)}×${Math.round(r.h)} px at (${Math.round(r.x)}, ${Math.round(r.y)})`;
}

// Drops elements whose ancestor is also in the set (keeps the outermost).
export function outermost(doc: Doc, list: ElementRecord[]): ElementRecord[] {
  const ids = new Set(list.map((e) => e.id));
  return list.filter((e) => {
    for (const a of doc.ancestors(e)) if (ids.has(a.id)) return false;
    return true;
  });
}
