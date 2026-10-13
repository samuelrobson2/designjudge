import { DIAGNOSTICS_VERSION, FIXTURES } from '../config.ts';
import { hasProbes, loadFunctionalProbe, loadVisualProbe, noFunctionalProbes, visualProbeStates } from '../collect/probeStore.ts';
import { bundleDir, diagnosticsPath, loadSnapshot } from '../store.ts';
import type { Bundle, DiagnosticItem, DiagnosticResult, Diagnostics, Snapshot, StateRecord } from '../types.ts';
import { writeJson } from '../util.ts';
import { Doc } from './doc.ts';
import {
  controlOperability,
  editableResponse,
  formSubmission,
  invalidSubmission,
  navigationIntegrity,
  noEffectControls,
  runtimeErrors,
  toggleState,
} from './functionality/checks.ts';
import { countClaims, locateFindings, openedDetail, periodClaims, sortClaims, templateText, totalClaims, validationWording } from './functionality/page-claims.ts';
import { brokenImages, hiddenScrollItems, pinnedOverUsed, proximityInversion, rowImbalance, textTruncation, viewportParity } from './layout/composition.ts';
import { STATE_CHECKS, controlAvailability } from './layout/deterministic.ts';
import { alignmentOutliers, layoutStability, mediaFit, responsiveAdaptation, spatialGrouping } from './layout/observations.ts';
import { fontFamilies, headingLineBalance, invalidTextRendering, lineHeight, responsiveTypography, sizeWeightProfile, typeScale } from './typography/checks.ts';
import { squeezedWrapping } from './typography/wrapping.ts';
import { accessibilityViolations, contrastProfile, focusVisibility, peerConsistency, requiredContrast, styleVocabulary, targetSize } from './visual_system/checks.ts';
import { labelInName, reducedMotion } from './visual_system/names.ts';

export const DIAG_NAMES: Record<string, string> = {
  region_overlap: 'Region Overlap',
  container_overflow: 'Container Overflow',
  page_horizontal_overflow: 'Page-Level Horizontal Overflow',
  interactive_reachability: 'Interactive Element Reachability',
  collapsed_dimensions: 'Collapsed Component Dimensions',
  occluded_content: 'Occluded Content',
  // A row of Responsive Layout Failures, not a separate diagnostic.
  control_availability: 'Control Availability',
  responsive_layout_failures: 'Responsive Layout Failures',
  content_growth_failures: 'Content-Growth Layout Failures',
  spatial_grouping: 'Spatial Grouping and Separation',
  responsive_adaptation: 'Responsive Component Adaptation',
  alignment_outliers: 'Alignment Outliers',
  media_fit: 'Media Cropping and Distortion',
  layout_stability: 'Runtime Layout Stability',
  invalid_text_rendering: 'Invalid Text Rendering',
  type_scale: 'Type Scale & Reuse',
  font_families: 'Font Family Usage',
  size_weight_profile: 'Text Size & Weight Profile',
  line_height: 'Line Height',
  heading_line_balance: 'Heading Line Balance',
  responsive_typography: 'Responsive Typography Adaptation',
  accessibility_violations: 'Automated Accessibility Violations',
  required_contrast: 'Required Contrast',
  focus_visibility: 'Keyboard Focus Visibility',
  target_size: 'Minimum Pointer Target Size',
  style_vocabulary: 'Rendered Style Vocabulary',
  contrast_profile: 'Rendered Contrast Profile',
  peer_consistency: 'Peer Visual Consistency',
  control_operability: 'Interactive Control Operability',
  no_effect_controls: 'No-Effect Action Controls',
  editable_response: 'Editable Control Response',
  toggle_state: 'Toggle / Selection State',
  navigation_integrity: 'Internal Navigation Integrity',
  form_submission: 'Form Submission Response',
  invalid_submission: 'Invalid Submission Feedback',
  runtime_errors: 'Runtime Errors',
  // Read by Layout v7, Typography v2, Visual System v2 and Functionality v2 (categories/versions.ts).
  broken_images: 'Broken Images',
  proximity_inversion: 'Proximity Inversion',
  text_truncation: 'Text Truncation',
  row_imbalance: 'Row Height Imbalance',
  hidden_scroll_items: 'Hidden Scroll Items',
  pinned_over_used: 'Pinned Layer Over Used Item',
  viewport_parity: 'Viewport Content Parity',
  squeezed_wrapping: 'Squeezed Text Wrapping',
  label_in_name: 'Label in Name',
  reduced_motion: 'Reduced Motion Support',
  count_claims: 'Count Claims',
  total_claims: 'Totals Against Line Items',
  sort_claims: 'Sort-Order Claims',
  period_claims: 'Period Claims',
  opened_detail: 'Opened Detail Identity',
  template_text: 'Unfilled Template Values',
  validation_wording: 'Validation Message Wording',
};

