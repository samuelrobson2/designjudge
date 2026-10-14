// Planted-defect testing. Breakages are authored separately, without reference to the checks,
// as files in mutations/<caseId>/<id>.json. For each case a clean control is collected first
// (same code path, the baseline's interactive states replayed); each breakage is collected with
// its CSS/JS injected and its results are compared against the control. Each category's judge
// packet is then built for the control and the breakage, to see whether the evidence the judge
// would receive changes. Nothing here calls the judge.

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ARTIFACTS_DIR, EVIDENCE_DIR, ROOT } from '../config.ts';
import { loadCase } from '../cases.ts';
import { collectCase } from '../collect/collect.ts';
import { buildPacket, CATEGORIES, packetUnavailable } from '../categories/index.ts';
import type { FindingLine, FindingsCriterion } from '../categories/layout/findings.ts';
import { listPromptVersions } from '../categories/layout/prompt.ts';
import { parseRubric } from '../categories/layout/rubric.ts';
import { readRubric, readsAddedChecks } from '../categories/versions.ts';
import { DIAG_NAMES, diagnoseAndSave, runDiagnostics } from '../diagnostics/run.ts';
import { criterionOf, csv } from '../report/csv.ts';
import { listBundles, loadBundle } from '../store.ts';
import type { Bundle, DiagnosticResult, Diagnostics, StateRecord } from '../types.ts';
import { ensureDir, log, mapLimit, timestampId, writeJson } from '../util.ts';

export const MUTATIONS_DIR = path.join(ROOT, 'mutations');

const Mutation = z.object({
  id: z.string(),
  case: z.string(),
  kind: z.enum(['defect', 'harmless']),
  title: z.string(),
  symptom: z.string(),
  where: z
    .object({
      viewports: z.array(z.enum(['desktop', 'tablet', 'phone'])).optional(),
      widths: z.tuple([z.number(), z.number()]).nullish(),
      content: z.array(z.string()).nullish(),
      interaction: z.string().nullish(),
    })
    .default({}),
  severity: z.string(),
  css: z.string().nullish(),
  js: z.string().nullish(),
});
export type Mutation = z.infer<typeof Mutation>;

