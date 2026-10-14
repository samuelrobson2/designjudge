// Functionality probe: uses each kind of control on a freshly loaded page and records what
// happened. Controls are found on the page at load and in the interactive states the judge sees
// (replayed), and grouped by tag, role, type and classes; one control of each group is used.
// Nothing here judges the outcome; diagnostics/functionality decides what fails.

import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { QUIESCE, VIEWPORTS, type FixtureName } from '../config.ts';
import type { StateRecord, Step } from '../types.ts';
import { ensureDir, pngSize, writeJson } from '../util.ts';
import { BEHAVIOUR_FNS, changedOutside, choiceOf, dialogTrials, flowTrials, openPanels, persistenceTrials, type Opener, type TrialContext } from './behaviour.ts';
import { newContext, preparePage, type Injection } from './collect.ts';
import { FUNCTIONAL_DIR, hasEffect } from './probeStore.ts';
import type { ActionResult, Effect, FieldResult, FormResult, FunctionalProbe, LinkResult, ProbeControl, ToggleResult } from './probeTypes.ts';
import { quiesce } from './settle.ts';
import { callLogReason as stepReason, clickOrDispatch, pointerBlocked, runStep } from './steps.ts';
import { changedPixels } from './visual.ts';

const MAX_GROUPS = 40;
// Look-alike controls in a run at least this long are one repeated item, used once.
const MIN_REPEATED = 4;
const MAX_OPERABLE = 120;
const MAX_FIELDS = 30;
const MAX_FORMS = 4;
const CLICK_TIMEOUT = QUIESCE.actionTimeoutMs;
// A control the pointer cannot reach is still given one short trial, in case Playwright reaches it
// where the check did not; the outcome reported does not depend on how long that trial ran.
const BLOCKED_TRIAL_TIMEOUT = 2000;

// Hooks installed before the page's scripts: calls with effects the DOM does not show.
const HOOKS = `(() => {
  window.__djCalls = [];
  const wrap = (obj, key, label) => {
    try {
      const orig = obj && obj[key];
      if (typeof orig !== 'function') return;
      obj[key] = function (...args) { window.__djCalls.push(label); return orig.apply(this, args); };
    } catch {}
  };
  wrap(window, 'open', 'window.open');
  wrap(window, 'print', 'print');
  wrap(document, 'execCommand', 'execCommand');
  wrap(history, 'pushState', 'history.pushState');
  wrap(history, 'replaceState', 'history.replaceState');
  if (navigator.clipboard) { wrap(navigator.clipboard, 'writeText', 'clipboard.writeText'); wrap(navigator.clipboard, 'write', 'clipboard.write'); }
  if (navigator.share) wrap(navigator, 'share', 'share');
  if (window.Storage) { wrap(Storage.prototype, 'setItem', 'storage.setItem'); }
})()`;

