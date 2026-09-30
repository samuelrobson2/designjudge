// Finds interactive states without hand-written steps: click each distinct control on a fresh
// page, measure how much the layout changed, and keep the most significant change.

import type { Page } from 'playwright';
import { waitForSettled } from './settle.ts';

export interface Candidate {
  selector: string;
  label: string;
  role: string;
  signature: string;
}

// [structural key, x, y, w, h, flag] for each visible element; flag marks dialogs, alerts,
// invalid fields, and fixed-position elements.
type LiteEl = [string, number, number, number, number, string];

export interface LiteSnapshot {
  url: string;
  height: number;
  vw: number;
  vh: number;
  els: LiteEl[];
}

export interface Change {
  appearedArea: number;
  disappearedArea: number;
  moved: number;
  overlays: number;
  dialogs: number;
  largestOverlayArea: number;
  alerts: number;
  heightChange: number;
  focusY: number | null;
  score: number;
  significant: boolean;
}

export interface Attempt {
  label: string;
  role: string;
  selector: string;
  outcome: 'changed' | 'no_change' | 'navigated' | 'not_clickable';
  score: number;
  description?: string;
}

export interface Discovered {
  candidate: Candidate;
  change: Change;
  description: string;
}

const MAX_CANDIDATES = 20;

const CANDIDATES_SCRIPT = `(() => {
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
  const query = 'button, summary, [role=button], [role=tab], [role=switch], [role=menuitem], [role=option], [role=checkbox], [role=radio], input[type=checkbox], input[type=radio], label, [aria-expanded], [aria-haspopup], tr[tabindex], a[href^="#"]';
  const out = [];
  const seen = new Set();
  const visible = (el) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  };
  for (const el of document.querySelectorAll(query)) {
    // A label is only a candidate when its checkbox or radio is visually hidden (custom styling).
    if (el.tagName === 'LABEL' && !(el.control && ['checkbox', 'radio'].includes(el.control.type) && !visible(el.control))) continue;
    if (el.tagName === 'A' && el.getAttribute('href') === '#') continue;
    if (!visible(el)) continue;
    if (el.closest('[inert], [aria-hidden="true"]')) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    const role = el.getAttribute('role') || (el.tagName === 'INPUT' ? el.type : el.tagName.toLowerCase());
    const label = (el.getAttribute('aria-label') || el.innerText || (el.labels && el.labels[0] && el.labels[0].innerText) || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
    const classes = [...el.classList].filter((c) => !/^(is-|has-)|active|selected|open|checked/.test(c)).sort().join('.');
    const signature = [el.tagName, role, classes, el.getAttribute('name') || ''].join('|');
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push({ selector: path(el), label, role, signature });
  }
  return out;
})()`;

// Structural keys survive re-renders: tag, id and stable classes, plus position among siblings
// with the same signature, so inserting one element does not re-key its siblings.
const LITE_SCRIPT = `(() => {
  const els = [];
  const walk = (el, key) => {
    const counts = new Map();
    for (const child of el.children) {
      if (!child.checkVisibility()) continue;
      const classes = [...child.classList].filter((c) => !/^(is-|has-)|active|selected|open|checked/.test(c)).sort().join('.');
      const sig = child.tagName.toLowerCase() + (child.id ? '#' + child.id : '') + (classes ? '.' + classes : '');
      const n = (counts.get(sig) || 0) + 1;
      counts.set(sig, n);
      const k = key + '>' + sig + '[' + n + ']';
      if (child.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
        const r = child.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const cs = getComputedStyle(child);
          const role = child.getAttribute('role');
          const flag = child.tagName === 'DIALOG' || role === 'dialog' || role === 'alertdialog' ? 'dialog'
            : role === 'alert' || child.getAttribute('aria-invalid') === 'true' ? 'alert'
            : cs.position === 'fixed' ? 'fixed' : '';
          els.push([k, Math.round(r.x + scrollX), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height), flag]);
        }
      }
      walk(child, k);
    }
  };
  walk(document.body, 'body');
  return { url: location.href, height: document.documentElement.scrollHeight, vw: innerWidth, vh: innerHeight, els };
})()`;

function outermost(list: LiteEl[]): LiteEl[] {
  const keys = new Set(list.map((e) => e[0]));
  return list.filter((e) => {
    let k = e[0];
    while (k.includes('>')) {
      k = k.slice(0, k.lastIndexOf('>'));
      if (keys.has(k)) return false;
    }
    return true;
  });
}

