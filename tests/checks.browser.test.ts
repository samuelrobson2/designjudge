import { afterAll, describe, expect, it } from 'vitest';
import {
  collapsedDimensions,
  containerOverflow,
  interactiveReachability,
  pageHorizontalOverflow,
  regionOverlap,
} from '../src/diagnostics/layout/deterministic.ts';
import { alignmentOutliers, spatialGrouping } from '../src/diagnostics/layout/observations.ts';
import { controlAvailability } from '../src/diagnostics/layout/deterministic.ts';
import { closeBrowser, render } from './helpers.ts';

afterAll(closeBrowser);

const card = 'width:200px;height:120px;border:1px solid #ccc;padding:8px;box-sizing:border-box';

describe('Region Overlap', () => {
  it('fails when two cards collide', async () => {
    const { doc, ctx } = await render(`
      <main style="position:relative;height:400px">
        <article id="a" style="position:absolute;left:20px;top:20px;${card}"><h2>First</h2></article>
        <article id="b" style="position:absolute;left:120px;top:60px;${card}"><h2>Second</h2></article>
      </main>`);
    const r = regionOverlap(doc, ctx);
    expect(r.status).toBe('fail');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].elements.map((e) => e.selector)).toEqual(expect.arrayContaining(['article#a', 'article#b']));
  });

  it('passes a flex row of separated cards', async () => {
    const { doc, ctx } = await render(`
      <main style="display:flex;gap:16px;padding:16px">
        <article style="${card}"><h2>One</h2><p>Text</p></article>
        <article style="${card}"><h2>Two</h2><p>Text</p></article>
        <article style="${card}"><h2>Three</h2><p>Text</p></article>
      </main>`);
    expect(regionOverlap(doc, ctx).status).toBe('pass');
  });

  it('reports text over hero media and a floating label as intentional, not failures', async () => {
    const { doc, ctx } = await render(`
      <section style="position:relative;height:300px">
        <img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='300'/%3E" style="position:absolute;inset:0;width:100%;height:100%">
        <div style="position:absolute;left:40px;top:40px;width:400px"><h1>Big hero title</h1><p>Supporting text</p></div>
      </section>
      <div style="position:relative;width:300px;margin:20px">
        <input id="q" style="width:100%;height:48px;padding-top:18px">
        <label for="q" style="position:absolute;left:12px;top:4px;font-size:12px">Email address</label>
      </div>`);
    const r = regionOverlap(doc, ctx);
    expect(r.status).toBe('pass');
    expect(r.secondary[0]?.kind).toBe('media_decorative_overlap');
    expect(r.secondary[0].items.length).toBeGreaterThanOrEqual(2);
  });

  it('treats a badge placed over a box that only holds an image as intentional, but not one over text', async () => {
    const card = (overlayTop: number) => `
      <article style="position:relative;width:300px;margin:16px">
        <div class="img" style="position:relative;height:180px"><svg viewBox="0 0 10 6" width="300" height="180" role="img" aria-label="Car"><rect width="10" height="6" fill="#ccc"/></svg><button style="position:absolute;top:8px;right:8px">Save</button></div>
        <div class="body" style="padding:8px"><h3 style="margin:0">2022 Volvo XC40</h3><span class="deal" style="position:absolute;left:8px;top:${overlayTop}px;background:#0a0;color:#fff;padding:2px 6px">Great price</span></div>
      </article>`;
    const onImage = await render(card(8));
    expect(regionOverlap(onImage.doc, onImage.ctx).status).toBe('pass');
    const onTitle = await render(card(186));
    expect(regionOverlap(onTitle.doc, onTitle.ctx).status).toBe('fail');
  });

  it('excludes a notification badge positioned on its host', async () => {
    const { doc, ctx } = await render(`
      <nav style="display:flex;gap:24px;padding:24px">
        <button style="position:relative;width:44px;height:44px">🔔<span style="position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;background:#d00;color:#fff;border-radius:9px;font-size:11px">3</span></button>
        <button style="width:44px;height:44px">⚙</button>
      </nav>`);
    expect(regionOverlap(doc, ctx).status).toBe('pass');
  });

  it('reports only the outermost pair when parents collide', async () => {
    const { doc, ctx } = await render(`
      <main style="position:relative;height:400px">
        <article style="position:absolute;left:0;top:0;width:300px;height:200px"><div style="height:200px;background:#eee"><p style="margin:0">A content</p></div></article>
        <article style="position:absolute;left:150px;top:100px;width:300px;height:200px"><div style="height:200px;background:#ddd"><p style="margin:0">B content</p></div></article>
      </main>`);
    const r = regionOverlap(doc, ctx);
    expect(r.status).toBe('fail');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].elements.every((e) => e.tag === 'article')).toBe(true);
  });
});

