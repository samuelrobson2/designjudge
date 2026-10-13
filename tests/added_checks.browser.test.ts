import { afterAll, describe, expect, it } from 'vitest';
import type { VisualProbeState } from '../src/collect/probeTypes.ts';
import { locateFindings } from '../src/diagnostics/functionality/page-claims.ts';
import { brokenImages, hiddenScrollItems, rowImbalance, textTruncation } from '../src/diagnostics/layout/composition.ts';
import { squeezedWrapping } from '../src/diagnostics/typography/wrapping.ts';
import { labelInName, reducedMotion, words } from '../src/diagnostics/visual_system/names.ts';
import type { DiagnosticItem, DiagnosticResult } from '../src/types.ts';
import { closeBrowser, render } from './helpers.ts';

afterAll(closeBrowser);

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Broken Images', () => {
  it('fails a picture that loaded no pixels, and ignores a tracking pixel', async () => {
    const { doc } = await render(`<img src="missing-photo.png" alt="Ford Fiesta" width="160" height="120"><img src="${PIXEL}" alt="" width="160" height="120"><img src="missing-pixel.gif" width="1" height="1">`);
    const r = brokenImages(doc);
    expect(r.status).toBe('fail');
    expect(r.evaluated).toBe(2);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].summary).toMatch(/^The picture "Ford Fiesta" failed to load and draws as a broken-image box \(\d+×\d+ px\)$/);
  });
});

describe('Row Height Imbalance', () => {
  const row = (aside: string) =>
    `<div style="display:flex;gap:16px;align-items:flex-start"><section style="box-sizing:border-box;width:400px;height:820px;border:1px solid #ccc">Products</section><section style="box-sizing:border-box;width:400px;height:300px;border:1px solid #ccc">${aside}</section></div>`;
  it('reports a short box beside a much taller one', async () => {
    const r = rowImbalance((await render(row('Revenue'), { width: 1000 })).doc);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].summary).toMatch(/^Beside the 820 px tall "Products" box, the "Revenue" box is 300 px tall, leaving an empty area 400 × 520 px under it$/);
  });
  it('does not report boxes of similar height, or a column whose content is sticky', async () => {
    expect(rowImbalance((await render(`<div style="display:flex;gap:16px;align-items:flex-start"><section style="width:400px;height:420px;border:1px solid #ccc">A</section><section style="width:400px;height:300px;border:1px solid #ccc">B</section></div>`, { width: 1000 })).doc).items).toEqual([]);
    expect(rowImbalance((await render(row('<div style="position:sticky;top:0">Summary</div>'), { width: 1000 })).doc).items).toEqual([]);
  });
});

describe('Text Truncation', () => {
  it('reports one-line cut-offs and clamped headings, not a clamped description beside a name', async () => {
    const clamp = 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:200px';
    const { doc } = await render(
      `<h2 class="t" style="${clamp}">Choose a treatment and time for your visit to the clinic this week</h2>
       <button class="card"><span class="name">Deep tissue massage</span><span class="desc" style="${clamp}">A full assessment and treatment plan for recovery and muscle tension, with notes to take home</span></button>
       <span class="line" style="display:block;width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Order summary for your selected items</span>`,
    );
    const sel = (cls: string) => doc.els.find((e) => new RegExp(`\\.${cls}(:nth-of-type\\(\\d+\\))?$`).test(e.selector))!;
    const truncated = (cls: string, axis: 'x' | 'y') => ({ n: 0, summary: '', elements: [doc.ref(sel(cls))], data: { axis } });
    const overflow = {
      key: 'container_overflow@desktop', diagId: 'container_overflow', kind: 'deterministic', stateId: 'desktop', status: 'pass', summary: '', items: [],
      secondary: [{ kind: 'truncated', label: 'truncated', items: [truncated('t', 'y'), truncated('desc', 'y'), truncated('line', 'x')] }],
    } as unknown as DiagnosticResult;
    const r = textTruncation(overflow, doc);
    expect(r.items.map((i) => i.summary)).toEqual([
      'The text "Choose a treatment and time for your vi…" is clamped to fewer lines than it needs',
      'The text "Order summary for your selected items" is cut off with an ellipsis',
    ]);
    expect(r.summary).toContain('1 line-clamped excerpt is not counted');
  });
});

