// Hover probe: content the page's :hover rules show (a card's actions, a menu, a caption), tried
// with the pointer on its host at desktop, then with keyboard focus instead, then on the phone
// layout without hovering and with a tap. Nothing here judges the outcome; the Visual System
// diagnostics decide what fails.

import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { VIEWPORTS, type FixtureName } from '../config.ts';
import { writeJson } from '../util.ts';
import { newContext, preparePage, type Injection } from './collect.ts';
import { HOVER_FILE } from './probeStore.ts';
import type { HoverProbe, HoverReveal } from './probeTypes.ts';
import { quiesce } from './settle.ts';

const MAX_TRIED = 12;

const HOVER_FNS = `(() => {
  const path = (el) => {
    const parts = [];
    for (let cur = el; cur && cur !== document.body && cur.parentElement; cur = cur.parentElement) {
      parts.unshift(cur.tagName.toLowerCase() + ':nth-child(' + ([...cur.parentElement.children].indexOf(cur) + 1) + ')');
    }
    return 'body > ' + parts.join(' > ');
  };
  const find = (p) => { try { return document.querySelector(p); } catch { return null; } };
  const text = (e) => (e.innerText || e.textContent || '').replace(/\\s+/g, ' ').trim();
  const CONTROL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=menuitem], [tabindex]:not([tabindex="-1"])';
  const opacity = (e) => { let o = 1; for (let a = e; a && a.nodeType === 1; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity); return o; };
  const shown = (e) => {
    if (!e || !e.isConnected || !e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = e.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2 && opacity(e) >= 0.5;
  };
  const sig = (e) => e.tagName + '.' + [...e.classList].sort().join('.') + '<' + (e.parentElement ? e.parentElement.tagName + '.' + [...e.parentElement.classList].sort().join('.') : '');
  const rectOf = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  // The selectors of :hover rules that change whether something shows, as (host, target) pairs:
  // the compound carrying :hover is the host; the whole selector without :hover is the target.
  const hoverRules = () => {
    const out = [];
    const SHOWS = ['opacity', 'visibility', 'display', 'max-height', 'clip-path', 'transform', 'height'];
    const walk = (rules) => {
      for (const r of rules) {
        if (r.cssRules && r.media && r.media.mediaText && !matchMedia(r.media.mediaText).matches) continue;
        if (r.selectorText && r.selectorText.includes(':hover') && SHOWS.some((p) => r.style.getPropertyValue(p))) {
          for (const sel of r.selectorText.split(',')) {
            const i = sel.indexOf(':hover');
            if (i < 0) continue;
            let end = i;
            for (let depth = 0; end < sel.length; end++) {
              const ch = sel[end];
              if (ch === '(' || ch === '[') depth++;
              else if (ch === ')' || ch === ']') depth--;
              else if (depth === 0 && /[\\s>+~]/.test(ch)) break;
            }
            const host = sel.slice(0, end).replace(/:hover/g, '').trim();
            const target = sel.replace(/:hover/g, '').trim();
            if (host && target && host !== target) out.push({ host, target });
          }
        }
        if (r.cssRules) walk(r.cssRules);
      }
    };
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch {} }
    return out;
  };

  const candidates = () => {
    const seen = new Map();
    for (const { host, target } of hoverRules()) {
      let targets = [];
      try { targets = [...document.querySelectorAll(target)]; } catch { continue; }
      for (const t of targets) {
        if (shown(t) || t.closest('[hidden], [aria-hidden="true"], [inert], dialog:not([open]), template, [data-dj-sentinel]')) continue;
        const h = (() => { try { return t.parentElement && t.parentElement.closest(host); } catch { return null; } })();
        if (!h || !shown(h)) continue;
        const words = text(t);
        const controls = [...(t.matches(CONTROL) ? [t] : []), ...t.querySelectorAll(CONTROL)];
        if (!words && !controls.length) continue;
        const key = sig(h) + '|' + sig(t);
        const entry = seen.get(key);
        if (entry) { entry.members++; continue; }
        seen.set(key, { host: path(h), target: path(t), members: 1 });
      }
    }
    return [...seen.values()];
  };

  const settle = () => { for (const a of document.getAnimations()) { try { if (a.effect && a.effect.getComputedTiming().iterations !== Infinity) a.finish(); } catch {} } };
  const center = (p) => { const e = find(p); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); const r = e.getBoundingClientRect(); return [Math.round(r.x + Math.min(r.width / 2, 40)), Math.round(r.y + Math.min(r.height / 2, 20))]; };
  const isShown = (p) => { settle(); return shown(find(p)); };
  const describe = (hostPath, targetPath) => {
    const h = find(hostPath), t = find(targetPath);
    if (!h || !t) return null;
    const controls = [...(t.matches(CONTROL) ? [t] : []), ...t.querySelectorAll(CONTROL)].filter(shown).map((c) => (c.getAttribute('aria-label') || text(c)).slice(0, 40)).filter(Boolean);
    const names = [h.getAttribute('aria-label'), h.getAttribute('title'), ...[...h.querySelectorAll('[aria-label], [title]')].map((e) => e.getAttribute('aria-label') || e.getAttribute('title'))].filter(Boolean).map((s) => s.replace(/\\s+/g, ' ').trim().toLowerCase());
    const words = text(t).slice(0, 120);
    // The host's name as it reads without the revealed content.
    const own = h.getAttribute('aria-label') || (h.querySelector('h1, h2, h3, h4, h5, h6') && text(h.querySelector('h1, h2, h3, h4, h5, h6'))) || text(h).replace(text(t), '').replace(/\\s+/g, ' ').trim();
    return {
      host: { selector: window.__djDescribe(h).selector, name: own ? own.slice(0, 60) : null, rect: rectOf(h) },
      revealed: { selector: window.__djDescribe(t).selector, text: words, controls: controls.slice(0, 4), rect: rectOf(t) },
      repeatsName: !controls.length && !!words && names.includes(words.toLowerCase()),
    };
  };
  // Keyboard focus on the host, or on the first control inside it.
  const focusShows = (hostPath, targetPath) => {
    const h = find(hostPath), t = find(targetPath);
    if (!h || !t) return false;
    const tries = [h.matches(CONTROL) ? h : null, ...h.querySelectorAll(CONTROL)].filter(Boolean).slice(0, 3);
    for (const f of tries) {
      f.focus({ preventScroll: true });
      if (document.activeElement !== f) continue;
      settle();
      if (shown(t)) { f.blur(); return true; }
      f.blur();
    }
    return false;
  };
  const tapPoint = (hostPath) => {
    const h = find(hostPath);
    if (!h) return null;
    h.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const r = h.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.5], [0.15, 0.15], [0.85, 0.85], [0.15, 0.85], [0.85, 0.15]]) {
      const x = r.x + r.width * fx, y = r.y + r.height * fy;
      const at = document.elementFromPoint(x, y);
      if (at && h.contains(at) && !at.closest(CONTROL + ', label')) return [Math.round(x), Math.round(y)];
    }
    return null;
  };

  window.__djHover = { candidates, center, isShown, describe, focusShows, tapPoint };
})()`;

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  await quiesce(page, 'load');
  await page.evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`);
  await quiesce(page, 'brief');
}

const js = (fn: string, ...args: unknown[]) => `window.__djHover.${fn}(${args.map((a) => JSON.stringify(a)).join(', ')})`;

export async function collectHover(browser: Browser, url: string, fixture: FixtureName | null, bundleDir: string, inject?: Injection): Promise<HoverProbe> {
  const vp = VIEWPORTS.desktop;
  const out: HoverProbe = { version: 1, viewport: { width: vp.width, height: vp.height }, tried: 0, found: 0, reveals: [] };
  const found: (HoverReveal & { hostPath: string; targetPath: string })[] = [];
  const ctx = await newContext(browser, vp);
  try {
    const page = await preparePage(ctx, fixture, inject);
    await page.addInitScript({ content: HOVER_FNS });
    page.on('dialog', (d) => void d.dismiss().catch(() => {}));
    ctx.on('page', (p) => {
      if (p !== page) void p.close();
    });
    await load(page, url);
    const cands = (await page.evaluate(js('candidates'))) as { host: string; target: string; members: number }[];
    out.found = cands.length;
    for (const c of cands.slice(0, MAX_TRIED)) {
      out.tried++;
      const at = (await page.evaluate(js('center', c.host))) as [number, number] | null;
      if (!at) continue;
      await page.mouse.move(at[0], at[1]);
      await quiesce(page, 'brief');
      const revealed = (await page.evaluate(js('isShown', c.target))) as boolean;
      if (revealed) {
        const d = (await page.evaluate(js('describe', c.host, c.target))) as Pick<HoverReveal, 'host' | 'revealed' | 'repeatsName'> | null;
        await page.mouse.move(vp.width - 1, vp.height - 1);
        await quiesce(page, 'brief');
        // Content that stays once shown is not hover-only.
        const stays = (await page.evaluate(js('isShown', c.target))) as boolean;
        if (d && !stays) {
          await page.keyboard.press('Shift');
          const focus = (await page.evaluate(js('focusShows', c.host, c.target))) as boolean;
          found.push({ ...d, members: c.members, focus, touch: null, hostPath: c.host, targetPath: c.target });
        }
      }
      await page.mouse.move(vp.width - 1, vp.height - 1);
      await quiesce(page, 'brief');
    }
  } catch (err) {
    out.error = String((err as Error).message).split('\n')[0].slice(0, 200);
  } finally {
    await ctx.close();
  }
  // The phone layout, for the content focus does not show.
  const phone = VIEWPORTS.mobile;
  const pending = found.filter((f) => !f.focus && !f.repeatsName);
  if (pending.length && !out.error) {
    const mctx = await newContext(browser, phone);
    try {
      const page = await preparePage(mctx, fixture, inject);
      await page.addInitScript({ content: HOVER_FNS });
      page.on('dialog', (d) => void d.dismiss().catch(() => {}));
      mctx.on('page', (p) => {
        if (p !== page) void p.close();
      });
      for (const f of pending) {
        await load(page, url);
        const there = (await page.evaluate(`!!document.querySelector(${JSON.stringify(f.targetPath)}) && !!document.querySelector(${JSON.stringify(f.hostPath)})`)) as boolean;
        if (!there) continue;
        if ((await page.evaluate(js('isShown', f.targetPath))) as boolean) {
          f.touch = 'shown';
          continue;
        }
        const pt = (await page.evaluate(js('tapPoint', f.hostPath))) as [number, number] | null;
        f.touch = 'no';
        if (!pt) continue;
        const before = page.url();
        await page.touchscreen.tap(pt[0], pt[1]);
        await quiesce(page, 'action');
        if (page.url() === before && ((await page.evaluate(js('isShown', f.targetPath))) as boolean)) f.touch = 'tap';
      }
    } catch (err) {
      out.error = String((err as Error).message).split('\n')[0].slice(0, 200);
    } finally {
      await mctx.close();
    }
  }
  out.reveals = found.map(({ hostPath: _h, targetPath: _t, ...r }) => r);
  writeJson(path.join(bundleDir, HOVER_FILE), out);
  return out;
}
