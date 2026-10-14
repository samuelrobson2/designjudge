// The Typography judge's evidence: states, screenshots and a type specimen sheet per baseline
// state, then under each criterion what Invalid Text Rendering found and the typography
// measurements, in plain words. Same findings shape as Layout's packet, so the same renderer
// writes the prompt.

import { DIAG_NAMES } from '../../diagnostics/run.ts';
import { Doc } from '../../diagnostics/doc.ts';
import { textElements } from '../../diagnostics/typography/text.ts';
import { shownInteractiveStates } from '../../collect/shown.ts';
import { loadSnapshot } from '../../store.ts';
import type { Bundle, DiagnosticItem, DiagnosticResult, Diagnostics, StateRecord } from '../../types.ts';
import type { EvidenceIndexEntry, Packet, PacketImage } from '../types.ts';
import { placeWords, stateLine, stateName, type CheckBlock, type FindingLine, type FindingsCriterion, type ObservationBlock } from '../layout/findings.ts';
import { assignMarks } from '../layout/marks.ts';
import { estimateImageTokens } from '../layout/packet.ts';
import { parseRubric, type ParsedRubric } from '../layout/rubric.ts';
import { buildSpecimen } from './specimen.ts';
import { TYPOGRAPHY_RUBRIC_PATH } from '../../config.ts';
import { readRubric } from '../versions.ts';

export const TYPOGRAPHY_PACKET_VERSION = 'typography-packet-v4';

const ANCHORS = ['desktop', 'tablet', 'mobile', 'stress-desktop'];
// Only values outside or near the rubric reference are listed. Page-wide counts (sizes, styles,
// families, weights) are taken from these states, which also get specimen sheets; values about
// particular text (small text, tight lines, unbalanced headings) from every anchor state.
const PROFILE_STATES = ['desktop', 'mobile'];
const MAX_ISSUES = 8;
const MAX_LINES = 12;
const MAX_ORIGINAL_PATCHES = 30_000;

export function parseTypographyRubric(raw = readRubric(TYPOGRAPHY_RUBRIC_PATH)): ParsedRubric {
  return parseRubric(raw, 'Typography', 'typography_rubric.md');
}

const SHORT: Record<string, string> = { desktop: 'desktop', tablet: 'tablet', mobile: 'phone', 'stress-desktop': 'stress' };

