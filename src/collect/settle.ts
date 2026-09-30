import type { Page } from 'playwright';
import { SETTLE } from '../config.ts';
import type { SettleResult } from '../types.ts';

export class NetworkTracker {
  inflight = 0;
  lastActivity = Date.now();
  external = new Set<string>();
  failed: string[] = [];

  constructor(page: Page, origin: string) {
    page.on('request', (req) => {
      this.inflight++;
      this.lastActivity = Date.now();
      const url = req.url();
      if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) this.external.add(url);
    });
    const done = () => {
      this.inflight = Math.max(0, this.inflight - 1);
      this.lastActivity = Date.now();
    };
    page.on('requestfinished', done);
    page.on('requestfailed', (req) => {
      done();
      this.failed.push(`${req.url()} (${req.failure()?.errorText ?? 'failed'})`);
    });
  }

  quietFor(ms: number): boolean {
    return this.inflight === 0 && Date.now() - this.lastActivity >= ms;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signature(page: Page): Promise<string> {
  return (await page.evaluate('window.__djSignature ? window.__djSignature() : ""')) as string;
}

// Shared render-settled signal: load, fonts ready, network quiet, layout quiet; capped.
export async function waitForSettled(page: Page, tracker: NetworkTracker | null, lite = false): Promise<SettleResult> {
  const start = Date.now();
  const maxMs = lite ? SETTLE.liteMaxMs : SETTLE.maxMs;
  const layoutQuietMs = lite ? SETTLE.liteLayoutQuietMs : SETTLE.layoutQuietMs;
  let fontsReady = false;
  try {
    if (!lite) await page.waitForLoadState('load', { timeout: maxMs });
    fontsReady = (await page.evaluate('document.fonts.ready.then(() => true)')) as boolean;
  } catch {
    // Fall through to the polling loop; the timeout is reported.
  }
  let last = await signature(page);
  let stableSince = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(SETTLE.pollMs);
    const sig = await signature(page);
    if (sig !== last) {
      last = sig;
      stableSince = Date.now();
    }
    const layoutQuiet = Date.now() - stableSince >= layoutQuietMs;
    const networkQuiet = tracker ? tracker.quietFor(lite ? 0 : SETTLE.networkQuietMs) : true;
    if (layoutQuiet && networkQuiet) {
      return { settled: true, reason: 'settled', elapsedMs: Date.now() - start, fontsReady };
    }
  }
  return { settled: false, reason: 'timeout', elapsedMs: Date.now() - start, fontsReady };
}
