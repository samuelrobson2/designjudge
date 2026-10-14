import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CASES_DIR = path.join(ROOT, 'cases');
export const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
// DJ_EVIDENCE_DIR collects into (and reads from) another folder, so trial collections leave the
// stored evidence untouched.
export const EVIDENCE_DIR_OVERRIDDEN = !!process.env.DJ_EVIDENCE_DIR;
export const EVIDENCE_DIR = process.env.DJ_EVIDENCE_DIR ? path.resolve(process.env.DJ_EVIDENCE_DIR) : path.join(ARTIFACTS_DIR, 'evidence');
export const RUNS_DIR = path.join(ARTIFACTS_DIR, 'runs');
export const BENCHMARK_DIR = path.join(ROOT, 'benchmark');
export const LAYOUT_RUBRIC_PATH = path.join(ROOT, 'layout_rubric.md');
export const TYPOGRAPHY_RUBRIC_PATH = path.join(ROOT, 'typography_rubric.md');
export const TASK_FIT_RUBRIC_PATH = path.join(ROOT, 'task_fit_rubric.md');
export const CONTENT_QUALITY_RUBRIC_PATH = path.join(ROOT, 'content_quality_rubric.md');
export const VISUAL_SYSTEM_RUBRIC_PATH = path.join(ROOT, 'visual_system_rubric.md');
export const FUNCTIONALITY_RUBRIC_PATH = path.join(ROOT, 'functionality_rubric.md');
export const PRICING_PATH = path.join(ROOT, 'config', 'pricing.json');

export const COLLECTOR_VERSION = 'collector-v2';
export const DIAGNOSTICS_VERSION = 'diagnostics-v6';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewportSpec {
  id: 'desktop' | 'tablet' | 'mobile' | 'sweep';
  label: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent?: string;
  safeArea?: Insets;
}

// Desktop: most common desktop resolution worldwide (StatCounter, Aug 2026).
// Tablet: most common tablet resolution worldwide, portrait (StatCounter, Jul 2026).
// Mobile: narrowest common mobile viewport (StatCounter, Jul 2026).
export const VIEWPORTS: Record<'desktop' | 'tablet' | 'mobile', ViewportSpec> = {
  desktop: {
    id: 'desktop',
    label: 'Desktop 1920×1080',
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  tablet: {
    id: 'tablet',
    label: 'Tablet 768×1024',
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  },
  // A 360 px touch viewport. Chromium's phone mode (isMobile) widens the layout viewport to fit
  // overflowing content, which resizes fixed-position elements beyond the screen; without it the
  // layout viewport stays 360 px and overflow shows as content cut off at the screen edge.
  mobile: {
    id: 'mobile',
    label: 'Mobile 360×800',
    width: 360,
    height: 800,
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; SM-A566B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
    // Android edge-to-edge portrait: status bar + gesture bar.
    safeArea: { top: 24, right: 0, bottom: 24, left: 0 },
  },
};

// 80 px steps from the WCAG 2.2 reflow width to the desktop baseline, both sides of the
// default Tailwind breakpoints, and common phone widths.
export const SWEEP_WIDTHS: number[] = (() => {
  const widths = new Set<number>();
  for (let w = 320; w <= 1920; w += 80) widths.add(w);
  for (const bp of [640, 768, 1024, 1280, 1536]) {
    widths.add(bp - 1);
    widths.add(bp);
  }
  widths.add(360);
  widths.add(414);
  return [...widths].sort((a, b) => a - b);
})();
export const SWEEP_HEIGHT = 900;

// Every page's clock is paused (collect.ts preparePage): its timers, animation frames and Date move
// only when a wait gives it page time, so what is captured does not depend on machine speed. Each
// wait gives this much page time, then holds until the page is quiet (settle.ts).
export const PAGE_TIME = {
  // After a navigation: also the window in which layout shifts are recorded (the longest window
  // browsers use to group shifts), so content that arrives late counts.
  loadMs: 5_000,
  // After a click, key press, fill or scroll-through: also the window in which the Functionality
  // probe watches what an action did.
  actionMs: 1_500,
  // After focus, hover, a forced pseudo-class, a scroll to a capture position or a resize.
  briefMs: 500,
};

export const QUIESCE = {
  // Wall-clock cap on one wait, only to abort a page that never goes quiet.
  capMs: 30_000,
  // A request still open after this long (a stream or long poll) is not waited for.
  longRequestMs: 10_000,
  // Every Playwright action's own cap; actions are only tried on a quiet page.
  actionTimeoutMs: 10_000,
};

// Recorded with the evidence; a bundle without `pageTime` was collected with real-time waits.
export const SETTLE = { pageTime: PAGE_TIME, capMs: QUIESCE.capMs };

// Fixed clock for deterministic rendering of dates.
export const FIXED_TIME = '2026-09-14T09:30:00+01:00';

export const FIXTURES = ['empty', 'typical', 'dense', 'expanded', 'stress'] as const;
export type FixtureName = (typeof FIXTURES)[number];

export const TOLERANCE_PX = 2;
export const OVERLAP_MIN_PROPORTION = 0.05;

// Component types (data-component-type) treated as visual components by Collapsed Component
// Dimensions. Minimum sizes apply only when configured here; none are by default.
export const VISUAL_COMPONENT_TYPES = ['chart', 'map', 'image', 'avatar', 'media', 'visualization', 'canvas', 'video'];
export const COMPONENT_MIN_DIMENSIONS: Record<string, { width: number; height: number }> = {};

export const ELEMENT_CAP = 8000;
