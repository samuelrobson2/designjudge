// Behaviour trials of the Functionality probe, each from a freshly loaded page: what a choice
// changes outside itself, how an opened dialog or drawer behaves (Tab, Escape, a close control,
// the page behind), actions that a selection of items makes available, and whether what the page
// reports as saved survives a reload. Nothing here judges the outcome; diagnostics/functionality
// decides what fails.

import type { Page } from 'playwright';
import type { Rect, Step } from '../types.ts';
import type { ChoiceContext, DialogResult, Effect, FlowResult, PersistResult, ProbeControl } from './probeTypes.ts';
import { quiesce } from './settle.ts';
import { callLogReason, clickOrDispatch } from './steps.ts';

const MAX_DIALOGS = 4;
const MAX_FLOW_GROUPS = 2;
const MAX_SELECTED = 3;
const MAX_FLOW_ACTIONS = 3;
const MAX_PERSIST = 3;
const MAX_TABS = 25;
const WHEEL_PX = 600;
// The page behind a modal has scrolled when it moved at least this far.
const SCROLLED_PX = 50;

const SAVE_NAME = /\b(save|saved|favou?rite|favou?rited|wish ?list|bookmark|shortlist|watch ?list)\b|[♡♥❤☆★]/i;
// Actions that a selection makes available but that only undo it.
const UNDO_NAME = /\b(clear|reset|remove|delete|cancel|close|undo|deselect|unselect|dismiss)\b|^[×✕✖x]$/i;

