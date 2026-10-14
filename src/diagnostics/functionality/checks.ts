// Functionality diagnostics: the six checks of functionality_rubric.md taken from the source
// rubric (Interactive Control Operability, No-Effect Action Controls, Editable Control Response,
// Toggle / Selection State, Internal Navigation Integrity, Form Submission Response) and two added
// for review (Invalid Submission Feedback, Runtime Errors). Each reads what the Functionality
// probe (collect/functional.ts) recorded when it used the controls; a control's result belongs to
// the state it was found in (the page at load at its viewport, or an interactive state).

import { hasEffect, submissionEffect, visibleResponse } from '../../collect/probeStore.ts';
import type { Effect, FunctionalProbe, ProbeControl } from '../../collect/probeTypes.ts';
import type { DiagnosticItem, ElementRef, StateRecord } from '../../types.ts';
import type { CheckOutput } from '../layout/deterministic.ts';

type PerState = Map<string, CheckOutput>;

const plural = (n: number, one: string, many = /(s|x|ch|sh)$/.test(one) ? `${one}es` : `${one}s`) => `${n} ${n === 1 ? one : many}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function list(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const NOUN: Record<string, string> = {
  button: 'button',
  link: 'link',
  textbox: 'field',
  combobox: 'dropdown',
  checkbox: 'checkbox',
  radio: 'option',
  switch: 'switch',
  tab: 'tab',
  option: 'option',
  menuitem: 'menu item',
  searchbox: 'search field',
  spinbutton: 'number field',
};

export function controlName(c: Pick<ProbeControl, 'name' | 'role' | 'tag' | 'kind'>): string {
  const noun = (c.role && NOUN[c.role]) ?? (c.tag === 'tr' ? 'table row' : c.kind === 'field' ? 'field' : c.tag === 'select' ? 'dropdown' : 'control');
  const name = (c.name ?? '').replace(/\s+/g, ' ').trim();
  const short = name.length > 44 ? `${name.slice(0, 43)}…` : name;
  return short ? `the "${short}" ${noun}` : `an unlabelled ${noun}`;
}

function others(c: ProbeControl): string {
  if (c.members <= 1) return '';
  const more = c.members - 1;
  return ` (and ${plural(more, `other ${controlName(c).split('" ').pop()}`)} like it${c.memberNames.length ? `, such as ${list(c.memberNames.slice(0, 2).map((n) => `"${n.length > 30 ? `${n.slice(0, 29)}…` : n}"`))}` : ''})`;
}

function ref(c: Pick<ProbeControl, 'selector' | 'tag' | 'name' | 'componentId' | 'rect' | 'fixed'>): ElementRef {
  return { id: 0, selector: c.selector, tag: c.tag, name: c.name, componentId: c.componentId, rect: c.rect, ...(c.fixed ? { fixed: true } : {}) };
}

function stateOf(probe: FunctionalProbe, c: ProbeControl | undefined): string {
  return !c || c.from === 'load' ? probe.viewport : c.from;
}

function collect(probe: FunctionalProbe, entries: { key: string; ok: boolean; summary: string; elements: ElementRef[]; data: Record<string, unknown> }[], text: { pass: (n: number) => string; fail: (bad: number, n: number) => string }): PerState {
  const byKey = new Map(probe.controls.map((c) => [c.key, c]));
  const out: PerState = new Map();
  const grouped = new Map<string, typeof entries>();
  for (const e of entries) {
    const st = stateOf(probe, byKey.get(e.key));
    grouped.set(st, [...(grouped.get(st) ?? []), e]);
  }
  for (const [stateId, es] of grouped) {
    const bad = es.filter((e) => !e.ok);
    const items: DiagnosticItem[] = bad.map((e, i) => ({ n: i + 1, summary: e.summary, elements: e.elements, data: e.data }));
    out.set(stateId, { status: bad.length ? 'fail' : 'pass', evaluated: es.length, summary: bad.length ? text.fail(bad.length, es.length) : text.pass(es.length), items, secondary: [] });
  }
  return out;
}

// Playwright's reason in plain words.
function reasonText(reason: string | undefined): string {
  const r = reason ?? '';
  const covered = r.match(/<(\w+)[^>]*?(?:class="([^"]*)")?[^>]*>.*?intercepts pointer events/);
  if (covered) return `another element (${covered[1]}${covered[2] ? `.${covered[2].split(/\s+/)[0]}` : ''}) lies on top of it and takes the click`;
  if (/intercepts pointer events/.test(r)) return 'another element lies on top of it and takes the click';
  if (/outside of the viewport/.test(r)) return 'it lies outside the screen and cannot be scrolled into view';
  if (/not visible/.test(r)) return 'it is not visible';
  if (/not stable/.test(r)) return 'it keeps moving, so it cannot be clicked';
  if (/not enabled/.test(r)) return 'it is not enabled';
  if (/detached|not attached/.test(r)) return 'it is removed from the page as it is approached';
  if (/Timeout/.test(r)) return 'it could not be clicked within the time limit';
  return r.slice(0, 160);
}

// ---------- Interactive Control Operability ----------

export function controlOperability(probe: FunctionalProbe): PerState {
  const byKey = new Map(probe.controls.map((c) => [c.key, c]));
  return collect(
    probe,
    probe.operability.map((o) => {
      const c = byKey.get(o.key)!;
      const who = o.member ? controlName({ ...c, name: o.member.name }) : controlName(c);
      return {
        key: o.key,
        ok: o.ok,
        summary: `${capital(who)} cannot be used: ${reasonText(o.reason)}`,
        elements: [ref(o.member ? { ...c, ...o.member } : c)],
        data: { reason: o.reason ?? null, control: who },
      };
    }),
    { pass: (n) => `All ${n} controls tried can be clicked (or focused) as they are.`, fail: (b, n) => `${b} of ${n} controls tried cannot be clicked or focused.` },
  );
}

// ---------- No-Effect Action Controls ----------

export function noEffectControls(probe: FunctionalProbe): PerState {
  const byKey = new Map(probe.controls.map((c) => [c.key, c]));
  return collect(
    probe,
    probe.actions
      .filter((a) => a.effect)
      .map((a) => {
        const c = byKey.get(a.key)!;
        const ok = hasEffect(a.effect!);
        return {
          key: a.key,
          ok,
          summary: `${capital(controlName(c))}${others(c)} does nothing when clicked: the address, the page's content and its controls stay the same, and nothing is sent or opened`,
          elements: [ref(c)],
          data: { control: controlName(c), members: c.members, effect: a.effect },
        };
      }),
    { pass: (n) => `All ${n} action controls tried have a detectable effect.`, fail: (b, n) => `${b} of ${n} action controls tried have no detectable effect.` },
  );
}

