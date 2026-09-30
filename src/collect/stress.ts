// Fills the stress state the way a thorough user would: empty text fields get long text,
// dropdowns their longest option, unchecked checkboxes are checked, and single-choice groups
// with nothing chosen get their longest option. A change that navigates, opens a dialog or a
// large overlay, or removes content (a filter narrowing results) is undone by reloading and
// replaying the kept changes, so the state stays dense.

import type { Page } from 'playwright';
import { lite, measureChange, type LiteSnapshot } from './discover.ts';
import { waitForSettled } from './settle.ts';

type FillKind = 'fill' | 'choose' | 'select' | 'check';

export interface FillTarget {
  kind: FillKind;
  selector: string;
  label: string;
  type: string;
  signature: string;
  attrs?: { maxLength: number; min: string; max: string; autocomplete: string; name: string; id: string };
  value?: string;
  optionText?: string;
}

export interface StressAction {
  kind: FillKind;
  control: string;
  selector: string;
  value?: string;
  outcome: 'kept' | 'undone' | 'failed' | 'skipped';
  reason?: string;
}

export interface StressFill {
  actions: StressAction[];
  kept: Record<FillKind, number>;
}

const MAX_ACTIONS = 30;
// Repeated per-item controls (a "Compare" box on every card) are tried a few times, not on every item.
const MAX_PER_SIGNATURE = 4;
// Choices first, typing last: choices often re-render the page, which can drop typed values.
const ORDER: Record<FillKind, number> = { choose: 0, select: 1, check: 2, fill: 3 };

const NAME = '[Ŵîĺĥéĺḿîñá Ķöñšţáñţîñöþöûĺöš-Ŵéĺĺîñĝţöñ]';
const TEXT = '[Á ĺöñĝéŕ éñţŕý ţĥáţ ţéšţš ĥöŵ ţĥîš ƒîéĺđ ĥáñđĺéš éxţŕá ţéxţ]';
const PARAGRAPH =
  '[Ţĥîš îš á ĺöñĝéŕ ḿéššáĝé ŵîţĥ šéṽéŕáĺ šéñţéñçéš. Ĩţ çĥéçķš ĥöŵ ţĥé ƒîéĺđ áñđ ţĥé ĺáýöûţ áŕöûñđ îţ ĥáñđĺé ţéxţ ţĥáţ ŵŕáþš öṽéŕ ḿáñý ĺîñéš. Ŵöŕđš ĺîķé Ķöñšţáñţîñöþöûĺöš-Ŵéĺĺîñĝţöñ áŕé ĺöñĝ áñđ ĥáŕđ ţö ƀŕéáķ.]';

const clamp = (v: string, min: string, max: string) => (min && v < min ? min : max && v > max ? max : v);

export function fillValue(t: FillTarget): string {
  const a = t.attrs ?? { maxLength: -1, min: '', max: '', autocomplete: '', name: '', id: '' };
  const byType: Record<string, string> = {
    email: 'wilhelmina.konstantinopoulos-wellington@example-international.co.uk',
    tel: '+44 20 7946 0958 ext. 1234',
    url: 'https://www.example-international-organisation.co.uk/a/very/long/path',
    password: 'correct-horse-battery-staple-2026',
    number: a.max || (a.min && Number(a.min) > 1234567 ? a.min : '1234567'),
    date: clamp('2026-12-31', a.min, a.max),
    time: clamp('23:45', a.min, a.max),
    'datetime-local': clamp('2026-12-31T23:45', a.min, a.max),
    month: clamp('2026-12', a.min, a.max),
    week: clamp('2026-W52', a.min, a.max),
    textarea: PARAGRAPH,
  };
  const v = byType[t.type] ?? (/name/i.test(`${a.autocomplete} ${a.name} ${a.id}`) ? NAME : TEXT);
  return a.maxLength > 0 ? v.slice(0, a.maxLength) : v;
}