export const VISUAL_SYSTEM_DIAGNOSTICS = new Set([
  'accessibility_violations',
  'required_contrast',
  'focus_visibility',
  'target_size',
  'style_vocabulary',
  'contrast_profile',
  'peer_consistency',
  'label_in_name',
  'reduced_motion',
]);

export const FUNCTIONALITY_DIAGNOSTICS = new Set([
  'control_operability',
  'no_effect_controls',
  'editable_response',
  'toggle_state',
  'navigation_integrity',
  'form_submission',
  'invalid_submission',
  'runtime_errors',
  'count_claims',
  'total_claims',
  'sort_claims',
  'period_claims',
  'opened_detail',
  'template_text',
  'validation_wording',
]);

export const TYPOGRAPHY_DIAGNOSTICS = new Set([
  'invalid_text_rendering',
  'type_scale',
  'font_families',
  'size_weight_profile',
  'line_height',
  'heading_line_balance',
  'responsive_typography',
  'squeezed_wrapping',
]);

// Layout results that only Layout v7 and later read.
export const LAYOUT_ADDED_DIAGNOSTICS = new Set(['broken_images', 'proximity_inversion', 'text_truncation', 'row_imbalance', 'hidden_scroll_items', 'pinned_over_used', 'viewport_parity']);

const TYPE_OBSERVATIONS = [
  ['type_scale', typeScale],
  ['font_families', fontFamilies],
  ['size_weight_profile', sizeWeightProfile],
  ['line_height', lineHeight],
  ['heading_line_balance', headingLineBalance],
  ['squeezed_wrapping', squeezedWrapping],
] as const;

const OBSERVATION_STATES = ['desktop', 'tablet', 'mobile', 'stress-desktop'];
const STABILITY_STATES = ['desktop', 'tablet', 'mobile'];

function keyOf(diagId: string, stateId: string | null): string {
  return stateId ? `${diagId}@${stateId}` : diagId;
}

function missingResult(diagId: string, kind: 'deterministic' | 'observation', stateId: string | null, status: 'not_collected' | 'unavailable' | 'error', reason: string): DiagnosticResult {
  return { key: keyOf(diagId, stateId), diagId, kind, stateId, status, reason, evaluated: 0, summary: reason, items: [], secondary: [] };
}

function coverageStatus(bundle: Bundle, stateId: string): { status: 'not_collected' | 'unavailable' | 'error'; reason: string } | null {
  const state = bundle.states.find((s) => s.id === stateId);
  if (state && state.status === 'collected') return null;
  if (state && state.status === 'error') return { status: 'error', reason: `State failed to collect: ${state.error}` };
  const cov = bundle.coverage.find((c) => c.stateId === stateId);
  if (cov && (cov.status === 'unavailable' || cov.status === 'not_collected')) return { status: cov.status, reason: cov.reason ?? cov.status };
  return { status: 'not_collected', reason: 'State was not collected.' };
}

interface MatrixCell {
  column: string;
  stateId: string;
  status: DiagnosticResult['status'];
  failures: number;
}