// ---------- Editable Control Response ----------

export function editableResponse(probe: FunctionalProbe): PerState {
  const byKey = new Map(probe.controls.map((c) => [c.key, c]));
  return collect(
    probe,
    probe.fields.map((f) => {
      const c = byKey.get(f.key)!;
      return {
        key: f.key,
        ok: f.ok,
        summary: `${capital(controlName(c))} does not keep what was entered: "${f.attempted}" was entered and it ends up ${f.result === null ? 'gone' : f.result === '' ? 'empty' : `"${f.result}"`}${f.note ? ` (${f.note})` : ''}`,
        elements: [ref(c)],
        data: { attempted: f.attempted, result: f.result, note: f.note ?? null },
      };
    }),
    { pass: (n) => `All ${n} fields tried accept and keep a typed or chosen value.`, fail: (b, n) => `${b} of ${n} fields tried do not keep the value entered.` },
  );
}

// ---------- Toggle / Selection State ----------

export function toggleState(probe: FunctionalProbe): PerState {
  const byKey = new Map(probe.controls.map((c) => [c.key, c]));
  return collect(
    probe,
    probe.toggles.filter((t) => !t.error).map((t) => {
      const c = byKey.get(t.key)!;
      const declared = t.expected === 'toggle' ? t.after !== t.before : t.after === 'true';
      const why = t.note ?? (declared ? 'it changed as expected' : `${t.property} stays "${t.after ?? 'unset'}"`);
      return {
        key: t.key,
        ok: t.ok,
        summary: `Clicking ${controlName(c)}${others(c)} does not update its state consistently: ${why}${!declared && !t.note ? ` (it was "${t.before ?? 'unset'}")` : ''}`,
        elements: [ref(c)],
        data: { property: t.property, before: t.before, after: t.after, renderedChange: t.renderedChange, controls: t.controls ?? null },
      };
    }),
    { pass: (n) => `All ${n} toggles and selectable controls tried update their declared and shown state together.`, fail: (b, n) => `${b} of ${n} toggles and selectable controls tried do not update their state consistently.` },
  );
}