const PAGE_FNS = `(() => {
  const path = (el) => {
    const parts = [];
    for (let cur = el; cur && cur !== document.body && cur.parentElement; cur = cur.parentElement) {
      parts.unshift(cur.tagName.toLowerCase() + ':nth-child(' + ([...cur.parentElement.children].indexOf(cur) + 1) + ')');
    }
    return 'body > ' + parts.join(' > ');
  };
  const TEXT_TYPES = ['', 'text', 'search', 'email', 'tel', 'url', 'number', 'password', 'date', 'datetime-local', 'month', 'time', 'week'];
  const QUERY = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [contenteditable=""], [contenteditable=true], [role=button], [role=link], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], [role=textbox], [role=searchbox], [role=combobox], [role=spinbutton], [aria-pressed], [aria-expanded], [tabindex]:not([tabindex="-1"]), [onclick]';
  const STATE_CLASS = /^(is-|has-)|active|selected|open|checked|current|on$/;
  const visible = (el) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };
  const hiddenTree = (el) => !!el.closest('[inert], [aria-hidden="true"], [hidden]') || (() => { const d = el.parentElement && el.parentElement.closest('details'); return !!d && !d.open && !el.closest('summary'); })();
  const fixedOf = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') return true; return false; };
  // A control inside a closed drawer moved off the screen with a transform.
  const offCanvas = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.position === 'static' && cs.transform === 'none') continue;
      const r = a.getBoundingClientRect();
      if (r.right <= 0 || r.left >= innerWidth) return true;
    }
    return false;
  };
  const kindOf = (el) => {
    const role = el.getAttribute('role');
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (['checkbox', 'radio', 'switch', 'tab', 'option', 'menuitemcheckbox', 'menuitemradio'].includes(role)) return 'toggle';
    if (['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(role) && tag !== 'BUTTON') return 'field';
    if (tag === 'INPUT') {
      if (type === 'checkbox' || type === 'radio') return 'toggle';
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'action';
      if (TEXT_TYPES.includes(type)) return 'field';
      return null;
    }
    if (tag === 'SELECT' || tag === 'TEXTAREA' || el.isContentEditable) return 'field';
    if (tag === 'SUMMARY') return 'toggle';
    if (el.hasAttribute('aria-pressed') || el.hasAttribute('aria-expanded')) return 'toggle';
    if (tag === 'A' && el.hasAttribute('href') && role !== 'button' && role !== 'menuitem') return 'link';
    if (tag === 'BUTTON' || role === 'button' || role === 'menuitem' || role === 'link') return 'action';
    // A focusable or scripted element without a control role that looks clickable (a table row that opens a record).
    if (!role && (el.hasAttribute('onclick') || getComputedStyle(el).cursor === 'pointer')) return 'action';
    return null;
  };
  const nameOf = (el) => (el.getAttribute('aria-label') || el.innerText || (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('placeholder') || el.value || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  // Controls that look and are marked up alike, in the same kind of parent: tag, role, type,
  // classes, link target, name and data attributes. A field and a control with an ID are each
  // their own group.
  const signatureOf = (el, kind, role, type, href) => {
    const classes = (e) => [...e.classList].filter((c) => !STATE_CLASS.test(c)).sort().join('.');
    const target = kind === 'link' ? (href === '#' || href === '' || /^javascript:/i.test(href || '') ? '#' : href) : '';
    const attrs = [...el.attributes].map((a) => a.name).filter((n) => n.startsWith('data-') || n === 'onclick' || n === 'form').sort().join(',');
    const parent = el.parentElement ? el.parentElement.tagName + '.' + classes(el.parentElement) : '';
    return [el.tagName, role, type, classes(el), target, el.getAttribute('name') || '', attrs, el.id ? '#' + el.id : '', kind === 'field' ? nameOf(el) : '', parent].join('|');
  };
  const roleOf = (el) => el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button' })[el.tagName] || (el.tagName === 'INPUT' ? ((t) => (t === 'checkbox' || t === 'radio' ? t : ['button', 'submit', 'reset', 'image'].includes(t) ? 'button' : 'textbox'))((el.getAttribute('type') || '').toLowerCase()) : null);
  const typeOf = (el) => (el.tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : null);
  const controls = () => {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(QUERY)) {
      if (seen.has(el) || hiddenTree(el)) continue;
      const kind = kindOf(el);
      if (!kind) continue;
      // A custom checkbox or radio: the input is hidden and its label is what people click.
      let clickEl = el;
      if (!visible(el)) {
        const label = el.labels && [...el.labels].find(visible);
        if (!(kind === 'toggle' && label)) continue;
        clickEl = label;
      }
      seen.add(el);
      const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || !!el.closest('fieldset:disabled') || (el.readOnly && kind === 'field');
      if (disabled) continue;
      const r = clickEl.getBoundingClientRect();
      const fixed = fixedOf(el);
      const role = roleOf(el);
      const href = el.tagName === 'A' ? el.getAttribute('href') : null;
      const type = typeOf(el);
      const d = window.__djDescribe(el);
      out.push({
        path: path(el), clickPath: path(clickEl), selector: d.selector, tag: el.tagName.toLowerCase(), role, type, name: nameOf(el) || null,
        componentId: el.getAttribute('data-component-id'),
        rect: { x: Math.round(r.x + (fixed ? 0 : scrollX)), y: Math.round(r.y + (fixed ? 0 : scrollY)), w: Math.round(r.width), h: Math.round(r.height) },
        fixed, kind, href, offCanvas: offCanvas(clickEl),
        signature: signatureOf(el, kind, role, type, href),
      });
    }
    return out;
  };

  // ----- Effect watching -----
  let noise = new WeakSet();
  let watch = null;
  const liveTexts = () => [...document.querySelectorAll('[role=alert], [role=status], [aria-live]:not([aria-live=off]), [aria-invalid=true]')]
    .filter((e) => e.checkVisibility()).map((e) => (e.getAttribute('aria-invalid') === 'true' ? 'invalid:' + path(e) : (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160))).filter(Boolean);
  const inNoise = (n) => { for (let a = n; a; a = a.parentNode) if (noise.has(a)) return true; return false; };
  const isHarness = (n) => { const e = n.nodeType === 1 ? n : n.parentElement; return !!(e && e.closest && e.closest('[data-dj-sentinel]')); };
  // The control, its labels, and the wrappers around it that hold no other control: what changing
  // only itself means.
  const ownRoots = (el) => {
    const roots = [el, ...(el.labels ? [...el.labels] : [])];
    let a = el;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if ([...p.querySelectorAll(QUERY)].some((x) => x !== el && !roots.some((r) => r.contains(x)))) break;
      a = p;
    }
    if (a !== el) roots.push(a);
    return roots;
  };
  const start = (ownPath) => {
    const own = ownPath ? (() => { const el = find(ownPath); return el ? ownRoots(el) : []; })() : null;
    const w = { mutations: 0, aria: 0, invalid: 0, outside: 0, own: !!own, scroll: scrollY, text: document.body.innerText, live: liveTexts(), calls: window.__djCalls.length, url: location.href };
    w.mo = new MutationObserver((list) => {
      for (const m of list) {
        if (isHarness(m.target) || inNoise(m.target)) continue;
        w.mutations++;
        if (m.type === 'attributes' && /^aria-/.test(m.attributeName || '')) w.aria++;
        if (own && !own.some((r) => r.contains(m.target))) w.outside++;
      }
    });
    w.mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    w.onInvalid = () => w.invalid++;
    document.addEventListener('invalid', w.onInvalid, true);
    watch = w;
  };
  const end = () => {
    const w = watch;
    if (!w) return null;
    w.mo.takeRecords();
    w.mo.disconnect();
    document.removeEventListener('invalid', w.onInvalid, true);
    watch = null;
    const live = liveTexts();
    return {
      mutations: w.mutations, ariaChanges: w.aria, invalid: w.invalid, scrolled: Math.round(scrollY - w.scroll),
      textChanged: document.body.innerText !== w.text, newAlerts: live.filter((t) => !w.live.includes(t)).slice(0, 4),
      calls: window.__djCalls.slice(w.calls),
      ...(w.own ? { outside: w.outside } : {}),
    };
  };
  // Elements that change without any interaction (clocks, carousels) are not counted as effects:
  // those that change while the page is given page time between noiseStart and noiseEnd.
  let noiseMo = null;
  let noiseSet = null;
  const noiseStart = () => {
    noiseSet = new WeakSet();
    noiseMo = new MutationObserver((list) => { for (const m of list) noiseSet.add(m.target); });
    noiseMo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  };
  const noiseEnd = () => {
    if (!noiseMo) return;
    for (const m of noiseMo.takeRecords()) noiseSet.add(m.target);
    noiseMo.disconnect();
    noise = noiseSet;
    noiseMo = null;
  };

  // ----- Toggles -----
  const declared = (el) => {
    const role = el.getAttribute('role');
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) return { property: 'checked', value: String(el.checked), expected: el.type === 'radio' ? 'select' : 'toggle' };
    if (el.tagName === 'SUMMARY') { const d = el.closest('details'); return { property: 'open', value: String(!!(d && d.open)), expected: 'toggle' }; }
    if (['checkbox', 'switch', 'menuitemcheckbox'].includes(role)) return { property: 'aria-checked', value: el.getAttribute('aria-checked'), expected: 'toggle' };
    if (['radio', 'menuitemradio'].includes(role)) return { property: 'aria-checked', value: el.getAttribute('aria-checked'), expected: 'select' };
    if (['tab', 'option'].includes(role)) return { property: 'aria-selected', value: el.getAttribute('aria-selected'), expected: 'select' };
    if (el.hasAttribute('aria-pressed')) return { property: 'aria-pressed', value: el.getAttribute('aria-pressed'), expected: 'toggle' };
    if (el.hasAttribute('aria-expanded')) return { property: 'aria-expanded', value: el.getAttribute('aria-expanded'), expected: 'toggle' };
    return null;
  };
  const controlsOf = (el) => {
    const ids = (el.getAttribute('aria-controls') || '').split(/\\s+/).filter(Boolean);
    const target = ids.map((id) => document.getElementById(id)).find(Boolean);
    return target ? { id: target.id, visible: target.checkVisibility() } : null;
  };
  const find = (p) => { try { return document.querySelector(p); } catch { return null; } };
  const box = (p) => { const el = find(p); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };

  // ----- Forms -----
  const forms = () => [...document.querySelectorAll('form')].filter((f) => !hiddenTree(f) && (visible(f) || [...f.elements].some(visible))).map((f) => {
    const outside = f.id ? [...document.querySelectorAll('[form="' + CSS.escape(f.id) + '"]')] : [];
    const submits = [...f.querySelectorAll('button:not([type]), button[type=submit], input[type=submit], input[type=image]'), ...outside.filter((e) => e.matches('button:not([type]), button[type=submit], input[type=submit]'))]
      .filter((e) => visible(e) && !e.disabled && !hiddenTree(e));
    const labelledBy = (f.getAttribute('aria-labelledby') || '').split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((e) => e.innerText).join(' ');
    return { path: path(f), name: f.getAttribute('aria-label') || labelledBy || f.getAttribute('name') || f.id || (f.getAttribute('role') === 'search' ? 'search' : null), submit: submits[0] ? path(submits[0]) : null, submitName: submits[0] ? nameOf(submits[0]) : null };
  });

  // The control to toggle in a group: a usable member that is not already selected.
  const toggleTarget = (repPath) => {
    const rep = find(repPath);
    if (!rep) return null;
    const sig = (e) => signatureOf(e, kindOf(e), roleOf(e), typeOf(e), null);
    const s = sig(rep);
    const usable = (e) => !hiddenTree(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && (visible(e) || (e.labels && [...e.labels].some(visible)));
    const peers = [...document.querySelectorAll(rep.tagName)].filter((e) => sig(e) === s && usable(e));
    const pick = peers.find((e) => { const d = declared(e); return d && d.value !== 'true'; }) || rep;
    const label = pick.labels && [...pick.labels].find(visible);
    const click = visible(pick) ? pick : label || pick;
    return { path: path(pick), click: path(click), state: declared(pick), controls: controlsOf(pick) };
  };

  window.__djF = { controls, start, end, noiseStart, noiseEnd, declared, controlsOf, find, box, forms, path, nameOf, visible, kindOf, toggleTarget, hiddenTree, fixed: fixedOf, roleOf, typeOf, QUERY, sig: (e) => signatureOf(e, kindOf(e), roleOf(e), typeOf(e), null) };
})()`;

