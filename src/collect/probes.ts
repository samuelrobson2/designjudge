// Probes: evidence that needs a live page beyond the passive snapshot. For Visual System, each
// judged state (the three baselines and the interactive states the judge sees) is loaded again
// and its rendered styles, the colour behind its text and field boundaries, an axe-core run and,
// at desktop, a keyboard traversal are captured, with a fresh snapshot of the same page so every
// record is keyed to its elements. The controls sheets come from visual.ts and the Functionality
// probe, which runs only when asked for, from functional.ts. Everything is written under the bundle's probes/ and visual/ folders,
// so a probe can be added to evidence collected earlier without collecting it again.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { ELEMENT_CAP, VIEWPORTS, type ViewportSpec } from '../config.ts';
import { caseDir, loadCase } from '../cases.ts';
import { bundleDir as bundlePath, loadBundle } from '../store.ts';
import type { Bundle, Snapshot, StateRecord, Step } from '../types.ts';
import { ensureDir, log, mapLimit, writeJson } from '../util.ts';
import { newContext, openCaseTarget, preparePage, type Injection } from './collect.ts';
import { collectFunctional } from './functional.ts';
import { collectHover } from './hover.ts';
import { visualScript } from './pageScripts.ts';
import { FUNCTIONAL_DIR, hasFunctionalProbes, HOVER_FILE, PROBES_DIR, PROBES_VERSION, VISUAL_PROBE_DIR, visualProbeStates } from './probeStore.ts';
import type { AxeResult, FocusStop, FocusTraversal, MotionRecord, VisualProbeState } from './probeTypes.ts';
import { quiesce } from './settle.ts';
import { runStep } from './steps.ts';
import { changedPixels, collectVisual, STYLE_FN, styleChanges } from './visual.ts';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
// Covered by Required Contrast and Minimum Pointer Target Size.
const AXE_DISABLED = ['color-contrast', 'target-size'];
const MAX_FOCUS_STOPS = 60;
// Wall clock, abort-only: a scan that has not finished by then is reported as failed.
const AXE_LIMIT_MS = 120_000;
const FOCUS_PAD = 6;
// Changed pixels at or below this count as no visible change (anti-aliasing).
export const FOCUS_TOLERANCE_PX = 4;

let axeSource: string | null = null;
function axeScript(): string {
  if (!axeSource) axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  return axeSource;
}

async function settleFresh(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  await quiesce(page, 'load');
  await page.evaluate('window.__djScrollThrough()');
  await quiesce(page, 'action');
  await page.evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`);
  await quiesce(page, 'brief');
}

async function runAxe(page: Page): Promise<AxeResult> {
  await page.evaluate(axeScript());
  return (await page.evaluate(`(async () => {
    // axe waits on timers between rules, and the page clock is paused.
    const builtins = (window.__pwClock && window.__pwClock.builtins) || {};
    const names = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'].filter((n) => builtins[n]);
    const paused = Object.fromEntries(names.map((n) => [n, window[n]]));
    for (const n of names) window[n] = builtins[n].bind(window);
    let res;
    try {
      res = await axe.run(document, {
        runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} },
        rules: Object.fromEntries(${JSON.stringify(AXE_DISABLED)}.map((r) => [r, { enabled: false }])),
        resultTypes: ['violations', 'incomplete'],
      });
    } finally {
      for (const n of names) window[n] = paused[n];
    }
    const node = (n) => {
      const t = n.target[n.target.length - 1];
      let el = null;
      try { el = typeof t === 'string' ? document.querySelector(t) : null; } catch {}
      return { id: el ? window.__djId(el) : null, target: String(t), html: String(n.html).slice(0, 160), summary: String(n.failureSummary || '').replace(/\\s+/g, ' ').slice(0, 240) };
    };
    const rule = (r) => ({ rule: r.id, impact: r.impact || null, help: r.help, tags: r.tags.filter((x) => /^wcag/.test(x)), nodes: r.nodes.slice(0, 25).map(node) });
    // Experimental rules are off in axe's own defaults.
    const stable = (r) => !r.tags.includes('experimental');
    return { version: axe.version, rules: ${JSON.stringify(AXE_TAGS)}, violations: res.violations.filter(stable).map(rule), incomplete: res.incomplete.filter(stable).map(rule) };
  })()`)) as AxeResult;
}

const STOP_INFO = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el.hasAttribute('data-dj-sentinel')) return null;
  const path = (e) => {
    const parts = [];
    for (let cur = e; cur && cur !== document.body && cur.parentElement; cur = cur.parentElement) {
      parts.unshift(cur.tagName.toLowerCase() + ':nth-child(' + ([...cur.parentElement.children].indexOf(cur) + 1) + ')');
    }
    return 'body > ' + parts.join(' > ');
  };
  // A visually hidden control (a custom checkbox's input) shows its focus on its label or parent.
  let visual = el;
  const r0 = el.getBoundingClientRect();
  const label = (el.labels && el.labels[0]) || el.closest('label');
  if (r0.width <= 2 || r0.height <= 2 || (label && parseFloat(getComputedStyle(el).opacity) < 0.05)) visual = label || el.parentElement || el;
  let fixed = false;
  for (let a = el; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') fixed = true;
  const r = visual.getBoundingClientRect();
  const d = window.__djDescribe(el);
  // Something else painted over the focused control's centre hides its focus (a modal's backdrop).
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const top = cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight ? document.elementFromPoint(cx, cy) : null;
  const covered = !!top && top !== visual && !visual.contains(top) && !top.contains(visual) && top !== el && !el.contains(top) && !(label && label.contains(top));
  return {
    id: window.__djId(el), path: path(el), visualPath: path(visual), selector: d.selector, tag: d.tag, role: el.getAttribute('role'),
    name: (el.getAttribute('aria-label') || el.innerText || (el.labels && el.labels[0] && el.labels[0].innerText) || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 60) || null,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height }, scrollY: window.scrollY, fixed,
    coveredBy: covered ? window.__djDescribe(top).selector : null,
    hiddenInput: visual !== el,
  };
})()`;