// ---------- Internal Navigation Integrity ----------

export function navigationIntegrity(probe: FunctionalProbe): PerState {
  const byKey = new Map(probe.controls.map((c) => [c.key, c]));
  return collect(
    probe,
    probe.links.filter((l) => !l.error).map((l) => {
      const c = byKey.get(l.key)!;
      const summary =
        l.target === 'placeholder'
          ? `${capital(controlName(c))}${others(c)} has href="${l.href}" and leads nowhere: ${l.detail}`
          : l.target === 'fragment'
            ? `${capital(controlName(c))} points to ${l.href}, but ${l.detail}`
            : `${capital(controlName(c))} (${l.href}) ${l.detail}`;
      return { key: l.key, ok: l.ok, summary, elements: [ref(c)], data: { href: l.href, target: l.target, status: l.status ?? null } };
    }),
    { pass: (n) => `All ${n} same-page and same-site links tried reach a valid target.`, fail: (b, n) => `${b} of ${n} same-page and same-site links tried do not reach a valid target.` },
  );
}

// ---------- Form Submission Response and Invalid Submission Feedback ----------

function formName(f: FunctionalProbe['forms'][number]): string {
  return f.name ? `the "${f.name}" form` : 'the form';
}

function filledText(f: FunctionalProbe['forms'][number]): string {
  const quoted = (xs: string[]) => list(xs.map((n) => `"${n.length > 30 ? `${n.slice(0, 29)}…` : n}"`));
  const parts = [f.filled.length ? `${quoted(f.filled.slice(0, 5))} filled in` : '', f.chosen.length ? `${quoted(f.chosen.slice(0, 3))} chosen` : ''].filter(Boolean);
  const lost = f.lost?.length ? `${quoted(f.lost)} could not be filled in (${f.lost.length > 1 ? 'they do' : 'it does'} not keep a value)` : '';
  return [...parts, lost].filter(Boolean).join(', ') || 'with nothing to fill in';
}

export function describeSubmission(f: FunctionalProbe['forms'][number]): string {
  return `Submitted ${formName(f)}${f.submit ? ` with "${f.submit}"` : ''}: ${filledText(f)}${f.refilled.length ? ` (${list(f.refilled.map((n) => `"${n}"`))} had to be entered twice, because the first entry was lost)` : ''}. Result: ${f.outcome || 'nothing happened'}.`;
}

function formState(
  probe: FunctionalProbe,
  entries: { ok: boolean; summary: string; data: Record<string, unknown> }[],
  text: { pass: (n: number) => string; fail: (b: number, n: number) => string },
  secondary: CheckOutput['secondary'] = [],
): PerState {
  const out: PerState = new Map();
  if (!entries.length && !secondary.length) return out;
  const bad = entries.filter((e) => !e.ok);
  out.set(probe.viewport, {
    status: bad.length ? 'fail' : 'pass',
    evaluated: entries.length,
    summary: bad.length ? text.fail(bad.length, entries.length) : text.pass(entries.length),
    items: bad.map((e, i) => ({ n: i + 1, summary: e.summary, elements: [], data: e.data })),
    secondary,
  });
  return out;
}

