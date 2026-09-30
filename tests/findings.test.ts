import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../src/config.ts';
import { buildLayoutPacket, LAYOUT_PACKET_VERSION_FINDINGS } from '../src/categories/layout/packet.ts';
import { promptConfig } from '../src/categories/layout/prompt.ts';
import { renderSystem, renderUserParts } from '../src/categories/layout/render.ts';
import { parseLayoutRubric } from '../src/categories/layout/rubric.ts';
import { mockProvider } from '../src/judge/providers/mock.ts';
import { validateJudgment } from '../src/judge/validate.ts';
import type { Bundle, DiagnosticItem, DiagnosticResult, Diagnostics, ElementRef, StateRecord } from '../src/types.ts';

const parsed = parseLayoutRubric();
const dir = path.join(ROOT, 'src/categories/layout/prompts/v4');

const VIEWPORTS = { desktop: [1920, 1080], tablet: [768, 1024], mobile: [360, 800] } as const;

function state(id: string, kind: StateRecord['kind'], vp: 'desktop' | 'tablet' | 'mobile' | 'sweep', extra: Partial<StateRecord> = {}): StateRecord {
  const [width, height] = vp === 'sweep' ? [Number(id.split('-')[1]), 900] : VIEWPORTS[vp];
  const shots = kind === 'baseline' || kind === 'stress' || kind === 'interactive';
  return {
    id,
    kind,
    label: id,
    viewportId: vp,
    viewport: { width, height, dpr: vp === 'desktop' ? 1 : 2, isMobile: vp === 'mobile' },
    fixture: 'typical',
    status: 'collected',
    files: {},
    screenshots: shots
      ? [
          { id: `S-${id}-viewport`, kind: 'viewport', path: 'x.png', width, height, scale: 1, scrollY: 0, docHeight: height * 2 },
          { id: `S-${id}-full`, kind: 'full', path: 'x.png', width, height: height * 2, scale: 1, scrollY: 0, docHeight: height * 2 },
        ]
      : [],
    consoleErrors: [],
    network: { external: [], failed: [] },
    ...extra,
  };
}

const el = (selector: string, extra: Partial<ElementRef> = {}): ElementRef => ({
  id: 1,
  selector,
  tag: selector.split(' > ').pop()!.match(/^[a-z0-9]+/)![0],
  name: null,
  componentId: null,
  rect: { x: 12, y: 34, w: 56, h: 78 },
  ...extra,
});

const CARD = 'main#main > section.card.orders-card:nth-of-type(2)';
const TABLE = `${CARD} > table.orders-table`;

function item(n: number, summary: string, elements: ElementRef[], data: Record<string, unknown>): DiagnosticItem {
  return { n, summary, elements, data };
}

function result(diagId: string, stateId: string | null, status: DiagnosticResult['status'], items: DiagnosticItem[] = [], extra: Partial<DiagnosticResult> = {}): DiagnosticResult {
  const kind = ['spatial_grouping', 'alignment_outliers', 'layout_stability', 'responsive_adaptation'].includes(diagId) ? 'observation' : 'deterministic';
  return { key: stateId ? `${diagId}@${stateId}` : diagId, diagId, kind, stateId, status, evaluated: 10, summary: `${diagId} summary`, items, secondary: [], ...extra };
}

const overflow = (stateId: string, px: number, vw: number) =>
  result('container_overflow', stateId, 'fail', [
    item(1, `${px} px horizontal overflow: content spills outside ${CARD} [recent-orders] "Recent orders" (overflow-x: visible); caused by ${TABLE}`, [el(CARD, { name: 'Recent orders', componentId: 'recent-orders' }), el(TABLE)], {
      axis: 'x',
      overflowPx: px,
      overflowStyle: 'visible',
      kind: 'visible',
      viewportWidth: vw,
    }),
  ]);

const truncation = (selector: string, label: string) => ({
  kind: 'truncated',
  label: 'Deliberate truncation (not failures)',
  items: [item(1, `${selector} "${label}" truncates its text (ellipsis)`, [el(selector)], { axis: 'x', overflowPx: 20 })],
});