function buildMatrix(
  diagId: 'responsive_layout_failures' | 'content_growth_failures',
  columns: { column: string; stateId: string }[],
  perState: Map<string, DiagnosticResult>,
  bundle: Bundle,
): { result: DiagnosticResult; cells: Map<string, MatrixCell[]> } {
  const cells = new Map<string, MatrixCell[]>();
  const items: DiagnosticItem[] = [];
  let anyFail = false;
  let anyCollected = false;
  for (const check of STATE_CHECKS) {
    const row: MatrixCell[] = columns.map(({ column, stateId }) => {
      const r = perState.get(keyOf(check.diagId, stateId));
      if (r) {
        if (r.status === 'pass' || r.status === 'fail') anyCollected = true;
        return { column, stateId, status: r.status, failures: r.items.length };
      }
      const cov = coverageStatus(bundle, stateId);
      return { column, stateId, status: cov?.status ?? 'not_collected', failures: 0 };
    });
    cells.set(check.diagId, row);
    const failing = row.filter((c) => c.status === 'fail');
    if (failing.length) {
      anyFail = true;
      const first = perState.get(keyOf(check.diagId, failing[0].stateId));
      items.push({
        n: items.length + 1,
        summary: `${check.name} fails in ${failing.length} of ${row.filter((c) => c.status === 'pass' || c.status === 'fail').length} ${diagId === 'responsive_layout_failures' ? 'widths' : 'viewport × fixture combinations'} (${failing.map((c) => c.column).join(', ')}). First: ${first?.items[0]?.summary ?? first?.summary ?? ''}`,
        elements: first?.items[0]?.elements ?? [],
        data: { check: check.diagId, failing: failing.map((c) => ({ column: c.column, stateId: c.stateId, failures: c.failures })) },
      });
    }
  }
  const status: DiagnosticResult['status'] = !anyCollected
    ? columns.some((c) => coverageStatus(bundle, c.stateId)?.status === 'unavailable')
      ? 'unavailable'
      : 'not_collected'
    : anyFail
      ? 'fail'
      : 'pass';
  const name = DIAG_NAMES[diagId];
  const reason =
    status === 'unavailable' || status === 'not_collected'
      ? coverageStatus(bundle, columns[columns.length - 1]?.stateId ?? '')?.reason ?? 'No states collected.'
      : undefined;
  return {
    cells,
    result: {
      key: diagId,
      diagId,
      kind: 'deterministic',
      stateId: null,
      status,
      reason,
      evaluated: columns.length,
      summary:
        status === 'pass'
          ? `Every underlying check passes in all ${columns.length} ${diagId === 'responsive_layout_failures' ? 'widths' : 'viewport × fixture combinations'}.`
          : status === 'fail'
            ? `${name}: ${items.length} check${items.length > 1 ? 's' : ''} fail somewhere in the matrix. ${items.map((i) => i.summary.split(' (')[0]).join('; ')}.`
            : reason ?? status,
      items,
      secondary: [],
      data: {
        columns: columns.map((c) => c.column),
        rows: STATE_CHECKS.map((c) => ({ check: c.diagId, name: c.name, cells: cells.get(c.diagId) })),
      },
    },
  };
}

