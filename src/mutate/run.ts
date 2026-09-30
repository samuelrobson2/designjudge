// Planted-defect testing. Breakages are authored separately, without reference to the checks,
// as files in mutations/<caseId>/<id>.json. For each case a clean control is collected first
// (same code path, the baseline's interactive states replayed); each breakage is collected with
// its CSS/JS injected and its results are compared against the control. Nothing here involves
// the judge.

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ARTIFACTS_DIR, EVIDENCE_DIR, ROOT } from '../config.ts';
import { loadCase } from '../cases.ts';
import { collectCase } from '../collect/collect.ts';
import { DIAGNOSTIC_HOME } from '../categories/layout/homes.ts';
import { DIAG_NAMES, diagnoseAndSave } from '../diagnostics/run.ts';
import { csv } from '../report/csv.ts';
import { loadBundle } from '../store.ts';
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
  kind: 'new_failure' | 'more_failures' | 'fixed' | 'observation_changed';
  before: string;
  after: string;
}

// Per-state check results and all observations; the two matrices only aggregate the per-state
// failures. A check that already failed counts again when it names elements it did not before.
function diff(control: Diagnostics, mutated: Diagnostics): Change[] {
  const base = new Map(control.results.map((r) => [r.key, r]));
  const failingEls = (r: DiagnosticResult) => new Set(r.items.map((it) => it.elements[0]?.selector ?? it.summary));
  const changes: Change[] = [];
  for (const r of mutated.results) {
    const b = base.get(r.key);
    if (!b) continue;
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
      else if (b.status === 'fail' && r.status === 'pass') c('fixed');
    } else if (r.status === 'observed' && b.status === 'observed' && (r.summary !== b.summary || r.items.map((i) => i.summary).join('\n') !== b.items.map((i) => i.summary).join('\n'))) {
      c('observation_changed');
    }
  }
  return changes;
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

export interface MutationResult {
  caseId: string;
  mutationId: string;
  kind: Mutation['kind'];
  severity: string;
  title: string;
  symptom: string;
  where: Mutation['where'];
  outcome: 'caught' | 'caught_elsewhere' | 'observation_only' | 'missed' | 'clean' | 'false_alarm' | 'error';
  caughtBy: Change[];
  elsewhere: Change[];
  observations: Change[];
  fixed: Change[];
  evidenceId: string;
  error?: string;
}

function classify(m: Mutation, changes: Change[], expected: Set<string>): Pick<MutationResult, 'outcome' | 'caughtBy' | 'elsewhere' | 'observations' | 'fixed'> {
  const failing = changes.filter((c) => c.kind === 'new_failure' || c.kind === 'more_failures');
  const caughtBy = failing.filter((c) => c.stateId === 'all' || expected.has(c.stateId));
  const elsewhere = failing.filter((c) => c.stateId !== 'all' && !expected.has(c.stateId));
  const observations = changes.filter((c) => c.kind === 'observation_changed');
  const fixed = changes.filter((c) => c.kind === 'fixed');
  let outcome: MutationResult['outcome'];
  if (m.kind === 'harmless') outcome = failing.length ? 'false_alarm' : 'clean';
  else if (caughtBy.length) outcome = 'caught';
  else if (elsewhere.length) outcome = 'caught_elsewhere';
  else if (observations.length) outcome = 'observation_only';
  else outcome = 'missed';
  return { outcome, caughtBy, elsewhere, observations, fixed };
}

async function collectAndDiagnose(caseId: string, evidenceId: string, baseline: Bundle, inject?: { css?: string | null; js?: string | null }) {
  const bundle = await collectCase(loadCase(caseId), { inject, evidenceId, interactiveFrom: baseline, concurrency: 2 });
  return { bundle, diags: diagnoseAndSave(loadBundle(evidenceId, bundle.bundleId)) };
}

