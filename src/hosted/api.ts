// The one server-side piece of the hosted rating site: saves each rating as a new file in the
// GitHub repo (benchmark/human/<case>/<ratingId>.json, the same layout as local ratings) and
// lists them. Everything else on the site is static files written by `npm run publish`.

import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { humanCsvs, makeRating, ratingListItem, type HumanRating, type RatingInput } from '../human/rating.ts';
import type { HostedKit } from './kit.ts';

const kit: HostedKit = JSON.parse(fs.readFileSync(new URL('./kit.json', import.meta.url), 'utf8'));
const { repo, branch, dir } = kit.github;

const MAX_BODY_BYTES = 512 * 1024;
const ID = /^[A-Za-z0-9._-]+$/;
const LIST_TTL_MS = 5000;

class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function gh(pathname: string, init: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<any> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Saving ratings is not set up yet (GITHUB_TOKEN is missing).');
  const res = await fetch(`https://api.github.com/repos/${repo}/${pathname}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: init.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'designjudge-ratings',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw new GitHubError(res.status, `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return init.raw ? res.text() : res.json();
}

// Rating files never change once written, so their contents are cached by blob SHA; directory
// listings are cached briefly per instance.
const blobs = new Map<string, HumanRating>();
const listings = new Map<string, { at: number; files: { name: string; sha: string; type: string }[] }>();

async function listDir(p: string) {
  const hit = listings.get(p);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.files;
  let files: { name: string; sha: string; type: string }[];
  try {
    files = await gh(`contents/${p}?ref=${encodeURIComponent(branch)}`);
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) files = [];
    else throw err;
  }
  listings.set(p, { at: Date.now(), files });
  return files;
}

async function readBlob(sha: string): Promise<HumanRating> {
  let r = blobs.get(sha);
  if (!r) {
    r = JSON.parse(await gh(`git/blobs/${sha}`, { raw: true })) as HumanRating;
    blobs.set(sha, r);
  }
  return r;
}

async function ratingsFor(caseId?: string): Promise<HumanRating[]> {
  const cases = caseId ? [caseId] : (await listDir(dir)).filter((f) => f.type === 'dir' && kit.cases[f.name]).map((f) => f.name);
  const files = (await Promise.all(cases.map((c) => listDir(`${dir}/${c}`)))).flat().filter((f) => f.type === 'file' && f.name.endsWith('.json'));
  return (await Promise.all(files.map((f) => readBlob(f.sha)))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function ratingById(caseId: string, ratingId: string): Promise<HumanRating | null> {
  try {
    return JSON.parse(await gh(`contents/${dir}/${caseId}/${ratingId}.json?ref=${encodeURIComponent(branch)}`, { raw: true }));
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null;
    throw err;
  }
}

// Each rating is a new file, so saves never edit each other; GitHub answers 409 when two commits
// race for the branch (retry) and 422 when the file already exists (pick another ID).
async function commitRating(rating: HumanRating): Promise<HumanRating> {
  let r = rating;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await gh(`contents/${dir}/${r.caseId}/${r.ratingId}.json`, {
        method: 'PUT',
        body: { message: `Add human rating ${r.caseId}/${r.ratingId}`, content: Buffer.from(JSON.stringify(r, null, 2)).toString('base64'), branch },
      });
      listings.delete(`${dir}/${r.caseId}`);
      listings.delete(dir);
      return r;
    } catch (err) {
      if (!(err instanceof GitHubError)) throw err;
      if (err.status === 422) r = { ...rating, ratingId: `${rating.ratingId}-${attempt + 1}` };
      else if (err.status === 409) await new Promise((res) => setTimeout(res, 300 * attempt + Math.random() * 300));
      else throw err;
    }
  }
  throw new Error('Could not save the rating. Please try again.');
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('The rating is too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        reject(new Error('The request body is not valid JSON.'));
      }
    });
  });
}

// Routes reach this function as /api/human?path=<case>[/<ratingId>] or /api/human?csv=<name>;
// the original pathname is also accepted.
function route(req: IncomingMessage): { parts: string[]; csvName: string | null } {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const csvName = url.searchParams.get('csv') ?? url.pathname.match(/^\/files\/human\/(ratings|findings|points)\.csv$/)?.[1] ?? null;
  const raw = url.searchParams.get('path') ?? url.pathname.replace(/^\/api\/human\/?/, '');
  return { parts: raw.split('/').filter(Boolean).map(decodeURIComponent), csvName };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const { parts, csvName } = route(req);
    const [caseId, ratingId] = parts;

    if (csvName) {
      const file = `${csvName}.csv` as keyof ReturnType<typeof humanCsvs>;
      const text = humanCsvs(await ratingsFor())[file];
      if (text === undefined) return send(res, 404, { error: 'Not found' });
      res.setHeader('content-disposition', `attachment; filename="${file}"`);
      return send(res, 200, text, 'text/csv; charset=utf-8');
    }
    if (req.method === 'DELETE') return send(res, 405, { error: 'Ratings cannot be deleted on the hosted site.' });
    if (!caseId) {
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      return send(res, 200, await ratingsFor());
    }
    const c = kit.cases[caseId];
    if (!ID.test(caseId) || !c) return send(res, 404, { error: `Unknown interface ${caseId}` });

    if (req.method === 'POST' && !ratingId) {
      const input = (await readBody(req)) as RatingInput | null;
      const version = input && c.bundles[input.bundleId]?.versions[input.promptVersion];
      if (!input || !version) return send(res, 400, { errors: ['The evidence for this interface has changed since you started. Reload the page and try again.'] });
      const result = makeRating(
        {
          caseId,
          bundleId: input.bundleId,
          interfaceId: c.bundles[input.bundleId].interfaceId,
          promptVersion: input.promptVersion,
          promptHash: version.promptHash,
          packetHash: version.packetHash,
          packet: version.packet,
        },
        input,
      );
      if (!result.rating) return send(res, 400, { errors: result.errors });
      return send(res, 200, { rating: await commitRating(result.rating) });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

    if (ratingId) {
      if (!ID.test(ratingId)) return send(res, 400, { error: 'Invalid rating ID' });
      const rating = await ratingById(caseId, ratingId);
      if (!rating) return send(res, 404, { error: 'Rating not found' });
      return send(res, 200, { rating, request: c.bundles[rating.bundleId]?.versions[rating.promptVersion]?.request ?? null });
    }
    return send(res, 200, { latestBundleId: c.latestBundleId, ratings: (await ratingsFor(caseId)).map(ratingListItem), judge: c.judge });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: err instanceof GitHubError ? 'Could not reach the ratings store. Please try again.' : (err as Error).message });
  }
}
