// Visual System evidence: one example of each kind of control on the page, captured in each of
// its states (default, hover, keyboard focus, pressed, selected) and laid out as one sheet, plus
// colour-blind and greyscale views of the sheet and of the first screen.
//
// Controls are found and grouped from the rendered page (role and computed style), so nothing
// depends on how the interface was built. Hover is a real pointer hover, so it also catches hover
// styles applied by script; focus is real keyboard-style focus; pressed is forced through the
// devtools protocol, so nothing is clicked. Selected is reached by clicking the control on a
// freshly loaded page.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Browser, CDPSession, Page } from 'playwright';
import { chromium } from 'playwright';
import { QUIESCE, VIEWPORTS, type FixtureName, type ViewportSpec } from '../config.ts';
import { caseDir, loadCase } from '../cases.ts';
import { bundleDir as bundlePath, loadBundle } from '../store.ts';
import { ensureDir, log, pngSize, writeJson } from '../util.ts';
import { newContext, openCaseTarget, preparePage, type Injection } from './collect.ts';
import { quiesce } from './settle.ts';
import { callLogReason, pointerBlocked } from './steps.ts';

export type ControlState = 'default' | 'hover' | 'focus' | 'pressed' | 'selected';
export type VisionView = 'deuteranopia' | 'achromatopsia';

export const STATE_LABEL: Record<ControlState, string> = {
  default: 'Default',
  hover: 'Hover',
  focus: 'Keyboard focus',
  pressed: 'Pressed',
  selected: 'Selected',
};
export const VISION_LABEL: Record<VisionView, string> = {
  deuteranopia: 'Red-green colour blindness (deuteranopia)',
  achromatopsia: 'Greyscale (no colour vision)',
};

export interface VisualImage {
  path: string; // relative to the bundle folder
  width: number;
  height: number;
  scale: number; // image pixels per CSS pixel
}

export interface StateCell {
  state: ControlState;
  image: VisualImage | null;
  // Computed-style differences from the default state, e.g. "background #2563eb → #1d4ed8".
  changes: string[];
  // Pixels that differ from the default capture (null when there is nothing to compare).
  changedPixels: number | null;
  note?: string;
}

export interface ControlGroup {
  id: string;
  kind: string;
  label: string;
  // The state the control was in when the page loaded.
  loadState: 'normal' | 'disabled' | 'selected' | 'invalid';
  count: number;
  others: string[];
  selector: string;
  cells: StateCell[];
}

export interface VisualViewport {
  viewport: 'desktop' | 'mobile';
  width: number;
  height: number;
  touch: boolean;
  controlsFound: number;
  groups: ControlGroup[];
  omittedGroups: number;
  sheet: VisualImage | null;
  sheetViews: Partial<Record<VisionView, VisualImage>>;
  screen: VisualImage | null;
  screenViews: Partial<Record<VisionView, VisualImage>>;
  error?: string;
}

export interface VisualCapture {
  version: 1;
  createdAt: string;
  fixture: FixtureName | null;
  viewports: VisualViewport[];
}

export const VISUAL_FILE = path.join('visual', 'visual.json');

const MAX_GROUPS = 16;
const PAD = 12;
const MAX_CROP = { w: 420, h: 280 };
const VISIONS: VisionView[] = ['deuteranopia', 'achromatopsia'];

interface FoundControl {
  target: string; // what receives focus and state
  visual: string; // what people see (a custom checkbox's label, otherwise the control itself)
  crop: string; // what the picture shows: a checkbox or radio button together with its label
  kind: string;
  loadState: ControlGroup['loadState'];
  toggle: boolean;
  name: string;
  signature: string;
}

