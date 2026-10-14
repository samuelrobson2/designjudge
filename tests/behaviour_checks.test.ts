import { describe, expect, it } from 'vitest';
import type { ChoiceContext, DialogResult, Effect, FunctionalProbe, HoverReveal, ProbeControl, StyleRecord, ToggleResult, VisualProbeState } from '../src/collect/probeTypes.ts';
import { Doc } from '../src/diagnostics/doc.ts';
import { choiceEffect, dependentActions, dialogBehaviour, savedPersistence } from '../src/diagnostics/functionality/checks.ts';
import { hoverOnly, looksUnavailable } from '../src/diagnostics/visual_system/availability.ts';
import type { ElementRecord, Snapshot } from '../src/types.ts';

const none: Effect = { url: false, mutations: 0, ariaChanges: 0, requests: 0, dialogs: 0, invalid: 0, calls: [], scrolled: 0, textChanged: false, newAlerts: [], errors: [] };
const rect = { x: 10, y: 10, w: 80, h: 30 };

function control(key: string, over: Partial<ProbeControl> = {}): ProbeControl {
  return { key, path: '', selector: `button.${key}`, tag: 'button', role: 'button', type: null, name: key, componentId: null, rect, fixed: false, kind: 'action', members: 1, memberNames: [], from: 'load', ...over };
}

function fprobe(over: Partial<FunctionalProbe>): FunctionalProbe {
  return { version: 1, viewport: 'desktop', width: 1920, height: 1080, controls: [], operability: [], actions: [], fields: [], toggles: [], links: [], forms: [], errors: [], limits: { controls: 0, probed: 0 }, ...over };
}

const group = (over: Partial<ChoiceContext> = {}): ChoiceContext => ({ name: 'Size', role: 'group', size: 3, panel: 'aside', filter: true, form: false, apply: null, ...over });
const toggle = (key: string, outside: boolean, choice: ChoiceContext): ToggleResult => ({ key, property: 'checked', before: 'false', after: 'true', expected: 'toggle', ok: true, renderedChange: true, choice, outside });

describe('No-Effect Choice Controls', () => {
  it('fails a filter option that changes nothing beyond itself', () => {
    const p = fprobe({ controls: [control('Small', { role: 'checkbox' })], toggles: [toggle('Small', false, group())] });
    const r = choiceEffect(p).get('desktop')!;
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toContain('Choosing the "Small" checkbox in the "Size" group changes nothing beyond the option itself');
  });

  it('passes an option that changes the page, and does not evaluate options waiting to be applied', () => {
    expect(choiceEffect(fprobe({ controls: [control('Red', { role: 'checkbox' })], toggles: [toggle('Red', true, group({ name: 'Colour' }))] })).get('desktop')!.status).toBe('pass');
    for (const g of [group({ form: true }), group({ apply: 'Apply filters' }), group({ size: 1 }), group({ role: 'container' })]) {
      expect(choiceEffect(fprobe({ controls: [control('Small', { role: 'checkbox' })], toggles: [toggle('Small', false, g)] })).size).toBe(0);
    }
  });

  it('evaluates an unnamed group only beside one in the same panel that does change the page', () => {
    const plain = group({ name: 'Notify', filter: false });
    const alone = fprobe({ controls: [control('Email', { role: 'checkbox' })], toggles: [toggle('Email', false, plain)] });
    expect(choiceEffect(alone).size).toBe(0);
    const beside = fprobe({
      controls: [control('Email', { role: 'checkbox' }), control('Red', { role: 'checkbox' })],
      toggles: [toggle('Email', false, plain), toggle('Red', true, group({ name: 'Colour', filter: false }))],
    });
    const r = choiceEffect(beside).get('desktop')!;
    expect(r.evaluated).toBe(1);
    expect(r.items[0].summary).toContain('"Email"');
  });
});

