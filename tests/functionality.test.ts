import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FUNCTIONALITY_RUBRIC_PATH } from '../src/config.ts';
import type { Effect, FunctionalProbe, ProbeControl } from '../src/collect/probeTypes.ts';
import { FUNCTIONALITY_ANCHORS, FUNCTIONALITY_CRITERIA } from '../src/categories/functionality/definition.ts';
import { buildFunctionalityPacket, parseFunctionalityRubric } from '../src/categories/functionality/packet.ts';
import { loadOrBuildPacket, packetUnavailable } from '../src/categories/index.ts';
import { renderFindingsCriterion } from '../src/categories/layout/render.ts';
import { layoutOutputJsonSchema } from '../src/categories/layout/schema.ts';
import type { Packet } from '../src/categories/types.ts';
import { formSubmission, invalidSubmission, navigationIntegrity, noEffectControls, runtimeErrors, toggleState } from '../src/diagnostics/functionality/checks.ts';
import { mockProvider } from '../src/judge/providers/mock.ts';
import { validateJudgment } from '../src/judge/validate.ts';
import { state, syntheticBundle } from './bundles.ts';

const rubric = fs.readFileSync(FUNCTIONALITY_RUBRIC_PATH, 'utf8');

describe('Functionality category definition', () => {
  it('matches the criteria, evaluation points, and anchors in functionality_rubric.md', () => {
    for (const c of FUNCTIONALITY_CRITERIA) {
      expect(rubric).toContain(`${c.id}/ ${c.name}`);
      for (const p of c.points) expect(rubric).toContain(`**${p.name}:**`);
    }
    for (const a of FUNCTIONALITY_ANCHORS) expect(rubric).toMatch(new RegExp(`\\*\\*${a.score}\\s*[:-]\\s*${a.label}`));
  });
});

describe('functionality_rubric.md parsing', () => {
  const parsed = parseFunctionalityRubric();

  it('finds the eighteen checks and the validation wording observation', () => {
    expect(parsed.diagnostics.map((d) => d.diagId)).toEqual([
      'control_operability',
      'no_effect_controls',
      'editable_response',
      'toggle_state',
      'navigation_integrity',
      'form_submission',
      'invalid_submission',
      'runtime_errors',
      'count_claims',
      'total_claims',
      'sort_claims',
      'period_claims',
      'opened_detail',
      'template_text',
      'dependent_actions',
      'choice_effect',
      'saved_persistence',
      'dialog_behaviour',
      'validation_wording',
    ]);
    for (const d of parsed.diagnostics) {
      if (d.diagId === 'validation_wording') expect(d.kind === 'observation' && d.reference).toBeTruthy();
      else expect(d.kind === 'deterministic' && d.pass, d.diagId).toBeTruthy();
    }
  });

  it("maps each criterion's evidence to its checks", () => {
    const map = Object.fromEntries(parsed.criteria.map((c) => [c.id, c.diagIds]));
    expect(map).toEqual({
      A: ['no_effect_controls', 'form_submission', 'navigation_integrity', 'dependent_actions'],
      B: ['control_operability', 'editable_response', 'toggle_state', 'choice_effect'],
      C: ['count_claims', 'total_claims', 'sort_claims', 'period_claims', 'opened_detail', 'template_text', 'saved_persistence'],
      D: ['invalid_submission', 'runtime_errors', 'validation_wording', 'dialog_behaviour'],
    });
    expect(parsed.title).toBe('Functionality');
  });

  it('renders a criterion without checks or measurements', () => {
    const text = renderFindingsCriterion({ criterion: 'C', name: 'State and Data Integrity', checks: [], observations: [] }, parsed, { checksOnly: true, uncheckedCriteria: ['C'] });
    expect(text).toContain('Automated checks: none apply to this criterion.');
    expect(text).not.toContain('Measurements');
  });
});

const none: Effect = { url: false, mutations: 0, ariaChanges: 0, requests: 0, dialogs: 0, invalid: 0, calls: [], scrolled: 0, textChanged: false, newAlerts: [], errors: [] };

