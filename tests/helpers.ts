import { chromium, type Browser } from 'playwright';
import { initScript, snapshotScript } from '../src/collect/pageScripts.ts';
import { Doc } from '../src/diagnostics/doc.ts';
import type { Snapshot } from '../src/types.ts';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser) browser = await chromium.launch();
  return browser;
}

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}

export interface Rendered {
  snap: Snapshot;
  doc: Doc;
  ctx: { stateId: string; viewport: { width: number; height: number } };
}

type Insets = { top: number; right: number; bottom: number; left: number };

export async function render(
  body: string,
  opts: { width?: number; height?: number; head?: string; viewportMeta?: string; occlusion?: boolean; insets?: Insets; script?: string } = {},
): Promise<Rendered> {
  const width = opts.width ?? 800;
  const height = opts.height ?? 600;
  const b = await getBrowser();
  const page = await b.newPage({ viewport: { width, height } });
  try {
    await page.setContent(
      `<!doctype html><html><head><meta name="viewport" content="${opts.viewportMeta ?? 'width=device-width, initial-scale=1'}"><style>body{margin:0;font:16px/1.4 sans-serif}</style>${opts.head ?? ''}</head><body>${body}</body></html>`,
    );
    await page.evaluate(await initScript(null));
    await page.evaluate(await snapshotScript());
    if (opts.script) await page.evaluate(opts.script);
    const snap = (await page.evaluate('window.__djSnapshot(8000)')) as Snapshot;
    if (opts.occlusion) snap.occlusion = (await page.evaluate(`window.__djOcclusion(${JSON.stringify(opts.insets ?? null)})`)) as Snapshot['occlusion'];
    return { snap, doc: new Doc(snap), ctx: { stateId: 'test', viewport: { width, height } } };
  } finally {
    await page.close();
  }
}
