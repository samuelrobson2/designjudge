import { describe, expect, it } from 'vitest';
import { describeChange, measureChange } from '../src/collect/discover.ts';

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
});
