import { afterAll, describe, expect, it } from 'vitest';
import {
  fontFamilies,
  headingLineBalance,
  invalidTextRendering,
  lineHeight,
  responsiveTypography,
  sizeWeightProfile,
  typeScale,
} from '../src/diagnostics/typography/checks.ts';
import { roleKey, textElements } from '../src/diagnostics/typography/text.ts';
import { closeBrowser, render } from './helpers.ts';

afterAll(closeBrowser);

const para = 'Choose a treatment and a time that suits you. You will get a confirmation email straight away, and you can change or cancel the booking at any time up to a day before.';

const page = `
  <main style="max-width:600px;padding:24px">
    <h1 style="font-size:30px;font-weight:700;line-height:1.2">Book an appointment</h1>
    <p id="lede">${para}</p>
    <h2 style="font-size:20px">Your details</h2>
    <label for="n" style="font-size:14px;font-weight:600">Full name</label>
    <input id="n" placeholder="Jane Smith" style="font-size:16px">
    <button style="font-size:15px">Confirm booking</button>
    <button aria-label="Save" style="font-size:18px">♡</button>
    <p style="font-size:12px">Free cancellation up to 24 hours before.</p>
  </main>`;

describe('Text capture', () => {
  it('records the computed type, rendered lines and available width of each text element', async () => {
    const { snap } = await render(page);
    const h1 = snap.elements.find((e) => e.tag === 'h1')!;
    expect(h1.type).toMatchObject({ size: 30, weight: 700, lineCount: 1, heading: 1 });
    expect(h1.type!.lineHeight).toBeCloseTo(36);
    const lede = snap.elements.find((e) => e.selector.endsWith('p#lede'))!;
    expect(lede.type!.lineCount).toBeGreaterThanOrEqual(2);
    expect(lede.type!.lines).toHaveLength(lede.type!.lineCount);
    expect(Math.max(...lede.type!.lines)).toBeLessThanOrEqual(lede.type!.avail + 1);
    expect(snap.elements.find((e) => e.tag === 'input')!.type).toMatchObject({ field: 'placeholder', size: 16 });
  });

  it('infers text roles and leaves out icon-only text', async () => {
    const { doc } = await render(page);
    const roles = Object.fromEntries(textElements(doc).items.map((x) => [x.el.text?.slice(0, 20) ?? x.el.tag, roleKey(x.role)]));
    expect(roles['Book an appointment']).toBe('h1');
    expect(roles[para.slice(0, 20)]).toBe('body');
    expect(roles['Full name']).toBe('label');
    expect(roles['Confirm booking']).toBe('control');
    expect(roles['Free cancellation up']).toBe('supporting');
    expect(Object.keys(roles)).not.toContain('♡');
  });
});

describe('Invalid Text Rendering', () => {
  it('fails visible text set at 0 px, and passes normal text', async () => {
    const bad = await render(`<p>Total <span style="font-size:0">£45</span></p><p style="font-size:0">Hidden note text</p>`);
    const r = invalidTextRendering(bad.doc, bad.ctx);
    expect(r.status).toBe('fail');
    expect(r.items.some((i) => i.summary.includes('Hidden note text'))).toBe(true);
    const ok = await render(page);
    expect(invalidTextRendering(ok.doc, ok.ctx).status).toBe('pass');
  });
});

