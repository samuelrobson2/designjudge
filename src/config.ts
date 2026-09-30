import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CASES_DIR = path.join(ROOT, 'cases');
export const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
export const EVIDENCE_DIR = path.join(ARTIFACTS_DIR, 'evidence');
export const RUNS_DIR = path.join(ARTIFACTS_DIR, 'runs');
export const BENCHMARK_DIR = path.join(ROOT, 'benchmark');
export const LAYOUT_RUBRIC_PATH = path.join(ROOT, 'layout_rubric.md');
export const PRICING_PATH = path.join(ROOT, 'config', 'pricing.json');

export const COLLECTOR_VERSION = 'collector-v2';
export const DIAGNOSTICS_VERSION = 'diagnostics-v2';

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

export const SETTLE = {
  networkQuietMs: 500,
  layoutQuietMs: 500,
  maxMs: 15_000,
  pollMs: 100,
  // Used after resizes and interaction steps, where a full reload is not involved.
  liteLayoutQuietMs: 300,
  liteMaxMs: 4_000,
  // Layout shifts are recorded for at least this long after navigation (the longest window
  // browsers use to group shifts), so content that arrives after the page first goes quiet counts.
  stabilityWindowMs: 5_000,
};

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
