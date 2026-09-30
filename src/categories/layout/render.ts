// Renders the judge-facing prompt for text-rendered prompt versions (v3+): a fixed system
// prompt, and a user message that reads in order — task, states, screenshots, then each
// criterion with its evidence placed directly beneath it.

import type { Packet, PacketImage } from '../types.ts';
import type { CheckBlock, FindingLine, FindingsCriterion, FindingsState, ObservationBlock } from './findings.ts';
import { lineVisibleIn } from './marks.ts';
import { rubricStateName, type ParsedRubric } from './rubric.ts';

// Bump when rendering changes, so the prompt hash changes with it.
export const RENDER_VERSION = 'render-v4';
// The same for findings packets (prompt v4 onwards).
export const FINDINGS_RENDER_VERSION = 'findings-render-v5';

export type UserPart = { type: 'text'; text: string } | { type: 'image'; id: string };

interface EvItem {
  id: string;
  summary: string;
  elements?: { el: string; name?: string; component?: string; box: number[] }[];
  data?: Record<string, unknown>;
}

interface EvResult {
  id: string;
  check?: string;
  observation?: string;
  state: string;
  status: string;
  reason?: string;
  summary: string;
  evaluated?: number;
  items?: EvItem[];
  more_items_not_shown?: number;
  not_failures?: { kind: string; label: string; count: number; examples: string[] }[];
  matrix?: Record<string, string>;
  // Other states with the same failure (same elements and measurements).
  same_in?: { id: string; state: string }[];
}

interface EvCriterion {
  criterion: string;
  name: string;
  relevant_screenshots: string[];
  diagnostic_evidence: EvResult[];
  // Focused packets only.
  passed_checks?: { check: string; states: string[]; all: boolean }[];
}

interface EvState {
  state: string;
  label: string;
  viewport: string;
  fixture: string;
  status: string;
  error?: string;
  note?: string;
  interaction?: string;
  reached_by?: string;
  interaction_note?: string;
  filled?: string;
  checks_only?: boolean;
}

const STATUS: Record<string, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  observed: 'OBSERVED',
  not_collected: 'NOT COLLECTED',
  unavailable: 'UNAVAILABLE',
  error: 'ERROR',
};

const PSEUDO_NOTE =
  'Text in this state is pseudo-localized on purpose (accented letters, about 40% longer, wrapped in [brackets]) to simulate translated strings. Judge how the layout handles the longer text; the altered wording is not a defect.';

// What each kind of state is for, keyed by the rubric's state names.
const STATE_PURPOSE: Record<string, string> = {
  'Baseline Desktop': 'The default state at a desktop viewport, with realistic content and normal-length strings.',
  'Baseline Tablet': 'The same content and state at the most common tablet size, in portrait.',
  'Baseline Mobile': 'The same content and state at the narrowest common phone width.',
  'Combined Stress': 'The desktop viewport with dense content, longer pseudo-localized strings, and form controls filled in where possible.',
  'Representative Interactive States': 'A task-critical state reached by interacting with the interface, such as validation shown, a filter applied, or a panel opened.',
  'Responsive Sweep': 'The baseline content at many widths from phone to desktop; screenshots are included only where a check starts failing.',
  RTL: 'Right-to-left layout, needed only when the request requires it.',
};

// Selection notes already explained in the system prompt or shown inline.
const NOTES_COVERED = [/^Diagnostic evidence is grouped/, /^Deterministic results show at most/, /^Element boxes are/, /sweep transitions detected; screenshots are provided/];

