import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUAL_SYSTEM_RUBRIC_PATH } from '../src/config.ts';
import type { ContrastRecord, VisualProbeState } from '../src/collect/probeTypes.ts';
import { layoutOutputJsonSchema } from '../src/categories/layout/schema.ts';
import type { Packet } from '../src/categories/types.ts';
import { VISUAL_SYSTEM_ANCHORS, VISUAL_SYSTEM_CRITERIA } from '../src/categories/visual_system/definition.ts';
import { parseVisualSystemRubric } from '../src/categories/visual_system/packet.ts';
import { Doc } from '../src/diagnostics/doc.ts';
import { apcaLc, contrastRatio, isLargeText, oklabDistance } from '../src/diagnostics/visual_system/color.ts';
import { contrastProfile, requiredContrast } from '../src/diagnostics/visual_system/checks.ts';
import { mockProvider } from '../src/judge/providers/mock.ts';
import { validateJudgment } from '../src/judge/validate.ts';

const rubric = fs.readFileSync(VISUAL_SYSTEM_RUBRIC_PATH, 'utf8');

describe('Visual System category definition', () => {
  it('matches the criteria, evaluation points, and anchors in visual_system_rubric.md', () => {
    for (const c of VISUAL_SYSTEM_CRITERIA) {
      expect(rubric).toContain(`${c.id}/ ${c.name}`);
      for (const p of c.points) expect(rubric).toContain(`**${p.name}:**`);
    }
    for (const a of VISUAL_SYSTEM_ANCHORS) expect(rubric).toMatch(new RegExp(`\\*\\*${a.score}\\s*[:-]\\s*${a.label}`));
  });
});

describe('visual_system_rubric.md parsing', () => {
  const parsed = parseVisualSystemRubric();

  it('finds the four checks and three observations, each with a pass definition or reference values', () => {
    expect(parsed.diagnostics.map((d) => d.diagId)).toEqual([
      'accessibility_violations',
      'required_contrast',
      'focus_visibility',
      'target_size',
      'style_vocabulary',
      'contrast_profile',
      'peer_consistency',
    ]);
    for (const d of parsed.diagnostics) {
      if (d.kind === 'deterministic') expect(d.pass, d.name).toBeTruthy();
      else expect(d.reference, d.name).toBeTruthy();
    }
  });

  it("maps each criterion's evidence to diagnostics and reads the Visual System scoring", () => {
    const map = Object.fromEntries(parsed.criteria.map((c) => [c.id, c.diagIds]));
    expect(Object.keys(map)).toEqual(['A', 'B', 'C']);
    expect(map.A).toEqual(['required_contrast', 'contrast_profile', 'style_vocabulary']);
    expect(map.B).toEqual(['style_vocabulary', 'peer_consistency']);
    expect(map.C).toEqual(expect.arrayContaining(['accessibility_violations', 'focus_visibility', 'target_size']));
    expect(parsed.title).toBe('Visual System');
    expect(parsed.anchors).toHaveLength(5);
  });
});