// With every field already holding a value there is nothing to enter, so the submission repeats
// what the page already shows; a redraw is then the expected response, not a missing one.
const resubmitted = (f: FunctionalProbe['forms'][number]) => !f.filled.length && !f.chosen.length && !f.lost.length && f.valid!.mutations > 0 && !submissionEffect(f.valid!);

export function formSubmission(probe: FunctionalProbe): PerState {
  const tried = probe.forms.filter((f) => f.valid);
  const unchanged = tried.filter(resubmitted);
  return formState(
    probe,
    tried
      .filter((f) => !resubmitted(f))
      .map((f) => ({
        ok: submissionEffect(f.valid!),
        summary: `${capital(formName(f))} gives no response to a filled-in submission. ${describeSubmission(f)}`,
        data: { form: f.name, submit: f.submit, filled: f.filled, chosen: f.chosen, outcome: f.outcome, shot: f.shot?.path ?? null },
      })),
    {
      pass: (n) => (n ? `All ${n} forms respond when submitted with valid values.` : 'Every form already held values, so each was resubmitted unchanged; the page was redrawn with the same result.'),
      fail: (b, n) => `${b} of ${n} forms give no response when submitted with valid values.`,
    },
    unchanged.length
      ? [{ kind: 'resubmitted', label: 'forms whose fields already held values, resubmitted unchanged (the page was redrawn with the same result)', items: unchanged.map((f, i) => ({ n: i + 1, summary: `${formName(f)}${f.submit ? ` with "${f.submit}"` : ''}`, elements: [], data: { form: f.name } })) }]
      : [],
  );
}

// Only forms that respond to a valid submission are judged here, so a form that does nothing at
// all is reported once, by Form Submission Response.
export function invalidSubmission(probe: FunctionalProbe): PerState {
  return formState(
    probe,
    probe.forms
      .filter((f) => f.valid && f.empty && submissionEffect(f.valid))
      .map((f) => ({
        ok: visibleResponse(f.empty!),
        summary: `Submitting ${formName(f)} empty${f.submit ? ` (with "${f.submit}")` : ''} gives no visible response: ${f.emptyOutcome || 'nothing happened'}, while a filled-in submission does respond`,
        data: { form: f.name, outcome: f.emptyOutcome ?? '' },
      })),
    { pass: (n) => `All ${n} forms tried respond visibly when submitted empty.`, fail: (b, n) => `${b} of ${n} forms tried give no visible response when submitted empty.` },
  );
}

// ---------- Runtime Errors ----------

const HARNESS_MESSAGE = /^injected script failed|^Failed to load resource/;

export function runtimeErrors(states: { state: StateRecord; origin: string | null }[], probes: FunctionalProbe[]): PerState {
  const out: PerState = new Map();
  const add = (stateId: string, messages: string[], evaluated: string) => {
    const unique = [...new Set(messages)];
    const items: DiagnosticItem[] = unique.slice(0, 12).map((m, i) => ({ n: i + 1, summary: m, elements: [], data: { message: m, count: messages.filter((x) => x === m).length } }));
    const prev = out.get(stateId);
    if (prev) {
      for (const it of items) if (!prev.items.some((p) => p.summary === it.summary)) prev.items.push({ ...it, n: prev.items.length + 1 });
      prev.status = prev.items.length ? 'fail' : 'pass';
      prev.evaluated += 1;
      prev.summary = prev.items.length ? `${plural(prev.items.length, 'distinct error')} while loading or using the page.` : prev.summary;
      return;
    }
    out.set(stateId, {
      status: items.length ? 'fail' : 'pass',
      evaluated: 1,
      summary: items.length ? `${plural(items.length, 'distinct error')} while ${evaluated}.` : `No uncaught errors, console errors or failed same-site requests while ${evaluated}.`,
      items,
      secondary: [],
    });
  };
  for (const { state, origin } of states) {
    const messages = [
      ...state.consoleErrors.filter((m) => !HARNESS_MESSAGE.test(m)).map((m) => (m.startsWith('pageerror: ') ? `Uncaught error on load: ${m.slice(11)}` : `Console error on load: ${m}`)),
      ...state.network.failed.filter((f) => origin && f.startsWith(origin) && !/favicon\.ico/.test(f)).map((f) => `Request failed on load: ${f.slice(origin!.length)}`),
    ];
    add(state.id, messages, 'loading the page');
  }
  for (const p of probes) {
    const messages = p.errors.filter((e) => !HARNESS_MESSAGE.test(e.message.replace(/^Console error: /, ''))).map((e) => `${e.message} (while ${e.during})`);
    add(p.viewport, messages, 'using the controls');
  }
  return out;
}

