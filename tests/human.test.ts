import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listCases } from '../src/cases.ts';
import { listBundles } from '../src/store.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-human-'));
process.env.DJ_HUMAN_DIR = dir;
const caseId = listCases().find((c) => listBundles(c).length);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!caseId)('Human ratings', () => {
  it('stores several ratings per interface, validated like a judgment, with CSVs', async () => {
    const { saveRating, listRatings, deleteRating } = await import('../src/human/store.ts');
    const { loadOrBuildPacket } = await import('../src/categories/index.ts');
    const { buildLayoutRequest } = await import('../src/categories/layout/prompt.ts');
    const { mockProvider } = await import('../src/judge/providers/mock.ts');
    const { bundleDir, loadBundle } = await import('../src/store.ts');
    const bundle = loadBundle(caseId!);
    const packet = loadOrBuildPacket(bundle, 'v5');
    const req = buildLayoutRequest(packet, bundleDir(caseId!, bundle.bundleId), 'v5');
    const res = await mockProvider('ok').call(req, { model: 'm', effort: 'low', caseId: caseId!, repeat: 1, packet });
    const output = JSON.parse(res.outputText!);

    const a = await saveRating(caseId!, { bundleId: bundle.bundleId, promptVersion: 'v5', rater: 'Ada Lovelace', output, startedAt: new Date(Date.now() - 60_000).toISOString() });
    const b = await saveRating(caseId!, { bundleId: bundle.bundleId, promptVersion: 'v5', rater: 'Grace', output });
    expect(a.errors).toBeUndefined();
    expect(a.rating!.ratingId).toMatch(/-ada-lovelace$/);
    expect(a.rating!.durationMs).toBeGreaterThanOrEqual(60_000);
    expect(a.rating!.validation.schemaValid).toBe(true);
    expect(listRatings(caseId!)).toHaveLength(2);
    const rows = fs.readFileSync(path.join(dir, 'ratings.csv'), 'utf8').trim().split('\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^rating_id,case_id,/);
    expect(fs.existsSync(path.join(dir, 'findings.csv'))).toBe(true);

    deleteRating(caseId!, b.rating!.ratingId);
    expect(listRatings(caseId!)).toHaveLength(1);
  });

  it('accepts empty notes and call-outs that cite no evidence', async () => {
    const { saveRating } = await import('../src/human/store.ts');
    const { loadBundle } = await import('../src/store.ts');
    const { layoutOutputJsonSchema } = await import('../src/categories/layout/schema.ts');
    const bundle = loadBundle(caseId!);
    const empty = (node: any): unknown =>
      node.type === 'object' ? Object.fromEntries(Object.entries(node.properties).map(([k, v]) => [k, empty(v)])) : node.type === 'array' ? [] : node.type === 'boolean' ? true : node.enum ? node.enum[0] : '';
    const output = empty(layoutOutputJsonSchema(undefined, { decisive: false })) as any;
    output.criteria.A.findings.push({ id: 'A1', evaluation_point: 'primary_focus', polarity: 'weakness', materiality: 'material', observation: 'The CTA is below the fold on phones.', why_it_matters: '', evidence_refs: [], states: [] });
    const res = await saveRating(caseId!, { bundleId: bundle.bundleId, promptVersion: 'v6', rater: 'Ada', output });
    expect(res.errors).toBeUndefined();
    expect(res.rating!.validation.refIssues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('records the live view, with one note per criterion and no per-point rows', async () => {
    const { makeRating, humanCsvs } = await import('../src/human/rating.ts');
    const { loadOrBuildPacket } = await import('../src/categories/index.ts');
    const { loadBundle } = await import('../src/store.ts');
    const { layoutOutputJsonSchema } = await import('../src/categories/layout/schema.ts');
    const bundle = loadBundle(caseId!);
    const empty = (node: any): unknown =>
      node.type === 'object' ? Object.fromEntries(Object.entries(node.properties).map(([k, v]) => [k, empty(v)])) : node.type === 'array' ? [] : node.type === 'boolean' ? true : node.enum ? node.enum[0] : '';
    const output = empty(layoutOutputJsonSchema(undefined, { decisive: false })) as any;
    output.criteria.A.summary = 'The booking button is easy to find on desktop but drops below the fold on phones.';
    const ctx = { caseId: caseId!, bundleId: bundle.bundleId, interfaceId: bundle.interfaceId, promptVersion: 'v6', promptHash: 'p', packetHash: 'k', packet: loadOrBuildPacket(bundle, 'v6') };
    const live = makeRating(ctx, { bundleId: bundle.bundleId, promptVersion: 'v6', rater: 'Ada', output, view: 'live' }).rating!;
    const unknown = makeRating(ctx, { bundleId: bundle.bundleId, promptVersion: 'v6', rater: 'Ada', output, view: 'anything' }).rating!;
    expect(live.view).toBe('live');
    expect(unknown.view).toBe('screenshots');
    const csvs = humanCsvs([live]);
    expect(csvs['ratings.csv']).toContain(',live,');
    expect(csvs['ratings.csv']).toContain('drops below the fold on phones');
    expect(csvs['points.csv'].trim().split('\n')).toHaveLength(1);
  });

  it('rejects output that does not match the schema, and a missing rater', async () => {
    const { saveRating } = await import('../src/human/store.ts');
    const { loadBundle } = await import('../src/store.ts');
    const bundle = loadBundle(caseId!);
    const bad = await saveRating(caseId!, { bundleId: bundle.bundleId, promptVersion: 'v5', rater: 'Ada', output: { criteria: {} } });
    expect(bad.errors?.length).toBeGreaterThan(0);
    const noName = await saveRating(caseId!, { bundleId: bundle.bundleId, promptVersion: 'v5', rater: '  ', output: {} });
    expect(noName.errors).toEqual(['Enter your name as the rater.']);
  });
});
