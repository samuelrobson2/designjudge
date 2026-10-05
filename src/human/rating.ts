// The parts of a human rating that do not touch the disk, shared by the local viewer and the
// hosted rating site.

import { LAYOUT_CRITERIA } from '../categories/layout/definition.ts';
import type { LayoutJudgment } from '../categories/layout/schema.ts';
import type { Packet } from '../categories/types.ts';
import { validateJudgment, type Validation } from '../judge/validate.ts';
import { csv } from '../report/csv.ts';
import { timestampId } from '../util.ts';

export interface HumanRating {
  schemaVersion: 1;
  ratingId: string;
  caseId: string;
  bundleId: string;
  interfaceId: string;
  promptVersion: string;
  promptHash: string;
  packetHash: string;
  rater: string;
  createdAt: string;
  // Time from opening the form to submitting it.
  durationMs: number | null;
  // What the person looked at: the judge's screenshots, or the live interface plus the
  // screenshots of failed checks. Ratings saved before this field existed used screenshots.
  view?: RatingView;
  output: LayoutJudgment;
  validation: Validation;
}

export type RatingView = 'screenshots' | 'live';

export interface RatingInput {
  bundleId: string;
  promptVersion: string;
  rater: string;
  output: unknown;
  startedAt?: string | null;
  view?: string;
}

export interface RatingContext {
  caseId: string;
  bundleId: string;
  interfaceId: string;
  promptVersion: string;
  promptHash: string;
  packetHash: string;
  packet: Packet;
}

export const RATER_MAX_LENGTH = 80;

// Validates against the same schema and evidence index as the judge; rejects schema-invalid
// output so every stored rating is comparable with a judgment. Unlike the judge, a person may
// leave notes and summaries empty, and may make call-outs (findings) without citing evidence.
export function makeRating(ctx: RatingContext, input: RatingInput): { rating?: HumanRating; errors?: string[] } {
  const rater = typeof input.rater === 'string' ? input.rater.trim() : '';
  if (!rater) return { errors: ['Enter your name as the rater.'] };
  if (rater.length > RATER_MAX_LENGTH) return { errors: [`Keep the name under ${RATER_MAX_LENGTH} characters.`] };
  const { output, validation } = validateJudgment(input.output, ctx.packet, { requireEvidence: false });
  if (!output) return { errors: validation.schemaErrors };
  const createdAt = new Date();
  const slug = rater.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'rater';
  const started = input.startedAt ? new Date(input.startedAt).getTime() : NaN;
  return {
    rating: {
      schemaVersion: 1,
      ratingId: `${timestampId(createdAt)}-${slug}`,
      caseId: ctx.caseId,
      bundleId: ctx.bundleId,
      interfaceId: ctx.interfaceId,
      promptVersion: ctx.promptVersion,
      promptHash: ctx.promptHash,
      packetHash: ctx.packetHash,
      rater,
      createdAt: createdAt.toISOString(),
      durationMs: Number.isFinite(started) ? Math.max(0, createdAt.getTime() - started) : null,
      view: input.view === 'live' ? 'live' : 'screenshots',
      output,
      validation,
    },
  };
}

// The row shown in a list of ratings.
export const ratingListItem = (r: HumanRating) => ({
  ratingId: r.ratingId,
  rater: r.rater,
  createdAt: r.createdAt,
  bundleId: r.bundleId,
  promptVersion: r.promptVersion,
  durationMs: r.durationMs,
  view: r.view ?? 'screenshots',
  score: r.output.overall.score,
  anchor: r.output.overall.anchor,
});

type Finding = LayoutJudgment['criteria'][string]['findings'][number];

// ratings.csv (one row per rating), findings.csv and points.csv, in the same shape as a run's.
export function humanCsvs(ratings: HumanRating[]): Record<'ratings.csv' | 'findings.csv' | 'points.csv', string> {
  const findings = (r: HumanRating): (Finding & { criterion: string })[] =>
    LAYOUT_CRITERIA.flatMap((c) => (r.output.criteria[c.id]?.findings ?? []).map((f) => ({ ...f, criterion: c.id })));
  const ratingRows = [
    [
      'rating_id', 'case_id', 'bundle_id', 'interface_id', 'prompt_version', 'packet_hash', 'view', 'rater', 'created_at', 'duration_min',
      'score', 'anchor', 'strengths', 'weaknesses', 'material_weaknesses', 'reasoning',
      ...LAYOUT_CRITERIA.map((c) => `criterion_${c.id}_summary`), 'missing_evidence', 'untrusted_content_notes', 'refs', 'valid_refs', 'ref_errors',
    ],
    ...ratings.map((r) => {
      const fs_ = findings(r);
      const weak = fs_.filter((f) => f.polarity !== 'strength');
      return [
        r.ratingId, r.caseId, r.bundleId, r.interfaceId, r.promptVersion, r.packetHash, r.view ?? 'screenshots', r.rater, r.createdAt,
        r.durationMs === null ? null : Math.round(r.durationMs / 6000) / 10,
        r.output.overall.score, r.output.overall.anchor, fs_.length - weak.length, weak.length, weak.filter((f) => f.materiality === 'material').length, r.output.overall.reasoning,
        ...LAYOUT_CRITERIA.map((c) => r.output.criteria[c.id]?.summary ?? ''),
        r.output.missing_evidence.map((m) => `${m.evidence} (${m.affected_criteria.join(', ')}): ${m.effect_on_assessment}`).join(' | '),
        r.output.untrusted_content_notes.join(' | '),
        r.validation.stats.refs, r.validation.stats.validRefs, r.validation.refIssues.filter((i) => i.severity === 'error').length,
      ];
    }),
  ];
  const findingRows = [
    ['rating_id', 'case_id', 'rater', 'criterion', 'finding_id', 'evaluation_point', 'polarity', 'materiality', 'evidence_refs', 'states', 'observation', 'why_it_matters'],
    ...ratings.flatMap((r) =>
      findings(r).map((f) => [r.ratingId, r.caseId, r.rater, f.criterion, f.id, f.evaluation_point, f.polarity, f.materiality, f.evidence_refs.join(' '), f.states.join(' '), f.observation, f.why_it_matters]),
    ),
  ];
  // Only points the person said something about: the rating form takes one note per criterion,
  // so most points are left untouched.
  const pointRows = [
    ['rating_id', 'case_id', 'rater', 'criterion', 'evaluation_point', 'point_name', 'applicable', 'assessment'],
    ...ratings.flatMap((r) =>
      LAYOUT_CRITERIA.flatMap((c) =>
        c.points.flatMap((p) => {
          const e = r.output.criteria[c.id]?.evaluation_points[p.key];
          if (!e || (e.applicable && !e.assessment.trim())) return [];
          return [[r.ratingId, r.caseId, r.rater, c.id, p.key, p.name, e.applicable ? 'yes' : 'no', e.assessment]];
        }),
      ),
    ),
  ];
  return { 'ratings.csv': csv(ratingRows), 'findings.csv': csv(findingRows), 'points.csv': csv(pointRows) };
}
