import { describe, expect, it } from 'vitest';
import { fillValue, undoReason, type FillTarget } from '../src/collect/stress.ts';

type El = [string, number, number, number, number, string];
const snap = (els: El[], height = 2000, url = 'http://x/') => ({ url, height, vw: 360, vh: 800, els });
const attrs = { maxLength: -1, min: '', max: '', autocomplete: '', name: '', id: '' };
const target = (type: string, extra: Partial<typeof attrs> = {}): FillTarget => ({ kind: 'fill', selector: 's', label: '', type, signature: 'x', attrs: { ...attrs, ...extra } });

const list: El[] = [
  ['body>main[1]', 0, 0, 360, 2000, ''],
  ['body>main[1]>ul.results[1]', 16, 200, 328, 1600, ''],
  ...[1, 2, 3, 4].map((n): El => [`body>main[1]>ul.results[1]>li.card[${n}]`, 16, 200 + (n - 1) * 400, 328, 380, '']),
];

describe('Stress state filling', () => {
  it('chooses long values that respect the field type and limits', () => {
    expect(fillValue(target('email'))).toMatch(/^[^@\s]+@[^@\s]+\.[a-z.]+$/);
    expect(fillValue(target('text', { autocomplete: 'name' }))).toContain('Ķöñšţáñţîñöþöûĺöš');
    expect(fillValue(target('text', { maxLength: 10 }))).toHaveLength(10);
    expect(fillValue(target('number', { max: '99' }))).toBe('99');
    expect(fillValue(target('date', { max: '2026-10-01' }))).toBe('2026-10-01');
    expect(fillValue(target('textarea')).length).toBeGreaterThan(150);
  });

  it('keeps a change that only adds content', () => {
    const after = snap([...list, ['body>main[1]>p.counter[1]', 16, 180, 328, 20, '']]);
    expect(undoReason(snap(list), after)).toBeNull();
  });

  it('undoes a filter that removes results', () => {
    const after = snap(list.slice(0, 3), 1200);
    expect(undoReason(snap(list), after)).toMatch(/removed content/);
  });

  it('undoes a dialog, a large overlay, and navigation', () => {
    expect(undoReason(snap(list), snap([...list, ['body>div.modal[1]', 20, 100, 320, 400, 'dialog']]))).toMatch(/dialog/);
    expect(undoReason(snap(list), snap([...list, ['body>div.sheet[1]', 0, 300, 360, 500, 'fixed']]))).toMatch(/overlay/);
    expect(undoReason(snap(list), snap(list, 2000, 'http://x/other'))).toMatch(/navigated/);
  });

  it('keeps a small fixed bar such as a comparison tray', () => {
    expect(undoReason(snap(list), snap([...list, ['body>div.compare-bar[1]', 0, 736, 360, 64, 'fixed']]))).toBeNull();
  });
});
