// Preview planted layout mutations.
//
// Usage:
//   node mutations/_tools/preview.mjs <case-id> <item-id|baseline|all> [options]
//
// Options:
//   --vp=desktop,tablet,phone   viewports (default: item.where.viewports, or all three)
//   --fixture=name              content fixture (default: first of item.where.content, else typical)
//   --interact=name             interaction to perform (default: from PLAN below)
//   --widths=320,700            extra screenshots at these CSS widths (default: ends of item.where.widths)
//   --wait=ms                   settle time after load (default 800, or PLAN)
//   --early=ms                  also capture a screenshot this soon after DOMContentLoaded
//   --scroll=px                 scroll the window before the screenshot
//   --base                      also render the same conditions without the mutation (suffix -base)
//   --no-full                   skip full-page screenshots
//
// Output: mutations/_previews/<case>/<item-id>-<viewport>[-full].png

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const MUT = path.join(ROOT, 'mutations');

const VIEWPORTS = {
  desktop: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, hasTouch: false },
  tablet: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, hasTouch: true },
  phone: { viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, hasTouch: true, safeArea: { top: 24, bottom: 24, left: 0, right: 0 } },
};

// Per-item preview hints (interaction, wait, scroll, fixture) that the item JSON shape has no field for.
const PLAN = {
  'booking-baseline': {
    'field-errors-overlap-labels': { interact: 'submit-empty-details' },
    'summary-row-nowrap-expanded': { interact: 'select' },
    'sticky-header-covers-summary': { interact: 'scroll', scroll: 700 },
    'harmless-sticky-header-offset': { interact: 'scroll', scroll: 700 },
    'late-promo-banner-shift': { wait: 2000, early: 300 },
    'action-bar-covers-notes': { interact: 'scroll-bottom' },
  },
  'dashboard-baseline': {
    'order-panel-offscreen-phone': { interact: 'open-order' },
    'scrim-above-order-panel': { interact: 'open-order' },
    'topbar-covers-drawer': { interact: 'open-menu' },
    'chart-late-render-shift': { wait: 2500, early: 300 },
  },
  'carsearch-baseline': {
    'compare-bar-offscreen-expanded': { interact: 'compare-two' },
    'filters-drawer-footer-unreachable': { interact: 'open-filters' },
    'active-chips-nowrap': { interact: 'apply-filters' },
    'compare-bar-above-filters-drawer': { interact: 'compare-then-filters' },
    'car-images-late-size-shift': { wait: 2500, early: 300 },
    'harmless-chips-scroller-phone': { interact: 'apply-filters' },
  },
};

