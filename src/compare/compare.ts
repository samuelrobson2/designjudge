import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACTS_DIR, BENCHMARK_DIR } from '../config.ts';
import { LAYOUT_CRITERIA } from '../categories/layout/definition.ts';
import { loadOrBuildPacket } from '../categories/index.ts';
import type { JudgmentRecord, RunRecord } from '../judge/record.ts';
import { CHECK_HEADER, SUMMARY_HEADER, checkRows, citations, csv, summaryRow } from '../report/csv.ts';
import { loadBundle, loadDiagnostics, runDir } from '../store.ts';
import { log, readJson, round2, timestampId, writeJson } from '../util.ts';

export interface CaseExpectation {
  role: 'baseline' | 'variant' | 'standalone';
  baseline?: string;
  change?: string;
  expected?: 'must_drop' | 'may_drop' | 'no_change' | 'must_rise';
  criteria?: string[];
  targets?: { checks?: { diagId: string; stateId?: string }[] };
}

export function loadExpectations(): Record<string, CaseExpectation> {
  const file = path.join(BENCHMARK_DIR, 'expectations.json');
  if (!fs.existsSync(file)) return {};
  return readJson<{ cases: Record<string, CaseExpectation> }>(file).cases ?? {};
}

export function loadRun(runId: string): { run: RunRecord; judgments: JudgmentRecord[] } {
  const dir = runDir(runId);
  const run = readJson<RunRecord>(path.join(dir, 'run.json'));
  const judgments: JudgmentRecord[] = [];
  const jdir = path.join(dir, 'judgments');
  if (fs.existsSync(jdir)) {
    const caseIds = fs.readdirSync(jdir).filter((d) => fs.statSync(path.join(jdir, d)).isDirectory());
    for (const caseId of caseIds.sort()) {
      const files = fs.readdirSync(path.join(jdir, caseId)).filter((f) => f.endsWith('.json'));
      for (const f of files.sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))) {
        judgments.push(readJson<JudgmentRecord>(path.join(jdir, caseId, f)));
      }
    }
  }
  return { run, judgments };
}

function stats(values: number[]) {
  if (!values.length) return { n: 0, mean: null, sd: null, min: null, max: null, mode: null, modeShare: null };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = values.length > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)) : 0;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [mode, count] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  return { n: values.length, mean: round2(mean), sd: round2(sd), min: Math.min(...values), max: Math.max(...values), mode, modeShare: round2(count / values.length) };
}

function weaknesses(j: JudgmentRecord) {
  if (!j.output) return [];
  return LAYOUT_CRITERIA.flatMap((c) => j.output!.criteria[c.id].findings.filter((f) => f.polarity !== 'strength').map((f) => ({ ...f, criterion: c.id })));
}

