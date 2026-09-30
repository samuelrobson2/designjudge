import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  COLLECTOR_VERSION,
  ELEMENT_CAP,
  EVIDENCE_DIR,
  FIXED_TIME,
  SETTLE,
  SWEEP_HEIGHT,
  SWEEP_WIDTHS,
  VIEWPORTS,
  type FixtureName,
  type Insets,
  type ViewportSpec,
} from '../config.ts';
import { caseDir } from '../cases.ts';
import type {
  Bundle,
  CaseManifest,
  CoverageEntry,
  ScreenshotRecord,
  ShiftEntry,
  Snapshot,
  StateKind,
  StateRecord,
  Step,
} from '../types.ts';
import { ensureDir, hashDir, log, mapLimit, pngSize, sha256, timestampId, writeJson } from '../util.ts';
import { initScript, snapshotScript } from './pageScripts.ts';
import { serveStatic, type StaticServer } from './server.ts';
import { NetworkTracker, waitForSettled } from './settle.ts';
import { runStep } from './steps.ts';
import { fillForStress } from './stress.ts';
import { discoverOnPage, type Attempt } from './discover.ts';

interface PlannedState {
  id: string;
  kind: StateKind;
  label: string;
  viewport: ViewportSpec;
  fixture: FixtureName | null;
  interactive?: { id: string; description: string; steps: Step[]; captureScrollTo?: string; captureY?: number | null };
  // Checked like any other state, but no screenshot goes to the judge.
  supporting?: boolean;
}

const FIXTURE_LABEL: Record<FixtureName, string> = {
  empty: 'Empty content',
  typical: 'Typical content',
  dense: 'Dense content',
  expanded: 'Expanded strings',
  stress: 'Dense content + expanded strings',
};

export function planStates(manifest: CaseManifest): { planned: PlannedState[]; coverage: CoverageEntry[] } {
  const planned: PlannedState[] = [];
  const coverage: CoverageEntry[] = [];
  const supported = new Set(manifest.fixtures?.supported ?? []);
  const hasFixtures = supported.size > 0;
  const baseFixture: FixtureName | null = supported.has('typical') ? 'typical' : null;

  planned.push({ id: 'desktop', kind: 'baseline', label: 'Baseline Desktop', viewport: VIEWPORTS.desktop, fixture: baseFixture });
  planned.push({ id: 'tablet', kind: 'baseline', label: 'Baseline Tablet', viewport: VIEWPORTS.tablet, fixture: baseFixture });
  planned.push({ id: 'mobile', kind: 'baseline', label: 'Baseline Mobile', viewport: VIEWPORTS.mobile, fixture: baseFixture });

  if (supported.has('stress')) {
    planned.push({ id: 'stress-desktop', kind: 'stress', label: 'Combined Stress (desktop)', viewport: VIEWPORTS.desktop, fixture: 'stress' });
  } else {
    coverage.push({
      stateId: 'stress-desktop',
      label: 'Combined Stress (desktop)',
      status: 'unavailable',
      reason: hasFixtures ? 'The interface does not support the stress fixture.' : 'The interface exposes no fixture interface.',
    });
  }

  for (const vp of [VIEWPORTS.desktop, VIEWPORTS.tablet, VIEWPORTS.mobile]) {
    for (const fx of ['empty', 'dense', 'expanded', 'stress'] as FixtureName[]) {
      if (fx === 'stress' && vp.id === 'desktop') continue; // same as the Combined Stress state
      const id = `fixture-${fx}-${vp.id}`;
      const label = `${FIXTURE_LABEL[fx]} (${vp.id})`;
      if (supported.has(fx)) planned.push({ id, kind: 'fixture', label, viewport: vp, fixture: fx });
      else
        coverage.push({
          stateId: id,
          label,
          status: 'unavailable',
          reason: hasFixtures ? `The interface does not support the ${fx} fixture.` : 'The interface exposes no fixture interface.',
        });
    }
  }

  // Declared states override automatic discovery, which runs in collectCase.
  const interactive = manifest.interactiveStates ?? [];
  for (const spec of interactive) {
    for (const vpId of spec.viewports) {
      const vp = VIEWPORTS[vpId];
      planned.push({
        id: `interactive-${spec.id}-${vpId}`,
        kind: 'interactive',
        label: `Interactive: ${spec.description} (${vpId})`,
        viewport: vp,
        fixture: baseFixture,
        interactive: {
          id: spec.id,
          description: spec.description,
          steps: spec.stepsByViewport?.[vpId] ?? spec.steps,
          captureScrollTo: spec.capture?.scrollTo,
        },
      });
    }
  }

  coverage.push({
    stateId: 'rtl',
    label: 'RTL',
    status: manifest.rtlRequired ? 'unavailable' : 'not_collected',
    reason: manifest.rtlRequired
      ? 'The request requires RTL, but RTL collection is not implemented in this pilot.'
      : 'Not required by the user request.',
  });

  return { planned, coverage };
}

