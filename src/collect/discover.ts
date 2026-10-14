// Finds interactive states without hand-written steps: click each distinct control on a fresh
// page, measure how much the layout changed, and keep the most significant distinct changes.

import type { Page } from 'playwright';
import { QUIESCE } from '../config.ts';
import { quiesce } from './settle.ts';
import { MAX_SHOWN_PER_VIEWPORT } from './shown.ts';
import { clickOrDispatch, pointerBlocked } from './steps.ts';

export interface Candidate {
  selector: string;
  label: string;
  role: string;
  signature: string;
  // Choice controls (checkboxes, radios, options, toggle buttons): 'multi' when several in a
  // group can be on at once. Members are the visible controls sharing this signature.
  choice?: 'multi' | 'single';
  members?: { selector: string; label: string }[];
}

// [structural key, x, y, w, h, flag] for each visible element; flag marks dialogs, alerts,
// invalid fields, fixed-position elements, and floating layers ('layer': tooltips, menus,
// listboxes, and absolutely positioned elements stacked above the page).
type LiteEl = [string, number, number, number, number, string];

export interface LiteSnapshot {
  url: string;
  height: number;
  vw: number;
  vh: number;
  els: LiteEl[];
  // Keys of elements marked expanded (aria-expanded="true", or an open <details>).
  expanded?: string[];
}

export interface Change {
  appearedArea: number;
  disappearedArea: number;
  moved: number;
  overlays: number;
  // Floating layers that appeared, however small.
  popups: number;
  // Elements newly marked expanded, when something on the page changed with them.
  expanded: number;
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
  after: LiteSnapshot;
}

const MAX_CANDIDATES = 20;
const MAX_GROUP_MEMBERS = 12;
// Two-step states start from this many of the best single-click states.
const MAX_FIRST_STEPS = 3;
const MAX_CHOICE_CLICKS = 24;
// An absolutely positioned element stacked above the page counts as a floating layer from this
// area in CSS px² (a small badge on an icon does not).
const MIN_LAYER_AREA = 1500;

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
  const bySignature = new Map();
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
    const stable = (e) => [...e.classList].filter((c) => !/^(is-|has-)|active|selected|open|checked/.test(c)).sort().join('.');
    // Controls marked up alike in the same kind of parent, as the Functionality probe groups them.
    const attrs = [...el.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')).sort().join(',');
    const parent = el.parentElement ? el.parentElement.tagName + '.' + stable(el.parentElement) : '';
    const signature = [el.tagName, role, stable(el), el.getAttribute('name') || '', attrs, parent].join('|');
    const known = bySignature.get(signature);
    if (known) {
      if (known.members && known.members.length < ${MAX_GROUP_MEMBERS}) known.members.push({ selector: path(el), label });
      continue;
    }
    const type = el.tagName === 'LABEL' ? el.control.type : el.tagName === 'INPUT' ? el.type : el.getAttribute('role');
    const choice = ['radio', 'option', 'menuitemradio'].includes(type) ? 'single'
      : ['checkbox', 'switch', 'menuitemcheckbox'].includes(type) || el.hasAttribute('aria-pressed') ? 'multi' : null;
    const c = { selector: path(el), label, role, signature };
    if (choice) Object.assign(c, { choice, members: [{ selector: c.selector, label }] });
    bySignature.set(signature, c);
    out.push(c);
  }
  return out;
})()`;

// Structural keys survive re-renders: tag, id and stable classes, plus position among siblings
// with the same signature, so inserting one element does not re-key its siblings.
const LITE_SCRIPT = `(() => {
  const els = [];
  const expanded = [];
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
            : cs.position === 'fixed' ? 'fixed'
            : ['tooltip', 'menu', 'listbox'].includes(role) || (cs.position === 'absolute' && parseInt(cs.zIndex, 10) > 0 && r.width * r.height >= ${MIN_LAYER_AREA}) ? 'layer' : '';
          els.push([k, Math.round(r.x + scrollX), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height), flag]);
          if (child.getAttribute('aria-expanded') === 'true' || (child.tagName === 'DETAILS' && child.open)) expanded.push(k);
        }
      }
      walk(child, k);
    }
  };
  walk(document.body, 'body');
  return { url: location.href, height: document.documentElement.scrollHeight, vw: innerWidth, vh: innerHeight, els, expanded };
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
  const popups = appeared.filter((e) => e[5] === 'layer').length;
  const dialogs = appeared.filter((e) => e[5] === 'dialog').length;
  const largestOverlayArea = Math.max(0, ...overlayEls.map((e) => e[3] * e[4]));
  const alerts = after.els.filter((e) => e[5] === 'alert' && !b.has(e[0])).length + newAlerts;
  const heightChange = after.height - before.height;
  const vpArea = Math.max(1, after.vw * after.vh);
  const appearedArea = area(appeared);
  const disappearedArea = area(disappeared);
  // A control that only flips aria-expanded, with nothing else changing, has opened nothing.
  const wasExpanded = new Set(before.expanded ?? []);
  const expanded = appearedArea > 0 || moved > 0 || heightChange !== 0 ? (after.expanded ?? []).filter((k) => !wasExpanded.has(k)).length : 0;
  const inFlow = appeared.filter((e) => e[5] !== 'fixed' && e[5] !== 'dialog').sort((x, y) => y[3] * y[4] - x[3] * x[4]);
  const focusY = inFlow.length ? Math.min(...inFlow.slice(0, 3).map((e) => e[2])) : null;
  const score =
    Math.min(1, appearedArea / vpArea) +
    0.5 * Math.min(1, disappearedArea / vpArea) +
    (overlays || popups ? 0.5 : 0) +
    0.1 * Math.min(alerts, 5) +
    0.2 * Math.min(moved, 100) / 100 +
    0.3 * Math.min(1, Math.abs(heightChange) / after.vh);
  const significant =
    appearedArea >= 0.02 * vpArea || overlays > 0 || popups > 0 || expanded > 0 || alerts > 0 || Math.abs(heightChange) >= 100 || disappearedArea >= 0.05 * vpArea;
  return { appearedArea, disappearedArea, moved, overlays, popups, expanded, dialogs, largestOverlayArea, alerts, heightChange, focusY, score: Math.round(score * 1000) / 1000, significant };
}

