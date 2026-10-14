// Page side of the shared wait (settle.ts). Runs before any page script, after Playwright's clock,
// which is paused: the page's timers, animation frames and Date only move when the collector
// advances them, so what a page shows after a wait depends on how much page time it was given,
// not on how fast the machine is. Bundled to an IIFE by esbuild; also injected on demand into
// pages opened without it (tests).

interface Timer {
  callAt: number;
}

interface ClockController {
  runFor(ms: number): Promise<void>;
  _firstTimer?: (beforeTick?: number) => Timer | null;
  _now?: { ticks: number };
}

interface Builtins {
  setTimeout: (fn: () => void, ms?: number) => number;
  requestAnimationFrame: (fn: () => void) => number;
}

declare global {
  interface Window {
    __pwClock?: { controller: ClockController; builtins: Builtins };
    __djQuiet: () => Promise<{ quiet: boolean; mutations: number; inflight: number; fonts: boolean }>;
    __djAdvance: (ms: number) => Promise<{ clock: boolean; advanced: number; blocked: boolean }>;
    __djHitCheck: (selector: string) => string | null;
  }
}

(() => {
  if ((window as { __djQuiet?: unknown }).__djQuiet) return;

  // Real timers: the page's own are paused with its clock.
  const real = (): Builtins => window.__pwClock?.builtins ?? (window as unknown as Builtins);
  const frames = (n: number) =>
    new Promise<void>((resolve) => {
      const step = () => (--n <= 0 ? resolve() : real().requestAnimationFrame(step));
      real().requestAnimationFrame(step);
    });
  const flushTask = () =>
    new Promise<void>((resolve) => {
      const c = new MessageChannel();
      c.port1.onmessage = () => resolve();
      c.port2.postMessage(0);
    });
  // One rendered frame, its observers, and the tasks they queued.
  const settleFrame = async () => {
    await frames(2);
    await flushTask();
  };

  let mutations = 0;
  new MutationObserver((list) => {
    mutations += list.length;
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });

  // Requests the page's scripts are waiting for; page time does not move while there are any, so a
  // slow response arrives at the same page time on every run.
  let inflight = 0;
  const track = <T>(p: Promise<T>): Promise<T> => {
    inflight++;
    return p.finally(() => {
      inflight--;
    });
  };
  if (typeof window.fetch === 'function') {
    const fetch0 = window.fetch;
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      return track(fetch0.apply(this, args));
    } as typeof fetch;
  }
  if (typeof Response !== 'undefined') {
    for (const m of ['text', 'json', 'blob', 'arrayBuffer', 'formData', 'bytes'] as const) {
      const proto = Response.prototype as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      const orig = proto[m];
      if (typeof orig === 'function')
        proto[m] = function (this: unknown, ...a: unknown[]) {
          return track(orig.apply(this, a));
        };
    }
  }
  if (typeof XMLHttpRequest !== 'undefined') {
    const send0 = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...a: Parameters<XMLHttpRequest['send']>) {
      inflight++;
      this.addEventListener('loadend', () => inflight--, { once: true });
      return send0.apply(this, a);
    };
  }

  // Smooth scrolling runs on real time; every scroll is instant instead.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('html, *, *::before, *::after { scroll-behavior: auto !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    // Constructable stylesheets are always there in Chromium.
  }
  const instant = (a: unknown) =>
    a && typeof a === 'object' && (a as ScrollToOptions).behavior === 'smooth' ? { ...(a as ScrollToOptions), behavior: 'instant' as ScrollBehavior } : a;
  const unsmooth = (obj: Record<string, unknown>, key: string) => {
    const orig = obj[key] as ((...a: unknown[]) => unknown) | undefined;
    if (typeof orig !== 'function') return;
    obj[key] = function (this: unknown, ...a: unknown[]) {
      return orig.apply(this, a.length === 1 ? [instant(a[0])] : a);
    };
  };
  for (const key of ['scroll', 'scrollTo', 'scrollBy']) {
    unsmooth(window as unknown as Record<string, unknown>, key);
    unsmooth(Element.prototype as unknown as Record<string, unknown>, key);
  }
  unsmooth(Element.prototype as unknown as Record<string, unknown>, 'scrollIntoView');

  // CSS animations and transitions run on real time: finite ones are finished, and those that never
  // end are held at their start, so every measurement and screenshot sees the same frame.
  const settleAnimations = () => {
    for (const a of document.getAnimations()) {
      try {
        const t = a.effect?.getComputedTiming();
        if (!t) continue;
        if (Number.isFinite(Number(t.endTime))) {
          if (a.playState !== 'finished') a.finish();
        } else if (a.playState === 'running' || a.currentTime !== 0) {
          a.pause();
          a.currentTime = 0;
        }
      } catch {
        // A scroll-driven animation has no end to finish at.
      }
    }
  };

  const signature = () => {
    const els = document.body ? document.body.getElementsByTagName('*') : ([] as unknown as HTMLCollection);
    const n = Math.min(els.length, 4000);
    let h = 0;
    for (let i = 0; i < n; i++) {
      const r = els[i].getBoundingClientRect();
      h = (Math.imul(h, 31) + ((r.x | 0) * 7 + (r.y | 0) * 13 + (r.width | 0) * 17 + (r.height | 0))) | 0;
    }
    return `${els.length}:${h}:${document.documentElement.scrollHeight}:${document.documentElement.scrollWidth}:${scrollX}:${scrollY}`;
  };
  // Lazy images off screen are not loading, so they are not waited for.
  const imageDone = (im: HTMLImageElement) => {
    if (im.complete) return true;
    if (im.loading !== 'lazy') return false;
    const r = im.getBoundingClientRect();
    return r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth;
  };

  // Quiet: nothing changed over a rendered frame, fonts and images are in, and no request the
  // page's scripts wait for is open.
  window.__djQuiet = async () => {
    settleAnimations();
    const m0 = mutations;
    const s0 = signature();
    await settleFrame();
    settleAnimations();
    const fonts = document.fonts.status === 'loaded';
    const quiet = mutations === m0 && signature() === s0 && fonts && [...document.images].every(imageDone) && inflight === 0;
    return { quiet, mutations: mutations - m0, inflight, fonts };
  };

  // Moves page time forward by `ms`, one due timer at a time, rendering a frame after timers that
  // changed the page (at most every YIELD_MS of page time). Stops early while a request is open.
  const YIELD_MS = 100;
  window.__djAdvance = async (ms: number) => {
    const c = window.__pwClock?.controller;
    if (!c) return { clock: false, advanced: 0, blocked: false };
    const exact = typeof c._firstTimer === 'function' && typeof c._now?.ticks === 'number';
    if (inflight > 0) return { clock: true, advanced: 0, blocked: true };
    // The page as it is now is painted before any timer changes it: layout shifts are measured
    // between painted frames, and a fast machine may not have painted since load.
    await settleFrame();
    let done = 0;
    let sinceYield = 0;
    let m = mutations;
    while (done < ms) {
      if (inflight > 0) return { clock: true, advanced: done, blocked: true };
      let step = Math.min(YIELD_MS, ms - done);
      if (exact) {
        const now = c._now!.ticks;
        const next = c._firstTimer!(now + (ms - done));
        step = next ? Math.min(ms - done, Math.max(1, next.callAt - now)) : ms - done;
      }
      await c.runFor(step);
      done += step;
      sinceYield += step;
      if (mutations !== m && (sinceYield >= YIELD_MS || done >= ms)) {
        await settleFrame();
        settleAnimations();
        m = mutations;
        sinceYield = 0;
      }
    }
    return { clock: true, advanced: done, blocked: false };
  };

  // ----- Whether a pointer click can land (as Playwright decides it), without waiting -----
  const BOOLEAN_ATTRS = new Set(['checked', 'selected', 'disabled', 'readonly', 'multiple', 'hidden', 'open', 'required', 'autofocus']);
  const VOID_TAGS = new Set(['AREA', 'BASE', 'BR', 'COL', 'COMMAND', 'EMBED', 'HR', 'IMG', 'INPUT', 'KEYGEN', 'LINK', 'MENUITEM', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);
  const trim = (s: string, cap: number) => (s.length <= cap ? s : s.substring(0, cap - 1) + '\u2026');
  const oneLine = (s: string) => s.replace(/\n/g, '\u21B5').replace(/\t/g, '\u21C6');
  const preview = (el: Element) => {
    const attrs: string[] = [];
    for (const { name, value } of [...el.attributes]) {
      if (name === 'style') continue;
      attrs.push(!value && BOOLEAN_ATTRS.has(name) ? ` ${name}` : ` ${name}="${value}"`);
    }
    attrs.sort((a, b) => a.length - b.length);
    const attrText = trim(attrs.join(''), 500);
    const tag = el.nodeName.toLowerCase();
    if (VOID_TAGS.has(el.nodeName)) return oneLine(`<${tag}${attrText}/>`);
    const kids = el.childNodes;
    const onlyText = kids.length <= 5 && [...kids].every((k) => k.nodeType === Node.TEXT_NODE);
    const text = onlyText ? el.textContent || '' : kids.length ? '\u2026' : '';
    return oneLine(`<${tag}${attrText}>${trim(text, 50)}</${tag}>`);
  };
  const parentOf = (el: Element): Element | null => el.assignedSlot ?? el.parentElement ?? ((el.parentNode as ShadowRoot | null)?.host || null);
  const hitAt = (x: number, y: number, target: Element): string | null => {
    const root = target.getRootNode() as Document | ShadowRoot;
    let hit: Element | null = root.elementsFromPoint(x, y)[0] ?? null;
    const parents: Element[] = [];
    while (hit && hit !== target) {
      parents.push(hit);
      hit = parentOf(hit);
    }
    if (hit === target) return null;
    let desc = preview(parents[0] ?? document.documentElement);
    for (let el: Element | null = target; el; el = parentOf(el)) {
      const i = parents.indexOf(el);
      if (i !== -1) {
        if (i > 1) desc += ` from ${preview(parents[i - 1])} subtree`;
        break;
      }
    }
    return `${desc} intercepts pointer events`;
  };
  const pointIn = (el: Element) => {
    const r = [...el.getClientRects()]
      .map((q) => {
        const left = Math.max(q.left, 0), top = Math.max(q.top, 0), right = Math.min(q.right, innerWidth), bottom = Math.min(q.bottom, innerHeight);
        return { left, top, right, bottom, area: Math.max(0, right - left) * Math.max(0, bottom - top) };
      })
      .find((q) => q.area > 0.99);
    return r ? { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 } : null;
  };
  const ALIGNMENTS: (ScrollIntoViewOptions | null)[] = [null, { block: 'end', inline: 'end' }, { block: 'center', inline: 'center' }, { block: 'start', inline: 'start' }];
  window.__djHitCheck = (selector: string) => {
    let el: Element | null = null;
    try {
      el = document.querySelector(selector);
    } catch {
      return 'element is not attached';
    }
    if (!el) return 'element is not attached';
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0) || getComputedStyle(el).visibility !== 'visible') return 'element is not visible';
    const target = !el.matches('input, textarea, select') && !(el as HTMLElement).isContentEditable ? el.closest('button, [role=button], a, [role=link]') ?? el : el;
    let first: string | null = null;
    for (const align of ALIGNMENTS) {
      if (align) el.scrollIntoView({ ...align, behavior: 'instant' as ScrollBehavior });
      else (el as HTMLElement & { scrollIntoViewIfNeeded?: (center?: boolean) => void }).scrollIntoViewIfNeeded?.(true);
      const p = pointIn(el);
      const reason = p ? hitAt(p.x, p.y, target) : 'element is outside of the viewport';
      if (!reason) return null;
      first ??= reason;
    }
    return first;
  };
})();

export {};