const FIND_SCRIPT = `(() => {
  const path = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && cur.parentElement) {
      const p = cur.parentElement;
      parts.unshift(cur.tagName.toLowerCase() + ':nth-child(' + ([...p.children].indexOf(cur) + 1) + ')');
      cur = p;
    }
    return 'body > ' + parts.join(' > ');
  };
  const QUERY = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=option], [role=menuitem], [role=combobox], [role=slider], [tabindex]:not([tabindex="-1"])';
  const ROLE_KIND = { button: 'button', link: 'link', tab: 'tab', switch: 'switch', checkbox: 'checkbox', radio: 'radio', option: 'option', menuitem: 'menu item', combobox: 'dropdown', slider: 'slider' };
  const visible = (el) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  };
  const hiddenTree = (el) => !!el.closest('[inert], [aria-hidden="true"]');
  const kindOf = (el, pointerOnly) => {
    const role = el.getAttribute('role');
    if (role && ROLE_KIND[role]) return ROLE_KIND[role];
    const tag = el.tagName;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (tag === 'BUTTON') return 'button';
    if (tag === 'A') return 'link';
    if (tag === 'SELECT') return 'dropdown';
    if (tag === 'TEXTAREA') return 'text field';
    if (tag === 'SUMMARY') return 'disclosure';
    if (tag === 'INPUT') {
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'range') return 'slider';
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (['date', 'time', 'datetime-local', 'month', 'week'].includes(type)) return 'date field';
      if (type === 'file') return 'file picker';
      if (type === 'color') return 'colour picker';
      return 'text field';
    }
    return pointerOnly ? 'clickable element without a control role' : 'focusable element';
  };
  const loadStateOf = (el) => {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('fieldset:disabled')) return 'disabled';
    if (el.getAttribute('aria-invalid') === 'true') return 'invalid';
    if (el.checked || ['aria-selected', 'aria-pressed', 'aria-checked'].some((a) => el.getAttribute(a) === 'true')) return 'selected';
    const current = el.getAttribute('aria-current');
    if (current && current !== 'false') return 'selected';
    return 'normal';
  };
  const isToggle = (el, kind) =>
    ['checkbox', 'radio', 'switch', 'tab', 'option'].includes(kind) || el.hasAttribute('aria-pressed') || el.hasAttribute('aria-selected');
  const nameOf = (el, visual) =>
    (el.getAttribute('aria-label') || visual.innerText || (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('placeholder') || el.value || el.getAttribute('title') || '')
      .replace(/\\s+/g, ' ').trim().slice(0, 50);
  const signatureOf = (kind, loadState, el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return [
      kind, loadState, cs.backgroundColor, cs.backgroundImage === 'none' ? '' : cs.backgroundImage.slice(0, 80), cs.color,
      cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor, cs.borderBottomWidth, cs.borderBottomColor,
      cs.borderTopLeftRadius, cs.fontSize, cs.fontWeight, cs.fontFamily.split(',')[0], cs.boxShadow,
      cs.textTransform, cs.textDecorationLine, Math.round(r.height / 4),
    ].join('|');
  };
  const out = [];
  const seen = new Set();
  const add = (target, visual, pointerOnly) => {
    if (seen.has(visual) || seen.has(target)) return;
    seen.add(visual);
    seen.add(target);
    const kind = kindOf(target, pointerOnly);
    const loadState = loadStateOf(target);
    const label = (kind === 'checkbox' || kind === 'radio') && visual === target && target.labels ? [...target.labels].find(visible) : null;
    if (label) seen.add(label);
    out.push({ target: path(target), visual: path(visual), crop: path(label || visual), kind, loadState, toggle: isToggle(target, kind), name: nameOf(target, visual), signature: signatureOf(kind, loadState, visual) });
  };
  for (const el of document.querySelectorAll(QUERY)) {
    if (hiddenTree(el)) continue;
    let visual = el;
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio') && !visible(el)) {
      const label = el.labels && [...el.labels].find(visible);
      if (!label) continue;
      visual = label;
    } else if (!visible(el)) continue;
    add(el, visual, false);
  }
  for (const el of document.querySelectorAll('body *')) {
    if (seen.has(el) || el.tagName === 'LABEL') continue;
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    const parent = el.parentElement;
    if (parent && getComputedStyle(parent).cursor === 'pointer') continue;
    if (el.closest(QUERY) || el.querySelector(QUERY)) continue;
    if (!visible(el) || hiddenTree(el)) continue;
    add(el, el, true);
  }
  return out;
})()`;

