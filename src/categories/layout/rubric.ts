import fs from 'node:fs';
import { LAYOUT_RUBRIC_PATH } from '../../config.ts';
import { DIAG_NAMES } from '../../diagnostics/run.ts';

export interface DiagnosticDef {
  diagId: string;
  name: string;
  kind: 'deterministic' | 'observation';
  measures: string | null;
  pass: string | null;
  reference: string | null;
}

export interface CriterionSection {
  id: string;
  name: string;
  text: string;
  statement: string;
  points: { name: string; definition: string }[];
  screenshotsLine: string;
  diagnosticLine: string;
  diagIds: string[];
}

export interface ParsedRubric {
  raw: string;
  measures: string;
  states: string;
  stateDefinitions: Record<string, string>;
  diagnostics: DiagnosticDef[];
  criteriaPreamble: string;
  criteria: CriterionSection[];
  scoring: string;
  scoringIntro: string;
  anchors: { score: number; label: string; text: string }[];
}

const NAME_TO_ID: Record<string, string> = Object.fromEntries(Object.entries(DIAG_NAMES).map(([id, name]) => [name.toLowerCase(), id]));
// Phrases the rubric uses in "Relevant Evidence" instead of a diagnostic's name.
const ALIASES: Record<string, string> = { 'cross-viewport changes in element geometry': 'responsive_adaptation' };

function between(text: string, start: string, end?: string): string {
  const i = text.indexOf(start);
  if (i < 0) throw new Error(`layout_rubric.md: section "${start}" not found`);
  const from = i + start.length;
  const j = end ? text.indexOf(end, from) : text.length;
  if (j < 0) throw new Error(`layout_rubric.md: section end "${end}" not found after "${start}"`);
  return text.slice(from, j).trim();
}

function tableRows(section: string, minCells = 3): string[][] {
  return section
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells.length >= minCells && cells[0] && !/^-+$/.test(cells[0]) && cells[0] !== '**Name**');
}

function clean(s: string): string {
  return s.replace(/^[-\s]+/, '').replace(/\s+/g, ' ').trim();
}

function parseDiagnostic(cells: string[], kind: DiagnosticDef['kind']): DiagnosticDef {
  const nameMatch = cells[0].match(/\*\*(.+?)\*\*/);
  if (!nameMatch) throw new Error(`layout_rubric.md: cannot read diagnostic name from "${cells[0]}"`);
  const name = nameMatch[1].trim();
  const diagId = NAME_TO_ID[name.toLowerCase()];
  if (!diagId) throw new Error(`layout_rubric.md: diagnostic "${name}" has no implementation`);
  const rest = cells[0].slice(nameMatch.index! + nameMatch[0].length).replace(/[*()]/g, '').trim();
  const out = cells[2];
  const pass = out.match(/\*\*Pass(?::\*\*|\*\*:)\s*(.*?)(?=\*\*On failure|\s+Report:|$)/);
  const reference = out.match(/\*\*Reference(?::\*\*|\*\*:)\s*(.*?)(?=-?\s*\*\*Observed|$)/);
  return {
    diagId,
    name,
    kind,
    measures: rest ? clean(rest) : null,
    pass: pass ? clean(pass[1]) : null,
    reference: reference ? clean(reference[1]) : null,
  };
}

