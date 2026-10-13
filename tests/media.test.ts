import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../src/config.ts';
import { buildLayoutPacket } from '../src/categories/layout/packet.ts';
import { promptConfig } from '../src/categories/layout/prompt.ts';
import { renderUserParts } from '../src/categories/layout/render.ts';
import { parseLayoutRubric } from '../src/categories/layout/rubric.ts';
import { Doc } from '../src/diagnostics/doc.ts';
import { mediaFit, pictureFit } from '../src/diagnostics/layout/observations.ts';
import type { Bundle, DiagnosticItem, DiagnosticResult, Diagnostics, ElementRecord, PictureRecord, Snapshot, StateRecord } from '../src/types.ts';

const pic = (extra: Partial<PictureRecord>): PictureRecord => ({
  id: 1,
  source: 'img',
  natural: [320, 200],
  box: [320, 200],
  fit: 'fill',
  position: ['50%', '50%'],
  decorative: false,
  ...extra,
});

describe('Picture fit', () => {
  it('measures the share of a covering picture that is cut off, and where', () => {
    const f = pictureFit(pic({ source: 'svg', fit: 'cover', box: [286, 88] }))!;
    expect(f.shown).toBeCloseTo(0.49, 2);
    expect(f.cut.top).toBeCloseTo(0.25, 2);
    expect(f.cut.bottom).toBeCloseTo(0.25, 2);
    expect(f.cut.left + f.cut.right).toBe(0);
    expect(f.distortion).toBe(0);
    expect(pictureFit(pic({ fit: 'cover', box: [305, 190] }))!.shown).toBeGreaterThan(0.99);
    const top = pictureFit(pic({ fit: 'cover', box: [286, 88], position: ['50%', '0%'] }))!;
    expect(top.cut).toMatchObject({ top: 0, bottom: 0.51 });
  });

  it('measures distortion when a picture fills a box of another shape, and none when it is contained', () => {
    expect(pictureFit(pic({ natural: [400, 300], box: [400, 250] }))!.distortion).toBeCloseTo(0.2, 2);
    expect(pictureFit(pic({ source: 'canvas', natural: [300, 150], box: [300, 300] }))!.distortion).toBeCloseTo(-0.5, 2);
    const contained = pictureFit(pic({ fit: 'contain', box: [286, 88] }))!;
    expect(contained).toMatchObject({ shown: 1, distortion: 0 });
    const natural = pictureFit(pic({ fit: 'none', natural: [800, 400], box: [400, 200] }))!;
    expect(natural.shown).toBeCloseTo(0.25, 2);
  });

  it('fits background images by background-size, and leaves out tiles, sprites and natural sizes', () => {
    const bg = (fit: string, extra: Partial<PictureRecord> = {}) => pictureFit(pic({ source: 'background', natural: [400, 300], box: [300, 100], fit, repeat: [false, false], ...extra }));
    expect(bg('cover')!.shown).toBeCloseTo(0.44, 2);
    const widthOnly = bg('100% auto', { position: ['0%', '0%'] })!;
    expect(widthOnly.cut).toMatchObject({ top: 0, bottom: 0.56 });
    expect(bg('100% 100%')!.distortion).toBeCloseTo(1.25, 2);
    expect(bg('auto')).toBeNull();
    expect(bg('40px 30px')).toBeNull();
    expect(bg('20% auto', { repeat: [true, true] })).toBeNull();
  });
});

function element(id: number, selector: string, extra: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id, parent: null, order: id, depth: 1, tag: selector.split(' > ').pop()!.match(/^[a-z0-9]+/)![0], role: null, name: null, text: null, ownText: false, selector,
    componentId: null, componentType: null, rect: { x: 0, y: 0, w: 300, h: 100 }, textRect: null, lineBoxes: 1, visible: true, display: 'block', position: 'static',
    overflowX: 'visible', overflowY: 'visible', transform: false, textOverflow: 'clip', lineClamp: 'none', whiteSpace: 'normal', scroll: { sw: 0, sh: 0, cw: 0, ch: 0, sl: 0, st: 0 },
    border: [0, 0, 0, 0], borderVisible: false, bg: null, bgImage: false, flexDirection: null, flexWrap: null, gridColumns: null, gap: null, interactive: false, disabled: false,
    inert: false, ariaHidden: false, hiddenAttr: false, closedDetails: false, overlay: false, visuallyHidden: false, media: true, svgOnlyDefs: false, labelFor: null, img: null, ...extra,
  };
}