export const BEHAVIOUR_FNS = `(() => {
  const F = () => window.__djF;
  const text = (e) => (e.innerText || '').replace(/\\s+/g, ' ').trim();
  const labelText = (e) => {
    const ids = (e.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
    const t = ids.map((id) => document.getElementById(id)).filter(Boolean).map(text).join(' ');
    return t || e.getAttribute('aria-label') || null;
  };
  const heading = (root) => { const h = root.querySelector('h1, h2, h3, h4, h5, h6, legend'); return h ? text(h).slice(0, 60) : null; };
  const rectOf = (e) => { const r = e.getBoundingClientRect(); const fixed = F().fixed(e); return { x: Math.round(r.x + (fixed ? 0 : scrollX)), y: Math.round(r.y + (fixed ? 0 : scrollY)), w: Math.round(r.width), h: Math.round(r.height) }; };

  // ----- Choices -----
  const GROUP_SEL = 'fieldset, [role=group], [role=radiogroup], [role=tablist], [role=toolbar], [role=listbox], [role=menu], [role=menubar]';
  const PANEL_SEL = 'aside, [role=complementary], [role=search], section, [role=region], nav, dialog, [role=dialog], form';
  const FILTER = /\\b(filters?|refine|narrow|sort|sort by|order by|view|show)\\b/i;
  const APPLY = /^(apply( filters?)?|update( results)?|done)$|^(show|see|view)\\s+\\d+/i;
  const isChoice = (e) => F().kindOf(e) === 'toggle' && !e.hasAttribute('aria-expanded') && e.tagName !== 'SUMMARY';
  const choicesIn = (root) => [...root.querySelectorAll(F().QUERY)].filter((e) => isChoice(e) && !F().hiddenTree(e) && !e.disabled);
  const choice = (p) => {
    const el = F().find(p);
    if (!el || !isChoice(el)) return null;
    let g = el.closest(GROUP_SEL);
    let role = g ? g.getAttribute('role') || g.tagName.toLowerCase() : 'container';
    if (g && choicesIn(g).length < 2) g = null;
    if (!g) {
      role = 'container';
      for (let a = el.parentElement, i = 0; a && a !== document.body && i < 4; a = a.parentElement, i++) {
        if (choicesIn(a).some((x) => x !== el && x.tagName === el.tagName)) { g = a; break; }
      }
    }
    if (!g) return null;
    const legend = g.tagName === 'FIELDSET' ? g.querySelector('legend') : null;
    const name = (legend ? text(legend) : labelText(g)) || (role === 'container' ? null : heading(g));
    const panel = g.parentElement && g.parentElement.closest(PANEL_SEL);
    const panelWords = panel ? [labelText(panel) || heading(panel) || '', panel.id, typeof panel.className === 'string' ? panel.className.replace(/[-_]/g, ' ') : ''].join(' ') : '';
    const form = el.form || el.closest('form');
    const submits = !!form && F().forms().some((f) => f.path === F().path(form) && f.submit);
    const apply = panel ? [...panel.querySelectorAll('button, [role=button], input[type=submit], input[type=button]')].find((b) => F().visible(b) && APPLY.test(F().nameOf(b))) : null;
    return { name: name ? name.slice(0, 60) : null, role, size: choicesIn(g).length, panel: panel ? F().path(panel) : null, filter: FILTER.test(name || '') || FILTER.test(panelWords), form: submits, apply: apply ? F().nameOf(apply) : null };
  };

  // ----- Dialogs and drawers -----
  const shown = (e) => {
    if (!e.isConnected || !e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    if (e.tagName === 'DIALOG' && !e.open) return false;
    const r = e.getBoundingClientRect();
    return r.width >= 40 && r.height >= 40 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
  };
  const hasControls = (e) => [...e.querySelectorAll(F().QUERY)].some(F().visible);
  const panels = () => {
    const marked = [...document.querySelectorAll('dialog, [role=dialog], [role=alertdialog], [aria-modal=true]')].filter((e) => shown(e) && !e.closest('[inert], [aria-hidden="true"]'));
    const inner = marked.filter((e) => !marked.some((o) => o !== e && e.contains(o)));
    const fixed = [];
    for (const e of document.body.querySelectorAll('*')) {
      if (e.closest('[data-dj-sentinel]') || getComputedStyle(e).position !== 'fixed') continue;
      const r = e.getBoundingClientRect();
      if (r.height < innerHeight * 0.5 || r.width < Math.min(240, innerWidth * 0.5)) continue;
      if (!shown(e) || F().hiddenTree(e) || !hasControls(e)) continue;
      if (inner.some((o) => o.contains(e) || e.contains(o)) || fixed.some((o) => o.contains(e))) continue;
      fixed.push(e);
    }
    return [...inner, ...fixed.filter((e) => !fixed.some((o) => o !== e && o.contains(e)))].map((e) => F().path(e));
  };
  const corners = () => [[4, 4], [innerWidth - 4, innerHeight - 4], [4, innerHeight - 4], [innerWidth - 4, 4], [4, Math.round(innerHeight / 2)], [innerWidth - 4, Math.round(innerHeight / 2)]];
  const outsidePoint = (e) => { const r = e.getBoundingClientRect(); return corners().find(([x, y]) => x < r.left || x > r.right || y < r.top || y > r.bottom) || null; };
  const backdropBehind = (e) => {
    const pt = outsidePoint(e);
    if (!pt) return false;
    const hit = document.elementFromPoint(pt[0], pt[1]);
    if (!hit || e.contains(hit)) return false;
    for (let a = hit; a && a !== document.documentElement; a = a.parentElement) {
      if (getComputedStyle(a).position === 'fixed') { const r = a.getBoundingClientRect(); return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9; }
    }
    return false;
  };
  const focusables = (e) => [...e.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable=true]')]
    .filter((x) => !x.disabled && x.tabIndex >= 0 && F().visible(x) && !F().hiddenTree(x));
  const CLOSE = /\\b(close|dismiss|cancel|done|back|hide)\\b|^[×✕✖x]$/i;
  const SKIP = /^(skip|jump) to\\b/i;
  const dialog = (p) => {
    const e = F().find(p);
    if (!e || !shown(e)) return null;
    const r = e.getBoundingClientRect();
    const native = e.tagName === 'DIALOG';
    const kind = native ? 'native' : /^(dialog|alertdialog)$/.test(e.getAttribute('role') || '') || e.getAttribute('aria-modal') === 'true' ? 'role' : 'panel';
    const covers = getComputedStyle(e).position === 'fixed' && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
    const modal = (native && e.matches(':modal')) || e.getAttribute('aria-modal') === 'true' || backdropBehind(e) || (kind === 'panel' && covers);
    const close = [...e.querySelectorAll('button, a[href], [role=button], input[type=button]')].find((b) => F().visible(b) && CLOSE.test((F().nameOf(b) || b.getAttribute('title') || '').trim()));
    return {
      path: p, selector: window.__djDescribe(e).selector, name: (labelText(e) || heading(e) || '').slice(0, 60) || null, rect: rectOf(e), fixed: F().fixed(e), modal, kind,
      focusables: focusables(e).length,
      close: close ? { path: F().path(close), name: F().nameOf(close) || close.getAttribute('title') || 'close', selector: window.__djDescribe(close).selector } : null,
    };
  };
  const isOpen = (p) => { const e = F().find(p); return !!e && shown(e); };
  const focusInto = (p) => {
    const e = F().find(p);
    if (!e) return false;
    if (e.contains(document.activeElement) && document.activeElement !== e) return true;
    const first = focusables(e)[0];
    if (first) first.focus();
    return e.contains(document.activeElement);
  };
  const focusWhere = (p) => {
    const e = F().find(p);
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return 'body';
    if (e && e.contains(a)) return 'inside';
    if (a.matches('a[href^="#"]') && SKIP.test(F().nameOf(a) || '')) return 'skip';
    return { selector: window.__djDescribe(a).selector, name: F().nameOf(a) || null };
  };
  const wheelPoint = (p) => { const e = F().find(p); return (e && outsidePoint(e)) || [4, 4]; };
  const topOf = (p) => { const e = F().find(p); return e && shown(e) ? Math.round(e.getBoundingClientRect().top) : null; };
  const scrollRoom = () => (document.scrollingElement || document.documentElement).scrollHeight - innerHeight;

  // ----- Selections and the actions they make available -----
  const ACTION_SEL = 'button, [role=button], input[type=button], input[type=submit]';
  const actions = () => {
    const seen = new Map();
    return [...document.querySelectorAll(ACTION_SEL)].filter((e) => !F().hiddenTree(e) && F().visible(e) && F().kindOf(e) === 'action').map((e) => {
      const s = F().sig(e);
      const n = (seen.get(s) || 0) + 1;
      seen.set(s, n);
      return { key: s + '#' + n, path: F().path(e), name: F().nameOf(e) || null, disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true', selector: window.__djDescribe(e).selector, rect: rectOf(e), fixed: F().fixed(e) };
    });
  };
  const members = (repPath) => {
    const rep = F().find(repPath);
    if (!rep) return [];
    const s = F().sig(rep);
    return [...document.querySelectorAll(rep.tagName)].filter((e) => F().sig(e) === s && !F().hiddenTree(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && (F().visible(e) || (e.labels && [...e.labels].some(F().visible))));
  };
  const selectable = (repPath) => {
    const rep = F().find(repPath);
    const d = rep && F().declared(rep);
    return !!d && d.expected === 'toggle' && (d.property === 'checked' || d.property === 'aria-checked') && !rep.closest('form');
  };
  const nextUnselected = (repPath) => {
    const m = members(repPath).find((e) => { const d = F().declared(e); return d && d.value !== 'true'; });
    if (!m) return null;
    const label = m.labels && [...m.labels].find(F().visible);
    return F().path(F().visible(m) ? m : label || m);
  };
  const groupName = (repPath) => { const rep = F().find(repPath); if (!rep) return null; const c = choice(repPath); return c && c.name; };

  // ----- What the page reports as saved -----
  const WORD = '(saved|favou?rites?|favorites?|wish ?list|shortlist(?:ed)?|bookmarks?|liked|watch ?list)';
  const COUNT = new RegExp('\\\\b' + WORD + '\\\\b\\\\D{0,6}?(\\\\d+)|(\\\\d+)\\\\D{0,6}?\\\\b' + WORD + '\\\\b', 'i');
  const MSG = /\\b(saved|added to (your )?(saved|favou?rites|favorites|wish ?list|shortlist|bookmarks|watch ?list))\\b/i;
  const texts = () => {
    const out = [];
    for (const e of document.body.querySelectorAll('*')) {
      if (e.closest('[data-dj-sentinel], script, style') || F().hiddenTree(e)) continue;
      const t = text(e);
      if (!t || t.length > 60 || [...e.children].some((c) => text(c) === t) || !F().visible(e)) continue;
      out.push({ path: F().path(e), t });
    }
    return out;
  };
  const saved = (ctrlPath) => {
    const all = texts();
    const counting = all.filter((x) => COUNT.test(x.t));
    // The smallest element showing each count, not the header around it.
    const counts = counting.filter((x) => !counting.some((y) => y !== x && y.path.startsWith(x.path + ' > '))).map((x) => { const m = x.t.match(COUNT); return { path: x.path, t: x.t, n: Number(m[2] || m[3]) }; });
    const msgs = all.filter((x) => MSG.test(x.t) && !COUNT.test(x.t)).map((x) => x.t);
    const el = F().find(ctrlPath);
    const d = el && F().declared(el);
    return { counts, msgs, control: el ? (d ? d.property + '=' + d.value + ' ' : '') + (F().nameOf(el) || '') : null, inForm: !!(el && el.closest('form')) };
  };

  window.__djB = { choice, panels, dialog, isOpen, focusInto, focusWhere, wheelPoint, topOf, scrollRoom, actions, selectable, nextUnselected, groupName, saved };
})()`;

