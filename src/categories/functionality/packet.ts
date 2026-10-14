// The Functionality judge's evidence: the page at load and after the interactions found
// automatically (including the states two clicks deep), the screen after each form was submitted
// filled in, then under each criterion what went wrong when the harness used the controls. Same
// findings shape as Layout's packet, so the same renderer writes the prompt.

import { FUNCTIONALITY_RUBRIC_PATH } from '../../config.ts';
import { hasFunctionalProbes, loadFunctionalProbe, noFunctionalProbes } from '../../collect/probeStore.ts';
import { shownInteractiveStates } from '../../collect/shown.ts';
import { describeSubmission } from '../../diagnostics/functionality/checks.ts';
import { bundleDir } from '../../store.ts';
import type { Bundle, Diagnostics, StateRecord } from '../../types.ts';
import { placeWords, stateLine, stateName, type FindingsCriterion } from '../layout/findings.ts';
import { assignMarks } from '../layout/marks.ts';
import { parseRubric, type ParsedRubric } from '../layout/rubric.ts';
import { EvidenceSet } from '../probe-evidence.ts';
import type { Packet } from '../types.ts';
import { readRubric } from '../versions.ts';

export const FUNCTIONALITY_PACKET_VERSION = 'functionality-packet-v2';

const MAX_ISSUES = 8;
// States reached by two clicks or by applying several choices, shown at desktop.
const MAX_DEEPER_STATES = 2;
const MAX_FORM_SHOTS = 2;

export function parseFunctionalityRubric(raw = readRubric(FUNCTIONALITY_RUBRIC_PATH)): ParsedRubric {
  return parseRubric(raw, 'Functionality', 'functionality_rubric.md');
}

const CHECKS: Record<string, string[]> = {
  A: ['no_effect_controls', 'form_submission', 'navigation_integrity'],
  B: ['control_operability', 'editable_response', 'toggle_state'],
  C: [],
  D: ['invalid_submission', 'runtime_errors'],
};
// Read by Functionality v2 and later: what the page says about its own data, how its validation
// messages are worded, and the behaviour trials (actions a selection makes available, choices,
// saved state across a reload, dialogs).
const ADDED_CHECKS: Record<string, string[]> = {
  A: ['dependent_actions'],
  B: ['choice_effect'],
  C: ['count_claims', 'total_claims', 'sort_claims', 'period_claims', 'opened_detail', 'template_text', 'saved_persistence'],
  D: ['dialog_behaviour'],
};
const ADDED_OBSERVATIONS: Record<string, string[]> = { D: ['validation_wording'] };

// Evidence without the Functionality probe would read as an interface whose controls were never
// used, so it is refused rather than judged.
export function requireFunctionalProbes(bundle: Bundle): void {
  if (!hasFunctionalProbes(bundleDir(bundle.caseId, bundle.bundleId))) throw new Error(`Cannot build the Functionality evidence for ${bundle.caseId}/${bundle.bundleId}. ${noFunctionalProbes(bundle.caseId)}`);
}

export function buildFunctionalityPacket(bundle: Bundle, diags: Diagnostics, opts: { addedChecks?: boolean } = {}): Packet {
  requireFunctionalProbes(bundle);
  const added = !!opts.addedChecks;
  const rubric = parseFunctionalityRubric(readRubric(FUNCTIONALITY_RUBRIC_PATH, added));
  const ev = new EvidenceSet(bundle, diags, rubric);
  const notes: string[] = [];
  const { rank } = placeWords(bundle);
  const collected = (s: StateRecord | undefined): s is StateRecord => !!s && s.status === 'collected';

  // ----- Screenshots -----
  const baselines = ['desktop', 'mobile'].map((id) => bundle.states.find((s) => s.id === id)).filter(collected);
  const shown = shownInteractiveStates(bundle);
  const deeper = bundle.states
    .filter((s) => s.kind === 'interactive' && s.status === 'collected' && s.supporting && s.viewportId === 'desktop' && /^interactive-(steps|choices)-/.test(s.id))
    .slice(0, MAX_DEEPER_STATES);
  const states = [...baselines, ...shown, ...deeper].sort((a, b) => rank(a.id) - rank(b.id));
  for (const s of states) ev.pageShot(s);

  const dir = bundleDir(bundle.caseId, bundle.bundleId);
  const desktopProbe = loadFunctionalProbe(dir, 'desktop');
  const formShots = (desktopProbe?.forms ?? []).filter((f) => f.shot).slice(0, MAX_FORM_SHOTS);
  formShots.forEach((f, i) => {
    ev.addImage({
      id: `S-form-desktop-${i + 1}`,
      stateId: 'desktop',
      kind: 'viewport',
      path: f.shot!.path,
      caption: `Desktop — the screen after a filled-in submission${f.shot!.scrollY > 0 ? `, scrolled ${Math.round(f.shot!.scrollY)} px down the page` : ''}. ${describeSubmission(f)}`,
      width: f.shot!.width,
      height: f.shot!.height,
      scale: 1,
      scrollY: f.shot!.scrollY,
    });
  });

  // ----- Evidence under each criterion -----
  const criteria: FindingsCriterion[] = rubric.criteria.map((c) => ({
    criterion: c.id,
    name: c.name,
    checks: [...(CHECKS[c.id] ?? []), ...((added && ADDED_CHECKS[c.id]) || [])].map((id) => ev.checkBlock(id, MAX_ISSUES)).filter((b): b is NonNullable<typeof b> => b !== null),
    observations: ((added && ADDED_OBSERVATIONS[c.id]) || [])
      .map((id) => ev.observationBlock(id, ev.observed(id, (it) => !!it.data.flagged), MAX_ISSUES))
      .filter((b): b is NonNullable<typeof b> => b !== null),
  }));
  const pages = ev.images.filter((i) => !i.id.startsWith('S-form-'));
  assignMarks(criteria, pages);
  for (const img of pages) {
    const labels = [...new Set((img.marks ?? []).map((m) => m.label))];
    if (labels.length) img.caption = `${img.caption.replace(/\.?$/, '.')} Red outlines mark where automated checks failed: issue${labels.length > 1 ? 's' : ''} ${labels.join(', ')}.`;
  }

  const missing = baselines.filter((s) => ['unavailable', 'error'].includes(ev.find('no_effect_controls', s.id)?.status ?? 'unavailable'));
  if (missing.length) notes.push(`The controls were not used at ${missing.map((s) => stateName(s)).join(' and ')}: ${ev.find('no_effect_controls', missing[0].id)?.reason ?? 'not collected'}`);
  if (desktopProbe && !desktopProbe.forms.length) notes.push('The page has no form, so no submission was tried.');
  if (desktopProbe && desktopProbe.limits.probed < desktopProbe.controls.length) notes.push(`Only the first ${desktopProbe.limits.probed} groups of controls were used.`);

  const evidence = {
    format: 'findings',
    interface_id: bundle.interfaceId,
    states: states.map(stateLine),
    screenshots: ev.images.map((i) => ({ id: i.id, state: i.stateId, shows: i.caption })),
    criteria,
    selection_notes: notes,
  };
  return {
    packetVersion: FUNCTIONALITY_PACKET_VERSION + (added ? '+added-checks' : ''),
    category: 'functionality',
    bundleId: bundle.bundleId,
    caseId: bundle.caseId,
    interfaceId: bundle.interfaceId,
    request: bundle.request,
    evidence,
    images: ev.images,
    index: ev.index,
    selectionNotes: notes,
    builtAt: new Date().toISOString(),
  };
}
