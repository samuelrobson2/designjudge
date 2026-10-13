import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVIDENCE_DIR, TASK_FIT_RUBRIC_PATH } from '../src/config.ts';
import { layoutOutputJsonSchema } from '../src/categories/layout/schema.ts';
import { chooseStates, type NoChecksEvidence } from '../src/categories/no-checks/packet.ts';
import { TASK_FIT_ANCHORS, TASK_FIT_CRITERIA } from '../src/categories/task_fit/definition.ts';
import { buildTaskFitPacket, parseTaskFitRubric } from '../src/categories/task_fit/packet.ts';
import { buildTaskFitRequest } from '../src/categories/task_fit/prompt.ts';
import type { Packet } from '../src/categories/types.ts';
import { mockProvider } from '../src/judge/providers/mock.ts';
import { validateJudgment } from '../src/judge/validate.ts';
import { bundleDir, loadBundle } from '../src/store.ts';
import { state, syntheticBundle } from './bundles.ts';

const rubric = fs.readFileSync(TASK_FIT_RUBRIC_PATH, 'utf8');

describe('Task Fit category definition', () => {
  it('matches the criteria, evaluation points, and anchors in task_fit_rubric.md', () => {
    for (const c of TASK_FIT_CRITERIA) {
      expect(rubric).toContain(`${c.id}/ ${c.name}`);
      for (const p of c.points) expect(rubric).toContain(`**${p.name}:**`);
    }
    for (const a of TASK_FIT_ANCHORS) expect(rubric).toMatch(new RegExp(`\\*\\*${a.score}\\s*[:-]\\s*${a.label}`));
  });
});

describe('task_fit_rubric.md parsing', () => {
  const parsed = parseTaskFitRubric();

  it('reads four criteria with their points and references, and no diagnostics', () => {
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.title).toBe('Task Fit');
    expect(parsed.criteria.map((c) => c.id)).toEqual(['A', 'B', 'C', 'D']);
    for (const c of parsed.criteria) {
      const def = TASK_FIT_CRITERIA.find((d) => d.id === c.id)!;
      expect(c.points.map((p) => p.name)).toEqual(def.points.map((p) => p.name));
      expect(c.diagIds).toEqual([]);
      expect(c.reference, c.id).toBeTruthy();
    }
    expect(parsed.anchors.map((a) => a.score)).toEqual([5, 4, 3, 2, 1]);
    expect(parsed.states).toContain('Baseline Desktop');
  });

  it('mentions no checks or measurements in the text the judge sees', () => {
    const judged = [parsed.measures, parsed.criteriaPreamble, parsed.scoring, ...parsed.criteria.map((c) => c.text)].join('\n');
    expect(judged).not.toMatch(/check|measurement|diagnostic/i);
  });
});

describe('Task Fit packet', () => {
  const bundle = syntheticBundle([
    state('desktop', 'baseline', 'desktop'),
    state('tablet', 'baseline', 'tablet'),
    state('mobile', 'baseline', 'mobile'),
    state('stress-desktop', 'stress', 'desktop'),
    state('fixture-empty-desktop', 'fixture', 'desktop', { fixture: 'empty' }),
    state('interactive-auto-desktop', 'interactive', 'desktop'),
    state('interactive-auto-tablet', 'interactive', 'tablet', { supporting: true }),
    state('interactive-auto-mobile', 'interactive', 'mobile', { status: 'error', error: 'timeout' }),
  ]);

  it('sends the desktop and phone baselines and the interactive states every judge sees', () => {
    expect(chooseStates(bundle, { baselines: ['desktop', 'mobile'] }).map((s) => s.id)).toEqual(['desktop', 'mobile', 'interactive-auto-desktop']);
    expect(chooseStates(bundle, { baselines: ['desktop', 'mobile'], emptyContent: true }).map((s) => s.id)).toContain('fixture-empty-desktop');
  });

  it('indexes only screenshots and has no check or measurement evidence', () => {
    const packet = buildTaskFitPacket(bundle);
    expect(packet.request).toBe(bundle.request);
    expect(new Set(Object.values(packet.index).map((e) => e.type))).toEqual(new Set(['screenshot']));
    expect(packet.images.map((i) => i.id)).toEqual(['S-desktop-full', 'S-mobile-full', 'S-interactive-auto-desktop-viewport']);
    const ev = packet.evidence as unknown as NoChecksEvidence;
    expect(ev.criteria).toEqual(TASK_FIT_CRITERIA.map((c) => ({ criterion: c.id, name: c.name })));
    expect(ev.page_text).toBeUndefined();
  });

  it('notes missing states', () => {
    const packet = buildTaskFitPacket(syntheticBundle([state('desktop', 'baseline', 'desktop')]));
    expect(packet.selectionNotes).toEqual(['The phone state was not captured.', 'No interactive state was captured.']);
  });
});

