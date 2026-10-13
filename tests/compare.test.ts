import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listCases } from '../src/cases.ts';
import { CATEGORIES, categoryOf } from '../src/categories/index.ts';
import { loadExpectations, summarise, summariseRun, type CategoryExpectations, type Expected } from '../src/compare/compare.ts';
import { BENCHMARK_DIR } from '../src/config.ts';
import type { JudgmentRecord, RunRecord } from '../src/judge/record.ts';
import { listRuns, runDir } from '../src/store.ts';
import { readJson } from '../src/util.ts';

// One judgment per score (null: invalid output), with a material weakness under each listed criterion.
function runOf(category: string, scores: Record<string, (number | null)[]>, material: Record<string, string[][]> = {}) {
  const judgments = Object.entries(scores).flatMap(([caseId, list]) =>
    list.map((score, i) => {
      const weak = material[caseId]?.[i] ?? [];
      const criteria = Object.fromEntries(
        categoryOf(category).criteria.map((c) => [
          c.id,
          { summary: '', evaluation_points: {}, findings: weak.includes(c.id) ? [{ id: `${c.id}1`, evaluation_point: '', polarity: 'weakness', materiality: 'material', observation: '', why_it_matters: '', evidence_refs: [], states: [] }] : [] },
        ]),
      );
      return { runId: 'test', category, caseId, repeat: i + 1, status: score === null ? 'invalid_output' : 'ok', latencyMs: 0, costUsd: 0, usage: null, validation: null, output: score === null ? null : { overall: { score }, criteria } } as unknown as JudgmentRecord;
    }),
  );
  const run = { runId: 'test', category, repeats: Math.max(...Object.values(scores).map((s) => s.length)) } as RunRecord;
  return { run, judgments };
}

function verdict(expected: Expected | undefined, baseline: (number | null)[], variant: (number | null)[]) {
  const { run, judgments } = runOf('typography', { a: baseline, b: variant });
  return summarise(run, judgments, { pairs: [{ baseline: 'a', variant: 'b', expected }] }).pairs[0].verdict;
}

const fields = ({ baseline, variant, expected, targetCriteria, delta, pLower, pNotHigher, verdict }: ReturnType<typeof summarise>['pairs'][number]) => ({ baseline, variant, expected, targetCriteria, delta, pLower, pNotHigher, verdict });