const TARGETS_SCRIPT = `(() => {
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
  const visible = (el) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  };
  const usable = (el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[inert], [aria-hidden="true"]');
  const text = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const labelOf = (el) => text(el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('placeholder') || el.innerText || el.getAttribute('name') || '').slice(0, 60);
  const classes = (el) => (el ? [...el.classList].filter((c) => !/^(is-|has-)|active|selected|open|checked/.test(c)).sort().join('.') : '');
  const sig = (kind, el) => [kind, el.tagName, el.getAttribute('type') || el.getAttribute('role') || '', classes(el), el.getAttribute('name') || '', classes(el.parentElement)].join('|');
  // A visually hidden native input is operated through its visible label.
  const target = (el) => (visible(el) ? el : (el.labels && [...el.labels].find(visible)) || null);
  const out = [];
  const FILLABLE = ['', 'text', 'search', 'email', 'tel', 'url', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week'];
  for (const el of document.querySelectorAll('input, textarea')) {
    const type = el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('type') || '').toLowerCase();
    if (el.tagName === 'INPUT' && !FILLABLE.includes(type)) continue;
    if (!visible(el) || !usable(el) || el.readOnly || el.value) continue;
    out.push({
      kind: 'fill', selector: path(el), label: labelOf(el), type: type || 'text', signature: sig('fill', el) + '|' + path(el),
      attrs: { maxLength: el.maxLength, min: el.min || '', max: el.max || '', autocomplete: el.getAttribute('autocomplete') || '', name: el.name || '', id: el.id || '' },
    });
  }
  for (const el of document.querySelectorAll('select')) {
    if (el.multiple || !visible(el) || !usable(el)) continue;
    const opts = [...el.options].filter((o) => !o.disabled);
    if (!opts.length) continue;
    const longest = opts.reduce((a, o) => (text(o.text).length > text(a.text).length ? o : a));
    if (longest.index === el.selectedIndex) continue;
    out.push({ kind: 'select', selector: path(el), label: labelOf(el), type: 'dropdown', signature: sig('select', el) + '|' + path(el), value: longest.value, optionText: text(longest.text).slice(0, 60) });
  }
  for (const el of document.querySelectorAll('input[type=checkbox], [role=checkbox], [role=switch]')) {
    const native = el.tagName === 'INPUT';
    if ((native ? el.checked : el.getAttribute('aria-checked') === 'true') || !usable(el)) continue;
    const t = native ? target(el) : visible(el) ? el : null;
    if (!t) continue;
    out.push({ kind: 'check', selector: path(t), label: labelOf(el), type: native ? 'checkbox' : el.getAttribute('role'), signature: sig('check', el) });
  }
  // Single-choice groups with nothing chosen: native radios by name; ARIA radios and toggle buttons by parent.
  const groups = new Map();
  for (const el of document.querySelectorAll('input[type=radio], [role=radio], button[aria-pressed]')) {
    const key = el.tagName === 'INPUT' && el.name ? 'name:' + el.name : 'parent:' + path(el.parentElement);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el);
  }
  for (const [key, members] of groups) {
    const on = (el) => (el.tagName === 'INPUT' ? el.checked : el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true');
    if (members.some(on)) continue;
    const options = members.filter(usable).map((el) => ({ el, t: el.tagName === 'INPUT' ? target(el) : visible(el) ? el : null })).filter((o) => o.t);
    if (!options.length) continue;
    const best = options.reduce((a, o) => (labelOf(o.el).length > labelOf(a.el).length ? o : a));
    const type = best.el.tagName === 'INPUT' ? 'radio' : best.el.getAttribute('role') || 'toggle button';
    out.push({ kind: 'choose', selector: path(best.t), label: labelOf(best.el), type, signature: sig('choose', best.el) + '|' + key });
  }
  return out;
})()`;

