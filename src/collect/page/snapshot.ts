// Captures a raw layout snapshot of the current page. Bundled to an IIFE by esbuild and exposed
// as window.__djSnapshot(cap). All diagnostics are computed later from this data in Node.

import type { ElementRecord, OcclusionProbe, OcclusionRecord, PictureRecord, Rect, Snapshot, TypeRecord } from '../../types.ts';

declare global {
  interface Window {
    __djId: (el: Element) => number;
    __djSnapshot: (cap: number) => Snapshot;
    __djBackgroundSizes: () => Promise<number>;
    __djSignature: () => string;
    __djScrollThrough: () => Promise<number>;
    __djOcclusion: (insets: { top: number; right: number; bottom: number; left: number } | null) => OcclusionProbe;
    __djDescribe: (el: Element) => Record<string, unknown>;
    __djFontSamples: (cap: number) => { stack: string; weight: number; style: string; sample: string }[];
  }
}

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'BR', 'WBR', 'TITLE', 'BASE', 'OPTION', 'OPTGROUP',
]);
const MEDIA_TAGS = new Set(['IMG', 'PICTURE', 'VIDEO', 'CANVAS', 'SVG']);
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
  'combobox', 'slider', 'spinbutton', 'textbox', 'searchbox', 'treeitem', 'gridcell',
]);
const OVERLAY_ROLES = new Set(['dialog', 'alertdialog', 'menu', 'listbox', 'tooltip']);

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function toRect(r: DOMRect, sx: number, sy: number): Rect {
  return { x: round(r.x + sx), y: round(r.y + sy), w: round(r.width), h: round(r.height) };
}

function implicitRole(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.split(/\s+/)[0];
  const tag = el.tagName;
  switch (tag) {
    case 'BUTTON':
      return 'button';
    case 'A':
      return el.hasAttribute('href') ? 'link' : null;
    case 'INPUT': {
      const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return 'searchbox';
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'hidden') return null;
      return 'textbox';
    }
    case 'SELECT':
      return 'combobox';
    case 'TEXTAREA':
      return 'textbox';
    case 'NAV':
      return 'navigation';
    case 'MAIN':
      return 'main';
    case 'ASIDE':
      return 'complementary';
    case 'FORM':
      return 'form';
    case 'TABLE':
      return 'table';
    case 'IMG':
      return 'img';
    case 'UL':
    case 'OL':
      return 'list';
    case 'LI':
      return 'listitem';
    case 'DIALOG':
      return 'dialog';
    case 'HEADER':
      return el.closest('article, section, aside, main, nav') ? null : 'banner';
    case 'FOOTER':
      return el.closest('article, section, aside, main, nav') ? null : 'contentinfo';
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
      return 'heading';
    case 'SECTION':
      return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : null;
    case 'FIELDSET':
      return 'group';
    default:
      return null;
  }
}

function isInteractive(el: Element, role: string | null): boolean {
  const tag = el.tagName;
  if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY') return true;
  if (tag === 'A' && el.hasAttribute('href')) return true;
  if (tag === 'INPUT') return (el as HTMLInputElement).type !== 'hidden';
  if ((el as HTMLElement).isContentEditable && el.getAttribute('contenteditable') !== null) return true;
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && parseInt(tabindex, 10) >= 0) return true;
  const ctype = el.getAttribute('data-component-type');
  return ctype === 'control';
}

function textOf(el: Element): string {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

function accessibleName(el: Element, role: string | null, interactive: boolean): string | null {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim().slice(0, 80);
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const t = labelledby
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((n) => textOf(n as Element))
      .join(' ')
      .trim();
    if (t) return t.slice(0, 80);
  }
  const tag = el.tagName;
  if (tag === 'IMG') return (el.getAttribute('alt') || '').slice(0, 80) || null;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) return textOf(labels[0]).slice(0, 80);
    const ph = el.getAttribute('placeholder');
    if (ph) return ph.slice(0, 80);
    const type = (el as HTMLInputElement).type;
    if (type === 'submit' || type === 'button') return ((el as HTMLInputElement).value || '').slice(0, 80) || null;
  }
  if (interactive || role === 'heading' || role === 'region' || tag === 'LABEL' || tag === 'LEGEND') {
    // innerText keeps the separation between cells and blocks that textContent loses.
    const t = ((el as HTMLElement).innerText ?? textOf(el)).replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 80);
  }
  const title = el.getAttribute('title');
  return title ? title.slice(0, 80) : null;
}

function selectorFor(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let i = 0; cur && i < 4; i++) {
    const tag = cur.tagName.toLowerCase();
    if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) {
      parts.unshift(`${tag}#${cur.id}`);
      break;
    }
    let part = tag;
    const cls = [...cur.classList].filter((c) => /^[A-Za-z_-][\w-]*$/.test(c)).slice(0, 2);
    if (cls.length) part += '.' + cls.join('.');
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === cur!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    cur = parent;
    if (!cur || cur.tagName === 'BODY' || cur.tagName === 'HTML') break;
  }
  return parts.join(' > ');
}

function gridColumnCount(value: string): number | null {
  if (!value || value === 'none') return null;
  let depth = 0;
  let token = '';
  const tokens: string[] = [];
  for (const ch of value) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ' ' && depth === 0) {
      if (token) tokens.push(token);
      token = '';
    } else token += ch;
  }
  if (token) tokens.push(token);
  const tracks = tokens.filter((t) => !t.startsWith('['));
  return tracks.length || null;
}

