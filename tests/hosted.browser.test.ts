import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { BrowserContext, Frame, Page, Request } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCase } from '../src/cases.ts';
import { buildHostedSite } from '../src/hosted/publish.ts';
import { startViewer } from '../src/viewer/server.ts';
import { closeBrowser, getBrowser } from './helpers.ts';
import { LOGIN_COOKIE, serveBuildOutput } from './hosted-output.ts';

let out = '';
let local = '';
let viewer: Awaited<ReturnType<typeof startViewer>>;
const servers: { close: () => void }[] = [];
let interfaces: { caseId: string; interfaceId: string; fixtures: string[] }[] = [];

beforeAll(async () => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-hosted-'));
  await buildHostedSite(out);
  const cases: { caseId: string; latest?: { interfaceId: string } }[] = JSON.parse(fs.readFileSync(path.join(out, 'static/data/cases.json'), 'utf8'));
  interfaces = cases
    .filter((c) => c.latest && fs.existsSync(path.join(out, 'static/site', c.caseId)))
    .map((c) => ({ caseId: c.caseId, interfaceId: c.latest!.interfaceId, fixtures: ['typical', ...(loadCase(c.caseId).fixtures?.supported ?? []).filter((f) => f !== 'typical')] }));
  viewer = await startViewer(0);
  local = `http://127.0.0.1:${(viewer.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  await closeBrowser();
  viewer?.close();
  servers.forEach((s) => s.close());
  if (out) fs.rmSync(out, { recursive: true, force: true });
});

async function serve(protect = false) {
  const s = await serveBuildOutput(out, { protect });
  servers.push(s);
  return s.base;
}

// A rater's browser, signed in where the site asks for a login.
async function raterContext(base: string, viewport = { width: 1400, height: 900 }): Promise<BrowserContext> {
  const ctx = await (await getBrowser()).newContext({ viewport });
  await ctx.addCookies([{ name: LOGIN_COOKIE, value: 'signed-in', url: base, sameSite: 'Lax' }]);
  return ctx;
}

async function openRating(page: Page, base: string, interfaceId: string) {
  await page.goto(`${base}/#/rate/${interfaceId}`);
  await page.locator('.agree input').fill('Hosted test');
  await page.locator('.agree button').click();
  await page.waitForSelector('.live');
}

const liveFrame = (page: Page, caseId: string) => page.frames().find((f) => new URL(f.url()).pathname === `/site/${caseId}/`);

// A case may link to files it doesn't have, such as a planted broken image; the site only has to serve the files a case has.
function caseHasFile(url: string): boolean {
  const m = new URL(url).pathname.match(/^\/site\/([^/]+)\/(.+)$/);
  return !m || fs.existsSync(path.resolve('cases', m[1], 'site', decodeURIComponent(m[2])));
}

// The address a request chain started from, before any redirect (such as to a login page).
function firstUrl(r: Request): string {
  let q = r;
  while (q.redirectedFrom()) q = q.redirectedFrom()!;
  return q.url();
}

// Whether the frame's styles were applied (the body no longer has the browser's default font) and its script ran.
async function frameRendered(frame: Frame | undefined) {
  if (!frame) return 'no frame';
  await frame.waitForLoadState('load');
  return frame.evaluate(() => {
    if (!document.styleSheets.length) return 'no styles';
    const font = getComputedStyle(document.body).fontFamily;
    if (/^(Times|"Times New Roman"|serif)\b/.test(font)) return `default font ${font}`;
    return document.querySelector('main, #app')?.children.length ? 'rendered' : 'script did not run';
  });
}

describe('Live interface on the rating page', () => {
  const places = [
    ['the local viewer', () => Promise.resolve(local)],
    ['the hosted build on a public address', () => serve()],
    ['the hosted build behind a login', () => serve(true)],
  ] as const;
  for (const [where, address] of places) {
    it(`renders each interface in ${where}, at every size and content option`, async () => {
      const base = await address();
      const hosted = base !== local;
      const ctx = await raterContext(base);
      const page = await ctx.newPage();
      const failed: string[] = [];
      const extra: string[] = [];
      page.on('response', (r) => new URL(r.url()).pathname.startsWith('/site/') && r.status() !== 200 && caseHasFile(r.url()) && failed.push(`${r.status()} ${r.url()}`));
      page.on('request', (r) => r.frame() !== page.mainFrame() && r.resourceType() !== 'document' && caseHasFile(firstUrl(r)) && extra.push(r.url()));
      try {
        expect(interfaces.length).toBeGreaterThan(5);
        for (const { caseId, interfaceId, fixtures } of interfaces) {
          await openRating(page, base, interfaceId);
          expect(await page.locator('.live__blocked').count(), caseId).toBe(0);
          for (const fixture of fixtures) {
            if ((await page.locator('.live__content select').inputValue().catch(() => 'typical')) !== fixture) {
              await Promise.all([
                page.waitForResponse((r) => r.request().resourceType() === 'document' && r.url().includes(`/site/${caseId}/?fixture=${fixture}`)),
                page.locator('.live__content select').selectOption(fixture),
              ]);
            }
            for (const size of ['Desktop', 'Tablet', 'Phone']) {
              await page.locator('.live__bar .seg button', { hasText: size }).click();
              expect(await frameRendered(liveFrame(page, caseId)), `${caseId} ${fixture} ${size}`).toBe('rendered');
            }
          }
        }
        expect(failed).toEqual([]);
        // A hosted interface is one self-contained page, so the sandboxed frame never fetches anything itself.
        if (hosted) expect(extra).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 240_000);
  }

  it('looks the same hosted as the interface it was collected from', async () => {
    const base = await serve(true);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 360, height: 800 }]) {
      const ctx = await raterContext(base, viewport);
      const page = await ctx.newPage();
      try {
        for (const { caseId, fixtures } of interfaces) {
          for (const fixture of fixtures) {
            const query = fixture === 'typical' ? '' : `?fixture=${fixture}`;
            const shot = async (origin: string) => {
              await page.goto(`${origin}/site/${caseId}/${query}`, { waitUntil: 'load' });
              await page.evaluate(() => document.fonts.ready);
              return page.screenshot({ fullPage: true, animations: 'disabled' });
            };
            const [original, hosted] = [await shot(local), await shot(base)];
            expect(hosted.equals(original), `${caseId} ${fixture} ${viewport.width}px`).toBe(true);
          }
        }
      } finally {
        await ctx.close();
      }
    }
  }, 240_000);

  it('sends an interface address without the trailing slash to the one with it', async () => {
    const base = await serve();
    const res = await fetch(`${base}/site/${interfaces[0].caseId}`, { redirect: 'manual' });
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`/site/${interfaces[0].caseId}/`);
  });

  it("says so when the interface page can't be loaded, rather than showing what came back", async () => {
    const base = await serve();
    const ctx = await raterContext(base);
    const page = await ctx.newPage();
    try {
      const { caseId, interfaceId } = interfaces[0];
      await page.route(`**/site/${caseId}/**`, (route) => route.fulfill({ status: 302, headers: { location: '/login' } }));
      await openRating(page, base, interfaceId);
      await page.waitForSelector('.live__blocked');
      expect(await page.locator('iframe.live__frame').count()).toBe(0);
      expect(await page.locator('.live__blocked a').getAttribute('href')).toBe(`/site/${caseId}/`);
    } finally {
      await ctx.close();
    }
  });
});
