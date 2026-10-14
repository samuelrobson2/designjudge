// Visual System capture in the page: the rendered style of the elements that make up the visual
// system, and the colour behind each piece of text, form-field boundary and icon-only control,
// found by hit-testing what paints at that point. Bundled to an IIFE by esbuild and exposed as
// window.__djVisual(). Contrast ratios are computed later in Node.

import type { ContrastRecord, Rgba, StyleRecord } from '../probeTypes.ts';

declare global {
  interface Window {
    __djVisual: () => { styles: StyleRecord[]; contrast: ContrastRecord[] };
    __djAnimations: () => { id: number | null; selector: string; name: string; durationMs: number; infinite: boolean }[];
  }
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'BR', 'WBR', 'TITLE', 'OPTION', 'OPTGROUP']);
const MEDIA = new Set(['IMG', 'PICTURE', 'VIDEO', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED']);
const FIELD_INPUTS = new Set(['', 'text', 'search', 'email', 'tel', 'url', 'number', 'password', 'date', 'datetime-local', 'month', 'time', 'week']);
const CONTROL = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=menuitem], [role=option]';
// Icon glyphs drawn as text: arrows, dingbats, geometric shapes, symbols and emoji (a dash or
// bullet standing for an empty value is punctuation, not an icon).
const GLYPH = /^[\u2190-\u21ff\u2300-\u23ff\u2500-\u27bf\u2900-\u297f\u2b00-\u2bff\u{1f300}-\u{1faff}\ufe0f⋯⋮]+$/u;
// A brand mark is a logo, not one of the interface's icons.
const BRAND = /logo|brand/i;

const r2 = (n: number) => Math.round(n * 100) / 100;

let ctx: CanvasRenderingContext2D | null = null;
const colorCache = new Map<string, Rgba | null>();
// Any CSS colour (including oklch and color-mix) as sRGB, by painting one pixel with it.
function parse(value: string | null | undefined): Rgba | null {
  if (!value || value === 'none') return null;
  if (colorCache.has(value)) return colorCache.get(value)!;
  let out: Rgba | null = null;
  const m = value.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    out = [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), r2(a)];
  } else if (value === 'transparent') {
    out = [0, 0, 0, 0];
  } else {
    if (!ctx) ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      out = d[3] === 0 ? [0, 0, 0, 0] : [Math.round((d[0] * 255) / d[3]), Math.round((d[1] * 255) / d[3]), Math.round((d[2] * 255) / d[3]), r2(d[3] / 255)];
    }
  }
  colorCache.set(value, out);
  return out;
}