async function newContext(browser: Browser, vp: ViewportSpec, width = vp.width, height = vp.height): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    userAgent: vp.userAgent,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  });
}

// Planted-defect testing: CSS appended to <head> and a script run once, both at DOMContentLoaded.
export interface Injection {
  css?: string | null;
  js?: string | null;
}

function injectionScript(inject: Injection): string {
  return `(() => {
    const css = ${JSON.stringify(inject.css ?? '')};
    const js = ${JSON.stringify(inject.js ?? '')};
    const apply = () => {
      if (css) {
        const s = document.createElement('style');
        s.setAttribute('data-dj-injected', '');
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
      }
      if (js) {
        try { (0, eval)(js); } catch (e) { console.error('injected script failed: ' + e.message); }
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
    else apply();
  })()`;
}

async function preparePage(ctx: BrowserContext, fixture: FixtureName | null, inject?: Injection): Promise<Page> {
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(FIXED_TIME));
  await page.addInitScript({ content: await initScript(fixture) });
  if (inject && (inject.css || inject.js)) await page.addInitScript({ content: injectionScript(inject) });
  await page.addInitScript({ content: await snapshotScript() });
  return page;
}

// The snapshot, then the occlusion probe (which scrolls through the page and restores the scroll
// position). Safe-area insets are passed only when they were applied.
async function takeSnapshot(page: Page, insets: Insets | null = null): Promise<Snapshot> {
  const snap = (await page.evaluate(`window.__djSnapshot(${ELEMENT_CAP})`)) as Snapshot;
  try {
    snap.occlusion = (await page.evaluate(`window.__djOcclusion(${JSON.stringify(insets)})`)) as Snapshot['occlusion'];
  } catch (err) {
    log(`  ! occlusion probe failed: ${(err as Error).message.split('\n')[0]}`);
  }
  return snap;
}

async function screenshot(
  page: Page,
  stateDir: string,
  bundleDir: string,
  id: string,
  kind: 'viewport' | 'full' | 'scrolled',
): Promise<ScreenshotRecord> {
  const file = path.join(stateDir, `${kind}.png`);
  // One image pixel per CSS pixel: the page still renders at the device pixel ratio, but images
  // stay small enough to send without downscaling.
  const buf = await page.screenshot({ path: file, fullPage: kind === 'full', animations: 'disabled', caret: 'hide', scale: 'css' });
  const { width, height } = pngSize(buf);
  const { scrollY, docHeight } = (await page.evaluate(
    '({ scrollY: window.scrollY, docHeight: document.documentElement.scrollHeight })',
  )) as { scrollY: number; docHeight: number };
  return { id, kind, path: path.relative(bundleDir, file), width, height, scale: 1, scrollY, docHeight };
}