export function runDiagnostics(bundle: Bundle): Diagnostics {
  const results: DiagnosticResult[] = [];
  const perState = new Map<string, DiagnosticResult>();
  const snaps = new Map<string, Snapshot>();
  const docs = new Map<string, Doc>();
  const byId = new Map<string, StateRecord>(bundle.states.map((s) => [s.id, s]));

  for (const state of bundle.states) {
    if (state.status !== 'collected') continue;
    const snap = loadSnapshot(bundle, state);
    if (!snap) continue;
    snaps.set(state.id, snap);
    docs.set(state.id, new Doc(snap));
  }

  // Per-state deterministic checks on every collected state.
  for (const state of bundle.states) {
    for (const check of STATE_CHECKS) {
      let r: DiagnosticResult;
      const doc = docs.get(state.id);
      if (!doc) {
        r = missingResult(check.diagId, 'deterministic', state.id, 'error', `State failed to collect: ${state.error ?? 'no snapshot'}`);
      } else {
        try {
          const out = check.fn(doc, { stateId: state.id, viewport: { width: state.viewport.width, height: state.viewport.height } });
          r = { key: keyOf(check.diagId, state.id), diagId: check.diagId, kind: 'deterministic', stateId: state.id, ...out };
        } catch (err) {
          r = missingResult(check.diagId, 'deterministic', state.id, 'error', `Check crashed: ${(err as Error).message}`);
        }
      }
      perState.set(r.key, r);
      results.push(r);
    }
  }

  // Missing anchor states get explicit not-collected/unavailable results.
  const anchorIds = ['stress-desktop'];
  for (const id of anchorIds) {
    if (byId.has(id)) continue;
    const cov = coverageStatus(bundle, id)!;
    for (const check of STATE_CHECKS) results.push(missingResult(check.diagId, 'deterministic', id, cov.status, cov.reason));
  }

  // Responsive Layout Failures: check × width matrix over the sweep.
  const sweepIds = bundle.sweep?.stateIds ?? [];
  const sweepColumns = sweepIds.map((id) => ({ column: `${byId.get(id)?.viewport.width ?? id}px`, stateId: id }));
  const responsive = buildMatrix('responsive_layout_failures', sweepColumns, perState, bundle);
  const sweepDocs = sweepIds.filter((id) => docs.has(id)).map((id) => ({ width: byId.get(id)!.viewport.width, stateId: id, doc: docs.get(id)! }));
  if (sweepDocs.length >= 3) {
    const avail = controlAvailability(sweepDocs);
    const r = responsive.result;
    const rows = (r.data as { rows: { check: string; name: string; cells: unknown }[] }).rows;
    rows.push({ check: 'control_availability', name: DIAG_NAMES.control_availability, cells: avail.cells });
    responsive.cells.set('control_availability', avail.cells);
    if (avail.items.length) {
      r.items.push(...avail.items.map((it, i) => ({ ...it, n: r.items.length + i + 1 })));
      const failingRows = rows.filter((row) => (row.cells as { status: string }[]).some((c) => c.status === 'fail'));
      r.status = 'fail';
      r.summary = `${DIAG_NAMES.responsive_layout_failures}: ${failingRows.length} check${failingRows.length > 1 ? 's' : ''} fail somewhere in the matrix. ${r.items.map((i) => i.summary.split(' (')[0]).join('; ')}.`;
    }
  }
  results.push(responsive.result);

  // Content-Growth Layout Failures: check × viewport × fixture matrix.
  const growthColumns: { column: string; stateId: string }[] = [];
  for (const vp of ['desktop', 'tablet', 'mobile']) {
    for (const fx of FIXTURES) {
      let stateId = `fixture-${fx}-${vp}`;
      if (fx === 'typical') stateId = vp;
      if (fx === 'stress' && vp === 'desktop') stateId = 'stress-desktop';
      growthColumns.push({ column: `${vp}/${fx}`, stateId });
    }
  }
  if (!bundle.fixtures?.supported?.length) {
    results.push(
      missingResult('content_growth_failures', 'deterministic', null, 'unavailable', 'The interface exposes no fixture interface; content-growth states could not be rendered.'),
    );
  } else {
    results.push(buildMatrix('content_growth_failures', growthColumns, perState, bundle).result);
  }

  // Quantitative observations.
  for (const stateId of OBSERVATION_STATES) {
    const doc = docs.get(stateId);
    const state = byId.get(stateId);
    for (const [diagId, fn] of [
      ['spatial_grouping', (d: Doc) => spatialGrouping(d, { width: state!.viewport.width, height: state!.viewport.height })],
      ['alignment_outliers', (d: Doc) => alignmentOutliers(d)],
    ] as const) {
      if (!doc || !state) {
        const cov = coverageStatus(bundle, stateId)!;
        results.push(missingResult(diagId, 'observation', stateId, cov.status, cov.reason));
        continue;
      }
      try {
        const out = fn(doc);
        results.push({ key: keyOf(diagId, stateId), diagId, kind: 'observation', stateId, secondary: [], ...out });
      } catch (err) {
        results.push(missingResult(diagId, 'observation', stateId, 'error', `Observation crashed: ${(err as Error).message}`));
      }
    }
  }
  // Media fit at the anchor states and at every sweep width, so a picture can be followed across widths.
  for (const stateId of [...OBSERVATION_STATES, ...sweepIds.filter((id) => docs.has(id))]) {
    const doc = docs.get(stateId);
    if (!doc) {
      const cov = coverageStatus(bundle, stateId)!;
      results.push(missingResult('media_fit', 'observation', stateId, cov.status, cov.reason));
    } else if (!doc.snap.pictures) {
      results.push(missingResult('media_fit', 'observation', stateId, 'unavailable', 'This evidence was collected before pictures were captured; recollect the interface.'));
    } else {
      try {
        results.push({ key: keyOf('media_fit', stateId), diagId: 'media_fit', kind: 'observation', stateId, secondary: [], ...mediaFit(doc) });
      } catch (err) {
        results.push(missingResult('media_fit', 'observation', stateId, 'error', `Observation crashed: ${(err as Error).message}`));
      }
    }
  }
  for (const stateId of STABILITY_STATES) {
    const state = byId.get(stateId);
    if (!state || state.status !== 'collected') {
      const cov = coverageStatus(bundle, stateId)!;
      results.push(missingResult('layout_stability', 'observation', stateId, cov.status, cov.reason));
      continue;
    }
    if (!state.layoutShifts) {
      results.push(missingResult('layout_stability', 'observation', stateId, 'unavailable', 'Layout-shift entries were not recorded.'));
      continue;
    }
    const { elementsless: _e, ...out } = layoutStability(state.layoutShifts);
    results.push({ key: keyOf('layout_stability', stateId), diagId: 'layout_stability', kind: 'observation', stateId, secondary: [], ...out });
  }

  let structural: { width: number; reason: string }[] = [];
  const sweepSnaps = sweepIds
    .filter((id) => snaps.has(id))
    .map((id) => ({ width: byId.get(id)!.viewport.width, snap: snaps.get(id)! }));
  if (sweepSnaps.length >= 2) {
    try {
      const { transitions, ...out } = responsiveAdaptation(sweepSnaps);
      structural = transitions;
      results.push({ key: 'responsive_adaptation', diagId: 'responsive_adaptation', kind: 'observation', stateId: null, secondary: [], ...out });
    } catch (err) {
      results.push(missingResult('responsive_adaptation', 'observation', null, 'error', `Observation crashed: ${(err as Error).message}`));
    }
  } else {
    results.push(missingResult('responsive_adaptation', 'observation', null, 'not_collected', 'The responsive sweep was not collected.'));
  }

  results.push(...compositionResults(bundle, docs, results));
  results.push(...typographyResults(bundle, docs, sweepIds));
  results.push(...visualSystemResults(bundle));
  results.push(...functionalityResults(bundle, snaps, docs));

  // Transitions for sweep screenshot selection: failure onsets/offsets first, then structure.
  const failureTransitions: { width: number; reason: string }[] = [];
  for (const [diagId, row] of responsive.cells) {
    for (let i = 0; i < row.length; i++) {
      const prev = i > 0 ? row[i - 1].status : 'pass';
      const cur = row[i].status;
      if ((cur === 'fail') !== (prev === 'fail')) {
        const width = byId.get(row[i].stateId)!.viewport.width;
        failureTransitions.push({ width, reason: `${DIAG_NAMES[diagId]} ${cur === 'fail' ? 'starts failing' : 'stops failing'}` });
      }
    }
  }

  return {
    schemaVersion: 1,
    diagnosticsVersion: DIAGNOSTICS_VERSION,
    bundleId: bundle.bundleId,
    computedAt: new Date().toISOString(),
    results,
    transitions: [...failureTransitions, ...structural],
  };
}