export function loadMutations(caseIds?: string[], root = MUTATIONS_DIR): Mutation[] {
  if (!fs.existsSync(root)) return [];
  const out: Mutation[] = [];
  for (const dir of fs.readdirSync(root).sort()) {
    if (dir.startsWith('_') || !fs.statSync(path.join(root, dir)).isDirectory()) continue;
    if (caseIds?.length && !caseIds.includes(dir)) continue;
    for (const f of fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.json')).sort()) {
      const raw = JSON.parse(fs.readFileSync(path.join(root, dir, f), 'utf8'));
      const parsed = Mutation.safeParse(raw);
      if (!parsed.success) {
        log(`  ! skipping mutations/${dir}/${f}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        continue;
      }
      out.push(parsed.data);
    }
  }
  return out;
}

// The states where a breakage says it shows. Sweep widths count by band: phone up to 480 px,
// tablet 600–1100 px, desktop from 1200 px, or the breakage's own width band.
function expectedStates(m: Mutation, bundle: Bundle): Set<string> {
  const vps = m.where.viewports?.length ? m.where.viewports : ['desktop', 'tablet', 'phone'];
  const band = m.where.widths ?? null;
  const content = m.where.content?.length ? m.where.content : null;
  const inBand = (w: number) => (band ? w >= band[0] && w <= band[1] : true);
  const sweepBand = (w: number) =>
    (vps.includes('phone') && w <= 480) || (vps.includes('tablet') && w >= 600 && w <= 1100) || (vps.includes('desktop') && w >= 1200);
  const vpOf = (s: StateRecord) => (s.viewportId === 'mobile' ? 'phone' : s.viewportId);
  const out = new Set<string>();
  for (const s of bundle.states) {
    if (content && !content.includes(s.fixture ?? 'typical')) continue;
    if (s.kind === 'sweep') {
      if (band ? inBand(s.viewport.width) : sweepBand(s.viewport.width)) out.add(s.id);
    } else if (vps.includes(vpOf(s) as never) && inBand(s.viewport.width)) {
      out.add(s.id);
    }
  }
  return out;
}

interface Change {
  key: string;
  diagId: string;
  stateId: string;
  kind: 'new_failure' | 'more_failures' | 'worse' | 'fixed' | 'observation_changed';
  before: string;
  after: string;
}

// Per-state check results and all observations; the two matrices only aggregate the per-state
// failures. A check that already failed counts again when it names elements it did not before,
// and as worse when it reports an element it already named differently (cut off 14% → 76%).
function diff(control: Diagnostics, mutated: Diagnostics): Change[] {
  const base = new Map(control.results.map((r) => [r.key, r]));
  const failingEls = (r: DiagnosticResult) => new Set(r.items.map((it) => it.elements[0]?.selector ?? it.summary));
  const reports = (r: DiagnosticResult) => new Map(r.items.map((it) => [it.elements[0]?.selector ?? it.summary, it.summary]));
  const changes: Change[] = [];
  for (const r of mutated.results) {
    const b = base.get(r.key);
    // A result the base could not produce (evidence collected before a probe existed) cannot be compared.
    if (!b || ['unavailable', 'not_collected', 'error'].includes(b.status)) continue;
    // Matrices repeat per-state failures, except the cross-width control-availability row.
    if (!r.stateId && r.kind === 'deterministic') {
      const gaps = (x: DiagnosticResult) => new Set(x.items.filter((it) => it.data.check === 'control_availability').map((it) => it.summary));
      const before = gaps(b);
      for (const s of gaps(r)) if (!before.has(s)) changes.push({ key: `control_availability:${s}`, diagId: 'control_availability', stateId: 'all', kind: 'new_failure', before: '', after: s });
      continue;
    }
    const c = (kind: Change['kind']) => changes.push({ key: r.key, diagId: r.diagId, stateId: r.stateId ?? 'all', kind, before: b.summary, after: r.summary });
    if (r.kind === 'deterministic') {
      const before = failingEls(b);
      if (r.status === 'fail' && b.status !== 'fail') c('new_failure');
      else if (r.status === 'fail' && b.status === 'fail' && [...failingEls(r)].some((s) => !before.has(s))) c('more_failures');
      else if (r.status === 'fail' && b.status === 'fail' && [...reports(r)].some(([el, text]) => worseReport(reports(b).get(el), text))) c('worse');
      else if (b.status === 'fail' && r.status === 'pass') c('fixed');
    } else if (r.status === 'observed' && b.status === 'observed' && (r.summary !== b.summary || r.items.map((i) => i.summary).join('\n') !== b.items.map((i) => i.summary).join('\n'))) {
      c('observation_changed');
    }
  }
  return changes;
}

// An element's failure reads clearly worse: its largest share rises by 20 points or more, or its
// largest px amount grows by half and at least 16 px. Smaller moves are run-to-run jitter.
function worseReport(before: string | undefined, after: string): boolean {
  if (before === undefined) return false;
  const most = (t: string, re: RegExp) => Math.max(-1, ...[...t.matchAll(re)].map((m) => Number(m[1])));
  const pct = /(\d+(?:\.\d+)?)%/g;
  const px = /(\d+(?:\.\d+)?) px/g;
  const [p0, p1] = [most(before, pct), most(after, pct)];
  if (p0 >= 0 && p1 >= 0) return p1 - p0 >= 20;
  const [x0, x1] = [most(before, px), most(after, px)];
  return x0 >= 0 && x1 >= x0 * 1.5 && x1 - x0 >= 16;
}

function grouped(changes: Change[]): string {
  const by = new Map<string, string[]>();
  for (const c of changes) by.set(DIAG_NAMES[c.diagId] ?? c.diagId, [...(by.get(DIAG_NAMES[c.diagId] ?? c.diagId) ?? []), c.stateId]);
  return [...by.entries()]
    .map(([name, states]) => {
      const sweep = states.filter((s) => s.startsWith('sweep-')).map((s) => s.slice(6));
      const other = states.filter((s) => !s.startsWith('sweep-'));
      return `${name}: ${[...other, ...(sweep.length ? [`sweep ${sweep.join('/')}px`] : [])].join(', ')}`;
    })
    .join('; ');
}

// ---------- What reaches the judge ----------

interface PacketLine {
  key: string;
  criterion: string;
  source: 'check' | 'unlisted' | 'measurement';
  name: string;
  text: string;
  where: string;
  stateIds: (string | null)[];
  // The diagnostic results the line reports.
  resultKeys: string[];
}

type PacketOutcome =
  | 'check_listed'
  | 'check_listed_elsewhere'
  | 'measurement_only'
  | 'unlisted_only'
  | 'not_in_packet'
  | 'absent'
  | 'unchanged'
  | 'new_check'
  | 'error';

interface PacketResult {
  promptVersion: string;
  outcome: PacketOutcome;
  added: PacketLine[];
}

type Packets = Record<string, { version: string; lines: PacketLine[] }>;

// The evidence lines of each category's latest prompt version, as the judge would read them.
function packetLines(bundle: Bundle, diags: Diagnostics): Packets {
  const out: Packets = {};
  for (const category of Object.keys(CATEGORIES)) {
    if (packetUnavailable(category, bundle)) continue;
    const version = listPromptVersions(category).at(-1)!;
    const packet = buildPacket(category, bundle, diags, version);
    const ev = packet.evidence as { format?: string; criteria?: FindingsCriterion[] };
    const lines: PacketLine[] = [];
    const add = (criterion: string, source: PacketLine['source'], name: string, l: Pick<FindingLine, 'text' | 'where' | 'ids'>, resultKeys?: string[]) =>
      lines.push({
        key: [criterion, source, name, l.text, l.where].join('|'),
        criterion, source, name, text: l.text, where: l.where,
        stateIds: l.ids.map((id) => packet.index[id]?.stateId ?? null),
        resultKeys: resultKeys ?? [...new Set(l.ids.map((id) => packet.index[id]?.resultKey).filter((k): k is string => !!k))],
      });
    for (const c of ev.format === 'findings' ? ev.criteria ?? [] : []) {
      for (const b of c.checks) {
        for (const l of b.issues) add(c.criterion, 'check', b.check, l);
        const diagIds = Object.keys(DIAG_NAMES).filter((id) => DIAG_NAMES[id] === b.check);
        if (b.more_issues) add(c.criterion, 'unlisted', b.check, { text: `${b.more_issues} further issues not listed`, where: '', ids: [] }, diagIds);
      }
      for (const b of c.observations) for (const l of b.lines) add(c.criterion, 'measurement', b.observation, l);
    }
    out[category] = { version, lines };
  }
  return out;
}

// Lines the breakage adds to each packet. A line counts only when it reports a diagnostic result
// the breakage changed, so lines that vary between collections (a flaky interaction, a text
// shift in an unchanged failure) are left out, as the diagnostics comparison leaves them out.
function packetDiff(m: Mutation, changes: Change[], control: Packets, mutated: Packets, expected: Set<string>): Record<string, PacketResult> {
  const found = changes.filter((c) => c.kind !== 'fixed').map((c) => (c.diagId === 'control_availability' ? { diagId: 'responsive_layout_failures', key: 'responsive_layout_failures' } : c));
  const changed = new Set(found.flatMap((c) => [c.key, c.diagId]));
  const out: Record<string, PacketResult> = {};
  for (const [category, { version, lines }] of Object.entries(mutated)) {
    if (!control[category]) continue;
    const own = categoryDiagIds(category, version);
    const before = new Set(control[category].lines.map((l) => l.key));
    const added = lines.filter((l) => !before.has(l.key) && l.resultKeys.some((k) => changed.has(k)));
    const checks = added.filter((l) => l.source === 'check');
    const shows = (l: PacketLine) => l.stateIds.some((id) => id === null || expected.has(id));
    let result: PacketOutcome;
    if (m.kind === 'harmless') result = checks.length ? 'new_check' : added.length ? 'measurement_only' : 'unchanged';
    else if (checks.some(shows)) result = 'check_listed';
    else if (checks.length) result = 'check_listed_elsewhere';
    else if (added.some((l) => l.source === 'measurement')) result = 'measurement_only';
    else if (added.length) result = 'unlisted_only';
    else result = found.some((c) => own.has(c.diagId)) ? 'not_in_packet' : 'absent';
    out[category] = { promptVersion: version, outcome: result, added };
  }
  return out;
}

const diagIdsByCategory = new Map<string, Set<string>>();
function categoryDiagIds(category: string, version: string): Set<string> {
  const key = `${category}@${version}`;
  if (!diagIdsByCategory.has(key)) {
    const c = CATEGORIES[category];
    const rubric = parseRubric(readRubric(c.rubricPath, readsAddedChecks(category, version)), c.name, path.basename(c.rubricPath));
    diagIdsByCategory.set(key, new Set(rubric.diagnostics.map((d) => d.diagId)));
  }
  return diagIdsByCategory.get(key)!;
}

function packetText(p: PacketResult | undefined): string {
  return (p?.added ?? []).map((l) => `[${l.criterion}] ${l.name}: ${l.text}${l.where ? ` (${l.where})` : ''}`).join(' | ');
}

export interface MutationResult {
  caseId: string;
  mutationId: string;
  kind: Mutation['kind'];
  severity: string;
  title: string;
  symptom: string;
  where: Mutation['where'];
  outcome: 'caught' | 'caught_elsewhere' | 'worsened' | 'observation_only' | 'missed' | 'clean' | 'false_alarm' | 'error';
  caughtBy: Change[];
  elsewhere: Change[];
  // Failures already present in the control that the breakage makes read differently.
  worse: Change[];
  observations: Change[];
  fixed: Change[];
  // Per category: whether the judge's evidence changes, and the lines it gains.
  packets: Record<string, PacketResult>;
  evidenceId: string;
  error?: string;
}

function scored(m: Mutation, changes: Change[], bundle: Bundle, diags: Diagnostics, control: Packets) {
  const expected = expectedStates(m, bundle);
  return { ...classify(m, changes, expected), packets: packetDiff(m, changes, control, packetLines(bundle, diags), expected) };
}

function classify(m: Mutation, changes: Change[], expected: Set<string>): Pick<MutationResult, 'outcome' | 'caughtBy' | 'elsewhere' | 'worse' | 'observations' | 'fixed'> {
  const failing = changes.filter((c) => c.kind === 'new_failure' || c.kind === 'more_failures');
  const caughtBy = failing.filter((c) => c.stateId === 'all' || expected.has(c.stateId));
  const elsewhere = failing.filter((c) => c.stateId !== 'all' && !expected.has(c.stateId));
  const worse = changes.filter((c) => c.kind === 'worse');
  const observations = changes.filter((c) => c.kind === 'observation_changed');
  const fixed = changes.filter((c) => c.kind === 'fixed');
  let outcome: MutationResult['outcome'];
  if (m.kind === 'harmless') outcome = failing.length ? 'false_alarm' : 'clean';
  else if (caughtBy.length) outcome = 'caught';
  else if (elsewhere.length) outcome = 'caught_elsewhere';
  else if (worse.some((c) => expected.has(c.stateId))) outcome = 'worsened';
  else if (observations.length) outcome = 'observation_only';
  else outcome = 'missed';
  return { outcome, caughtBy, elsewhere, worse, observations, fixed };
}

// A control collected on a paused page clock repeats the baseline's collection exactly, so where
// it differs from the stored baseline the baseline is out of date: nothing is masked as noise.
// Older collections waited in real time and could differ from run to run.
function noiseMask(control: Bundle, noise: Change[]): Set<string> {
  const deterministic = !!(control.config.settle as { pageTime?: unknown } | null)?.pageTime;
  return deterministic ? new Set() : new Set(noise.map((c) => c.key));
}

async function collectAndDiagnose(caseId: string, evidenceId: string, baseline: Bundle, functional: boolean, inject?: { css?: string | null; js?: string | null }) {
  const bundle = await collectCase(loadCase(caseId), { inject, evidenceId, interactiveFrom: baseline, concurrency: 2, functional });
  return { bundle, diags: diagnoseAndSave(loadBundle(evidenceId, bundle.bundleId)) };
}

// `functional` runs the Functionality probe, which only Functionality's packet needs.
export async function runMutations(opts: { caseIds?: string[]; only?: string[]; concurrency?: number; dir?: string; functional?: boolean }) {
  const all = loadMutations(opts.caseIds, opts.dir ? path.resolve(opts.dir) : MUTATIONS_DIR).filter((m) => !opts.only?.length || opts.only.includes(m.id));
  if (!all.length) throw new Error('No breakages found in mutations/. Author them first (see mutations/README.md).');
  const runId = timestampId();
  const outDir = ensureDir(path.join(ARTIFACTS_DIR, 'mutations', runId));
  const results: MutationResult[] = [];
  const controls: Control[] = [];

  for (const caseId of [...new Set(all.map((m) => m.case))]) {
    const stored = loadBundle(caseId);
    // Not saved: the stored baseline's evidence is left untouched.
    const storedDiags = runDiagnostics(stored);
    log(`\n[mutate] ${caseId}: collecting a clean control`);
    const controlId = `_mutations/${runId}/${caseId}/_control`;
    const control = await collectAndDiagnose(caseId, controlId, stored, !!opts.functional);
    const noise = diff(storedDiags, control.diags);
    controls.push({ caseId, evidenceId: controlId, changesVsStoredBaseline: noise });
    const noisy = noiseMask(control.bundle, noise);
    log(`  control vs stored baseline: ${noise.length ? `${noise.length} differences (${grouped(noise)})${noisy.size ? ', ignored as run-to-run noise' : '; the stored baseline is out of date'}` : 'identical results'}`);
    const controlPackets = packetLines(control.bundle, control.diags);

    const items = all.filter((m) => m.case === caseId);
    const done = await mapLimit(items, opts.concurrency ?? 2, async (m) => {
      const evidenceId = `_mutations/${runId}/${caseId}/${m.id}`;
      const base = { caseId, mutationId: m.id, kind: m.kind, severity: m.severity, title: m.title, symptom: m.symptom, where: m.where, evidenceId };
      try {
        const mutated = await collectAndDiagnose(caseId, evidenceId, stored, !!opts.functional, { css: m.css, js: m.js });
        const changes = diff(control.diags, mutated.diags).filter((c) => !noisy.has(c.key));
        const r: MutationResult = { ...base, ...scored(m, changes, mutated.bundle, mutated.diags, controlPackets) };
        log(`  ${r.outcome.padEnd(17)} ${m.kind.padEnd(8)} ${m.id}${r.caughtBy.length ? ` — ${grouped(r.caughtBy)}` : ''}`);
        return r;
      } catch (err) {
        log(`  error             ${m.id}: ${(err as Error).message.split('\n')[0]}`);
        return { ...base, outcome: 'error' as const, caughtBy: [], elsewhere: [], worse: [], observations: [], fixed: [], packets: {}, error: (err as Error).message.split('\n')[0] };
      }
    });
    results.push(...done);
  }
  writeResults(outDir, runId, controls, results);
  return outDir;
}

type Control = { caseId: string; evidenceId: string; changesVsStoredBaseline: Change[] };

// Re-runs the current diagnostics on a previous run's saved evidence and scores it again, so a
// change to a check can be tested against every breakage without collecting again.
export function rescoreRun(runId: string, opts: { dir?: string } = {}) {
  const mutations = loadMutations(undefined, opts.dir ? path.resolve(opts.dir) : MUTATIONS_DIR);
  const root = path.join(EVIDENCE_DIR, '_mutations', runId);
  if (!fs.existsSync(root)) throw new Error(`No saved evidence for mutation run ${runId}.`);
  const results: MutationResult[] = [];
  const controls: Control[] = [];
  for (const caseId of fs.readdirSync(root).sort()) {
    const controlId = `_mutations/${runId}/${caseId}/_control`;
    const controlBundle = loadBundle(controlId);
    const control = diagnoseAndSave(controlBundle);
    // The baseline the run's control repeated: the latest one collected before the run.
    const stored = loadBundle(caseId, listBundles(caseId).find((id) => id < runId));
    const storedDiags = runDiagnostics(stored);
    const noise = diff(storedDiags, control);
    controls.push({ caseId, evidenceId: controlId, changesVsStoredBaseline: noise });
    const noisy = noiseMask(controlBundle, noise);
    const controlPackets = packetLines(controlBundle, control);
    for (const id of fs.readdirSync(path.join(root, caseId)).filter((d) => d !== '_control').sort()) {
      const m = mutations.find((x) => x.case === caseId && x.id === id);
      if (!m) continue;
      const evidenceId = `_mutations/${runId}/${caseId}/${id}`;
      const bundle = loadBundle(evidenceId);
      const diags = diagnoseAndSave(bundle);
      const changes = diff(control, diags).filter((c) => !noisy.has(c.key));
      results.push({ caseId, mutationId: id, kind: m.kind, severity: m.severity, title: m.title, symptom: m.symptom, where: m.where, evidenceId, ...scored(m, changes, bundle, diags, controlPackets) });
    }
  }
  const outDir = ensureDir(path.join(ARTIFACTS_DIR, 'mutations', runId, `rescore-${timestampId()}`));
  writeResults(outDir, runId, controls, results);
  return outDir;
}

function writeResults(outDir: string, runId: string, controls: Control[], results: MutationResult[]) {
  writeJson(path.join(outDir, 'results.json'), { runId, generatedAt: new Date().toISOString(), controls, results });
  const categories = Object.keys(CATEGORIES);
  fs.writeFileSync(
    path.join(outDir, 'results.csv'),
    csv([
      [
        'case_id', 'mutation_id', 'kind', 'severity', 'title', 'where', 'outcome', 'caught_by', 'new_failures_elsewhere', 'existing_failures_worse', 'observation_changes', 'checks_now_passing',
        ...categories.flatMap((c) => [`${c}_packet`, `${c}_packet_new_lines`]),
        'symptom', 'evidence_folder', 'error', 'human_verdict', 'human_notes',
      ],
      ...results.map((r) => [
        r.caseId, r.mutationId, r.kind, r.severity, r.title, whereText(r.where), r.outcome, grouped(r.caughtBy), grouped(r.elsewhere), grouped(r.worse ?? []), grouped(r.observations), grouped(r.fixed),
        ...categories.flatMap((c) => [r.packets[c]?.outcome ?? (r.outcome === 'error' ? 'error' : 'not_built'), packetText(r.packets[c])]),
        r.symptom, `artifacts/evidence/${r.evidenceId}`, r.error ?? '', '', '',
      ]),
    ]),
  );
  fs.writeFileSync(path.join(outDir, 'by-check.csv'), csv(byCheck(results)));

  const defects = results.filter((r) => r.kind === 'defect');
  const harmless = results.filter((r) => r.kind === 'harmless');
  const count = (list: MutationResult[], o: MutationResult['outcome']) => list.filter((r) => r.outcome === o).length;
  log(`\n[mutate] ${defects.length} defects: ${count(defects, 'caught')} caught where they show, ${count(defects, 'caught_elsewhere')} caught elsewhere, ${count(defects, 'worsened')} made an existing failure worse, ${count(defects, 'observation_only')} only changed an observation, ${count(defects, 'missed')} missed, ${count(defects, 'error')} errors`);
  log(`[mutate] ${harmless.length} harmless changes: ${count(harmless, 'clean')} clean, ${count(harmless, 'false_alarm')} false alarms`);
  for (const c of categories) {
    const p = (list: MutationResult[], o: PacketOutcome) => list.filter((r) => r.packets[c]?.outcome === o).length;
    const v = results.find((r) => r.packets[c])?.packets[c].promptVersion ?? '';
    if (!v) {
      log(`[mutate] ${CATEGORIES[c].name} packet: not built${c === 'functionality' ? ' (collected without the Functionality probe; it runs with --dir mutations-functionality or --functional)' : ''}`);
      continue;
    }
    log(
      `[mutate] ${CATEGORIES[c].name} ${v} packet, defects: ${p(defects, 'check_listed')} listed as a failed check where they show, ${p(defects, 'check_listed_elsewhere')} listed elsewhere, ${p(defects, 'measurement_only')} only as a measurement, ${p(defects, 'unlisted_only')} only in an unlisted count, ${p(defects, 'not_in_packet')} found by diagnostics but not in the packet, ${p(defects, 'absent')} absent; harmless: ${p(harmless, 'unchanged')} unchanged, ${p(harmless, 'measurement_only')} measurement changed, ${p(harmless, 'new_check')} new failed check`,
    );
  }
  log(`[mutate] results written to ${path.relative(process.cwd(), outDir)}`);
}

function whereText(w: Mutation['where']): string {
  return [
    w.viewports?.join('/') ?? 'all viewports',
    w.widths ? `${w.widths[0]}–${w.widths[1]}px` : null,
    w.content?.length ? `content: ${w.content.join('/')}` : null,
    w.interaction ? `after: ${w.interaction}` : null,
  ]
    .filter(Boolean)
    .join('; ');
}

// Per check: defects it caught where they show, anywhere, and harmless changes it flagged.
function byCheck(results: MutationResult[]) {
  const rows: (string | number)[][] = [['check', 'check_id', 'criterion', 'defects_caught_where_they_show', 'defects_caught_anywhere', 'false_alarms_on_harmless', 'observation_changed_on_defects']];
  for (const [diagId, name] of Object.entries(DIAG_NAMES)) {
    const has = (list: Change[]) => list.some((c) => c.diagId === diagId);
    const defects = results.filter((r) => r.kind === 'defect');
    rows.push([
      name, diagId, criterionOf(diagId),
      defects.filter((r) => has(r.caughtBy)).length,
      defects.filter((r) => has(r.caughtBy) || has(r.elsewhere)).length,
      results.filter((r) => r.kind === 'harmless' && (has(r.caughtBy) || has(r.elsewhere))).length,
      defects.filter((r) => has(r.observations)).length,
    ]);
  }
  return rows;
}

export type { DiagnosticResult };