const latest = path.join(EVIDENCE_DIR, 'booking-baseline', 'latest.json');

describe.skipIf(!fs.existsSync(latest))('Task Fit prompt (booking-baseline)', () => {
  const bundle = loadBundle('booking-baseline');
  const packet = buildTaskFitPacket(bundle);
  const req = buildTaskFitRequest(packet, bundleDir(bundle.caseId, bundle.bundleId), 'v1');

  it('renders every criterion with no evidence section and no mention of checks or measurements', () => {
    for (const c of TASK_FIT_CRITERIA) expect(req.userText).toContain(`<criterion id="${c.id}" name="${c.name}">`);
    for (const text of [req.instructions, req.userText]) {
      expect(text).not.toMatch(/<evidence>|check|measurement|diagnostic|F-…|O-…/i);
      expect(text).not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
    expect(req.userText).toContain(bundle.request);
    expect(req.instructions).toMatch(/untrusted/i);
  });

  it('sends every packet image, and its schema asks only for screenshot IDs', () => {
    expect(req.images.length).toBe(packet.images.length);
    const refs = (req.schema as any).properties.criteria.properties.A.properties.findings.items.properties.evidence_refs.description;
    expect(refs).toContain('S-');
    expect(refs).not.toMatch(/F-|O-/);
  });
});

describe('Task Fit judgments', () => {
  const packet = {
    schemaVersion: 1,
    packetVersion: 'task-fit-packet-v1',
    category: 'task_fit',
    bundleId: 'b',
    caseId: 'c',
    interfaceId: 'iface-test',
    request: 'A page.',
    images: [{ id: 'S-desktop-full', stateId: 'desktop', kind: 'full', path: 'states/desktop/full.png', caption: '', detail: 'original', estimatedTokens: 100 }],
    index: { 'S-desktop-full': { type: 'screenshot', stateId: 'desktop' } },
    evidence: {},
    selectionNotes: [],
  } as unknown as Packet;
  const schema = layoutOutputJsonSchema(TASK_FIT_CRITERIA, { describe: true, decisive: false, materiality: 'v5', category: 'Task Fit', evidenceIds: 'screenshot IDs, S-…' }) as any;

  it('validates mock output, and rejects a check ID as an evidence reference', async () => {
    const res = await mockProvider('ok').call({ category: 'task_fit', schema, instructions: '', userText: '', images: [] } as never, { model: 'm', effort: 'e', caseId: 'c', repeat: 1, packet });
    const v = validateJudgment(JSON.parse(res.outputText!), packet);
    expect(v.validation.schemaValid).toBe(true);
    expect(v.validation.refIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(Object.keys(v.output!.criteria)).toEqual(['A', 'B', 'C', 'D']);

    const withCheck = JSON.parse(res.outputText!);
    withCheck.criteria.A.findings[0].evidence_refs = ['F-text_contrast-desktop-1'];
    expect(validateJudgment(withCheck, packet).validation.refIssues.some((i) => i.severity === 'error' && i.problem === 'unknown_id')).toBe(true);

    const layoutPoint = JSON.parse(res.outputText!);
    layoutPoint.criteria.A.findings[0].evaluation_point = 'primary_focus';
    expect(validateJudgment(layoutPoint, packet).validation.schemaValid).toBe(false);
  });
});
