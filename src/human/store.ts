// Human ratings: a person fills in the same output form as the judge, from the same packet.
// Each submission is its own file, so an interface can have any number of ratings.

import fs from 'node:fs';
import path from 'node:path';
import { BENCHMARK_DIR } from '../config.ts';
import { loadOrBuildPacket } from '../categories/index.ts';
import { buildLayoutRequest } from '../categories/layout/prompt.ts';
import { bundleDir, loadBundle } from '../store.ts';
import { ensureDir, readJson, writeJson } from '../util.ts';
import { humanCsvs, makeRating, type HumanRating, type RatingInput } from './rating.ts';

export type { HumanRating, RatingInput } from './rating.ts';

export const HUMAN_DIR = process.env.DJ_HUMAN_DIR ?? path.join(BENCHMARK_DIR, 'human');

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

export async function saveRating(caseId: string, input: RatingInput): Promise<{ rating?: HumanRating; errors?: string[] }> {
  const bundle = loadBundle(caseId, input.bundleId);
  const packet = loadOrBuildPacket(bundle, input.promptVersion);
  const request = buildLayoutRequest(packet, bundleDir(caseId, bundle.bundleId), input.promptVersion);
  const result = makeRating(
    { caseId, bundleId: bundle.bundleId, interfaceId: bundle.interfaceId, promptVersion: input.promptVersion, promptHash: request.promptHash, packetHash: request.packetHash, packet },
    input,
  );
  if (result.rating) {
    writeJson(path.join(ensureDir(caseRatingsDir(caseId)), `${result.rating.ratingId}.json`), result.rating);
    writeHumanCsvs();
  }
  return result;
}

export function deleteRating(caseId: string, ratingId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(ratingId)) throw new Error('Invalid rating ID');
  fs.rmSync(path.join(caseRatingsDir(caseId), `${ratingId}.json`), { force: true });
  writeHumanCsvs();
}

export function writeHumanCsvs(): void {
  ensureDir(HUMAN_DIR);
  for (const [name, text] of Object.entries(humanCsvs(listRatings()))) fs.writeFileSync(path.join(HUMAN_DIR, name), text);
}
