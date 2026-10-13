import type { FixtureName, Insets } from './config.ts';
import type { StressFill } from './collect/stress.ts';

// ---------- Case manifest ----------

export type Step =
  | { action: 'click'; selector: string }
  | { action: 'fill'; selector: string; value: string }
  | { action: 'select'; selector: string; value: string }
  | { action: 'check'; selector: string }
  | { action: 'uncheck'; selector: string }
  | { action: 'press'; key: string; selector?: string }
  | { action: 'hover'; selector: string }
  | { action: 'focus'; selector: string }
  | { action: 'scrollTo'; selector: string }
  | { action: 'wait'; ms: number }
  | { action: 'waitFor'; selector: string };

export interface InteractiveStateSpec {
  id: string;
  description: string;
  viewports: ('desktop' | 'mobile')[];
  steps: Step[];
  stepsByViewport?: Partial<Record<'desktop' | 'mobile', Step[]>>;
  capture?: { scrollTo?: string };
}

export interface CaseManifest {
  id: string;
  title: string;
  summary?: string;
  request: string;
  source: { type: 'static'; dir: string } | { type: 'url'; url: string };
  entry?: string;
  fixtures?: { supported: FixtureName[] };
  interactiveStates?: InteractiveStateSpec[];
  rtlRequired?: boolean;
}

// ---------- Snapshot (captured in the page) ----------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ElementRecord {
  id: number;
  parent: number | null;
  order: number;
  depth: number;
  tag: string;
  role: string | null;
  name: string | null;
  text: string | null;
  ownText: boolean;
  selector: string;
  componentId: string | null;
  componentType: string | null;
  rect: Rect;
  textRect: Rect | null;
  lineBoxes: number;
  visible: boolean;
  display: string;
  position: string;
  overflowX: string;
  overflowY: string;
  transform: boolean;
  textOverflow: string;
  lineClamp: string;
  whiteSpace: string;
  scroll: { sw: number; sh: number; cw: number; ch: number; sl: number; st: number };
  border: [number, number, number, number];
  borderVisible: boolean;
  bg: string | null;
  bgImage: boolean;
  flexDirection: string | null;
  flexWrap: string | null;
  gridColumns: number | null;
  gap: [number, number] | null;
  interactive: boolean;
  disabled: boolean;
  inert: boolean;
  ariaHidden: boolean;
  hiddenAttr: boolean;
  closedDetails: boolean;
  overlay: boolean;
  visuallyHidden: boolean;
  media: boolean;
  svgOnlyDefs: boolean;
  labelFor: number | null;
  img: { complete: boolean; naturalWidth: number; naturalHeight: number } | null;
  // Elements with their own text, and text form fields (whose value or placeholder is the text).
  type?: TypeRecord;
}

export interface TypeRecord {
  // Computed font-size, line-height and letter-spacing in CSS px; lineHeight is null for `normal`.
  size: number;
  weight: number;
  family: string;
  style: string;
  lineHeight: number | null;
  letterSpacing: number;
  transform: string;
  wrap: string;
  align: string;
  color: string;
  // Characters of the element's own text (a field's value, else its placeholder).
  chars: number;
  // Rendered width of each line of text, top to bottom (at most 12); lines counts them all.
  lines: number[];
  lineCount: number;
  // Content-box width of the nearest block container: the room the text has to wrap in.
  avail: number;
  // h1–h6 or aria-level on role=heading.
  heading: number | null;
  field?: 'value' | 'placeholder' | 'empty';
}

// The fonts Chromium actually rendered a sample of each computed font-family, weight and style with.
export interface RenderedFont {
  stack: string;
  weight: number;
  style: string;
  sample: string;
  fonts: { family: string; glyphs: number; custom: boolean }[];
}

// A picture (image, video frame, canvas bitmap, inline SVG drawing or background image) and how it
// is fitted into the box it is drawn in.
export interface PictureRecord {
  id: number;
  source: 'img' | 'video' | 'canvas' | 'svg' | 'background';
  // Intrinsic size: CSS px for images and videos, the bitmap for a canvas, the viewBox for an SVG.
  natural: [number, number];
  // The content box (a background's positioning area), in CSS px.
  box: [number, number];
  // object-fit; an SVG's preserveAspectRatio as fill (none), contain (meet) or cover (slice); a
  // background's background-size.
  fit: string;
  // object-position, preserveAspectRatio alignment or background-position, per axis.
  position: [string, string];
  // Backgrounds: whether the image repeats horizontally and vertically.
  repeat?: [boolean, boolean];
  // An empty alt, aria-hidden or presentation role, an unlabelled SVG, or a background with text on it.
  decorative: boolean;
}

// Occlusion probe (collected in the page): content that can never be seen unobstructed.
export interface OcclusionRecord {
  id: number;
  kind: 'text' | 'control' | 'media';
  pinned: boolean;
  hiddenFraction: number;
  by: { id: number | null; selector: string; name: string | null; position: string }[];
  scrollY: number;
  element: { id: number; selector: string; name: string | null; position: string };
}