// Shown first: something that opened or appeared to tell the user something (a dialog, drawer,
// menu, popover, tooltip, expanded section or validation message), then any other change; the
// larger change first within each.
const tier = (c: Change) => (c.overlays || c.popups || c.expanded || c.alerts ? 0 : 1);

// The one-click states to keep, best first, each significantly different from those before it
// (another filter value or another row's panel can be the same screen), at most `keep`.
export function pickStates(found: Discovered[], keep: number): Discovered[] {
  const ranked = [...found].sort((a, b) => tier(a.change) - tier(b.change) || b.change.score - a.change.score);
  const picks: Discovered[] = [];
  for (const f of ranked) {
    if (picks.length >= keep) break;
    if (picks.every((p) => measureChange(p.after, f.after).significant)) picks.push(f);
  }
  return picks;
}

export function describeChange(c: Candidate, ch: Change, vpArea: number): string {
  const parts: string[] = [];
  if (ch.overlays) parts.push('a dialog or overlay appeared');
  if (ch.popups) parts.push('a menu, tooltip or popover appeared');
  if (ch.expanded && !ch.overlays && !ch.popups) parts.push('a collapsed section or menu was expanded');
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

// Clicks with the pointer, falling back to a dispatched click unless `pointerOnly` (steps after
// the first must be reachable by a real user, not through a layer that blocks the pointer).
async function clickOn(page: Page, selector: string, pointerOnly = false): Promise<boolean> {
  const loc = page.locator(selector).first();
  try {
    if (pointerOnly) {
      if (await pointerBlocked(page, selector)) return false;
      await loc.click({ timeout: QUIESCE.actionTimeoutMs });
    } else await clickOrDispatch(page, loc, selector);
  } catch {
    return false;
  }
  await quiesce(page, 'action');
  return true;
}

const samePage = (a: LiteSnapshot, b: LiteSnapshot) => a.url.split('#')[0] === b.url.split('#')[0];

// Explores one page. `reset` must reload the page to its initial state.
// Returns the distinct changes to keep, best first (at most `keep`; see pickStates), and every
// significant one, largest first.
export async function discoverOnPage(
  page: Page,
  reset: () => Promise<void>,
  keep = MAX_SHOWN_PER_VIEWPORT,
): Promise<{ picks: Discovered[]; found: Discovered[]; load: LiteSnapshot; attempts: Attempt[] }> {
  const candidates = ((await page.evaluate(CANDIDATES_SCRIPT)) as Candidate[]).slice(0, MAX_CANDIDATES);
  const attempts: Attempt[] = [];
  const found: Discovered[] = [];
  const load = await lite(page);
  let base = load;
  for (const c of candidates) {
    if (!(await clickOn(page, c.selector))) {
      attempts.push({ label: c.label, role: c.role, selector: c.selector, outcome: 'not_clickable', score: 0 });
      continue;
    }
    const after = await lite(page);
    if (!samePage(after, base)) {
      attempts.push({ label: c.label, role: c.role, selector: c.selector, outcome: 'navigated', score: 0 });
      await reset();
      base = await lite(page);
      continue;
    }
    const change = measureChange(base, after);
    // Any leftover, however small, would count towards the next control's change.
    const changed = change.significant || change.moved > 0 || change.appearedArea > 0 || change.disappearedArea > 0;
    const description = change.significant ? describeChange(c, change, after.vw * after.vh) : undefined;
    attempts.push({ label: c.label, role: c.role, selector: c.selector, outcome: change.significant ? 'changed' : 'no_change', score: change.score, description });
    if (change.significant) found.push({ candidate: c, change, description: description!, after });
    if (changed) {
      await reset();
      base = await lite(page);
    }
  }
  found.sort((a, b) => b.change.score - a.change.score);
  return { picks: pickStates(found, keep), found, load, attempts };
}

export interface Combination {
  kind: 'sequence' | 'choices';
  steps: { selector: string; label: string; role: string }[];
  // The change from the closest state already known (the page at load or a one-click state).
  change: Change;
  description: string;
  after: LiteSnapshot;
}

const what = (s: { label: string; role: string }) => (s.label ? `${s.role} "${s.label}"` : s.role);

function effects(ch: Change, vpArea: number): string {
  return describeChange({ selector: '', label: '', role: '', signature: '' }, ch, vpArea).replace(/^After clicking [^:]*: /, '');
}

// The change from whichever known state the new one is closest to; null when it is not
// significantly different from one of them.
function closest(known: LiteSnapshot[], after: LiteSnapshot): Change | null {
  let best: Change | null = null;
  for (const k of known) {
    const ch = measureChange(k, after);
    if (!ch.significant) return null;
    if (!best || ch.score < best.score) best = ch;
  }
  return best;
}

// States that need more than one click: a second click from each of the best one-click states,
// and every choice that changed the page applied together (several filters at once, several
// items ticked). Only states significantly different from the page at load and from every
// one-click state are kept.
export async function discoverCombinations(
  page: Page,
  reset: () => Promise<void>,
  load: LiteSnapshot,
  found: Discovered[],
  keep = 2,
): Promise<{ sequences: Combination[]; choices: Combination | null; tried: number }> {
  const known = [load, ...found.map((f) => f.after)];
  const vpArea = load.vw * load.vh;
  const sequences: Combination[] = [];
  let tried = 0;
  for (const first of found.slice(0, MAX_FIRST_STEPS)) {
    const toFirst = async () => {
      await reset();
      return (await clickOn(page, first.candidate.selector)) ? lite(page) : null;
    };
    let base = await toFirst();
    if (!base) continue;
    const next = ((await page.evaluate(CANDIDATES_SCRIPT)) as Candidate[]).filter((c) => c.signature !== first.candidate.signature).slice(0, MAX_CANDIDATES);
    for (const c of next) {
      if (!base) break;
      tried++;
      if (!(await clickOn(page, c.selector, true))) continue;
      const after = await lite(page);
      const step = measureChange(base, after);
      if (samePage(after, base) && step.significant) {
        const change = closest(known, after);
        if (change) {
          const steps = [first.candidate, c].map(({ selector, label, role }) => ({ selector, label, role }));
          sequences.push({ kind: 'sequence', steps, change, after, description: `After clicking ${what(first.candidate)}, then ${what(c)}: ${effects(step, vpArea)}` });
        }
      }
      if (!samePage(after, base) || step.significant || step.moved > 0) base = await toFirst();
    }
  }
  // The strongest from each first step, then the next strongest; each distinct from those kept.
  const kept: Combination[] = [];
  const ranked = sequences.sort((a, b) => b.change.score - a.change.score);
  const leads = ranked.filter((s, i) => ranked.findIndex((t) => t.steps[0].selector === s.steps[0].selector) === i);
  for (const s of [...leads, ...ranked]) {
    if (kept.length >= keep) break;
    if (!kept.includes(s) && kept.every((k) => measureChange(k.after, s.after).significant)) kept.push(s);
  }

  let choices: Combination | null = null;
  const groups = found.filter((f) => f.candidate.choice);
  if (groups.length) {
    await reset();
    const steps: Combination['steps'] = [];
    for (const g of groups) {
      const members = g.candidate.choice === 'multi' ? g.candidate.members ?? [] : [{ selector: g.candidate.selector, label: g.candidate.label }];
      for (const m of members) {
        if (steps.length >= MAX_CHOICE_CLICKS) break;
        if (!(await clickOn(page, m.selector, true))) continue;
        if (!samePage(await lite(page), load)) {
          steps.length = 0;
          break;
        }
        steps.push({ selector: m.selector, label: m.label, role: g.candidate.role });
      }
    }
    // Applying more of the same choices can change little on screen (a few more filter chips),
    // so this state only has to differ significantly from the page at load.
    const after = await lite(page);
    const fromLoad = measureChange(load, after);
    const distinct = found.every((f) => {
      const ch = measureChange(f.after, after);
      return ch.appearedArea > 0 || ch.disappearedArea > 0 || ch.moved > 0;
    });
    const change = steps.length >= 2 && fromLoad.significant && distinct ? fromLoad : null;
    if (change) {
      const counts = new Map<string, number>();
      for (const s of steps) counts.set(what(s), (counts.get(what(s)) ?? 0) + 1);
      const names = [...counts].slice(0, 4).map(([w, n]) => (n > 1 ? `${w} ×${n}` : w));
      const rest = [...counts].slice(4).reduce((sum, [, n]) => sum + n, 0);
      const listed = rest ? `${names.join(', ')} and ${rest} more` : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
      choices = { kind: 'choices', steps, change, after, description: `After applying ${steps.length} choices (${listed}): ${effects(fromLoad, vpArea)}` };
    }
  }
  return { sequences: kept, choices, tried };
}
