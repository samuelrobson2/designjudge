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
  // Set when the probe recorded the cues that make an option look unavailable (VisualProbeState.cues).
  // text-decoration-line, when not 'none'.
  deco?: string;
  // cursor, when not 'auto', 'default' or 'pointer'.
  cursor?: string;
  // The drawn border's style, when not 'solid'.
  borderStyle?: string;
  // Look-alike siblings: a number for the parent (within this capture) and the element's tag and
  // non-state classes, when the parent has at least three children that share them.
  peer?: string;
  // The element is marked selected, pressed, checked or current, or carries a state class.
  state?: true;
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
  // The style records include deco, cursor, borderStyle, peer and state.
  cues?: true;
  error?: string;
}

// ---------- Hover probe (desktop, one file per bundle) ----------

// Content that a pointer resting on an element shows, and whether keyboard focus or a tap on a
// touch screen shows it too.
export interface HoverReveal {
  // The element hovered, and the content that became visible inside it.
  host: { selector: string; name: string | null; rect: Rect };
  revealed: { selector: string; text: string; controls: string[]; rect: Rect };
  // Look-alike hosts with the same hidden content.
  members: number;
  // Focusing the host or the first control inside it showed the content.
  focus: boolean;
  // On the phone layout: 'shown' when visible without hovering, 'tap' when a tap on the host shows it,
  // 'no' when neither does, null when the content is not on the phone page.
  touch: 'shown' | 'tap' | 'no' | null;
  // The revealed text is the host's own name (a tooltip that repeats its label).
  repeatsName: boolean;
}

export interface HoverProbe {
  version: 1;
  viewport: { width: number; height: number };
  // Hidden content tried, out of those found.
  tried: number;
  found: number;
  reveals: HoverReveal[];
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
  // Mutations outside the control used, its labels and the wrapper that holds only it.
  outside?: number;
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
  // The choice group the control belongs to (see ChoiceContext), and whether the click changed
  // anything outside the control itself.
  choice?: ChoiceContext;
  outside?: boolean;
}

// A set of options a user picks from: a fieldset, a group, radio group, tab list or toolbar, or the
// nearest container holding two or more look-alike options.
export interface ChoiceContext {
  name: string | null;
  role: string;
  size: number;
  // The panel the group sits in (an aside, section, region, navigation or dialog), as a path.
  panel: string | null;
  // The group or its panel is named as a filter, or a sort or view choice.
  filter: boolean;
  // The group is inside a form that has a submit button.
  form: boolean;
  // A button in the panel applies the choices (Apply, Show 12 results).
  apply: string | null;
}

// A dialog or drawer a control opened, tried from a fresh page each time.
export interface DialogResult {
  key: string;
  // The control that opened it.
  opener: string;
  name: string | null;
  selector: string;
  rect: Rect;
  fixed?: boolean;
  modal: boolean;
  // How it is marked: a native dialog, role=dialog, aria-modal, or a fixed panel.
  kind: 'native' | 'role' | 'panel';
  escape: boolean | null;
  // The close control found inside it, and whether clicking it closed the dialog.
  close: { name: string; selector: string; closed: boolean } | null;
  // Clicking the opener again closed it (tried for non-modal panels only).
  openerCloses?: boolean;
  // Modal only: where Tab took focus out of the dialog, or null when it stayed inside.
  tabEscape?: { selector: string; name: string | null; after: number } | null;
  // Modal only: whether wheeling over the backdrop scrolled the page behind; null when the page
  // behind cannot scroll or there is no backdrop to wheel over.
  backgroundScrolls?: boolean | null;
  // Set when the page behind scrolled: the dialog moved with it (or left the screen), rather than
  // staying in place over a page that scrolls behind it.
  movesWithPage?: boolean;
  error?: string;
}

// An action that a selection of items made available, used after selecting the fewest items.
export interface FlowResult {
  key: string;
  group: string | null;
  // Items selected when the action became available.
  selected: number;
  control: { name: string | null; selector: string; rect: Rect; fixed: boolean };
  // How it was before the selection: not on the page, or disabled.
  before: 'absent' | 'disabled';
  effect: Effect | null;
  error?: string;
}

// A save-like control whose click the page reports as saved (a saved-items count or a "Saved"
// message), and what is left of it after reloading the page.
export interface PersistResult {
  key: string;
  claim: 'count' | 'message' | null;
  // The count or message the page showed after the click.
  claimText?: string;
  before?: string | null;
  after?: string | null;
  reloaded?: string | null;
  // null when the claim could not be checked after the reload (a message with nothing else to read back).
  persisted?: boolean | null;
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
  // Present in probes that ran the behaviour trials; absent in older evidence.
  dialogs?: DialogResult[];
  flows?: FlowResult[];
  persistence?: PersistResult[];
  // Uncaught errors, console errors and failed same-origin requests while the harness used the page.
  errors: { during: string; message: string }[];
  limits: { controls: number; probed: number };
  error?: string;
}