// ---------- Read by Functionality v2 and later: behaviour trials ----------

const quote = (s: string | null | undefined, n = 50) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return `"${t.length > n ? `${t.slice(0, n - 1)}…` : t}"`;
};

// No-Effect Choice Controls: an option in a named group (a filter, sort or view choice, or a group
// beside others in the same panel that do change the page) that changes nothing beyond itself.
// Options in a form with a submit button, or in a panel with an Apply button, wait to be applied.
export function choiceEffect(probe: FunctionalProbe): PerState {
  const byKey = new Map(probe.controls.map((c) => [c.key, c]));
  const named = probe.toggles.filter((t) => t.choice && t.choice.role !== 'container' && t.outside !== undefined && !t.error);
  const moves = named.filter((t) => t.outside);
  const took = (t: FunctionalProbe['toggles'][number]) => (t.expected === 'toggle' ? t.after !== t.before : t.after === 'true' && t.before !== 'true');
  return collect(
    probe,
    named
      .filter((t) => {
        const ch = t.choice!;
        if (ch.form || ch.apply || ch.size < 2 || !took(t)) return false;
        const st = stateOf(probe, byKey.get(t.key));
        return ch.filter || moves.some((m) => m.key !== t.key && m.choice!.panel === ch.panel && stateOf(probe, byKey.get(m.key)) === st);
      })
      .map((t) => {
        const c = byKey.get(t.key)!;
        const ch = t.choice!;
        return {
          key: t.key,
          ok: !!t.outside,
          summary: `Choosing ${controlName(c)}${others(c)}${ch.name ? ` in the ${quote(ch.name)} group` : ''} changes nothing beyond the option itself: the rest of the page stays the same, and nothing is sent, stored or opened`,
          elements: [ref(c)],
          data: { group: ch.name, role: ch.role, filter: ch.filter, members: c.members },
        };
      }),
    { pass: (n) => `All ${n} filter and choice options tried change the page beyond themselves.`, fail: (b, n) => `${b} of ${n} filter and choice options tried change nothing beyond themselves.` },
  );
}

// Dependent Action Response: an action that a selection of items made available (it appeared, or
// stopped being disabled, once the fewest items were selected) and that does nothing when used.
export function dependentActions(probe: FunctionalProbe): PerState {
  return collect(
    probe,
    (probe.flows ?? [])
      .filter((f) => f.effect)
      .map((f) => {
        const name = f.control.name ? `the ${quote(f.control.name, 40)} button` : 'an unlabelled button';
        return {
          key: f.key,
          ok: hasEffect(f.effect!),
          summary: `After ${plural(f.selected, 'item')} ${f.selected === 1 ? 'is' : 'are'} selected${f.group ? ` in ${quote(f.group)}` : ''}, ${name} ${f.before === 'disabled' ? 'becomes enabled' : 'appears'}, but clicking it does nothing: the address, the page's content and its controls stay the same, and nothing is sent or opened`,
          elements: [{ id: 0, selector: f.control.selector, tag: 'button', name: f.control.name, componentId: null, rect: f.control.rect, ...(f.control.fixed ? { fixed: true } : {}) }],
          data: { selected: f.selected, control: f.control.name, before: f.before, effect: f.effect },
        };
      }),
    { pass: (n) => `All ${n} actions that a selection made available have an effect.`, fail: (b, n) => `${b} of ${n} actions that a selection made available do nothing.` },
  );
}