describe('Media Cropping and Distortion observation', () => {
  it('measures pictures of at least 48 × 48 px, except SVG drawings stretched with preserveAspectRatio="none"', () => {
    const snap = {
      elements: [element(1, 'svg.car-img__svg', { name: '2019 Volkswagen Golf' }), element(2, 'svg.icon'), element(3, 'svg.chart'), element(4, 'img.hero', { visible: false })],
      pictures: [
        pic({ id: 1, source: 'svg', fit: 'cover', box: [286, 88] }),
        pic({ id: 2, source: 'svg', fit: 'contain', natural: [24, 24], box: [24, 24] }),
        pic({ id: 3, source: 'svg', fit: 'fill', natural: [100, 30], box: [600, 200] }),
        pic({ id: 4, natural: [400, 300], box: [400, 250] }),
      ],
    } as unknown as Snapshot;
    const r = mediaFit(new Doc(snap));
    expect(r.items.map((i) => i.elements[0].selector)).toEqual(['svg.car-img__svg']);
    expect(r.items[0].data).toMatchObject({ source: 'svg', fit: 'cover', shown: 0.49, naturalAspect: 1.6, boxAspect: 3.25, decorative: false });
    expect(r.summary).toContain('Least of a content picture visible: 49%');
    expect(r.summary).toContain('1 SVG drawing stretched on purpose (preserveAspectRatio="none") was left out.');
  });
});

// ---------- Findings packet ----------

function state(id: string, kind: StateRecord['kind'], width: number, viewportId: StateRecord['viewportId']): StateRecord {
  const height = kind === 'sweep' ? 900 : width === 1920 ? 1080 : width === 768 ? 1024 : 800;
  return {
    id, kind, label: id, viewportId, viewport: { width, height, dpr: 1, isMobile: false }, fixture: 'typical', status: 'collected', files: {},
    screenshots: [
      { id: `S-${id}-viewport`, kind: 'viewport', path: 'x.png', width, height, scale: 1, scrollY: 0, docHeight: height * 2 },
      { id: `S-${id}-full`, kind: 'full', path: 'x.png', width, height: height * 2, scale: 1, scrollY: 0, docHeight: height * 2 },
    ],
    consoleErrors: [], network: { external: [], failed: [] },
  };
}

const sweep = [360, 767, 768, 1920];
const bundle: Bundle = {
  schemaVersion: 1, bundleId: 'b1', caseId: 'case', interfaceId: 'iface-test', createdAt: '', collectorVersion: '', browser: { name: 'chromium', version: '1' },
  request: 'Build a used-car search page.', inputsHash: '', config: { viewports: null, sweepWidths: sweep, sweepHeight: 900, settle: null, fixedTime: '' },
  fixtures: null, coverage: [],
  states: [state('desktop', 'baseline', 1920, 'desktop'), state('tablet', 'baseline', 768, 'tablet'), state('mobile', 'baseline', 360, 'mobile'), ...sweep.map((w) => state(`sweep-${w}`, 'sweep', w, 'sweep'))],
  sweep: { widths: sweep, stateIds: sweep.map((w) => `sweep-${w}`) },
};

const CARS = ['2019 Volkswagen Golf', '2021 Toyota Corolla', '2020 Ford Puma'];
const carImage = (i: number) => `div.grid > article.car:nth-of-type(${i + 1}) > div.car-img:nth-of-type(1) > svg.car-img__svg`;

