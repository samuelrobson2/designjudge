// Human ratings: a person fills in the same output form as the judge, from the same packet.
// Each submission is its own file, so an interface can have any number of ratings.

import fs from 'node:fs';
import path from 'node:path';
import { BENCHMARK_DIR } from '../config.ts';
import { buildRequest, CATEGORIES, categoryOf, ensurePacketImages, loadOrBuildPacket } from '../categories/index.ts';
import { bundleDir, loadBundle } from '../store.ts';
import { ensureDir, readJson, writeJson } from '../util.ts';
import { categoryDir, humanCsvs, makeRating, type HumanRating, type RatingInput } from './rating.ts';

export type { HumanRating, RatingInput } from './rating.ts';

export const HUMAN_DIR = process.env.DJ_HUMAN_DIR ?? path.join(BENCHMARK_DIR, 'human');

const categoryRatingsDir = (category: string) => path.join(HUMAN_DIR, categoryDir(categoryOf(category).id));
const caseRatingsDir = (caseId: string, category: string) => path.join(categoryRatingsDir(category), caseId);

export function listRatings(caseId?: string, category = 'layout'): HumanRating[] {
  const root = categoryRatingsDir(category);
  if (!fs.existsSync(root)) return [];
  const cases = caseId ? [caseId] : fs.readdirSync(root).filter((d) => !CATEGORIES[d] && fs.statSync(path.join(root, d)).isDirectory());
  return cases
    .flatMap((c) => {
      const dir = caseRatingsDir(c, category);
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJson<HumanRating>(path.join(dir, f)));
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function loadRating(caseId: string, ratingId: string, category = 'layout'): HumanRating {
  if (!/^[A-Za-z0-9._-]+$/.test(ratingId)) throw new Error('Invalid rating ID');
  return readJson<HumanRating>(path.join(caseRatingsDir(caseId, category), `${ratingId}.json`));
}

export async function saveRating(caseId: string, input: RatingInput, category = 'layout'): Promise<{ rating?: HumanRating; errors?: string[] }> {
  const bundle = loadBundle(caseId, input.bundleId);
  const packet = loadOrBuildPacket(bundle, input.promptVersion, categoryOf(category).id);
  await ensurePacketImages(packet, bundleDir(caseId, bundle.bundleId));
  const request = buildRequest(packet, bundleDir(caseId, bundle.bundleId), input.promptVersion);
  const result = makeRating(
    { caseId, bundleId: bundle.bundleId, interfaceId: bundle.interfaceId, promptVersion: input.promptVersion, promptHash: request.promptHash, packetHash: request.packetHash, packet },
    input,
  );
  if (result.rating) {
    writeJson(path.join(ensureDir(caseRatingsDir(caseId, category)), `${result.rating.ratingId}.json`), result.rating);
    writeHumanCsvs();
  }
  return result;
}

export function deleteRating(caseId: string, ratingId: string, category = 'layout'): void {
  if (!/^[A-Za-z0-9._-]+$/.test(ratingId)) throw new Error('Invalid rating ID');
  fs.rmSync(path.join(caseRatingsDir(caseId, category), `${ratingId}.json`), { force: true });
  writeHumanCsvs();
}

// Layout's CSVs are always written; another category's only once it has a ratings directory.
export function writeHumanCsvs(): void {
  for (const category of Object.keys(CATEGORIES)) {
    const root = categoryRatingsDir(category);
    if (category !== 'layout' && !fs.existsSync(root)) continue;
    ensureDir(root);
    for (const [name, text] of Object.entries(humanCsvs(listRatings(undefined, category), category))) fs.writeFileSync(path.join(root, name), text);
  }
}