// Saved State Persistence: what the page reported as saved (a saved-items count that changed, or a
// "Saved" message with the control showing it) is gone after the page is reloaded.
export function savedPersistence(probe: FunctionalProbe): PerState {
  const byKey = new Map(probe.controls.map((c) => [c.key, c]));
  return collect(
    probe,
    (probe.persistence ?? [])
      .filter((r) => r.claim && typeof r.persisted === 'boolean' && !r.error)
      .map((r) => {
        const c = byKey.get(r.key)!;
        const summary =
          r.claim === 'count'
            ? `After ${controlName(c)}${others(c)} is used, the page shows ${quote(r.after)} (it showed ${r.before ? quote(r.before) : 'no count'}), but after the page is reloaded it shows ${r.reloaded ? quote(r.reloaded) : 'no such count'}: what it reported as saved is not kept`
            : `After ${controlName(c)}${others(c)} is used, the page says ${quote(r.claimText)}, but after the page is reloaded the control is back to how it was: what it reported as saved is not kept`;
        return { key: r.key, ok: !!r.persisted, summary, elements: [ref(c)], data: { claim: r.claim, claimText: r.claimText ?? null, before: r.before ?? null, after: r.after ?? null, reloaded: r.reloaded ?? null } };
      }),
    { pass: (n) => `All ${n} saves the page reported are still shown after a reload.`, fail: (b, n) => `${b} of ${n} saves the page reported are lost on a reload.` },
  );
}

// Dialog Behaviour: a dialog or drawer a control opened that cannot be closed (Escape, a close
// control inside it, or, for a non-modal panel, its opener), and for a modal one, Tab that leaves
// it or a page behind that scrolls under it and carries it away. A page that scrolls behind a
// modal held in place (as behind a native modal dialog) is not reported.
export function dialogBehaviour(probe: FunctionalProbe): PerState {
  const byKey = new Map(probe.controls.map((c) => [c.key, c]));
  return collect(
    probe,
    (probe.dialogs ?? [])
      .filter((d) => !d.error && d.escape !== null)
      .map((d) => {
        const c = byKey.get(d.key)!;
        const problems: string[] = [];
        const closes = d.escape || !!d.close?.closed || (!d.modal && !!d.openerCloses);
        if (!closes) problems.push(d.close ? `neither Escape nor its ${quote(d.close.name, 30)} control closes it` : d.modal ? 'neither Escape nor any close control inside it closes it' : 'neither Escape, a close control nor the control that opened it closes it');
        if (d.modal && d.tabEscape) problems.push(`Tab moves focus out of it to ${d.tabEscape.name ? quote(d.tabEscape.name, 40) : d.tabEscape.selector.split(' > ').pop()} on the page behind`);
        if (d.modal && d.backgroundScrolls && d.movesWithPage) problems.push('wheeling over the page behind scrolls that page and carries the dialog out of place');
        const what = `${d.modal ? 'modal ' : ''}${d.kind === 'panel' ? 'panel' : 'dialog'}${d.name ? ` ${quote(d.name, 40)}` : ''}`;
        return {
          key: d.key,
          ok: !problems.length,
          summary: `The ${what} that ${controlName(c)} opens: ${problems.join('; ')}`,
          elements: [{ id: 0, selector: d.selector, tag: d.kind === 'native' ? 'dialog' : 'div', name: d.name, componentId: null, rect: d.rect, ...(d.fixed ? { fixed: true } : {}) }],
          data: { modal: d.modal, kind: d.kind, escape: d.escape, close: d.close, openerCloses: d.openerCloses ?? null, tabEscape: d.tabEscape ?? null, backgroundScrolls: d.backgroundScrolls ?? null, movesWithPage: d.movesWithPage ?? null },
        };
      }),
    { pass: (n) => `All ${n} dialogs and panels tried can be closed${n ? ', and the modal ones keep focus and the page behind in place' : ''}.`, fail: (b, n) => `${b} of ${n} dialogs and panels tried cannot be closed, let focus out, or move with the page behind.` },
  );
}

export type { Effect };