const over = (top: Rgba, bottom: Rgba): Rgba => {
  const a = top[3] + bottom[3] * (1 - top[3]);
  if (a <= 0) return [0, 0, 0, 0];
  const ch = (i: number) => Math.round((top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a);
  return [ch(0), ch(1), ch(2), r2(a)];
};

const opacityCache = new Map<Element, number>();
function effectiveOpacity(el: Element | null): number {
  if (!el || el === document.documentElement) return 1;
  const c = opacityCache.get(el);
  if (c !== undefined) return c;
  const v = (parseFloat(getComputedStyle(el).opacity) || 0) * effectiveOpacity(el.parentElement);
  opacityCache.set(el, v);
  return v;
}

function selectorOf(el: Element): string {
  return (window.__djDescribe(el).selector as string) ?? el.tagName.toLowerCase();
}

function radiusOf(cs: CSSStyleDeclaration, r: DOMRect): StyleRecord['radius'] {
  const corner = (v: string, along: number) => {
    const first = v.split(/\s+/)[0] ?? '0';
    return first.endsWith('%') ? (parseFloat(first) / 100) * along : parseFloat(first) || 0;
  };
  const px: [number, number, number, number] = [
    corner(cs.borderTopLeftRadius, r.width),
    corner(cs.borderTopRightRadius, r.width),
    corner(cs.borderBottomRightRadius, r.width),
    corner(cs.borderBottomLeftRadius, r.width),
  ].map(r2) as [number, number, number, number];
  if (px.every((v) => v <= 0)) return null;
  const half = Math.min(r.width, r.height) / 2;
  return { px, full: half > 0 && px.every((v) => v >= half - 0.5) };
}

function borderOf(cs: CSSStyleDeclaration): StyleRecord['border'] {
  const sides = ['Top', 'Right', 'Bottom', 'Left'].map((s) => {
    const w = parseFloat((cs as any)[`border${s}Width`]) || 0;
    const style = (cs as any)[`border${s}Style`] as string;
    const color = parse((cs as any)[`border${s}Color`]);
    if (w <= 0 || style === 'none' || style === 'hidden' || !color || color[3] === 0) return null;
    return [r2(w), color] as [number, Rgba];
  });
  return sides.some(Boolean) ? sides : null;
}

function ownTextRects(el: Element): DOMRect[] {
  const out: DOMRect[] = [];
  for (const n of el.childNodes) {
    if (n.nodeType !== 3 || !n.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) out.push(r);
  }
  return out;
}

function ownText(el: Element): string {
  let t = '';
  for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent ?? '';
  return t.replace(/\s+/g, ' ').trim();
}

function isBrand(el: Element): boolean {
  for (let a: Element | null = el, i = 0; a && i < 4; a = a.parentElement, i++) {
    if (BRAND.test(a.getAttribute('class') ?? '') || BRAND.test(a.getAttribute('aria-label') ?? '') || /\bhome\b/i.test(a.getAttribute('aria-label') ?? '')) return true;
  }
  return false;
}

function iconOf(el: Element, cs: CSSStyleDeclaration, r: DOMRect): StyleRecord['icon'] | undefined {
  if (el.tagName.toUpperCase() === 'SVG') {
    if (r.width > 64 || r.height > 64 || isBrand(el)) return undefined;
    const shape = [...el.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse')].find((s) => {
      const scs = getComputedStyle(s);
      return scs.stroke !== 'none' || scs.fill !== 'none';
    });
    const scs = shape ? getComputedStyle(shape) : cs;
    const stroke = scs.stroke && scs.stroke !== 'none' ? parse(scs.stroke) : null;
    const fill = scs.fill && scs.fill !== 'none' && !scs.fill.startsWith('url(') ? parse(scs.fill) : null;
    return { kind: 'svg', w: r2(r.width), h: r2(r.height), stroke, strokeWidth: stroke ? r2(parseFloat(scs.strokeWidth) || 1) : null, fill };
  }
  if (el.tagName === 'IMG' && r.width <= 48 && r.height <= 48) return { kind: 'img', w: r2(r.width), h: r2(r.height), stroke: null, strokeWidth: null, fill: null };
  const text = ownText(el);
  // A lone × is a close icon only inside a control.
  const glyph = (text && text.length <= 3 && GLYPH.test(text)) || (text === '×' && !!el.closest(CONTROL));
  if (glyph) return { kind: 'glyph', w: r2(r.width), h: r2(r.height), stroke: null, strokeWidth: null, fill: parse(cs.color) };
  if (text && text.length <= 2 && /material|icon|fa-|glyph|symbol/i.test(cs.fontFamily)) return { kind: 'font', w: r2(r.width), h: r2(r.height), stroke: null, strokeWidth: null, fill: parse(cs.color) };
  return undefined;
}

// What paints behind the point (x, y) under `self`: every layer below it in paint order,
// composited until opaque, over the white canvas. Null with a reason when a picture or a
// gradient is behind it, or when something unrelated covers the point.
function backgroundAt(self: Element, x: number, y: number, ignoreAbove = false): { bg: Rgba | null; reason?: ContrastRecord['unresolved'] } {
  const stack = document.elementsFromPoint(x, y);
  let i = stack.findIndex((e) => e === self || self.contains(e));
  if (i < 0) return { bg: null, reason: 'hidden' };
  if (!ignoreAbove) {
    for (const e of stack.slice(0, i)) {
      if (e.contains(self)) continue;
      const cs = getComputedStyle(e);
      const fill = parse(cs.backgroundColor);
      if ((fill && fill[3] * effectiveOpacity(e) > 0.1) || cs.backgroundImage !== 'none' || MEDIA.has(e.tagName)) return { bg: null, reason: 'covered' };
    }
  }
  // The element itself and the descendant hit (the text sits on their fills too).
  while (i > 0 && self.contains(stack[i - 1])) i--;
  const layers: Rgba[] = [];
  for (const e of stack.slice(i)) {
    if (MEDIA.has(e.tagName) || (e.tagName.toUpperCase() === 'SVG' && e !== self && !self.contains(e))) return { bg: null, reason: 'media' };
    const cs = getComputedStyle(e);
    if (cs.backgroundImage !== 'none') return { bg: null, reason: cs.backgroundImage.includes('gradient') ? 'gradient' : 'image' };
    const fill = parse(cs.backgroundColor);
    if (fill && fill[3] > 0) {
      const layer: Rgba = [fill[0], fill[1], fill[2], r2(fill[3] * effectiveOpacity(e))];
      layers.push(layer);
      if (layer[3] >= 0.999) break;
    }
  }
  let bg = canvasColour();
  for (const l of layers.reverse()) bg = over(l, bg);
  return { bg };
}