describe('Container Overflow', () => {
  it('fails visible overflow from an unbreakable string and attributes it to the innermost container', async () => {
    const { doc, ctx } = await render(`
      <main style="width:600px"><section id="s" style="width:200px;border:1px solid"><div id="d" style="width:200px">Supercalifragilisticexpialidocious-and-then-some-more</div></section></main>`);
    const r = containerOverflow(doc, ctx);
    expect(r.status).toBe('fail');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].elements[0].selector).toBe('div#d');
  });

  it('fails clipped overflow in a fixed-height hidden container', async () => {
    const { doc, ctx } = await render(`<div id="c" style="height:60px;overflow:hidden;width:300px"><p>Line one</p><p>Line two</p><p>Line three</p><p>Line four</p></div>`);
    const r = containerOverflow(doc, ctx);
    expect(r.status).toBe('fail');
    expect(r.items[0].data.kind).toBe('clipped');
  });

  it('treats ellipsis truncation as a separate truncated result', async () => {
    const { doc, ctx } = await render(`<div style="width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">A very long label that will not fit</div>`);
    const r = containerOverflow(doc, ctx);
    expect(r.status).toBe('pass');
    expect(r.secondary[0]?.kind).toBe('truncated');
  });

  it('does not fail a scrollable container', async () => {
    const { doc, ctx } = await render(`<div style="width:200px;overflow-x:auto"><table style="width:600px"><tr><td>wide table</td></tr></table></div>`);
    expect(containerOverflow(doc, ctx).status).toBe('pass');
  });

  it('reports masked page overflow when body clips horizontally', async () => {
    const { doc, ctx } = await render(`<div id="wide" style="width:1200px;height:40px;background:#eee">Wide banner</div>`, {
      head: '<style>html,body{overflow-x:hidden}</style>',
    });
    expect(pageHorizontalOverflow(doc, ctx).status).toBe('pass');
    const r = containerOverflow(doc, ctx);
    expect(r.status).toBe('fail');
    expect(r.items.some((i) => i.data.kind === 'root_clipped')).toBe(true);
  });
});

describe('Page-Level Horizontal Overflow', () => {
  it('fails when a fixed-width table makes the page scroll at 360 px', async () => {
    const { doc, ctx } = await render(`<main style="padding:16px"><table id="t" style="min-width:720px"><tr><td>Order</td><td>Customer</td></tr></table></main>`, { width: 360, height: 800 });
    const r = pageHorizontalOverflow(doc, ctx);
    expect(r.status).toBe('fail');
    expect(r.items[0].elements.map((e) => e.selector)).toContain('table#t');
  });

  it('passes when the table sits in a horizontal scroller', async () => {
    const { doc, ctx } = await render(`<main style="padding:16px"><div style="overflow-x:auto"><table style="min-width:720px"><tr><td>Order</td></tr></table></div></main>`, { width: 360, height: 800 });
    expect(pageHorizontalOverflow(doc, ctx).status).toBe('pass');
  });
});

