import type { Rect, Snapshot } from '../types.ts';

// sRGB channels 0–255 and alpha 0–1.
export type Rgba = [number, number, number, number];

// ---------- Visual System probe (one file per probed state) ----------

// Rendered style of one element, for the elements that make up the visual system: controls,
// surfaces (a fill, border, shadow or rounded corners), icons, text and annotated components.
export interface StyleRecord {
  id: number;
  color: Rgba | null;
  bg: Rgba | null;
  // 'gradient' or 'url' when a background image is drawn.
  bgImage: 'gradient' | 'url' | null;
  // Visible border sides (top, right, bottom, left): width in px and colour; null when not drawn.
  border: ([number, Rgba] | null)[] | null;
  // Corner radii in px (top-left, top-right, bottom-right, bottom-left); full when the corner is
  // at least half the shorter side (a pill or circle).
  radius: { px: [number, number, number, number]; full: boolean } | null;
  shadow: string | null;
  outline: string | null;
  // Product of the element's and its ancestors' opacity.
  opacity: number;
  transition: string | null;
  animation: string | null;
  appearance?: string;
  icon?: { kind: 'svg' | 'img' | 'glyph' | 'font'; w: number; h: number; stroke: Rgba | null; strokeWidth: number | null; fill: Rgba | null };
}

// A foreground drawn on a resolved background. Text: the element's own text; ui: a form field's
// boundary (its border or fill) against what surrounds it; icon: an icon-only control's icon.
export interface ContrastRecord {
  id: number;
  kind: 'text' | 'ui' | 'icon';
  fg: Rgba | null;
  // The opaque colour behind the foreground, composited through every layer that paints there.
  bg: Rgba | null;
  // Why no single background colour could be found.
  unresolved?: 'image' | 'gradient' | 'media' | 'covered' | 'hidden' | 'offscreen';
  size?: number;
  weight?: number;
  placeholder?: boolean;
  disabled?: boolean;
  decorative?: boolean;
  // ui: the field's fill and its visible border colours, each over the surrounding colour.
  fill?: Rgba | null;
  borders?: Rgba[];
}

export interface AxeNode {
  id: number | null;
  target: string;
  html: string;
  summary: string;
}

export interface AxeRule {
  rule: string;
  impact: string | null;
  help: string;
  tags: string[];
  nodes: AxeNode[];
}

export interface AxeResult {
  version: string;
  rules: string[];
  violations: AxeRule[];
  incomplete: AxeRule[];
  error?: string;
  // How long injecting axe-core and running it took.
  ms?: number;
}

export interface FocusStop {
  n: number;
  id: number | null;
  selector: string;
  tag: string;
  role: string | null;
  name: string | null;
  // Page coordinates (viewport coordinates for fixed elements).
  rect: Rect;
  fixed: boolean;
  // Focus-related computed styles that differ between focused and unfocused, as "property: a → b".
  changes: string[];
  // Pixels that differ between the focused and unfocused crop, and the crop's size.
  changedPixels: number | null;
  cropPixels: number;
  visible: boolean;
  // Set when another element is painted over the focused control (a modal's backdrop over the page behind it).
  coveredBy?: string;
  // The focused control is a visually hidden input; its look is judged on its label.
  hiddenInput?: boolean;
}

export interface FocusTraversal {
  stops: FocusStop[];
  // The traversal stopped at the stop limit or came back to the first stop.
  ended: 'cycle' | 'limit' | 'body';
  tolerancePx: number;
}

export interface MotionRecord {
  animations: { id: number | null; selector: string; name: string; durationMs: number; infinite: boolean }[];
  // The same, on a fresh load that asks for reduced motion.
  reduced: { id: number | null; selector: string; name: string; durationMs: number; infinite: boolean }[] | null;
}

export interface VisualProbeState {
  version: 1;
  stateId: string;
  viewport: { width: number; height: number };
  snapshot: Snapshot;
  styles: StyleRecord[];
  contrast: ContrastRecord[];
  axe: AxeResult | null;
  focus: FocusTraversal | null;
  motion: MotionRecord | null;
  replayed?: { steps: number; ok: boolean; error?: string };
  error?: string;
}

// ---------- Functionality probe (one file per viewport) ----------

export interface ProbeControl {
  key: string;
  // nth-child path from body, used to find the control again on a fresh page.
  path: string;
  // Readable selector and name, as the snapshot gives them.
  selector: string;
  tag: string;
  role: string | null;
  type: string | null;
  name: string | null;
  componentId: string | null;
  rect: Rect;
  fixed: boolean;
  kind: 'action' | 'link' | 'field' | 'toggle';
  href?: string;
  // Other visible controls with the same tag, role, classes and type (probed through this one).
  members: number;
  memberNames: string[];
  // The page state it was found in: 'load', or the interactive state it appeared in.
  from: string;
  offCanvas?: boolean;
}

export interface Effect {
  url: boolean;
  mutations: number;
  ariaChanges: number;
  requests: number;
  dialogs: number;
  invalid: number;
  calls: string[];
  scrolled: number;
  textChanged: boolean;
  newAlerts: string[];
  errors: string[];
}

export interface OperabilityResult {
  key: string;
  ok: boolean;
  reason?: string;
  // Set when the control that failed is another member of the group, not the one probed.
  member?: { name: string | null; selector: string; rect: Rect; fixed: boolean };
}

export interface ActionResult {
  key: string;
  effect: Effect | null;
  error?: string;
}

export interface FieldResult {
  key: string;
  attempted: string;
  result: string | null;
  ok: boolean;
  note?: string;
}

export interface ToggleResult {
  key: string;
  property: string;
  before: string | null;
  after: string | null;
  expected: 'toggle' | 'select';
  ok: boolean;
  renderedChange: boolean | null;
  controls?: { id: string; before: boolean | null; after: boolean | null };
  note?: string;
  // The click itself could not be made.
  error?: string;
}

export interface LinkResult {
  key: string;
  href: string;
  target: 'fragment' | 'placeholder' | 'page';
  ok: boolean;
  status?: number | null;
  detail: string;
  error?: string;
}

export interface FormResult {
  key: string;
  path: string;
  name: string | null;
  submit: string | null;
  filled: string[];
  // Fields whose value was lost when the next field was used, and that were entered again.
  refilled: string[];
  // Fields that did not keep a value even when it was entered again.
  lost: string[];
  chosen: string[];
  valid: Effect | null;
  outcome: string;
  shot?: { path: string; width: number; height: number; scrollY: number };
  empty?: Effect | null;
  emptyOutcome?: string;
  error?: string;
}

export interface FunctionalProbe {
  version: 1;
  viewport: 'desktop' | 'mobile';
  width: number;
  height: number;
  controls: ProbeControl[];
  operability: OperabilityResult[];
  actions: ActionResult[];
  fields: FieldResult[];
  toggles: ToggleResult[];
  links: LinkResult[];
  forms: FormResult[];
  // Uncaught errors, console errors and failed same-origin requests while the harness used the page.
  errors: { during: string; message: string }[];
  limits: { controls: number; probed: number };
  error?: string;
}
