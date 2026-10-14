import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newContext, preparePage } from '../src/collect/collect.ts';
import { quiesce } from '../src/collect/settle.ts';
import { clickOrDispatch, pointerBlocked } from '../src/collect/steps.ts';
import { FIXED_TIME, PAGE_TIME, VIEWPORTS } from '../src/config.ts';
import { serveTimingFixture, type FixtureServer } from '../src/determinism/fixture.ts';
import { closeBrowser, getBrowser } from './helpers.ts';

let server: FixtureServer;
beforeAll(async () => {
  server = await serveTimingFixture();
});
afterAll(async () => {
  await server.close();
  await closeBrowser();
});

async function open() {
  const ctx = await newContext(await getBrowser(), VIEWPORTS.desktop);
  const page = await preparePage(ctx, null);
  await page.goto(server.url, { waitUntil: 'load' });
  const settle = await quiesce(page, 'load');
  return { ctx, page, settle };
}

describe('quiesce on a paused page clock', () => {
  it('uses the Playwright clock internals it advances the page with', async () => {
    const { ctx, page } = await open();
    try {
      const internals = await page.evaluate(() => {
        const c = (window as unknown as { __pwClock?: { controller?: Record<string, unknown>; builtins?: Record<string, unknown> } }).__pwClock;
        return { firstTimer: typeof c?.controller?._firstTimer, now: typeof (c?.controller?._now as { ticks?: number })?.ticks, setTimeout: typeof c?.builtins?.setTimeout };
      });
      expect(internals).toEqual({ firstTimer: 'function', now: 'number', setTimeout: 'function' });
    } finally {
      await ctx.close();
    }
  });

  it('gives the page its load budget of page time, with Date held at the fixed time', async () => {
    const { ctx, page, settle } = await open();
    try {
      expect(settle.settled).toBe(true);
      expect(settle.pageMs).toBe(PAGE_TIME.loadMs);
      // The banner is added 1.2 s after load.
      expect(await page.locator('.banner').count()).toBe(1);
      expect(await page.evaluate(() => Date.now())).toBe(new Date(FIXED_TIME).getTime());
    } finally {
      await ctx.close();
    }
  });

  it('waits out timers, a slow request and transitions after an action', async () => {
    const { ctx, page } = await open();
    try {
      await page.click('#t700');
      await quiesce(page, 'action');
      expect(await page.locator('#out').innerText()).toBe('Shown after 700 ms');

      await page.click('#fetch');
      await quiesce(page, 'action');
      expect(await page.locator('#out').innerText()).toBe('Loaded from the slow server');

      await page.click('#fade');
      await quiesce(page, 'action');
      expect(await page.locator('#out .fade').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

      await page.fill('#debounced', 'sw4 7aa');
      await quiesce(page, 'action');
      expect(await page.inputValue('#debounced')).toBe('SW4 ');
    } finally {
      await ctx.close();
    }
  });

  it('reads a focus style only after its transition has finished', async () => {
    const { ctx, page } = await open();
    try {
      await page.keyboard.press('Tab');
      await quiesce(page, 'brief');
      expect(await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow)).toBe('rgb(37, 99, 235) 0px 0px 0px 3px');
    } finally {
      await ctx.close();
    }
  });

  it('parks infinite animations at their start, so every capture sees the same frame', async () => {
    const { ctx, page } = await open();
    try {
      const anims = await page.evaluate(() => document.getAnimations().map((a) => ({ state: a.playState, time: Number(a.currentTime) })));
      expect(anims).toEqual([{ state: 'paused', time: 0 }]);
    } finally {
      await ctx.close();
    }
  });

  it('decides whether a control can be clicked from the page, without a timed retry', async () => {
    const { ctx, page } = await open();
    try {
      expect(await pointerBlocked(page, '#t150')).toBeNull();
      // The menu is off screen until it opens.
      expect(await pointerBlocked(page, '#close-menu')).toMatch(/outside of the viewport|not visible/);
      expect(await clickOrDispatch(page, page.locator('#close-menu'), '#close-menu')).toMatch(/outside of the viewport|not visible/);
    } finally {
      await ctx.close();
    }
  });
});