// A full-page capture paints fixed elements at their original viewport position, mid-page,
// which reads as an overlap. They are hidden for this capture only; the viewport shot shows them.
async function fullPageScreenshot(page: Page, stateDir: string, bundleDir: string, id: string): Promise<ScreenshotRecord> {
  const hiddenFixed = (await page.evaluate(`(() => {
    const hidden = [];
    for (const el of document.querySelectorAll('body *')) {
      if (getComputedStyle(el).position !== 'fixed' || !el.checkVisibility()) continue;
      const r = el.getBoundingClientRect();
      if (r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight) {
        hidden.push(el);
        el.dataset.djPrevVisibility = el.style.visibility;
        el.style.visibility = 'hidden';
      }
    }
    window.__djHiddenFixed = hidden;
    return hidden.length;
  })()`)) as number;
  const full = await screenshot(page, stateDir, bundleDir, id, 'full');
  await page.evaluate(`(() => {
    for (const el of window.__djHiddenFixed || []) { el.style.visibility = el.dataset.djPrevVisibility || ''; delete el.dataset.djPrevVisibility; }
  })()`);
  return { ...full, hiddenFixedElements: hiddenFixed };
}

async function probeSafeArea(page: Page) {
  return (await page.evaluate(`(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.documentElement.appendChild(d);
    const s = getComputedStyle(d);
    const r = { top: parseFloat(s.paddingTop), right: parseFloat(s.paddingRight), bottom: parseFloat(s.paddingBottom), left: parseFloat(s.paddingLeft) };
    d.remove();
    return r;
  })()`)) as { top: number; right: number; bottom: number; left: number };
}