// With the added checks (Typography v2 and later), Squeezed Text Wrapping under B, from the states
// with the interface's own text (lengthened stress text is expected to wrap).
export function buildTypographyPacket(bundle: Bundle, diags: Diagnostics, opts: { addedChecks?: boolean } = {}): Packet {
  const added = !!opts.addedChecks;
  const rubric = parseTypographyRubric(readRubric(TYPOGRAPHY_RUBRIC_PATH, added));
  const index: Record<string, EvidenceIndexEntry> = {};
  const images: PacketImage[] = [];
  const notes: string[] = [];
  const byId = new Map(bundle.states.map((s) => [s.id, s]));
  const collected = (id: string) => byId.get(id)?.status === 'collected';
  const results = diags.results.filter((r) => r.stateId === null || collected(r.stateId));
  const find = (diagId: string, stateId: string | null) => results.find((r) => r.diagId === diagId && r.stateId === stateId);

  // ----- Screenshots -----
  const addShot = (s: StateRecord, kind: 'viewport' | 'full', caption: string, id?: string) => {
    const shot = s.screenshots.find((x) => x.kind === kind);
    if (!shot) return;
    const detail = kind === 'full' && Math.ceil(shot.width / 32) * Math.ceil(shot.height / 32) <= MAX_ORIGINAL_PATCHES ? 'original' : 'high';
    const imgId = id ?? shot.id;
    images.push({ id: imgId, stateId: s.id, kind, path: shot.path, detail, caption, width: shot.width, height: shot.height, scale: shot.scale, scrollY: shot.scrollY, estimatedTokens: estimateImageTokens(shot.width, shot.height, detail) });
    index[imgId] = { type: 'screenshot', stateId: s.id };
  };
  // The same screenshots and captions as Layout's essential set.
  const pageShot = (s: StateRecord) => {
    const full = s.screenshots.find((x) => x.kind === 'full');
    const vp = s.screenshots.find((x) => x.kind === 'viewport');
    if (!vp) return;
    const docH = Math.round((full?.docHeight ?? vp.docHeight) || 0);
    const tall = !!full && s.kind !== 'interactive' && docH > s.viewport.height * 1.05;
    const n = full?.hiddenFixedElements ?? 0;
    if (!tall || n) {
      const scrolled = vp.scrollY > 0 ? `, scrolled ${Math.round(vp.scrollY)} px down the page` : '';
      addShot(s, 'viewport', s.kind === 'interactive' ? `${stateName(s)} — the screen after the interaction${scrolled}` : `${stateName(s)} — first screen at load; the page is ${docH} px tall`);
    }
    if (tall) {
      const fixedNote = n ? ` ${n} fixed-position element${n > 1 ? 's are' : ' is'} hidden here; the first-screen screenshot shows ${n > 1 ? 'them' : 'it'} in place.` : '';
      addShot(s, 'full', `${stateName(s)} — full page; the top ${s.viewport.height} px is the first screen.${fixedNote}`);
    }
  };

  // Specimen sheets for the baseline desktop and phone states.
  const docs = new Map<string, Doc>();
  const docOf = (id: string) => {
    if (!docs.has(id)) {
      const s = byId.get(id);
      const snap = s && s.status === 'collected' ? loadSnapshot(bundle, s) : null;
      if (snap) docs.set(id, new Doc(snap));
    }
    return docs.get(id);
  };
  for (const id of PROFILE_STATES) {
    const s = byId.get(id);
    const doc = docOf(id);
    if (!s || !doc || !doc.els.some((e) => e.type)) continue;
    const spec = buildSpecimen(s, doc, textElements(doc).items, `S-type-specimen-${id}`);
    if (!spec) continue;
    const more = spec.styles > spec.shown ? ` ${spec.shown} of ${spec.styles} styles shown, largest first.` : '';
    spec.image.caption = `Type specimen, ${stateName(s)}: each row is one distinct text style (font, size, weight), with a real example cropped from the page beside its measured values and the roles that use it.${more}`;
    spec.image.estimatedTokens = estimateImageTokens(spec.image.width, spec.image.height, 'original');
    images.push(spec.image);
    index[spec.image.id] = { type: 'screenshot', stateId: id };
  }
  const judged = ANCHORS.map((id) => byId.get(id)).filter((s): s is StateRecord => !!s && s.status === 'collected' && !s.supporting);
  for (const s of judged) pageShot(s);
  for (const s of shownInteractiveStates(bundle)) pageShot(s);

  const sweepIds = bundle.sweep?.stateIds ?? [];

  // ----- Evidence lines -----
  const resultId = (r: DiagnosticResult) => `${r.kind === 'deterministic' ? 'C' : 'O'}-${r.diagId}${r.stateId ? `-${r.stateId}` : ''}`;
  const itemId = (r: DiagnosticResult, it: DiagnosticItem) => (r.kind === 'deterministic' ? `F-${r.diagId}${r.stateId ? `-${r.stateId}` : ''}-${it.n}` : `${resultId(r)}-${it.n}`);
  const registerResult = (r: DiagnosticResult) => {
    index[resultId(r)] = { type: r.kind === 'deterministic' ? 'check' : 'observation', stateId: r.stateId, resultKey: r.key, status: r.status };
    return resultId(r);
  };
  const registerItem = (r: DiagnosticResult, it: DiagnosticItem) => {
    registerResult(r);
    index[itemId(r, it)] = { type: r.kind === 'deterministic' ? 'check_item' : 'observation_item', stateId: r.stateId, resultKey: r.key, itemN: it.n };
    return itemId(r, it);
  };
  const { where } = placeWords(bundle);

  // Lines with the same text in several states are one line listing those states. Values about
  // one element name the page screenshots it is visible in; values about a whole state name
  // that state's page screenshots. Either way the state's specimen sheet shows its styles.
  type Entry = { r: DiagnosticResult; it?: DiagnosticItem; text: string };
  const merged = (entries: Entry[], max = MAX_LINES): FindingLine[] => {
    const groups = new Map<string, Entry[]>();
    for (const e of entries) groups.set(e.text, [...(groups.get(e.text) ?? []), e]);
    return [...groups.values()].slice(0, max).map((g) => {
      const boxes = g.flatMap((e) => (e.it && e.r.stateId ? e.it.elements.slice(0, 1).filter((el) => el.rect?.w > 0 && el.rect?.h > 0).map((el) => ({ stateId: e.r.stateId!, rect: el.rect, ...(el.fixed ? { fixed: true } : {}) })) : []));
      const stateIds = new Set(g.map((e) => e.r.stateId).filter((id): id is string => id !== null));
      const wholeState = new Set(g.filter((e) => !e.it?.elements.length).map((e) => e.r.stateId));
      const shots = images.filter((img) => stateIds.has(img.stateId) && (img.composed || wholeState.has(img.stateId))).map((img) => img.id);
      return {
        ids: g.map((e) => (e.it ? registerItem(e.r, e.it) : registerResult(e.r))),
        text: g[0].text,
        where: where(g.map((e) => e.r.stateId)),
        ...(boxes.length ? { boxes } : {}),
        ...(shots.length ? { shots } : {}),
        located: g.some((e) => e.r.stateId !== null),
      };
    });
  };
  const observed = (diagId: string, states: string[]) => states.map((id) => find(diagId, id)).filter((r): r is DiagnosticResult => r?.status === 'observed');
  const itemsOf = (diagId: string, states: string[], kinds: string[]): Entry[] =>
    // Ordered by kind before state, so page-wide counts come first and survive the line cap.
    observed(diagId, states)
      .flatMap((r) => r.items.filter((it) => kinds.includes(String(it.data.kind))).map((it) => ({ r, it, text: sentence(it.summary) })))
      .sort((a, b) => kinds.indexOf(String(a.it.data.kind)) - kinds.indexOf(String(b.it.data.kind)));
  const block = (diagId: string, lines: FindingLine[]): ObservationBlock | null => {
    if (!lines.length) return null;
    const def = rubric.diagnostics.find((d) => d.diagId === diagId);
    return { observation: DIAG_NAMES[diagId], measures: def?.measures ?? '', reference: def?.reference ?? '', lines };
  };

  const A: ObservationBlock[] = [];
  const B: ObservationBlock[] = [];
  const C: ObservationBlock[] = [];
  const D: ObservationBlock[] = [];
  const push = (list: ObservationBlock[], b: ObservationBlock | null) => b && list.push(b);

  // A: inversions of the heading order.
  push(A, block('size_weight_profile', merged(itemsOf('size_weight_profile', ANCHORS, ['inversion', 'heading_like_body']))));

  // B: small or light text, tight or loose leading, unbalanced heading wraps.
  push(B, block('size_weight_profile', merged(itemsOf('size_weight_profile', ANCHORS, ['small', 'light_small']))));
  push(B, block('line_height', merged(itemsOf('line_height', ANCHORS, ['tight_multiline', 'loose_heading', 'wide_measure']))));
  push(B, block('heading_line_balance', merged(observed('heading_line_balance', ANCHORS).flatMap((r) => r.items.filter((it) => it.data.imbalanced).map((it) => ({ r, it, text: sentence(it.summary) }))))));
  if (added) push(B, block('squeezed_wrapping', merged(itemsOf('squeezed_wrapping', ['desktop', 'tablet', 'mobile'], ['squeezed']))));

  // C: more sizes, styles, families or weights than the reference, and roles that vary.
  push(C, block('type_scale', merged(itemsOf('type_scale', PROFILE_STATES, ['size_count', 'style_count', 'near_duplicate', 'role_sizes']))));
  push(C, block('font_families', merged(itemsOf('font_families', PROFILE_STATES, ['family_count', 'isolated', 'fallback']))));
  push(C, block('size_weight_profile', merged(itemsOf('size_weight_profile', PROFILE_STATES, ['weight_count', 'near_duplicate_weights', 'role_weights']))));

  // D: text that shrinks below 12 px, or headings that lose their size, at some widths.
  const resp = find('responsive_typography', null);
  if (resp?.status === 'observed') {
    const flagged = resp.items.filter((it) => it.data.kind === 'shrinks_below_12' || (it.data.kind === 'hierarchy' && it.data.flagged));
    push(D, block('responsive_typography', merged(flagged.map((it) => ({ r: resp, it, text: sentence(it.summary) })))));
  }

  // Invalid Text Rendering failures, merged across states by element and problem.
  const failing = results.filter((r) => r.diagId === 'invalid_text_rendering' && r.status === 'fail');
  const checks: CheckBlock[] = [];
  if (failing.length) {
    const issues = merged(
      failing.flatMap((r) => r.items.map((it) => ({ r, it, text: sentence(it.summary) }))),
      MAX_ISSUES,
    );
    const total = new Set(failing.flatMap((r) => r.items.map((it) => it.summary))).size;
    checks.push({
      check: DIAG_NAMES.invalid_text_rendering,
      detects: rubric.diagnostics.find((d) => d.diagId === 'invalid_text_rendering')?.measures ?? '',
      issues,
      ...(total > issues.length ? { more_issues: total - issues.length } : {}),
      not_counted: [],
    });
  }

  const criteria: FindingsCriterion[] = rubric.criteria.map((c) => ({
    criterion: c.id,
    name: c.name,
    checks: c.id === 'B' ? checks : [],
    observations: { A, B, C, D }[c.id as 'A' | 'B' | 'C' | 'D'] ?? [],
  }));

  // Red outlines for failed checks go on page screenshots only, not on the specimen sheets.
  assignMarks(criteria, images.filter((i) => !i.composed));
  for (const img of images) {
    const labels = [...new Set((img.marks ?? []).map((m) => m.label))];
    if (labels.length) img.caption = `${img.caption.replace(/\.?$/, '.')} Red outlines mark where automated checks failed: issue${labels.length > 1 ? 's' : ''} ${labels.join(', ')}.`;
  }

  const missing = ['desktop', 'mobile'].filter((id) => ['unavailable', 'error', 'not_collected'].includes(find('type_scale', id)?.status ?? 'not_collected'));
  if (missing.length) notes.push(`Typography measurements are missing for ${missing.map((id) => SHORT[id]).join(' and ')}: ${find('type_scale', missing[0])?.reason ?? 'not collected'}`);
  notes.push(
    'Text roles in the measurements are inferred from markup and rendering: headings by their h1–h6 tag or heading role, body text from paragraphs, list items and text that wraps or runs long, labels from label, legend, th and dt, control text from buttons, links and tabs, values from numbers, prices and dates, supporting text from other short text smaller than body text. Large text that is not a heading is reported as such.',
    'Screenshots and specimen crops are at 1 image pixel per CSS pixel. Phones draw text at two or three times this sharpness, so judge size from the measured px values rather than from how soft small text looks in a phone screenshot.',
  );

  const shotStates = new Set(images.map((i) => i.stateId));
  const states = bundle.states
    .filter((s) => s.status === 'collected' && (shotStates.has(s.id) || ANCHORS.includes(s.id)))
    .sort((a, b) => rank(a) - rank(b))
    .map(stateLine);
  const sweepCount = sweepIds.length;
  if (sweepCount) states.push({ state: 'sweep', text: `Responsive sweep: ${sweepCount} widths from ${bundle.sweep!.widths[0]} to ${bundle.sweep!.widths.at(-1)} px, measured for how text changes across widths`, pseudo: false });

  const evidence = {
    format: 'findings',
    interface_id: bundle.interfaceId,
    states,
    screenshots: images.map((i) => ({ id: i.id, state: i.stateId, shows: i.caption })),
    criteria,
    selection_notes: notes,
  };
  return {
    packetVersion: TYPOGRAPHY_PACKET_VERSION + (added ? '+added-checks' : ''),
    category: 'typography',
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

function rank(s: StateRecord): number {
  const a = ANCHORS.indexOf(s.id);
  if (a >= 0) return a;
  if (s.kind === 'interactive') return 10;
  if (s.kind === 'sweep') return 1000 + s.viewport.width;
  return 500;
}

function sentence(s: string): string {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