export interface TrialContext {
  page: Page;
  fresh: (steps?: Step[]) => Promise<void>;
  watched: (act: () => Promise<void>, target?: string, own?: string) => Promise<Effect>;
  setDuring: (what: string) => void;
}

type Control = ProbeControl & { clickPath: string; steps: Step[] };

const js = (fn: string, ...args: unknown[]) => `window.__djB.${fn}(${args.map((a) => JSON.stringify(a)).join(', ')})`;

export async function choiceOf(page: Page, controlPath: string): Promise<ChoiceContext | null> {
  return ((await page.evaluate(js('choice', controlPath)).catch(() => null)) as ChoiceContext | null) ?? null;
}

export async function openPanels(page: Page): Promise<string[]> {
  return ((await page.evaluate(js('panels')).catch(() => [])) as string[]) ?? [];
}

// Something outside the control changed, or the click sent, stored, opened or moved something.
export function changedOutside(e: Effect): boolean {
  return (e.outside ?? 0) > 0 || e.url || e.requests > 0 || e.dialogs > 0 || e.calls.length > 0 || e.newAlerts.length > 0;
}

// ----- Dialogs -----

export interface Opener {
  control: Control;
  click: string;
  dialog: string;
}

interface DialogInfo {
  path: string;
  selector: string;
  name: string | null;
  rect: Rect;
  fixed: boolean;
  modal: boolean;
  kind: DialogResult['kind'];
  focusables: number;
  close: { path: string; name: string; selector: string } | null;
}