function diagIdsIn(line: string): string[] {
  const lower = line.toLowerCase();
  const hits: { id: string; at: number }[] = [];
  for (const [phrase, id] of [...Object.entries(NAME_TO_ID), ...Object.entries(ALIASES)]) {
    const at = lower.indexOf(phrase);
    if (at >= 0 && !hits.some((h) => h.id === id)) hits.push({ id, at });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
}

export function parseLayoutRubric(raw = fs.readFileSync(LAYOUT_RUBRIC_PATH, 'utf8')): ParsedRubric {
  const measuresMatch = raw.match(/\*\*What this measures:\*\*.*$/m);
  const deterministic = tableRows(between(raw, '**Deterministic Findings:**', '**Quantitative Observations:**')).map((c) => parseDiagnostic(c, 'deterministic'));
  const observations = tableRows(between(raw, '**Quantitative Observations:**', '### Criteria based Evaluation:')).map((c) => parseDiagnostic(c, 'observation'));
  const criteriaText = between(raw, '### Criteria based Evaluation:', '### Overall Layout Scoring:');

  const headerRe = /\+\+\*\*([A-Z])\/ (.+?)\*\*\+\+/g;
  const headers = [...criteriaText.matchAll(headerRe)];
  if (!headers.length) throw new Error('layout_rubric.md: no criteria headers (++**A/ Name**++) found');
  const criteria = headers.map((m, i) => {
    const text = criteriaText.slice(m.index!, i + 1 < headers.length ? headers[i + 1].index : undefined).trim();
    const screenshotsLine = text.match(/\*\*Screenshots:\*\*\s*(.+)/)?.[1].trim() ?? '';
    const diagnosticLine = text.match(/\*\*Diagnostic Evidence:\*\*\s*(.+)/)?.[1].trim() ?? '';
    const statement = text.match(/\*\*Criterion:\*\*\s*(.+)/)?.[1].trim() ?? '';
    const lower = text.toLowerCase();
    const pointsBlock = text.slice(lower.indexOf('evaluate'), lower.indexOf('relevant evidence') >= 0 ? lower.indexOf('relevant evidence') : undefined);
    const points = [...pointsBlock.matchAll(/^- \*\*(.+?):\*\*\s*(.+)$/gm)].map((p) => ({ name: p[1].trim(), definition: p[2].trim() }));
    if (!statement || !points.length) throw new Error(`layout_rubric.md: criterion ${m[1]} is missing its statement or evaluation points`);
    return { id: m[1], name: m[2].trim(), text, statement, points, screenshotsLine, diagnosticLine, diagIds: diagIdsIn(diagnosticLine) };
  });

  const states = between(raw, '### Evaluation States:', '### Diagnostic Evidence:');
  const stateDefinitions = Object.fromEntries(
    [...states.matchAll(/^- \*\*(.+?):\*\*\s*(.+)$/gm)].map((s) => [s[1].trim(), s[2].trim()]),
  );

  const scoring = between(raw, '### Overall Layout Scoring:');
  const anchors = tableRows(scoring, 2)
    .map((cells) => {
      const m = cells[0].match(/\*\*(\d)\s*[:-]\s*([A-Za-z]+)/);
      return m ? { score: Number(m[1]), label: m[2], text: clean(cells[1]) } : null;
    })
    .filter((a): a is { score: number; label: string; text: string } => a !== null);
  if (anchors.length !== 5) throw new Error(`layout_rubric.md: expected 5 scoring anchors, found ${anchors.length}`);
  const scoringIntro = scoring
    .split('\n')
    .filter((l) => !l.trim().startsWith('|'))
    .join('\n')
    .trim();

  return {
    raw,
    measures: measuresMatch ? measuresMatch[0] : '',
    states,
    stateDefinitions,
    diagnostics: [...deterministic, ...observations],
    criteriaPreamble: criteriaText.slice(0, headers[0].index).trim(),
    criteria,
    scoring,
    scoringIntro,
    anchors,
  };
}

// Rubric state definition for a collected state ID.
export function rubricStateName(stateId: string): string | null {
  if (stateId === 'desktop') return 'Baseline Desktop';
  if (stateId === 'tablet') return 'Baseline Tablet';
  if (stateId === 'mobile') return 'Baseline Mobile';
  if (stateId === 'stress-desktop') return 'Combined Stress';
  if (stateId.startsWith('interactive')) return 'Representative Interactive States';
  if (stateId.startsWith('sweep') || stateId === 'responsive sweep') return 'Responsive Sweep';
  if (stateId === 'rtl') return 'RTL';
  return null;
}

const collapseTables = (s: string) => s.replace(/^(\|.*)$/gm, (line) => line.replace(/ {2,}/g, ' '));

// The rubric as the judge needs it: states, criteria and scoring verbatim; each diagnostic
// described by what it measures and its reference values, without the implementation specs
// the harness follows.
export function judgeRubricText(p: ParsedRubric = parseLayoutRubric()): string {
  const line = (d: DiagnosticDef) => {
    const parts = [`- **${d.name}**`];
    if (d.measures) parts.push(`— ${d.measures}.`);
    if (d.pass) parts.push(`Pass: ${d.pass}`);
    if (d.reference) parts.push(`Reference: ${d.reference}`);
    return parts.join(' ');
  };
  return collapseTables(
    [
      '## 1. Layout',
      '',
      p.measures,
      '',
      '### Evaluation States:',
      '',
      p.states,
      '',
      '### Diagnostic Evidence:',
      '',
      'Diagnostic evidence is produced by deterministic code before the evaluation. You receive its results; you do not run or re-check these diagnostics.',
      '',
      'Deterministic findings (objective PASS/FAIL results):',
      ...p.diagnostics.filter((d) => d.kind === 'deterministic').map(line),
      '',
      'Quantitative observations (measured values, paired with reference guidance, to interpret in context):',
      ...p.diagnostics.filter((d) => d.kind === 'observation').map(line),
      '',
      '### Criteria based Evaluation:',
      '',
      p.criteriaPreamble,
      '',
      ...p.criteria.map((c) => c.text + '\n'),
      '### Overall Layout Scoring:',
      '',
      p.scoring,
    ].join('\n'),
  ).trim();
}

// Which screenshots a criterion's "Screenshots:" line refers to.
export function screenshotMatcher(screenshotsLine: string): (stateId: string) => boolean {
  const l = screenshotsLine.toLowerCase();
  const wants = {
    desktop: l.includes('desktop'),
    tablet: l.includes('tablet'),
    mobile: l.includes('mobile'),
    stress: l.includes('stress'),
    interactive: l.includes('interactive'),
    sweep: l.includes('responsive-transition') || l.includes('transition'),
  };
  return (stateId) =>
    (wants.desktop && stateId === 'desktop') ||
    (wants.tablet && stateId === 'tablet') ||
    (wants.mobile && stateId === 'mobile') ||
    (wants.stress && stateId === 'stress-desktop') ||
    (wants.interactive && stateId.startsWith('interactive-')) ||
    (wants.sweep && stateId.startsWith('sweep-'));
}