export function summariseRun(runId: string) {
  const { run, judgments } = loadRun(runId);
  const expectations = loadExpectations();
  const byCase = new Map<string, JudgmentRecord[]>();
  for (const j of judgments) byCase.set(j.caseId, [...(byCase.get(j.caseId) ?? []), j]);

  const cases = [...byCase.entries()].map(([caseId, js]) => {
    const scores = js.map((j) => j.output?.overall.score ?? null);
    const valid = scores.filter((s): s is number => s !== null);
    const refs = js.reduce((s, j) => s + (j.validation?.stats.refs ?? 0), 0);
    const validRefs = js.reduce((s, j) => s + (j.validation?.stats.validRefs ?? 0), 0);
    const exp = expectations[caseId];
    return {
      caseId,
      role: exp?.role ?? 'standalone',
      baseline: exp?.baseline ?? null,
      scores,
      ...stats(valid),
      invalid: js.filter((j) => j.status === 'invalid_output').length,
      errors: js.filter((j) => j.status === 'provider_error').length,
      refValidity: refs ? round2(validRefs / refs) : null,
      refErrors: js.reduce((s, j) => s + (j.validation?.refIssues.filter((i) => i.severity === 'error').length ?? 0), 0),
      refReviews: js.reduce((s, j) => s + (j.validation?.refIssues.filter((i) => i.severity === 'review').length ?? 0), 0),
      findingsMean: round2(js.reduce((s, j) => s + (j.validation?.stats.findings ?? 0), 0) / Math.max(1, js.length)),
      materialWeaknessesMean: round2(js.reduce((s, j) => s + weaknesses(j).filter((f) => f.materiality === 'material').length, 0) / Math.max(1, js.length)),
      costUsd: round2(js.reduce((s, j) => s + (j.costUsd ?? 0), 0) * 100) / 100,
      latencyMsMean: Math.round(js.reduce((s, j) => s + j.latencyMs, 0) / Math.max(1, js.length)),
      inputTokensMean: Math.round(js.reduce((s, j) => s + (j.usage?.inputTokens ?? 0), 0) / Math.max(1, js.length)),
      cachedTokensMean: Math.round(js.reduce((s, j) => s + (j.usage?.cachedInputTokens ?? 0), 0) / Math.max(1, js.length)),
      outputTokensMean: Math.round(js.reduce((s, j) => s + (j.usage?.outputTokens ?? 0), 0) / Math.max(1, js.length)),
      humanScore: null as number | null,
      humanNotes: '',
    };
  });

  const pairs = cases
    .filter((c) => c.role === 'variant' && c.baseline && byCase.has(c.baseline))
    .map((v) => {
      const b = cases.find((c) => c.caseId === v.baseline)!;
      const exp = expectations[v.caseId];
      const bs = b.scores.filter((s): s is number => s !== null);
      const vs = v.scores.filter((s): s is number => s !== null);
      let lower = 0;
      let notHigher = 0;
      let total = 0;
      for (const x of bs)
        for (const y of vs) {
          total++;
          if (y < x) lower++;
          if (y <= x) notHigher++;
        }
      const delta = v.mean !== null && b.mean !== null ? round2(v.mean - b.mean) : null;
      const pLower = total ? round2(lower / total) : null;
      const pNotHigher = total ? round2(notHigher / total) : null;
      let verdict: 'as_expected' | 'not_as_expected' | 'insufficient' = 'insufficient';
      if (delta !== null && pNotHigher !== null && pLower !== null) {
        if (exp?.expected === 'must_drop') verdict = delta < 0 && pNotHigher >= 0.8 ? 'as_expected' : 'not_as_expected';
        else if (exp?.expected === 'may_drop') verdict = delta <= 0 ? 'as_expected' : 'not_as_expected';
        else if (exp?.expected === 'no_change') verdict = Math.abs(delta) < 0.5 ? 'as_expected' : 'not_as_expected';
        else if (exp?.expected === 'must_rise') verdict = delta > 0 && 1 - pNotHigher >= 0.8 ? 'as_expected' : 'not_as_expected';
      }
      // Automated detection: a weakness cites the planted defect's target check, or falls in a target criterion.
      const targetChecks = exp?.targets?.checks ?? [];
      const variantJudgments = byCase.get(v.caseId) ?? [];
      const cited = variantJudgments.filter((j) =>
        weaknesses(j).some((f) =>
          f.evidence_refs.some((ref) =>
            targetChecks.some((t) => ref.startsWith(`C-${t.diagId}${t.stateId ? `-${t.stateId}` : ''}`) || ref.startsWith(`F-${t.diagId}${t.stateId ? `-${t.stateId}` : ''}`)),
          ),
        ),
      ).length;
      const criterionHit = variantJudgments.filter((j) =>
        weaknesses(j).some((f) => f.materiality === 'material' && (exp?.criteria ?? []).includes(f.criterion)),
      ).length;
      return {
        baseline: b.caseId,
        variant: v.caseId,
        change: exp?.change ?? '',
        expected: exp?.expected ?? null,
        targetCriteria: exp?.criteria ?? [],
        baselineMean: b.mean,
        variantMean: v.mean,
        delta,
        pLower,
        pNotHigher,
        verdict,
        detection: {
          repeats: variantJudgments.length,
          citedTargetCheck: targetChecks.length ? cited : null,
          materialWeaknessInTargetCriteria: criterionHit,
          needsHumanReview: targetChecks.length === 0 || cited < variantJudgments.length,
        },
      };
    });

  return {
    runId,
    generatedAt: new Date().toISOString(),
    run: { provider: run.provider, model: run.model, effort: run.effort, promptVersion: run.promptVersion, promptHash: run.promptHash, repeats: run.repeats, label: run.label ?? null },
    totals: run.totals ?? null,
    cases,
    pairs,
  };
}