export const STYLE_FN = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const border = (side) => cs['border' + side + 'Width'] === '0px' || cs['border' + side + 'Style'] === 'none' ? 'none' : cs['border' + side + 'Width'] + ' ' + cs['border' + side + 'Style'] + ' ' + cs['border' + side + 'Color'];
  return {
    background: cs.backgroundColor,
    'background image': cs.backgroundImage === 'none' ? 'none' : cs.backgroundImage.slice(0, 60),
    text: cs.color,
    border: border('Top'),
    'bottom border': border('Bottom'),
    outline: cs.outlineStyle === 'none' || cs.outlineWidth === '0px' ? 'none' : cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + cs.outlineColor + (cs.outlineOffset !== '0px' ? ' offset ' + cs.outlineOffset : ''),
    shadow: cs.boxShadow,
    underline: cs.textDecorationLine,
    weight: cs.fontWeight,
    opacity: cs.opacity,
    transform: cs.transform,
  };
}`;

const hex = (v: string) =>
  v.replace(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/g, (_m, r, g, b, a) => {
    const h = '#' + [r, g, b].map((n: string) => Number(n).toString(16).padStart(2, '0')).join('');
    return a !== undefined && Number(a) < 1 ? `${h} at ${Math.round(Number(a) * 100)}%` : h;
  });

export function styleChanges(before: Record<string, string> | null, after: Record<string, string> | null): string[] {
  if (!before || !after) return [];
  return Object.keys(before)
    .filter((k) => before[k] !== after[k])
    .map((k) => `${k}: ${hex(before[k])} → ${hex(after[k])}`);
}

export async function changedPixels(a: Buffer, b: Buffer): Promise<number | null> {
  const [ra, rb] = await Promise.all([sharp(a).raw().toBuffer({ resolveWithObject: true }), sharp(b).raw().toBuffer({ resolveWithObject: true })]);
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height || ra.info.channels !== rb.info.channels) return null;
  const ch = ra.info.channels;
  let n = 0;
  for (let i = 0; i < ra.data.length; i += ch) {
    if (Math.abs(ra.data[i] - rb.data[i]) > 8 || Math.abs(ra.data[i + 1] - rb.data[i + 1]) > 8 || Math.abs(ra.data[i + 2] - rb.data[i + 2]) > 8) n++;
  }
  return n;
}

async function forcePseudo(cdp: CDPSession, selector: string, classes: string[]): Promise<() => Promise<void>> {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return async () => {};
  await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: classes });
  return async () => void (await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }).catch(() => {}));
}

async function setVision(cdp: CDPSession, type: VisionView | 'none') {
  await cdp.send('Emulation.setEmulatedVisionDeficiency', { type });
}

class Capturer {
  constructor(
    private page: Page,
    private vp: ViewportSpec,
    private outDir: string,
    private bundleDir: string,
  ) {}

  async save(name: string, buf: Buffer): Promise<VisualImage> {
    const file = path.join(this.outDir, `${name}.png`);
    fs.writeFileSync(file, buf);
    const { width, height } = pngSize(buf);
    return { path: path.relative(this.bundleDir, file), width, height, scale: this.vp.deviceScaleFactor };
  }

  // Scrolls the control to the middle of the screen and returns the padded box around it and
  // its label.
  async clipFor(control: FoundControl) {
    const r = (await this.page.evaluate(`(() => {
      const els = [${JSON.stringify(control.visual)}, ${JSON.stringify(control.crop)}].map((s) => document.querySelector(s)).filter(Boolean);
      if (!els.length) return null;
      els[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const rs = els.map((el) => el.getBoundingClientRect());
      const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
      return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y };
    })()`)) as { x: number; y: number; w: number; h: number } | null;
    if (!r) return null;
    const x = Math.max(0, Math.floor(r.x - PAD));
    const y = Math.max(0, Math.floor(r.y - PAD));
    return {
      x,
      y,
      width: Math.max(1, Math.min(Math.ceil(r.w + 2 * PAD), MAX_CROP.w, this.vp.width - x)),
      height: Math.max(1, Math.min(Math.ceil(r.h + 2 * PAD), MAX_CROP.h, this.vp.height - y)),
    };
  }

  async crop(clip: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
    return this.page.screenshot({ clip, animations: 'disabled', caret: 'hide', scale: 'device' });
  }

  style(selector: string) {
    return this.page.evaluate(`(${STYLE_FN})(${JSON.stringify(selector)})`) as Promise<Record<string, string> | null>;
  }

  // Moves the pointer to a corner away from the control and clears focus.
  async neutral(clip: { x: number; y: number; width: number; height: number }) {
    const farRight = clip.x + clip.width < this.vp.width - 4 || clip.y + clip.height < this.vp.height - 4;
    await this.page.mouse.move(farRight ? this.vp.width - 2 : 2, farRight ? this.vp.height - 2 : 2);
    await this.page.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur()');
  }
}

async function captureViewport(
  browser: Browser,
  url: string,
  origin: string,
  vpId: 'desktop' | 'mobile',
  fixture: FixtureName | null,
  bundleDir: string,
  inject?: Injection,
): Promise<VisualViewport> {
  const vp = VIEWPORTS[vpId];
  const outDir = ensureDir(path.join(bundleDir, 'visual', vpId));
  const result: VisualViewport = {
    viewport: vpId,
    width: vp.width,
    height: vp.height,
    touch: vp.hasTouch,
    controlsFound: 0,
    groups: [],
    omittedGroups: 0,
    sheet: null,
    sheetViews: {},
    screen: null,
    screenViews: {},
  };
  const ctx = await newContext(browser, vp);
  try {
    const page = await preparePage(ctx, fixture, inject);
    ctx.on('page', (p) => {
      if (p !== page) void p.close();
    });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const reset = async () => {
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      await quiesce(page, 'load');
      await page.evaluate('window.__djScrollThrough()');
      await quiesce(page, 'action');
      await page.evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`);
      await quiesce(page, 'brief');
    };
    const cap = new Capturer(page, vp, outDir, bundleDir);
    await reset();

    const shot = () => page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'device' });
    result.screen = await cap.save('screen', await shot());
    for (const v of VISIONS) {
      await setVision(cdp, v);
      result.screenViews[v] = await cap.save(`screen-${v}`, await shot());
    }
    await setVision(cdp, 'none');

    const found = (await page.evaluate(FIND_SCRIPT)) as FoundControl[];
    result.controlsFound = found.length;
    const bySig = new Map<string, FoundControl[]>();
    for (const c of found) bySig.set(c.signature, [...(bySig.get(c.signature) ?? []), c]);
    const all = [...bySig.values()];
    result.omittedGroups = Math.max(0, all.length - MAX_GROUPS);

    const toSelect: { group: ControlGroup; control: FoundControl; defaultBuf: Buffer; defaultStyle: Record<string, string> | null }[] = [];
    for (const [i, members] of all.slice(0, MAX_GROUPS).entries()) {
      const c = members[0];
      const group: ControlGroup = {
        id: `${vpId === 'desktop' ? 'D' : 'M'}${i + 1}`,
        kind: c.kind,
        label: c.name,
        loadState: c.loadState,
        count: members.length,
        others: [...new Set(members.slice(1).map((m) => m.name).filter((n) => n && n !== c.name))].slice(0, 4),
        selector: c.visual,
        cells: [],
      };
      result.groups.push(group);
      const clip = await cap.clipFor(c);
      if (!clip) {
        group.cells.push({ state: 'default', image: null, changes: [], changedPixels: null, note: 'The control was no longer on the page.' });
        continue;
      }
      await cap.neutral(clip);
      await quiesce(page, 'brief');
      const defaultBuf = await cap.crop(clip);
      const defaultStyle = await cap.style(c.visual);
      group.cells.push({ state: 'default', image: await cap.save(`${group.id}-default`, defaultBuf), changes: [], changedPixels: null });
      const compare = async (state: ControlState, buf: Buffer, style: Record<string, string> | null, note?: string): Promise<StateCell> => ({
        state,
        image: await cap.save(`${group.id}-${state}`, buf),
        changes: styleChanges(defaultStyle, style),
        changedPixels: await changedPixels(defaultBuf, buf),
        ...(note ? { note } : {}),
      });

      if (vp.hasTouch) {
        group.cells.push({ state: 'hover', image: null, changes: [], changedPixels: null, note: 'Touch screen: there is no hover.' });
      } else if (c.loadState === 'disabled') {
        group.cells.push({ state: 'hover', image: null, changes: [], changedPixels: null, note: 'Disabled.' });
      } else {
        try {
          const blocked = await pointerBlocked(page, c.visual);
          if (blocked) throw new Error(blocked);
          await page.locator(c.visual).first().hover({ timeout: QUIESCE.actionTimeoutMs });
          await quiesce(page, 'brief');
          group.cells.push(await compare('hover', await cap.crop(clip), await cap.style(c.visual)));
        } catch (err) {
          group.cells.push({ state: 'hover', image: null, changes: [], changedPixels: null, note: `Couldn't hover: ${callLogReason(err)}` });
        }
        await cap.neutral(clip);
      }

      const focused = (await page.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(c.target)});
        if (!el) return false;
        el.focus({ preventScroll: true });
        return document.activeElement === el;
      })()`)) as boolean;
      if (!focused) {
        group.cells.push({
          state: 'focus',
          image: null,
          changes: [],
          changedPixels: null,
          note: c.loadState === 'disabled' ? 'Disabled.' : 'It does not take keyboard focus, so it cannot be reached with the keyboard.',
        });
      } else {
        const clear = await forcePseudo(cdp, c.target, ['focus', 'focus-visible']);
        await quiesce(page, 'brief');
        group.cells.push(await compare('focus', await cap.crop(clip), await cap.style(c.visual)));
        await clear();
      }
      await cap.neutral(clip);

      if (c.loadState === 'disabled') {
        group.cells.push({ state: 'pressed', image: null, changes: [], changedPixels: null, note: 'Disabled.' });
      } else {
        const clear = await forcePseudo(cdp, c.visual, vp.hasTouch ? ['active'] : ['active', 'hover']);
        await quiesce(page, 'brief');
        group.cells.push(await compare('pressed', await cap.crop(clip), await cap.style(c.visual)));
        await clear();
      }

      if (c.toggle && c.loadState === 'normal') toSelect.push({ group, control: c, defaultBuf, defaultStyle });
      else
        group.cells.push({
          state: 'selected',
          image: null,
          changes: [],
          changedPixels: null,
          note: c.loadState === 'selected' ? 'Already selected when the page loaded.' : c.toggle ? 'Disabled.' : 'Not selectable.',
        });
    }

    // Selecting changes the page, so each one starts from a fresh load.
    for (const { group, control, defaultBuf, defaultStyle } of toSelect) {
      try {
        await reset();
        const before = page.url();
        const blocked = await pointerBlocked(page, control.visual);
        if (blocked) throw new Error(blocked);
        await page.locator(control.visual).first().click({ timeout: QUIESCE.actionTimeoutMs });
        await quiesce(page, 'action');
        if (page.url().split('#')[0] !== before.split('#')[0]) {
          group.cells.push({ state: 'selected', image: null, changes: [], changedPixels: null, note: 'Clicking it left the page.' });
          continue;
        }
        const clip = await cap.clipFor(control);
        if (!clip) throw new Error('the control disappeared after it was clicked');
        await cap.neutral(clip);
        await quiesce(page, 'brief');
        const buf = await cap.crop(clip);
        group.cells.push({
          state: 'selected',
          image: await cap.save(`${group.id}-selected`, buf),
          changes: styleChanges(defaultStyle, await cap.style(control.visual)),
          changedPixels: await changedPixels(defaultBuf, buf),
        });
      } catch (err) {
        group.cells.push({ state: 'selected', image: null, changes: [], changedPixels: null, note: `Couldn't select it: ${callLogReason(err)}` });
      }
    }
    await renderSheets(browser, result, vp, cap);
  } catch (err) {
    result.error = firstLine(err);
  } finally {
    await ctx.close();
  }
  return result;
}

