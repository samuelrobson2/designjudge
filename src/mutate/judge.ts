// Judging planted variants for real. The clean control of a mutation run and each of its variants
// are judged in one category; each variant is then compared with its control in the direction its
// file name implies (harmless-* the same, minor-* not more than half a point higher, anything else
// lower), with compare's verdicts, including
// "needs more repeats" below three valid scores. The judge sees only what any interface's judge
// sees: the base case's request and an opaque interface ID.

import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACTS_DIR, EVIDENCE_DIR } from '../config.ts';
import { buildPacket, buildRequest, categoryOf, ensurePacketImages } from '../categories/index.ts';
import { listPromptVersions } from '../categories/layout/prompt.ts';
import { loadRun, summarise, type Expected, type PairExpectation } from '../compare/compare.ts';
import { runJudge, type JudgeOptions } from '../judge/run.ts';
import { bundleDir, loadBundle, loadDiagnostics, packetPath } from '../store.ts';
import type { Bundle } from '../types.ts';
import { ensureDir, log, round2, writeJson } from '../util.ts';
import type { Mutation } from './run.ts';

export function expectedChange(fileName: string): Extract<Expected, 'no_change' | 'no_rise' | 'must_drop'> {
  const id = path.basename(fileName, '.json');
  return id.startsWith('harmless-') ? 'no_change' : id.startsWith('minor-') ? 'no_rise' : 'must_drop';
}

// The category a mutations folder plants defects for: mutations/ is Layout's, mutations-<category>/
// the named category's (mutations-task-fit is task_fit).
export function categoryForDir(dir?: string): string {
  const name = path.basename(path.resolve(dir ?? 'mutations'));
  const id = name === 'mutations' ? 'layout' : name.replace(/^mutations-/, '').replace(/-/g, '_');
  return categoryOf(id).id;
}

// Strings that would tell the judge what was planted. None may appear in a prompt.
export function leaks(promptText: string, caseId: string, m?: Pick<Mutation, 'id' | 'title' | 'symptom'>): string[] {
  const text = promptText.toLowerCase();
  return [caseId, ...(m ? [m.id, m.title, m.symptom] : [])].filter((s) => s && text.includes(s.toLowerCase()));
}

export interface JudgeMutationsOptions extends Pick<JudgeOptions, 'provider' | 'model' | 'effort' | 'concurrency' | 'mockMode'> {
  runId: string;
  mutations: Mutation[];
  category: string;
  promptVersion?: string;
  repeats: number;
  baseRepeats: number;
  only?: string[];
}

interface Target {
  name: string;
  caseId: string;
  bundle: Bundle;
  mutation?: Mutation;
}

export async function judgeMutationRun(opts: JudgeMutationsOptions): Promise<string> {
  const category = categoryOf(opts.category).id;
  const promptVersion = opts.promptVersion ?? listPromptVersions(category).at(-1)!;
  const root = path.join(EVIDENCE_DIR, '_mutations', opts.runId);
  if (!fs.existsSync(root)) throw new Error(`No saved evidence for mutation run ${opts.runId}.`);

  const targets: Target[] = [];
  const load = (evidenceId: string) => {
    try {
      const bundle = loadBundle(evidenceId);
      if (loadDiagnostics(bundle)) return bundle;
    } catch {}
    log(`  ! ${evidenceId} has no complete evidence; not judged`);
    return null;
  };
  for (const caseId of fs.readdirSync(root).sort()) {
    const ids = fs.readdirSync(path.join(root, caseId)).filter((d) => d !== '_control' && (!opts.only?.length || opts.only.includes(d)));
    const variants = ids.flatMap((id) => {
      const mutation = opts.mutations.find((m) => m.case === caseId && m.id === id);
      const bundle = mutation ? load(`_mutations/${opts.runId}/${caseId}/${id}`) : null;
      return mutation && bundle ? [{ name: `${caseId}__${id}`, caseId, bundle, mutation }] : [];
    });
    const control = variants.length ? load(`_mutations/${opts.runId}/${caseId}/_control`) : null;
    if (control) targets.push({ name: caseId, caseId, bundle: control }, ...variants);
  }
  if (!targets.some((t) => t.mutation)) throw new Error(`No variants of mutation run ${opts.runId} to judge in this folder.`);

  // The packets are rebuilt from the current diagnostics, and every prompt is checked before any call.
  for (const t of targets) {
    const packet = buildPacket(category, t.bundle, loadDiagnostics(t.bundle)!, promptVersion);
    writeJson(packetPath(t.bundle, category, promptVersion), packet);
    const dir = bundleDir(t.bundle.caseId, t.bundle.bundleId);
    await ensurePacketImages(packet, dir);
    const req = buildRequest(packet, dir, promptVersion);
    const found = leaks(`${req.instructions}\n${req.userText}`, t.caseId, t.mutation);
    if (found.length) throw new Error(`The prompt for ${t.name} names what was planted (${found.join('; ')}); nothing was judged.`);
  }

  const bases = targets.filter((t) => !t.mutation);
  const variants = targets.filter((t) => t.mutation);
  log(`\n[mutate] judging ${category} ${promptVersion}: ${bases.length} clean control${bases.length > 1 ? 's' : ''} × ${opts.baseRepeats}, ${variants.length} variant${variants.length > 1 ? 's' : ''} × ${opts.repeats}`);
  const runsDir = ensureDir(path.join(ARTIFACTS_DIR, 'mutations', opts.runId, 'judge'));
  const judgeRunId = await runJudge({
    caseIds: targets.map((t) => t.name),
    category,
    provider: opts.provider,
    model: opts.model,
    effort: opts.effort,
    concurrency: opts.concurrency,
    mockMode: opts.mockMode,
    promptVersion,
    repeats: opts.repeats,
    repeatsFor: Object.fromEntries(bases.map((t) => [t.name, opts.baseRepeats])),
    bundles: Object.fromEntries(targets.map((t) => [t.name, t.bundle])),
    runsDir,
    label: `planted variants of mutation run ${opts.runId}`,
  });
  const dir = path.join(runsDir, judgeRunId);
  const { run, judgments } = loadRun(judgeRunId, dir);
  const report = mutationReport(opts.runId, run, judgments, targets);
  writeJson(path.join(dir, 'report.json'), report);
  printReport(report);
  log(`[mutate] judge results written to ${path.relative(process.cwd(), path.join(dir, 'report.json'))}`);
  return dir;
}