describe('compare: expectations per category', () => {
  it('keeps Layout verdicts as they were', () => {
    // The scores of the Sep 30 v5.5 run and the gpt-6-luna v4 run, with the pairs compare reported
    // for them before each category had its own expectations.
    const layout = loadExpectations('layout');
    const v55 = runOf('layout', {
      'booking-baseline': [3, 3, 3, 3, 3],
      'booking-demoted-cta': [2, 2, 3, 3, 3],
      'carsearch-baseline': [2, 2, 3, 3, 3],
      'dashboard-baseline': [3, 3, 3, 4, 3],
      'dashboard-gold': [4, 5, 4, 4, 4],
      'dashboard-mobile-overflow': [2, 2, 2, 2, 2],
    });
    const report = summarise(v55.run, v55.judgments, layout);
    expect(report.hasExpectations).toBe(true);
    expect(report.pairs.map(fields)).toEqual([
      { baseline: 'booking-baseline', variant: 'booking-demoted-cta', expected: 'must_drop', targetCriteria: ['A', 'D'], delta: -0.4, pLower: 0.4, pNotHigher: 1, verdict: 'as_expected' },
      { baseline: 'dashboard-baseline', variant: 'dashboard-mobile-overflow', expected: 'must_drop', targetCriteria: ['C', 'D'], delta: -1.2, pLower: 1, pNotHigher: 1, verdict: 'as_expected' },
    ]);
    expect(Object.fromEntries(report.cases.map((c) => [c.caseId, c.role]))).toMatchObject({ 'booking-baseline': 'baseline', 'carsearch-baseline': 'baseline', 'dashboard-gold': 'baseline' });

    const luna = runOf('layout', { 'booking-baseline': [3, 3, 3, 3, 3], 'booking-demoted-cta': [3, 3, 3, 3, 3], 'dashboard-baseline': [4, 4, 4, 4, null], 'dashboard-mobile-overflow': [3, 2, 2, 2, 2] });
    expect(summarise(luna.run, luna.judgments, layout).pairs.map((p) => [p.delta, p.pLower, p.verdict])).toEqual([
      [0, 0, 'not_as_expected'],
      [-1.8, 1, 'as_expected'],
    ]);
  });

  it("applies only the run's own category's expectations", () => {
    // The Oct 7 Content Quality run: one repeat per interface.
    const cq = runOf('content_quality', { 'booking-baseline': [2], 'booking-demoted-cta': [4], 'dashboard-baseline': [2], 'dashboard-gold': [2], 'dashboard-mobile-overflow': [2] });
    const report = summarise(cq.run, cq.judgments, loadExpectations('content_quality'));
    expect(report.pairs.map(fields)).toEqual([
      { baseline: 'booking-baseline', variant: 'booking-demoted-cta', expected: 'may_drop', targetCriteria: ['A'], delta: 2, pLower: 0, pNotHigher: 0, verdict: 'needs_more_repeats' },
      { baseline: 'dashboard-baseline', variant: 'dashboard-mobile-overflow', expected: 'no_change', targetCriteria: [], delta: 0, pLower: 0, pNotHigher: 1, verdict: 'as_expected' },
    ]);
    // Typography counts the phone table that keeps its desktop width against responsive type (D).
    const ty = runOf('typography', { 'dashboard-baseline': [4], 'dashboard-mobile-overflow': [3] });
    const [overflow] = summarise(ty.run, ty.judgments, loadExpectations('typography')).pairs;
    expect([overflow.variant, overflow.expected, overflow.targetCriteria, overflow.delta, overflow.verdict]).toEqual(['dashboard-mobile-overflow', 'may_drop', ['D'], -1, 'as_expected']);
    expect(loadExpectations('layout')!.pairs.find((p) => p.variant === 'booking-demoted-cta')!.expected).toBe('must_drop');
  });

  it('compares one interface with each of its baselines', () => {
    const expectations: CategoryExpectations = {
      pairs: [
        { baseline: 'dashboard-baseline', variant: 'dashboard-clean', expected: 'may_rise' },
        { baseline: 'dashboard-gold', variant: 'dashboard-clean', expected: 'no_change' },
        { baseline: 'dashboard-baseline', variant: 'dashboard-gold', expected: 'may_rise' },
      ],
    };
    const ty = runOf('typography', { 'dashboard-baseline': [3, 3, 3], 'dashboard-clean': [4, 4, 4], 'dashboard-gold': [4, 4, 3] });
    const report = summarise(ty.run, ty.judgments, expectations);
    expect(report.pairs.map((p) => [p.baseline, p.variant, p.expected, p.verdict])).toEqual([
      ['dashboard-baseline', 'dashboard-clean', 'may_rise', 'as_expected'],
      ['dashboard-gold', 'dashboard-clean', 'no_change', 'as_expected'],
      ['dashboard-baseline', 'dashboard-gold', 'may_rise', 'as_expected'],
    ]);
    expect(report.cases.map((c) => [c.caseId, c.role, c.baseline])).toEqual([
      ['dashboard-baseline', 'baseline', null],
      ['dashboard-clean', 'variant', 'dashboard-baseline, dashboard-gold'],
      ['dashboard-gold', 'variant', 'dashboard-baseline'],
    ]);
    // A pair whose baseline is not in the run is skipped; the others still count.
    const partial = runOf('typography', { 'dashboard-clean': [4, 4, 4], 'dashboard-gold': [4, 4, 4] });
    expect(summarise(partial.run, partial.judgments, expectations).pairs.map((p) => p.baseline)).toEqual(['dashboard-gold']);
  });

  const saved = listRuns().filter((id) => (readJson<RunRecord>(path.join(runDir(id), 'run.json')).category ?? 'layout') !== 'layout');
  it.skipIf(!saved.length)("compares each saved run of another category with that category's expectations", () => {
    for (const id of saved) {
      const report = summariseRun(id);
      const own = loadExpectations(report.run.category)!;
      for (const p of report.pairs) {
        const e = own.pairs.find((x) => x.baseline === p.baseline && x.variant === p.variant)!;
        expect(p.expected, `${id} ${p.variant}`).toBe(e.expected);
        expect(p.targetCriteria, `${id} ${p.variant}`).toEqual(e.criteria ?? []);
      }
    }
  });

  it('reports no expectations for a category without any', () => {
    expect(loadExpectations('no_such_category')).toBeNull();
    const ty = runOf('typography', { 'booking-baseline': [4], 'booking-demoted-cta': [3] });
    const report = summarise(ty.run, ty.judgments, null);
    expect(report.hasExpectations).toBe(false);
    expect(report.pairs).toEqual([]);
    expect(report.cases.map((c) => [c.role, c.baseline])).toEqual([
      ['standalone', null],
      ['standalone', null],
    ]);
  });

  it('counts Content Quality weaknesses under its own criteria, A to C', () => {
    const cq = runOf('content_quality', { 'booking-baseline': [4, 4, 4], 'booking-demoted-cta': [2, 2, 4] }, { 'booking-demoted-cta': [['A'], ['C'], []] });
    const [pair] = summarise(cq.run, cq.judgments, loadExpectations('content_quality')).pairs;
    expect(pair.targetCriteria).toEqual(['A']);
    expect(pair.detection.materialWeaknessInTargetCriteria).toBe(1);
    expect(pair.verdict).toBe('as_expected');
  });

  it("keeps valid sets: known interfaces, each pair once, and each category's own criterion letters", () => {
    const file = readJson<{ categories: Record<string, CategoryExpectations> }>(path.join(BENCHMARK_DIR, 'expectations.json'));
    const cases = listCases();
    for (const [category, set] of Object.entries(file.categories)) {
      expect(Object.keys(CATEGORIES)).toContain(category);
      const letters = categoryOf(category).criteria.map((c) => c.id);
      const seen = new Set<string>();
      for (const e of set.pairs) {
        const where = `${category}/${e.baseline} → ${e.variant}`;
        expect(cases, where).toContain(e.baseline);
        expect(cases, where).toContain(e.variant);
        expect(e.baseline, where).not.toBe(e.variant);
        expect(seen.has(`${e.baseline}|${e.variant}`), where).toBe(false);
        seen.add(`${e.baseline}|${e.variant}`);
        expect(['must_drop', 'may_drop', 'no_change', 'may_rise', 'must_rise'], where).toContain(e.expected);
        for (const c of e.criteria ?? []) expect(letters, where).toContain(c);
      }
      for (const caseId of Object.keys(set.notes ?? {})) expect(cases, `${category} note`).toContain(caseId);
    }
    expect(categoryOf('content_quality').criteria.map((c) => c.id)).toEqual(['A', 'B', 'C']);
  });
});