// Typography: Invalid Text Rendering in every state, the profiles at the anchor states, and
// responsive adaptation across the sweep. Snapshots collected before typography capture have no
// text styles, so their results are unavailable.
function typographyResults(bundle: Bundle, docs: Map<string, Doc>, sweepIds: string[]): DiagnosticResult[] {
  const out: DiagnosticResult[] = [];
  const NO_TYPE = 'This evidence was collected before text styles were captured; recollect the interface.';
  const hasType = (doc: Doc) => doc.els.some((e) => e.type);
  for (const state of bundle.states) {
    const doc = docs.get(state.id);
    const id = 'invalid_text_rendering';
    if (!doc) {
      out.push(missingResult(id, 'deterministic', state.id, 'error', `State failed to collect: ${state.error ?? 'no snapshot'}`));
      continue;
    }
    if (!hasType(doc)) {
      out.push(missingResult(id, 'deterministic', state.id, 'unavailable', NO_TYPE));
      continue;
    }
    try {
      const r = invalidTextRendering(doc, { stateId: state.id, viewport: { width: state.viewport.width, height: state.viewport.height } });
      out.push({ key: keyOf(id, state.id), diagId: id, kind: 'deterministic', stateId: state.id, ...r });
    } catch (err) {
      out.push(missingResult(id, 'deterministic', state.id, 'error', `Check crashed: ${(err as Error).message}`));
    }
  }
  for (const stateId of OBSERVATION_STATES) {
    const doc = docs.get(stateId);
    for (const [diagId, fn] of TYPE_OBSERVATIONS) {
      if (!doc) {
        const cov = coverageStatus(bundle, stateId)!;
        out.push(missingResult(diagId, 'observation', stateId, cov.status, cov.reason));
      } else if (!hasType(doc)) {
        out.push(missingResult(diagId, 'observation', stateId, 'unavailable', NO_TYPE));
      } else {
        try {
          out.push({ key: keyOf(diagId, stateId), diagId, kind: 'observation', stateId, secondary: [], ...fn(doc) });
        } catch (err) {
          out.push(missingResult(diagId, 'observation', stateId, 'error', `Observation crashed: ${(err as Error).message}`));
        }
      }
    }
  }
  const byId = new Map(bundle.states.map((s) => [s.id, s]));
  const sweep = sweepIds.filter((id) => docs.has(id)).map((id) => ({ width: byId.get(id)!.viewport.width, doc: docs.get(id)! }));
  const id = 'responsive_typography';
  if (sweep.length < 2) out.push(missingResult(id, 'observation', null, 'not_collected', 'The responsive sweep was not collected.'));
  else if (!sweep.every((s) => hasType(s.doc))) out.push(missingResult(id, 'observation', null, 'unavailable', NO_TYPE));
  else {
    try {
      out.push({ key: id, diagId: id, kind: 'observation', stateId: null, secondary: [], ...responsiveTypography(sweep) });
    } catch (err) {
      out.push(missingResult(id, 'observation', null, 'error', `Observation crashed: ${(err as Error).message}`));
    }
  }
  return out;
}