export async function runMutations(opts: { caseIds?: string[]; only?: string[]; concurrency?: number; dir?: string }) {
  const all = loadMutations(opts.caseIds, opts.dir ? path.resolve(opts.dir) : MUTATIONS_DIR).filter((m) => !opts.only?.length || opts.only.includes(m.id));
  if (!all.length) throw new Error('No breakages found in mutations/. Author them first (see mutations/README.md).');
  const runId = timestampId();
  const outDir = ensureDir(path.join(ARTIFACTS_DIR, 'mutations', runId));
  const results: MutationResult[] = [];
  const controls: Control[] = [];

  for (const caseId of [...new Set(all.map((m) => m.case))]) {
    const stored = loadBundle(caseId);
    const storedDiags = diagnoseAndSave(stored);
    log(`\n[mutate] ${caseId}: collecting a clean control`);
    const controlId = `_mutations/${runId}/${caseId}/_control`;
    const control = await collectAndDiagnose(caseId, controlId, stored);
    // The control repeats the baseline's collection; any difference is run-to-run noise.
    const noise = diff(storedDiags, control.diags);
    controls.push({ caseId, evidenceId: controlId, changesVsStoredBaseline: noise });
    log(`  control vs stored baseline: ${noise.length ? `${noise.length} differences (${grouped(noise)})` : 'identical results'}`);
    const noisy = new Set(noise.map((c) => c.key));

    const items = all.filter((m) => m.case === caseId);
    const done = await mapLimit(items, opts.concurrency ?? 2, async (m) => {
      const evidenceId = `_mutations/${runId}/${caseId}/${m.id}`;
      const base = { caseId, mutationId: m.id, kind: m.kind, severity: m.severity, title: m.title, symptom: m.symptom, where: m.where, evidenceId };
      try {
        const mutated = await collectAndDiagnose(caseId, evidenceId, stored, { css: m.css, js: m.js });
        const changes = diff(control.diags, mutated.diags).filter((c) => !noisy.has(c.key));
        const r: MutationResult = { ...base, ...classify(m, changes, expectedStates(m, mutated.bundle)) };
        log(`  ${r.outcome.padEnd(17)} ${m.kind.padEnd(8)} ${m.id}${r.caughtBy.length ? ` — ${grouped(r.caughtBy)}` : ''}`);
        return r;
      } catch (err) {
        log(`  error             ${m.id}: ${(err as Error).message.split('\n')[0]}`);
        return { ...base, outcome: 'error' as const, caughtBy: [], elsewhere: [], observations: [], fixed: [], error: (err as Error).message.split('\n')[0] };
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
    const control = diagnoseAndSave(loadBundle(controlId));
    const noise = diff(diagnoseAndSave(loadBundle(caseId)), control);
    controls.push({ caseId, evidenceId: controlId, changesVsStoredBaseline: noise });
    const noisy = new Set(noise.map((c) => c.key));
    for (const id of fs.readdirSync(path.join(root, caseId)).filter((d) => d !== '_control').sort()) {
      const m = mutations.find((x) => x.case === caseId && x.id === id);
      if (!m) continue;
      const evidenceId = `_mutations/${runId}/${caseId}/${id}`;
      const bundle = loadBundle(evidenceId);
      const changes = diff(control, diagnoseAndSave(bundle)).filter((c) => !noisy.has(c.key));
      results.push({ caseId, mutationId: id, kind: m.kind, severity: m.severity, title: m.title, symptom: m.symptom, where: m.where, evidenceId, ...classify(m, changes, expectedStates(m, bundle)) });
    }
  }
  const outDir = ensureDir(path.join(ARTIFACTS_DIR, 'mutations', runId, `rescore-${timestampId()}`));
  writeResults(outDir, runId, controls, results);
  return outDir;
}

function writeResults(outDir: string, runId: string, controls: Control[], results: MutationResult[]) {
  writeJson(path.join(outDir, 'results.json'), { runId, generatedAt: new Date().toISOString(), controls, results });
  fs.writeFileSync(
    path.join(outDir, 'results.csv'),
    csv([
      ['case_id', 'mutation_id', 'kind', 'severity', 'title', 'where', 'outcome', 'caught_by', 'new_failures_elsewhere', 'observation_changes', 'checks_now_passing', 'symptom', 'evidence_folder', 'error', 'human_verdict', 'human_notes'],
      ...results.map((r) => [
        r.caseId, r.mutationId, r.kind, r.severity, r.title, whereText(r.where), r.outcome, grouped(r.caughtBy), grouped(r.elsewhere), grouped(r.observations), grouped(r.fixed),
        r.symptom, `artifacts/evidence/${r.evidenceId}`, r.error ?? '', '', '',
      ]),
    ]),
  );
  fs.writeFileSync(path.join(outDir, 'by-check.csv'), csv(byCheck(results)));

  const defects = results.filter((r) => r.kind === 'defect');
  const harmless = results.filter((r) => r.kind === 'harmless');
  const count = (list: MutationResult[], o: MutationResult['outcome']) => list.filter((r) => r.outcome === o).length;
  log(`\n[mutate] ${defects.length} defects: ${count(defects, 'caught')} caught where they show, ${count(defects, 'caught_elsewhere')} caught elsewhere, ${count(defects, 'observation_only')} only changed an observation, ${count(defects, 'missed')} missed, ${count(defects, 'error')} errors`);
  log(`[mutate] ${harmless.length} harmless changes: ${count(harmless, 'clean')} clean, ${count(harmless, 'false_alarm')} false alarms`);
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
      name, diagId, DIAGNOSTIC_HOME[diagId] ?? '',
      defects.filter((r) => has(r.caughtBy)).length,
      defects.filter((r) => has(r.caughtBy) || has(r.elsewhere)).length,
      results.filter((r) => r.kind === 'harmless' && (has(r.caughtBy) || has(r.elsewhere))).length,
      defects.filter((r) => has(r.observations)).length,
    ]);
  }
  return rows;
}

export type { DiagnosticResult };