describe('Colour arithmetic', () => {
  it('gives the WCAG ratio, APCA Lc and OKLab distance of known pairs', () => {
    expect(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 5);
    expect(contrastRatio([118, 118, 118, 1], [255, 255, 255, 1])).toBeCloseTo(4.54, 2);
    expect(apcaLc([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(106, 0);
    expect(apcaLc([255, 255, 255, 1], [0, 0, 0, 1])).toBeGreaterThan(100);
    expect(oklabDistance([240, 241, 243, 1], [240, 241, 243, 1])).toBe(0);
    expect(oklabDistance([241, 242, 244, 1], [240, 241, 243, 1])).toBeLessThan(0.01);
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(19, 700)).toBe(true);
    expect(isLargeText(19, 400)).toBe(false);
  });
});

function probe(contrast: ContrastRecord[]): VisualProbeState {
  const el = (id: number, text: string) => ({ id, parent: null, order: id, depth: 1, tag: 'p', role: null, name: null, text, ownText: true, selector: `p#t${id}`, componentId: null, componentType: null, rect: { x: 0, y: id * 20, w: 200, h: 18 } });
  return {
    version: 1,
    stateId: 'desktop',
    viewport: { width: 1280, height: 800 },
    snapshot: { elements: [el(1, 'Muted note'), el(2, 'Fine text'), el(3, 'Placeholder')] } as unknown as VisualProbeState['snapshot'],
    styles: [],
    contrast,
    axe: null,
    focus: null,
    motion: null,
  };
}

describe('Required Contrast and the contrast profile', () => {
  const p = probe([
    { id: 1, kind: 'text', fg: [170, 170, 170, 1], bg: [255, 255, 255, 1], size: 14, weight: 400 },
    { id: 2, kind: 'text', fg: [90, 99, 113, 1], bg: [255, 255, 255, 1], size: 14, weight: 400 },
    { id: 3, kind: 'text', fg: [170, 170, 170, 1], bg: [255, 255, 255, 1], size: 14, weight: 400, placeholder: true },
    { id: 2, kind: 'text', fg: [255, 255, 255, 1], bg: null, unresolved: 'image', size: 14, weight: 400 },
  ]);

  it('fails text below 4.5:1, and reports placeholders and pictures separately', () => {
    const r = requiredContrast(p, new Doc(p.snapshot));
    expect(r.status).toBe('fail');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].data).toMatchObject({ fg: '#aaaaaa', bg: '#ffffff', required: 4.5 });
    expect(r.secondary.map((s) => s.kind).sort()).toEqual(['complex_background', 'exempt']);
  });

  it('leaves pairs that already fail WCAG out of the APCA flags', () => {
    const r = contrastProfile(p, new Doc(p.snapshot));
    expect(r.items.filter((i) => i.data.kind === 'below').map((i) => i.data.fg)).not.toContain('#aaaaaa');
  });
});

describe('Visual System judgments', () => {
  const packet = {
    packetVersion: 'visual-system-packet-v1',
    category: 'visual_system',
    bundleId: 'b',
    caseId: 'c',
    interfaceId: 'iface-test',
    request: 'A page.',
    images: [{ id: 'S-desktop-full', stateId: 'desktop', kind: 'full', path: 'x.png', caption: '', detail: 'original', estimatedTokens: 100 }],
    index: {
      'S-desktop-full': { type: 'screenshot', stateId: 'desktop' },
      'C-focus_visibility-desktop': { type: 'check', status: 'fail', stateId: 'desktop', resultKey: 'focus_visibility@desktop' },
    },
    evidence: {},
  } as unknown as Packet;
  const schema = layoutOutputJsonSchema(VISUAL_SYSTEM_CRITERIA, { describe: true, decisive: false, materiality: 'v5', category: 'Visual System' }) as any;

  it('the schema names Visual System and its three criteria', () => {
    expect(schema.properties.overall.properties.score.description).toContain('Visual System');
    expect(Object.keys(schema.properties.criteria.properties)).toEqual(['A', 'B', 'C']);
  });

  it('validates mock output against the Visual System criteria, and rejects Layout point keys', async () => {
    const res = await mockProvider('ok').call({ category: 'visual_system', schema, instructions: '', userText: '', images: [] } as never, { model: 'm', effort: 'e', caseId: 'c', repeat: 1, packet });
    const v = validateJudgment(JSON.parse(res.outputText!), packet);
    expect(v.validation.schemaValid).toBe(true);
    expect(v.output!.criteria.C.findings[0].evaluation_point).toBe('focus');
    expect(v.validation.refIssues.filter((i) => i.severity === 'error')).toEqual([]);
    const wrong = JSON.parse(res.outputText!);
    wrong.criteria.A.findings[0].evaluation_point = 'primary_focus';
    expect(validateJudgment(wrong, packet).validation.schemaValid).toBe(false);
  });
});
