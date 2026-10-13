import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectFunctional } from '../src/collect/functional.ts';
import type { FunctionalProbe } from '../src/collect/probeTypes.ts';
import { serveStatic, type StaticServer } from '../src/collect/server.ts';
import { controlOperability, editableResponse, formSubmission, invalidSubmission, navigationIntegrity, noEffectControls, runtimeErrors, toggleState } from '../src/diagnostics/functionality/checks.ts';
import { closeBrowser, getBrowser } from './helpers.ts';

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body { margin: 24px; font: 16px/1.4 sans-serif; }
  button, a, input { display: block; margin: 8px 0; }
  .on { background: #0f766e; color: #fff; }
  #cover-target { position: relative; }
  #cover { position: fixed; top: 0; left: 600px; width: 200px; height: 80px; z-index: 5; }
</style></head><body>
  <button id="dead">Export</button>
  <button id="live">Save</button>
  <p id="out"></p>
  <button id="boom">Sync</button>
  <a href="#">Home</a>
  <a href="#faq">FAQ</a>
  <a href="#missing">Pricing</a>
  <a href="nope.html">Archive</a>
  <input id="keeps" aria-label="City">
  <input id="clears" aria-label="Postcode">
  <button id="bold" aria-pressed="false">Bold</button>
  <button id="italic" class="look" aria-pressed="false">Italic</button>
  <button id="under" style="position:fixed;top:20px;left:620px">Covered</button>
  <div id="cover"></div>
  <form id="search" aria-label="Search"><input name="q" aria-label="Query"><button>Go</button></form>
  <form id="signup" aria-label="Sign up"><input name="email" type="email" aria-label="Email"><button>Send</button><p id="thanks" role="status"></p></form>
  <div id="faq" style="margin-top:900px">FAQ</div>
  <button id="far" style="margin-top:900px">Archive all</button>
  <script>
    document.getElementById('live').addEventListener('click', () => { document.getElementById('out').textContent = 'Saved'; });
    document.getElementById('boom').addEventListener('click', () => { undefinedSync(); });
    document.getElementById('clears').addEventListener('change', (e) => { e.target.value = ''; });
    document.getElementById('bold').addEventListener('click', (e) => { const b = e.currentTarget; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); b.classList.toggle('on'); });
    document.getElementById('italic').addEventListener('click', (e) => { e.currentTarget.classList.toggle('on'); });
    document.getElementById('search').addEventListener('submit', (e) => e.preventDefault());
    document.getElementById('signup').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = e.target.email.value;
      if (v) document.getElementById('thanks').textContent = 'Thanks, ' + v;
    });
  </script>
</body></html>`;

let server: StaticServer;
let dir: string;
let probe: FunctionalProbe;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-functional-'));
  fs.mkdirSync(path.join(dir, 'site'));
  fs.writeFileSync(path.join(dir, 'site', 'index.html'), PAGE);
  server = await serveStatic(path.join(dir, 'site'));
  probe = await collectFunctional(await getBrowser(), server.url, new URL(server.url).origin, 'desktop', null, [], path.join(dir, 'bundle'));
}, 180_000);

afterAll(async () => {
  await server?.close();
  await closeBrowser();
  fs.rmSync(dir, { recursive: true, force: true });
});

const summaries = (m: Map<string, { items: { summary: string }[] }>) => [...m.values()].flatMap((r) => r.items.map((i) => i.summary)).join('\n');

describe('Functionality probe on a page with planted faults', () => {
  it('finds the buttons that do nothing, even far down the page, and not the ones that work', () => {
    expect(probe.error).toBeUndefined();
    const text = summaries(noEffectControls(probe));
    expect(text).toContain('"Export" button does nothing');
    expect(text).toContain('"Archive all" button does nothing');
    expect(text).not.toContain('"Save"');
  });

  it('finds a control another element lies on top of', () => {
    expect(summaries(controlOperability(probe))).toContain('"Covered" button cannot be used: another element');
  });

  it('finds links that lead nowhere or to a missing page, and passes the one that works', () => {
    const text = summaries(navigationIntegrity(probe));
    expect(text).toContain('"Home" link has href="#"');
    expect(text).toContain('#missing');
    expect(text).toMatch(/"Archive" link \(nope\.html\) opens a page that returns 404/);
    expect(text).not.toContain('"FAQ"');
  });

  it('finds a field that clears itself, and a toggle whose state is not exposed', () => {
    expect(summaries(editableResponse(probe))).toContain('"Postcode" field does not keep');
    expect(summaries(editableResponse(probe))).not.toContain('"City"');
    const toggles = summaries(toggleState(probe));
    expect(toggles).toContain('"Italic"');
    expect(toggles).not.toContain('"Bold"');
  });

  it('finds a form with no response, and one that ignores an empty submission', () => {
    expect(summaries(formSubmission(probe))).toContain('"Search" form gives no response');
    expect(summaries(formSubmission(probe))).not.toContain('"Sign up"');
    expect(summaries(invalidSubmission(probe))).toContain('Submitting the "Sign up" form empty');
  });

  it('records the error a control raises', () => {
    expect(summaries(runtimeErrors([], [probe]))).toMatch(/undefinedSync is not defined \(while clicking "Sync"\)/);
  });
});
