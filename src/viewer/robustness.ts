// A category's robustness tests: the single defects planted in the clean interfaces
// (mutations*/<case>-clean/), with the scores of the newest real judge run of them. Each variant
// is checked in the direction its current file name implies, so a mutation renamed after it was
// judged (e.g. given the minor- prefix) is matched on its base name and checked as it is named now.

import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACTS_DIR, ROOT } from '../config.ts';
import { loadRun } from '../compare/compare.ts';
import { expectedChange, mutationReport } from '../mutate/judge.ts';
import { loadMutations, type Mutation } from '../mutate/run.ts';
import { readJson } from '../util.ts';
import { productOf } from './grid.ts';

const MUTATION_RUNS = path.join(ARTIFACTS_DIR, 'mutations');

export const mutationsDirFor = (category: string) => path.join(ROOT, category === 'layout' ? 'mutations' : `mutations-${category.replace(/_/g, '-')}`);

const baseName = (id: string) => id.replace(/^(harmless|minor)-/, '');

interface SavedReport {
  mutationRunId: string;
  judgeRunId: string;
  category: string;
  provider: string;
  bases: { caseId: string }[];
  variants: { caseId: string; mutationId: string; kind: string; title: string }[];
}

// The newest real (not mock) judge run of planted clean-case variants in a category: from the newest
// mutation run with one, its newest judge run.
export function latestMutationJudgeRun(category: string): { dir: string; report: SavedReport } | null {
  if (!fs.existsSync(MUTATION_RUNS)) return null;
  for (const runId of fs.readdirSync(MUTATION_RUNS).sort().reverse()) {
    const judgeDir = path.join(MUTATION_RUNS, runId, 'judge');
    if (!fs.existsSync(judgeDir)) continue;
    for (const judgeRunId of fs.readdirSync(judgeDir).sort().reverse()) {
      const file = path.join(judgeDir, judgeRunId, 'report.json');
      if (!fs.existsSync(file)) continue;
      const report = readJson<SavedReport>(file);
      if (report.category !== category || report.provider === 'mock') continue;
      if (!report.variants.some((v) => v.caseId.endsWith('-clean'))) continue;
      return { dir: path.join(judgeDir, judgeRunId), report };
    }
  }
  return null;
}

export const DIRECTION: Record<string, string> = { no_change: 'same', no_rise: 'not higher', must_drop: 'lower' };

export function robustness(category: string) {
  const found = latestMutationJudgeRun(category);
  if (!found) return { category, judgeRun: null, rows: [], counts: { total: 0, asExpected: 0 } };
  const current = loadMutations(undefined, mutationsDirFor(category)).filter((m) => m.case.endsWith('-clean'));
  const { run, judgments } = loadRun(found.report.judgeRunId, found.dir);
  const variants = found.report.variants
    .filter((v) => v.caseId.endsWith('-clean'))
    .map((v) => {
      const now = current.find((m) => m.case === v.caseId && m.id === v.mutationId) ?? current.find((m) => m.case === v.caseId && baseName(m.id) === baseName(v.mutationId));
      const mutation = now ?? ({ id: v.mutationId, case: v.caseId, kind: v.kind, title: v.title, symptom: '' } as Mutation);
      return { name: `${v.caseId}__${v.mutationId}`, caseId: v.caseId, mutation, judgedAs: v.mutationId };
    });
  const bases = found.report.bases.filter((b) => b.caseId.endsWith('-clean')).map((b) => ({ name: b.caseId, caseId: b.caseId }));
  const report = mutationReport(found.report.mutationRunId, run, judgments, [...bases, ...variants]);
  const rows = report.variants.map((v) => {
    const t = variants.find((x) => x.caseId === v.caseId && x.mutation.id === v.mutationId)!;
    return {
      product: productOf(v.caseId)?.name ?? v.caseId,
      caseId: v.caseId,
      mutationId: v.mutationId,
      judgedAs: t.judgedAs,
      description: v.title,
      expected: v.expected,
      direction: DIRECTION[expectedChange(v.mutationId)],
      controlScores: report.bases.find((b) => b.caseId === v.caseId)?.scores ?? [],
      controlMean: v.baseMean,
      variantScores: v.scores,
      variantMean: v.mean,
      delta: v.delta,
      verdict: v.verdict,
    };
  });
  return {
    category,
    judgeRun: { mutationRunId: report.mutationRunId, judgeRunId: report.judgeRunId, promptVersion: report.promptVersion, model: report.model, effort: report.effort },
    rows,
    counts: { total: rows.length, asExpected: rows.filter((r) => r.verdict === 'as_expected').length },
  };
}
