import { afterAll, describe, expect, it } from 'vitest';
import { occludedContent } from '../src/diagnostics/layout/deterministic.ts';
import { closeBrowser, render } from './helpers.ts';

afterAll(closeBrowser);

const para = (n: number) => Array.from({ length: n }, (_, i) => `<p style="margin:0 16px 16px">Paragraph ${i + 1} with some ordinary text in it.</p>`).join('');
const check = async (body: string, opts: Parameters<typeof render>[1] = {}) => {
  const { doc, ctx } = await render(body, { width: 360, height: 640, occlusion: true, ...opts });
  return occludedContent(doc, ctx);
};

describe('Occluded Content', () => {
  it('passes a long page under a sticky header, because every paragraph scrolls clear of it', async () => {
    const r = await check(`<header style="position:sticky;top:0;height:56px;background:#fff">Title</header>${para(40)}`);
    expect(r.status).toBe('pass');
  });

  it('fails when a fixed bottom bar hides the end of the page at every scroll position', async () => {
    const r = await check(`${para(30)}<textarea id="notes" style="display:block;margin:0 16px;width:300px;height:60px">Notes</textarea>
      <div id="bar" style="position:fixed;left:0;right:0;bottom:0;height:72px;background:#fff">Confirm</div>`);
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toContain('div#bar');
    expect(r.items[0].summary).toContain('textarea#notes');
  });

  it('passes the same bar when the page leaves room for it', async () => {
    const r = await check(`<div style="padding-bottom:96px">${para(30)}<textarea style="display:block;margin:0 16px;width:300px;height:60px">Notes</textarea></div>
      <div style="position:fixed;left:0;right:0;bottom:0;height:72px;background:#fff">Confirm</div>`);
    expect(r.status).toBe('pass');
  });

  it('fails a sticky element that is hidden under another pinned element while stuck', async () => {
    const r = await check(`<header style="position:sticky;top:0;height:64px;background:#fff;z-index:2">Site</header>
      <div style="height:200px"></div>
      <aside id="summary" style="position:sticky;top:24px;background:#eef"><h2 id="sumhead" style="margin:0;padding:8px">Summary heading</h2><p style="margin:8px">Details</p></aside>${para(40)}`);
    expect(r.status).toBe('fail');
    expect(r.items.some((i) => i.summary.includes('while pinned'))).toBe(true);
  });

  it('passes a sticky sidebar taller than the screen, whose lower part is simply below the fold while stuck', async () => {
    const r = await check(`<div style="display:flex;gap:16px;padding:0 16px"><aside style="position:sticky;top:8px;align-self:flex-start;width:120px">${para(30)}</aside><main style="flex:1">${para(60)}</main></div>${para(5)}`);
    expect(r.status).toBe('pass');
  });

  it('fails content inside a dialog when a backdrop is painted above it', async () => {
    const r = await check(`${para(5)}
      <div role="dialog" id="panel" style="position:fixed;left:0;right:0;bottom:0;height:300px;background:#fff;z-index:1"><button id="close">Close</button><p>Order details</p></div>
      <div id="scrim" style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2"></div>`);
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toContain('div#scrim');
  });

  it('passes an open dialog above its backdrop, and ignores the page content beneath it', async () => {
    const r = await check(`${para(5)}
      <div style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1"></div>
      <div role="dialog" style="position:fixed;left:0;right:0;bottom:0;height:300px;background:#fff;z-index:2"><button>Close</button><p>Order details</p></div>`);
    expect(r.status).toBe('pass');
  });

  it('passes a closed off-canvas drawer, and fails one that still peeks over the content', async () => {
    const drawer = (x: number) => `<nav style="position:fixed;top:0;bottom:0;left:0;width:280px;transform:translateX(${x}px);background:#222" inert><a href="#">Home</a></nav>`;
    const page = `<header style="padding:8px 12px"><button>Open menu</button></header>${para(5)}`;
    expect((await check(`${page}${drawer(-280)}`)).status).toBe('pass');
    const peeking = await check(`${page}${drawer(-262)}`);
    expect(peeking.status).toBe('fail');
    expect(peeking.items[0].summary).toContain('nav');
  });

  it('fails a panel that extends past the left edge of the page', async () => {
    const r = await check(`<div role="dialog" style="position:fixed;top:40px;left:-80px;width:400px;background:#fff"><p style="margin:0;padding:8px">Order #1482 details that start at the left edge</p><button>Refund</button></div>`);
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toContain('screen edge');
  });

  it('treats the unsafe area as covering pinned content only when the page opts in with viewport-fit=cover', async () => {
    const bar = `${para(3)}<div style="position:fixed;left:0;right:0;bottom:0;height:56px;background:#fff"><button style="height:40px">Confirm</button></div>`;
    const insets = { top: 24, right: 0, bottom: 24, left: 0 };
    const cover = await check(bar, { viewportMeta: 'width=device-width, initial-scale=1, viewport-fit=cover', insets });
    expect(cover.status).toBe('fail');
    expect(cover.items[0].summary).toContain('unsafe area');
    expect((await check(bar, { insets })).status).toBe('pass');
  });

  it('does not count a badge placed on an image, or a label over its own field, as hiding them', async () => {
    const r = await check(`<div style="position:relative;margin:16px;width:300px"><img alt="car" style="display:block;width:300px;height:180px;background:#ccc"><span style="position:absolute;top:8px;left:8px;background:#0a0;color:#fff">Great price</span></div>
      <div style="position:relative;margin:16px"><input id="f" style="width:280px;height:48px;padding-top:18px"><label for="f" style="position:absolute;left:8px;top:4px;font-size:12px">Email</label></div>`);
    expect(r.status).toBe('pass');
  });

  it('does not count the corners of a round button as hidden by the photo beneath it', async () => {
    const r = await check(`<div style="position:relative;margin:16px;width:300px;height:180px">
      <svg width="300" height="180" role="img" aria-label="Car"><rect width="300" height="180" fill="#ccc"/></svg>
      <button style="position:absolute;top:8px;right:8px;width:36px;height:36px;border-radius:50%;border:0;background:#fff">♥</button></div>`);
    expect(r.status).toBe('pass');
  });

  it('does not count text deliberately truncated beside a button as hidden by it', async () => {
    const r = await check(`${para(2)}<div style="position:fixed;left:0;right:0;bottom:0;display:flex;gap:12px;padding:12px;background:#fff">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Choose a treatment and a time that suits you</span>
      <button style="flex:0 0 auto">Confirm booking</button></div>`);
    expect(r.status).toBe('pass');
  });

  it('ignores points hidden by a horizontal scroller, which scrolling that container reveals', async () => {
    const r = await check(`<div style="display:flex;gap:8px;overflow-x:auto;margin:16px">${Array.from({ length: 10 }, (_, i) => `<button style="flex:0 0 100px">Date ${i}</button>`).join('')}</div>`);
    expect(r.status).toBe('pass');
  });
});