async function collectFreshState(
  browser: Browser,
  url: string,
  origin: string,
  state: PlannedState,
  bundleDir: string,
  inject?: Injection,
): Promise<StateRecord> {
  const stateDir = ensureDir(path.join(bundleDir, 'states', state.id));
  const rel = (f: string) => path.relative(bundleDir, f);
  const record: StateRecord = {
    id: state.id,
    kind: state.kind,
    label: state.label,
    viewportId: state.viewport.id,
    viewport: {
      width: state.viewport.width,
      height: state.viewport.height,
      dpr: state.viewport.deviceScaleFactor,
      isMobile: state.viewport.isMobile,
    },
    fixture: state.fixture,
    interactiveStateId: state.interactive?.id,
    interactiveDescription: state.interactive?.description,
    ...(state.supporting ? { supporting: true } : {}),
    status: 'collected',
    files: {},
    screenshots: [],
    consoleErrors: [],
    network: { external: [], failed: [] },
  };

  const ctx = await newContext(browser, state.viewport);
  try {
    const page = await preparePage(ctx, state.fixture, inject);
    page.on('console', (msg) => {
      if (msg.type() === 'error') record.consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on('pageerror', (err) => record.consoleErrors.push(`pageerror: ${String(err.message).slice(0, 300)}`));
    const tracker = new NetworkTracker(page, origin);

    let safeAreaApplied = false;
    let safeAreaNote: string | undefined;
    if (state.viewport.safeArea) {
      try {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Emulation.setSafeAreaInsetsOverride' as any, { insets: state.viewport.safeArea } as any);
        safeAreaApplied = true;
      } catch (err) {
        safeAreaNote = `Safe-area override not supported: ${(err as Error).message}`;
      }
    }

    const navStart = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    record.settle = await waitForSettled(page, tracker);
    if (state.kind === 'baseline') {
      const remaining = SETTLE.stabilityWindowMs - (Date.now() - navStart);
      if (remaining > 0) {
        await page.waitForTimeout(remaining);
        await waitForSettled(page, tracker, true);
      }
      record.layoutShifts = (await page.evaluate('window.__djShifts')) as ShiftEntry[];
    }

    await page.evaluate('window.__djScrollThrough()');
    await waitForSettled(page, tracker, true);

    if (state.fixture === 'stress') {
      record.stressFill = await fillForStress(page, async () => {
        await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
        await waitForSettled(page, tracker);
      });
      if (record.stressFill.actions.length) {
        await page.evaluate('window.__djScrollThrough()');
        await waitForSettled(page, tracker, true);
      }
    }

    if (state.interactive) {
      record.steps = [];
      for (const step of state.interactive.steps) {
        try {
          const outcome = await runStep(page, step);
          record.steps.push({ step, ok: true, via: outcome.via, note: outcome.note });
        } catch (err) {
          const lines = (err as Error).message.split('\n').map((l) => l.trim()).filter(Boolean);
          // Keep Playwright's last call-log lines: they say why the action could not proceed.
          const detail = [lines[0], ...lines.slice(1).filter((l) => l.startsWith('-')).slice(-3)].join(' ');
          record.steps.push({ step, ok: false, error: detail });
          throw new Error(`Interactive step failed: ${JSON.stringify(step)}: ${detail}`);
        }
      }
    }

    await page.evaluate('window.scrollTo(0, 0)');
    await waitForSettled(page, null, true);

    const snap = await takeSnapshot(page, safeAreaApplied && state.viewport.safeArea ? state.viewport.safeArea : null);
    const snapFile = path.join(stateDir, 'snapshot.json');
    writeJson(snapFile, snap);
    record.files.snapshot = rel(snapFile);

    if (state.interactive?.captureScrollTo) {
      await page.evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(state.interactive.captureScrollTo)}); if (el) window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 16)); })()`,
      );
      await waitForSettled(page, null, true);
    } else if (state.interactive?.captureY) {
      await page.evaluate(`window.scrollTo(0, ${Math.max(0, state.interactive.captureY - 16)})`);
      await waitForSettled(page, null, true);
    }
    record.screenshots.push(await screenshot(page, stateDir, bundleDir, `S-${state.id}-viewport`, 'viewport'));
    await page.evaluate('window.scrollTo(0, 0)');

    const domFile = path.join(stateDir, 'dom.html');
    fs.writeFileSync(domFile, await page.content());
    record.files.dom = rel(domFile);

    record.screenshots.push(await fullPageScreenshot(page, stateDir, bundleDir, `S-${state.id}-full`));
    // Content hidden under a fixed or sticky layer only shows at the scroll position where it is
    // covered (full-page captures hide fixed elements): capture that screen.
    const hidden = snap.occlusion?.records.find((r) => r.by.some((b) => b.position === 'fixed' || b.position === 'sticky'));
    const hiddenEl = hidden ? snap.elements.find((e) => e.id === hidden.id) : undefined;
    if (hidden && hiddenEl) {
      const maxY = Math.max(0, snap.doc.scrollHeight - state.viewport.height);
      const y = hidden.scrollY >= 0 ? hidden.scrollY : Math.round(hiddenEl.rect.y + hiddenEl.rect.h / 2 - state.viewport.height / 2);
      await page.evaluate(`window.scrollTo({ top: ${Math.min(maxY, Math.max(0, y))}, left: 0, behavior: 'instant' })`);
      await waitForSettled(page, null, true);
      record.screenshots.push(await screenshot(page, stateDir, bundleDir, `S-${state.id}-scrolled`, 'scrolled'));
      await page.evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`);
    }
    try {
      const aria = await page.locator('body').ariaSnapshot({ timeout: 10_000 });
      const ariaFile = path.join(stateDir, 'aria.yml');
      fs.writeFileSync(ariaFile, aria);
      record.files.aria = rel(ariaFile);
    } catch {
      // Accessibility tree is retained for inspection only; its absence does not affect Layout checks.
    }

    if (state.viewport.safeArea) {
      const resolved = safeAreaApplied ? await probeSafeArea(page) : null;
      const matches =
        !!resolved &&
        resolved.top === state.viewport.safeArea.top &&
        resolved.bottom === state.viewport.safeArea.bottom;
      record.safeArea = {
        requested: state.viewport.safeArea,
        applied: safeAreaApplied && matches,
        resolved,
        note: safeAreaNote ?? (safeAreaApplied && !matches ? 'Override accepted but env(safe-area-inset-*) did not resolve to the requested values.' : undefined),
      };
    }

    record.network = { external: [...tracker.external], failed: tracker.failed };
  } catch (err) {
    record.status = 'error';
    record.error = (err as Error).message.split('\n')[0];
  } finally {
    await ctx.close();
  }
  return record;
}