describe('Interactive Element Reachability', () => {
  it('fails a button clipped inside a fixed-height hidden panel', async () => {
    const { doc, ctx } = await render(`<div style="height:120px;overflow:hidden;width:300px"><div style="height:200px">Filler</div><button id="go">Submit</button></div>`);
    const r = interactiveReachability(doc, ctx);
    expect(r.status).toBe('fail');
    expect(r.items[0].elements[0].selector).toBe('button#go');
  });

  it('passes a button that can be scrolled into view inside a scroll container', async () => {
    const { doc, ctx } = await render(`<div style="height:120px;overflow:auto;width:300px"><div style="height:200px">Filler</div><button>Submit</button></div>`);
    expect(interactiveReachability(doc, ctx).status).toBe('pass');
  });

  it('excludes screen-reader-only skip links', async () => {
    const { doc, ctx } = await render(`<a href="#main" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Skip</a><main id="main"><button>Go</button></main>`);
    expect(interactiveReachability(doc, ctx).status).toBe('pass');
  });

  it('lists controls in a closed off-canvas drawer as possibly disclosed', async () => {
    const { doc, ctx } = await render(`<aside style="position:fixed;top:0;left:0;width:280px;height:100%;transform:translateX(-100%)"><button>Apply filters</button></aside><main><button>Open filters</button></main>`, { width: 360, height: 800 });
    const r = interactiveReachability(doc, ctx);
    expect(r.status).toBe('pass');
    expect(r.secondary[0]?.kind).toBe('possibly_disclosed');
  });
});

describe('Collapsed Component Dimensions', () => {
  it('fails a canvas that collapses to zero height', async () => {
    const { doc, ctx } = await render(`<div style="height:0"><canvas id="chart" style="width:100%;height:100%"></canvas></div>`);
    const r = collapsedDimensions(doc, ctx);
    expect(r.status).toBe('fail');
    expect(r.items[0].elements[0].selector).toBe('canvas#chart');
  });

  it('ignores SVG sprite sheets and passes normal media', async () => {
    const { doc, ctx } = await render(`
      <svg width="0" height="0" style="position:absolute"><defs><symbol id="i"><path d="M0 0h10v10z"/></symbol></defs></svg>
      <svg width="24" height="24"><use href="#i"/></svg>
      <img alt="x" width="120" height="80" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'/%3E">`);
    expect(collapsedDimensions(doc, ctx).status).toBe('pass');
  });
});

describe('Alignment Outliers', () => {
  const field = 'height:60px;background:#eee';
  it('flags a card offset from its column', async () => {
    const { doc } = await render(`
      <div class="list" style="width:400px">
        <div class="row" style="${field}"></div><div class="row" style="${field};margin-top:8px"></div>
        <div class="row" style="${field};margin-top:8px;margin-left:14px"></div><div class="row" style="${field};margin-top:8px"></div>
      </div>`);
    const r = alignmentOutliers(doc);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].data.deviationPx).toBe(14);
  });

  it('flags a card shifted out of a grid row', async () => {
    const { doc } = await render(`
      <div style="display:grid;grid-template-columns:repeat(4,160px);gap:16px">
        <div class="card" style="height:100px;background:#eee"></div><div class="card" style="height:100px;background:#eee"></div>
        <div class="card" style="height:100px;background:#eee;position:relative;top:10px"></div><div class="card" style="height:100px;background:#eee"></div>
      </div>`);
    const r = alignmentOutliers(doc);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].data.deviationPx).toBe(10);
  });

  it('does not flag a half-width field that shares the column left edge', async () => {
    const { doc } = await render(`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;width:600px">
        <div class="f" style="grid-column:1/-1;${field}"></div><div class="f" style="${field}"></div><div class="f" style="${field}"></div><div class="f" style="grid-column:1/-1;${field}"></div>
      </div>`);
    expect(alignmentOutliers(doc).items).toHaveLength(0);
  });
});