function emptyEffect(): Effect {
  return { url: false, mutations: 0, ariaChanges: 0, requests: 0, dialogs: 0, invalid: 0, calls: [], scrolled: 0, textChanged: false, newAlerts: [], errors: [] };
}

function callLogReason(err: unknown): string {
  return stepReason(err).slice(0, 200);
}

const FIELD_VALUES: Record<string, string> = {
  email: 'alex.morgan@example.com',
  tel: '07700 900123',
  url: 'https://example.com',
  password: 'Test-pass-123',
  search: 'test',
  date: '2026-09-21',
  time: '10:30',
  'datetime-local': '2026-09-21T10:30',
  month: '2026-09',
  week: '2026-W38',
};

function textValue(name: string): string {
  const n = name.toLowerCase();
  if (/e-?mail/.test(n)) return FIELD_VALUES.email;
  if (/phone|mobile|tel/.test(n)) return FIELD_VALUES.tel;
  if (/post ?code|zip/.test(n)) return 'SW4 7AA';
  if (/city|town/.test(n)) return 'London';
  if (/name/.test(n)) return 'Alex Morgan';
  return 'Test value';
}

interface FieldPlan {
  value: string;
  select?: boolean;
}

async function planField(page: Page, p: string, c: { type: string | null; name: string | null; tag: string }): Promise<FieldPlan | null> {
  const info = (await page.evaluate(`(() => {
    const el = window.__djF.find(${JSON.stringify(p)});
    if (!el) return null;
    if (el.tagName === 'SELECT') {
      const opts = [...el.options].map((o, i) => ({ i, v: o.value, d: o.disabled }));
      const pick = opts.find((o) => o.i !== el.selectedIndex && !o.d && o.v !== '') || opts.find((o) => o.i !== el.selectedIndex && !o.d);
      return pick ? { select: true, value: pick.v } : null;
    }
    return { min: el.getAttribute('min'), max: el.getAttribute('max'), step: el.getAttribute('step') };
  })()`)) as { select?: boolean; value?: string; min?: string | null; max?: string | null } | null;
  if (!info) return null;
  if (info.select) return { value: info.value!, select: true };
  const type = c.type ?? (c.tag === 'textarea' ? 'textarea' : 'text');
  if (type === 'number') {
    const lo = info.min !== null && info.min !== undefined && info.min !== '' ? Number(info.min) : 1;
    const hi = info.max !== null && info.max !== undefined && info.max !== '' ? Number(info.max) : lo + 4;
    return { value: String(Math.max(lo, Math.min(hi, Math.round((lo + hi) / 2)))) };
  }
  if (type === 'date' && info.min) return { value: info.min };
  return { value: FIELD_VALUES[type] ?? textValue(c.name ?? '') };
}