export async function dialogTrials(ctx: TrialContext, openers: Opener[]): Promise<DialogResult[]> {
  const { page } = ctx;
  const out: DialogResult[] = [];
  const seen = new Set<string>();
  for (const o of openers) {
    if (out.length >= MAX_DIALOGS) break;
    if (seen.has(`${o.control.from}|${o.dialog}`)) continue;
    seen.add(`${o.control.from}|${o.dialog}`);
    ctx.setDuring(`trying the dialog "${o.control.name ?? o.control.selector}" opens`);
    const reach = async (): Promise<DialogInfo | null> => {
      await ctx.fresh(o.control.steps);
      await clickOrDispatch(page, page.locator(o.click).first(), o.click);
      await quiesce(page, 'action');
      return (await page.evaluate(js('dialog', o.dialog))) as DialogInfo | null;
    };
    const res: DialogResult = { key: o.control.key, opener: o.control.name ?? o.control.selector, name: null, selector: '', rect: { x: 0, y: 0, w: 0, h: 0 }, modal: false, kind: 'panel', escape: null, close: null };
    try {
      const d = await reach();
      if (!d) continue;
      Object.assign(res, { name: d.name, selector: d.selector, rect: d.rect, modal: d.modal, kind: d.kind, ...(d.fixed ? { fixed: true } : {}) });
      // Escape, with focus inside the dialog.
      await page.evaluate(js('focusInto', o.dialog));
      await page.keyboard.press('Escape');
      await quiesce(page, 'action');
      res.escape = !((await page.evaluate(js('isOpen', o.dialog))) as boolean);
      if (d.close) {
        const again = await reach();
        if (again?.close) {
          await clickOrDispatch(page, page.locator(again.close.path).first(), again.close.path);
          await quiesce(page, 'action');
          res.close = { name: again.close.name, selector: again.close.selector, closed: !((await page.evaluate(js('isOpen', o.dialog))) as boolean) };
        }
      }
      if (!d.modal && !res.escape && !res.close?.closed) {
        await reach();
        await clickOrDispatch(page, page.locator(o.click).first(), o.click).catch(() => null);
        await quiesce(page, 'action');
        res.openerCloses = !((await page.evaluate(js('isOpen', o.dialog))) as boolean);
      }
      if (d.modal) {
        // Tab from the first control inside, one press past every control it holds.
        await reach();
        res.tabEscape = null;
        if ((await page.evaluate(js('focusInto', o.dialog))) as boolean) {
          const presses = Math.min(MAX_TABS, d.focusables + 2);
          for (let i = 1; i <= presses; i++) {
            await page.keyboard.press('Tab');
            await quiesce(page, 'brief');
            // Focus on the page's skip link (before everything else on the page) is not counted.
            const where = (await page.evaluate(js('focusWhere', o.dialog))) as 'inside' | 'body' | 'skip' | { selector: string; name: string | null };
            if (typeof where === 'object') {
              res.tabEscape = { ...where, after: i };
              break;
            }
          }
        }
        // The page behind, wheeled over the backdrop until it stops moving.
        await reach();
        const room = (await page.evaluate(js('scrollRoom'))) as number;
        if (room <= SCROLLED_PX) res.backgroundScrolls = null;
        else {
          const [x, y] = (await page.evaluate(js('wheelPoint', o.dialog))) as [number, number];
          const y0 = (await page.evaluate('window.scrollY')) as number;
          const top0 = (await page.evaluate(js('topOf', o.dialog))) as number | null;
          await page.mouse.move(x, y);
          // Towards the end with more room: reaching the opener may have scrolled the page to the bottom.
          await page.mouse.wheel(0, y0 < room / 2 ? WHEEL_PX : -WHEEL_PX);
          let last = -1;
          let now = (await page.evaluate('window.scrollY')) as number;
          for (let i = 0; i < 6 && now !== last; i++) {
            last = now;
            await quiesce(page, 'brief');
            now = (await page.evaluate('window.scrollY')) as number;
          }
          res.backgroundScrolls = Math.abs(now - y0) >= SCROLLED_PX;
          if (res.backgroundScrolls) {
            const top1 = (await page.evaluate(js('topOf', o.dialog))) as number | null;
            res.movesWithPage = top0 !== null && (top1 === null || Math.abs(top1 - top0) >= SCROLLED_PX);
          }
        }
      }
    } catch (err) {
      res.error = callLogReason(err).slice(0, 200);
    }
    out.push(res);
  }
  return out;
}