async function collectSweep(browser: Browser, url: string, origin: string, bundleDir: string, fixture: FixtureName | null, inject?: Injection): Promise<StateRecord[]> {
  const vp: ViewportSpec = { ...VIEWPORTS.desktop, id: 'sweep', label: 'Responsive sweep' };
  const ctx = await newContext(browser, vp, SWEEP_WIDTHS[0], SWEEP_HEIGHT);
  const records: StateRecord[] = [];
  try {
    const page = await preparePage(ctx, fixture, inject);
    const tracker = new NetworkTracker(page, origin);
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await waitForSettled(page, tracker);
    await page.evaluate('window.__djScrollThrough()');
    for (const width of SWEEP_WIDTHS) {
      const id = `sweep-${width}`;
      const stateDir = ensureDir(path.join(bundleDir, 'states', id));
      const record: StateRecord = {
        id,
        kind: 'sweep',
        label: `Sweep ${width}px`,
        viewportId: 'sweep',
        viewport: { width, height: SWEEP_HEIGHT, dpr: 1, isMobile: false },
        fixture,
        status: 'collected',
        files: {},
        screenshots: [],
        consoleErrors: [],
        network: { external: [], failed: [] },
      };
      try {
        await page.setViewportSize({ width, height: SWEEP_HEIGHT });
        await page.evaluate('window.scrollTo(0, 0)');
        record.settle = await waitForSettled(page, tracker, true);
        const snap = await takeSnapshot(page);
        const snapFile = path.join(stateDir, 'snapshot.json');
        writeJson(snapFile, snap);
        record.files.snapshot = path.relative(bundleDir, snapFile);
        record.screenshots.push(await screenshot(page, stateDir, bundleDir, `S-${id}`, 'viewport'));
        // Failures at a width are often below the first screen.
        record.screenshots.push(await fullPageScreenshot(page, stateDir, bundleDir, `S-${id}-full`));
        await page.evaluate('window.scrollTo(0, 0)');
      } catch (err) {
        record.status = 'error';
        record.error = (err as Error).message.split('\n')[0];
      }
      records.push(record);
    }
  } finally {
    await ctx.close();
  }
  return records;
}

export interface DiscoveryLog {
  viewport: 'desktop' | 'tablet' | 'mobile';
  chosen: { label: string; role: string; selector: string; description: string; score: number } | null;
  // Further significant changes kept as supporting states (checked, no screenshot for the judge).
  alsoKept?: { label: string; role: string; selector: string; description: string; score: number }[];
  attempts: Attempt[];
  error?: string;
}