// The canvas takes the root's background, or the body's when the root has none.
function canvasColour(): Rgba {
  const root = parse(getComputedStyle(document.documentElement).backgroundColor);
  const body = document.body ? parse(getComputedStyle(document.body).backgroundColor) : null;
  const from = root && root[3] > 0 ? root : body && body[3] > 0 ? body : null;
  return from ? over(from, [255, 255, 255, 1]) : [255, 255, 255, 1];
}

function visibleBox(el: Element): DOMRect | null {
  if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true } as any)) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

// Classes that name a state or a variant, left out when look-alike siblings are matched.
const VARIANT_CLASS = /^(is-|has-)|active|selected|open|checked|current|disabled|unavailable|sold|full|on$/;
const SELECTED_CLASS = /(^|-)(active|selected|current|checked|chosen|picked|on)$/;
const SELECTED = '[aria-pressed="true"], [aria-selected="true"], [aria-checked="true"], [aria-current]:not([aria-current="false"])';

// The cues that make an option look unavailable, and the look-alike siblings it is compared with.
// Parents are numbered per capture, so the element IDs the page hands out stay as they were.
const parentNumbers = new Map<Element, number>();

function cuesOf(el: Element, cs: CSSStyleDeclaration, border: StyleRecord['border']): Pick<StyleRecord, 'deco' | 'cursor' | 'borderStyle' | 'peer' | 'state'> {
  const out: Pick<StyleRecord, 'deco' | 'cursor' | 'borderStyle' | 'peer' | 'state'> = {};
  if (cs.textDecorationLine && cs.textDecorationLine !== 'none') out.deco = cs.textDecorationLine;
  if (!['auto', 'default', 'pointer', 'text'].includes(cs.cursor)) out.cursor = cs.cursor;
  if (border) {
    const styles = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
    const odd = styles.find((s, i) => border[i] && s !== 'solid');
    if (odd) out.borderStyle = odd;
  }
  const parent = el.parentElement;
  if (parent && parent !== document.documentElement) {
    const key = (e: Element) => `${e.tagName}.${[...e.classList].filter((c) => !VARIANT_CLASS.test(c)).sort().join('.')}`;
    const k = key(el);
    if ([...parent.children].filter((c) => key(c) === k).length >= 3) {
      if (!parentNumbers.has(parent)) parentNumbers.set(parent, parentNumbers.size + 1);
      out.peer = `${parentNumbers.get(parent)}|${k.toLowerCase()}`;
    }
  }
  if (el.matches(SELECTED) || [...el.classList].some((c) => SELECTED_CLASS.test(c)) || !!el.querySelector('input:checked')) out.state = true;
  return out;
}