const NO_PROBES = (caseId: string) => `This evidence was collected before the Visual System probes; add them with: npm run probe -- ${caseId}`;

function run(diagId: string, kind: DiagnosticResult['kind'], stateId: string | null, fn: () => Omit<DiagnosticResult, 'key' | 'diagId' | 'kind' | 'stateId' | 'secondary'> & { secondary?: DiagnosticResult['secondary'] }): DiagnosticResult {
  try {
    const out = fn();
    return { key: keyOf(diagId, stateId), diagId, kind, stateId, secondary: [], ...out };
  } catch (err) {
    return missingResult(diagId, kind, stateId, 'error', `${kind === 'deterministic' ? 'Check' : 'Observation'} crashed: ${(err as Error).message}`);
  }
}

// Visual System: the checks in every probed state; the page-wide vocabulary and peer groups at
// desktop and phone. Results are keyed to the probed state; their elements are the probe's own
// snapshot of that state.
function visualSystemResults(bundle: Bundle): DiagnosticResult[] {
  const out: DiagnosticResult[] = [];
  const dir = bundleDir(bundle.caseId, bundle.bundleId);
  const probed = hasProbes(dir);
  const CHECKS = ['accessibility_violations', 'required_contrast', 'target_size'] as const;
  for (const state of visualProbeStates(bundle)) {
    const probe = probed ? loadVisualProbe(dir, state.id) : null;
    const missing = (diagId: string, kind: DiagnosticResult['kind'], status: 'unavailable' | 'error', reason: string) => out.push(missingResult(diagId, kind, state.id, status, reason));
    const pageWide = state.kind === 'baseline' && state.id !== 'tablet';
    const all = [...[...CHECKS, 'label_in_name', 'reduced_motion'].map((d) => [d, 'deterministic'] as const), ['contrast_profile', 'observation'] as const, ...(state.viewportId === 'desktop' ? [['focus_visibility', 'deterministic'] as const] : []), ...(pageWide ? (['style_vocabulary', 'peer_consistency'] as const).map((d) => [d, 'observation'] as const) : [])];
    if (!probe || probe.error || !probe.snapshot) {
      for (const [d, k] of all) missing(d, k, probe ? 'error' : 'unavailable', probe ? `The Visual System probe failed in this state: ${probe.error ?? 'no snapshot'}` : NO_PROBES(bundle.caseId));
      continue;
    }
    if (probe.replayed && !probe.replayed.ok) {
      for (const [d, k] of all) missing(d, k, 'error', `The interaction could not be replayed for the probe: ${probe.replayed.error}`);
      continue;
    }
    const doc = new Doc(probe.snapshot);
    if (!probe.axe || probe.axe.error) missing('accessibility_violations', 'deterministic', 'error', `axe-core did not run: ${probe.axe?.error ?? 'no result'}`);
    else out.push(run('accessibility_violations', 'deterministic', state.id, () => accessibilityViolations(probe, doc)));
    out.push(run('required_contrast', 'deterministic', state.id, () => requiredContrast(probe, doc)));
    out.push(run('target_size', 'deterministic', state.id, () => targetSize(probe, doc)));
    if (state.viewportId === 'desktop') {
      if (probe.focus) out.push(run('focus_visibility', 'deterministic', state.id, () => focusVisibility(probe, doc)));
      else missing('focus_visibility', 'deterministic', 'unavailable', 'The keyboard traversal did not run in this state.');
    }
    out.push(run('contrast_profile', 'observation', state.id, () => contrastProfile(probe, doc)));
    out.push(run('label_in_name', 'deterministic', state.id, () => labelInName(doc)));
    if (probe.motion?.reduced) out.push(run('reduced_motion', 'deterministic', state.id, () => reducedMotion(probe, doc)));
    else missing('reduced_motion', 'deterministic', 'unavailable', 'The page was not loaded asking for reduced motion in this state.');
    if (pageWide) {
      out.push(run('style_vocabulary', 'observation', state.id, () => styleVocabulary(probe, doc)));
      out.push(run('peer_consistency', 'observation', state.id, () => peerConsistency(probe, doc)));
    }
  }
  return out;
}