// Finds the most significant interactive states at each viewport by clicking every distinct
// control. The largest change at desktop and mobile is the state the judge sees; the next ones,
// and all of tablet, are supporting states that are checked but not shown.
async function discoverInteractiveStates(
  browser: Browser,
  url: string,
  origin: string,
  fixture: FixtureName | null,
  inject?: Injection,
): Promise<{ planned: PlannedState[]; logs: DiscoveryLog[] }> {
  const results = await Promise.all(
    (['desktop', 'tablet', 'mobile'] as const).map(async (vpId) => {
      const vp = VIEWPORTS[vpId];
      const ctx = await newContext(browser, vp);
      const log: DiscoveryLog = { viewport: vpId, chosen: null, attempts: [] };
      try {
        const page = await preparePage(ctx, fixture, inject);
        ctx.on('page', (p) => {
          if (p !== page) void p.close();
        });
        const tracker = new NetworkTracker(page, origin);
        const reset = async () => {
          await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
          await waitForSettled(page, tracker);
        };
        await reset();
        const { picks, attempts } = await discoverOnPage(page, reset);
        log.attempts = attempts;
        const summary = (p: (typeof picks)[number]) => ({ label: p.candidate.label, role: p.candidate.role, selector: p.candidate.selector, description: p.description, score: p.change.score });
        if (!picks.length) return { log, planned: [] as PlannedState[] };
        log.chosen = summary(picks[0]);
        log.alsoKept = picks.slice(1).map(summary);
        const planned: PlannedState[] = picks.map((p, i) => ({
          id: i === 0 ? `interactive-auto-${vpId}` : `interactive-auto-${vpId}-${i + 1}`,
          kind: 'interactive',
          label: i === 0 ? `Interactive (${vpId})` : `Interactive ${i + 1} (${vpId})`,
          viewport: vp,
          fixture,
          interactive: {
            id: 'auto',
            description: p.description,
            steps: [{ action: 'click', selector: p.candidate.selector }],
            captureY: p.change.focusY,
          },
          ...(i > 0 || vpId === 'tablet' ? { supporting: true } : {}),
        }));
        return { log, planned };
      } catch (err) {
        log.error = (err as Error).message.split('\n')[0];
        return { log, planned: [] as PlannedState[] };
      } finally {
        await ctx.close();
      }
    }),
  );
  return { planned: results.flatMap((r) => r.planned), logs: results.map((r) => r.log) };
}

export interface CollectOptions {
  concurrency?: number;
  // Planted-defect testing: the injection applied to every page, the evidence folder name used
  // instead of the case ID (so the case's own latest evidence is untouched), and a bundle whose
  // interactive states are replayed instead of discovered, so results line up with it.
  inject?: Injection;
  evidenceId?: string;
  interactiveFrom?: Bundle;
}

function replayInteractive(from: Bundle): PlannedState[] {
  return from.states
    .filter((s) => s.kind === 'interactive' && s.status === 'collected' && s.steps?.length)
    .map((s) => {
      const shot = s.screenshots.find((x) => x.kind === 'viewport');
      return {
        id: s.id,
        kind: 'interactive' as const,
        label: s.label,
        viewport: VIEWPORTS[s.viewportId as 'desktop' | 'tablet' | 'mobile'],
        fixture: s.fixture,
        interactive: {
          id: s.interactiveStateId ?? 'auto',
          description: s.interactiveDescription ?? '',
          steps: s.steps!.map((st) => st.step as Step),
          captureY: shot && shot.scrollY > 0 ? shot.scrollY + 16 : null,
        },
        ...(s.supporting ? { supporting: true } : {}),
      };
    });
}

