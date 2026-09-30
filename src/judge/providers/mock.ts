import { LAYOUT_ANCHORS, LAYOUT_CRITERIA } from '../../categories/layout/definition.ts';
import type { LayoutFinding, LayoutJudgment } from '../../categories/layout/schema.ts';
import type { Provider, ProviderResult } from './types.ts';

// Deterministic, schema-valid output derived from the packet. It exercises the harness only;
// it says nothing about judge quality.
const CHECK_CRITERION: Record<string, string> = {
  region_overlap: 'C',
  collapsed_dimensions: 'C',
  occluded_content: 'C',
  container_overflow: 'B',
  content_growth_failures: 'B',
  page_horizontal_overflow: 'D',
  interactive_reachability: 'D',
  responsive_layout_failures: 'D',
};
const CHECK_POINT: Record<string, string> = {
  region_overlap: 'structural_integrity',
  collapsed_dimensions: 'usable_sizing',
  occluded_content: 'structural_integrity',
  container_overflow: 'content_fit',
  content_growth_failures: 'content_fit',
  page_horizontal_overflow: 'adaptive_behavior',
  interactive_reachability: 'reachability',
  responsive_layout_failures: 'adaptive_behavior',
};

export function mockProvider(mode: 'ok' | 'invalid_json' | 'unknown_refs'): Provider {
  return {
    name: 'mock',
    async call(req, opts): Promise<ProviderResult> {
      const t0 = Date.now();
      const index = opts.packet.index;
      const firstShot = Object.keys(index).find((k) => index[k].type === 'screenshot') ?? 'S-desktop-viewport';
      const failing = Object.entries(index).filter(([, e]) => e.type === 'check' && e.status === 'fail');
      const missing = Object.entries(index).filter(([, e]) => e.type === 'check' && (e.status === 'unavailable' || e.status === 'not_collected'));

      const criteria: LayoutJudgment['criteria'] = {};
      for (const c of LAYOUT_CRITERIA) {
        criteria[c.id] = {
          summary: `[MOCK] Placeholder summary for criterion ${c.id} (${c.name}).`,
          evaluation_points: Object.fromEntries(c.points.map((p) => [p.key, { applicable: true, assessment: `[MOCK] ${p.name} not assessed by the mock provider.` }])),
          findings: [],
        };
      }
      const push = (cid: string, f: Omit<LayoutFinding, 'id'>) => {
        const list = criteria[cid].findings;
        list.push({ id: `${cid}${list.length + 1}`, ...f });
      };
      push('A', {
        evaluation_point: 'primary_focus',
        polarity: 'strength',
        materiality: 'minor',
        observation: '[MOCK] Placeholder strength citing the first screenshot.',
        why_it_matters: '[MOCK] Exercises screenshot citation.',
        evidence_refs: [mode === 'unknown_refs' ? 'S-does-not-exist' : firstShot],
        states: ['desktop'],
      });
      const failedTypes = new Set<string>();
      for (const [id, entry] of failing) {
        const diagId = entry.resultKey?.split('@')[0] ?? '';
        failedTypes.add(diagId);
        const cid = CHECK_CRITERION[diagId] ?? 'C';
        push(cid, {
          evaluation_point: CHECK_POINT[diagId] ?? LAYOUT_CRITERIA.find((c) => c.id === cid)!.points[0].key,
          polarity: 'weakness',
          materiality: 'material',
          observation: `[MOCK] Deterministic check ${id} failed.`,
          why_it_matters: '[MOCK] Exercises deterministic-evidence citation.',
          evidence_refs: [id],
          states: entry.stateId ? [entry.stateId] : [],
        });
      }
      const score = Math.max(1, 4 - failedTypes.size);
      const output: LayoutJudgment = {
        criteria,
        missing_evidence: missing.slice(0, 5).map(([id]) => ({ evidence: id, affected_criteria: ['D'], effect_on_assessment: '[MOCK] Listed because the check was not available.' })),
        untrusted_content_notes: [],
        overall: {
          score,
          anchor: LAYOUT_ANCHORS.find((a) => a.score === score)!.label,
          decisive_finding_ids: Object.values(criteria).flatMap((c) => c.findings.filter((f) => f.polarity === 'weakness').map((f) => f.id)).slice(0, 3),
          reasoning: `[MOCK] Score = 4 minus the number of distinct failing check types (${failedTypes.size}). Not a real judgment.`,
        },
      };
      const inputTokens = Math.round((req.instructions.length + req.userText.length) / 4) + req.images.reduce((s, i) => s + i.estimatedTokens, 0);
      const text = mode === 'invalid_json' ? '{"criteria": {"A": ' : JSON.stringify(output);
      return {
        status: 'ok',
        outputText: text,
        usage: { inputTokens, cachedInputTokens: opts.repeat > 1 ? inputTokens - 500 : 0, outputTokens: Math.round(text.length / 4), reasoningTokens: 0 },
        latencyMs: Date.now() - t0,
        modelReported: `mock-${mode}`,
        rawRequest: { provider: 'mock', mode, images: req.images.map((i) => i.id) },
        rawResponse: { mock: true, mode },
        notes: ['Mock provider: output is synthetic and tests the harness only.'],
      };
    },
  };
}