const bundle: Bundle = {
  schemaVersion: 1,
  bundleId: 'b1',
  caseId: 'case',
  interfaceId: 'iface-test',
  createdAt: '',
  collectorVersion: '',
  browser: { name: 'chromium', version: '1' },
  request: 'Build a store dashboard.',
  inputsHash: '',
  config: { viewports: null, sweepWidths: [320, 360, 400], sweepHeight: 900, settle: null, fixedTime: '' },
  fixtures: { supported: ['empty', 'typical', 'dense', 'expanded', 'stress'] },
  coverage: [],
  states: [
    state('desktop', 'baseline', 'desktop'),
    state('mobile', 'baseline', 'mobile', { safeArea: { requested: { top: 24, right: 0, bottom: 24, left: 0 }, applied: true, resolved: null } }),
    state('stress-desktop', 'stress', 'desktop', { fixture: 'stress', stressFill: { kept: { fill: 1, choose: 0, select: 0, check: 0 }, actions: [] } as unknown as StateRecord['stressFill'] }),
    state('interactive-auto-mobile', 'interactive', 'mobile', {
      interactiveStateId: 'auto',
      interactiveDescription: 'After clicking button "Confirm booking": 3 alert or validation elements appeared; new content appeared (about 8% of the screen area)',
    }),
    state('fixture-dense-mobile', 'fixture', 'mobile', { fixture: 'dense' }),
    state('sweep-320', 'sweep', 'sweep'),
    state('sweep-360', 'sweep', 'sweep'),
    state('sweep-400', 'sweep', 'sweep'),
  ],
  sweep: { widths: [320, 360, 400], stateIds: ['sweep-320', 'sweep-360', 'sweep-400'] },
};

const diags: Diagnostics = {
  schemaVersion: 1,
  diagnosticsVersion: 'test',
  bundleId: 'b1',
  computedAt: '',
  transitions: [],
  results: [
    result('region_overlap', 'desktop', 'pass'),
    result('region_overlap', 'mobile', 'pass'),
    result('container_overflow', 'desktop', 'pass', [], { secondary: [truncation('main#main > p.lead', 'Desktop-only truncated text')] }),
    { ...overflow('mobile', 410, 360), secondary: [truncation('main#main > p.lead', 'Phone truncated text')] },
    overflow('fixture-dense-mobile', 410, 360),
    overflow('sweep-320', 450, 320),
    overflow('sweep-360', 412, 360),
    result('container_overflow', 'sweep-400', 'pass'),
    result('page_horizontal_overflow', 'desktop', 'pass'),
    result('page_horizontal_overflow', 'mobile', 'fail', [
      item(1, 'Document 753 px wide vs 360 px viewport (393 px horizontal overflow at 360 px)', [el(TABLE)], { documentWidth: 753, viewportWidth: 360, overflowPx: 393, viewportMeta: 'width=device-width' }),
    ]),
    result('occluded_content', 'stress-desktop', 'fail', [
      item(
        1,
        '1 element is hidden by div#app > div.compare-bar "Compare cars" (fixed) at every scroll position: section.results > div.more > button.btn.btn--secondary "Show more cars" (27% never visible)',
        [el('div#app > div.compare-bar', { name: 'Compare cars' }), el('section.results > div.more > button.btn.btn--secondary', { name: 'Show more cars' })],
        { obstruction: 'element', obstructionPosition: 'fixed', hiddenElements: 1, maxHiddenFraction: 0.27, pinned: false },
      ),
    ]),
    result('responsive_layout_failures', null, 'fail', [
      item(1, 'Container Overflow fails in 2 of 3 widths (320px, 360px). First: …', [el(CARD)], { check: 'container_overflow' }),
      item(2, 'button "Menu" can be used at 320 px and at 400 px but not at 360 px', [], {
        check: 'control_availability',
        control: 'button|menu',
        missingWidths: [360],
        availableBelow: 320,
        availableAbove: 400,
      }),
    ]),
    result('content_growth_failures', null, 'fail', [item(1, 'Container Overflow fails in 2 of 15 combinations', [el(CARD)], { check: 'container_overflow' })]),
    result('spatial_grouping', 'desktop', 'observed', [
      item(1, `Items of ${CARD} [recent-orders] "Recent orders" (2, semantic <section>): 16 px between and 32 px inside (0.5×)`, [el(CARD, { name: 'Recent orders' })], {
        level: 'items',
        withinMedianPx: 32,
        betweenMedianPx: 16,
        ratio: 0.5,
        groups: 2,
      }),
      item(2, 'Items of main#main > section.kpis [kpis] "Key metrics" (4, semantic <section>): 60 px between and 20 px inside (3×)', [el('main#main > section.kpis', { name: 'Key metrics' })], {
        level: 'items',
        withinMedianPx: 20,
        betweenMedianPx: 60,
        ratio: 3,
        groups: 4,
      }),
      item(3, 'input#q "Search orders" and form.search > button.btn "Search" are 8 px apart', [el('input#q', { name: 'Search orders' }), el('form.search > button.btn', { name: 'Search' })], { gapPx: 8 }),
    ]),
    result('spatial_grouping', 'mobile', 'observed', [
      item(1, 'Smallest left inset: header > a.brand "Shop home" at 16 px from the viewport edge', [el('header > a.brand', { name: 'Shop home' })], { side: 'left', insetPx: 16 }),
      item(2, 'Smallest right inset: header > span.avatar "MP" at 24 px from the viewport edge', [el('header > span.avatar', { name: 'MP' })], { side: 'right', insetPx: 24 }),
    ]),
    result('alignment_outliers', 'desktop', 'observed'),
    result('layout_stability', 'desktop', 'observed', [], { data: { cumulativeScore: 0, largestShift: 0, shiftCount: 0 } }),
    result('responsive_adaptation', null, 'observed', [
      item(1, 'Between 767 and 768 px, main#main > div.grid changes from grid 1 col to grid 2 col', [], { fromWidth: 767, toWidth: 768, parent: 'main#main > div.grid', from: 'grid 1 col', to: 'grid 2 col' }),
      item(2, '[revenue-plot] changes …', [], {
        componentId: 'revenue-plot',
        selector: 'main#main > div.chart',
        areaChange: -0.5,
        aspectFrom: 3,
        aspectTo: 1.5,
        samples: [{ width: 320, w: 250, h: 200 }, { width: 1920, w: 800, h: 260 }],
      }),
      item(3, '[kpi-strip] changes …', [], {
        componentId: 'kpi-strip',
        selector: 'main#main > div.kpi-strip',
        areaChange: -0.95,
        aspectFrom: 8,
        aspectTo: 2,
        samples: [{ width: 320, w: 90, h: 40 }, { width: 1920, w: 1400, h: 175 }],
      }),
    ]),
  ],
};

