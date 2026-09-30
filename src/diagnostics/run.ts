import { DIAGNOSTICS_VERSION, FIXTURES } from '../config.ts';
import { diagnosticsPath, loadSnapshot } from '../store.ts';
import type { Bundle, DiagnosticItem, DiagnosticResult, Diagnostics, Snapshot, StateRecord } from '../types.ts';
import { writeJson } from '../util.ts';
import { Doc } from './doc.ts';
import { STATE_CHECKS, controlAvailability } from './layout/deterministic.ts';
import { alignmentOutliers, layoutStability, responsiveAdaptation, spatialGrouping } from './layout/observations.ts';

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
  layout_stability: 'Runtime Layout Stability',
};

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

export function diagnoseAndSave(bundle: Bundle): Diagnostics {
  const diags = runDiagnostics(bundle);
  writeJson(diagnosticsPath(bundle), diags);
  return diags;
}