export interface OcclusionProbe {
  positions: number[];
  candidates: number;
  topLayers: { id: number | null; selector: string; name: string | null; position: string }[];
  unsafeArea: { top: number; right: number; bottom: number; left: number } | null;
  records: OcclusionRecord[];
}

export interface Snapshot {
  url: string;
  title: string;
  viewport: { width: number; height: number; dpr: number };
  doc: {
    scrollWidth: number;
    scrollHeight: number;
    clientWidth: number;
    clientHeight: number;
    htmlOverflowX: string;
    htmlOverflowY: string;
    bodyOverflowX: string;
    bodyOverflowY: string;
    viewportMeta: string | null;
    dir: string;
    lang: string;
  };
  scroll: { x: number; y: number };
  elements: ElementRecord[];
  truncated: boolean;
  occlusion?: OcclusionProbe;
  // Absent in snapshots collected before pictures were captured.
  pictures?: PictureRecord[];
  renderedFonts?: RenderedFont[];
  // Families the page declares with @font-face.
  webFonts?: string[];
}

export interface ShiftSource {
  selector: string | null;
  tag: string | null;
  role: string | null;
  name: string | null;
  componentId: string | null;
  previousRect: Rect | null;
  currentRect: Rect | null;
}

export interface ShiftEntry {
  value: number;
  hadRecentInput: boolean;
  startTime: number;
  sources: ShiftSource[];
}

// ---------- Evidence bundle ----------

export type StateKind = 'baseline' | 'stress' | 'fixture' | 'interactive' | 'sweep';

export interface SettleResult {
  settled: boolean;
  reason: 'settled' | 'timeout';
  // Wall-clock time the wait took (for timing reports only; nothing is decided from it).
  elapsedMs: number;
  fontsReady: boolean;
  // Page time the page was given (its clock is paused between waits).
  pageMs?: number;
}

export interface ScreenshotRecord {
  id: string;
  // 'scrolled': a first-screen capture scrolled to where content is hidden under a fixed layer.
  kind: 'viewport' | 'full' | 'scrolled';
  path: string;
  width: number;
  height: number;
  scale: number;
  scrollY: number;
  docHeight: number;
  hiddenFixedElements?: number;
}

export interface StateRecord {
  id: string;
  kind: StateKind;
  label: string;
  viewportId: 'desktop' | 'tablet' | 'mobile' | 'sweep';
  viewport: { width: number; height: number; dpr: number; isMobile: boolean };
  fixture: FixtureName | null;
  interactiveStateId?: string;
  interactiveDescription?: string;
  status: 'collected' | 'error';
  error?: string;
  files: { snapshot?: string; dom?: string; aria?: string };
  screenshots: ScreenshotRecord[];
  settle?: SettleResult;
  layoutShifts?: ShiftEntry[];
  safeArea?: { requested: Insets; applied: boolean; resolved: Insets | null; note?: string };
  consoleErrors: string[];
  network: { external: string[]; failed: string[] };
  steps?: { step: unknown; ok: boolean; via?: string; note?: string; error?: string }[];
  stressFill?: StressFill;
  // Checked like any other state, but no screenshot goes to the judge.
  supporting?: boolean;
}

export type CoverageStatus = 'collected' | 'not_collected' | 'unavailable' | 'error';

export interface CoverageEntry {
  stateId: string;
  label: string;
  status: CoverageStatus;
  reason?: string;
}

export interface Bundle {
  schemaVersion: 1;
  bundleId: string;
  caseId: string;
  interfaceId: string;
  createdAt: string;
  collectorVersion: string;
  browser: { name: string; version: string };
  request: string;
  inputsHash: string;
  config: {
    viewports: unknown;
    sweepWidths: number[];
    sweepHeight: number;
    settle: unknown;
    fixedTime: string;
  };
  fixtures: { supported: FixtureName[] } | null;
  coverage: CoverageEntry[];
  states: StateRecord[];
  sweep: { widths: number[]; stateIds: string[] } | null;
  // Automatic interactive-state discovery (absent when states were declared in the manifest).
  interactiveDiscovery?: unknown;
}

// ---------- Diagnostics ----------

export type DiagnosticStatus = 'pass' | 'fail' | 'observed' | 'not_collected' | 'unavailable' | 'error';

export interface ElementRef {
  id: number;
  selector: string;
  tag: string;
  name: string | null;
  componentId: string | null;
  // In page coordinates, except for elements in a fixed layer (`fixed`), which are in screen coordinates.
  rect: Rect;
  fixed?: boolean;
}

export interface DiagnosticItem {
  n: number;
  summary: string;
  elements: ElementRef[];
  data: Record<string, unknown>;
}

export interface DiagnosticResult {
  key: string;
  diagId: string;
  kind: 'deterministic' | 'observation';
  stateId: string | null;
  status: DiagnosticStatus;
  reason?: string;
  evaluated: number;
  summary: string;
  items: DiagnosticItem[];
  secondary: { kind: string; label: string; items: DiagnosticItem[] }[];
  data?: Record<string, unknown>;
}

export interface Diagnostics {
  schemaVersion: 1;
  diagnosticsVersion: string;
  bundleId: string;
  computedAt: string;
  results: DiagnosticResult[];
  transitions: { width: number; reason: string }[];
}