const INTERACTIONS = {
  async 'submit-empty'(page) {
    const btn = page.locator('[data-action="confirm"]:visible').first();
    await btn.click();
  },
  async 'submit-empty-details'(page) {
    await INTERACTIONS['submit-empty'](page);
    await page.evaluate(() => {
      const el = document.getElementById('section-details');
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 40);
    });
  },
  async select(page) {
    await page.locator('.option-card').first().click();
    await page.locator('.slot:not([disabled])').first().click();
  },
  async scroll(page, opts) {
    await page.evaluate((y) => window.scrollTo(0, y), opts.scroll ?? 600);
  },
  async 'scroll-bottom'(page) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  },
  async 'open-order'(page) {
    await page.locator('[data-order]:visible').first().click();
  },
  async 'open-menu'(page) {
    await page.locator('[data-action="open-menu"]').click();
  },
  async 'open-filters'(page) {
    await page.locator('.filters-btn').click();
  },
  async 'compare-two'(page) {
    await page.locator('[data-compare]').nth(0).check();
    await page.locator('[data-compare]').nth(1).check();
  },
  async 'compare-then-filters'(page) {
    await INTERACTIONS['compare-two'](page);
    await INTERACTIONS['open-filters'](page);
  },
  async 'apply-filters'(page) {
    const phone = await page.evaluate(() => matchMedia('(max-width: 767px)').matches);
    if (phone) await page.locator('.filters-btn').click();
    for (const m of ['Volkswagen', 'Ford', 'Toyota', 'Audi', 'BMW', 'Kia']) await page.locator(`[data-make="${m}"]`).check();
    await page.locator('select[data-filter="maxPrice"]').selectOption('20000');
    await page.locator('input[name="mileage"][value="60000"]').check();
    await page.locator('[data-fuel="Petrol"]').click();
    await page.locator('[data-gearbox="Manual"]').click();
    if (phone) await page.locator('.filters__foot [data-action="close-filters"]').click();
  },
};

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      opt[k] = v === undefined ? true : v;
    } else pos.push(a);
  }
  return { pos, opt };
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (!p || p.endsWith('/')) p += 'index.html';
      const file = path.join(dir, p);
      if (!file.startsWith(dir) || !fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function loadItems(caseId, which) {
  const dir = path.join(MUT, caseId);
  if (which === 'baseline') return [null];
  if (which === 'all') {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  }
  return [JSON.parse(fs.readFileSync(path.join(dir, `${which}.json`), 'utf8'))];
}

async function capture(browser, base, caseId, item, spec, outName, o) {
  const { viewport, deviceScaleFactor, hasTouch, safeArea } = spec;
  const context = await browser.newContext({ viewport, deviceScaleFactor, hasTouch, isMobile: false });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  if (safeArea) {
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: safeArea });
    } catch (e) {
      errors.push(`safe-area override unsupported: ${e.message.split('\n')[0]}`);
    }
  }
  await page.addInitScript((fx) => {
    window.__DJ_FIXTURE__ = fx;
  }, o.fixture);
  const css = o.apply && item?.css ? item.css : '';
  const js = o.apply && item?.js ? item.js : '';
  if (js) {
    await page.addInitScript((code) => {
      document.addEventListener('DOMContentLoaded', () => {
        try {
          new Function(code)();
        } catch (e) {
          console.error('mutation js threw', e);
        }
      });
    }, js);
  }
  await page.route('**/index.html', async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    if (css) body = body.replace('</head>', `<style id="dj-mutation">\n${css}\n</style>\n</head>`);
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'text/html' } });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  const dir = path.join(MUT, '_previews', caseId);
  fs.mkdirSync(dir, { recursive: true });
  if (o.early) {
    await page.waitForTimeout(Number(o.early));
    await page.screenshot({ path: path.join(dir, `${outName}-early.png`) });
  }
  await page.waitForTimeout(Math.max(0, Number(o.wait) - (Number(o.early) || 0)));
  if (o.interact) {
    await INTERACTIONS[o.interact](page, o);
    await page.waitForTimeout(400);
  }
  if (o.scroll && o.interact !== 'scroll') {
    await page.evaluate((y) => window.scrollTo(0, y), Number(o.scroll));
    await page.waitForTimeout(200);
  }
  const metrics = await page.evaluate(() => {
    const d = document.documentElement;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-bottom,0px);width:1px';
    document.body.appendChild(probe);
    const sab = probe.getBoundingClientRect().height;
    probe.remove();
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, scrollHeight: d.scrollHeight, safeAreaBottom: sab };
  });
  await page.screenshot({ path: path.join(dir, `${outName}.png`) });
  if (o.full) await page.screenshot({ path: path.join(dir, `${outName}-full.png`), fullPage: true });
  await context.close();
  const hOverflow = metrics.scrollWidth > metrics.clientWidth ? ` H-OVERFLOW ${metrics.scrollWidth}>${metrics.clientWidth}` : '';
  console.log(`  ${outName}: fixture=${o.fixture} interact=${o.interact || '-'} height=${metrics.scrollHeight} sab=${metrics.safeAreaBottom}${hOverflow}${errors.length ? ` ERRORS: ${errors.join(' | ')}` : ''}`);
}

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const [caseId, which = 'baseline'] = pos;
  if (!caseId) {
    console.error('usage: preview.mjs <case-id> <item-id|baseline|all> [--vp=..] [--fixture=..] [--interact=..] [--widths=..] [--base]');
    process.exit(1);
  }
  const siteDir = path.join(ROOT, 'cases', caseId, 'site');
  const server = await serve(siteDir);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const item of loadItems(caseId, which)) {
      const id = item ? item.id : '_baseline';
      const plan = (item && PLAN[caseId]?.[item.id]) || {};
      const vps = (opt.vp ? opt.vp.split(',') : item?.where?.viewports) || ['desktop', 'tablet', 'phone'];
      const fixture = opt.fixture || plan.fixture || item?.where?.content?.[0] || 'typical';
      const o = {
        fixture,
        interact: opt.interact ?? plan.interact,
        wait: opt.wait ?? plan.wait ?? 800,
        early: opt.early ?? plan.early,
        scroll: opt.scroll ?? plan.scroll,
        full: !opt['no-full'],
        apply: true,
      };
      if (o.interact === true || o.interact === 'none') o.interact = undefined;
      const suffix = which === 'baseline' ? `${fixture === 'typical' ? '' : `-${fixture}`}${o.interact ? `-${o.interact}` : ''}` : '';
      console.log(`${caseId} / ${id}`);
      for (const vp of vps) {
        await capture(browser, base, caseId, item, VIEWPORTS[vp], `${id}-${vp}${suffix}`, o);
        if (opt.base && item) await capture(browser, base, caseId, item, VIEWPORTS[vp], `${id}-${vp}-base`, { ...o, apply: false });
      }
      const widths = opt.widths ? opt.widths.split(',').map(Number) : item?.where?.widths || [];
      for (const w of widths) {
        const spec = { viewport: { width: w, height: 900 }, deviceScaleFactor: 1, hasTouch: w < 1024 };
        await capture(browser, base, caseId, item, spec, `${id}-w${w}${suffix}`, { ...o, full: false });
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
