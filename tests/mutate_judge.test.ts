import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../src/config.ts';
import { categoryOf } from '../src/categories/index.ts';
import type { JudgmentRecord, RunRecord } from '../src/judge/record.ts';
import { categoryForDir, expectedChange, leaks, mutationReport } from '../src/mutate/judge.ts';
import { loadMutations, type Mutation } from '../src/mutate/run.ts';

const mutation = (id: string): Mutation => ({ id, case: 'booking-clean', kind: id.startsWith('harmless-') ? 'harmless' : 'defect', title: `Title of ${id}`, symptom: `What ${id} does.`, where: {}, severity: 'moderate' });

// One judgment per score (null: invalid output); the control is named after its case, as the harness names it.
function judged(scores: Record<string, (number | null)[]>) {
  const criteria = Object.fromEntries(categoryOf('layout').criteria.map((c) => [c.id, { summary: '', evaluation_points: {}, findings: [] }]));
  const judgments = Object.entries(scores).flatMap(([caseId, list]) =>
    list.map((score, i) => ({ runId: 'test', category: 'layout', caseId, repeat: i + 1, status: score === null ? 'invalid_output' : 'ok', latencyMs: 0, costUsd: 0, usage: null, validation: null, output: score === null ? null : { overall: { score }, criteria } }) as unknown as JudgmentRecord),
  );
  const run = { runId: 'test', category: 'layout', provider: 'mock', model: 'mock-ok', effort: 'medium', promptVersion: 'v6', repeats: 3 } as RunRecord;
  return { run, judgments };
}

function report(base: (number | null)[], variants: Record<string, (number | null)[]>) {
  const ids = Object.keys(variants);
  const { run, judgments } = judged({ 'booking-clean': base, ...Object.fromEntries(ids.map((id) => [`booking-clean__${id}`, variants[id]])) });
  const targets = [{ name: 'booking-clean', caseId: 'booking-clean' }, ...ids.map((id) => ({ name: `booking-clean__${id}`, caseId: 'booking-clean', mutation: mutation(id) }))];
  return mutationReport('20261013-000000Z', run, judgments, targets);
}

const verdicts = (r: ReturnType<typeof report>) => Object.fromEntries(r.variants.map((v) => [v.mutationId, v.verdict]));

describe('mutate --judge: expected direction', () => {
  it('reads the direction from the file name alone', () => {
    expect(expectedChange('harmless-retheme-blue')).toBe('no_change');
    expect(expectedChange('mutations/booking-clean/harmless-roomier-form.json')).toBe('no_change');
    expect(expectedChange('date-strip-overflows-phone')).toBe('must_drop');
    expect(expectedChange('not-harmless-at-all')).toBe('must_drop');
    expect(expectedChange('mutations/dashboard-clean/minor-product-rows-misgrouped.json')).toBe('no_rise');
    expect(expectedChange('not-minor-at-all')).toBe('must_drop');
  });

  it('agrees with every planted file: harmless-* files are the harmless changes, minor-* files defects', () => {
    for (const dir of ['mutations', 'mutations-typography', 'mutations-task-fit', 'mutations-content-quality', 'mutations-visual-system', 'mutations-functionality']) {
      for (const m of loadMutations(undefined, path.join(ROOT, dir))) {
        expect(expectedChange(m.id) === 'no_change', `${dir}/${m.case}/${m.id}`).toBe(m.kind === 'harmless');
        if (m.id.startsWith('minor-')) expect(m.kind, `${dir}/${m.case}/${m.id}`).toBe('defect');
      }
    }
  });

  it("judges in the folder's category", () => {
    expect(categoryForDir()).toBe('layout');
    expect(categoryForDir('mutations')).toBe('layout');
    expect(categoryForDir('mutations-typography')).toBe('typography');
    expect(categoryForDir(path.join(ROOT, 'mutations-task-fit'))).toBe('task_fit');
    expect(categoryForDir('mutations-content-quality/')).toBe('content_quality');
    expect(categoryForDir('mutations-visual-system')).toBe('visual_system');
    expect(() => categoryForDir('mutations-colour')).toThrow(/Unknown category/);
  });
});