// Functionality: what the probe found when it used the controls at desktop and phone, and the
// errors raised while any state loaded.
function functionalityResults(bundle: Bundle, snaps: Map<string, Snapshot>, docs: Map<string, Doc>): DiagnosticResult[] {
  const out: DiagnosticResult[] = [];
  const dir = bundleDir(bundle.caseId, bundle.bundleId);
  const probed = hasProbes(dir);
  const PROBE_CHECKS = [
    ['control_operability', controlOperability],
    ['no_effect_controls', noEffectControls],
    ['editable_response', editableResponse],
    ['toggle_state', toggleState],
    ['navigation_integrity', navigationIntegrity],
    ['form_submission', formSubmission],
    ['invalid_submission', invalidSubmission],
  ] as const;
  const probes = [];
  for (const vp of ['desktop', 'mobile'] as const) {
    if (!bundle.states.some((s) => s.id === vp && s.status === 'collected')) continue;
    const probe = probed ? loadFunctionalProbe(dir, vp) : null;
    if (!probe || probe.error) {
      for (const [d] of PROBE_CHECKS) out.push(missingResult(d, 'deterministic', vp, probe ? 'error' : 'unavailable', probe ? `The Functionality probe failed: ${probe.error}` : noFunctionalProbes(bundle.caseId)));
      continue;
    }
    probes.push(probe);
    for (const [diagId, fn] of PROBE_CHECKS) {
      let perState: Map<string, Omit<DiagnosticResult, 'key' | 'diagId' | 'kind' | 'stateId'>>;
      try {
        perState = fn(probe);
      } catch (err) {
        out.push(missingResult(diagId, 'deterministic', vp, 'error', `Check crashed: ${(err as Error).message}`));
        continue;
      }
      for (const [stateId, r] of perState) out.push({ key: keyOf(diagId, stateId), diagId, kind: 'deterministic', stateId, ...r });
    }
  }
  const loaded = bundle.states.filter((s) => s.status === 'collected' && s.kind !== 'sweep').map((s) => {
    const url = snaps.get(s.id)?.url;
    return { state: s, origin: url ? new URL(url).origin : null };
  });
  for (const [stateId, r] of runtimeErrors(loaded, probes)) out.push({ key: keyOf('runtime_errors', stateId), diagId: 'runtime_errors', kind: 'deterministic', stateId, ...r });
  // What the page says about its own data, from each state's accessibility outline.
  const PAGE_CHECKS = [
    ['count_claims', countClaims],
    ['total_claims', totalClaims],
    ['sort_claims', sortClaims],
    ['period_claims', periodClaims],
    ['opened_detail', openedDetail],
    ['template_text', templateText],
  ] as const;
  for (const [diagId, fn] of PAGE_CHECKS) {
    try {
      for (const [stateId, r] of fn(bundle)) {
        const doc = docs.get(stateId);
        if (doc) locateFindings(r.items, doc);
        out.push({ key: keyOf(diagId, stateId), diagId, kind: 'deterministic', stateId, ...r });
      }
    } catch (err) {
      out.push(missingResult(diagId, 'deterministic', null, 'error', `Check crashed: ${(err as Error).message}`));
    }
  }
  try {
    for (const [stateId, r] of validationWording(bundle)) out.push({ key: keyOf('validation_wording', stateId), diagId: 'validation_wording', kind: 'observation', stateId, secondary: [], ...r });
  } catch (err) {
    out.push(missingResult('validation_wording', 'observation', null, 'error', `Observation crashed: ${(err as Error).message}`));
  }
  return out;
}