// Tab through the page in native order; at each stop compare the focused and unfocused look.
async function focusTraversal(page: Page, vp: ViewportSpec): Promise<FocusTraversal> {
  await page.mouse.move(vp.width - 2, vp.height - 2);
  await page.evaluate(`(() => {
    const s = document.createElement('span');
    s.setAttribute('tabindex', '-1');
    s.setAttribute('data-dj-sentinel', '');
    s.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden';
    document.body.prepend(s);
    s.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  })()`);
  const stops: FocusStop[] = [];
  let ended: FocusTraversal['ended'] = 'limit';
  const seen = new Set<string>();
  for (let n = 1; n <= MAX_FOCUS_STOPS; n++) {
    await page.keyboard.press('Tab');
    await quiesce(page, 'brief');
    const info = (await page.evaluate(STOP_INFO)) as {
      id: number; path: string; visualPath: string; selector: string; tag: string; role: string | null; name: string | null;
      rect: { x: number; y: number; w: number; h: number }; scrollY: number; fixed: boolean; coveredBy: string | null; hiddenInput: boolean;
    } | null;
    if (!info) {
      ended = 'body';
      break;
    }
    if (seen.has(info.path)) {
      ended = 'cycle';
      break;
    }
    seen.add(info.path);
    const x = Math.max(0, Math.floor(info.rect.x - FOCUS_PAD));
    const y = Math.max(0, Math.floor(info.rect.y - FOCUS_PAD));
    const clip = { x, y, width: Math.min(vp.width - x, Math.ceil(info.rect.w + 2 * FOCUS_PAD)), height: Math.min(vp.height - y, Math.ceil(info.rect.h + 2 * FOCUS_PAD)) };
    const style = (p: string) => page.evaluate(`(${STYLE_FN})(${JSON.stringify(p)})`) as Promise<Record<string, string> | null>;
    let changed: number | null = null;
    let changes: string[] = [];
    if (clip.width >= 2 && clip.height >= 2) {
      const focusedStyle = await style(info.visualPath);
      const elStyle = info.visualPath === info.path ? focusedStyle : await style(info.path);
      const a = await page.screenshot({ clip, animations: 'disabled', caret: 'hide', scale: 'css' });
      await page.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur()');
      await quiesce(page, 'brief');
      const b = await page.screenshot({ clip, animations: 'disabled', caret: 'hide', scale: 'css' });
      changes = [...styleChanges(await style(info.visualPath), focusedStyle), ...(info.visualPath === info.path ? [] : styleChanges(await style(info.path), elStyle))];
      changed = await changedPixels(a, b);
      // Back on the control, so the next Tab continues from it.
      await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(info.path)}); if (el) el.focus({ preventScroll: true }); })()`);
    }
    const visibleChange = changes.some((c) => /^(outline|shadow|border|bottom border|background|text|underline):/.test(c) && !/^outline: .* → none$/.test(c));
    stops.push({
      n,
      id: info.id,
      selector: info.selector,
      tag: info.tag,
      role: info.role,
      name: info.name,
      rect: { x: Math.round(info.rect.x), y: Math.round(info.fixed ? info.rect.y : info.rect.y + info.scrollY), w: Math.round(info.rect.w), h: Math.round(info.rect.h) },
      fixed: info.fixed,
      changes,
      changedPixels: changed,
      cropPixels: clip.width * clip.height,
      visible: !info.coveredBy && ((changed ?? 0) > FOCUS_TOLERANCE_PX || (changed === null && visibleChange)),
      ...(info.coveredBy ? { coveredBy: info.coveredBy } : {}),
      ...(info.hiddenInput ? { hiddenInput: true } : {}),
    });
  }
  await page.evaluate(`(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); document.querySelector('[data-dj-sentinel]')?.remove(); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); })()`);
  return { stops, ended, tolerancePx: FOCUS_TOLERANCE_PX };
}

async function reducedMotionAnimations(browser: Browser, url: string, origin: string, vp: ViewportSpec, fixture: StateRecord['fixture'], inject?: Injection) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    userAgent: vp.userAgent,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  try {
    const page = await preparePage(ctx, fixture, inject);
    await page.addInitScript({ content: await visualScript() });
    await settleFresh(page, url);
    return (await page.evaluate('window.__djAnimations()')) as MotionRecord['animations'];
  } finally {
    await ctx.close();
  }
}

// Everything the Visual System probe records about the page as it is now. The page needs the
// init, snapshot and visual page scripts.
export async function captureOnPage(page: Page, vp: ViewportSpec, opts: { motion: boolean; focus: boolean }): Promise<Pick<VisualProbeState, 'snapshot' | 'styles' | 'contrast' | 'axe' | 'focus' | 'motion'>> {
  const snapshot = (await page.evaluate(`window.__djSnapshot(${ELEMENT_CAP})`)) as Snapshot;
  const visual = (await page.evaluate('window.__djVisual()')) as { styles: VisualProbeState['styles']; contrast: VisualProbeState['contrast'] };
  const motion = opts.motion ? { animations: (await page.evaluate('window.__djAnimations()')) as MotionRecord['animations'], reduced: null } : null;
  let axe: AxeResult;
  const axeStart = performance.now();
  try {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('the accessibility scan did not finish')), AXE_LIMIT_MS)));
    axe = await Promise.race([runAxe(page), limit]).finally(() => clearTimeout(timer));
  } catch (err) {
    axe = { version: '', rules: AXE_TAGS, violations: [], incomplete: [], error: firstLine(err) };
  }
  axe.ms = Math.round(performance.now() - axeStart);
  const focus = opts.focus ? await focusTraversal(page, vp) : null;
  return { snapshot, styles: visual.styles, contrast: visual.contrast, axe, focus, motion };
}

async function probeState(browser: Browser, url: string, origin: string, state: StateRecord, bundleDir: string, inject?: Injection): Promise<VisualProbeState> {
  const vp = VIEWPORTS[state.viewportId as 'desktop' | 'tablet' | 'mobile'];
  const out: VisualProbeState = {
    version: 1,
    stateId: state.id,
    viewport: { width: vp.width, height: vp.height },
    snapshot: null as unknown as Snapshot,
    styles: [],
    contrast: [],
    axe: null,
    focus: null,
    motion: null,
  };
  const ctx = await newContext(browser, vp);
  try {
    const page = await preparePage(ctx, state.fixture, inject);
    await page.addInitScript({ content: await visualScript() });
    ctx.on('page', (p) => {
      if (p !== page) void p.close();
    });
    page.on('dialog', (d) => void d.dismiss().catch(() => {}));
    await settleFresh(page, url);
    if (state.kind === 'interactive') {
      const steps = (state.steps ?? []).map((s) => s.step as Step);
      out.replayed = { steps: steps.length, ok: true };
      try {
        for (const step of steps) await runStep(page, step);
      } catch (err) {
        out.replayed = { steps: steps.length, ok: false, error: firstLine(err) };
      }
      await page.evaluate('window.scrollTo(0, 0)');
      await quiesce(page, 'brief');
    }
    Object.assign(out, await captureOnPage(page, vp, { motion: state.kind === 'baseline' && state.viewportId === 'desktop', focus: state.viewportId === 'desktop' }), { cues: true });
  } catch (err) {
    out.error = firstLine(err);
  } finally {
    await ctx.close();
  }
  if (out.motion) {
    try {
      out.motion.reduced = await reducedMotionAnimations(browser, url, origin, vp, state.fixture, inject);
    } catch (err) {
      log(`  ! reduced-motion probe failed: ${firstLine(err)}`);
    }
  }
  writeJson(path.join(bundleDir, VISUAL_PROBE_DIR, `${state.id}.json`), out);
  return out;
}

function firstLine(err: unknown): string {
  return String((err as Error).message ?? err).split('\n')[0].slice(0, 200);
}

export interface ProbeOptions {
  // The Functionality probe (functional.ts): only Functionality uses it, so it runs only when asked
  // for. Without it, existing Functionality results in the bundle are kept.
  functional?: boolean;
}

export interface ProbeTimings {
  visualMs: number;
  axeMs: number[];
  controlsSheetsMs: number;
  functionalMs: number | null;
  hoverMs?: number;
}

// Every probe for one bundle; `inject` repeats a planted mutation.
export async function collectProbes(browser: Browser, url: string, origin: string, bundle: Bundle, bundleDir: string, inject?: Injection, opts: ProbeOptions = {}): Promise<ProbeTimings> {
  fs.rmSync(path.join(bundleDir, VISUAL_PROBE_DIR), { recursive: true, force: true });
  fs.rmSync(path.join(bundleDir, PROBES_DIR, 'probes.json'), { force: true });
  fs.rmSync(path.join(bundleDir, HOVER_FILE), { force: true });
  if (opts.functional) fs.rmSync(path.join(bundleDir, FUNCTIONAL_DIR), { recursive: true, force: true });
  ensureDir(path.join(bundleDir, PROBES_DIR));
  const fixture = bundle.states.find((s) => s.id === 'desktop')?.fixture ?? null;
  const states = visualProbeStates(bundle);
  let t = performance.now();
  const visual = await mapLimit(states, 3, (s) => probeState(browser, url, origin, s, bundleDir, inject));
  const visualMs = Math.round(performance.now() - t);
  for (const v of visual) if (v.error) log(`  ! visual probe ${v.stateId}: ${v.error}`);
  t = performance.now();
  if (bundle.states.some((s) => s.id === 'desktop' && s.status === 'collected')) {
    const hover = await collectHover(browser, url, fixture, bundleDir, inject);
    if (hover.error) log(`  ! hover probe: ${hover.error}`);
  }
  const hoverMs = Math.round(performance.now() - t);
  let functionalMs: number | null = null;
  if (opts.functional) {
    t = performance.now();
    const functional = await Promise.all(
      (['desktop', 'mobile'] as const).map((vp) =>
        collectFunctional(browser, url, origin, vp, fixture, bundle.states.filter((s) => s.kind === 'interactive' && !s.supporting && s.viewportId === vp && s.status === 'collected'), bundleDir, inject),
      ),
    );
    functionalMs = Math.round(performance.now() - t);
    for (const f of functional) if (f.error) log(`  ! functional probe ${f.viewport}: ${f.error}`);
  }
  t = performance.now();
  await collectVisual(browser, url, origin, bundleDir, fixture, inject);
  const timings: ProbeTimings = { visualMs, axeMs: visual.map((v) => v.axe?.ms ?? 0), controlsSheetsMs: Math.round(performance.now() - t), functionalMs, hoverMs };
  writeJson(path.join(bundleDir, PROBES_DIR, 'probes.json'), {
    version: PROBES_VERSION,
    createdAt: new Date().toISOString(),
    states: states.map((s) => s.id),
    functional: hasFunctionalProbes(bundleDir) ? ['desktop', 'mobile'] : [],
    timings,
  });
  return timings;
}

export function describeTimings(t: ProbeTimings): string {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const axe = t.axeMs.reduce((a, b) => a + b, 0);
  return `visual system ${s(t.visualMs)} over ${t.axeMs.length} states (axe ${s(axe)} in total, at most ${s(Math.max(0, ...t.axeMs))} per state), controls sheets ${s(t.controlsSheetsMs)}, hover ${s(t.hoverMs ?? 0)}, functionality ${t.functionalMs === null ? 'not run' : s(t.functionalMs)}`;
}

function newestFileMs(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name !== '.DS_Store') newest = Math.max(newest, fs.statSync(path.join(entry.parentPath, entry.name)).mtimeMs);
  }
  return newest;
}

// Adds the probes to a case's latest evidence, which must have been collected from the case's
// current files. Nothing already in the bundle is changed.
export async function probeCase(caseId: string, opts: ProbeOptions = {}): Promise<void> {
  const bundle = loadBundle(caseId);
  const manifest = loadCase(caseId);
  const target = await openCaseTarget(manifest);
  try {
    // As in visual.ts: evidence collected before display-only fields left the hash is checked by file times.
    const unchanged = target.inputsHash === bundle.inputsHash || (manifest.source.type === 'static' && newestFileMs(path.join(caseDir(caseId), manifest.source.dir)) < Date.parse(bundle.createdAt));
    if (!unchanged) throw new Error(`${caseId}: the interface has changed since its latest evidence was collected. Run: npm run collect -- ${caseId}`);
    const browser = await chromium.launch();
    try {
      const timings = await collectProbes(browser, target.url, target.origin, bundle, bundlePath(caseId, bundle.bundleId), undefined, opts);
      log(`  ✓ ${caseId}/${bundle.bundleId}: probes added (${describeTimings(timings)})`);
    } finally {
      await browser.close();
    }
  } finally {
    await target.close();
  }
}