export async function collectCase(manifest: CaseManifest, opts: CollectOptions = {}): Promise<Bundle> {
  const dir = caseDir(manifest.id);
  let server: StaticServer | null = null;
  let baseUrl: string;
  let inputsHash: string;
  // Display-only fields are left out, so renaming a case does not change its interface ID.
  const { title: _title, summary: _summary, ...hashedManifest } = manifest;
  if (manifest.source.type === 'static') {
    const siteDir = path.join(dir, manifest.source.dir);
    server = await serveStatic(siteDir);
    baseUrl = server.url;
    inputsHash = sha256(hashDir(siteDir) + JSON.stringify(hashedManifest) + COLLECTOR_VERSION);
  } else {
    baseUrl = manifest.source.url;
    inputsHash = sha256(manifest.source.url + JSON.stringify(hashedManifest) + COLLECTOR_VERSION);
  }
  const url = new URL(manifest.entry ?? '/', baseUrl).toString();
  const origin = new URL(url).origin;

  if (opts.inject) inputsHash = sha256(inputsHash + JSON.stringify(opts.inject));
  const evidenceId = opts.evidenceId ?? manifest.id;
  const bundleId = `${timestampId()}-${inputsHash.slice(0, 8)}`;
  const bundleDir = ensureDir(path.join(EVIDENCE_DIR, evidenceId, bundleId));
  const { planned, coverage } = planStates(manifest);

  const browser = await chromium.launch();
  try {
    let discovery: DiscoveryLog[] | null = null;
    if (opts.interactiveFrom) {
      planned.push(...replayInteractive(opts.interactiveFrom));
    } else if (!manifest.interactiveStates?.length) {
      const found = await discoverInteractiveStates(browser, url, origin, planned[0].fixture, opts.inject);
      discovery = found.logs;
      planned.push(...found.planned);
      for (const l of found.logs) {
        const tried = l.attempts.length;
        log(`  ${l.chosen ? '✓' : '·'} discovery ${l.viewport}: ${l.chosen ? l.chosen.description : 'no significant change'} (${tried} controls tried)`);
        if (!l.chosen) {
          coverage.push({
            stateId: `interactive-auto-${l.viewport}`,
            label: `Interactive state (${l.viewport})`,
            status: l.error ? 'error' : 'unavailable',
            reason: l.error ?? `None of the ${tried} distinct controls tried produced a significant layout change.`,
          });
        }
      }
    }
    log(`[collect] ${manifest.id}: ${planned.length} fresh-load states + ${SWEEP_WIDTHS.length}-width sweep`);
    const fresh = await mapLimit(planned, opts.concurrency ?? 3, async (state) => {
      const rec = await collectFreshState(browser, url, origin, state, bundleDir, opts.inject);
      log(`  ${rec.status === 'collected' ? '✓' : '✗'} ${state.id}${rec.error ? ` — ${rec.error}` : ''}`);
      return rec;
    });
    const baseFixture = planned[0].fixture;
    const sweep = await collectSweep(browser, url, origin, bundleDir, baseFixture, opts.inject);
    log(`  ✓ sweep (${sweep.filter((s) => s.status === 'collected').length}/${sweep.length} widths)`);

    for (const rec of fresh) {
      coverage.push({
        stateId: rec.id,
        label: rec.label,
        status: rec.status === 'collected' ? 'collected' : 'error',
        reason: rec.error,
      });
    }
    const sweepErrors = sweep.filter((s) => s.status !== 'collected');
    coverage.push({
      stateId: 'sweep',
      label: `Responsive Sweep (${SWEEP_WIDTHS.length} widths, ${SWEEP_WIDTHS[0]}–${SWEEP_WIDTHS[SWEEP_WIDTHS.length - 1]} px)`,
      status: sweepErrors.length === sweep.length ? 'error' : 'collected',
      reason: sweepErrors.length ? `${sweepErrors.length} widths failed to collect.` : undefined,
    });

    const bundle: Bundle = {
      schemaVersion: 1,
      bundleId,
      caseId: evidenceId,
      interfaceId: `iface-${sha256(manifest.id + inputsHash).slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      collectorVersion: COLLECTOR_VERSION,
      browser: { name: 'chromium', version: browser.version() },
      request: manifest.request,
      inputsHash,
      config: {
        viewports: VIEWPORTS,
        sweepWidths: SWEEP_WIDTHS,
        sweepHeight: SWEEP_HEIGHT,
        settle: SETTLE,
        fixedTime: FIXED_TIME,
      },
      fixtures: manifest.fixtures ?? null,
      coverage,
      states: [...fresh, ...sweep],
      sweep: { widths: SWEEP_WIDTHS, stateIds: sweep.map((s) => s.id) },
      interactiveDiscovery: discovery,
    };
    writeJson(path.join(bundleDir, 'bundle.json'), bundle);
    writeJson(path.join(EVIDENCE_DIR, evidenceId, 'latest.json'), { bundleId });
    return bundle;
  } finally {
    await browser.close();
    if (server) await server.close();
  }
}
