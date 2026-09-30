// Human ratings: a person fills in the same output form as the judge, from the same packet.
// Each submission is its own file, so an interface can have any number of ratings.

import fs from 'node:fs';
import path from 'node:path';
import { BENCHMARK_DIR } from '../config.ts';
import { loadOrBuildPacket } from '../categories/index.ts';
import { LAYOUT_CRITERIA } from '../categories/layout/definition.ts';
import { buildLayoutRequest } from '../categories/layout/prompt.ts';
import type { LayoutJudgment } from '../categories/layout/schema.ts';
import { validateJudgment, type Validation } from '../judge/validate.ts';
import { csv } from '../report/csv.ts';
import { bundleDir, loadBundle } from '../store.ts';
import { ensureDir, readJson, timestampId, writeJson } from '../util.ts';

export const HUMAN_DIR = process.env.DJ_HUMAN_DIR ?? path.join(BENCHMARK_DIR, 'human');

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
  output: LayoutJudgment;
  validation: Validation;
}

export interface RatingInput {
  bundleId: string;
  promptVersion: string;
  rater: string;
  output: unknown;
  startedAt?: string | null;
}

const caseRatingsDir = (caseId: string) => path.join(HUMAN_DIR, caseId);

export function listRatings(caseId?: string): HumanRating[] {
  if (!fs.existsSync(HUMAN_DIR)) return [];
  const cases = caseId ? [caseId] : fs.readdirSync(HUMAN_DIR).filter((d) => fs.statSync(path.join(HUMAN_DIR, d)).isDirectory());
  return cases
    .flatMap((c) => {
      const dir = caseRatingsDir(c);
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJson<HumanRating>(path.join(dir, f)));
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function loadRating(caseId: string, ratingId: string): HumanRating {
  if (!/^[A-Za-z0-9._-]+$/.test(ratingId)) throw new Error('Invalid rating ID');
  return readJson<HumanRating>(path.join(caseRatingsDir(caseId), `${ratingId}.json`));
}

// Validates against the same schema and evidence index as the judge; rejects schema-invalid
// output so every stored rating is comparable with a judgment. Unlike the judge, a person may
// leave notes and summaries empty, and may make call-outs (findings) without citing evidence.
export async function saveRating(caseId: string, input: RatingInput): Promise<{ rating?: HumanRating; errors?: string[] }> {
  const rater = input.rater.trim();
  if (!rater) return { errors: ['Enter your name as the rater.'] };
  const bundle = loadBundle(caseId, input.bundleId);
  const packet = loadOrBuildPacket(bundle, input.promptVersion);
  const request = buildLayoutRequest(packet, bundleDir(caseId, bundle.bundleId), input.promptVersion);
  const { output, validation } = validateJudgment(input.output, packet, { requireEvidence: false });
  if (!output) return { errors: validation.schemaErrors };
  const createdAt = new Date();
  const slug = rater.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rater';
  const rating: HumanRating = {
    schemaVersion: 1,
    ratingId: `${timestampId(createdAt)}-${slug}`,
    caseId,
    bundleId: bundle.bundleId,
    interfaceId: bundle.interfaceId,
    promptVersion: input.promptVersion,
    promptHash: request.promptHash,
    packetHash: request.packetHash,
    rater,
    createdAt: createdAt.toISOString(),
    durationMs: input.startedAt ? Math.max(0, createdAt.getTime() - new Date(input.startedAt).getTime()) : null,
    output,
    validation,
  };
  writeJson(path.join(ensureDir(caseRatingsDir(caseId)), `${rating.ratingId}.json`), rating);
  writeHumanCsvs();
  return { rating };
}

export function deleteRating(caseId: string, ratingId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(ratingId)) throw new Error('Invalid rating ID');
  fs.rmSync(path.join(caseRatingsDir(caseId), `${ratingId}.json`), { force: true });
  writeHumanCsvs();
}

type Finding = LayoutJudgment['criteria'][string]['findings'][number];

// ratings.csv (one row per rating), findings.csv and points.csv, in the same shape as a run's.
export function writeHumanCsvs(): void {
  const ratings = listRatings();
  ensureDir(HUMAN_DIR);
  const findings = (r: HumanRating): (Finding & { criterion: string })[] =>
    LAYOUT_CRITERIA.flatMap((c) => (r.output.criteria[c.id]?.findings ?? []).map((f) => ({ ...f, criterion: c.id })));
  const ratingRows = [
    [
      'rating_id', 'case_id', 'bundle_id', 'interface_id', 'prompt_version', 'packet_hash', 'rater', 'created_at', 'duration_min',
      'score', 'anchor', 'strengths', 'weaknesses', 'material_weaknesses', 'reasoning',
      ...LAYOUT_CRITERIA.map((c) => `criterion_${c.id}_summary`), 'missing_evidence', 'untrusted_content_notes', 'refs', 'valid_refs', 'ref_errors',
    ],
    ...ratings.map((r) => {
      const fs_ = findings(r);
      const weak = fs_.filter((f) => f.polarity !== 'strength');
      return [
        r.ratingId, r.caseId, r.bundleId, r.interfaceId, r.promptVersion, r.packetHash, r.rater, r.createdAt,
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
  const pointRows = [
    ['rating_id', 'case_id', 'rater', 'criterion', 'evaluation_point', 'point_name', 'applicable', 'assessment'],
    ...ratings.flatMap((r) =>
      LAYOUT_CRITERIA.flatMap((c) =>
        c.points.map((p) => {
          const e = r.output.criteria[c.id]?.evaluation_points[p.key];
          return [r.ratingId, r.caseId, r.rater, c.id, p.key, p.name, e ? (e.applicable ? 'yes' : 'no') : '', e?.assessment ?? ''];
        }),
      ),
    ),
  ];
  fs.writeFileSync(path.join(HUMAN_DIR, 'ratings.csv'), csv(ratingRows));
  fs.writeFileSync(path.join(HUMAN_DIR, 'findings.csv'), csv(findingRows));
  fs.writeFileSync(path.join(HUMAN_DIR, 'points.csv'), csv(pointRows));
}