function firstLine(err: unknown): string {
  return String((err as Error).message ?? err).split('\n')[0].slice(0, 200);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// A state that should look different but doesn't.
export function looksUnchanged(cell: StateCell): boolean {
  return cell.state !== 'default' && cell.changedPixels !== null && cell.changedPixels <= 2;
}

function sheetHtml(result: VisualViewport, bundleDir: string): string {
  const states: ControlState[] = ['default', 'hover', 'focus', 'pressed', 'selected'];
  const img = (im: VisualImage) =>
    `<img src="data:image/png;base64,${fs.readFileSync(path.join(bundleDir, im.path)).toString('base64')}" style="width:${Math.round(im.width / im.scale)}px">`;
  const cell = (g: ControlGroup, s: ControlState) => {
    const c = g.cells.find((x) => x.state === s);
    if (!c) return '<td class="none">—</td>';
    if (!c.image) return `<td class="none">${esc(c.note ?? '—')}</td>`;
    const flat = looksUnchanged(c);
    const lines = s === 'default' ? [] : flat ? ['No visible change'] : c.changes.slice(0, 3);
    return `<td class="${flat ? 'flat' : ''}">${img(c.image)}${lines.map((l) => `<div class="cap">${esc(l)}</div>`).join('')}${c.note ? `<div class="cap">${esc(c.note)}</div>` : ''}</td>`;
  };
  const rows = result.groups
    .map((g) => {
      const load = g.loadState === 'normal' ? '' : ` <span class="tag">${g.loadState} at load</span>`;
      const more = g.count > 1 ? `<div class="sub">${g.count} on the page${g.others.length ? `, also ${g.others.slice(0, 3).map((o) => `“${esc(clip(o, 20))}”`).join(', ')}` : ''}</div>` : '';
      return `<tr><th><b>${g.id}</b> ${esc(g.kind)}${load}<div class="name">${g.label ? `“${esc(clip(g.label, 32))}”` : '(no text)'}</div>${more}</th>${states.map((s) => cell(g, s)).join('')}</tr>`;
    })
    .join('');
  const vpLabel = result.viewport === 'desktop' ? `Desktop ${result.width}×${result.height}` : `Mobile ${result.width}×${result.height}, touch`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font: 13px/1.35 -apple-system, system-ui, sans-serif; color: #111; margin: 16px; background: #fff; }
    h1 { font-size: 16px; margin: 0 0 4px; }
    p { margin: 0 0 12px; color: #555; }
    table { border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 8px; vertical-align: top; text-align: left; }
    thead th { background: #f5f5f5; font-weight: 600; }
    tbody th { font-weight: 400; width: 170px; max-width: 170px; }
    td { max-width: 300px; background: repeating-conic-gradient(#fafafa 0 25%, #fff 0 50%) 0 0 / 12px 12px; }
    td img { display: block; max-width: 300px; height: auto; border: 1px dashed #ccc; }
    td.none { color: #888; background: #fafafa; font-size: 12px; }
    td.flat { outline: 3px solid #d92d20; outline-offset: -3px; }
    .cap { font-size: 11px; color: #444; margin-top: 4px; overflow-wrap: anywhere; }
    td.flat .cap { color: #b42318; font-weight: 600; }
    .name { margin-top: 2px; overflow-wrap: anywhere; }
    .sub { font-size: 11px; color: #666; margin-top: 4px; overflow-wrap: anywhere; }
    .tag { font-size: 11px; background: #eef; border-radius: 4px; padding: 0 4px; }
  </style></head><body>
    <h1>Controls in each state · ${esc(vpLabel)}</h1>
    <p>One example of each kind of control, cut from the page. Red outline: no visible change from default.${result.omittedGroups ? ` ${result.omittedGroups} further kinds of control are not shown.` : ''}</p>
    <table><thead><tr><th>Control</th>${states.map((s) => `<th>${STATE_LABEL[s]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
}

async function renderSheets(browser: Browser, result: VisualViewport, vp: ViewportSpec, cap: Capturer) {
  if (!result.groups.length) return;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: vp.deviceScaleFactor });
  try {
    const page = await ctx.newPage();
    await page.setContent(sheetHtml(result, cap['bundleDir']), { waitUntil: 'load' });
    const cdp = await ctx.newCDPSession(page);
    const shot = () => page.screenshot({ fullPage: true, animations: 'disabled', scale: 'device' });
    result.sheet = await cap.save('sheet', await shot());
    for (const v of VISIONS) {
      await setVision(cdp, v);
      result.sheetViews[v] = await cap.save(`sheet-${v}`, await shot());
    }
  } finally {
    await ctx.close();
  }
}

export async function collectVisual(browser: Browser, url: string, origin: string, bundleDir: string, fixture: FixtureName | null, inject?: Injection): Promise<VisualCapture> {
  fs.rmSync(path.join(bundleDir, 'visual'), { recursive: true, force: true });
  const viewports = await Promise.all((['desktop', 'mobile'] as const).map((vp) => captureViewport(browser, url, origin, vp, fixture, bundleDir, inject)));
  const capture: VisualCapture = { version: 1, createdAt: new Date().toISOString(), fixture, viewports };
  writeJson(path.join(bundleDir, VISUAL_FILE), capture);
  return capture;
}

function newestFileMs(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name !== '.DS_Store') newest = Math.max(newest, fs.statSync(path.join(entry.parentPath, entry.name)).mtimeMs);
  }
  return newest;
}

// Adds the Visual System capture to a case's latest evidence, which must have been collected from
// the case's current files.
export async function collectVisualForCase(caseId: string): Promise<VisualCapture> {
  const bundle = loadBundle(caseId);
  const manifest = loadCase(caseId);
  const target = await openCaseTarget(manifest);
  try {
    // Evidence collected before display-only fields left the hash cannot match it, so the site's
    // file times are the fallback.
    const unchanged = target.inputsHash === bundle.inputsHash || (manifest.source.type === 'static' && newestFileMs(path.join(caseDir(caseId), manifest.source.dir)) < Date.parse(bundle.createdAt));
    if (!unchanged) throw new Error(`${caseId}: the interface has changed since its latest evidence was collected. Run: npm run collect -- ${caseId}`);
    const baseline = bundle.states.find((s) => s.id === 'desktop');
    const browser = await chromium.launch();
    try {
      const capture = await collectVisual(browser, target.url, target.origin, bundlePath(caseId, bundle.bundleId), baseline?.fixture ?? null);
      for (const v of capture.viewports) {
        const flat = v.groups.flatMap((g) => g.cells.filter(looksUnchanged).map((c) => `${g.id} ${STATE_LABEL[c.state].toLowerCase()}`));
        log(
          `  ${v.error ? '✗' : '✓'} ${caseId} ${v.viewport}: ${v.controlsFound} controls in ${v.groups.length + v.omittedGroups} kinds${v.omittedGroups ? ` (${v.groups.length} shown)` : ''}` +
            (flat.length ? `; no visible change: ${flat.join(', ')}` : '') +
            (v.error ? ` — ${v.error}` : ''),
        );
      }
      return capture;
    } finally {
      await browser.close();
    }
  } finally {
    await target.close();
  }
}