describe('Typography observations', () => {
  it('flags small text, light small text, and headings smaller than a lower level', async () => {
    const { doc } = await render(`
      <h1 style="font-size:18px">Title</h1><h2 style="font-size:28px">Section</h2>
      <p>${para}</p><p>${para}</p>
      <p style="font-size:10px">Tiny supporting note one</p>
      <p style="font-size:14px;font-weight:200">Thin small description text</p>`);
    const kinds = sizeWeightProfile(doc).items.map((i) => i.data.kind);
    expect(kinds).toEqual(expect.arrayContaining(['small', 'light_small', 'inversion']));
  });

  it('flags cramped line-height on multi-line text but not on single lines', async () => {
    const { doc } = await render(`<p style="width:300px;line-height:1.05">${para} ${para}</p><p style="line-height:1">One line.</p>`);
    const tight = lineHeight(doc).items.filter((i) => i.data.kind === 'tight_multiline');
    expect(tight).toHaveLength(1);
    expect(tight[0].data.ratio).toBeCloseTo(1.05);
  });

  it('merges near-identical sizes into one chain', async () => {
    const { doc } = await render(['13px', '13.5px', '14px', '20px'].map((s) => `<p style="font-size:${s}">Text at ${s}</p>`).join(''));
    const dups = typeScale(doc).items.filter((i) => i.data.kind === 'near_duplicate');
    expect(dups).toHaveLength(1);
    expect(dups[0].summary).toContain('13 px');
    expect(dups[0].summary).toContain('14 px');
    expect(dups[0].summary).not.toContain('20 px');
  });

  it('counts each declared typeface', async () => {
    const { doc } = await render(`<h1 style="font-family:Georgia,serif">Title</h1><p style="font-family:'Courier New',monospace">${para}</p><p>${para}</p>`);
    expect(fontFamilies(doc).items.filter((i) => i.data.kind === 'family').length).toBeGreaterThanOrEqual(3);
  });

  it('flags more sizes, styles, families and weights than the reference', async () => {
    const sizes = [12, 14, 16, 18, 24, 32];
    const fams = ['Georgia,serif', 'Arial,sans-serif', "'Courier New',monospace", "'Times New Roman',serif"];
    const { doc } = await render(sizes.map((s, i) => `<p style="font-size:${s}px;font-weight:${[400, 550, 600, 620, 700, 700][i]};font-family:${fams[i % 4]}">${para}</p>`).join(''));
    const kinds = (r: { items: { data: Record<string, unknown> }[] }) => r.items.map((i) => i.data.kind);
    expect(kinds(typeScale(doc))).toEqual(expect.arrayContaining(['size_count']));
    expect(kinds(fontFamilies(doc))).toContain('family_count');
    const sw = sizeWeightProfile(doc).items;
    expect(sw.find((i) => i.data.kind === 'weight_count')!.summary).toContain('5 font weights');
    expect(sw.find((i) => i.data.kind === 'near_duplicate_weights')!.data.weights).toEqual([550, 600, 620]);
    const { doc: few } = await render(`<h1 style="font-size:32px">Title</h1><p>${para}</p>`);
    expect(kinds(typeScale(few))).not.toContain('size_count');
    expect(kinds(typeScale(few))).not.toContain('style_count');
    expect(kinds(fontFamilies(few))).not.toContain('family_count');
  });

  it('reports how a wrapped heading breaks', async () => {
    const { doc } = await render(`<h1 style="width:9ch;font-size:30px">Book an appointment today</h1>`);
    const h = headingLineBalance(doc).items.find((i) => i.data.kind === 'heading')!;
    expect(h.data.lines).toBeGreaterThanOrEqual(2);
  });
});

describe('Responsive Typography Adaptation', () => {
  const css = `<style>h1{font-size:32px} .note{font-size:14px} @media (max-width:600px){h1{font-size:24px} .note{font-size:10px}}</style>`;
  const body = `<h1>Book an appointment</h1><p>${para}</p><p class="note">Free cancellation up to 24 hours before.</p>`;

  it('follows the same text across widths, even when the page is rebuilt', async () => {
    const sweep = await Promise.all([400, 800, 1200].map(async (width) => ({ width, doc: (await render(body, { width, head: css })).doc })));
    const r = responsiveTypography(sweep);
    const changes = r.items.filter((i) => i.data.kind === 'role_changes');
    expect(changes.find((i) => i.data.role === 'h1')!.summary).toContain('32 px/700 at 800–1200 px, 24 px/700 at 400 px');
    expect(r.items.find((i) => i.data.kind === 'shrinks_below_12')!.summary).toContain('from 14 px to 10 px at 400 px and narrower');
    expect(r.items.find((i) => i.data.kind === 'role_steady')!.summary).toContain('body text');
  });
});
