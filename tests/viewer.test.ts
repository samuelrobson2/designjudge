import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listCases, loadCase } from '../src/cases.ts';
import { buildRequest, CATEGORIES, loadOrBuildPacket } from '../src/categories/index.ts';
import { listPromptVersions } from '../src/categories/layout/prompt.ts';
import { loadExpectations } from '../src/compare/compare.ts';
import type { RunRecord } from '../src/judge/record.ts';
import { bundleDir, listBundles, listRuns, loadBundle, runDir } from '../src/store.ts';
import { readJson } from '../src/util.ts';
import { caseDisplay, CATEGORY_ORDER, FLAWED, gridLayout, PRODUCTS } from '../src/viewer/grid.ts';
import { robustness } from '../src/viewer/robustness.ts';
import { caseCategories, startViewer } from '../src/viewer/server.ts';

// The interfaces Layout's page listed before each category listed only its own.
const LAYOUT = ['booking-baseline', 'booking-demoted-cta', 'carsearch-baseline', 'dashboard-baseline', 'dashboard-gold', 'dashboard-mobile-overflow'];

describe('Viewer: the interfaces each category lists', () => {
  it('lists an interface under each category whose expectations name it or whose judge runs included it', () => {
    const byCase = caseCategories(
      {
        layout: { pairs: [{ baseline: 'a', variant: 'b', expected: 'must_drop' }] },
        typography: { pairs: [{ baseline: 'a', variant: 'c', expected: 'may_drop' }], notes: { d: 'Not compared: the direction is ambiguous.' } },
        task_fit: null,
      },
      [
        // Saved before categories existed.
        { cases: [{ caseId: 'e' }] },
        { category: 'task_fit', cases: [{ caseId: 'a' }, { caseId: 'b' }] },
        { category: 'layout', cases: [{ caseId: 'a' }] },
      ],
    );
    expect(Object.fromEntries(byCase)).toEqual({
      a: ['layout', 'typography', 'task_fit'],
      b: ['layout', 'task_fit'],
      c: ['typography'],
      d: ['typography'],
      e: ['layout'],
    });
    expect(caseCategories({ content_quality: { pairs: [] } }, []).size).toBe(0);
  });

  describe('with the saved expectations and runs', () => {
    let server: Awaited<ReturnType<typeof startViewer>>;
    let cases: { caseId: string; categories: string[] }[] = [];

    beforeAll(async () => {
      server = await startViewer(0);
      cases = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cases`)).json();
    });
    afterAll(() => server?.close());

    it('gives every interface the categories its expectations and runs put it in', () => {
      const runs = listRuns().map((id) => readJson<RunRecord>(path.join(runDir(id), 'run.json')));
      for (const c of cases) {
        for (const category of Object.keys(CATEGORIES)) {
          const e = loadExpectations(category);
          const named = !!e && (e.pairs.some((p) => p.baseline === c.caseId || p.variant === c.caseId) || !!e.notes?.[c.caseId]);
          const judged = runs.some((r) => (r.category ?? 'layout') === category && r.cases.some((x) => x.caseId === c.caseId));
          expect(c.categories.includes(category), `${c.caseId} in ${category}`).toBe(named || judged);
        }
      }
    });

    it.skipIf(!LAYOUT.every((id) => listCases().includes(id)))('keeps listing the interfaces Layout always listed', () => {
      expect(cases.filter((c) => c.categories.includes('layout')).map((c) => c.caseId)).toEqual(expect.arrayContaining(LAYOUT));
    });
  });
});

const gridIds = (category: string) => gridLayout(category).flatMap((p) => p.tests.map((t) => t.caseId));
const allGridIds = [...new Set(CATEGORY_ORDER.flatMap(gridIds))];

describe('Viewer: the grid of test interfaces', () => {
  it('lists the categories in the rating rubric’s order, everywhere', async () => {
    expect([...CATEGORY_ORDER]).toEqual(['layout', 'typography', 'visual_system', 'content_quality', 'task_fit', 'functionality']);
    expect([...CATEGORY_ORDER].sort()).toEqual(Object.keys(CATEGORIES).sort());
    const server = await startViewer(0);
    try {
      const meta = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/meta`)).json();
      expect(Object.keys(meta.categories)).toEqual([...CATEGORY_ORDER]);
      expect(Object.keys(meta.grid)).toEqual([...CATEGORY_ORDER]);
    } finally {
      server.close();
    }
  });

  it('gives each category three products, each with its own flawed test and the shared baseline and best', () => {
    for (const category of CATEGORY_ORDER) {
      expect(gridLayout(category).map((p) => [p.name, p.tests.map((t) => t.label)])).toEqual([
        ['Physio booking', ['Physio booking · Flawed', 'Physio booking · Baseline', 'Physio booking · Best']],
        ['Car search', ['Car search · Flawed', 'Car search · Baseline', 'Car search · Best']],
        ['Store dashboard', ['Store dashboard · Flawed', 'Store dashboard · Baseline', 'Store dashboard · Best']],
      ]);
      for (const p of gridLayout(category)) {
        const [flawed, baseline, best] = p.tests;
        expect(flawed.description).toMatch(/^Errors: .+\.$/);
        expect(baseline.description).toBe('The original version, as first generated.');
        expect(best.description).toBe('Cleaned up, to test how high the judge will score.');
        const product = PRODUCTS.find((x) => x.id === p.id)!;
        expect([baseline.caseId, best.caseId]).toEqual([product.baseline, product.best]);
      }
    }
    const flawed = CATEGORY_ORDER.flatMap((c) => Object.values(FLAWED[c]).map((t) => t.caseId));
    expect(new Set(flawed).size).toBe(18);
    for (const category of CATEGORY_ORDER.filter((c) => c !== 'layout')) {
      for (const p of PRODUCTS) expect(FLAWED[category][p.id].caseId).toBe(`${p.id}-flawed-${category.replace(/_/g, '-')}`);
    }
  });

  it('names an interface outside a category’s grid neutrally, never as that category’s test', () => {
    expect(caseDisplay('dashboard-gold', 'layout')).toMatchObject({ label: 'Store dashboard · Old gold version', inGrid: false });
    expect(caseDisplay('booking-demoted-cta', 'layout')).toMatchObject({ label: 'Physio booking · Flawed', inGrid: true });
    expect(caseDisplay('booking-demoted-cta', 'typography')).toMatchObject({ label: 'Physio booking · Flawed', inGrid: false });
    expect(caseDisplay('booking-flawed-typography', 'typography')).toMatchObject({ label: 'Physio booking · Flawed', inGrid: true });
    expect(caseDisplay('carsearch-baseline', 'functionality')).toMatchObject({ label: 'Car search · Baseline', inGrid: true });
    for (const id of listCases()) expect(caseDisplay(id, 'layout'), `${id} has a name`).not.toBeNull();
  });

  it('exists as a case for every grid test, with its baseline’s request', () => {
    for (const id of allGridIds) {
      expect(listCases(), id).toContain(id);
      const product = PRODUCTS.find((p) => id.startsWith(`${p.id}-`))!;
      expect(loadCase(id).request, id).toBe(loadCase(product.baseline).request);
    }
  });

  it('serves each category’s grid and every interface’s names', async () => {
    const server = await startViewer(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
      const [meta, cases] = await Promise.all([(await fetch(`${base}meta`)).json(), (await fetch(`${base}cases`)).json()]);
      for (const category of CATEGORY_ORDER) {
        expect(meta.grid[category]).toEqual(gridLayout(category));
        for (const id of listCases()) expect(meta.names[category][id], `${id} ${category}`).toEqual(caseDisplay(id, category));
      }
      for (const c of cases as { caseId: string; inGrid: boolean }[]) expect(c.inGrid, c.caseId).toBe(allGridIds.includes(c.caseId));
    } finally {
      server.close();
    }
  });

  // People see the grid's names and descriptions; the judge sees an opaque interface ID. A prompt is
  // built from the case's request and its evidence, so an uncollected case is checked by its request.
  const words = [...new Set(CATEGORY_ORDER.flatMap((c) => listCases().flatMap((id) => { const d = caseDisplay(id, c); return d ? [d.label, d.description] : []; })))];
  it('never puts a name, slot or description in what the judge is sent', () => {
    for (const caseId of listCases()) {
      const m = loadCase(caseId);
      for (const w of [caseId, m.title, m.summary ?? '', ...words].filter((w) => w.length > 6)) expect(m.request.includes(w), `${caseId} request contains "${w}"`).toBe(false);
    }
  });
  const collected = allGridIds.filter((id) => listCases().includes(id) && listBundles(id).length);
  it.skipIf(!collected.length)('never puts a name, slot or description in a judge prompt', () => {
    for (const caseId of collected) {
      const bundle = loadBundle(caseId);
      const m = loadCase(caseId);
      for (const category of Object.keys(CATEGORIES)) {
        const version = listPromptVersions(category).at(-1)!;
        const request = buildRequest(loadOrBuildPacket(bundle, version, category), bundleDir(caseId, bundle.bundleId), version);
        const text = JSON.stringify({ ...request, images: request.images.map((i) => i.id) });
        expect(text, `${caseId} ${category}`).toContain(bundle.interfaceId);
        for (const w of [caseId, m.title, ...(m.summary ? [m.summary] : []), ...words]) expect(text.includes(w), `${caseId} ${category} prompt contains "${w}"`).toBe(false);
      }
    }
  });
});

describe('Viewer: robustness tests', () => {
  it('lists each category’s planted clean-interface tests from its newest real judge run', () => {
    for (const category of CATEGORY_ORDER) {
      const r = robustness(category);
      if (!r.judgeRun) continue;
      expect(r.rows.length, category).toBeGreaterThan(0);
      expect(r.counts.asExpected).toBe(r.rows.filter((x) => x.verdict === 'as_expected').length);
      for (const row of r.rows) {
        expect(row.caseId).toMatch(/-clean$/);
        expect(row.direction).toBe(row.mutationId.startsWith('harmless-') ? 'same' : row.mutationId.startsWith('minor-') ? 'not higher' : 'lower');
        expect(row.judgedAs.replace(/^(harmless|minor)-/, '')).toBe(row.mutationId.replace(/^(harmless|minor)-/, ''));
      }
    }
  });
});

