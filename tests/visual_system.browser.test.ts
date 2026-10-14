import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VIEWPORTS } from '../src/config.ts';
import { initScript, snapshotScript, visualScript } from '../src/collect/pageScripts.ts';
import { captureOnPage } from '../src/collect/probes.ts';
import type { VisualProbeState } from '../src/collect/probeTypes.ts';
import { Doc } from '../src/diagnostics/doc.ts';
import { accessibilityViolations, focusVisibility, peerConsistency, requiredContrast, styleVocabulary, targetSize } from '../src/diagnostics/visual_system/checks.ts';
import { closeBrowser, getBrowser } from './helpers.ts';

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body { margin: 24px; font: 16px/1.4 sans-serif; color: #111; background: #fff; }
  .faint { color: #bbbbbb; }
  .field { border: 1px solid #eeeeee; padding: 6px; }
  .nofocus:focus { outline: none; }
  .tiny { width: 16px; height: 16px; padding: 0; border: 1px solid #333; margin: 0 2px 0 0; }
  .alone { width: 16px; height: 16px; padding: 0; border: 1px solid #333; margin-left: 200px; }
  .card { border: 1px solid #ccc; border-radius: 8px; padding: 12px; margin: 8px 0; background: #fff; }
  .card:nth-of-type(4) { border-radius: 2px; box-shadow: 0 4px 10px rgba(0,0,0,.25); }
  .chip { background: #f0f1f3; padding: 2px 6px; display: inline-block; }
  .drift { background: #f1f2f4; padding: 2px 6px; display: inline-block; }
  @keyframes pulse { 50% { opacity: .5; } }
  .pulse { animation: pulse 1s infinite; }
</style></head><body>
  <h1>Settings</h1>
  <p class="faint">Faint note under the title</p>
  <label for="n">Name</label> <input id="n" class="field">
  <input id="unlabelled">
  <button class="nofocus">Hidden focus</button>
  <button>Normal focus</button>
  <div><button class="tiny" aria-label="One">1</button><button class="tiny" aria-label="Two">2</button></div>
  <div><button class="alone" aria-label="Alone">3</button></div>
  <button><svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 2h12v12H2z" fill="#333"/></svg></button>
  <div><section class="card">One</section><section class="card">Two</section><section class="card">Three</section><section class="card">Four</section></div>
  <span class="chip">A</span><span class="chip">B</span><span class="chip">C</span><span class="chip">D</span><span class="drift">E</span>
  <p class="pulse">Live</p>
</body></html>`;

let probe: VisualProbeState;
let doc: Doc;

beforeAll(async () => {
  const vp = { ...VIEWPORTS.desktop, width: 1000, height: 900 };
  const page = await (await getBrowser()).newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.setContent(PAGE);
  for (const s of [await initScript(null), await snapshotScript(), await visualScript()]) await page.evaluate(s);
  probe = { version: 1, stateId: 'desktop', viewport: { width: vp.width, height: vp.height }, ...(await captureOnPage(page, vp, { motion: true, focus: true })) };
  doc = new Doc(probe.snapshot);
  await page.close();
}, 60_000);

afterAll(closeBrowser);

describe('Visual System checks on a rendered page', () => {
  it('fails pale text and a field whose border is too light to see', () => {
    const r = requiredContrast(probe, doc);
    const parts = r.items.map((i) => `${i.data.part}:${i.data.fg}`);
    expect(parts).toContain('text:#bbbbbb');
    expect(r.items.some((i) => i.data.part === 'field boundary')).toBe(true);
  });

  it('finds an unlabelled field and an unnamed icon button with axe-core', () => {
    const rules = accessibilityViolations(probe, doc).items.map((i) => i.data.rule);
    expect(rules).toEqual(expect.arrayContaining(['label', 'button-name']));
  });

  it('flags focus with no visible change, and passes the browser default ring', () => {
    const r = focusVisibility(probe, doc);
    expect(r.items.map((i) => i.summary).join(' ')).toContain('Hidden focus');
    expect(r.items.map((i) => i.summary).join(' ')).not.toContain('Normal focus');
  });

  it('fails small targets packed together, and allows a small one with room around it', () => {
    const text = targetSize(probe, doc).items.map((i) => i.summary).join(' ');
    expect(text).toMatch(/"One"|"Two"/);
    expect(text).not.toContain('"Alone"');
  });

  it('reports the odd card, a near-duplicate background and a looping animation', () => {
    expect(peerConsistency(probe, doc).items.map((i) => i.summary).join(' ')).toMatch(/3 of 4 .*share one treatment/);
    const vocab = styleVocabulary(probe, doc).items;
    expect(vocab.find((i) => i.data.kind === 'near_colour')?.data).toMatchObject({ colour: '#f1f2f4', common: '#f0f1f3' });
    expect(probe.motion!.animations.some((a) => a.infinite)).toBe(true);
  });
});