function value(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function matrixLines(matrix: Record<string, string>): string[] {
  const rows = Object.entries(matrix);
  const clean = rows.filter(([, text]) => text.split(', ').every((c) => c.endsWith(': pass'))).map(([name]) => name);
  const lines = rows.filter(([name]) => !clean.includes(name)).map(([name, text]) => {
    const cells = text.split(', ').map((c) => {
      const i = c.indexOf(': ');
      return { column: c.slice(0, i), status: c.slice(i + 2) };
    });
    const fails = cells.filter((c) => c.status.startsWith('FAIL'));
    const other = cells.filter((c) => c.status !== 'pass' && !c.status.startsWith('FAIL'));
    const count = (c: { status: string }) => Number(c.status.match(/\((\d+)\)/)?.[1] ?? 1);
    const counts = new Set(fails.map(count));
    const failText =
      counts.size === 1
        ? `${fails.map((c) => c.column).join(', ')} (${[...counts][0]} failure${[...counts][0] === 1 ? '' : 's'} each)`
        : fails.map((c) => `${c.column} (${count(c)} failure${count(c) === 1 ? '' : 's'})`).join(', ');
    const parts = [
      fails.length ? `FAIL at ${failText}` : 'no failures',
      other.length ? `${other.map((c) => `${c.column}: ${c.status.replace(/_/g, ' ')}`).join(', ')}` : null,
      `PASS in the other ${cells.length - fails.length - other.length} of ${cells.length}`,
    ].filter(Boolean);
    return `    ${name}: ${parts.join('; ')}`;
  });
  if (clean.length) lines.push(`    No failures anywhere: ${clean.join(', ')}.`);
  return lines;
}

function itemLines(it: EvItem): string[] {
  const lines = [`    - [${it.id}] ${it.summary}`];
  if (it.elements?.length) {
    lines.push(
      `      Elements: ${it.elements.map((e) => `${e.el}${e.name ? ` "${e.name}"` : ''}${e.component ? ` (component ${e.component})` : ''} at [${e.box.join(', ')}]`).join('; ')}`,
    );
  }
  const data = Object.entries(it.data ?? {});
  if (data.length) lines.push(`      Data: ${data.map(([k, v]) => `${k}=${value(v)}`).join('; ')}`);
  return lines;
}

function resultLines(r: EvResult, stateLabel: (id: string) => string): string[] {
  const where = r.state === 'all' ? 'All states' : stateLabel(r.state);
  const lines = [`  - ${where} — ${STATUS[r.status] ?? r.status.toUpperCase()} [${r.id}]: ${r.summary}${r.evaluated && r.evaluated > 1 ? ` (${r.evaluated} evaluated)` : ''}`];
  if (r.reason && r.reason !== r.summary) lines.push(`    Reason: ${r.reason}`);
  if (r.matrix) lines.push(...matrixLines(r.matrix));
  for (const it of r.items ?? []) lines.push(...itemLines(it));
  if (r.more_items_not_shown) lines.push(`    (${r.more_items_not_shown} further items exist but are not included here.)`);
  for (const nf of r.not_failures ?? []) {
    lines.push(`    Context, not failures — ${nf.label}: ${nf.count}. Examples: ${nf.examples.join(' | ')}`);
  }
  if (r.same_in?.length) lines.push(`    Same failure, same elements and measurements, also in: ${sameIn(r, stateLabel)}.`);
  return lines;
}

function sameIn(r: EvResult, stateLabel: (id: string) => string): string {
  return (r.same_in ?? []).map((s) => `${stateLabel(s.state)} [${s.id}]`).join(', ');
}

export function renderCriterion(c: EvCriterion, rubric: ParsedRubric, stateLabel: (id: string) => string): string {
  const def = rubric.criteria.find((x) => x.id === c.criterion)!;
  const byDiag = new Map<string, EvResult[]>();
  for (const r of c.diagnostic_evidence) {
    const name = (r.check ?? r.observation)!;
    byDiag.set(name, [...(byDiag.get(name) ?? []), r]);
  }
  const diagDef = (name: string) => rubric.diagnostics.find((d) => d.name === name);
  const passedFor = new Map((c.passed_checks ?? []).map((p) => [p.check, p]));
  const block = (kind: 'deterministic' | 'observation') =>
    [...byDiag.entries()]
      .filter(([name]) => diagDef(name)?.kind === kind)
      .flatMap(([name, results]) => {
        const d = diagDef(name)!;
        const head =
          kind === 'deterministic'
            ? `${name}${d.measures ? ` — detects ${d.measures}` : ''}. PASS means: ${d.pass}`
            : `${name} — Reference: ${d.reference}`;
        const passes = passedFor.get(name);
        return ['', head, ...results.flatMap((r) => resultLines(r, stateLabel)), ...(passes ? [`  - PASS in: ${passes.states.join(', ')}`] : [])];
      });
  const deterministic = block('deterministic');
  const shownHere = new Set(byDiag.keys());
  const allPassed = (c.passed_checks ?? []).filter((p) => p.all && !shownHere.has(p.check));
  const partlyPassed = (c.passed_checks ?? []).filter((p) => !p.all && !shownHere.has(p.check));
  if (allPassed.length) deterministic.push('', `PASS in every captured state: ${allPassed.map((p) => p.check).join(', ')}.`);
  for (const p of partlyPassed) deterministic.push('', `${p.check}: PASS in ${p.states.join(', ')}.`);
  const observations = block('observation');

  return [
    `<criterion id="${c.criterion}" name="${c.name}">`,
    '<rubric_criterion>',
    `Criterion ${c.criterion} — ${c.name}: ${def.statement}`,
    '',
    'Evaluation points (assess every one that applies):',
    ...def.points.map((p) => `- ${p.name}: ${p.definition}`),
    '</rubric_criterion>',
    '',
    '<evidence>',
    `Relevant screenshots: ${c.relevant_screenshots.join(', ') || 'none'} (any other screenshot may also be used).`,
    ...(deterministic.length ? ['', 'Deterministic findings (objective PASS/FAIL results):', ...deterministic] : []),
    ...(observations.length
      ? ['', 'Quantitative observations (compare each value with its reference and judge it in context; a value outside the reference is not automatically a weakness):', ...observations]
      : []),
    '</evidence>',
    '</criterion>',
  ].join('\n');
}

export function renderStates(evidence: Record<string, any>, rubric: ParsedRubric): string {
  const states = (evidence.states ?? []) as EvState[];
  const lines: string[] = [];
  const described = new Set<string>();
  // Each kind of state is described once, at its first state.
  const definitionLine = (rubricName: string | null) => {
    if (!rubricName || !STATE_PURPOSE[rubricName] || described.has(rubricName)) return null;
    described.add(rubricName);
    return `  ${rubricName}: ${STATE_PURPOSE[rubricName]}`;
  };
  for (const s of states) {
    const status = s.status === 'collected' ? 'collected' : `${s.status}${s.error ? ` (${s.error})` : ''}`;
    lines.push(`- ${s.state} — ${s.label} (${status})`);
    const def = definitionLine(rubricStateName(s.state));
    if (def) lines.push(def);
    lines.push(`  Captured at ${s.viewport}; content fixture: ${s.fixture}.`);
    if (s.interaction) lines.push(`  This state: ${s.interaction} (${s.reached_by ?? 'reached by scripted interaction steps'}).`);
    if (s.interaction_note) lines.push(`  Note: ${s.interaction_note}`);
    if (s.note) lines.push(`  Note: ${s.note}`);
    if (s.fixture === 'stress' || s.fixture === 'expanded') lines.push(`  ${PSEUDO_NOTE}`);
    if (s.filled) lines.push(`  ${s.filled}`);
    if (s.checks_only) lines.push('  No screenshot of this state is included; its check results appear under the criteria.');
  }
  const other = (evidence.other_coverage ?? []) as { state: string; label?: string; status: string; reason?: string; detail?: string }[];
  if (other.length) {
    lines.push('', 'Other coverage:');
    for (const c of other) {
      lines.push(`- ${c.label ? `${c.label} (${c.state})` : c.state} — ${c.status.replace(/_/g, ' ')}: ${c.reason ?? c.detail ?? ''}`);
      const def = definitionLine(rubricStateName(c.state));
      if (def) lines.push(def);
    }
  }
  const transitions = (evidence.sweep_transitions ?? []) as { width: number; reasons: string[]; screenshot: string | null }[];
  if (transitions.length) {
    lines.push('', 'Meaningful transitions found in the responsive sweep:');
    for (const t of transitions) lines.push(`- ${t.width}px: ${t.reasons.join('; ')}${t.screenshot ? ` (screenshot ${t.screenshot})` : ' (no screenshot sent)'}`);
  }
  return lines.join('\n');
}

// ---------- Findings packets ----------

// Each check issue is a numbered block; the number matches its red outline on the screenshots.
// Only the first ID is shown: it is the one to cite (the others are the same issue in other
// states and stay in the packet index).
function issueBlock(l: FindingLine): string[] {
  const shots = l.marked_in?.length ? `red outline ${l.marker} in ${l.marked_in.join(', ')}` : 'none show it';
  return [
    `  Issue ${l.marker ?? '?'} (cite ${l.ids[0]})`,
    `    What was found: ${l.text}`,
    `    Where: ${l.where}.`,
    `    Screenshots: ${shots}.`,
  ];
}

function checkLines(b: CheckBlock): string[] {
  return [
    '',
    `Check: ${b.check}. It looks for ${b.detects}.`,
    ...b.issues.flatMap(issueBlock),
    ...b.not_counted.map((n) => `  Not counted (the check deliberately excludes these): ${n}`),
    ...(b.more_issues ? [`  (${b.more_issues} further issue${b.more_issues > 1 ? 's' : ''} of this check are not listed.)`] : []),
  ];
}

function observationLines(b: ObservationBlock): string[] {
  return [
    '',
    `Measurement: ${b.observation}. It measures ${b.measures}.`,
    `  Rubric reference: ${b.reference}`,
    ...b.lines.map((l) => `  - (cite ${l.ids[0]}) ${l.text} Where: ${l.where}.`),
  ];
}

// The same layout as a check issue: one block per value, with what, where and which screenshots show it.
function measuredValueBlock(l: FindingLine, images: PacketImage[]): string[] {
  const inShots = images.filter((img) => lineVisibleIn(l, img)).map((img) => img.id);
  const shots = inShots.length ? inShots.join(', ') : l.located ? 'none show it' : 'none; it is measured across widths';
  return [`  Value (cite ${l.ids[0]})`, `    What was measured: ${l.text}`, `    Where: ${l.where}.`, `    Screenshots: ${shots}.`];
}

function observationBlockLines(b: ObservationBlock, images: PacketImage[]): string[] {
  return ['', `Measurement: ${b.observation}. It measures ${b.measures}.`, `  Rubric reference: ${b.reference}`, ...b.lines.flatMap((l) => measuredValueBlock(l, images))];
}

export interface FindingsRenderOptions {
  // Measurements as blocks shaped like check issues; needs the packet's images.
  measurementBlocks?: { images: PacketImage[] };
}

export function renderFindingsCriterion(c: FindingsCriterion, rubric: ParsedRubric, opts: FindingsRenderOptions = {}): string {
  const def = rubric.criteria.find((x) => x.id === c.criterion)!;
  const checks = c.checks.flatMap(checkLines);
  const blocks = opts.measurementBlocks;
  const observations = c.observations.flatMap((b) => (blocks ? observationBlockLines(b, blocks.images) : observationLines(b)));
  return [
    `<criterion id="${c.criterion}" name="${c.name}">`,
    '<rubric_criterion>',
    `Criterion ${c.criterion} — ${c.name}: ${def.statement}`,
    '',
    'Evaluation points (assess every one that applies):',
    ...def.points.map((p) => `- ${p.name}: ${p.definition}`),
    '</rubric_criterion>',
    '',
    '<evidence>',
    checks.length
      ? 'Automated checks that failed for this criterion (objective problems found by code):'
      : 'Automated checks: none failed for this criterion.',
    ...checks,
    '',
    observations.length
      ? 'Measurements outside or near the rubric reference (values for you to weigh; they are not failures):'
      : 'Measurements: all within the rubric reference for this criterion.',
    ...observations,
    '</evidence>',
    '</criterion>',
  ].join('\n');
}

export function renderFindingsStates(states: FindingsState[]): string {
  let pseudoNoted = false;
  return states
    .flatMap((s) => {
      const out = [`- ${s.text} (${s.state})`];
      if (s.pseudo && !pseudoNoted) {
        out.push(`  ${PSEUDO_NOTE}`);
        pseudoNoted = true;
      }
      return out;
    })
    .join('\n');
}

export function renderUserParts(
  template: string,
  packet: Packet,
  rubric: ParsedRubric,
  opts: { measurementBlocks?: boolean } = {},
): { parts: UserPart[]; text: string } {
  const evidence = packet.evidence as Record<string, any>;
  const findings = evidence.format === 'findings';
  const labels = new Map<string, string>(((evidence.states ?? []) as EvState[]).map((s) => [s.state, s.label]));
  const stateLabel = (id: string) => labels.get(id) ?? id;
  const findingsOpts: FindingsRenderOptions = opts.measurementBlocks ? { measurementBlocks: { images: packet.images } } : {};
  const criteria = findings
    ? ((evidence.criteria ?? []) as FindingsCriterion[]).map((c) => renderFindingsCriterion(c, rubric, findingsOpts)).join('\n\n')
    : ((evidence.criteria ?? []) as EvCriterion[]).map((c) => renderCriterion(c, rubric, stateLabel)).join('\n\n');
  const remaining = ((evidence.selection_notes ?? []) as string[]).filter((n) => findings || !NOTES_COVERED.some((re) => re.test(n)));
  const notes = remaining.length ? `\n<notes>\n${remaining.map((n) => `- ${n}`).join('\n')}\n</notes>\n` : '';

  const filled = template
    .replace('{{REQUEST}}', packet.request)
    .replace('{{INTERFACE_ID}}', packet.interfaceId)
    .replace('{{STATES}}', findings ? renderFindingsStates(evidence.states ?? []) : renderStates(evidence, rubric))
    .replace('{{CRITERIA}}', criteria)
    .replace('{{NOTES}}', notes);
  const [before, after] = filled.split('{{SCREENSHOTS}}');
  if (after === undefined) throw new Error('Prompt user template must contain {{SCREENSHOTS}}');

  const parts: UserPart[] = [{ type: 'text', text: before.trimEnd() }];
  const shots = (evidence.screenshots ?? []) as { id: string; shows: string }[];
  for (const s of shots) {
    parts.push({ type: 'text', text: `Screenshot ${s.id}: ${s.shows}` });
    parts.push({ type: 'image', id: s.id });
  }
  parts.push({ type: 'text', text: after.trimStart() });

  const text = parts.map((p) => (p.type === 'text' ? p.text : `[image ${p.id}]`)).join('\n\n');
  return { parts, text };
}

// `scoring` replaces the rubric's scoring section (intro and anchors) for prompt versions that trial other anchors.
export function renderSystem(template: string, rubric: ParsedRubric, scoring?: string): string {
  const anchors = rubric.anchors.map((a) => `- ${a.score} · ${a.label}: ${a.text}`).join('\n');
  return template
    .replace('{{MEASURES}}', rubric.measures.replace(/\*\*/g, ''))
    .replace('{{ASSESSMENT_RULES}}', rubric.criteriaPreamble.replace(/\*\*/g, ''))
    .replace('{{SCORING}}', scoring ?? `${rubric.scoringIntro}\n\n${anchors}`);
}