describe('Spatial Grouping and Separation', () => {
  it('measures separation between padded, divided sections by their content', async () => {
    const { doc } = await render(`
      <form style="width:500px">
        <section style="padding:24px 0"><label style="display:block">A</label><input style="display:block;margin-top:8px"></section>
        <section style="padding:24px 0;border-top:1px solid #ccc"><label style="display:block">B</label><input style="display:block;margin-top:8px"></section>
      </form>`);
    const r = spatialGrouping(doc, { width: 800, height: 600 });
    const rel = r.items.find((i) => i.data.ratio !== undefined);
    expect(rel).toBeDefined();
    expect(rel!.data.betweenMedianPx as number).toBeGreaterThanOrEqual(48);
  });

  it('reports bordered cards that nearly touch, which read as one block', async () => {
    const grid = (gap: number) => `<div class="grid" style="display:grid;grid-template-columns:repeat(3,200px);gap:20px ${gap}px;padding:16px">
      ${Array.from({ length: 6 }, (_, i) => `<article style="border:1px solid #ccc;padding:12px"><h3 style="margin:0 0 8px">Car ${i}</h3><p style="margin:0">£${10 + i},000</p></article>`).join('')}</div>`;
    const tight = await render(grid(3));
    const r = spatialGrouping(tight.doc, tight.ctx.viewport);
    expect(r.items.some((it) => it.data.gapPx === 3)).toBe(true);
    const roomy = await render(grid(20));
    expect(spatialGrouping(roomy.doc, roomy.ctx.viewport).items.some((it) => it.data.gapPx !== undefined)).toBe(false);
  });

  it('measures item separation inside a list, so rows that run together show a low ratio', async () => {
    const list = (pad: number) => `<ul style="list-style:none;margin:16px;padding:0">
      ${Array.from({ length: 5 }, (_, i) => `<li style="padding:${pad}px 0"><div class="order-card"><div>#14${i} Amara Okafor</div><div>14 Sep · £33.86</div></div></li>`).join('')}</ul>`;
    const ratioOf = async (pad: number) => {
      const { doc, ctx } = await render(list(pad));
      return spatialGrouping(doc, ctx.viewport).items.find((it) => it.data.level === 'items')?.data.betweenMedianPx as number;
    };
    expect(await ratioOf(1)).toBeLessThan(4);
    expect(await ratioOf(12)).toBeGreaterThanOrEqual(24);
  });

  it('does not read a title and a link at opposite ends of a card header as a gap inside the item', async () => {
    const { doc, ctx } = await render(`<section style="margin:16px;width:760px">
      <div class="head" style="display:flex;justify-content:space-between"><h2 style="margin:0">Recent orders</h2><a href="#">View all</a></div>
      <div class="body" style="margin-top:16px"><p style="margin:0">#1482 Amara Okafor</p><p style="margin:4px 0 0">#1481 Liam Chen</p></div></section>`);
    const items = spatialGrouping(doc, ctx.viewport).items.filter((it) => it.data.level === 'items');
    for (const it of items) expect(it.data.withinMedianPx as number).toBeLessThan(100);
  });

  it('does not compare groups separated by other content', async () => {
    const { doc } = await render(`
      <main style="width:500px">
        <section style="padding:8px"><p style="margin:0">One</p><p style="margin:8px 0 0">Two</p></section>
        <div style="height:600px">Unrelated block</div>
        <section style="padding:8px"><p style="margin:0">Three</p><p style="margin:8px 0 0">Four</p></section>
      </main>`);
    const r = spatialGrouping(doc, { width: 800, height: 600 });
    expect(r.items.filter((i) => i.data.ratio !== undefined)).toHaveLength(0);
  });
});

describe('Responsive Layout Failures: control availability', () => {
  const widths = [320, 600, 800, 1000, 1280];
  const at = async (body: string, head = '') =>
    Promise.all(widths.map(async (width) => ({ width, stateId: `sweep-${width}`, doc: (await render(body, { width, head })).doc })));

  it('fails a control that is available at narrow and wide widths but missing in between', async () => {
    const head = '<style>.phone{display:block}.desk{display:none}@media (min-width:768px){.phone{display:none}}@media (min-width:1024px){.desk{display:block}}</style>';
    const r = controlAvailability(await at('<div class="phone"><button>Confirm booking</button></div><aside class="desk"><button>Confirm booking</button></aside>', head));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].summary).toContain('not at 800–1000 px');
  });

  it('passes controls that move between regions, and controls scrolled away inside a scroller', async () => {
    const head = '<style>.phone{display:block}.desk{display:none}@media (min-width:768px){.phone{display:none}.desk{display:block}}</style>';
    const dates = `<div style="display:flex;gap:8px;overflow-x:auto;width:300px">${Array.from({ length: 12 }, (_, i) => `<button style="flex:0 0 90px">Day ${i}</button>`).join('')}</div>`;
    const r = controlAvailability(await at(`<div class="phone"><button>Confirm booking</button></div><aside class="desk"><button>Confirm booking</button></aside>${dates}`, head));
    expect(r.items).toHaveLength(0);
  });
});