// ----- Actions a selection makes available -----

interface ActionInfo {
  key: string;
  path: string;
  name: string | null;
  disabled: boolean;
  selector: string;
  rect: Rect;
  fixed: boolean;
}

export async function flowTrials(ctx: TrialContext, reps: Control[]): Promise<FlowResult[]> {
  const { page } = ctx;
  const out: FlowResult[] = [];
  let groups = 0;
  for (const c of reps.filter((r) => r.kind === 'toggle' && r.members > 1 && !r.offCanvas)) {
    if (groups >= MAX_FLOW_GROUPS) break;
    ctx.setDuring(`selecting "${c.name ?? c.selector}" items`);
    try {
      await ctx.fresh(c.steps);
      if (!((await page.evaluate(js('selectable', c.path))) as boolean)) continue;
      groups++;
      const group = (await page.evaluate(js('groupName', c.path))) as string | null;
      const tried = new Set<string>();
      const select = async (k: number) => {
        for (let i = 0; i < k; i++) {
          const next = (await page.evaluate(js('nextUnselected', c.path))) as string | null;
          if (!next) return false;
          await clickOrDispatch(page, page.locator(next).first(), next);
          await quiesce(page, 'action');
        }
        return true;
      };
      for (let k = 1; k <= Math.min(MAX_SELECTED, c.members); k++) {
        await ctx.fresh(c.steps);
        const before = new Map(((await page.evaluate(js('actions'))) as ActionInfo[]).map((a) => [a.key, a]));
        if (!(await select(k))) break;
        const after = (await page.evaluate(js('actions'))) as ActionInfo[];
        const made = after.filter((a) => !a.disabled && !tried.has(a.key) && !UNDO_NAME.test(a.name ?? '') && (!before.has(a.key) || before.get(a.key)!.disabled)).slice(0, MAX_FLOW_ACTIONS);
        for (const a of made) {
          tried.add(a.key);
          const res: FlowResult = { key: c.key, group, selected: k, control: { name: a.name, selector: a.selector, rect: a.rect, fixed: a.fixed }, before: before.has(a.key) ? 'disabled' : 'absent', effect: null };
          try {
            await ctx.fresh(c.steps);
            await select(k);
            const now = ((await page.evaluate(js('actions'))) as ActionInfo[]).find((x) => x.key === a.key && !x.disabled);
            if (!now) throw new Error('it was not available again after the same selection');
            res.effect = await ctx.watched(async () => void (await clickOrDispatch(page, page.locator(now.path).first(), now.path)), now.path);
          } catch (err) {
            res.error = callLogReason(err).slice(0, 200);
          }
          out.push(res);
        }
      }
    } catch {
      // A state that cannot be reached again has no flow results.
    }
  }
  return out;
}

