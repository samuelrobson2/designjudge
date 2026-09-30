import { LAYOUT_ANCHORS, LAYOUT_CRITERIA } from '../categories/layout/definition.ts';
import { layoutOutputZod, type LayoutJudgment } from '../categories/layout/schema.ts';
import type { Packet } from '../categories/types.ts';

export interface RefIssue {
  findingId: string;
  ref?: string;
  problem:
    | 'no_evidence'
    | 'unknown_id'
    | 'cites_missing_evidence_as_observed'
    | 'weakness_cites_passing_check'
    | 'duplicate_finding_id'
    | 'unknown_state';
  severity: 'error' | 'review';
}

export interface Validation {
  schemaValid: boolean;
  schemaErrors: string[];
  refIssues: RefIssue[];
  otherIssues: string[];
  stats: {
    findings: number;
    strengths: number;
    weaknesses: number;
    missedOpportunities: number;
    material: number;
    refs: number;
    validRefs: number;
    findingsWithValidRef: number;
    missingEvidenceNotes: number;
  };
}

export function parseOutput(text: string | null): { value: unknown; error?: string } {
  if (text === null) return { value: null, error: 'No output text' };
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return { value: null, error: `Invalid JSON: ${(err as Error).message}` };
  }
}

export function validateJudgment(value: unknown, packet: Packet): { output: LayoutJudgment | null; validation: Validation } {
  const empty = { findings: 0, strengths: 0, weaknesses: 0, missedOpportunities: 0, material: 0, refs: 0, validRefs: 0, findingsWithValidRef: 0, missingEvidenceNotes: 0 };
  const parsed = layoutOutputZod().safeParse(value);
  if (!parsed.success) {
    return {
      output: null,
      validation: {
        schemaValid: false,
        schemaErrors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`),
        refIssues: [],
        otherIssues: [],
        stats: empty,
      },
    };
  }
  const output = parsed.data as LayoutJudgment;
  const refIssues: RefIssue[] = [];
  const otherIssues: string[] = [];
  const stats = { ...empty, missingEvidenceNotes: output.missing_evidence.length };
  const seen = new Set<string>();
  const stateIds = new Set(
    Object.values(packet.index)
      .map((e) => e.stateId)
      .filter((s): s is string => !!s),
  );
  for (const s of ['desktop', 'tablet', 'mobile', 'stress-desktop']) stateIds.add(s);

  for (const c of LAYOUT_CRITERIA) {
    for (const f of output.criteria[c.id].findings) {
      stats.findings++;
      if (f.polarity === 'strength') stats.strengths++;
      if (f.polarity === 'weakness') stats.weaknesses++;
      if (f.polarity === 'missed_opportunity') stats.missedOpportunities++;
      if (f.materiality === 'material') stats.material++;
      if (seen.has(f.id)) refIssues.push({ findingId: f.id, problem: 'duplicate_finding_id', severity: 'error' });
      seen.add(f.id);
      if (!f.evidence_refs.length) refIssues.push({ findingId: f.id, problem: 'no_evidence', severity: 'error' });
      let anyValid = false;
      for (const ref of f.evidence_refs) {
        stats.refs++;
        const entry = packet.index[ref];
        if (!entry) {
          refIssues.push({ findingId: f.id, ref, problem: 'unknown_id', severity: 'error' });
          continue;
        }
        stats.validRefs++;
        anyValid = true;
        const negative = f.polarity !== 'strength';
        if (negative && entry.status && ['not_collected', 'unavailable', 'error'].includes(entry.status)) {
          refIssues.push({ findingId: f.id, ref, problem: 'cites_missing_evidence_as_observed', severity: 'error' });
        }
        if (f.polarity === 'weakness' && entry.type === 'check' && entry.status === 'pass') {
          refIssues.push({ findingId: f.id, ref, problem: 'weakness_cites_passing_check', severity: 'review' });
        }
      }
      if (anyValid) stats.findingsWithValidRef++;
      for (const s of f.states) {
        if (!stateIds.has(s)) refIssues.push({ findingId: f.id, ref: s, problem: 'unknown_state', severity: 'review' });
      }
    }
  }
  for (const id of output.overall.decisive_finding_ids) {
    if (!seen.has(id)) otherIssues.push(`Decisive finding "${id}" does not exist.`);
  }
  const anchor = LAYOUT_ANCHORS.find((a) => a.score === output.overall.score);
  if (anchor && anchor.label !== output.overall.anchor) {
    otherIssues.push(`Score ${output.overall.score} does not match anchor "${output.overall.anchor}" (expected "${anchor.label}").`);
  }
  if (!output.overall.decisive_finding_ids.length) otherIssues.push('No decisive findings named.');
  return { output, validation: { schemaValid: true, schemaErrors: [], refIssues, otherIssues, stats } };
}