const isOn = (selector: string) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const c = el.tagName === 'LABEL' ? el.control : el;
  if (!c) return false;
  return c.tagName === 'INPUT' ? c.checked : c.getAttribute('aria-checked') === 'true' || c.getAttribute('aria-pressed') === 'true';
})()`;

async function apply(page: Page, t: FillTarget, blur = true): Promise<'done' | 'skipped'> {
  const loc = page.locator(t.selector).first();
  if (t.kind === 'fill') {
    await loc.fill(fillValue(t), { timeout: 2000 });
    if (blur) await loc.blur({ timeout: 1000 }).catch(() => {});
    return 'done';
  }
  if (t.kind === 'select') {
    await loc.selectOption(t.value!, { timeout: 2000 });
    return 'done';
  }
  if (await page.evaluate(isOn(t.selector))) return 'skipped';
  try {
    await loc.click({ timeout: 2000 });
  } catch {
    await loc.dispatchEvent('click', undefined, { timeout: 1000 });
  }
  return 'done';
}

export function undoReason(before: LiteSnapshot, after: LiteSnapshot): string | null {
  if (after.url.split('#')[0] !== before.url.split('#')[0]) return 'it navigated to another page';
  const ch = measureChange(before, after);
  const vpArea = after.vw * after.vh;
  if (ch.dialogs) return 'it opened a dialog';
  if (ch.largestOverlayArea > 0.3 * vpArea) return 'it opened an overlay covering much of the screen';
  if (ch.disappearedArea - ch.appearedArea > 0.1 * vpArea || ch.heightChange < -Math.max(150, 0.15 * after.vh)) {
    return 'it removed content (for example, a filter narrowed the results)';
  }
  return null;
}

// `reload` must load the page afresh and wait for it to settle. Targets are re-read after every
// action, because filters, sorting and reloads re-render the page and invalidate selectors;
// controls already filled, chosen or checked drop out of the list by themselves.
export async function fillForStress(page: Page, reload: () => Promise<void>): Promise<StressFill> {
  const actions: StressAction[] = [];
  const kept: FillTarget[] = [];
  const attempted = new Set<string>();
  const undone = new Set<string>();
  const tries = new Map<string, number>();
  const control = (t: FillTarget) => `${t.type}${t.label ? ` "${t.label}"` : ''}`;

  while (actions.length < MAX_ACTIONS) {
    const t = ((await page.evaluate(TARGETS_SCRIPT)) as FillTarget[])
      .filter((t) => !attempted.has(`${t.signature}|${t.label}|${t.selector}`) && !undone.has(t.signature) && (tries.get(t.signature) ?? 0) < MAX_PER_SIGNATURE)
      .sort((a, b) => ORDER[a.kind] - ORDER[b.kind])[0];
    if (!t) break;
    attempted.add(`${t.signature}|${t.label}|${t.selector}`);
    tries.set(t.signature, (tries.get(t.signature) ?? 0) + 1);
    const base = { kind: t.kind, control: control(t), selector: t.selector, value: t.kind === 'fill' ? fillValue(t) : t.optionText };
    const before = await lite(page);
    try {
      if ((await apply(page, t)) === 'skipped') {
        actions.push({ ...base, outcome: 'skipped', reason: 'already on' });
        continue;
      }
    } catch (err) {
      actions.push({ ...base, outcome: 'failed', reason: (err as Error).message.split('\n')[0].slice(0, 160) });
      continue;
    }
    await waitForSettled(page, null, true);
    const reason = undoReason(before, await lite(page));
    if (!reason) {
      kept.push(t);
      actions.push({ ...base, outcome: 'kept' });
      continue;
    }
    undone.add(t.signature);
    actions.push({ ...base, outcome: 'undone', reason });
    await reload();
    for (const k of kept) await apply(page, k).catch(() => 'skipped');
    await waitForSettled(page, null, true);
  }
  await page.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur()');
  await waitForSettled(page, null, true);
  // Pages that re-render on change without keeping input values empty a field when it loses
  // focus; such a field is typed into again and left focused, as it would be mid-typing.
  for (const k of kept.filter((k) => k.kind === 'fill')) {
    const emptied = await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(k.selector)}); return !!el && !el.value; })()`);
    if (emptied) await apply(page, k, false).catch(() => 'skipped');
  }
  const counts: Record<FillKind, number> = { fill: 0, choose: 0, select: 0, check: 0 };
  for (const k of kept) counts[k.kind]++;
  return { actions, kept: counts };
}
