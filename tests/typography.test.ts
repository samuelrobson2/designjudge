import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TYPOGRAPHY_RUBRIC_PATH } from '../src/config.ts';
import { layoutOutputJsonSchema } from '../src/categories/layout/schema.ts';
import { TYPOGRAPHY_ANCHORS, TYPOGRAPHY_CRITERIA } from '../src/categories/typography/definition.ts';
import { parseTypographyRubric } from '../src/categories/typography/packet.ts';
import type { Packet } from '../src/categories/types.ts';
import { mockProvider } from '../src/judge/providers/mock.ts';
import { validateJudgment } from '../src/judge/validate.ts';

const rubric = fs.readFileSync(TYPOGRAPHY_RUBRIC_PATH, 'utf8');

describe('Typography category definition', () => {
  it('matches the criteria, evaluation points, and anchors in typography_rubric.md', () => {
    for (const c of TYPOGRAPHY_CRITERIA) {
      expect(rubric).toContain(`${c.id}/ ${c.name}`);
      for (const p of c.points) expect(rubric).toContain(`**${p.name}:**`);
    }
    for (const a of TYPOGRAPHY_ANCHORS) expect(rubric).toMatch(new RegExp(`\\*\\*${a.score}\\s*[:-]\\s*${a.label}`));
  });
});

describe('typography_rubric.md parsing', () => {
  const parsed = parseTypographyRubric();

  it('finds the check and the six observations, each with a pass definition or reference values', () => {
    expect(parsed.diagnostics.map((d) => d.diagId)).toEqual([
      'invalid_text_rendering',
      'type_scale',
      'font_families',
      'size_weight_profile',
      'line_height',
      'heading_line_balance',
      'responsive_typography',
    ]);
    for (const d of parsed.diagnostics) {
      if (d.kind === 'deterministic') expect(d.pass, d.name).toBeTruthy();
      else expect(d.reference, d.name).toBeTruthy();
    }
  });

  it("maps each criterion's evidence to diagnostics and reads the Typography scoring", () => {
    const map = Object.fromEntries(parsed.criteria.map((c) => [c.id, c.diagIds]));
    expect(Object.keys(map)).toEqual(['A', 'B', 'C', 'D']);
    expect(map.B).toContain('invalid_text_rendering');
    expect(map.D).toContain('responsive_typography');
    expect(parsed.heading).toBe('## 2. Typography');
    expect(parsed.title).toBe('Typography');
  });
});

describe('Typography judgments', () => {
  const packet: Packet = {
    schemaVersion: 1,
    packetVersion: 'typography-packet-v1',
    category: 'typography',
    bundleId: 'b',
    caseId: 'c',
    interfaceId: 'iface-test',
    request: 'A page.',
    states: [],
    images: [{ id: 'S-type-specimen-desktop', stateId: 'desktop', kind: 'composed', path: 'typography/x.png', caption: '', detail: 'original', estimatedTokens: 100 }],
    index: {
      'S-type-specimen-desktop': { type: 'screenshot', stateId: 'desktop' },
      'F-invalid_text_rendering-desktop-1': { type: 'check', status: 'fail', stateId: 'desktop', resultKey: 'invalid_text_rendering@desktop' },
    },
    evidence: {},
    notes: [],
  } as unknown as Packet;
  const schema = layoutOutputJsonSchema(TYPOGRAPHY_CRITERIA, { describe: true, decisive: false, materiality: 'reading', category: 'Typography' }) as any;

  it('the schema names Typography and its evaluation points', () => {
    expect(schema.properties.overall.properties.score.description).toContain('Typography');
    const points = (schema.properties.criteria.properties as Record<string, any>).B.properties.findings.items.properties.evaluation_point.enum;
    expect(points).toEqual(TYPOGRAPHY_CRITERIA.find((c) => c.id === 'B')!.points.map((p) => p.key));
  });

  it('validates mock output against the Typography criteria, and rejects Layout point keys', async () => {
    const res = await mockProvider('ok').call({ category: 'typography', schema, instructions: '', userText: '', images: [] } as never, { model: 'm', effort: 'e', caseId: 'c', repeat: 1, packet });
    const v = validateJudgment(JSON.parse(res.outputText!), packet);
    expect(v.validation.schemaValid).toBe(true);
    expect(v.output!.criteria.B.findings[0].evaluation_point).toBe('readable_sizing');
    expect(v.validation.refIssues.filter((i) => i.severity === 'error')).toEqual([]);

    const wrong = JSON.parse(res.outputText!);
    wrong.criteria.A.findings[0].evaluation_point = 'primary_focus';
    expect(validateJudgment(wrong, packet).validation.schemaValid).toBe(false);
  });
});