function writeCsvs(runId: string) {
  const { run, judgments } = loadRun(runId);
  const expectations = loadExpectations();
  const dir = runDir(runId);
  const summaryRows: (string | number | null | undefined)[][] = [SUMMARY_HEADER];
  const checkRowsOut: (string | number | null | undefined)[][] = [CHECK_HEADER];
  const findingRows: (string | number | null)[][] = [
    ['run_id', 'case_id', 'repeat', 'criterion', 'finding_id', 'evaluation_point', 'polarity', 'materiality', 'decisive', 'evidence_refs', 'states', 'ref_issues', 'observation', 'why_it_matters', 'human_evidence_supports_finding', 'human_finding_is_valid', 'human_notes'],
  ];
  for (const c of run.cases) {
    const bundle = loadBundle(c.caseId, c.bundleId);
    const diags = loadDiagnostics(bundle);
    if (!diags) continue;
    const packet = loadOrBuildPacket(bundle, run.promptVersion);
    const js = judgments.filter((j) => j.caseId === c.caseId);
    const role = expectations[c.caseId]?.role ?? 'standalone';
    for (const j of js) summaryRows.push(summaryRow(bundle, diags, { runId, role, packet, judgment: j, run }));
    checkRowsOut.push(...checkRows(bundle, diags, { runId, packet, cited: citations(js, diags), judgments: js.length }));
  }
  // Every evaluation-point assessment, one row each.
  const pointRows: (string | number | null)[][] = [['run_id', 'case_id', 'repeat', 'criterion', 'evaluation_point', 'point_name', 'applicable', 'assessment', 'human_agrees', 'human_notes']];
  for (const j of judgments) {
    if (!j.output) continue;
    for (const c of LAYOUT_CRITERIA) {
      for (const p of c.points) {
        const e = j.output.criteria[c.id]?.evaluation_points[p.key];
        pointRows.push([runId, j.caseId, j.repeat, c.id, p.key, p.name, e ? (e.applicable ? 'yes' : 'no') : '', e?.assessment ?? '', '', '']);
      }
    }
  }
  for (const j of judgments) {
    if (!j.output) continue;
    const decisive = new Set(j.output.overall.decisive_finding_ids ?? []);
    for (const c of LAYOUT_CRITERIA) {
      for (const f of j.output.criteria[c.id].findings) {
        const issues = (j.validation?.refIssues ?? []).filter((i) => i.findingId === f.id).map((i) => `${i.problem}${i.ref ? `:${i.ref}` : ''}`);
        findingRows.push([
          runId, j.caseId, j.repeat, c.id, f.id, f.evaluation_point, f.polarity, f.materiality, decisive.has(f.id) ? 'yes' : '',
          f.evidence_refs.join(' '), f.states.join(' '), issues.join(' '), f.observation, f.why_it_matters, '', '', '',
        ]);
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'summary.csv'), csv(summaryRows));
  fs.writeFileSync(path.join(dir, 'checks.csv'), csv(checkRowsOut));
  fs.writeFileSync(path.join(dir, 'findings.csv'), csv(findingRows));
  fs.writeFileSync(path.join(dir, 'points.csv'), csv(pointRows));
}

export function compareRuns(runIds: string[]) {
  const reports = runIds.map((id) => {
    const report = summariseRun(id);
    writeJson(path.join(runDir(id), 'report.json'), report);
    writeCsvs(id);
    return report;
  });

  for (const r of reports) {
    log(`\n=== ${r.runId} (${r.run.model}, effort ${r.run.effort}, prompt ${r.run.promptVersion}) ===`);
    log('case                          scores           mean   sd   mode-share  ref-valid  cost');
    for (const c of r.cases) {
      log(
        `${c.caseId.padEnd(30)}${c.scores.map((s) => s ?? '×').join(' ').padEnd(17)}${String(c.mean ?? '—').padEnd(7)}${String(c.sd ?? '—').padEnd(5)}${String(c.modeShare ?? '—').padEnd(12)}${String(c.refValidity ?? '—').padEnd(11)}$${c.costUsd.toFixed(3)}`,
      );
    }
    for (const p of r.pairs) {
      log(`pair ${p.baseline} → ${p.variant}: Δ ${p.delta} (expected ${p.expected}), P(variant<baseline) ${p.pLower}, verdict ${p.verdict}; target check cited in ${p.detection.citedTargetCheck ?? 'n/a'}/${p.detection.repeats} repeats`);
    }
    if (r.totals) log(`totals: ${r.totals.ok}/${r.totals.calls} ok, $${r.totals.costUsd}, mean latency ${r.totals.latencyMsMean} ms`);
  }

  if (reports.length > 1) {
    const file = path.join(ARTIFACTS_DIR, 'comparisons', `${timestampId()}.json`);
    const caseIds = [...new Set(reports.flatMap((r) => r.cases.map((c) => c.caseId)))];
    writeJson(file, {
      generatedAt: new Date().toISOString(),
      runs: reports.map((r) => ({ runId: r.runId, ...r.run })),
      cases: caseIds.map((id) => ({
        caseId: id,
        byRun: reports.map((r) => {
          const c = r.cases.find((x) => x.caseId === id);
          return { runId: r.runId, mean: c?.mean ?? null, sd: c?.sd ?? null, scores: c?.scores ?? [] };
        }),
      })),
      pairs: reports.flatMap((r) => r.pairs.map((p) => ({ runId: r.runId, ...p }))),
    });
    log(`\nCross-run comparison written to ${path.relative(process.cwd(), file)}`);
  }
  return reports;
}