function isTransparent(color: string): boolean {
  return color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color);
}

function isVisuallyHidden(el: Element, cs: CSSStyleDeclaration, r: DOMRect): boolean {
  const clip = cs.clip || '';
  if (/rect\(\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\s*\)/.test(clip)) return true;
  const clipPath = cs.clipPath || '';
  if (/inset\(\s*(50|100)%/.test(clipPath)) return true;
  if (r.width <= 1.5 && r.height <= 1.5 && (cs.position === 'absolute' || cs.position === 'fixed')) return true;
  return false;
}

// ---------- Typography ----------

const VALUE_INPUTS = new Set(['', 'text', 'search', 'email', 'tel', 'url', 'number', 'password', 'date', 'datetime-local', 'month', 'time', 'week', 'submit', 'button', 'reset']);
const MAX_LINES = 12;

function cssPx(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? round(n) : NaN;
}

// Rendered width of each line: rects whose vertical centre falls within an earlier rect's span
// share its line.
function lineWidths(rects: DOMRect[]): number[] {
  const lines: { top: number; bottom: number; left: number; right: number }[] = [];
  const sorted = [...rects].filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top || a.left - b.left);
  for (const r of sorted) {
    const mid = (r.top + r.bottom) / 2;
    const line = lines.find((l) => mid >= l.top && mid <= l.bottom);
    if (line) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
    } else lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  }
  return lines.map((l) => round(l.right - l.left));
}

function isInlineLevel(el: Element): boolean {
  const d = getComputedStyle(el).display;
  return d.startsWith('inline') || d === 'contents' || d === 'none';
}

function contentWidth(el: Element): number {
  let block: Element | null = el;
  while (block && block !== document.body && isInlineLevel(block)) block = block.parentElement;
  if (!block) return 0;
  const cs = getComputedStyle(block);
  return round(block.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
}

function headingLevel(el: Element): number | null {
  const h = el.closest('h1, h2, h3, h4, h5, h6, [role="heading"]');
  if (!h) return null;
  const m = h.tagName.match(/^H([1-6])$/);
  if (m && !h.getAttribute('role')) return Number(m[1]);
  const level = Number(h.getAttribute('aria-level'));
  return Number.isInteger(level) && level > 0 ? level : m ? Number(m[1]) : 2;
}

function typeOf(el: Element, cs: CSSStyleDeclaration, textNodes: Node[], text: string): TypeRecord | null {
  let field: TypeRecord['field'];
  let chars = text.replace(/\s+/g, ' ').trim().length;
  let rects: DOMRect[] = [];
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    const input = el as HTMLInputElement;
    if (tag === 'INPUT' && !VALUE_INPUTS.has((input.getAttribute('type') ?? '').toLowerCase())) return null;
    const value = tag === 'SELECT' ? ((el as HTMLSelectElement).selectedOptions[0]?.text ?? '') : input.value;
    const placeholder = input.placeholder ?? '';
    field = value.trim() ? 'value' : placeholder.trim() ? 'placeholder' : 'empty';
    chars = (value.trim() || placeholder.trim()).length;
  } else {
    if (!textNodes.length) return null;
    const range = document.createRange();
    // The whole run of text when every child is inline (a paragraph with a link inside); else only
    // the element's own text nodes.
    if ([...el.children].every(isInlineLevel)) {
      range.selectNodeContents(el);
      rects = [...range.getClientRects()];
    } else {
      for (const node of textNodes) {
        range.selectNodeContents(node);
        rects.push(...range.getClientRects());
      }
    }
  }
  const lines = lineWidths(rects);
  const lh = cs.lineHeight === 'normal' ? null : cssPx(cs.lineHeight);
  return {
    size: cssPx(cs.fontSize),
    weight: Number(cs.fontWeight) || 400,
    family: cs.fontFamily,
    style: cs.fontStyle,
    lineHeight: lh,
    letterSpacing: cs.letterSpacing === 'normal' ? 0 : cssPx(cs.letterSpacing),
    transform: cs.textTransform,
    wrap: cs.getPropertyValue('text-wrap-style') || cs.getPropertyValue('text-wrap') || 'wrap',
    align: cs.textAlign,
    color: cs.color,
    chars,
    lines: lines.slice(0, MAX_LINES),
    lineCount: field ? 1 : lines.length,
    avail: contentWidth(el),
    heading: headingLevel(el),
    ...(field ? { field } : {}),
  };
}

// One sample element per computed font-family, weight and style with visible text (the one with
// the most text), kept on window for the collector to ask Chromium which fonts rendered it.
function fontSamples(cap: number): { stack: string; weight: number; style: string; sample: string }[] {
  const best = new Map<string, { el: Element; chars: number }>();
  for (const el of document.body ? document.body.getElementsByTagName('*') : []) {
    if (SKIP_TAGS.has(el.tagName)) continue;
    let chars = 0;
    for (const n of el.childNodes) if (n.nodeType === 3) chars += (n.textContent ?? '').trim().length;
    if (!chars || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true } as any)) continue;
    const cs = getComputedStyle(el);
    const key = `${cs.fontFamily}|${Number(cs.fontWeight) || 400}|${cs.fontStyle}`;
    const cur = best.get(key);
    if (!cur || chars > cur.chars) best.set(key, { el, chars });
  }
  const picked = [...best.entries()].sort((a, b) => b[1].chars - a[1].chars).slice(0, cap);
  (window as any).__djFontSampleEls = picked.map(([, v]) => v.el);
  return picked.map(([key, v]) => {
    const [stack, weight, style] = key.split('|');
    return { stack, weight: Number(weight), style, sample: selectorFor(v.el) };
  });
}

