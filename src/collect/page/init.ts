// Runs before any page script (via addInitScript). Bundled to an IIFE by esbuild.

declare global {
  interface Window {
    __DJ_FIXTURE__?: string;
    __djId: (el: Element) => number;
    __djShifts: unknown[];
    __djDescribe: (el: Element) => Record<string, unknown>;
  }
}

(() => {
  let seed = 0x2f6b3a1d;
  Math.random = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const ids = new WeakMap<Element, number>();
  let next = 1;
  window.__djId = (el: Element) => {
    let v = ids.get(el);
    if (v === undefined) {
      v = next++;
      ids.set(el, v);
    }
    return v;
  };

  const shortSelector = (el: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = el;
    for (let i = 0; cur && i < 4; i++) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift(`${part}#${cur.id}`);
        break;
      }
      const cls = [...cur.classList].slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      parts.unshift(part);
      cur = cur.parentElement;
      if (cur && cur.tagName === 'BODY') break;
    }
    return parts.join(' > ');
  };

  window.__djDescribe = (el: Element) => ({
    selector: shortSelector(el),
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    name: (el.getAttribute('aria-label') || (el.textContent || '').trim()).slice(0, 80) || null,
    componentId: el.getAttribute('data-component-id'),
  });

  const rectOf = (r: DOMRectReadOnly | undefined | null) =>
    r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;

  window.__djShifts = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
        window.__djShifts.push({
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          startTime: entry.startTime,
          sources: (entry.sources || []).map((s: any) => ({
            ...(s.node && s.node.nodeType === 1
              ? window.__djDescribe(s.node as Element)
              : { selector: null, tag: null, role: null, name: null, componentId: null }),
            previousRect: rectOf(s.previousRect),
            currentRect: rectOf(s.currentRect),
          })),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    // layout-shift is Chromium-only; absence is recorded by the collector.
  }
})();

export {};
