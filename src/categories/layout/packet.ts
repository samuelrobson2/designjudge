import type { Bundle, DiagnosticItem, DiagnosticResult, Diagnostics, ElementRef, StateRecord } from '../../types.ts';
import { DIAG_NAMES } from '../../diagnostics/run.ts';
import type { EvidenceIndexEntry, Packet, PacketImage } from '../types.ts';
import { buildFindingsEvidence, stateName, type FindingLine, type FindingsCriterion } from './findings.ts';
import { assignMarks, boxOnImage, lineVisibleIn } from './marks.ts';
import { DIAGNOSTIC_HOME } from './homes.ts';
import { parseLayoutRubric, screenshotMatcher } from './rubric.ts';

export const LAYOUT_PACKET_VERSION = 'layout-packet-v1';
export const LAYOUT_PACKET_VERSION_BY_CRITERION = 'layout-packet-v2';
export const LAYOUT_PACKET_VERSION_FOCUSED = 'layout-packet-v3';
export const LAYOUT_PACKET_VERSION_FINDINGS = 'layout-packet-v4-issue-shots';

export function packetVersionFor(opts: PacketOptions): string {
  if (opts.grouping === 'by-type') return LAYOUT_PACKET_VERSION;
  if (opts.evidence === 'findings') return LAYOUT_PACKET_VERSION_FINDINGS;
  return opts.evidence === 'focused' || opts.screenshots === 'essential' ? LAYOUT_PACKET_VERSION_FOCUSED : LAYOUT_PACKET_VERSION_BY_CRITERION;
}

export interface PacketOptions {
  grouping: 'by-type' | 'by-criterion';
  // 'essential': one full-page image per state where possible, the mobile first screen,
  // one image per interactive state, and sweep widths only where a check starts failing.
  screenshots?: 'all' | 'essential';
  // 'focused': each check and observation only under the criterion it bears on most; failing
  // checks in full, passing checks as one line, observations with every item; missing or
  // errored evidence left out.
  // 'findings': by criterion, only what failing checks found (merged across states, fixture and
  // sweep failures included) and observation measurements outside or close to their reference,
  // in plain words; states described by what they are. Needs grouping 'by-criterion'.
  evidence?: 'full' | 'focused' | 'findings';
}

const ESSENTIAL_SWEEP_SCREENSHOTS = 2;
const MISSING_STATUSES = ['not_collected', 'unavailable', 'error'];

const MAX_ITEMS_DETERMINISTIC = 5;
const MAX_ITEMS_OBSERVATION = 8;
const MAX_SECONDARY_EXAMPLES = 3;
const MAX_TRANSITION_SCREENSHOTS = 4;
const PATCH = 32;
const MAX_ORIGINAL_PATCHES = 30_000;
const IMAGE_TOKEN_MULTIPLIER = 1.2;

// Estimated billable image tokens under OpenAI's patch-based sizing rules.
export function estimateImageTokens(width: number, height: number, detail: 'high' | 'original'): number {
  let w = width;
  let h = height;
  if (detail === 'high') {
    const fit = Math.min(1, 2048 / Math.max(w, h));
    w = Math.floor(w * fit);
    h = Math.floor(h * fit);
    const patches = Math.ceil(w / PATCH) * Math.ceil(h / PATCH);
    if (patches > 2500) {
      const shrink = Math.sqrt((PATCH * PATCH * 2500) / (w * h));
      w = Math.floor(w * shrink);
      h = Math.floor(h * shrink);
    }
  }
  return Math.ceil(Math.ceil(w / PATCH) * Math.ceil(h / PATCH) * IMAGE_TOKEN_MULTIPLIER);
}

function patches(width: number, height: number): number {
  return Math.ceil(width / PATCH) * Math.ceil(height / PATCH);
}

function compactEl(e: ElementRef) {
  return {
    el: e.selector,
    ...(e.name ? { name: e.name } : {}),
    ...(e.componentId ? { component: e.componentId } : {}),
    box: [Math.round(e.rect.x), Math.round(e.rect.y), Math.round(e.rect.w), Math.round(e.rect.h)],
  };
}

function compactData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'samples' || k === 'fullSeries') continue;
    if (Array.isArray(v)) out[k] = v.slice(0, 3);
    else out[k] = v;
  }
  return out;
}