function mediaResult(stateId: string, carShown: number, boxAspect: number, extra: DiagnosticItem[] = []): DiagnosticResult {
  const cars = CARS.map((name, i) => ({
    n: i + 1,
    summary: `${carImage(i)} "${name}": …`,
    elements: [{ id: i + 1, selector: carImage(i), tag: 'svg', name, componentId: null, rect: { x: 16, y: 200 + i * 300, w: 328, h: 88 } }],
    data: { source: 'svg', fit: 'cover', decorative: false, naturalAspect: 1.6, boxAspect, drawnAspect: 1.6, shown: carShown, cut: { top: (1 - carShown) / 2, right: 0, bottom: (1 - carShown) / 2, left: 0 }, distortion: 0 },
  }));
  return { key: `media_fit@${stateId}`, diagId: 'media_fit', kind: 'observation', stateId, status: 'observed', evaluated: 3, summary: '', items: [...cars, ...extra], secondary: [] };
}

const pictureItem = (n: number, selector: string, data: Record<string, unknown>): DiagnosticItem => ({
  n,
  summary: selector,
  elements: [{ id: 10 + n, selector, tag: selector.split(' > ').pop()!.match(/^[a-z]+/)![0], name: null, componentId: null, rect: { x: 0, y: 0, w: 360, h: 120 } }],
  data: { source: 'img', fit: 'fill', decorative: false, naturalAspect: 1.33, boxAspect: 1.6, drawnAspect: 1.6, shown: 1, cut: { top: 0, right: 0, bottom: 0, left: 0 }, distortion: 0, ...data },
});

const diags: Diagnostics = {
  schemaVersion: 1, diagnosticsVersion: 'test', bundleId: 'b1', computedAt: '', transitions: [],
  results: [
    mediaResult('desktop', 1, 1.6),
    mediaResult('tablet', 1, 1.6),
    mediaResult('mobile', 0.43, 3.73, [
      pictureItem(4, 'section.promo > div.promo__backdrop', { source: 'background', fit: 'cover', decorative: true, shown: 0.3, cut: { top: 0.35, right: 0, bottom: 0.35, left: 0 } }),
      pictureItem(5, 'main > section.team > img.team-photo', { distortion: 0.2 }),
    ]),
    mediaResult('sweep-360', 0.43, 3.73),
    mediaResult('sweep-767', 0.19, 8.33),
    mediaResult('sweep-768', 1, 1.6),
    mediaResult('sweep-1920', 1, 1.6),
  ],
};

describe('Media Cropping and Distortion in the findings packet (v6)', () => {
  const parsed = parseLayoutRubric();
  const dir = path.join(ROOT, 'src/categories/layout/prompts/v6');
  const packet = buildLayoutPacket(bundle, diags, promptConfig('v6').packet);
  const text = renderUserParts(fs.readFileSync(path.join(dir, 'user.md'), 'utf8'), packet, parsed, { measurementBlocks: true }).text;
  const criterion = (id: string) => text.slice(text.indexOf(`<criterion id="${id}"`), text.indexOf('</criterion>', text.indexOf(`<criterion id="${id}"`)));

  it('describes the crop of the same pictures across states and widths in one value, under Integrity and Proportions', () => {
    const c = criterion('C');
    expect(c).toContain('Measurement: Media Cropping and Distortion.');
    expect(c).toContain(
      'What was measured: The car images "2019 Volkswagen Golf", "2021 Toyota Corolla" and "2020 Ford Puma" show 19–43% of each picture: they are scaled to fill boxes with an aspect ratio of 3.7–8.3, while the pictures\' own is 1.6, so the top and bottom are cut off. In the other states and widths measured, they show the whole picture.',
    );
    expect(c).toContain('Where: Phone 360×800; at widths 360–767 px.');
    expect(c).toMatch(/Screenshots: S-mobile-/);
    expect(c).toContain('Rubric reference: A picture scaled to fill its box normally loses a little at its edges');
    expect(text.match(/Media Cropping and Distortion/g)).toHaveLength(1);
  });

  it('reports distortion of any picture, and leaves out decorative crops and values within the reference', () => {
    expect(criterion('C')).toContain('The team image is distorted: drawn at an aspect ratio of 1.6 instead of its natural 1.3, stretched 20% wider.');
    expect(text).not.toContain('promo');
    expect(text).not.toContain('Desktop 1920×1080; ');
  });
});