describe('Dependent Action Response', () => {
  const flow = (effect: Effect, before: 'absent' | 'disabled' = 'absent') => ({ key: 'pick', group: null, selected: 2, control: { name: 'Merge batches', selector: 'button.merge', rect, fixed: false }, before, effect });
  it('fails an action a selection made available that does nothing, and passes one that responds', () => {
    const p = fprobe({ controls: [control('pick', { role: 'checkbox' })], flows: [flow(none)] });
    const r = dependentActions(p).get('desktop')!;
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toContain('After 2 items are selected, the "Merge batches" button appears, but clicking it does nothing');
    expect(dependentActions(fprobe({ controls: [control('pick')], flows: [flow({ ...none, mutations: 4 }, 'disabled')] })).get('desktop')!.status).toBe('pass');
  });
});

describe('Saved State Persistence', () => {
  it('fails a saved count that a reload loses', () => {
    const p = fprobe({ controls: [control('Bookmark')], persistence: [{ key: 'Bookmark', claim: 'count', claimText: 'Bookmarks (1)', before: 'Bookmarks (0)', after: 'Bookmarks (1)', reloaded: 'Bookmarks (0)', persisted: false }] });
    const r = savedPersistence(p).get('desktop')!;
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toContain('after the page is reloaded it shows "Bookmarks (0)"');
  });

  it('passes a kept save, and does not evaluate a control that reports nothing or cannot be read back', () => {
    const kept = fprobe({ controls: [control('Save')], persistence: [{ key: 'Save', claim: 'count', claimText: 'Saved (1)', before: 'Saved (0)', after: 'Saved (1)', reloaded: 'Saved (1)', persisted: true }] });
    expect(savedPersistence(kept).get('desktop')!.status).toBe('pass');
    const silent = fprobe({ controls: [control('Like'), control('Star')], persistence: [{ key: 'Like', claim: null }, { key: 'Star', claim: 'message', claimText: 'Saved', persisted: null }] });
    expect(savedPersistence(silent).size).toBe(0);
  });
});

describe('Dialog Behaviour', () => {
  const dialog = (over: Partial<DialogResult>): DialogResult => ({ key: 'Help', opener: 'Help', name: 'Help', selector: 'div.modal', rect: { x: 0, y: 0, w: 600, h: 400 }, fixed: true, modal: true, kind: 'role', escape: true, close: null, tabEscape: null, backgroundScrolls: false, ...over });
  const run = (d: DialogResult) => dialogBehaviour(fprobe({ controls: [control('Help')], dialogs: [d] })).get('desktop')!;

  it('fails a modal that cannot be closed, lets Tab out and scrolls away with the page behind', () => {
    const r = run(dialog({ escape: false, tabEscape: { selector: 'body > a.logo', name: 'Home', after: 3 }, backgroundScrolls: true, movesWithPage: true }));
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toBe('The modal dialog "Help" that the "Help" button opens: neither Escape nor any close control inside it closes it; Tab moves focus out of it to "Home" on the page behind; wheeling over the page behind scrolls that page and carries the dialog out of place');
  });

  it('does not report a page scrolling behind a modal held in place', () => {
    expect(run(dialog({ backgroundScrolls: true, movesWithPage: false })).status).toBe('pass');
  });

  it('passes a modal closed by its close control, and a drawer its opener closes', () => {
    expect(run(dialog({ escape: false, close: { name: 'Close', selector: 'button.x', closed: true } })).status).toBe('pass');
    expect(run(dialog({ modal: false, kind: 'panel', escape: false, openerCloses: true, tabEscape: undefined, backgroundScrolls: undefined })).status).toBe('pass');
  });

  it('judges a non-modal drawer only on whether it can be closed', () => {
    expect(run(dialog({ modal: false, kind: 'panel', tabEscape: { selector: 'a', name: 'Home', after: 1 }, backgroundScrolls: true })).status).toBe('pass');
    expect(dialogBehaviour(fprobe({ controls: [control('Help')], dialogs: [dialog({ escape: null })] })).size).toBe(0);
  });
});