function fillText(f: NonNullable<StateRecord['stressFill']>): string | null {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const k = f.kept;
  const parts = [
    k.fill ? `${plural(k.fill, 'text field', 'text fields')} filled with long text` : null,
    k.choose ? `${plural(k.choose, 'single-choice option', 'single-choice options')} chosen` : null,
    k.select ? `${plural(k.select, 'dropdown', 'dropdowns')} set to its longest option` : null,
    k.check ? `${plural(k.check, 'checkbox', 'checkboxes')} checked` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  const undone = f.actions.filter((a) => a.outcome === 'undone').length;
  return `Form controls were filled in as a thorough user would: ${parts.join(', ')}.${
    undone ? ` ${plural(undone, 'change', 'changes')} that opened a dialog or removed content (such as a filter narrowing the results) ${undone === 1 ? 'was' : 'were'} undone.` : ''
  }`;
}

function viewportText(state: StateRecord): string {
  const v = state.viewport;
  const parts = [`${v.width}×${v.height} CSS px`, `device pixel ratio ${v.dpr}`];
  if (state.viewportId === 'mobile') parts.push('touch input and a phone user agent');
  if (state.safeArea) {
    const s = state.safeArea.requested;
    parts.push(
      state.safeArea.applied
        ? `safe-area insets applied (top ${s.top}, right ${s.right}, bottom ${s.bottom}, left ${s.left} px)`
        : `safe-area insets NOT applied (${state.safeArea.note ?? 'unknown reason'})`,
    );
  }
  return parts.join(', ');
}

const ANCHOR_ORDER = ['desktop', 'tablet', 'mobile', 'stress-desktop'];

export function buildLayoutPacket(bundle: Bundle, diags: Diagnostics, opts: PacketOptions = { grouping: 'by-type' }): Packet {
  const index: Record<string, EvidenceIndexEntry> = {};
  const images: PacketImage[] = [];
  const notes: string[] = [];
  const byId = new Map(bundle.states.map((s) => [s.id, s]));

  // ----- States and coverage -----
  const judgedStates: StateRecord[] = bundle.states.filter(
    (s) => ANCHOR_ORDER.includes(s.id) || s.kind === 'interactive',
  );
  judgedStates.sort((a, b) => {
    const ia = ANCHOR_ORDER.indexOf(a.id);
    const ib = ANCHOR_ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const states = judgedStates.map((s) => ({
    state: s.id,
    label: s.label,
    viewport: viewportText(s),
    fixture: s.fixture ?? 'application default content',
    status: s.status === 'collected' ? 'collected' : 'error',
    ...(s.error ? { error: s.error } : {}),
    ...(s.settle && !s.settle.settled ? { note: `Render did not settle within ${s.settle.elapsedMs} ms; captured anyway.` } : {}),
    ...(s.kind === 'interactive'
      ? {
          reached_by:
            s.interactiveStateId === 'auto'
              ? 'found automatically: of the controls tried, this click changed the layout most at this viewport'
              : 'reached by scripted interaction steps declared with the interface',
          interaction: s.interactiveDescription,
        }
      : {}),
    ...(s.stressFill && fillText(s.stressFill) ? { filled: fillText(s.stressFill) } : {}),
    ...(s.supporting ? { checks_only: true } : {}),
    ...(s.steps?.some((st) => st.via === 'dispatch')
      ? { interaction_note: s.steps.filter((st) => st.via === 'dispatch').map((st) => st.note).join(' ') }
      : {}),
  }));
  const coverage = bundle.coverage
    .filter((c) => c.status !== 'collected' && !judgedStates.some((s) => s.id === c.stateId))
    .map((c) => ({ state: c.stateId, label: c.label, status: c.status, reason: c.reason }));
  const fixtureStates = bundle.states.filter((s) => s.kind === 'fixture');
  const sweepCount = bundle.sweep?.stateIds.length ?? 0;

  // ----- Screenshots -----
  const addImage = (state: StateRecord, kind: 'viewport' | 'full' | 'scrolled', caption: string, id?: string) => {
    const shot = state.screenshots.find((s) => s.kind === kind);
    if (!shot) return;
    let detail: 'high' | 'original' = kind === 'full' ? 'original' : 'high';
    if (detail === 'original' && patches(shot.width, shot.height) > MAX_ORIGINAL_PATCHES) {
      detail = 'high';
      notes.push(`${shot.id} is too tall for original-detail input and was sent at reduced resolution.`);
    }
    const imgId = id ?? shot.id;
    images.push({
      id: imgId,
      stateId: state.id,
      kind,
      path: shot.path,
      detail,
      caption,
      width: shot.width,
      height: shot.height,
      scale: shot.scale,
      scrollY: shot.scrollY,
      estimatedTokens: estimateImageTokens(shot.width, shot.height, detail),
    });
    index[imgId] = { type: 'screenshot', stateId: state.id };
  };

  const essential = opts.screenshots === 'essential';
  const findings = opts.evidence === 'findings';
  const hiddenFixedNote = (n: number, findingsWording: boolean) =>
    findingsWording
      ? ` ${n} fixed-position element${n > 1 ? 's are' : ' is'} hidden here; the first-screen screenshot shows ${n > 1 ? 'them' : 'it'} in place.`
      : ` ${n} fixed-position element${n > 1 ? 's are' : ' is'} hidden in this capture; the first-screen screenshot shows ${n > 1 ? 'them' : 'it'} in place.`;
  for (const s of judgedStates) {
    if (s.status !== 'collected' || s.supporting) continue;
    const full = s.screenshots.find((x) => x.kind === 'full');
    const vp = s.screenshots.find((x) => x.kind === 'viewport');
    if (!vp) continue;
    const docH = Math.round((full?.docHeight ?? vp.docHeight) || 0);
    const vpTop = Math.round(vp.scrollY);
    const tall = !!full && s.kind !== 'interactive' && docH > s.viewport.height * 1.05;
    const hidesFixed = !!full?.hiddenFixedElements;
    // Essential set: the full page stands in for the first screen, except on mobile (where the
    // first screen is judged on its own) and when the full capture hides fixed elements.
    // Findings packets drop the phone first screen when its full page shows the same without hiding anything.
    const sendViewport = !essential || !tall || (s.id === 'mobile' && !findings) || hidesFixed;
    if (sendViewport) {
      const scrolled = vpTop > 0 ? `, scrolled ${vpTop} px down the page` : '';
      addImage(
        s,
        'viewport',
        findings
          ? s.kind === 'interactive'
            ? `${stateName(s)} — the screen after the interaction${scrolled}`
            : `${stateName(s)} — first screen at load; the page is ${docH} px tall`
          : `${s.label} — what the user sees ${s.kind === 'interactive' ? 'after the interaction' : 'at load'}${vpTop > 0 ? `, scrolled to y=${vpTop}` : ''} (${s.viewport.width}×${s.viewport.height} viewport; page is ${docH} px tall)`,
      );
    }
    if (tall) {
      const fixedNote = hidesFixed ? hiddenFixedNote(full!.hiddenFixedElements!, findings) : '';
      addImage(
        s,
        'full',
        findings
          ? `${stateName(s)} — full page; the top ${s.viewport.height} px is the first screen.${fixedNote}`
          : `${s.label} — full page (${s.viewport.width}×${docH} CSS px); the top ${s.viewport.height} px is the first screen.${fixedNote}`,
      );
    }
  }

  // Sweep screenshots only at meaningful transitions or failures.
  const transitionWidths: { width: number; reasons: string[] }[] = [];
  for (const t of diags.transitions) {
    const existing = transitionWidths.find((x) => x.width === t.width);
    if (existing) existing.reasons.push(t.reason);
    else transitionWidths.push({ width: t.width, reasons: [t.reason] });
  }
  // Skip widths within 8 px of one already chosen (e.g. both sides of a breakpoint). The
  // essential set keeps only widths where a check starts failing.
  const chosen: typeof transitionWidths = [];
  const limit = essential ? ESSENTIAL_SWEEP_SCREENSHOTS : MAX_TRANSITION_SCREENSHOTS;
  for (const t of transitionWidths) {
    if (chosen.length >= limit) break;
    if (essential && !t.reasons.some((r) => r.endsWith('starts failing'))) continue;
    if (chosen.some((c) => Math.abs(c.width - t.width) <= 8)) continue;
    chosen.push(t);
  }
  if (!essential && transitionWidths.length > chosen.length) {
    notes.push(`${transitionWidths.length} sweep transitions detected; screenshots are provided for the first ${chosen.length} by priority (failure onsets first).`);
  }
  const sweepTransitions = transitionWidths.map((t) => {
    const state = byId.get(`sweep-${t.width}`);
    const included = chosen.includes(t) && state && state.status === 'collected';
    // Findings packets send the full page at that width (when collected), so the failure is in it.
    const sweepFull = findings && !!state?.screenshots.some((s) => s.kind === 'full');
    if (included) {
      addImage(
        state!,
        sweepFull ? 'full' : 'viewport',
        findings
          ? `Width ${t.width} px — ${sweepFull ? `full page; the top ${state!.viewport.height} px is the first screen` : 'first screen'}; ${t.reasons.slice(0, 3).join('; ')} at this width`
          : `Responsive sweep at ${t.width}px wide (first screen, ${state!.viewport.height}px tall window): ${t.reasons.slice(0, 3).join('; ')}`,
        `S-sweep-${t.width}`,
      );
    }
    return { width: t.width, reasons: t.reasons.slice(0, 4), screenshot: included ? `S-sweep-${t.width}` : null };
  }).sort((a, b) => a.width - b.width);

  if (findings) {
    const withShots = new Set(bundle.states.filter((s) => s.status === 'collected' && s.screenshots.length).map((s) => s.id));
    const found = buildFindingsEvidence(bundle, diags, parseLayoutRubric(), new Set(images.map((i) => i.stateId)), index, withShots);
    selectIssueScreenshots(found.criteria, images, bundle, addImage, index);
    assignMarks(found.criteria, images);
    for (const img of images) {
      const labels = [...new Set((img.marks ?? []).map((m) => m.label))];
      if (!labels.length) continue;
      const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : labels[0];
      img.caption = `${img.caption.replace(/\.?$/, '.')} Red outlines mark where automated checks failed: issue${labels.length > 1 ? 's' : ''} ${list}.`;
    }
    const evidence = {
      format: 'findings',
      interface_id: bundle.interfaceId,
      states: found.states,
      screenshots: images.map((i) => ({ id: i.id, state: i.stateId, shows: i.caption })),
      criteria: found.criteria,
      selection_notes: notes,
    };
    return {
      packetVersion: packetVersionFor(opts),
      category: 'layout',
      bundleId: bundle.bundleId,
      caseId: bundle.caseId,
      interfaceId: bundle.interfaceId,
      request: bundle.request,
      evidence,
      images,
      index,
      selectionNotes: notes,
      builtAt: new Date().toISOString(),
    };
  }

  // ----- Diagnostic results -----
  const judgedIds = new Set(judgedStates.map((s) => s.id).concat(['stress-desktop']));
  const perState = diags.results.filter((r) => r.stateId !== null && judgedIds.has(r.stateId));
  const global = diags.results.filter((r) => r.stateId === null);

  const idFor = (r: DiagnosticResult) => `${r.kind === 'deterministic' ? 'C' : 'O'}-${r.diagId}${r.stateId ? `-${r.stateId}` : ''}`;
  const itemIdFor = (r: DiagnosticResult, it: DiagnosticItem) =>
    r.kind === 'deterministic' ? `F-${r.diagId}${r.stateId ? `-${r.stateId}` : ''}-${it.n}` : `${idFor(r)}-${it.n}`;

  const renderResult = (r: DiagnosticResult) => {
    const id = idFor(r);
    index[id] = { type: r.kind === 'deterministic' ? 'check' : 'observation', stateId: r.stateId, resultKey: r.key, status: r.status };
    const max = r.kind === 'deterministic' ? MAX_ITEMS_DETERMINISTIC : MAX_ITEMS_OBSERVATION;
    const shown = r.items.slice(0, max);
    for (const it of shown) {
      index[itemIdFor(r, it)] = { type: r.kind === 'deterministic' ? 'check_item' : 'observation_item', stateId: r.stateId, resultKey: r.key, itemN: it.n };
    }
    const out: Record<string, unknown> = {
      id,
      [r.kind === 'deterministic' ? 'check' : 'observation']: DIAG_NAMES[r.diagId] ?? r.diagId,
      state: r.stateId ?? 'all',
      status: r.status,
      ...(r.reason ? { reason: r.reason } : {}),
      summary: r.summary,
    };
    if (r.evaluated) out.evaluated = r.evaluated;
    if (shown.length) {
      out.items = shown.map((it) => ({
        id: itemIdFor(r, it),
        summary: it.summary,
        ...(it.elements.length ? { elements: it.elements.slice(0, 4).map(compactEl) } : {}),
        data: compactData(it.data),
      }));
    }
    if (r.items.length > shown.length) out.more_items_not_shown = r.items.length - shown.length;
    if (r.secondary.length) {
      out.not_failures = r.secondary.map((s) => ({
        kind: s.kind,
        label: s.label,
        count: s.items.length,
        examples: s.items.slice(0, MAX_SECONDARY_EXAMPLES).map((it) => it.summary),
      }));
    }
    if (r.diagId === 'responsive_layout_failures' || r.diagId === 'content_growth_failures') {
      const data = r.data as { columns: string[]; rows: { name: string; cells: { column: string; status: string; failures: number }[] }[] } | undefined;
      if (data) {
        out.matrix = Object.fromEntries(
          data.rows.map((row) => [
            row.name,
            row.cells.map((c) => (c.status === 'fail' ? `${c.column}: FAIL(${c.failures})` : `${c.column}: ${c.status}`)).join(', '),
          ]),
        );
      }
    }
    return out;
  };

  // Focused rendering: failure items capped with primitive data; observation items all shown,
  // without data (their summaries carry the values); shortened selectors.
  const shortEl = (e: ElementRef) => ({ ...compactEl(e), el: e.selector.split(' > ').slice(-2).join(' > ') });
  const primitives = (data: Record<string, unknown>, omit: string[] = []) =>
    Object.fromEntries(
      Object.entries(data).filter(([k, v]) => !omit.includes(k) && (v === null || ['string', 'number', 'boolean'].includes(typeof v))),
    );
  const focusedItems = (r: DiagnosticResult): DiagnosticItem[] => (r.kind === 'deterministic' ? r.items.slice(0, MAX_ITEMS_DETERMINISTIC) : r.items);
  const renderFocused = (r: DiagnosticResult) => {
    const out = renderResult(r);
    const shown = focusedItems(r);
    const shownIds = new Set(shown.map((it) => itemIdFor(r, it)));
    for (const key of Object.keys(index)) if (index[key].resultKey === r.key && index[key].itemN !== undefined && !shownIds.has(key)) delete index[key];
    for (const it of shown) index[itemIdFor(r, it)] = { type: r.kind === 'deterministic' ? 'check_item' : 'observation_item', stateId: r.stateId, resultKey: r.key, itemN: it.n };
    delete out.items;
    delete out.more_items_not_shown;
    if (shown.length) {
      out.items = shown.map((it) => ({
        id: itemIdFor(r, it),
        summary: it.summary,
        ...(it.elements.length ? { elements: (r.kind === 'deterministic' ? it.elements.slice(0, 3) : it.elements).map(shortEl) } : {}),
        // Matrix items name their check in the summary already.
        ...(r.kind === 'deterministic' ? { data: primitives(it.data, r.stateId === null ? ['check'] : []) } : {}),
      }));
    }
    if (r.items.length > shown.length) out.more_items_not_shown = r.items.length - shown.length;
    return out;
  };
  // Failing results whose items name the same elements with the same measurements are shown
  // once, listing the other states.
  const failureSignature = (r: DiagnosticResult) => JSON.stringify(r.items.map((it) => [it.elements.map((e) => e.selector), primitives(it.data)]));
  const sameFailureGroups = (failing: DiagnosticResult[]) => {
    const groups = new Map<string, DiagnosticResult[]>();
    for (const r of failing) groups.set(failureSignature(r), [...(groups.get(failureSignature(r)) ?? []), r]);
    return [...groups.values()];
  };
  const withSameIn = (out: Record<string, unknown>, rest: DiagnosticResult[]) => {
    for (const r of rest) index[idFor(r)] = { type: 'check', stateId: r.stateId, resultKey: r.key, status: r.status };
    return rest.length ? { ...out, same_in: rest.map((r) => ({ id: idFor(r), state: r.stateId ?? 'all' })) } : out;
  };
  const stateLabel = (id: string | null) => (id ? judgedStates.find((s) => s.id === id)?.label ?? id : 'All states');

  const deterministicOrder = ['region_overlap', 'container_overflow', 'page_horizontal_overflow', 'interactive_reachability', 'collapsed_dimensions', 'occluded_content'];
  const stateOrder = (id: string | null) => {
    const i = ANCHOR_ORDER.indexOf(id ?? '');
    return i < 0 ? 50 : i;
  };
  const deterministicResults = perState
    .filter((r) => r.kind === 'deterministic')
    .sort((a, b) => stateOrder(a.stateId) - stateOrder(b.stateId) || deterministicOrder.indexOf(a.diagId) - deterministicOrder.indexOf(b.diagId));
  const matrixResults = global.filter((r) => r.kind === 'deterministic');
  const observationResults = [...perState.filter((r) => r.kind === 'observation'), ...global.filter((r) => r.kind === 'observation')].sort(
    (a, b) => stateOrder(a.stateId) - stateOrder(b.stateId),
  );

  // Evidence grouped under the criteria it is relevant to, following each criterion's
  // "Relevant Evidence" in the rubric. In full mode a result relevant to several criteria
  // appears under each with the same ID; in focused mode only under its home criterion.
  const byCriterion = () => {
    const rubric = parseLayoutRubric();
    const all = [...deterministicResults, ...matrixResults, ...observationResults];
    return rubric.criteria.map((c) => {
      const wantsShot = screenshotMatcher(c.screenshotsLine);
      const base = {
        criterion: c.id,
        name: c.name,
        rubric_relevant_evidence: { screenshots: c.screenshotsLine, diagnostic_evidence: c.diagnosticLine },
        relevant_screenshots: images.filter((i) => wantsShot(i.stateId)).map((i) => i.id),
      };
      if (opts.evidence !== 'focused') {
        return { ...base, diagnostic_evidence: c.diagIds.flatMap((diagId) => all.filter((r) => r.diagId === diagId).map(renderResult)) };
      }
      const evidenceHere: Record<string, unknown>[] = [];
      const passed: { check: string; states: string[]; all: boolean }[] = [];
      for (const diagId of c.diagIds) {
        if ((DIAGNOSTIC_HOME[diagId] ?? c.id) !== c.id) continue;
        const results = all.filter((r) => r.diagId === diagId && !MISSING_STATUSES.includes(r.status));
        if (!results.length) continue;
        const name = DIAG_NAMES[diagId] ?? diagId;
        if (results[0].kind === 'deterministic') {
          const failing = results.filter((r) => r.status === 'fail');
          const passing = results.filter((r) => r.status === 'pass');
          evidenceHere.push(...sameFailureGroups(failing).map(([first, ...rest]) => withSameIn(renderFocused(first), rest)));
          if (passing.length) passed.push({ check: name, states: passing.map((r) => stateLabel(r.stateId)), all: !failing.length });
        } else {
          evidenceHere.push(...results.map(renderFocused));
        }
      }
      return { ...base, diagnostic_evidence: evidenceHere, passed_checks: passed };
    });
  };

  const focused = opts.evidence === 'focused';
  const common = {
    interface_id: bundle.interfaceId,
    states: focused ? states.filter((s) => s.status === 'collected') : states,
    other_coverage: [
      ...(focused ? [] : coverage),
      {
        state: 'content-growth fixtures',
        status: fixtureStates.length ? 'collected' : 'unavailable',
        detail: fixtureStates.length
          ? `${fixtureStates.length} renders with empty, dense, expanded-string and stress content; failures are in the Content-Growth matrix. Only the Combined Stress state has screenshots.`
          : 'No fixture interface.',
      },
      {
        state: 'responsive sweep',
        status: sweepCount ? 'collected' : 'not_collected',
        detail: sweepCount
          ? `${sweepCount} widths (${bundle.sweep!.widths[0]}–${bundle.sweep!.widths[bundle.sweep!.widths.length - 1]} px); failures are in the Responsive Layout Failures matrix and layout changes are listed as sweep transitions.`
          : '',
      },
    ].filter((c) => !focused || c.status === 'collected'),
    screenshots: images.map((i) => ({ id: i.id, state: i.stateId, shows: i.caption })),
  };
  const selectionNotes = [
    `Deterministic results show at most ${MAX_ITEMS_DETERMINISTIC} failure items and observations at most ${MAX_ITEMS_OBSERVATION} items each; counts of omitted items are given. Full results are retained outside this packet.`,
    'Element boxes are [x, y, width, height] in CSS px, in page coordinates of the named state.',
    ...notes,
  ];
  const evidence =
    opts.grouping === 'by-criterion'
      ? {
          ...common,
          criteria: byCriterion(),
          sweep_transitions: sweepTransitions,
          selection_notes: [
            "Diagnostic evidence is grouped under the criteria it is relevant to, following each criterion's Relevant Evidence in the rubric. A result relevant to several criteria appears under each with the same ID; it is one result, so count the underlying issue once.",
            ...selectionNotes,
          ],
        }
      : {
          ...common,
          deterministic_findings: deterministicResults.map(renderResult),
          failure_matrices: matrixResults.map(renderResult),
          quantitative_observations: observationResults.map(renderResult),
          sweep_transitions: sweepTransitions,
          selection_notes: selectionNotes,
        };

  return {
    packetVersion: packetVersionFor(opts),
    category: 'layout',
    bundleId: bundle.bundleId,
    caseId: bundle.caseId,
    interfaceId: bundle.interfaceId,
    request: bundle.request,
    evidence,
    images,
    index,
    selectionNotes: evidence.selection_notes,
    builtAt: new Date().toISOString(),
  };
}

// At most this many screenshots are added to show issues no other screenshot shows.
const MAX_ISSUE_SCREENSHOTS = 6;

// Findings packets: every failing issue should be visible in a screenshot. For each issue no
// screenshot shows, add the state where it is worst (full page; for content hidden under a
// fixed or sticky layer, the screen scrolled to where it is covered). Sweep screenshots that
// show nothing another screenshot does not are dropped.
function selectIssueScreenshots(
  criteria: FindingsCriterion[],
  images: PacketImage[],
  bundle: Bundle,
  addImage: (state: StateRecord, kind: 'viewport' | 'full' | 'scrolled', caption: string, id?: string) => void,
  index: Record<string, EvidenceIndexEntry>,
): void {
  const byId = new Map(bundle.states.map((s) => [s.id, s]));
  const issues = criteria.flatMap((c) => c.checks.flatMap((b) => b.issues.map((l) => ({ l, diagId: l.ids[0].match(/^F-([a-z_]+)-/)?.[1] ?? '' }))));
  const shown = (l: FindingLine) => images.some((img) => lineVisibleIn(l, img));
  const kindsFor = (diagId: string): ('scrolled' | 'full' | 'viewport')[] => (diagId === 'occluded_content' ? ['scrolled', 'viewport', 'full'] : ['full', 'viewport']);
  let added = 0;
  for (const { l, diagId } of issues) {
    if (added >= MAX_ISSUE_SCREENSHOTS) break;
    if (!l.located || shown(l)) continue;
    const candidates = Object.entries(l.severity ?? {})
      .filter(([sid]) => byId.get(sid)?.status === 'collected')
      .sort((a, b) => b[1] - a[1] || Number(a[0].startsWith('sweep-')) - Number(b[0].startsWith('sweep-')));
    pick: for (const [sid] of candidates) {
      const st = byId.get(sid)!;
      for (const kind of kindsFor(diagId)) {
        const shot = st.screenshots.find((x) => x.kind === kind);
        if (!shot) continue;
        const probe = { kind, scrollY: shot.scrollY, width: shot.width, height: shot.height };
        if (!(l.boxes ?? []).some((b) => b.stateId === sid && boxOnImage(b.rect, probe, b.fixed))) continue;
        const id = `${shot.id}`;
        if (images.some((i) => i.id === id)) continue;
        const name = stateName(st);
        const caption =
          kind === 'full'
            ? `${name} — full page; the top ${st.viewport.height} px is the first screen.${shot.hiddenFixedElements ? ` ${shot.hiddenFixedElements} fixed-position element${shot.hiddenFixedElements > 1 ? 's are' : ' is'} hidden here.` : ''}`
            : kind === 'scrolled'
              ? shot.scrollY >= 1
                ? `${name} — the screen scrolled ${Math.round(shot.scrollY)} px down the page`
                : `${name} — first screen`
              : `${name} — first screen`;
        addImage(st, kind, caption, id);
        added++;
        break pick;
      }
    }
  }
  // Drop sweep screenshots that show no issue, or only issues another screenshot shows.
  for (let i = images.length - 1; i >= 0; i--) {
    const img = images[i];
    if (!img.stateId.startsWith('sweep-')) continue;
    const here = issues.filter(({ l }) => lineVisibleIn(l, img));
    const unique = here.some(({ l }) => !images.some((o) => o !== img && lineVisibleIn(l, o)));
    if (!unique) {
      images.splice(i, 1);
      delete index[img.id];
    }
  }
}