export function mutationReport(mutationRunId: string, run: Parameters<typeof summarise>[0], judgments: Parameters<typeof summarise>[1], targets: Pick<Target, 'name' | 'caseId' | 'mutation'>[]) {
  const pairs: PairExpectation[] = targets.flatMap((t) => (t.mutation ? [{ baseline: t.caseId, variant: t.name, expected: expectedChange(t.mutation.id), change: t.mutation.title }] : []));
  const s = summarise(run, judgments, { pairs });
  const cases = new Map(s.cases.map((c) => [c.caseId, c]));
  const verdicts = s.pairs.map((p) => p.verdict);
  return {
    mutationRunId,
    judgeRunId: run.runId,
    category: run.category,
    promptVersion: run.promptVersion,
    provider: run.provider,
    model: run.model,
    effort: run.effort,
    costUsd: s.totals?.costUsd ?? round2(s.cases.reduce((n, c) => n + c.costUsd, 0)),
    counts: {
      as_expected: verdicts.filter((v) => v === 'as_expected').length,
      not_as_expected: verdicts.filter((v) => v === 'not_as_expected').length,
      needs_more_repeats: verdicts.filter((v) => v === 'needs_more_repeats').length,
      insufficient: verdicts.filter((v) => v === 'insufficient').length,
    },
    bases: targets.filter((t) => !t.mutation).map((t) => {
      const c = cases.get(t.name);
      return { caseId: t.caseId, scores: c?.scores ?? [], mean: c?.mean ?? null, materialWeaknessesMean: c?.materialWeaknessesMean ?? null };
    }),
    variants: s.pairs.map((p) => {
      const t = targets.find((x) => x.name === p.variant)!;
      const c = cases.get(p.variant);
      return {
        caseId: t.caseId,
        mutationId: t.mutation!.id,
        kind: t.mutation!.kind,
        title: t.mutation!.title,
        expected: p.expected,
        scores: c?.scores ?? [],
        mean: p.variantMean,
        baseMean: p.baselineMean,
        delta: p.delta,
        pNotHigher: p.pNotHigher,
        materialWeaknessesMean: c?.materialWeaknessesMean ?? null,
        verdict: p.verdict,
      };
    }),
  };
}

const DIRECTION: Record<string, string> = { no_change: 'same', no_rise: 'not higher', must_drop: 'lower' };
const VERDICT: Record<string, string> = { as_expected: 'as expected', not_as_expected: 'NOT as expected', needs_more_repeats: 'needs more repeats', insufficient: 'no valid scores' };

export function printReport(r: ReturnType<typeof mutationReport>) {
  const scores = (list: (number | null)[]) => list.map((x) => x ?? '×').join(' ');
  const num = (x: number | null, sign = false) => (x === null ? '—' : `${sign && x > 0 ? '+' : ''}${x.toFixed(2)}`);
  const cw = Math.max(6, ...r.bases.map((b) => b.caseId.length + 2));
  const w = Math.max(17, ...r.variants.map((v) => v.mutationId.length + 2));
  log(`\n[mutate] ${r.category} ${r.promptVersion}, ${r.provider} ${r.model} (effort ${r.effort}): planted variants against their clean control`);
  log(`${'case'.padEnd(cw)}${'variant'.padEnd(w)}${'expected'.padEnd(12)}${'scores'.padEnd(12)}${'mean'.padEnd(7)}${'Δ'.padEnd(7)}verdict`);
  for (const b of r.bases) {
    log(`${b.caseId.padEnd(cw)}${'(clean control)'.padEnd(w)}${''.padEnd(12)}${scores(b.scores).padEnd(12)}${num(b.mean)}`);
    for (const v of r.variants.filter((x) => x.caseId === b.caseId)) {
      log(`${''.padEnd(cw)}${v.mutationId.padEnd(w)}${DIRECTION[v.expected!].padEnd(12)}${scores(v.scores).padEnd(12)}${num(v.mean).padEnd(7)}${num(v.delta, true).padEnd(7)}${VERDICT[v.verdict]}`);
    }
  }
  const c = r.counts;
  log(`[mutate] ${r.variants.length} variants: ${c.as_expected} as expected, ${c.not_as_expected} not as expected, ${c.needs_more_repeats} need more repeats${c.insufficient ? `, ${c.insufficient} without valid scores` : ''}; $${r.costUsd}`);
}