describe('compare: verdicts and noise', () => {
  it('treats means within half a point as no change', () => {
    expect(verdict('no_change', [4], [4])).toBe('as_expected');
    expect(verdict('no_change', [4, 4, 4], [4, 4, 3])).toBe('as_expected');
    expect(verdict('no_change', [4, 4, 4], [4, 3, 3])).toBe('not_as_expected');
    expect(verdict('no_change', [4, 4, 4, 4, 4], [4, 4, 4, 3, 3])).toBe('as_expected');
    expect(verdict('no_change', [4, 4, 4, 4, 4], [4, 4, 3, 3, 3])).toBe('not_as_expected');
  });

  it('needs more repeats, rather than failing, when either side has fewer than three valid scores', () => {
    expect(verdict('no_change', [4], [3])).toBe('needs_more_repeats');
    // Content Quality's scores step by two when one judgment misses a material weakness.
    expect(verdict('no_change', [2], [4])).toBe('needs_more_repeats');
    expect(verdict('no_change', [4, 4, 4], [3, 3, null])).toBe('needs_more_repeats');
    expect(verdict('must_drop', [4], [4])).toBe('needs_more_repeats');
    expect(verdict('may_drop', [3], [4])).toBe('needs_more_repeats');
    expect(verdict('may_rise', [3], [2])).toBe('needs_more_repeats');
    // A result in the expected direction still counts.
    expect(verdict('must_drop', [4], [3])).toBe('as_expected');
    expect(verdict('may_rise', [3], [3])).toBe('as_expected');
  });

  it('checks may_drop and may_rise as not higher and not lower', () => {
    expect(verdict('may_drop', [3, 3, 3], [3, 3, 3])).toBe('as_expected');
    expect(verdict('may_drop', [3, 3, 3], [3, 4, 4])).toBe('not_as_expected');
    expect(verdict('may_rise', [3, 3, 3], [4, 4, 3])).toBe('as_expected');
    expect(verdict('may_rise', [3, 3, 3], [2, 2, 3])).toBe('not_as_expected');
    expect(verdict('must_drop', [4, 4, 4], [4, 4, 4])).toBe('not_as_expected');
    expect(verdict(undefined, [4], [3])).toBe('insufficient');
  });

  it('checks no-material-weakness interfaces for a mean within half a point of 4 or higher', () => {
    const ty = runOf('typography', { a: [4, 4, 4], b: [4, 4, 4, 4, 2], c: [4, 3, 4, 3, 3], d: [5, 5, 4], e: [3], f: [null, null, null], g: [2] });
    const report = summarise(ty.run, ty.judgments, { pairs: [], no_material_weakness: ['a', 'b', 'c', 'd', 'e', 'f', 'missing'] });
    expect(report.noMaterialWeakness.map((t) => [t.caseId, t.mean, t.verdict])).toEqual([
      ['a', 4, 'as_expected'],
      ['b', 3.6, 'as_expected'],
      ['c', 3.4, 'not_as_expected'],
      ['d', 4.67, 'as_expected'],
      ['e', 3, 'needs_more_repeats'],
      ['f', null, 'insufficient'],
    ]);
    const file = readJson<{ categories: Record<string, CategoryExpectations> }>(path.join(BENCHMARK_DIR, 'expectations.json'));
    for (const [category, set] of Object.entries(file.categories)) for (const id of set.no_material_weakness ?? []) expect(listCases(), `${category} no_material_weakness`).toContain(id);
  });
});