function control(key: string, over: Partial<ProbeControl>): ProbeControl {
  return { key, path: '', selector: 'button', tag: 'button', role: 'button', type: null, name: key, componentId: null, rect: { x: 10, y: 10, w: 80, h: 30 }, fixed: false, kind: 'action', members: 1, memberNames: [], from: 'load', ...over };
}

function fprobe(over: Partial<FunctionalProbe>): FunctionalProbe {
  return { version: 1, viewport: 'desktop', width: 1920, height: 1080, controls: [], operability: [], actions: [], fields: [], toggles: [], links: [], forms: [], errors: [], limits: { controls: 0, probed: 0 }, ...over };
}

describe('Functionality checks', () => {
  it('fails an action with no effect, in the state it was found in', () => {
    const p = fprobe({
      controls: [control('Export', {}), control('Refund', { from: 'interactive-auto-desktop' }), control('Open', {})],
      actions: [
        { key: 'Export', effect: none },
        { key: 'Refund', effect: none },
        { key: 'Open', effect: { ...none, mutations: 3 } },
      ],
    });
    const r = noEffectControls(p);
    expect(r.get('desktop')!.status).toBe('fail');
    expect(r.get('desktop')!.items.map((i) => i.summary)).toEqual([expect.stringContaining('"Export" button does nothing')]);
    expect(r.get('interactive-auto-desktop')!.items[0].summary).toContain('"Refund"');
  });

  it('fails a placeholder link and a fragment without a target, and passes a working one', () => {
    const p = fprobe({
      controls: [control('a', { kind: 'link', tag: 'a', role: 'link', members: 9 }), control('b', { kind: 'link', tag: 'a', role: 'link' }), control('c', { kind: 'link', tag: 'a', role: 'link' })],
      links: [
        { key: 'a', href: '#', target: 'placeholder', ok: false, detail: 'nothing happens beyond jumping to the top of the page' },
        { key: 'b', href: '#pricing', target: 'fragment', ok: false, detail: 'there is no element with the ID "pricing" on the page' },
        { key: 'c', href: '#faq', target: 'fragment', ok: true, detail: 'reaches its target' },
      ],
    });
    const items = navigationIntegrity(p).get('desktop')!.items.map((i) => i.summary);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('and 8 other links like it');
    expect(items[1]).toContain('#pricing');
  });

  it('reports a toggle whose look changes but whose declared state does not, and skips one that could not be clicked', () => {
    const p = fprobe({
      controls: [control('t', { kind: 'toggle' }), control('u', { kind: 'toggle' })],
      toggles: [
        { key: 't', property: 'aria-checked', before: 'false', after: 'false', expected: 'select', ok: false, renderedChange: true, note: 'its appearance changed but its declared state did not' },
        { key: 'u', property: 'checked', before: 'false', after: null, expected: 'toggle', ok: false, renderedChange: null, error: 'element is not visible' },
      ],
    });
    const r = toggleState(p).get('desktop')!;
    expect(r.items).toHaveLength(1);
    expect(r.items[0].summary).toContain('appearance changed');
  });

  it('judges an empty submission only for forms that respond to a valid one', () => {
    const form = (over: Partial<FunctionalProbe['forms'][number]>) => ({ key: 'f', path: 'form', name: 'booking', submit: 'Confirm', filled: ['Name'], refilled: [], lost: [], chosen: [], valid: none, outcome: 'nothing happened', ...over });
    const dead = fprobe({ forms: [form({ empty: none })] });
    expect(formSubmission(dead).get('desktop')!.status).toBe('fail');
    expect(invalidSubmission(dead).size).toBe(0);
    const silent = fprobe({ forms: [form({ valid: { ...none, textChanged: true, newAlerts: ['Booked'] }, outcome: 'a message appeared', empty: { ...none, mutations: 1 }, emptyOutcome: 'the page was redrawn but nothing visible changed' })] });
    expect(formSubmission(silent).get('desktop')!.status).toBe('pass');
    expect(invalidSubmission(silent).get('desktop')!.items[0].summary).toContain('gives no visible response');
    const redrawn = { ...none, mutations: 1 };
    const resubmitted = formSubmission(fprobe({ forms: [form({ filled: [], valid: redrawn, outcome: 'the page was redrawn but nothing visible changed' })] })).get('desktop')!;
    expect(resubmitted.status).toBe('pass');
    expect(resubmitted.secondary[0].kind).toBe('resubmitted');
    expect(formSubmission(fprobe({ forms: [form({ filled: [], valid: none })] })).get('desktop')!.status).toBe('fail');
    expect(formSubmission(fprobe({ forms: [form({ valid: redrawn })] })).get('desktop')!.status).toBe('fail');
  });

  it('collects load errors per state and errors while the controls were used', () => {
    const s = state('desktop', 'baseline', 'desktop', { consoleErrors: ['pageerror: x is not defined', 'injected script failed: y'], network: { external: [], failed: ['http://127.0.0.1:5000/data.json (net::ERR_FAILED)', 'https://fonts.example/a.woff (blocked)'] } });
    const p = fprobe({ errors: [{ during: 'clicking "Save"', message: 'Uncaught error: boom' }] });
    const r = runtimeErrors([{ state: s, origin: 'http://127.0.0.1:5000' }], [p]).get('desktop')!;
    expect(r.items.map((i) => i.summary)).toEqual(['Uncaught error on load: x is not defined', 'Request failed on load: /data.json (net::ERR_FAILED)', 'Uncaught error: boom (while clicking "Save")']);
  });
});

