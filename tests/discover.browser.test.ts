import { afterAll, describe, expect, it } from 'vitest';
import { discoverCombinations, discoverOnPage } from '../src/collect/discover.ts';
import { closeBrowser, getBrowser } from './helpers.ts';

afterAll(closeBrowser);

const cards = Array.from({ length: 30 }, (_, i) => `<article class="card" data-make="${['Audi', 'BMW', 'Ford'][i % 3]}" style="height:200px;border:1px solid #ccc;margin:8px 0">Car ${i + 1} <label><input type="checkbox" class="cmp"> Compare</label></article>`).join('');

const html = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
  <button id="open" type="button">Filters</button>
  <div id="dlg" role="dialog" hidden style="position:fixed;top:0;bottom:0;right:0;width:70%;background:#eee"><button id="close" type="button">Close</button></div>
  <fieldset>${['Audi', 'BMW', 'Ford'].map((m) => `<label><input type="checkbox" name="make" value="${m}"> ${m}</label>`).join('')}</fieldset>
  <div id="chips"></div>
  <main>${cards}</main>
  <div id="bar" hidden style="position:fixed;left:0;right:0;bottom:0;height:80px;background:#333;color:#fff">Compare bar</div>
  <script>(() => {
    const sync = () => {
      const makes = [...document.querySelectorAll('input[name=make]:checked')].map((x) => x.value);
      document.getElementById('chips').innerHTML = makes.map((m) => '<span class="chip">' + m + ' ✕</span>').join(' ');
      for (const c of document.querySelectorAll('.card')) c.hidden = makes.length > 0 && !makes.includes(c.dataset.make);
      document.getElementById('bar').hidden = !document.querySelector('.cmp:checked');
    };
    document.addEventListener('change', sync);
    document.getElementById('open').onclick = () => (document.getElementById('dlg').hidden = false);
    document.getElementById('close').onclick = () => (document.getElementById('dlg').hidden = true);
  })()</script>
</body></html>`;

// Small layers a click opens, each well under 2% of the 1280×800 screen, and two controls that
// open the same dialog.
const layers = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
  <main style="position:relative;padding:24px;height:1200px">
    <p><button type="button" class="info" aria-describedby="tip">?</button></p>
    <div id="tip" role="tooltip" hidden style="position:absolute;top:60px;left:24px;width:160px;height:40px;background:#222;color:#fff">Free cancellation</div>
    <p><button type="button" class="more" aria-haspopup="menu" aria-expanded="false">More</button></p>
    <ul id="menu" role="menu" hidden style="position:absolute;top:140px;left:24px;width:160px;height:120px;margin:0;background:#fff;border:1px solid #ccc"><li role="menuitem">Edit</li><li role="menuitem">Delete</li></ul>
    <p><button type="button" class="when">Pick a date</button></p>
    <div id="pop" hidden style="position:absolute;z-index:5;top:220px;left:24px;width:200px;height:90px;background:#fff;border:1px solid #ccc">Calendar</div>
    <p><button type="button" class="faq" aria-expanded="false">Can I cancel?</button></p>
    <p id="answer" hidden style="width:600px;margin:0">Yes, up to a day before.</p>
    <p style="position:relative"><button type="button" class="save">Save</button><span id="badge" hidden style="position:absolute;z-index:1;top:-6px;width:16px;height:16px;background:red"></span></p>
    <p><button type="button" class="noop" aria-expanded="false">Details</button></p>
    <p><button type="button" class="open-a">Filters</button> <a href="#filters" class="open-b">Edit filters</a></p>
  </main>
  <div id="dlg" role="dialog" hidden style="position:fixed;top:0;right:0;bottom:0;width:40%;background:#eee">Filters</div>
  <script>(() => {
    const show = (id) => { document.getElementById(id).hidden = false; };
    const on = (cls, fn) => document.querySelector(cls).addEventListener('click', (e) => { e.preventDefault(); fn(e.currentTarget); });
    on('.info', () => show('tip'));
    on('.more', (b) => { b.setAttribute('aria-expanded', 'true'); show('menu'); });
    on('.when', () => show('pop'));
    on('.faq', (b) => { b.setAttribute('aria-expanded', 'true'); show('answer'); });
    on('.save', () => show('badge'));
    on('.noop', (b) => b.setAttribute('aria-expanded', 'true'));
    on('.open-a', () => show('dlg'));
    on('.open-b', () => show('dlg'));
  })()</script>
</body></html>`;

describe('Interactive state discovery: small layers a click opens', () => {
  it('keeps tooltips, menus, popovers and expanded sections however small, and one of two controls that open the same dialog', async () => {
    const page = await (await getBrowser()).newPage({ viewport: { width: 1280, height: 800 } });
    try {
      const reset = async () => void (await page.setContent(layers));
      await reset();
      const { found, picks, attempts } = await discoverOnPage(page, reset, 10);
      const outcome = (label: string) => attempts.find((a) => a.label === label)?.outcome;
      const described = (label: string) => found.find((f) => f.candidate.label === label)?.description ?? '';
      expect(described('?')).toContain('a menu, tooltip or popover appeared');
      expect(described('More')).toContain('a menu, tooltip or popover appeared');
      expect(described('Pick a date')).toContain('a menu, tooltip or popover appeared');
      expect(described('Can I cancel?')).toContain('a collapsed section or menu was expanded');
      // A small badge, and a control that only says it expanded something, open nothing.
      expect(outcome('Save')).toBe('no_change');
      expect(outcome('Details')).toBe('no_change');
      expect(found.filter((f) => ['Filters', 'Edit filters'].includes(f.candidate.label))).toHaveLength(2);
      expect(picks.filter((p) => ['Filters', 'Edit filters'].includes(p.candidate.label))).toHaveLength(1);
      expect(picks.map((p) => p.candidate.label)).toEqual(expect.arrayContaining(['?', 'More', 'Pick a date', 'Can I cancel?']));
    } finally {
      await page.close();
    }
  });
});

describe('Interactive state discovery: states that need several clicks', () => {
  it('finds a second click that combines two one-click states, and every choice applied together', async () => {
    const page = await (await getBrowser()).newPage({ viewport: { width: 800, height: 600 } });
    try {
      const reset = async () => void (await page.setContent(html));
      await reset();
      const { found, load } = await discoverOnPage(page, reset);
      expect(found.map((f) => f.candidate.label)).toEqual(expect.arrayContaining(['Filters', 'Compare', 'Audi']));
      const { sequences, choices } = await discoverCombinations(page, reset, load, found);
      // The compare bar over the open dialog is a state neither click reaches alone.
      expect(sequences.some((s) => s.steps.map((x) => x.label).sort().join('+') === 'Compare+Filters')).toBe(true);
      // Closing the dialog again returns to the page at load, so it is not kept.
      expect(sequences.every((s) => s.steps[1].label !== 'Close')).toBe(true);
      expect(choices!.steps.map((s) => s.label)).toEqual(expect.arrayContaining(['Audi', 'BMW', 'Ford']));
      expect(choices!.description).toMatch(/^After applying \d+ choices \(/);
    } finally {
      await page.close();
    }
  });
});