describe('mutate --judge: verdicts', () => {
  it('expects defects lower and harmless changes the same as the clean control', () => {
    const r = report([4, 4, 4, 4, 4], { 'chart-squashed': [3, 2, 3], 'grid-gap': [4, 4, 4], 'harmless-teal': [4, 4, 4], 'harmless-wider': [3, 3, 3] });
    expect(verdicts(r)).toEqual({ 'chart-squashed': 'as_expected', 'grid-gap': 'not_as_expected', 'harmless-teal': 'as_expected', 'harmless-wider': 'not_as_expected' });
    expect(r.variants.map((v) => [v.mutationId, v.expected, v.delta])).toEqual([
      ['chart-squashed', 'must_drop', -1.33],
      ['grid-gap', 'must_drop', 0],
      ['harmless-teal', 'no_change', 0],
      ['harmless-wider', 'no_change', -1],
    ]);
    expect(r.counts).toEqual({ as_expected: 2, not_as_expected: 2, needs_more_repeats: 0, insufficient: 0 });
    expect(r.bases).toEqual([{ caseId: 'booking-clean', scores: [4, 4, 4, 4, 4], mean: 4, materialWeaknessesMean: 0 }]);
  });

  it('needs most score pairs lower for a drop, and half a point for a change', () => {
    // One repeat as high as the control: 2 of 15 pairs not lower is still 100% not higher.
    expect(verdicts(report([4, 4, 4, 4, 4], { a: [3, 4, 3] })).a).toBe('as_expected');
    // A variant that is sometimes higher than the control is not a drop.
    expect(verdicts(report([3, 4, 3, 4, 3], { a: [3, 5, 2] })).a).toBe('not_as_expected');
    // Within half a point is the same score.
    expect(verdicts(report([4, 4, 4, 4, 5], { 'harmless-a': [4, 4, 4] }))['harmless-a']).toBe('as_expected');
  });

  it('accepts a minor-* defect unless it scores more than half a point higher', () => {
    const r = report([4, 4, 4, 4, 4], { 'minor-same': [4, 4, 4], 'minor-lower': [3, 3, 3], 'minor-slightly-higher': [4, 5, 4], 'minor-higher': [5, 5, 4] });
    expect(r.variants.every((v) => v.expected === 'no_rise')).toBe(true);
    expect(verdicts(r)).toEqual({ 'minor-same': 'as_expected', 'minor-lower': 'as_expected', 'minor-slightly-higher': 'as_expected', 'minor-higher': 'not_as_expected' });
    // The noise guard applies as to any other miss.
    expect(verdicts(report([4], { 'minor-a': [5] }))['minor-a']).toBe('needs_more_repeats');
  });

  it('calls a miss with fewer than three valid scores on either side "needs more repeats"', () => {
    const one = report([4], { a: [4], 'harmless-b': [2] });
    expect(verdicts(one)).toEqual({ a: 'needs_more_repeats', 'harmless-b': 'needs_more_repeats' });
    expect(one.counts.needs_more_repeats).toBe(2);
    // A result in the expected direction does not need repeats to count.
    expect(verdicts(report([4], { a: [2] })).a).toBe('as_expected');
    // Invalid outputs do not count as repeats.
    expect(verdicts(report([4, 4, 4, 4, 4], { a: [4, null, null] })).a).toBe('needs_more_repeats');
    expect(verdicts(report([4, null, null, null, 4], { a: [4, 4, 4] })).a).toBe('needs_more_repeats');
    expect(verdicts(report([4, 4, 4], { a: [4, 4, 4] })).a).toBe('not_as_expected');
    expect(verdicts(report([4, 4, 4], { a: [null, null, null] })).a).toBe('insufficient');
  });
});

describe('mutate --judge: nothing planted reaches the judge', () => {
  it('finds the case, file name, title or symptom in a prompt, whatever the case of the letters', () => {
    const m = mutation('treatment-list-clipped');
    expect(leaks('Interface iface-1a2b3c4d was generated for this request: book a physio appointment.', 'booking-clean', m)).toEqual([]);
    expect(leaks('… see TREATMENT-LIST-CLIPPED …', 'booking-clean', m)).toEqual(['treatment-list-clipped']);
    expect(leaks('… title of treatment-list-clipped …', 'booking-clean', m)).toEqual(['treatment-list-clipped', 'Title of treatment-list-clipped']);
    expect(leaks('evidence from booking-clean', 'booking-clean')).toEqual(['booking-clean']);
  });
});
