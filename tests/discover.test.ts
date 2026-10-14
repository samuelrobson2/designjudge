import { describe, expect, it } from 'vitest';
import { describeChange, measureChange, pickStates, type Discovered } from '../src/collect/discover.ts';

type El = [string, number, number, number, number, string];
const snap = (els: El[], height = 1000) => ({ url: 'http://x/', height, vw: 360, vh: 800, els });

const page: El[] = [
  ['body>main[1]', 0, 0, 360, 1000, ''],
  ['body>main[1]>section.form[1]', 16, 100, 328, 600, ''],
  ['body>main[1]>section.form[1]>button.primary[1]', 16, 640, 328, 48, ''],
];

describe('Interactive state discovery: change measurement', () => {
  it('treats an identical re-render as no change', () => {
    const c = measureChange(snap(page), snap(page.map((e) => [...e] as El)));
    expect(c.significant).toBe(false);
    expect(c.score).toBe(0);
  });

  it('flags a dialog appearing as significant', () => {
    const c = measureChange(snap(page), snap([...page, ['body>div.sheet[1]', 0, 400, 360, 400, 'dialog']]));
    expect(c.significant).toBe(true);
    expect(c.overlays).toBe(1);
    expect(describeChange({ selector: 's', label: 'Open', role: 'button', signature: 'x' }, c, 360 * 800)).toContain('a dialog or overlay appeared');
  });

  it('counts validation messages and new in-flow content, and points the capture at it', () => {
    const after: El[] = [
      page[0],
      ['body>main[1]>div.error-summary[1]', 16, 80, 328, 120, 'alert'],
      ['body>main[1]>section.form[1]', 16, 220, 328, 600, ''],
      ['body>main[1]>section.form[1]>button.primary[1]', 16, 760, 328, 48, ''],
    ];
    const c = measureChange(snap(page), snap(after, 1120));
    expect(c.significant).toBe(true);
    expect(c.alerts).toBe(1);
    expect(c.heightChange).toBe(120);
    expect(c.focusY).toBe(80);
  });

  it('counts a drawer sliding onto the screen as new content and an overlay', () => {
    const drawer = (x: number): El => ['body>nav.drawer[1]', x, 0, 280, 800, 'fixed'];
    const c = measureChange(snap([...page, drawer(-280)]), snap([...page, drawer(0)]));
    expect(c.significant).toBe(true);
    expect(c.overlays).toBe(1);
  });

  it('ignores a tiny change such as a selected state on one small control', () => {
    const after: El[] = [...page, ['body>main[1]>section.form[1]>span.tick[1]', 20, 650, 12, 12, '']];
    expect(measureChange(snap(page), snap(after)).significant).toBe(false);
  });

  it('counts a floating layer however small, and names it', () => {
    const c = measureChange(snap(page), snap([...page, ['body>main[1]>div.tip[1]', 16, 600, 120, 32, 'layer']]));
    expect(c.significant).toBe(true);
    expect(c.popups).toBe(1);
    expect(describeChange({ selector: 's', label: 'Info', role: 'button', signature: 'x' }, c, 360 * 800)).toBe('After clicking button "Info": a menu, tooltip or popover appeared');
  });

  it('counts a newly expanded control only when something changed with it', () => {
    const trigger = page[2][0];
    const answer: El = ['body>main[1]>section.form[1]>p.answer[1]', 16, 700, 200, 20, ''];
    const opened = measureChange(snap(page), { ...snap([...page, answer]), expanded: [trigger] });
    expect(opened.significant).toBe(true);
    expect(opened.expanded).toBe(1);
    const nothing = measureChange(snap(page), { ...snap(page), expanded: [trigger] });
    expect(nothing.significant).toBe(false);
  });
});

describe('Interactive state discovery: which one-click states are kept', () => {
  const cards: El[] = Array.from({ length: 6 }, (_, i) => [`body>main[1]>article.card[${i + 1}]`, 16, 100 + i * 150, 328, 140, '']);
  const load = snap([...page, ...cards], 1000);
  const found = (label: string, els: El[], height = 1000): Discovered => {
    const after = snap(els, height);
    const change = measureChange(load, after);
    return { candidate: { selector: label, label, role: 'button', signature: label }, change, description: label, after };
  };
  const noResults: El = ['body>main[1]>div.empty[1]', 16, 100, 328, 600, ''];
  const filterA = found('Petrol', [...page, noResults]);
  const filterB = found('Manual', [...page, noResults]);
  const validation = found('Confirm', [...page, ...cards, ['body>main[1]>div.errors[1]', 16, 60, 328, 30, 'alert']]);
  const tooltip = found('Info', [...page, ...cards, ['body>main[1]>div.tip[1]', 16, 600, 120, 32, 'layer']]);

  it('puts what opened or showed a message first, then other changes, and drops a screen the same as one kept', () => {
    expect(filterA.change.score).toBeGreaterThan(tooltip.change.score);
    const all = [filterA, filterB, validation, tooltip];
    expect(pickStates(all, 3).map((p) => p.candidate.label)).toEqual(['Info', 'Confirm', 'Petrol']);
    expect(pickStates(all, 2).map((p) => p.candidate.label)).toEqual(['Info', 'Confirm']);
    expect(pickStates([filterA, filterB], 3).map((p) => p.candidate.label)).toEqual(['Petrol']);
  });
});