describe('Functionality judgments', () => {
  const packet = {
    packetVersion: 'functionality-packet-v1',
    category: 'functionality',
    bundleId: 'b',
    caseId: 'c',
    interfaceId: 'iface-test',
    request: 'A page.',
    images: [{ id: 'S-desktop-full', stateId: 'desktop', kind: 'full', path: 'x.png', caption: '', detail: 'original', estimatedTokens: 100 }],
    index: {
      'S-desktop-full': { type: 'screenshot', stateId: 'desktop' },
      'C-no_effect_controls-desktop': { type: 'check', status: 'fail', stateId: 'desktop', resultKey: 'no_effect_controls@desktop' },
    },
    evidence: {},
  } as unknown as Packet;
  const schema = layoutOutputJsonSchema(FUNCTIONALITY_CRITERIA, { describe: true, decisive: false, materiality: 'v5', category: 'Functionality' }) as any;

  it('validates mock output against the Functionality criteria', async () => {
    const res = await mockProvider('ok').call({ category: 'functionality', schema, instructions: '', userText: '', images: [] } as never, { model: 'm', effort: 'e', caseId: 'c', repeat: 1, packet });
    const v = validateJudgment(JSON.parse(res.outputText!), packet);
    expect(v.validation.schemaValid).toBe(true);
    expect(v.output!.criteria.A.findings.some((f) => f.evaluation_point === 'path_continuity')).toBe(true);
    expect(Object.keys(v.output!.criteria)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('Functionality evidence without the Functionality probe', () => {
  const bundle = { ...syntheticBundle([state('desktop', 'baseline', 'desktop'), state('mobile', 'baseline', 'mobile')]), caseId: '_test-no-functional-probe' };
  const diags = { schemaVersion: 1, diagnosticsVersion: '', bundleId: 'b', computedAt: '', results: [], transitions: [] } as never;

  it('is refused with the command that collects it, rather than judged', () => {
    const message = /collected without the Functionality probes.*npm run collect -- _test-no-functional-probe --functional/;
    expect(() => buildFunctionalityPacket(bundle, diags)).toThrow(message);
    expect(() => loadOrBuildPacket(bundle, 'v1', 'functionality')).toThrow(message);
    expect(packetUnavailable('functionality', bundle)).toMatch(message);
  });

  it('leaves the other categories alone', () => {
    for (const category of ['layout', 'typography', 'task_fit', 'content_quality', 'visual_system']) expect(packetUnavailable(category, bundle), category).toBeNull();
  });

  it('points planted-defect evidence at the Functionality mutations folder', () => {
    expect(packetUnavailable('functionality', { ...bundle, caseId: '_mutations/r/c/m' })).toMatch(/--dir mutations-functionality/);
  });
});