function capture(): { styles: StyleRecord[]; contrast: ContrastRecord[] } {
  const styles: StyleRecord[] = [];
  const contrast: ContrastRecord[] = [];
  parentNumbers.clear();
  const all = document.body ? [...document.body.querySelectorAll('*')] : [];
  type Job = { el: Element; kind: ContrastRecord['kind']; fixed: boolean; y: number; run: () => ContrastRecord | null };
  const jobs: Job[] = [];
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const fixedOf = (el: Element) => {
    for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') return true;
    return false;
  };

  for (const el of all) {
    if (SKIP.has(el.tagName) || (el.closest('svg') && el.tagName.toUpperCase() !== 'SVG')) continue;
    const r = visibleBox(el);
    if (!r) continue;
    const cs = getComputedStyle(el);
    const interactive = el.matches(CONTROL);
    const text = ownText(el);
    const bg = parse(cs.backgroundColor);
    const border = borderOf(cs);
    const radius = radiusOf(cs, r);
    const shadow = cs.boxShadow !== 'none' ? cs.boxShadow : null;
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}` : null;
    const icon = iconOf(el, cs, r);
    const annotated = el.hasAttribute('data-component-id') || el.hasAttribute('data-component-type');
    const bgImage = cs.backgroundImage === 'none' ? null : cs.backgroundImage.includes('gradient') ? 'gradient' : 'url';
    const relevant = interactive || !!text || (bg && bg[3] > 0) || border || radius || shadow || outline || icon || annotated || bgImage;
    if (!relevant) continue;
    const durations = cs.transitionDuration.split(',').map((d) => parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000));
    const transition = durations.some((d) => d > 0) ? `${cs.transitionProperty} ${cs.transitionDuration} ${cs.transitionTimingFunction}` : null;
    const animation = cs.animationName && cs.animationName !== 'none' ? `${cs.animationName} ${cs.animationDuration} ${cs.animationIterationCount}` : null;
    const rec: StyleRecord = {
      id: window.__djId(el),
      color: text || icon || interactive ? parse(cs.color) : null,
      bg: bg && bg[3] > 0 ? bg : null,
      bgImage,
      border,
      radius,
      shadow,
      outline,
      opacity: r2(effectiveOpacity(el)),
      transition,
      animation,
      ...(interactive && ['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(el.tagName) ? { appearance: cs.appearance } : {}),
      ...(icon ? { icon } : {}),
      ...cuesOf(el, cs, border),
    };
    styles.push(rec);

    const fixed = fixedOf(el);
    const docY = (y: number) => (fixed ? y : y + window.scrollY);
    const disabled = !!(el as HTMLButtonElement).disabled || !!el.closest('[aria-disabled="true"], fieldset[disabled], button:disabled');
    const decorative = !!el.closest('[aria-hidden="true"]');
    if (text && !GLYPH.test(text)) {
      const first = ownTextRects(el)[0];
      if (first) {
        jobs.push({
          el,
          kind: 'text',
          fixed,
          y: docY(first.top + first.height / 2),
          run: () => {
            const rs = ownTextRects(el);
            const t = rs[0];
            if (!t) return null;
            const x = t.left + Math.min(t.width / 2, 12);
            const y = t.top + t.height / 2;
            const base = { id: rec.id, kind: 'text' as const, size: r2(parseFloat(cs.fontSize)), weight: Number(cs.fontWeight) || 400, ...(disabled ? { disabled } : {}), ...(decorative ? { decorative } : {}) };
            if (x < 0 || x > vw || t.right <= 0 || t.left >= vw) return { ...base, fg: null, bg: null, unresolved: 'offscreen' };
            const fg = parse(cs.color);
            const { bg: behind, reason } = backgroundAt(el, x, y);
            return { ...base, fg: fg ? [fg[0], fg[1], fg[2], r2(fg[3] * effectiveOpacity(el))] : null, bg: behind, ...(reason ? { unresolved: reason } : {}) };
          },
        });
      }
    }
    // Placeholder text in empty fields.
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !(el as HTMLInputElement).value && (el as HTMLInputElement).placeholder) {
      jobs.push({
        el,
        kind: 'text',
        fixed,
        y: docY(r.top + r.height / 2),
        run: () => {
          const b = el.getBoundingClientRect();
          const pcs = getComputedStyle(el, '::placeholder');
          const fg = parse(pcs.color);
          const { bg: behind, reason } = backgroundAt(el, b.left + Math.min(b.width / 2, 16), b.top + b.height / 2);
          return { id: rec.id, kind: 'text', placeholder: true, size: r2(parseFloat(pcs.fontSize)), weight: Number(pcs.fontWeight) || 400, fg: fg ? [fg[0], fg[1], fg[2], r2(fg[3] * effectiveOpacity(el))] : null, bg: behind, ...(reason ? { unresolved: reason } : {}), ...(disabled ? { disabled } : {}) };
        },
      });
    }
    // Form-field boundaries: the border or fill that shows where the field is.
    const isField = (el.tagName === 'INPUT' && FIELD_INPUTS.has(((el as HTMLInputElement).getAttribute('type') ?? '').toLowerCase())) || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
    if (isField && r.width >= 8 && r.height >= 8) {
      jobs.push({
        el,
        kind: 'ui',
        fixed,
        y: docY(r.top + r.height / 2),
        run: () => {
          const b = el.getBoundingClientRect();
          // A field behind a modal's backdrop is not what people see.
          const centre = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          if (centre && centre !== el && !el.contains(centre) && !centre.contains(el) && !(centre.tagName === 'LABEL' && (centre as HTMLLabelElement).control === el)) {
            return { id: rec.id, kind: 'ui', fg: null, bg: null, unresolved: 'covered' };
          }
          const points = [
            [b.left - 3, b.top + b.height / 2],
            [b.right + 3, b.top + b.height / 2],
            [b.left + b.width / 2, b.top - 3],
            [b.left + b.width / 2, b.bottom + 3],
          ].filter(([x, y]) => x >= 0 && x <= vw && y >= 0 && y <= vh);
          let around: Rgba | null = null;
          let reason: ContrastRecord['unresolved'] | undefined = 'hidden';
          for (const [x, y] of points) {
            const top = document.elementFromPoint(x, y);
            if (!top || top === el || el.contains(top) || top.matches(CONTROL)) continue;
            const res = backgroundAt(top, x, y, true);
            around = res.bg;
            reason = res.reason;
            if (around) break;
          }
          const own = parse(cs.backgroundColor);
          const sides = (borderOf(cs) ?? []).filter((s): s is [number, Rgba] => !!s).map((s) => s[1]);
          return {
            id: rec.id,
            kind: 'ui',
            fg: null,
            bg: around,
            ...(around ? {} : { unresolved: reason }),
            fill: own && own[3] > 0 ? own : null,
            borders: sides,
            ...(disabled ? { disabled } : {}),
          };
        },
      });
    }
    // Icon-only controls: the icon is what identifies the control.
    if (interactive && !(el as HTMLElement).innerText?.trim()) {
      const svg = el.querySelector('svg');
      const sr = svg ? visibleBox(svg) : null;
      if (svg && sr) {
        jobs.push({
          el,
          kind: 'icon',
          fixed,
          y: docY(sr.top + sr.height / 2),
          run: () => {
            const b = svg.getBoundingClientRect();
            const ic = iconOf(svg, getComputedStyle(svg), b);
            const fg = ic?.stroke ?? ic?.fill ?? null;
            const { bg: behind, reason } = backgroundAt(svg, b.left + b.width / 2, b.top + b.height / 2);
            return { id: rec.id, kind: 'icon', fg: fg ? [fg[0], fg[1], fg[2], r2(fg[3] * effectiveOpacity(svg))] : null, bg: behind, ...(reason ? { unresolved: reason } : {}), ...(disabled ? { disabled } : {}) };
          },
        });
      }
    }
  }

  // Hit-test with every layer that paints counted: inert subtrees and pointer-events:none still
  // draw over content.
  const inert = [...document.querySelectorAll('[inert]')];
  for (const el of inert) el.removeAttribute('inert');
  const force = document.createElement('style');
  force.textContent = '*, *::before, *::after { pointer-events: auto !important; }';
  document.head.appendChild(force);
  const startY = window.scrollY;
  const go = (y: number) => window.scrollTo({ top: Math.max(0, y), left: 0, behavior: 'instant' as ScrollBehavior });
  try {
    go(0);
    const ordered = [...jobs.filter((j) => j.fixed), ...jobs.filter((j) => !j.fixed).sort((a, b) => a.y - b.y)];
    for (const j of ordered) {
      if (!j.fixed) {
        const vy = j.y - window.scrollY;
        if (vy < 4 || vy > vh - 4) go(j.y - vh / 2);
      }
      let rec = j.run();
      // Something pinned (a sticky bar) can sit over the point at this scroll position; try again
      // with the element in the middle of the screen.
      if (rec && !j.fixed && (rec.unresolved === 'covered' || rec.unresolved === 'hidden')) {
        go(j.y - vh / 2);
        rec = j.run() ?? rec;
      }
      if (rec) contrast.push(rec);
    }
  } finally {
    go(startY);
    force.remove();
    for (const el of inert) el.setAttribute('inert', '');
  }
  return { styles, contrast };
}

function animations() {
  return document.getAnimations().map((a) => {
    const target = (a.effect as KeyframeEffect | null)?.target ?? null;
    const timing = a.effect?.getComputedTiming();
    return {
      id: target ? window.__djId(target) : null,
      selector: target ? selectorOf(target) : '',
      name: (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.id ?? '',
      durationMs: Math.round(Number(timing?.duration) || 0),
      infinite: timing?.iterations === Infinity,
    };
  });
}

window.__djVisual = capture;
window.__djAnimations = animations;