export function measureChange(before: LiteSnapshot, after: LiteSnapshot): Change {
  const b = new Map(before.els.map((e) => [e[0], e]));
  const a = new Map(after.els.map((e) => [e[0], e]));
  // Share of an element's width that is on screen horizontally (off-canvas panels sit outside).
  const onScreen = (e: LiteEl, vw: number) => (e[3] > 0 ? Math.max(0, Math.min(e[1] + e[3], vw) - Math.max(e[1], 0)) / e[3] : 0);
  const slidIn = after.els.filter((e) => b.has(e[0]) && onScreen(b.get(e[0])!, before.vw) < 0.1 && onScreen(e, after.vw) >= 0.5);
  const slidOut = before.els.filter((e) => a.has(e[0]) && onScreen(a.get(e[0])!, after.vw) < 0.1 && onScreen(e, before.vw) >= 0.5);
  const appeared = outermost([...after.els.filter((e) => !b.has(e[0])), ...slidIn]);
  const disappeared = outermost([...before.els.filter((e) => !a.has(e[0])), ...slidOut]);
  const area = (list: LiteEl[]) => list.reduce((s, e) => s + e[3] * e[4], 0);
  let moved = 0;
  let newAlerts = 0;
  for (const e of after.els) {
    const prev = b.get(e[0]);
    if (!prev) continue;
    if (Math.abs(prev[1] - e[1]) + Math.abs(prev[2] - e[2]) + Math.abs(prev[3] - e[3]) + Math.abs(prev[4] - e[4]) > 4) moved++;
    if (e[5] === 'alert' && prev[5] !== 'alert') newAlerts++;
  }
  const overlayEls = appeared.filter((e) => e[5] === 'dialog' || e[5] === 'fixed');
  const overlays = overlayEls.length;
  const dialogs = appeared.filter((e) => e[5] === 'dialog').length;
  const largestOverlayArea = Math.max(0, ...overlayEls.map((e) => e[3] * e[4]));
  const alerts = after.els.filter((e) => e[5] === 'alert' && !b.has(e[0])).length + newAlerts;
  const heightChange = after.height - before.height;
  const vpArea = Math.max(1, after.vw * after.vh);
  const appearedArea = area(appeared);
  const disappearedArea = area(disappeared);
  const inFlow = appeared.filter((e) => e[5] !== 'fixed' && e[5] !== 'dialog').sort((x, y) => y[3] * y[4] - x[3] * x[4]);
  const focusY = inFlow.length ? Math.min(...inFlow.slice(0, 3).map((e) => e[2])) : null;
  const score =
    Math.min(1, appearedArea / vpArea) +
    0.5 * Math.min(1, disappearedArea / vpArea) +
    (overlays ? 0.5 : 0) +
    0.1 * Math.min(alerts, 5) +
    0.2 * Math.min(moved, 100) / 100 +
    0.3 * Math.min(1, Math.abs(heightChange) / after.vh);
  const significant = appearedArea >= 0.02 * vpArea || overlays > 0 || alerts > 0 || Math.abs(heightChange) >= 100 || disappearedArea >= 0.05 * vpArea;
  return { appearedArea, disappearedArea, moved, overlays, dialogs, largestOverlayArea, alerts, heightChange, focusY, score: Math.round(score * 1000) / 1000, significant };
}

export function describeChange(c: Candidate, ch: Change, vpArea: number): string {
  const parts: string[] = [];
  if (ch.overlays) parts.push('a dialog or overlay appeared');
  if (ch.alerts) parts.push(`${ch.alerts} alert or validation element${ch.alerts > 1 ? 's' : ''} appeared`);
  const appearedPct = Math.round((ch.appearedArea / vpArea) * 100);
  if (appearedPct >= 2 && !ch.overlays) parts.push(`new content appeared (about ${appearedPct}% of the screen area)`);
  const removedPct = Math.round((ch.disappearedArea / vpArea) * 100);
  if (removedPct >= 5) parts.push(`content was removed (about ${removedPct}% of the screen area)`);
  if (Math.abs(ch.heightChange) >= 100) parts.push(`the page became ${Math.abs(ch.heightChange)} px ${ch.heightChange > 0 ? 'taller' : 'shorter'}`);
  if (ch.moved >= 10) parts.push(`${ch.moved} elements moved or resized`);
  const what = c.label ? `${c.role} "${c.label}"` : c.role;
  return `After clicking ${what}: ${parts.join('; ') || 'the layout changed'}`;
}

export async function lite(page: Page): Promise<LiteSnapshot> {
  return (await page.evaluate(LITE_SCRIPT)) as LiteSnapshot;
}

// Explores one page. `reset` must reload the page to its initial state.
// Returns the most significant changes, best first (at most `keep`).
export async function discoverOnPage(page: Page, reset: () => Promise<void>, keep = 3): Promise<{ picks: Discovered[]; attempts: Attempt[] }> {
  const candidates = ((await page.evaluate(CANDIDATES_SCRIPT)) as Candidate[]).slice(0, MAX_CANDIDATES);
  const attempts: Attempt[] = [];
  const found: Discovered[] = [];
  let base = await lite(page);
  for (const c of candidates) {
    const loc = page.locator(c.selector).first();
    try {
      await loc.click({ timeout: 2500 });
    } catch {
      try {
        await loc.dispatchEvent('click', undefined, { timeout: 1000 });
      } catch {
        attempts.push({ label: c.label, role: c.role, selector: c.selector, outcome: 'not_clickable', score: 0 });
        continue;
      }
    }
    await waitForSettled(page, null, true);
    const after = await lite(page);
    if (after.url.split('#')[0] !== base.url.split('#')[0]) {
      attempts.push({ label: c.label, role: c.role, selector: c.selector, outcome: 'navigated', score: 0 });
      await reset();
      base = await lite(page);
      continue;
    }
    const change = measureChange(base, after);
    const changed = change.significant || change.moved > 0;
    const description = change.significant ? describeChange(c, change, after.vw * after.vh) : undefined;
    attempts.push({ label: c.label, role: c.role, selector: c.selector, outcome: change.significant ? 'changed' : 'no_change', score: change.score, description });
    if (change.significant) found.push({ candidate: c, change, description: description! });
    if (changed) {
      await reset();
      base = await lite(page);
    }
  }
  return { picks: found.sort((a, b) => b.change.score - a.change.score).slice(0, keep), attempts };
}