// ----- Saved state across a reload -----

interface SavedInfo {
  counts: { path: string; t: string; n: number }[];
  msgs: string[];
  control: string | null;
  inForm: boolean;
}

export async function persistenceTrials(ctx: TrialContext, reps: Control[]): Promise<PersistResult[]> {
  const { page } = ctx;
  const out: PersistResult[] = [];
  for (const c of reps.filter((r) => (r.kind === 'action' || r.kind === 'toggle') && r.from === 'load' && !r.offCanvas && SAVE_NAME.test(r.name ?? ''))) {
    if (out.length >= MAX_PERSIST) break;
    ctx.setDuring(`saving with "${c.name ?? c.selector}"`);
    const res: PersistResult = { key: c.key, claim: null };
    try {
      await ctx.fresh();
      const s0 = (await page.evaluate(js('saved', c.path))) as SavedInfo;
      if (s0.inForm) continue;
      await clickOrDispatch(page, page.locator(c.clickPath).first(), c.clickPath);
      await quiesce(page, 'action');
      const s1 = (await page.evaluate(js('saved', c.path))) as SavedInfo;
      const changed = s1.counts.find((x) => !s0.counts.some((y) => y.path === x.path && y.n === x.n));
      const message = s1.msgs.find((m) => !s0.msgs.includes(m));
      if (changed) {
        res.claim = 'count';
        res.claimText = changed.t;
        res.before = s0.counts.find((y) => y.path === changed.path)?.t ?? null;
        res.after = changed.t;
      } else if (message) {
        res.claim = 'message';
        res.claimText = message;
        res.before = s0.control;
        res.after = s1.control;
      } else {
        out.push(res);
        continue;
      }
      await page.reload({ waitUntil: 'load', timeout: 30_000 });
      await quiesce(page, 'load');
      const s2 = (await page.evaluate(js('saved', c.path))) as SavedInfo;
      if (res.claim === 'count') {
        const word = (t: string) => t.replace(/\d+/g, '#');
        const again = s2.counts.find((y) => y.path === changed!.path) ?? s2.counts.find((y) => word(y.t) === word(changed!.t));
        res.reloaded = again?.t ?? null;
        res.persisted = !!again && again.n === changed!.n;
      } else {
        res.reloaded = s2.control;
        res.persisted = s1.control === s0.control ? null : s2.control === s1.control;
      }
    } catch (err) {
      res.error = callLogReason(err).slice(0, 200);
    }
    out.push(res);
  }
  return out;
}
