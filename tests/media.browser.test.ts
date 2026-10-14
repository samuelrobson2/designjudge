import { afterAll, describe, expect, it } from 'vitest';
import { mediaFit } from '../src/diagnostics/layout/observations.ts';
import { closeBrowser, render } from './helpers.ts';

afterAll(closeBrowser);

const car = (box: string) => `
  <div class="car-img" style="${box};background:#e9edf1">
    <svg class="car-img__svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" role="img" aria-label="2019 Volkswagen Golf" style="display:block;width:100%;height:100%">
      <rect width="320" height="200" fill="#ccc"/><circle cx="160" cy="140" r="20"/>
    </svg>
  </div>`;

// Draws a 400 × 300 PNG and uses it for every img[data-src] and [data-bg].
const loadPhotos = `(async () => {
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 300;
  c.getContext('2d').fillRect(0, 0, 400, 300);
  const url = c.toDataURL('image/png');
  for (const im of document.querySelectorAll('img[data-src]')) { im.src = url; await im.decode(); }
  for (const el of document.querySelectorAll('[data-bg]')) el.style.backgroundImage = 'url(' + url + ')';
})()`;

describe('Picture capture', () => {
  it('records an inline SVG drawing with its viewBox and preserveAspectRatio', async () => {
    const { snap, doc } = await render(`${car('width:286px;height:88px')}${car('width:320px;aspect-ratio:16/10')}`);
    const pics = snap.pictures!.filter((p) => p.source === 'svg');
    expect(pics).toHaveLength(2);
    expect(pics[0]).toMatchObject({ natural: [320, 200], box: [286, 88], fit: 'cover', position: ['50%', '50%'], decorative: false });
    const items = mediaFit(doc).items;
    expect(items.map((i) => i.data.shown)).toEqual([0.49, 1]);
    expect(items[0].data.cut).toMatchObject({ top: 0.25, bottom: 0.25, left: 0, right: 0 });
  });

  it('leaves out icons and drawings stretched with preserveAspectRatio="none"', async () => {
    const { snap, doc } = await render(`
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M2 2h20v20H2z"/></svg>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="Revenue" style="width:600px;height:200px"><polyline points="0,30 50,0 100,20"/></svg>`);
    expect(snap.pictures!.map((p) => p.fit)).toEqual(['contain', 'fill']);
    expect(mediaFit(doc).items).toHaveLength(0);
  });

  it('records images and canvases with object-fit, and which are decorative', async () => {
    const { snap, doc } = await render(
      `<img data-src alt="Team photo" style="display:block;width:400px;height:250px">
       <img data-src alt="" style="display:block;width:300px;height:100px;object-fit:cover;object-position:50% 0%">
       <canvas width="300" height="150" style="display:block;width:300px;height:300px"></canvas>`,
      { height: 900, script: loadPhotos },
    );
    const [stretched, banner, canvas] = snap.pictures!;
    expect(stretched).toMatchObject({ source: 'img', natural: [400, 300], box: [400, 250], fit: 'fill', decorative: false });
    expect(banner).toMatchObject({ fit: 'cover', position: ['50%', '0%'], decorative: true });
    expect(canvas).toMatchObject({ source: 'canvas', natural: [300, 150], fit: 'fill' });
    const byId = new Map(mediaFit(doc).items.map((i) => [i.elements[0].id, i.data]));
    expect(byId.get(stretched.id)!.distortion).toBeCloseTo(0.2, 2);
    expect(byId.get(banner.id)).toMatchObject({ decorative: true, cut: { top: 0, bottom: 0.56 } });
    expect(byId.get(canvas.id)!.distortion).toBeCloseTo(-0.5, 2);
  });

  it('records background images with their natural size, and treats one with text on it as a backdrop', async () => {
    const box = 'width:300px;height:100px;background-size:cover;background-position:center;background-repeat:no-repeat';
    const { snap, doc } = await render(
      `<div class="photo" data-bg style="${box}"><button aria-label="Save">♡</button></div>
       <section class="hero" data-bg style="${box}"><h2>Spring sale</h2></section>
       <a href="#" class="tile" data-bg style="display:block;${box}">Shop the range</a>
       <div class="pattern" data-bg style="width:300px;height:100px;background-size:20%"></div>`,
      { script: loadPhotos },
    );
    const bgs = snap.pictures!.filter((p) => p.source === 'background');
    expect(bgs).toHaveLength(4);
    expect(bgs[0]).toMatchObject({ natural: [400, 300], box: [300, 100], fit: 'cover', repeat: [false, false], decorative: false });
    expect(bgs.slice(1, 3).map((p) => p.decorative)).toEqual([true, true]);
    const shown = mediaFit(doc).items.map((i) => [i.elements[0].selector.split(' > ').pop(), i.data.shown]);
    expect(shown).toEqual([
      ['div.photo:nth-of-type(1)', 0.44],
      ['section.hero', 0.44],
      ['a.tile', 0.44],
    ]);
  });
});