const packet = buildLayoutPacket(bundle, diags, promptConfig('v4').packet);
const { parts, text } = renderUserParts(fs.readFileSync(path.join(dir, 'user.md'), 'utf8'), packet, parsed);
const system = renderSystem(fs.readFileSync(path.join(dir, 'system.md'), 'utf8'), parsed);
// Check issues are blocks ("  Issue 3 (cite F-…)", then What was found / Where / Screenshots);
// measurements are lines ("  - (cite O-…) …").
const lines = text.split('\n');
const issueBlocks = lines.flatMap((l, i) => (/^  Issue \d+ \(cite F-/.test(l) ? [lines.slice(i, i + 4).join('\n')] : []));
const measurementLines = lines.filter((l) => /^  - \(cite O-/.test(l));
const citedIds = [...text.matchAll(/\(cite ([CFO]-[^)]+)\)/g)].map((m) => m[1]);

describe('Findings-only prompt (v4)', () => {
  it('uses the findings packet version', () => {
    expect(packet.packetVersion).toBe(LAYOUT_PACKET_VERSION_FINDINGS);
  });

  it('sends no passing checks and no PASS lines', () => {
    expect(text).not.toMatch(/\bPASS\b/);
    expect(text).not.toContain('Region Overlap');
    expect(text).not.toContain('Content-Growth');
    expect(text).not.toContain('Desktop-only truncated text');
  });

  it('names elements in plain words, without selectors, boxes, data or counts', () => {
    expect(text).not.toMatch(/nth-of-type| > |\b(div|span|section|main|button|input|header|form)[.#][\w-]/);
    expect(text).not.toMatch(/\[\d+, \d+, \d+, \d+\]/);
    expect(text).not.toMatch(/Data:|evaluated\)|Elements:/);
    expect(text).toContain('the orders card "Recent orders"');
    expect(text).toContain('The "Show more cars" button is covered by the compare bar "Compare cars" (fixed)');
  });

  it('describes states by what they are, not how they were collected', () => {
    for (const phrase of ['device pixel ratio', 'user agent', 'CSS px', 'safe-area', 'found automatically', 'content fixture', 'No screenshot', 'Other coverage', 'filled with long text', 'matrix']) {
      expect(text, phrase).not.toContain(phrase);
    }
    expect(text).toContain('- Desktop 1920×1080 (desktop)');
    expect(text).toContain('- Stress (desktop): dense content, longer pseudo-localized text, form controls filled in (stress-desktop)');
    expect(text).toContain('- Phone after clicking the "Confirm booking" button: 3 alert or validation elements appeared (interactive-auto-mobile)');
    expect(text).toContain('pseudo-localized on purpose');
    // Sweep widths without a screenshot share one line; fixture states with a finding are listed.
    expect(text).toContain('- Widths 320–360 px (sweep-320, sweep-360)');
    expect(text).toContain('- Phone with dense content (fixture-dense-mobile)');
  });

  it('merges one issue across states, content variants and widths into one line', () => {
    const blocks = issueBlocks.filter((b) => b.includes('F-container_overflow'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('(cite F-container_overflow-mobile-1)');
    expect(blocks[0]).toContain('What was found: Content spills 410–450 px horizontally out of the orders card "Recent orders"');
    expect(blocks[0]).toContain('Where: Phone 360×800; phone with dense content; at widths 320–360 px.');
  });

  it('turns control availability into an issue line', () => {
    expect(text).toContain('The "Menu" button can be used at 320 px and at 400 px but not at 360 px.');
  });

  it('shows only observation measurements outside or close to the reference', () => {
    expect(text).toContain('The 2 items of the orders card "Recent orders": 16 px between neighbouring items; 32 px between the parts inside each item (ratio 0.5×; reference ~2×).');
    expect(text).not.toContain('Key metrics');
    expect(text).toContain('The "Search orders" field and the "Search" button are 8 px apart (reference ~12 px).');
    expect(text).toContain('16 px on the left (the "Shop home" link)');
    expect(text).not.toContain('"MP"');
    expect(text).not.toContain('Alignment Outliers');
    expect(text).not.toContain('Runtime Layout Stability');
    expect(text).toContain('kpi-strip');
    expect(text).not.toContain('revenue-plot');
    expect(text).toContain('grid: 1 column → 2 columns at 768 px');
  });

  it('shows context lines only next to a finding of the same check in the same state', () => {
    const notCounted = text.split('\n').filter((l) => l.includes('Not counted'));
    expect(notCounted).toHaveLength(1);
    expect(notCounted[0]).toContain('"Phone truncated text"');
    expect(notCounted[0]).toContain('(Phone 360×800)');
    expect(text.indexOf('Not counted')).toBeGreaterThan(text.indexOf('F-container_overflow-mobile-1'));
  });

  it('registers every cited ID in packet.index', () => {
    const ids = citedIds;
    const shots = parts.filter((p) => p.type === 'image').map((p) => (p as { id: string }).id);
    expect(ids.length).toBeGreaterThan(5);
    for (const id of [...ids, ...shots]) expect(packet.index[id], id).toBeDefined();
    // The result each cited item belongs to is registered too, for the mock judge and checks.csv.
    expect(packet.index['C-container_overflow-sweep-320']).toMatchObject({ type: 'check', status: 'fail' });
    expect(packet.index['C-container_overflow-desktop']).toBeUndefined();
  });

  it('keeps the v3 screenshots, except redundant sweep and phone first-screen captures, with plain captions', () => {
    const v3 = buildLayoutPacket(bundle, diags, promptConfig('v3').packet);
    const ids = packet.images.map((i) => i.id);
    for (const id of v3.images.map((i) => i.id).filter((id) => !/^S-sweep-|^S-mobile-viewport$/.test(id))) expect(ids).toContain(id);
    // A sweep screenshot stays only if it shows an issue no other screenshot shows.
    for (const img of packet.images.filter((i) => i.stateId.startsWith('sweep-'))) expect(img.marks?.length).toBeGreaterThan(0);
    expect(text).toContain('Screenshot S-desktop-full: Desktop 1920×1080 — full page; the top 1080 px is the first screen.');
  });

  it('gives the judge a short reading guide', () => {
    expect(system).toContain('Checks that are not listed found no problems.');
    expect(system).toContain('Measurements that are not listed were within the reference.');
    expect(system).not.toContain('No model was involved');
    expect(system).not.toMatch(/\{\{|Element boxes|evaluated|verbatim/);
    for (const c of parsed.criteria) expect(text).toContain(`Criterion ${c.id} — ${c.name}: ${c.statement}`);
    expect(text).not.toContain('Relevant screenshots');
  });

  it('lets the mock judge produce valid output', async () => {
    const res = await mockProvider('ok').call({ instructions: system, userText: text, images: [] } as any, { model: 'm', effort: 'low', caseId: 'case', repeat: 1, packet });
    const { validation } = validateJudgment(JSON.parse(res.outputText!), packet);
    expect(validation.schemaValid).toBe(true);
    expect(validation.refIssues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });
});

describe('Findings marked on screenshots (v4)', () => {
  it('numbers every check issue, says which screenshots show it, and leaves measurements unmarked', () => {
    expect(issueBlocks.length).toBeGreaterThan(0);
    for (const b of issueBlocks) {
      expect(b).toMatch(/What was found: /);
      expect(b).toMatch(/Where: /);
      expect(b).toMatch(/Screenshots: (red outline \d+ in S-|none show it)/);
    }
    for (const l of measurementLines) expect(l).not.toMatch(/red outline|Screenshots:/);
    expect(text).toContain('Automated checks that failed for this criterion');
  });

  it('points marked images at marked copies whose marks lie inside the image', () => {
    for (const img of packet.images.filter((i) => i.marks?.length)) {
      expect(img.path).toMatch(/\.marked-[0-9a-f]{10}\.png$/);
      expect(img.sourcePath).toBeTruthy();
      for (const m of img.marks!) {
        expect(m.rect.x).toBeGreaterThanOrEqual(0);
        expect(m.rect.y).toBeGreaterThanOrEqual(0);
        expect(m.rect.x + m.rect.w).toBeLessThanOrEqual(img.width);
        expect(m.rect.y + m.rect.h).toBeLessThanOrEqual(img.height);
      }
    }
  });

  it('tells the judge what the red outlines are, in the guide, the screenshot intro and marked captions', () => {
    expect(system).toContain('# Red outlines on screenshots');
    expect(system).toContain('were drawn by the evaluation, not by the interface');
    expect(text).toContain('Red rectangles with a red number tag were drawn by the evaluation, not by the interface');
    for (const img of packet.images.filter((i) => i.marks?.length)) expect(img.caption).toMatch(/Red outlines mark where automated checks failed: issues? \d/);
  });
});

describe('Measurements laid out like check issues (v6)', () => {
  const v6 = renderUserParts(fs.readFileSync(path.join(dir, 'user.md'), 'utf8'), packet, parsed, { measurementBlocks: true }).text;
  const v6Lines = v6.split('\n');
  const valueBlocks = v6Lines.flatMap((l, i) => (/^  Value \(cite O-/.test(l) ? [v6Lines.slice(i, i + 4)] : []));

  it('gives every measured value its own block with what, where and screenshots, like a check issue', () => {
    expect(valueBlocks).toHaveLength(measurementLines.length);
    for (const [, what, where, shots] of valueBlocks) {
      expect(what).toMatch(/^    What was measured: /);
      expect(where).toMatch(/^    Where: /);
      expect(shots).toMatch(/^    Screenshots: (S-[\w-]+(, S-[\w-]+)*|none show it|none; it is measured across widths)\.$/);
    }
    expect(v6).not.toMatch(/^  - \(cite O-/m);
    expect(valueBlocks.some(([, , , s]) => /S-desktop-full/.test(s))).toBe(true);
  });

  it('leaves the checks and the rest of the message as in v4', () => {
    const withoutMeasurements = (t: string) => t.replace(/Measurement: [\s\S]*?(?=\n\n(?:Measurement:|<\/evidence>)|\n<\/evidence>)/g, '');
    expect(withoutMeasurements(v6)).toBe(withoutMeasurements(text));
  });
});