describe('Hidden Scroll Items', () => {
  const strip = (after = '') =>
    `<div><div aria-label="Date" style="display:flex;overflow-x:auto;width:300px">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<button style="flex:0 0 100px;height:40px">${d}</button>`).join('')}</div>${after}</div>`;
  it('reports a strip whose items end at its edge with nothing to show more exist', async () => {
    const r = hiddenScrollItems((await render(strip(), { width: 360 })).doc);
    expect(r.items.map((i) => i.summary)).toEqual(['"Date" scrolls sideways with no next, previous or "more" control beside it: 3 of its 6 items are fully in view, 0 are cut at the edge and 3 are out of view']);
  });
  it('does not report a strip with a next control', async () => {
    expect(hiddenScrollItems((await render(strip('<button>Next dates</button>'), { width: 360 })).doc).items).toEqual([]);
  });
});

describe('Squeezed Text Wrapping', () => {
  it('reports text broken into many short lines in a narrow column, not text with room', async () => {
    const { doc } = await render(
      `<table><tr><td style="width:70px;max-width:70px">Weston-super-Mare 19 miles away from you</td><td style="width:600px"><p>Weston-super-Mare 19 miles away from you</p></td></tr></table>`,
      { width: 800 },
    );
    const r = squeezedWrapping(doc);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].summary).toMatch(/^"Weston-super-Mare 19 miles away from you" \([a-z ]+\) wraps to \d+ lines of about \d+ characters each in a \d+ px wide column$/);
  });
});

describe('Label in Name', () => {
  it('splits letters run into digits', () => {
    expect(words('2doors, Search-cars')).toEqual(['2', 'doors', 'search', 'cars']);
  });
  it('fails a control announced without the words it shows', async () => {
    const { doc } = await render(`<button aria-label="Submit form">Book now</button><label for="e">Email address</label><input id="e" aria-label="Field 1">`);
    const r = labelInName(doc);
    expect(r.status).toBe('fail');
    expect(r.items.map((i) => i.summary)).toEqual(['A button shows "Book now" but is announced as "Submit form"', 'A field shows "Email address" but is announced as "Field 1"']);
  });
  it('passes names that hold the shown words in any order, icon buttons, and shown numbers', async () => {
    const { doc } = await render(
      `<button aria-label="Cars: search">Search cars</button><button aria-label="Close dialog">×</button><a href="#" aria-label="Basket, 3 items">Basket 3</a><button aria-label="Save Vauxhall Corsa">Save</button><button>Plain</button>`,
    );
    expect(labelInName(doc).status).toBe('pass');
  });
});

describe('Reduced Motion Support', () => {
  it('fails an infinite animation still running when reduced motion is requested', async () => {
    const { doc } = await render(`<div class="spin" aria-label="Loading">.</div>`);
    const anim = (name: string) => ({ id: null, selector: 'div.spin', name, durationMs: 1000, infinite: true });
    const probe = (reduced: ReturnType<typeof anim>[]) => ({ motion: { animations: [anim('pulse')], reduced } }) as unknown as VisualProbeState;
    const fail = reducedMotion(probe([anim('pulse')]), doc);
    expect(fail.status).toBe('fail');
    expect(fail.items[0].summary).toBe('The "pulse" animation on div.spin keeps looping when reduced motion is requested');
    expect(reducedMotion(probe([]), doc).status).toBe('pass');
  });
});

describe('Outlining page-claim findings', () => {
  it('outlines the smallest element holding every word of the claim, across inline parts', async () => {
    const { doc } = await render(`<main><p class="count"><strong>248</strong> cars for sale</p><ul><li>Ford</li></ul><div class="total"><span>Total</span> <span>£33.86</span></div></main>`);
    const items: DiagnosticItem[] = [
      { n: 1, summary: '', elements: [], data: { at: '248 cars for sale' } },
      { n: 2, summary: '', elements: [], data: { at: 'Total £33.86' } },
      { n: 3, summary: '', elements: [], data: { at: 'Nothing like this' } },
    ];
    locateFindings(items, doc);
    expect(items[0].elements[0]?.selector).toMatch(/p\.count$/);
    expect(items[1].elements[0]?.selector).toMatch(/div\.total$/);
    expect(items[2].elements).toEqual([]);
  });
});