// ---------- Pictures ----------

// SVG files keep their own preserveAspectRatio inside the box, so object-fit and background-size
// do not describe how they are drawn.
const VECTOR_SRC = /^data:image\/svg|\.svg(?:[?#]|$)/i;
const CONTROL_SELECTOR = 'button, a[href], label, summary, select, input, textarea, [role=button], [role=link], [role=tab], [role=menuitem]';
// SVGPreserveAspectRatio alignments 2–10 (xMinYMin … xMaxYMax); 1 is none.
const SVG_ALIGN = ['0%', '50%', '100%'];
const bgSizes = new Map<string, [number, number]>();

// One entry per background layer, split at top-level commas.
function layers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function firstBackgroundUrl(cs: CSSStyleDeclaration): { url: string; layer: number } | null {
  const list = layers(cs.backgroundImage);
  const layer = list.findIndex((l) => l.startsWith('url('));
  const url = layer >= 0 ? list[layer].match(/^url\(["']?(.*?)["']?\)$/)?.[1] : undefined;
  return url ? { url, layer } : null;
}

// Loads each background image once more (from the cache) to read its natural size.
async function backgroundSizes(): Promise<number> {
  const urls = new Set<string>();
  for (const el of document.body ? document.body.getElementsByTagName('*') : []) {
    const bg = firstBackgroundUrl(getComputedStyle(el));
    if (bg && !VECTOR_SRC.test(bg.url) && !bgSizes.has(bg.url)) urls.add(bg.url);
  }
  await Promise.all(
    [...urls].slice(0, 200).map(async (url) => {
      const im = new Image();
      im.src = url;
      await Promise.race([im.decode().catch(() => {}), realDelay(2000)]);
      if (im.naturalWidth && im.naturalHeight) bgSizes.set(url, [im.naturalWidth, im.naturalHeight]);
    }),
  );
  return bgSizes.size;
}

function pictureBox(cs: CSSStyleDeclaration, r: DOMRect, origin: string): [number, number] {
  const n = (v: string) => parseFloat(v) || 0;
  let w = r.width;
  let h = r.height;
  if (origin !== 'border-box') {
    w -= n(cs.borderLeftWidth) + n(cs.borderRightWidth);
    h -= n(cs.borderTopWidth) + n(cs.borderBottomWidth);
  }
  if (origin === 'content-box') {
    w -= n(cs.paddingLeft) + n(cs.paddingRight);
    h -= n(cs.paddingTop) + n(cs.paddingBottom);
  }
  return [round(w), round(h)];
}

function hasTextOutsideControls(el: Element): boolean {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue;
    const control = n.parentElement?.closest(CONTROL_SELECTOR);
    if (!control || control === el || !el.contains(control)) return true;
  }
  return false;
}

function isDecorativePicture(el: Element, source: PictureRecord['source']): boolean {
  const role = el.getAttribute('role');
  if (el.closest('[aria-hidden="true"]') || role === 'presentation' || role === 'none') return true;
  const labelled = role === 'img' || el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
  if (source === 'img') return el.getAttribute('alt') === '' && !labelled;
  if (source === 'svg') return !labelled && !el.querySelector(':scope > title');
  if (source === 'background') return !labelled && hasTextOutsideControls(el);
  return false;
}

function pictureOf(el: Element, id: number, cs: CSSStyleDeclaration, r: DOMRect): PictureRecord | null {
  const tag = el.tagName.toUpperCase();
  const pair = (v: string): [string, string] => {
    const t = v.trim().split(/\s+/);
    return t.length === 2 ? [t[0], t[1]] : ['50%', '50%'];
  };
  const fitted = (source: PictureRecord['source'], natural: [number, number]): PictureRecord => ({
    id,
    source,
    natural,
    box: pictureBox(cs, r, 'content-box'),
    fit: cs.objectFit,
    position: pair(cs.objectPosition),
    decorative: isDecorativePicture(el, source),
  });
  if (tag === 'IMG') {
    const im = el as HTMLImageElement;
    if (!im.complete || !im.naturalWidth || !im.naturalHeight || VECTOR_SRC.test(im.currentSrc)) return null;
    return fitted('img', [im.naturalWidth, im.naturalHeight]);
  }
  if (tag === 'VIDEO') {
    const v = el as HTMLVideoElement;
    return v.videoWidth && v.videoHeight ? fitted('video', [v.videoWidth, v.videoHeight]) : null;
  }
  if (tag === 'CANVAS') {
    const c = el as HTMLCanvasElement;
    return c.width && c.height ? fitted('canvas', [c.width, c.height]) : null;
  }
  if (tag === 'SVG') {
    const svg = el as SVGSVGElement;
    const vb = svg.viewBox?.baseVal;
    if (!vb || !vb.width || !vb.height) return null;
    const par = svg.preserveAspectRatio.baseVal;
    const align = par.align >= 2 ? par.align - 2 : 4;
    return {
      ...fitted('svg', [round(vb.width), round(vb.height)]),
      fit: par.align === 1 ? 'fill' : par.meetOrSlice === 2 ? 'cover' : 'contain',
      position: [SVG_ALIGN[align % 3], SVG_ALIGN[Math.floor(align / 3)]],
    };
  }
  const bg = firstBackgroundUrl(cs);
  if (!bg) return null;
  const at = (v: string) => {
    const l = layers(v);
    return l[bg.layer % l.length] ?? '';
  };
  const natural = bgSizes.get(bg.url);
  // A fixed background is positioned against the viewport, not its box.
  if (!natural || at(cs.backgroundAttachment) === 'fixed') return null;
  const rep = at(cs.backgroundRepeat).split(/\s+/);
  const repeats = (t: string | undefined) => t !== undefined && t !== 'no-repeat';
  const repeat: [boolean, boolean] =
    rep[0] === 'repeat-x' ? [true, false] : rep[0] === 'repeat-y' ? [false, true] : [repeats(rep[0]), repeats(rep[1] ?? rep[0])];
  return {
    id,
    source: 'background',
    natural,
    box: pictureBox(cs, r, at(cs.backgroundOrigin)),
    fit: at(cs.backgroundSize),
    position: [at(cs.backgroundPositionX), at(cs.backgroundPositionY)],
    repeat,
    decorative: isDecorativePicture(el, 'background'),
  };
}

function snapshot(cap: number): Snapshot {
  const sx = window.scrollX;
  const sy = window.scrollY;
  const elements: ElementRecord[] = [];
  const pictures: PictureRecord[] = [];
  let truncated = false;
  let order = 0;

  const overlayStack: boolean[] = [];

  const visit = (el: Element, parentId: number | null, depth: number, inheritedFixed: boolean) => {
    if (elements.length >= cap) {
      truncated = true;
      return;
    }
    if (SKIP_TAGS.has(el.tagName)) return;
    // checkVisibility() is false for display:none subtrees and content-visibility hidden content.
    if (!el.checkVisibility()) return;

    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const r = el.getBoundingClientRect();
    const id = window.__djId(el);
    const role = implicitRole(el);
    const interactive = isInteractive(el, role);

    let ownText = false;
    let textRect: Rect | null = null;
    let text = '';
    const textNodes: Node[] = [];
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && node.textContent && node.textContent.trim()) {
        ownText = true;
        text += node.textContent;
        textNodes.push(node);
        const range = document.createRange();
        range.selectNodeContents(node);
        const tr = range.getBoundingClientRect();
        if (tr.width > 0 || tr.height > 0) {
          const rr = toRect(tr, sx, sy);
          if (!textRect) textRect = rr;
          else {
            const x1 = Math.min(textRect.x, rr.x);
            const y1 = Math.min(textRect.y, rr.y);
            const x2 = Math.max(textRect.x + textRect.w, rr.x + rr.w);
            const y2 = Math.max(textRect.y + textRect.h, rr.y + rr.h);
            textRect = { x: x1, y: y1, w: round(x2 - x1), h: round(y2 - y1) };
          }
        }
      }
    }

    const position = cs.position;
    const isFixed = position === 'fixed' || inheritedFixed;
    const transform = cs.transform !== 'none' || cs.translate !== 'none' || cs.scale !== 'none' || cs.rotate !== 'none';
    const overlayRole = role !== null && OVERLAY_ROLES.has(role);
    const popoverOpen = el.hasAttribute('popover') && (el as HTMLElement).matches(':popover-open');
    const dialogOpen = el.tagName === 'DIALOG' && (el as HTMLDialogElement).open;
    const selfOverlay = overlayRole || popoverOpen || dialogOpen || position === 'fixed';
    const parentOverlay = overlayStack.length ? overlayStack[overlayStack.length - 1] : false;
    const overlay = parentOverlay || selfOverlay;

    const borderW: [number, number, number, number] = [
      parseFloat(cs.borderTopWidth) || 0,
      parseFloat(cs.borderRightWidth) || 0,
      parseFloat(cs.borderBottomWidth) || 0,
      parseFloat(cs.borderLeftWidth) || 0,
    ];
    const styles = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
    const colors = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
    const borderVisible = borderW.some(
      (w, i) => w > 0 && styles[i] !== 'none' && styles[i] !== 'hidden' && !isTransparent(colors[i]),
    );

    const display = cs.display;
    const isFlex = display.includes('flex');
    const isGrid = display.includes('grid');

    let labelFor: number | null = null;
    if (el.tagName === 'LABEL') {
      const control = (el as HTMLLabelElement).control;
      if (control) labelFor = window.__djId(control);
    }

    let img: ElementRecord['img'] = null;
    if (el.tagName === 'IMG') {
      const im = el as HTMLImageElement;
      img = { complete: im.complete, naturalWidth: im.naturalWidth, naturalHeight: im.naturalHeight };
    }

    const tagUpper = el.tagName.toUpperCase();
    let svgOnlyDefs = false;
    if (tagUpper === 'SVG') {
      const kids = [...el.children].map((c) => c.tagName.toLowerCase());
      svgOnlyDefs = kids.length > 0 && kids.every((k) => ['defs', 'symbol', 'title', 'desc', 'style'].includes(k));
    }

    const lineClamp = (cs as any).webkitLineClamp || cs.getPropertyValue('line-clamp') || 'none';

    const rec: ElementRecord = {
      id,
      parent: parentId,
      order: order++,
      depth,
      tag: el.tagName.toLowerCase(),
      role,
      name: accessibleName(el, role, interactive),
      text: ownText ? text.replace(/\s+/g, ' ').trim().slice(0, 120) : null,
      ownText,
      selector: selectorFor(el),
      componentId: el.getAttribute('data-component-id'),
      componentType: el.getAttribute('data-component-type'),
      rect: toRect(r, isFixed ? 0 : sx, isFixed ? 0 : sy),
      textRect,
      lineBoxes: el.getClientRects().length,
      visible: el.checkVisibility({ opacityProperty: true, visibilityProperty: true } as any),
      display,
      position,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      transform,
      textOverflow: cs.textOverflow,
      lineClamp: String(lineClamp),
      whiteSpace: cs.whiteSpace,
      scroll: {
        sw: el.scrollWidth,
        sh: el.scrollHeight,
        cw: el.clientWidth,
        ch: el.clientHeight,
        sl: el.scrollLeft,
        st: el.scrollTop,
      },
      border: borderW,
      borderVisible,
      bg: isTransparent(cs.backgroundColor) ? null : cs.backgroundColor,
      bgImage: cs.backgroundImage !== 'none',
      flexDirection: isFlex ? cs.flexDirection : null,
      flexWrap: isFlex ? cs.flexWrap : null,
      gridColumns: isGrid ? gridColumnCount(cs.gridTemplateColumns) : null,
      gap: isFlex || isGrid ? [parseFloat(cs.rowGap) || 0, parseFloat(cs.columnGap) || 0] : null,
      interactive,
      disabled:
        (el as HTMLButtonElement).disabled === true ||
        el.getAttribute('aria-disabled') === 'true' ||
        !!el.closest('fieldset[disabled]'),
      inert: !!el.closest('[inert]'),
      ariaHidden: !!el.closest('[aria-hidden="true"]'),
      hiddenAttr: !!el.closest('[hidden]'),
      closedDetails: (() => {
        const d = el.parentElement?.closest('details');
        return !!d && !d.open && el.tagName !== 'SUMMARY' && !el.closest('summary');
      })(),
      overlay,
      visuallyHidden: isVisuallyHidden(el, cs, r),
      media: MEDIA_TAGS.has(tagUpper),
      svgOnlyDefs,
      labelFor,
      img,
    };
    const type = typeOf(el, cs, textNodes, text);
    if (type) rec.type = type;
    elements.push(rec);
    const picture = pictureOf(el, id, cs, r);
    if (picture) pictures.push(picture);

    // Do not descend into SVG internals or replaced content.
    if (tagUpper === 'SVG' || el.tagName === 'IFRAME' || el.tagName === 'SELECT') return;
    overlayStack.push(overlay);
    for (const child of el.children) visit(child, id, depth + 1, isFixed && !transform);
    // Open shadow roots are walked as children of their host.
    if ((el as HTMLElement).shadowRoot) {
      for (const child of (el as HTMLElement).shadowRoot!.children) visit(child, id, depth + 1, isFixed && !transform);
    }
    overlayStack.pop();
  };

  if (document.body) visit(document.body, null, 0, false);

  const html = document.documentElement;
  const hcs = getComputedStyle(html);
  const bcs = document.body ? getComputedStyle(document.body) : hcs;
  const meta = document.querySelector('meta[name="viewport"]');

  return {
    url: location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    doc: {
      scrollWidth: html.scrollWidth,
      scrollHeight: html.scrollHeight,
      clientWidth: html.clientWidth,
      clientHeight: html.clientHeight,
      htmlOverflowX: hcs.overflowX,
      htmlOverflowY: hcs.overflowY,
      bodyOverflowX: bcs.overflowX,
      bodyOverflowY: bcs.overflowY,
      viewportMeta: meta ? meta.getAttribute('content') : null,
      dir: html.dir || (document.body && document.body.dir) || 'ltr',
      lang: html.lang || '',
    },
    scroll: { x: sx, y: sy },
    elements,
    truncated,
    pictures,
    webFonts: [...new Set([...document.fonts].map((f) => f.family.replace(/^["']|["']$/g, '')))],
  };
}

function signature(): string {
  const els = document.body ? document.body.getElementsByTagName('*') : ([] as unknown as HTMLCollection);
  const n = Math.min(els.length, 4000);
  let h = 0;
  for (let i = 0; i < n; i++) {
    const r = els[i].getBoundingClientRect();
    h = (Math.imul(h, 31) + ((r.x | 0) * 7 + (r.y | 0) * 13 + (r.width | 0) * 17 + (r.height | 0))) | 0;
  }
  return `${els.length}:${h}:${document.documentElement.scrollHeight}:${document.documentElement.scrollWidth}`;
}

// Real timers and frames: the page's own are paused with its clock (settle.ts).
type RealTimers = { setTimeout: (fn: () => void, ms?: number) => number; requestAnimationFrame: (fn: () => void) => number };
const realTimers = (): RealTimers => (window as unknown as { __pwClock?: { builtins: RealTimers } }).__pwClock?.builtins ?? (window as unknown as RealTimers);
const realDelay = (ms: number) => new Promise<void>((r) => realTimers().setTimeout(() => r(), ms));
const realFrames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (--n <= 0 ? resolve() : realTimers().requestAnimationFrame(step));
    realTimers().requestAnimationFrame(step);
  });

// Scrolls through the page a screen at a time, rendering each position so lazy content starts to
// load; the caller's wait (page time and quiet) lets it arrive.
async function scrollThrough(): Promise<number> {
  const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
  let y = 0;
  let guard = 0;
  while (y < document.documentElement.scrollHeight && guard++ < 60) {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior });
    await realFrames(2);
    y += step;
  }
  const images = [...document.images].filter((im) => !im.complete);
  await Promise.race([
    Promise.all(images.map((im) => new Promise((r) => { im.addEventListener('load', r, { once: true }); im.addEventListener('error', r, { once: true }); }))),
    realDelay(3000),
  ]);
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  return guard;
}

// ---------- Occlusion probe ----------
// Whether each piece of content (text, controls, media) can be seen unobstructed. The page is
// scrolled vertically through its whole height; at each position, sample points on each element
// are hit-tested to find what is painted on top. Content that scrolls must be seen clear at some
// position; content in a pinned layer (fixed, or sticky while stuck) must be clear at every
// position where it is pinned. While a dialog, drawer, menu or other top layer is open, only
// content inside top layers is judged.

const TOP_LAYER_ROLES = new Set(['dialog', 'alertdialog', 'menu', 'listbox', 'tooltip']);
const EDGE = 3; // sample points sit this far inside each edge: overlaps up to 2 px are tolerated
const MAX_CANDIDATES = 2000;

function alphaOf(color: string): number {
  if (!color || color === 'transparent') return 0;
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(/[ ,/]+/).filter(Boolean);
  return parts.length >= 4 ? parseFloat(parts[3]) : 1;
}

function occlusion(insets: { top: number; right: number; bottom: number; left: number } | null): OcclusionProbe {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const html = document.documentElement;
  const startY = window.scrollY;
  const cover = /viewport-fit\s*=\s*cover/.test(document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '');
  const unsafe = cover && insets ? insets : { top: 0, right: 0, bottom: 0, left: 0 };

  // Hit-test everything that paints: inert subtrees and pointer-events:none still cover content.
  const inert = [...document.querySelectorAll('[inert]')];
  for (const el of inert) el.removeAttribute('inert');
  const force = document.createElement('style');
  force.textContent = '*, *::before, *::after { pointer-events: auto !important; }';
  document.head.appendChild(force);

  const opacityCache = new Map<Element, number>();
  const effectiveOpacity = (el: Element | null): number => {
    if (!el) return 1;
    const c = opacityCache.get(el);
    if (c !== undefined) return c;
    const v = parseFloat(getComputedStyle(el).opacity) * effectiveOpacity(el.parentElement);
    opacityCache.set(el, v);
    return v;
  };
  const textRects = (el: Element): DOMRect[] => {
    const out: DOMRect[] = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent || !n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      out.push(...range.getClientRects());
    }
    return out;
  };
  const inRect = (x: number, y: number, r: DOMRect | { left: number; top: number; right: number; bottom: number }) =>
    x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  // Whether `el` paints at viewport point (x, y).
  const paints = (el: Element, x: number, y: number): boolean => {
    if (effectiveOpacity(el) < 0.05) return false;
    const tag = el.tagName;
    if (MEDIA_TAGS.has(tag.toUpperCase()) || tag === 'IFRAME' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return true;
    const cs = getComputedStyle(el);
    if (alphaOf(cs.backgroundColor) > 0.05 || cs.backgroundImage !== 'none') return true;
    return textRects(el).some((r) => inRect(x, y, r));
  };

  // Top layers: open dialogs, menus, popovers, and fixed layers covering at least 30% of the screen.
  const topLayers: Element[] = [];
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true } as any)) continue;
    const role = el.getAttribute('role');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const onScreen = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if (onScreen <= 0) continue;
    const isTop =
      (role !== null && TOP_LAYER_ROLES.has(role)) ||
      el.getAttribute('aria-modal') === 'true' ||
      (el.tagName === 'DIALOG' && (el as HTMLDialogElement).open) ||
      (el.hasAttribute('popover') && (el as HTMLElement).matches(':popover-open')) ||
      (cs.position === 'fixed' && onScreen >= 0.3 * vw * vh && (alphaOf(cs.backgroundColor) > 0.05 || cs.backgroundImage !== 'none'));
    if (isTop && !topLayers.some((t) => t.contains(el))) topLayers.push(el);
  }

  // Candidates: leaf content a user needs to see.
  type Cand = { el: Element; kind: 'text' | 'control' | 'media'; pinnedBy: Element | null; clips: Element[] };
  const cands: Cand[] = [];
  const all = document.body ? [...document.body.querySelectorAll('*')] : [];
  for (const el of all) {
    if (cands.length >= MAX_CANDIDATES) break;
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) continue;
    if (el.closest('svg') && tag !== 'SVG') continue;
    if (el.closest('[aria-hidden="true"], [hidden]') || inert.some((i) => i.contains(el))) continue;
    if (topLayers.length && !topLayers.some((t) => t.contains(el))) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true } as any)) continue;
    const role = implicitRole(el);
    const interactive = isInteractive(el, role);
    const insideControl = !interactive && !!el.parentElement?.closest('button, a[href], label, summary, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=option]');
    let kind: Cand['kind'] | null = null;
    if (interactive) kind = 'control';
    else if (insideControl) kind = null;
    else if (MEDIA_TAGS.has(tag)) kind = 'media';
    else if (textRects(el).some((r) => r.width > 0 && r.height > 0)) kind = 'text';
    if (!kind) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || isVisuallyHidden(el, cs, r)) continue;
    // A closed off-canvas panel lies wholly outside the page horizontally.
    if (r.right <= 0 || r.left >= Math.max(vw, html.scrollWidth)) continue;
    let pinnedBy: Element | null = null;
    const clips: Element[] = [];
    let mode: 'flow' | 'absolute' | 'fixed' = cs.position === 'fixed' ? 'fixed' : cs.position === 'absolute' ? 'absolute' : 'flow';
    if (cs.position === 'fixed' || cs.position === 'sticky') pinnedBy = el;
    // Text is also clipped by its own element (for example deliberate ellipsis truncation).
    if (kind === 'text' && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) clips.push(el);
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a);
      const transformed = acs.transform !== 'none';
      if (!pinnedBy && (acs.position === 'fixed' || acs.position === 'sticky')) pinnedBy = a;
      if (mode === 'fixed' && !transformed) continue;
      if (mode === 'absolute' && acs.position === 'static' && !transformed) continue;
      mode = 'flow';
      if (acs.overflowX !== 'visible' || acs.overflowY !== 'visible') clips.push(a);
      if (acs.position === 'fixed') mode = 'fixed';
      else if (acs.position === 'absolute') mode = 'absolute';
    }
    cands.push({ el, kind, pinnedBy, clips });
  }

  // Sample points in element-relative fractions: five across, three down, inset from the edges.
  const pointsFor = (c: Cand): { x: number; y: number }[] => {
    let box: { left: number; top: number; right: number; bottom: number };
    if (c.kind === 'text') {
      const rs = textRects(c.el).filter((r) => r.width > 0 && r.height > 0);
      box = { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
    } else {
      box = c.el.getBoundingClientRect();
    }
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    const xs = w > 2 * EDGE ? [box.left + EDGE, box.left + w / 4, box.left + w / 2, box.left + (3 * w) / 4, box.right - EDGE] : [box.left + w / 2];
    const ys = h > 2 * EDGE ? [box.top + EDGE, box.top + h / 2, box.bottom - EDGE] : [box.top + h / 2];
    const out: { x: number; y: number }[] = [];
    for (const x of xs) for (const y of ys) out.push({ x, y });
    return out;
  };
  // Point is inside every clipping ancestor (scroll containers and clipped overflow are judged by
  // other checks, so points they hide are skipped here).
  const insideClips = (c: Cand, x: number, y: number) =>
    c.clips.every((a) => {
      const r = a.getBoundingClientRect();
      const acs = getComputedStyle(a);
      const inX = acs.overflowX === 'visible' || (x >= r.left + a.clientLeft && x <= r.left + a.clientLeft + a.clientWidth);
      const inY = acs.overflowY === 'visible' || (y >= r.top + a.clientTop && y <= r.top + a.clientTop + a.clientHeight);
      return inX && inY;
    });
  // Fixed layers are always pinned. A sticky layer is pinned only while it sits at its sticky
  // offset, having moved from where it started; it scrolls away at the end of its container.
  const pinState = (s: Element, docTopAtStart: number): 'fixed' | 'sticky' | null => {
    const cs = getComputedStyle(s);
    if (cs.position === 'fixed') return 'fixed';
    const r = s.getBoundingClientRect();
    if (window.scrollY <= 0 || Math.abs(r.top + window.scrollY - docTopAtStart) <= 1) return null;
    const atTop = cs.top !== 'auto' && Math.abs(r.top - parseFloat(cs.top)) <= 1;
    const atBottom = cs.bottom !== 'auto' && Math.abs(vh - r.bottom - parseFloat(cs.bottom)) <= 1;
    return atTop || atBottom ? 'sticky' : null;
  };
  const describe = (el: Element) => {
    const d = window.__djDescribe(el) as Record<string, unknown>;
    return { id: window.__djId(el), selector: String(d.selector), name: (d.name as string | null) ?? null, position: getComputedStyle(el).position };
  };
  const isLabelPair = (a: Element, b: Element) =>
    (a.tagName === 'LABEL' && !!(a as HTMLLabelElement).control && (a as HTMLLabelElement).control!.contains(b)) ||
    (b.tagName === 'LABEL' && !!(b as HTMLLabelElement).control && (b as HTMLLabelElement).control!.contains(a));

  // Per candidate and sample point: seen clear at some position, and what obstructed it.
  type PointState = { seen: boolean; by: Map<string, number>; unseenReason: string | null };
  const state = cands.map((c) => ({ c, pts: [] as PointState[], pinnedWorst: 0, pinnedBy: new Map<string, number>(), pinnedAt: -1 }));
  const obstructors = new Map<string, ReturnType<typeof describe> | { id: null; selector: string; name: null; position: string }>();

  const maxY = Math.max(0, html.scrollHeight - vh);
  const step = Math.max(200, Math.floor((vh - unsafe.top - unsafe.bottom) * 0.5));
  const positions: number[] = [];
  for (let y = 0; y < maxY; y += step) positions.push(y);
  positions.push(maxY);

  const go = (y: number) => window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior });
  go(0);
  const stickyStart = new Map<Element, number>();
  for (const s of state) {
    if (s.c.pinnedBy && !stickyStart.has(s.c.pinnedBy)) stickyStart.set(s.c.pinnedBy, s.c.pinnedBy.getBoundingClientRect().top + window.scrollY);
  }

  for (const y of positions) {
    go(y);
    const sy = window.scrollY;
    for (const s of state) {
      const r = s.c.el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue;
      const pin = s.c.pinnedBy ? pinState(s.c.pinnedBy, stickyStart.get(s.c.pinnedBy) ?? 0) : null;
      const pinned = pin !== null;
      const pts = pointsFor(s.c);
      if (!s.pts.length) s.pts = pts.map(() => ({ seen: false, by: new Map(), unseenReason: null }));
      let blocked = 0;
      let evaluated = 0;
      const blockedBy = new Map<string, number>();
      pts.forEach((p, i) => {
        const ps = s.pts[i];
        if (!ps) return;
        const docX = p.x + window.scrollX;
        const docY = p.y + sy;
        let reason: string | null = null;
        const outside = p.x < 0 || p.x > vw || p.y < 0 || p.y > vh;
        if (!insideClips(s.c, p.x, p.y)) return;
        else if (pin === 'fixed' && outside) reason = 'off_screen';
        else if (docX < 0 || docY < 0 || docX > Math.max(html.scrollWidth, vw)) reason = 'off_page';
        else if (outside) return; // reachable by scrolling the page (or, for sticky content, by scrolling back)
        else if (p.y < unsafe.top || p.y > vh - unsafe.bottom || p.x < unsafe.left || p.x > vw - unsafe.right) {
          if (!pinned) return;
          reason = 'unsafe_area';
        } else {
          const stack = document.elementsFromPoint(p.x, p.y);
          // The element does not occupy this point (rounded corners, clip-path, transforms).
          if (!stack.some((hit) => hit === s.c.el || s.c.el.contains(hit))) return;
          for (const hit of stack) {
            if (hit === s.c.el || s.c.el.contains(hit) || hit.contains(s.c.el)) break;
            if (isLabelPair(hit, s.c.el)) break;
            if (!paints(hit, p.x, p.y)) continue;
            const hr = hit.getBoundingClientRect();
            // Captions, badges and controls placed on top of media are deliberate overlays.
            if (s.c.kind === 'media' && hr.left >= r.left - 2 && hr.right <= r.right + 2 && hr.top >= r.top - 2 && hr.bottom <= r.bottom + 2) break;
            let layer: Element = hit;
            for (let a: Element | null = hit; a && a !== document.body; a = a.parentElement) {
              const pos = getComputedStyle(a).position;
              if (pos === 'fixed' || pos === 'sticky') layer = a;
            }
            const d = describe(layer);
            reason = `el:${d.id}`;
            obstructors.set(reason, d);
            break;
          }
        }
        evaluated++;
        if (!reason) {
          ps.seen = true;
          return;
        }
        if (reason === 'off_page' || reason === 'off_screen' || reason === 'unsafe_area') obstructors.set(reason, { id: null, selector: reason, name: null, position: '' });
        ps.by.set(reason, (ps.by.get(reason) ?? 0) + 1);
        blocked++;
        blockedBy.set(reason, (blockedBy.get(reason) ?? 0) + 1);
      });
      if (pinned && evaluated && blocked / pts.length > s.pinnedWorst) {
        s.pinnedWorst = blocked / pts.length;
        s.pinnedBy = blockedBy;
        s.pinnedAt = sy;
      }
    }
  }

  go(startY);
  force.remove();
  for (const el of inert) el.setAttribute('inert', '');

  const records: OcclusionRecord[] = [];
  for (const s of state) {
    if (!s.pts.length) continue;
    const never = s.pts.filter((p) => !p.seen && p.by.size > 0);
    const scrollingFraction = never.length / s.pts.length;
    const worst = Math.max(scrollingFraction, s.pinnedWorst);
    if (worst <= 0) continue;
    const tally = new Map<string, number>();
    const source = s.pinnedWorst >= scrollingFraction ? [...s.pinnedBy.entries()] : never.flatMap((p) => [...p.by.entries()]);
    for (const [k, v] of source) tally.set(k, (tally.get(k) ?? 0) + v);
    const by = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => obstructors.get(k)!);
    records.push({
      id: window.__djId(s.c.el),
      kind: s.c.kind,
      pinned: s.pinnedWorst >= scrollingFraction,
      hiddenFraction: Math.round(worst * 100) / 100,
      by,
      scrollY: s.pinnedWorst >= scrollingFraction ? s.pinnedAt : -1,
      element: describe(s.c.el),
    });
  }
  return {
    positions,
    candidates: cands.length,
    topLayers: topLayers.map((t) => describe(t)),
    unsafeArea: cover && insets ? insets : null,
    records,
  };
}

window.__djSnapshot = snapshot;
window.__djBackgroundSizes = backgroundSizes;
window.__djFontSamples = fontSamples;
window.__djSignature = signature;
window.__djScrollThrough = scrollThrough;
window.__djOcclusion = occlusion;
