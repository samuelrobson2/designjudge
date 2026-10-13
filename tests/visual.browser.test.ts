import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveStatic, type StaticServer } from '../src/collect/server.ts';
import { collectVisual, looksUnchanged, type VisualCapture } from '../src/collect/visual.ts';
import { closeBrowser, getBrowser } from './helpers.ts';

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body { margin: 24px; font: 16px/1.4 sans-serif; }
  button { all: unset; display: inline-block; margin: 8px; padding: 8px 12px; border: 1px solid #333; background: #fff; }
  .a:hover { background: #2563eb; color: #fff; }
  .a:focus-visible { outline: 3px solid #f59e0b; }
  .b { border-radius: 8px; }
  .b:focus { outline: none; }
  .clicky { display: inline-block; padding: 8px; background: #eee; cursor: pointer; }
  .box { display: inline-block; padding: 8px; border: 1px solid #999; }
  .box input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .box:has(input:checked) { background: #0f766e; color: #fff; }
</style></head><body>
  <button class="a">Has hover</button>
  <button class="b">No hover</button>
  <div class="clicky" onclick="this.dataset.n = 1">Clickable div</div>
  <label class="box"><input type="checkbox"> Custom box</label>
</body></html>`;

let server: StaticServer;
let dir: string;
let capture: VisualCapture;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-visual-'));
  fs.mkdirSync(path.join(dir, 'site'));
  fs.writeFileSync(path.join(dir, 'site', 'index.html'), PAGE);
  server = await serveStatic(path.join(dir, 'site'));
  capture = await collectVisual(await getBrowser(), server.url, new URL(server.url).origin, path.join(dir, 'bundle'), null);
}, 120_000);

afterAll(async () => {
  await server?.close();
  await closeBrowser();
  fs.rmSync(dir, { recursive: true, force: true });
});

const group = (label: string) => {
  const g = capture.viewports.find((v) => v.viewport === 'desktop')!.groups.find((x) => x.label === label);
  expect(g, label).toBeDefined();
  return { ...g!, cell: (state: string) => g!.cells.find((c) => c.state === state)! };
};

describe('Visual System capture', () => {
  it('shows a real hover and focus style, and flags controls without one', () => {
    const a = group('Has hover');
    expect(looksUnchanged(a.cell('hover'))).toBe(false);
    expect(a.cell('hover').changes.join(' ')).toContain('#2563eb');
    expect(looksUnchanged(a.cell('focus'))).toBe(false);
    const b = group('No hover');
    expect(looksUnchanged(b.cell('hover'))).toBe(true);
    expect(looksUnchanged(b.cell('focus'))).toBe(true);
  });

  it('finds a clickable element without a control role, and notes that it cannot take focus', () => {
    const d = group('Clickable div');
    expect(d.kind).toBe('clickable element without a control role');
    expect(d.cell('focus').image).toBeNull();
    expect(d.cell('focus').note).toMatch(/keyboard/);
  });

  it('captures a custom checkbox by its label, and its selected state', () => {
    const box = group('Custom box');
    expect(box.kind).toBe('checkbox');
    expect(box.cell('selected').image).not.toBeNull();
    expect(looksUnchanged(box.cell('selected'))).toBe(false);
  });

  it('draws the sheet, and colour-blind and greyscale views of it and the first screen', () => {
    for (const v of capture.viewports) {
      expect(v.error).toBeUndefined();
      for (const im of [v.sheet, v.screen, v.sheetViews.deuteranopia, v.sheetViews.achromatopsia, v.screenViews.deuteranopia, v.screenViews.achromatopsia]) {
        expect(im && fs.existsSync(path.join(dir, 'bundle', im.path))).toBe(true);
      }
    }
    expect(capture.viewports.find((v) => v.viewport === 'mobile')!.groups[0].cells.find((c) => c.state === 'hover')!.note).toMatch(/Touch/);
  });
});
