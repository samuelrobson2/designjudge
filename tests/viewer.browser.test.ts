import type { AddressInfo } from 'node:net';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATEGORY_ORDER, gridLayout } from '../src/viewer/grid.ts';
import { robustness } from '../src/viewer/robustness.ts';
import { startViewer } from '../src/viewer/server.ts';
import { closeBrowser, getBrowser } from './helpers.ts';

interface Category {
  id: string;
  name: string;
  ratingVersions: string[];
  criteria: { id: string }[];
}

let server: Awaited<ReturnType<typeof startViewer>>;
let base = '';
let page: Page;
let categories: Category[] = [];
let cases: { caseId: string; title: string; summary: string | null; categories: string[]; latest?: { interfaceId: string } | null }[] = [];
let runs: { runId: string; category?: string; provider?: string }[] = [];

beforeAll(async () => {
  server = await startViewer(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (p: string) => (await fetch(`${base}/api/${p}`)).json();
  const meta = await get('meta');
  categories = (Object.values(meta.categories) as Category[]).filter((c) => c.ratingVersions.length);
  [cases, runs] = await Promise.all([get('cases'), get('runs')]);
  page = await (await getBrowser()).newPage({ viewport: { width: 1200, height: 900 } });
}, 60_000);

afterAll(async () => {
  await page?.close();
  await closeBrowser();
  server?.close();
});

const homeHash = (id: string) => (id === 'layout' ? '#/' : `#/?cat=${id}`);

// The interfaces (as their links), the grid's cards and the number of judge runs a home page lists, once it shows `cat`.
async function home(cat: Category) {
  await page.waitForFunction((name) => document.querySelector('.cat-picker a.active')?.textContent === name, cat.name);
  return {
    links: await page.locator('.card h3 a').evaluateAll((as) => as.map((a) => a.getAttribute('href'))),
    products: await page.locator('.product__name').allTextContents(),
    previews: await page.locator('.product .product__thumb').count(),
    cards: await page.locator('.product .card').evaluateAll((els) => els.map((el) => [el.getAttribute('data-case'), el.querySelector('h3')?.textContent, el.querySelector('.card__summary')?.textContent, el.querySelector('.card__foot')?.textContent])),
    runs: await page.locator('tbody tr.link-row').count(),
    robust: await page.locator('table.robust tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))),
    robustSummary: await page.locator('.robust__summary').textContent().catch(() => null),
    counts: await page.locator('.section-title .count').allTextContents(),
  };
}

describe('Viewer home page', () => {
  it("shows the category's own grid of test interfaces, its robustness tests and only its judge runs", async () => {
    expect(categories.length).toBeGreaterThan(1);
    expect(categories.map((c) => c.id)).toEqual(CATEGORY_ORDER.filter((id) => categories.some((c) => c.id === id)));
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const cat of categories) {
      const grid = gridLayout(cat.id).flatMap((p) => p.tests);
      const robust = robustness(cat.id);
      await page.goto(`${base}/${homeHash(cat.id)}`);
      const shown = await home(cat);
      const ownRuns = runs.filter((r) => (r.category ?? 'layout') === cat.id);
      // The category picker comes first, in the rubric's order, with large tap targets.
      expect(await page.locator('#app > div > :first-child').getAttribute('class'), cat.id).toBe('cat-picker');
      expect(await page.locator('.cat-picker a').allTextContents()).toEqual(categories.map((c) => c.name));
      for (const box of await page.locator('.cat-picker a').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);
      expect(shown.products, cat.id).toEqual(['Physio booking', 'Car search', 'Store dashboard']);
      expect(shown.robust.map((r) => r[0]), cat.id).toEqual(robust.rows.map((r) => r.product));
      expect(shown.robust.map((r) => r[2]), cat.id).toEqual(robust.rows.map((r) => r.direction));
      if (robust.rows.length) expect(shown.robustSummary, cat.id).toBe(`${robust.counts.asExpected} of ${robust.counts.total} as expected.`);
      expect(shown.cards.map(([id, title, description]) => [id, title, description]), cat.id).toEqual(grid.map((t) => [t.caseId, `${t.slotName} Version`, t.description]));
      expect(shown.previews, cat.id).toBe(shown.products.length);
      const collected = grid.filter((t) => cases.find((c) => c.caseId === t.caseId)?.latest);
      expect(shown.links, cat.id).toEqual(collected.map((t) => `#/case/${t.caseId}${cat.id === 'layout' ? '' : `?cat=${cat.id}`}`));
      for (const [id, , , foot] of shown.cards) expect(foot, `${cat.id} ${id}`).toContain(collected.some((t) => t.caseId === id) ? 'Rate' : 'Not collected yet');
      expect(shown.runs, cat.id).toBe(ownRuns.length);
      expect(shown.counts, cat.id).toEqual(['9', String(ownRuns.length), ...(robust.rows.length ? [String(robust.rows.length)] : [])]);
      // Robustness tests come last, below the judge runs.
      expect((await page.locator('.section-title h1, .section-title h2').allTextContents()).slice(-2), cat.id).toEqual(['Judge runs', 'Robustness tests']);
      // They start folded, with their result in view, and open on a click.
      if (robust.rows.length) {
        await expect.poll(() => page.locator('table.robust').isVisible(), cat.id).toBe(false);
        expect(await page.locator('.robust-wrap > summary .robust__summary').isVisible(), cat.id).toBe(true);
        await page.locator('.robust-wrap > summary').click();
        expect(await page.locator('table.robust').isVisible(), cat.id).toBe(true);
      }
    }
    expect(errors).toEqual([]);
  });

  it('names interfaces on run pages, with no expected outcomes and no case titles', async () => {
    const titles = cases.flatMap((c) => [c.title, c.summary].filter((x): x is string => !!x));
    for (const cat of categories) {
      const run = runs.find((r) => (r.category ?? 'layout') === cat.id && !(r as { broken?: boolean }).broken && r.provider !== 'mock');
      if (!run) continue;
      await page.goto(`${base}/#/run/${run.runId}`);
      await page.waitForSelector('.disclosure');
      const text = (await page.locator('#app').textContent()) ?? '';
      expect(text, run.runId).not.toMatch(/Baseline vs\. variant|hidden from the judge|baseline vs\. variant verdicts/i);
      for (const t of titles) expect(text.includes(t), `${run.runId} shows "${t}"`).toBe(false);
      const names = await page.locator('.case-cell__name').allTextContents();
      expect(names.length, run.runId).toBeGreaterThan(0);
      for (const n of names) expect(n, run.runId).toMatch(/^(Physio booking|Car search|Store dashboard) · /);
    }
  });

  it('heads an interface page with its name and description, never its case title', async () => {
    for (const cat of categories) {
      for (const t of gridLayout(cat.id).flatMap((p) => p.tests)) {
        const c = cases.find((x) => x.caseId === t.caseId);
        if (!c?.latest) continue;
        await page.goto(`${base}/#/case/${t.caseId}${cat.id === 'layout' ? '' : `?cat=${cat.id}`}`);
        await page.waitForFunction((label) => document.querySelector('.page-head h1')?.textContent === label, t.label);
        expect(await page.locator('.page-head .case-description').textContent()).toBe(t.description);
        expect(await page.locator('.crumbs').textContent()).toBe(`${cat.name} test interfaces / ${t.label}`);
        const head = (await page.locator('.page-head').textContent()) ?? '';
        for (const s of [c.title, c.summary].filter((x): x is string => !!x)) expect(head.includes(s), `${t.caseId}: "${s}"`).toBe(false);
      }
    }
  });

  it("switches lists with the category picker, and links back to the category's page", async () => {
    const [layout, other] = [categories.find((c) => c.id === 'layout')!, categories.find((c) => c.id !== 'layout')!];
    await page.goto(`${base}/#/`);
    await home(layout);
    await page.getByRole('link', { name: other.name, exact: true }).click();
    const shown = await home(other);
    expect(shown.runs).toBe(runs.filter((r) => r.category === other.id).length);

    // A run opened from the list leads back to its category's page.
    if (shown.runs) {
      await page.locator('tbody tr.link-row').first().click();
      await page.waitForSelector('.crumbs');
      expect(await page.locator('.crumbs a').first().getAttribute('href')).toBe(homeHash(other.id));
      await page.locator('.crumbs a').first().click();
      await home(other);
    }

    // So does an interface, whose page opens on that category's human ratings.
    if (shown.links.length) {
      await page.locator('.card h3 a').first().click();
      await page.waitForFunction((name) => document.querySelector('.crumbs') && document.querySelector('.cat-picker a.active')?.textContent === name, other.name);
      expect(await page.locator('.crumbs a').first().getAttribute('href')).toBe(homeHash(other.id));
      expect(await page.locator('nav.tabs a.active').textContent()).toMatch(/^Ratings/);
      expect(await page.locator('#app .cat-picker + .crumbs + .page-head').count()).toBe(1);
    }
  });

  it('names what is rated and asks a question for each evaluation point, in every category', async () => {
    const iface = (cases as { caseId: string; latest?: { interfaceId: string } }[]).find((c) => c.caseId === 'booking-baseline' && c.latest)?.latest?.interfaceId;
    if (!iface) return;
    await page.goto(`${base}/#/`);
    await page.evaluate(() => localStorage.clear());
    try {
      for (const cat of categories) {
        await page.goto(`${base}/#/rate/${iface}${cat.id === 'layout' ? '' : `?cat=${cat.id}`}`);
        await page.waitForSelector('.rate-intro');
        expect(await page.locator('.page-head h1').textContent(), cat.id).toBe('Rate Physio booking · Baseline');
        expect(await page.locator('.steps-list').textContent(), cat.id).not.toContain('how well the interface serves it');
        await page.locator('.agree input').fill('Viewer test');
        await page.locator('.agree button').click();
        for (const criterion of cat.criteria) {
          await page.waitForFunction((cid) => document.querySelector('.rate-form__head h2')?.textContent?.startsWith(`${cid} ·`), criterion.id);
          const prompts = await page.locator('.prompts li').evaluateAll((lis) => lis.map((li) => [li.textContent, li.getAttribute('title')]));
          expect(prompts.length, `${cat.id} ${criterion.id}`).toBeGreaterThan(0);
          for (const [text, title] of prompts) expect(text, `${cat.id} ${criterion.id}: no question for ${title}`).not.toBe(title);
          // Visual System raters see the palette and controls sheets the judge gets, on every criterion.
          const sheets = page.locator('.gallery-wrap', { has: page.locator('summary h2', { hasText: 'Palette and controls in each state' }) });
          if (cat.id === 'visual_system') {
            expect(await sheets.locator('.gallery__item code').allTextContents(), criterion.id).toEqual(expect.arrayContaining(['S-palette-desktop', 'S-controls-desktop', 'S-controls-mobile']));
          } else expect(await sheets.count(), `${cat.id} ${criterion.id}`).toBe(0);
          await page.locator('.rate-form__foot button', { hasText: 'Next:' }).click();
        }
        await page.waitForFunction(() => document.querySelector('.rate-form__head h2')?.textContent === 'Final judgement');
      }
    } finally {
      await page.evaluate(() => localStorage.clear());
    }
  });

  it("says so when an interface hasn't been collected or a category has no runs yet", async () => {
    const cat = categories.find((c) => c.id !== 'layout')!;
    await page.route('**/api/cases', async (route) => {
      const list = (await (await route.fetch()).json()) as typeof cases;
      await route.fulfill({ json: list.map((c) => (c.caseId === 'booking-clean' ? { ...c, latest: null } : c)) });
    });
    await page.route('**/api/runs', async (route) => {
      const list = (await (await route.fetch()).json()) as typeof runs;
      await route.fulfill({ json: list.filter((r) => r.category !== cat.id) });
    });
    try {
      await page.goto(`${base}/${homeHash(cat.id)}`);
      const shown = await home(cat);
      const card = shown.cards.find(([id]) => id === 'booking-clean')!;
      expect(card[1]).toBe('Best Version');
      expect(card[3]).toContain('Not collected yet');
      expect(shown.links).not.toContain(`#/case/booking-clean?cat=${cat.id}`);
      expect(shown.runs).toBe(0);
      expect(await page.locator('#app').textContent()).toContain(`No ${cat.name} judge runs yet.`);
    } finally {
      await page.unrouteAll();
    }
  });
});
