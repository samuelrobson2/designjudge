import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAYOUT_RUBRIC_PATH } from '../src/config.ts';
import { LAYOUT_ANCHORS, LAYOUT_CRITERIA } from '../src/categories/layout/definition.ts';
import { layoutOutputJsonSchema } from '../src/categories/layout/schema.ts';
import type { Packet } from '../src/categories/types.ts';
import { estimateCost } from '../src/judge/pricing.ts';
import { mockProvider } from '../src/judge/providers/mock.ts';
import { validateJudgment } from '../src/judge/validate.ts';

const rubric = fs.readFileSync(LAYOUT_RUBRIC_PATH, 'utf8');

describe('Layout category definition', () => {
  it('matches the criteria, evaluation points, and anchors in layout_rubric.md', () => {
    for (const c of LAYOUT_CRITERIA) {
      expect(rubric).toContain(`${c.id}/ ${c.name}`);
      for (const p of c.points) expect(rubric).toContain(`**${p.name}:**`);
    }
    for (const a of LAYOUT_ANCHORS) expect(rubric).toMatch(new RegExp(`\\*\\*${a.score}\\s*[:-]\\s*${a.label}`));
  });
});

describe('Output schema', () => {
  it('is strict-mode compatible: every object is closed and requires all its properties', () => {
    const walk = (node: any, path: string) => {
      if (node && node.type === 'object') {
        expect(node.additionalProperties, path).toBe(false);
        expect([...node.required].sort(), path).toEqual(Object.keys(node.properties).sort());
        for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.${k}`);
      }
      if (node && node.type === 'array') walk(node.items, `${path}[]`);
    };
    walk(layoutOutputJsonSchema(), '$');
    walk(layoutOutputJsonSchema(undefined, { describe: true, decisive: false, materiality: 'v5' }), '$');
  });

  it('asks for decisive findings unless turned off, and describes materiality per version', () => {
    const overall = (s: any) => Object.keys(s.properties.overall.properties);
    const materiality = (s: any) => s.properties.criteria.properties.A.properties.findings.items.properties.materiality.description;
    const v4 = layoutOutputJsonSchema(undefined, { describe: true });
    const v5 = layoutOutputJsonSchema(undefined, { describe: true, decisive: false, materiality: 'v5' });
    expect(overall(v4)).toContain('decisive_finding_ids');
    expect(overall(v5)).not.toContain('decisive_finding_ids');
    expect(materiality(v4)).toMatch(/^material if it affects/);
    expect(materiality(v5)).toMatch(/notice the difference/);
  });
});

const packet: Packet = {
  packetVersion: 'test',
  category: 'layout',
  bundleId: 'b',
  caseId: 'c',
  interfaceId: 'iface-test',
  request: 'Test request',
  evidence: {},
  images: [],
  index: {
    'S-desktop-viewport': { type: 'screenshot', stateId: 'desktop' },
    'C-page_horizontal_overflow-mobile': { type: 'check', stateId: 'mobile', resultKey: 'page_horizontal_overflow@mobile', status: 'fail' },
    'C-region_overlap-desktop': { type: 'check', stateId: 'desktop', resultKey: 'region_overlap@desktop', status: 'pass' },
    'C-content_growth_failures': { type: 'check', stateId: null, resultKey: 'content_growth_failures', status: 'unavailable' },
  },
  selectionNotes: [],
  builtAt: '',
};

const fakeReq = { instructions: 'x', userText: 'y', images: [] } as any;

describe('Mock provider and validation', () => {
  it('produces schema-valid output whose references all resolve', async () => {
    const res = await mockProvider('ok').call(fakeReq, { model: 'm', effort: 'low', caseId: 'c', repeat: 1, packet });
    const { output, validation } = validateJudgment(JSON.parse(res.outputText!), packet);
    expect(validation.schemaValid).toBe(true);
    expect(output!.overall.score).toBe(3);
    expect(validation.refIssues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('flags unknown references', async () => {
    const res = await mockProvider('unknown_refs').call(fakeReq, { model: 'm', effort: 'low', caseId: 'c', repeat: 1, packet });
    const { validation } = validateJudgment(JSON.parse(res.outputText!), packet);
    expect(validation.refIssues.some((i) => i.problem === 'unknown_id')).toBe(true);
  });

  it('flags a weakness that cites missing evidence as if it were observed', async () => {
    const res = await mockProvider('ok').call(fakeReq, { model: 'm', effort: 'low', caseId: 'c', repeat: 1, packet });
    const out = JSON.parse(res.outputText!);
    out.criteria.B.findings.push({
      id: 'B9',
      evaluation_point: 'content_fit',
      polarity: 'weakness',
      materiality: 'material',
      observation: 'Long strings break the layout',
      why_it_matters: 'x',
      evidence_refs: ['C-content_growth_failures'],
      states: ['desktop'],
    });
    const { validation } = validateJudgment(out, packet);
    expect(validation.refIssues.some((i) => i.problem === 'cites_missing_evidence_as_observed')).toBe(true);
  });

  it('rejects output that does not match the schema', () => {
    const { validation } = validateJudgment({ criteria: {} }, packet);
    expect(validation.schemaValid).toBe(false);
  });
});

describe('Cost estimate', () => {
  it('prices cached and uncached input separately', () => {
    const cost = estimateCost('gpt-6-sol', { inputTokens: 50_000, cachedInputTokens: 40_000, outputTokens: 5_000, reasoningTokens: 3_000 });
    // 10k uncached × $2 + 40k cached × $0.20 + 5k output × $10, per million.
    expect(cost).toBeCloseTo(0.02 + 0.008 + 0.05, 6);
  });
});