// Layout results read by Layout v7 and later: broken pictures in every state, two promotions of
// existing results (Proximity Inversion from Spatial Grouping; Text Truncation from Container
// Overflow, at load and after interactions, where text is the interface's own), and the
// composition measurements.
function compositionResults(bundle: Bundle, docs: Map<string, Doc>, earlier: DiagnosticResult[]): DiagnosticResult[] {
  const out: DiagnosticResult[] = [];
  const find = (diagId: string, stateId: string) => earlier.find((r) => r.diagId === diagId && r.stateId === stateId);
  const own = bundle.states.filter((s) => s.status === 'collected' && s.kind !== 'sweep' && docs.has(s.id));
  for (const s of own) out.push(run('broken_images', 'deterministic', s.id, () => brokenImages(docs.get(s.id)!)));
  for (const stateId of OBSERVATION_STATES) {
    const spatial = find('spatial_grouping', stateId);
    if (spatial?.status === 'observed') out.push(run('proximity_inversion', 'deterministic', stateId, () => proximityInversion(spatial)));
  }
  for (const s of own.filter((x) => x.kind === 'baseline' || x.kind === 'interactive')) {
    const overflow = find('container_overflow', s.id);
    if (overflow && (overflow.status === 'pass' || overflow.status === 'fail')) out.push(run('text_truncation', 'observation', s.id, () => textTruncation(overflow, docs.get(s.id)!)));
  }
  for (const stateId of ['desktop', 'tablet', 'stress-desktop', 'fixture-dense-desktop']) {
    if (docs.has(stateId)) out.push(run('row_imbalance', 'observation', stateId, () => rowImbalance(docs.get(stateId)!)));
  }
  for (const stateId of STABILITY_STATES) {
    if (docs.has(stateId)) out.push(run('hidden_scroll_items', 'observation', stateId, () => hiddenScrollItems(docs.get(stateId)!)));
  }
  for (const s of own.filter((x) => x.kind === 'interactive')) {
    const base = docs.get(s.viewportId);
    if (!base) continue;
    const r = run('pinned_over_used', 'observation', s.id, () => pinnedOverUsed(s, docs.get(s.id)!, base) ?? { status: 'observed', evaluated: 0, summary: 'No control was used to reach this state.', items: [] });
    out.push(r);
  }
  const parity = run('viewport_parity', 'observation', 'mobile', () => viewportParity(bundle) ?? missingResult('viewport_parity', 'observation', 'mobile', 'not_collected', 'The desktop or phone state was not collected.'));
  out.push(parity);
  return out;
}

export function diagnoseAndSave(bundle: Bundle): Diagnostics {
  const diags = runDiagnostics(bundle);
  writeJson(diagnosticsPath(bundle), diags);
  return diags;
}