function element(id: number, extra: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id, parent: 1, order: id, depth: 2, tag: 'button', role: 'button', name: null, text: null, ownText: true, selector: `button:nth-child(${id})`,
    componentId: null, componentType: null, rect: { x: id * 90, y: 0, w: 80, h: 32 }, textRect: null, lineBoxes: 1, visible: true, display: 'block', position: 'static',
    overflowX: 'visible', overflowY: 'visible', transform: false, textOverflow: 'clip', lineClamp: 'none', whiteSpace: 'normal', scroll: { sw: 0, sh: 0, cw: 0, ch: 0, sl: 0, st: 0 },
    border: [1, 1, 1, 1], borderVisible: true, bg: null, bgImage: false, flexDirection: null, flexWrap: null, gridColumns: null, gap: null, interactive: true, disabled: false,
    inert: false, ariaHidden: false, hiddenAttr: false, closedDetails: false, overlay: false, visuallyHidden: false, media: false, svgOnlyDefs: false, labelFor: null, img: null, ...extra,
  } as ElementRecord;
}

function style(id: number, extra: Partial<StyleRecord> = {}): StyleRecord {
  return { id, color: [20, 20, 20, 1], bg: [255, 255, 255, 1], bgImage: null, border: null, radius: null, shadow: null, outline: null, opacity: 1, transition: null, animation: null, peer: '1|button.slot', ...extra };
}

function slots(styles: StyleRecord[], els: Partial<ElementRecord>[] = []): CheckOutputFor {
  const parent = element(1, { parent: null, tag: 'div', role: null, interactive: false, depth: 1, selector: 'div.slots', rect: { x: 0, y: 0, w: 800, h: 40 } });
  const kids = styles.map((s, i) => element(s.id, { name: `${9 + i}:00`, ...els[i] }));
  const snap = { elements: [parent, ...kids] } as unknown as Snapshot;
  const probe = { version: 1, stateId: 'desktop', viewport: { width: 1920, height: 1080 }, snapshot: snap, styles, contrast: [], axe: null, focus: null, motion: null, cues: true } as VisualProbeState;
  return looksUnavailable(probe, new Doc(snap));
}
type CheckOutputFor = ReturnType<typeof looksUnavailable>;

describe('Looks Unavailable but Operable', () => {
  const struck = { deco: 'line-through', color: [170, 170, 170, 1] as [number, number, number, number] };
  it('fails an enabled option struck through and greyed unlike its siblings', () => {
    const r = slots([style(2), style(3, struck), style(4), style(5), style(6)]);
    expect(r.status).toBe('fail');
    expect(r.items[0].data).toMatchObject({ cues: ['struck through', 'muted text'], flagged: 1, peers: 5 });
  });

  it('passes the same look on a disabled or selected sibling, one cue alone, and a look most siblings share', () => {
    expect(slots([style(2), style(3, struck), style(4), style(5)], [{}, { disabled: true }]).status).toBe('pass');
    expect(slots([style(2), style(3, { ...struck, state: true }), style(4), style(5)]).status).toBe('pass');
    expect(slots([style(2), style(3, { deco: 'line-through' }), style(4), style(5)]).status).toBe('pass');
    expect(slots([style(2, struck), style(3, struck), style(4, struck), style(5)]).status).toBe('pass');
  });
});

describe('Hover-Only Content', () => {
  const reveal = (over: Partial<HoverReveal>): HoverReveal => ({ host: { selector: 'li.tile', name: 'Tile one', rect }, revealed: { selector: 'li.tile > div.quick', text: 'Quick view', controls: ['Quick view'], rect }, members: 3, focus: false, touch: 'no', repeatsName: false, ...over });
  const run = (r: HoverReveal) => hoverOnly({ version: 1, viewport: { width: 1920, height: 1080 }, tried: 1, found: 1, reveals: [r] }, null);

  it('fails content that only a pointer shows', () => {
    const r = run(reveal({}));
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toBe('Pointing at "Tile one" (and 2 others like it) shows the control "Quick view", but keyboard focus does not show it and a tap on the phone layout does not show it');
  });

  it('passes content that focus or a tap also shows, and does not evaluate a tooltip repeating its label', () => {
    expect(run(reveal({ focus: true })).status).toBe('pass');
    expect(run(reveal({ touch: 'tap' })).status).toBe('pass');
    expect(run(reveal({ touch: 'shown' })).status).toBe('pass');
    expect(run(reveal({ repeatsName: true })).evaluated).toBe(0);
  });
});