export async function collectFunctional(
  browser: Browser,
  url: string,
  origin: string,
  vpId: 'desktop' | 'mobile',
  fixture: FixtureName | null,
  interactive: StateRecord[],
  bundleDir: string,
  inject?: Injection,
): Promise<FunctionalProbe> {
  const vp = VIEWPORTS[vpId];
  const out: FunctionalProbe = {
    version: 1,
    viewport: vpId,
    width: vp.width,
    height: vp.height,
    controls: [],
    operability: [],
    actions: [],
    fields: [],
    toggles: [],
    links: [],
    forms: [],
    errors: [],
    limits: { controls: 0, probed: 0 },
  };
  const dir = ensureDir(path.join(bundleDir, FUNCTIONAL_DIR));
  const ctx = await newContext(browser, vp);
  let during = 'load';
  try {
    const page = await preparePage(ctx, fixture, inject);
    await page.addInitScript({ content: HOOKS });
    await page.addInitScript({ content: PAGE_FNS });
    await page.addInitScript({ content: BEHAVIOUR_FNS });
    let requests = 0;
    let dialogs = 0;
    let navStatus: number | null = null;
    const isOwn = (u: string) => u.startsWith(origin);
    page.on('request', (r) => {
      if (!r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests++;
    });
    page.on('response', (r) => {
      if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) navStatus = r.status();
      if (isOwn(r.url()) && r.status() >= 400 && !/favicon\.ico/.test(r.url())) out.errors.push({ during, message: `HTTP ${r.status()} for ${r.url().slice(origin.length) || '/'}` });
    });
    page.on('requestfailed', (r) => {
      if (isOwn(r.url()) && !/favicon\.ico/.test(r.url())) out.errors.push({ during, message: `Request failed: ${r.url().slice(origin.length)} (${r.failure()?.errorText ?? 'failed'})` });
    });
    page.on('pageerror', (e) => out.errors.push({ during, message: `Uncaught error: ${String(e.message).slice(0, 240)}` }));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) out.errors.push({ during, message: `Console error: ${m.text().slice(0, 240)}` });
    });
    page.on('dialog', (d) => {
      dialogs++;
      void d.dismiss().catch(() => {});
    });
    ctx.on('page', (p) => {
      if (p !== page) {
        dialogs++;
        void p.close();
      }
    });
    page.on('download', () => void (dialogs += 1));
    const fresh = async (steps: Step[] = []) => {
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      await quiesce(page, 'load');
      for (const s of steps) await runStep(page, s);
      await page.evaluate('window.scrollTo({ top: 0, left: 0, behavior: "instant" })');
      // The noise window is as long as the window an action is watched for.
      await page.evaluate('window.__djF.noiseStart()');
      await quiesce(page, 'action');
      await page.evaluate('window.__djF.noiseEnd()');
    };
    // Watches one interaction for the action window of page time and returns everything it did.
    // The control is scrolled into view first, so the scroll Playwright makes to reach it is not
    // counted as the control's effect.
    // With own, changes outside that control (its labels and the wrapper holding only it) are also counted.
    const watched = async (act: () => Promise<void>, target?: string, own?: string): Promise<Effect> => {
      if (target) {
        await page.locator(target).first().scrollIntoViewIfNeeded({ timeout: CLICK_TIMEOUT }).catch(() => {});
        await quiesce(page, 'brief');
      }
      const url0 = page.url();
      const errors0 = out.errors.length;
      await page.evaluate(`window.__djF.start(${own ? JSON.stringify(own) : ''})`);
      requests = 0;
      dialogs = 0;
      navStatus = null;
      await act();
      await quiesce(page, 'action');
      let inPage: Partial<Effect> | null = null;
      try {
        inPage = (await page.evaluate('window.__djF.end()')) as Partial<Effect> | null;
      } catch {
        // The page navigated away; its watcher went with it.
      }
      const e = { ...emptyEffect(), ...(inPage ?? {}) };
      e.url = page.url() !== url0;
      e.requests = requests;
      e.dialogs = dialogs;
      e.errors = out.errors.slice(errors0).map((x) => x.message);
      return e;
    };

    // ----- Controls at load and in the interactive states -----
    during = 'load';
    await fresh();
    const starts: { from: string; steps: Step[] }[] = [{ from: 'load', steps: [] }];
    for (const s of interactive) starts.push({ from: s.id, steps: (s.steps ?? []).map((x) => x.step as Step) });
    type Found = ProbeControl & { clickPath: string; signature: string; steps: Step[] };
    const groups = new Map<string, Found>();
    const all: Found[] = [];
    const atLoad = new Set<string>();
    for (const st of starts) {
      if (st.steps.length) {
        try {
          during = `replaying ${st.from}`;
          await fresh(st.steps);
        } catch {
          continue;
        }
      }
      const found = (await page.evaluate('window.__djF.controls()')) as (Omit<Found, 'key' | 'members' | 'memberNames' | 'from' | 'steps'>)[];
      // In an interactive state only the controls that were not on the page at load are new.
      const newHere = found.filter((f) => st.from === 'load' || !atLoad.has(`${f.signature}|${f.name}`));
      if (st.from === 'load') for (const f of found) atLoad.add(`${f.signature}|${f.name}`);
      const bySig = new Map<string, typeof newHere>();
      for (const f of newHere) bySig.set(f.signature, [...(bySig.get(f.signature) ?? []), f]);
      for (const [sig, list] of bySig) {
        // A few look-alike controls are usually different actions; a longer run is a repeated item.
        const runs = list.length >= MIN_REPEATED ? [list] : list.map((f) => [f]);
        runs.forEach((members, i) => {
          const groupKey = `${st.from}|${sig}${runs.length > 1 ? `|${i}` : ''}`;
          const [first, ...rest] = members;
          const c: Found = {
            ...first,
            key: `${vpId}:${groups.size + 1}`,
            members: members.length,
            memberNames: [...new Set(rest.map((m) => m.name).filter((n): n is string => !!n && n !== first.name))].slice(0, 4),
            from: st.from,
            steps: st.steps,
            signature: groupKey,
          };
          groups.set(groupKey, c);
          all.push(c, ...rest.map((m) => ({ ...m, key: '', members: 1, memberNames: [], from: st.from, steps: st.steps, signature: groupKey })));
        });
      }
    }
    const reps = [...groups.values()].slice(0, MAX_GROUPS);
    out.limits = { controls: all.length, probed: reps.length };
    out.controls = reps.map(({ clickPath: _c, signature: _s, steps: _st, ...c }) => c);

    // ----- Interactive Control Operability (actionability, no action performed) -----
    let current = 'load';
    const goTo = async (c: Found, dirty: boolean) => {
      if (!dirty && current === c.from) return;
      during = c.from === 'load' ? 'reload' : `replaying ${c.from}`;
      await fresh(c.steps);
      current = c.from;
    };
    let dirty = true;
    let opCount = 0;
    const memberOf = (c: Found) => (c.key ? {} : { member: { name: c.name, selector: c.selector, rect: c.rect, fixed: c.fixed } });
    for (const c of all) {
      if (opCount >= MAX_OPERABLE || c.offCanvas) continue;
      const rep = c.key ? c : groups.get(c.signature)!;
      if (!reps.includes(rep)) continue;
      opCount++;
      try {
        await goTo(rep, dirty);
        dirty = false;
        // Whether the pointer can reach it is decided on the quiet page; the trial click confirms it.
        const blocked = await pointerBlocked(page, c.clickPath);
        try {
          await page.locator(c.clickPath).first().click({ trial: true, timeout: blocked ? BLOCKED_TRIAL_TIMEOUT : CLICK_TIMEOUT });
        } catch (err) {
          throw new Error(blocked ?? callLogReason(err));
        }
        let focusOk = true;
        if (c.kind !== 'toggle' || c.clickPath === c.path) {
          focusOk = (await page.evaluate(`(() => { const el = window.__djF.find(${JSON.stringify(c.path)}); if (!el) return true; el.focus({ preventScroll: true }); const ok = document.activeElement === el; el.blur && el.blur(); return ok; })()`)) as boolean;
        }
        if (c.key) out.operability.push(focusOk ? { key: c.key, ok: true } : { key: c.key, ok: false, reason: 'it cannot take keyboard focus' });
        else if (!focusOk) out.operability.push({ key: rep.key, ok: false, reason: 'it cannot take keyboard focus', ...memberOf(c) });
      } catch (err) {
        out.operability.push({ key: rep.key, ok: false, reason: callLogReason(err), ...memberOf(c) });
        dirty = true;
      }
    }

    // The dialogs and drawers the controls open, tried after the other phases.
    const openers: Opener[] = [];
    const noteOpened = async (c: Found, click: string, before: string[], e: Effect) => {
      if (e.url || !hasEffect(e)) return;
      const opened = (await openPanels(page)).filter((p) => !before.includes(p));
      if (opened.length) openers.push({ control: c, click, dialog: opened[0] });
    };

    // ----- No-Effect Action Controls -----
    dirty = true;
    for (const c of reps.filter((r) => r.kind === 'action' && !r.offCanvas)) {
      try {
        await goTo(c, dirty);
        during = `clicking "${c.name ?? c.selector}"`;
        const panelsBefore = await openPanels(page);
        const e = await watched(async () => void (await clickOrDispatch(page, page.locator(c.clickPath).first(), c.clickPath)), c.clickPath);
        out.actions.push({ key: c.key, effect: e } satisfies ActionResult);
        await noteOpened(c, c.clickPath, panelsBefore, e);
        dirty = hasEffect(e) || e.url;
      } catch (err) {
        out.actions.push({ key: c.key, effect: null, error: callLogReason(err) });
        dirty = true;
      }
    }

    // ----- Editable Control Response -----
    // Fields are filled in page order, as a user fills a form, and every value is read back at the end.
    const fill = async (items: { path: string; name: string | null; type: string | null; tag: string }[]) => {
      const results: { path: string; plan: FieldPlan | null; replaced: boolean; error?: string }[] = [];
      for (const fld of items) {
        during = `typing in "${fld.name ?? fld.tag}"`;
        const plan = await planField(page, fld.path, fld).catch(() => null);
        if (!plan) {
          results.push({ path: fld.path, plan: null, replaced: false });
          continue;
        }
        try {
          await page.evaluate(`window.__djFieldRef = window.__djF.find(${JSON.stringify(fld.path)})`);
          const loc = page.locator(fld.path).first();
          if (plan.select) await loc.selectOption(plan.value, { timeout: CLICK_TIMEOUT });
          else await loc.fill(plan.value, { timeout: CLICK_TIMEOUT });
          const replaced = (await page.evaluate('!!window.__djFieldRef && !window.__djFieldRef.isConnected')) as boolean;
          results.push({ path: fld.path, plan, replaced });
        } catch (err) {
          results.push({ path: fld.path, plan, replaced: false, error: callLogReason(err) });
        }
      }
      await page.keyboard.press('Tab');
      await quiesce(page, 'action');
      return Promise.all(
        results.map(async (r) => ({
          ...r,
          value: (await page.evaluate(`(() => { const el = window.__djF.find(${JSON.stringify(r.path)}); return el ? (el.isContentEditable ? el.innerText : el.value) : null; })()`)) as string | null,
        })),
      );
    };
    const accepted = (attempted: string, value: string | null, type: string | null) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      return value !== null && (norm(value) === norm(attempted) || (type === 'number' && Number(value) === Number(attempted)));
    };
    const fieldsByState = new Map<string, Found[]>();
    for (const c of all.filter((x) => x.kind === 'field' && !x.offCanvas).slice(0, MAX_FIELDS)) {
      const rep = c.key ? c : groups.get(c.signature)!;
      if (reps.includes(rep)) fieldsByState.set(rep.from, [...(fieldsByState.get(rep.from) ?? []), c]);
    }
    for (const list of fieldsByState.values()) {
      try {
        await goTo(list[0].key ? list[0] : groups.get(list[0].signature)!, true);
        const filled = await fill(list);
        for (const [i, r] of filled.entries()) {
          const c = list[i];
          if (!r.plan) continue;
          const res: FieldResult = { key: c.key || groups.get(c.signature)!.key, attempted: r.plan.value, result: r.value, ok: accepted(r.plan.value, r.value, c.type) };
          if (r.error) res.note = r.error;
          else if (r.value === null) res.note = 'the field was no longer on the page afterwards';
          else if (!res.ok && r.replaced) res.note = 'the field was redrawn as it was being typed in (when the previous field was left), so the text went nowhere';
          else if (!res.ok && r.value && r.plan.value.startsWith(r.value)) res.note = 'the value was cut short';
          else if (!res.ok) res.note = 'the value was cleared or changed after moving on';
          if (!out.fields.some((f) => f.key === res.key && f.ok === res.ok)) out.fields.push(res);
        }
      } catch {
        // A state that cannot be reached again has no field results.
      }
    }
    dirty = true;

    // ----- Toggle / Selection State -----
    dirty = true;
    for (const c of reps.filter((r) => r.kind === 'toggle' && !r.offCanvas)) {
      try {
        await goTo(c, dirty);
      } catch {
        dirty = true;
        continue;
      }
      during = `toggling "${c.name ?? c.selector}"`;
      // Within the group, a member that is not already selected.
      const target = (await page.evaluate(`window.__djF.toggleTarget(${JSON.stringify(c.path)})`).catch(() => null)) as { path: string; click: string; state: { property: string; value: string | null; expected: 'toggle' | 'select' } | null; controls: { id: string; visible: boolean } | null } | null;
      if (!target?.state) continue;
      const crop = async (p: string) => {
        const b = (await page.evaluate(`window.__djF.box(${JSON.stringify(p)})`)) as { x: number; y: number; w: number; h: number } | null;
        if (!b) return null;
        const x = Math.max(0, Math.floor(b.x - 3));
        const y = Math.max(0, Math.floor(b.y - 3));
        const clip = { x, y, width: Math.max(1, Math.min(vp.width - x, Math.ceil(b.w + 6))), height: Math.max(1, Math.min(vp.height - y, Math.ceil(b.h + 6))) };
        return page.screenshot({ clip, animations: 'disabled', caret: 'hide', scale: 'css' });
      };
      await page.mouse.move(vp.width - 2, vp.height - 2);
      const before = await crop(target.click).catch(() => null);
      const res: ToggleResult = { key: c.key, property: target.state.property, before: target.state.value, after: null, expected: target.state.expected, ok: false, renderedChange: null };
      const choice = await choiceOf(page, target.path);
      if (choice) res.choice = choice;
      const panelsBefore = await openPanels(page);
      try {
        const e = await watched(
          async () => {
            const blocked = await pointerBlocked(page, target.click);
            if (blocked) throw new Error(blocked);
            await page.locator(target.click).first().click({ timeout: CLICK_TIMEOUT });
          },
          target.click,
          target.path,
        );
        if (choice) res.outside = changedOutside(e);
        await noteOpened(c, target.click, panelsBefore, e);
        const after = (await page.evaluate(`(() => { const el = window.__djF.find(${JSON.stringify(target.path)}); return el ? { state: window.__djF.declared(el), controls: window.__djF.controlsOf(el) } : null; })()`)) as {
          state: { value: string | null } | null;
          controls: { id: string; visible: boolean } | null;
        } | null;
        await page.mouse.move(vp.width - 2, vp.height - 2);
        await quiesce(page, 'brief');
        const afterShot = e.url ? null : await crop(target.click);
        res.after = after?.state?.value ?? null;
        res.renderedChange = before && afterShot ? ((await changedPixels(before, afterShot)) ?? 999) > 4 : null;
        const declaredOk = target.state.expected === 'toggle' ? res.after !== res.before : res.after === 'true';
        let controlsOk = true;
        if (target.controls && after?.controls) {
          res.controls = { id: target.controls.id, before: target.controls.visible, after: after.controls.visible };
          if (target.state.property === 'aria-expanded') controlsOk = after.controls.visible === (res.after === 'true');
          else if (target.state.property === 'aria-selected') controlsOk = after.controls.visible;
        }
        res.ok = declaredOk && controlsOk && res.renderedChange !== false;
        if (!after) res.note = 'the control was no longer on the page afterwards';
        else if (!declaredOk && res.renderedChange) res.note = 'its appearance changed but its declared state did not';
        else if (declaredOk && res.renderedChange === false) res.note = 'its declared state changed but nothing on screen changed';
        else if (!controlsOk) res.note = `the content it controls (#${target.controls!.id}) did not ${res.after === 'true' ? 'appear' : 'hide'}`;
        dirty = true;
      } catch (err) {
        // A click that cannot be made is Interactive Control Operability's finding, not a state failure.
        res.error = callLogReason(err);
        dirty = true;
      }
      out.toggles.push(res);
    }

    // ----- Internal Navigation Integrity -----
    dirty = true;
    for (const c of reps.filter((r) => r.kind === 'link' && !r.offCanvas && r.href !== null)) {
      const href = c.href!.trim();
      if (/^(mailto|tel|sms):/i.test(href)) continue;
      const abs = (() => {
        try {
          return new URL(href, url);
        } catch {
          return null;
        }
      })();
      const placeholder = href === '' || href === '#' || /^javascript:/i.test(href) || href === '#!';
      if (!placeholder && abs && abs.origin !== new URL(url).origin) continue;
      const res: LinkResult = { key: c.key, href, target: placeholder ? 'placeholder' : href.startsWith('#') ? 'fragment' : 'page', ok: false, detail: '' };
      try {
        await goTo(c, dirty);
        during = `following "${c.name ?? href}"`;
        const targetExists = res.target === 'fragment' ? ((await page.evaluate(`(() => { const id = decodeURIComponent(${JSON.stringify(href.slice(1))}); return !!(document.getElementById(id) || document.getElementsByName(id).length); })()`)) as boolean) : false;
        const e = await watched(async () => {
          await clickOrDispatch(page, page.locator(c.clickPath).first(), c.clickPath);
          if (res.target === 'page') await page.waitForLoadState('load', { timeout: CLICK_TIMEOUT }).catch(() => {});
        }, c.clickPath);
        if (res.target === 'placeholder') {
          res.ok = hasEffect(e, { placeholder: true });
          res.detail = res.ok ? 'a script responds to it' : 'nothing happens beyond jumping to the top of the page';
        } else if (res.target === 'fragment') {
          const hash = new URL(page.url()).hash;
          res.ok = targetExists ? hash === href || hasEffect(e) : e.mutations > 0 || e.calls.length > 0;
          res.detail = targetExists ? (res.ok ? 'reaches its target' : 'the page did not move to its target') : res.ok ? 'a script handles it' : `there is no element with the ID "${href.slice(1)}" on the page`;
        } else {
          res.status = navStatus;
          const title = e.url ? ((await page.title().catch(() => '')) as string) : '';
          res.ok = e.url ? (navStatus === null || navStatus < 400) && !/not found|404|error/i.test(title) : hasEffect(e);
          res.detail = e.url ? (res.ok ? `opens ${new URL(page.url()).pathname}` : `opens a page that returns ${navStatus ?? 'an error'}${title ? ` ("${title}")` : ''}`) : res.ok ? 'a script handles it' : 'nothing happens';
        }
        dirty = hasEffect(e) || e.url;
      } catch (err) {
        res.error = callLogReason(err);
        dirty = true;
      }
      out.links.push(res);
    }

    // ----- Form Submission Response and the response to an empty submission -----
    during = 'reload';
    await fresh();
    current = 'load';
    const forms = ((await page.evaluate('window.__djF.forms()')) as { path: string; name: string | null; submit: string | null; submitName: string | null }[]).slice(0, MAX_FORMS);
    for (const [i, f] of forms.entries()) {
      const res: FormResult = { key: `${vpId}:form-${i + 1}`, path: f.path, name: f.name ? f.name.replace(/\s+/g, ' ').trim().slice(0, 60) : null, submit: f.submitName, filled: [], refilled: [], lost: [], chosen: [], valid: null, outcome: '' };
      const submit = async () => {
        if (f.submit) {
          await clickOrDispatch(page, page.locator(f.submit).first(), f.submit);
        } else {
          await page.evaluate(`(() => { const form = window.__djF.find(${JSON.stringify(f.path)}); form && (form.requestSubmit ? form.requestSubmit() : form.submit()); })()`);
        }
      };
      try {
        // Empty: submitted as loaded.
        during = `submitting "${res.name ?? 'form'}" empty`;
        await fresh();
        res.empty = await watched(submit, f.submit ?? undefined);
        res.emptyOutcome = outcome(res.empty);
        // Valid: choices first (they can re-render the form), then text fields.
        during = `submitting "${res.name ?? 'form'}" filled in`;
        await fresh();
        const choices = (await page.evaluate(`(() => {
          const form = window.__djF.find(${JSON.stringify(f.path)});
          if (!form) return [];
          const out = [];
          const radios = new Map();
          for (const el of form.querySelectorAll('input[type=radio]')) if (el.name && !el.disabled) radios.set(el.name, [...(radios.get(el.name) || []), el]);
          for (const [, list] of radios) if (!list.some((e) => e.checked)) { const e = list[0]; const label = e.labels && [...e.labels].find(window.__djF.visible); out.push({ path: window.__djF.path(window.__djF.visible(e) ? e : label || e), name: window.__djF.nameOf(e) }); }
          for (const el of form.querySelectorAll('input[type=checkbox][required], input[type=checkbox][aria-required=true]')) if (!el.checked) { const label = el.labels && [...el.labels].find(window.__djF.visible); out.push({ path: window.__djF.path(window.__djF.visible(el) ? el : label || el), name: window.__djF.nameOf(el) }); }
          const groups = new Map();
          for (const el of form.querySelectorAll('[aria-pressed], [role=radio], [role=option]')) {
            if (el.disabled || el.getAttribute('aria-disabled') === 'true' || !window.__djF.visible(el)) continue;
            const key = el.parentElement ? window.__djF.path(el.parentElement) : '';
            groups.set(key, [...(groups.get(key) || []), el]);
          }
          for (const [, list] of groups) if (!list.some((e) => e.getAttribute('aria-pressed') === 'true' || e.getAttribute('aria-checked') === 'true' || e.getAttribute('aria-selected') === 'true')) out.push({ path: window.__djF.path(list[0]), name: window.__djF.nameOf(list[0]) });
          return out;
        })()`)) as { path: string; name: string }[];
        for (const ch of choices) {
          try {
            if (await pointerBlocked(page, ch.path)) continue;
            await page.locator(ch.path).first().click({ timeout: CLICK_TIMEOUT });
            await quiesce(page, 'action');
            res.chosen.push(ch.name || 'an option');
          } catch {
            // A choice that cannot be made is left out; the outcome shows what happened.
          }
        }
        const fields = (await page.evaluate(`(() => {
          const form = window.__djF.find(${JSON.stringify(f.path)});
          if (!form) return [];
          return [...form.elements].filter((el) => window.__djF.kindOf(el) === 'field' && window.__djF.visible(el) && !el.disabled && !el.readOnly)
            .map((el) => ({ path: window.__djF.path(el), name: window.__djF.nameOf(el) || el.name || '', type: el.tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : null, tag: el.tagName.toLowerCase(), empty: el.tagName === 'SELECT' ? !el.value : !el.value }));
        })()`)) as { path: string; name: string; type: string | null; tag: string; empty: boolean }[];
        const empty = fields.filter((fld) => fld.empty);
        const filled = await fill(empty);
        // A value that did not stick is entered again, as a user would, so the submission itself is what is tested.
        for (const [k, r] of filled.entries()) {
          const fld = empty[k];
          if (!r.plan) continue;
          if (!accepted(r.plan.value, r.value, fld.type)) {
            const again = await fill([fld]);
            if (accepted(r.plan.value, again[0]?.value ?? null, fld.type)) res.refilled.push(fld.name || fld.type || fld.tag);
            else {
              res.lost.push(fld.name || fld.type || fld.tag);
              continue;
            }
          }
          res.filled.push(fld.name || fld.type || fld.tag);
        }
        await quiesce(page, 'action');
        res.valid = await watched(submit, f.submit ?? undefined);
        res.outcome = outcome(res.valid);
        // The screen after the submission, at the message it produced if there is one.
        if (!res.valid.url || new URL(page.url()).origin === new URL(url).origin) {
          await page.evaluate(`(() => {
            const live = [...document.querySelectorAll('[role=alert], [role=status], [aria-live]:not([aria-live=off])')].find((e) => e.checkVisibility() && e.innerText.trim());
            if (live) live.scrollIntoView({ block: 'center', behavior: 'instant' });
          })()`);
          await quiesce(page, 'brief');
          const file = path.join(dir, `${vpId}-form-${i + 1}.png`);
          const buf = await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', scale: 'css' });
          const { width, height } = pngSize(buf);
          res.shot = { path: path.relative(bundleDir, file), width, height, scrollY: (await page.evaluate('window.scrollY')) as number };
        }
      } catch (err) {
        res.error = callLogReason(err);
      }
      out.forms.push(res);
    }

    // ----- Dialog behaviour, actions a selection makes available, saved state across a reload -----
    const trials: TrialContext = { page, fresh, watched, setDuring: (what) => void (during = what) };
    out.dialogs = await dialogTrials(trials, openers);
    // Items are selected from repeated checkboxes outside a named group of options (filters are choices, not selections).
    const inGroup = new Set(out.toggles.filter((t) => t.choice && t.choice.role !== 'container').map((t) => t.key));
    out.flows = await flowTrials(trials, reps.filter((r) => !inGroup.has(r.key)));
    out.persistence = await persistenceTrials(trials, reps);
  } catch (err) {
    out.error = String((err as Error).message).split('\n')[0];
  } finally {
    await ctx.close();
  }
  writeJson(path.join(dir, `${vpId}.json`), out);
  return out;
}

function outcome(e: Effect): string {
  const parts: string[] = [];
  if (e.url) parts.push('the page changed address');
  if (e.invalid) parts.push(`the browser flagged ${e.invalid} field${e.invalid > 1 ? 's' : ''} as invalid`);
  if (e.newAlerts.length) parts.push(`a message appeared: ${e.newAlerts.map((t) => (t.startsWith('invalid:') ? 'a field was marked invalid' : `"${t}"`)).join('; ')}`);
  else if (e.textChanged) parts.push('the text on the page changed');
  if (e.dialogs) parts.push('a dialog or new window opened');
  if (e.requests) parts.push(`${e.requests} network request${e.requests > 1 ? 's were' : ' was'} made`);
  if (!parts.length && e.mutations) parts.push('the page was redrawn but nothing visible changed');
  return parts.join('; ') || 'nothing happened';
}
