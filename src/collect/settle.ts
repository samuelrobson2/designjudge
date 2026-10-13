// The one wait every collector uses. A page's clock is paused (collect.ts preparePage), so a wait
// gives the page a fixed amount of page time, then holds until it is quiet: no request open, and
// nothing changing over a rendered frame with CSS animations settled (page/quiet.ts). What the page
// shows afterwards is the same on a fast or a slow machine; wall-clock time only caps a page that
// never goes quiet.

import type { Page, Request } from 'playwright';
import { PAGE_TIME, QUIESCE } from '../config.ts';
import type { SettleResult } from '../types.ts';
import { quietScript } from './pageScripts.ts';

// Streams and media never finish loading.
const UNTRACKED = new Set(['eventsource', 'websocket', 'media']);

export class NetworkTracker {
  inflight = 0;
  lastActivity = Date.now();
  external = new Set<string>();
  failed: string[] = [];
  private open = new Map<Request, number>();

  constructor(page: Page, origin: string) {
    page.on('request', (req) => {
      this.lastActivity = Date.now();
      const url = req.url();
      if (origin && !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) this.external.add(url);
      if (UNTRACKED.has(req.resourceType())) return;
      this.open.set(req, Date.now());
      this.inflight = this.open.size;
    });
    const done = (req: Request) => {
      this.open.delete(req);
      this.inflight = this.open.size;
      this.lastActivity = Date.now();
    };
    page.on('requestfinished', done);
    page.on('requestfailed', (req) => {
      done(req);
      this.failed.push(`${req.url()} (${req.failure()?.errorText ?? 'failed'})`);
    });
  }

  // Requests still worth waiting for.
  pending(): number {
    const now = Date.now();
    let n = 0;
    for (const t of this.open.values()) if (now - t < QUIESCE.longRequestMs) n++;
    return n;
  }
}

const trackers = new WeakMap<Page, NetworkTracker>();

// Every request the page makes from now on is waited for by quiesce.
export function watchNetwork(page: Page): void {
  if (!trackers.has(page)) trackers.set(page, new NetworkTracker(page, ''));
}

export type Budget = 'load' | 'action' | 'brief';

const BUDGET_MS: Record<Budget, number> = { load: PAGE_TIME.loadMs, action: PAGE_TIME.actionMs, brief: PAGE_TIME.briefMs };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const contextGone = (err: unknown) => /Execution context was destroyed|Cannot find context|navigat/i.test(String((err as Error)?.message ?? err));

// Calls a function of page/quiet.ts, adding the script first where the page was opened without it.
export async function quietCall<T>(page: Page, fn: '__djAdvance' | '__djQuiet' | '__djHitCheck', ...args: unknown[]): Promise<T> {
  const expr = `window.${fn} ? (async () => ({ r: await window.${fn}(${args.map((a) => JSON.stringify(a)).join(', ')}) }))() : null`;
  const out = (await page.evaluate(expr)) as { r: T } | null;
  if (out) return out.r;
  await page.evaluate(await quietScript());
  return ((await page.evaluate(expr)) as { r: T }).r;
}

// Gives the page `budget` of page time, then waits until it is quiet.
export async function quiesce(page: Page, budget: Budget | number = 'action'): Promise<SettleResult> {
  const budgetMs = typeof budget === 'number' ? budget : BUDGET_MS[budget];
  const start = Date.now();
  const deadline = start + QUIESCE.capMs;
  const net = trackers.get(page);
  let spent = 0;
  let clock = true;
  let fontsReady = false;
  while (Date.now() < deadline) {
    try {
      while (net && net.pending() > 0 && Date.now() < deadline) await sleep(5);
      if (clock && spent < budgetMs) {
        const r = await quietCall<{ clock: boolean; advanced: number; blocked: boolean }>(page, '__djAdvance', budgetMs - spent);
        spent += r.advanced;
        if (!r.clock) clock = false;
        if (r.blocked) {
          await sleep(5);
          continue;
        }
      }
      const q = await quietCall<{ quiet: boolean; fonts: boolean }>(page, '__djQuiet');
      fontsReady = q.fonts;
      if (q.quiet && (!net || net.pending() === 0) && (spent >= budgetMs || !clock)) {
        return { settled: true, reason: 'settled', elapsedMs: Date.now() - start, fontsReady, pageMs: spent };
      }
    } catch (err) {
      if (!contextGone(err)) throw err;
      // The page navigated; the new document starts with its clock paused again.
      await page.waitForLoadState('load', { timeout: Math.max(1, deadline - Date.now()) }).catch(() => {});
    }
  }
  return { settled: false, reason: 'timeout', elapsedMs: Date.now() - start, fontsReady, pageMs: spent };
}
