import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listCases } from '../src/cases.ts';
import type { HostedKit } from '../src/hosted/kit.ts';
import { listBundles } from '../src/store.ts';

const caseId = listCases().find((c) => listBundles(c).length);
const RATED: [string, string][] = [
  ['layout', 'v6'],
  ['typography', 'v1'],
  ['content_quality', 'v1'],
  ['visual_system', 'v1'],
  ['functionality', 'v1'],
];

// The GitHub contents and blobs API, in memory: files by repo path, blob SHAs derived from paths.
function fakeGitHub(files: Map<string, string>, commits: string[]) {
  const sha = (p: string) => Buffer.from(p).toString('hex');
  return async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/(contents|git\/blobs)\/(.+)$/);
    if (!m) return new Response('{}', { status: 404 });
    const raw = String((init.headers as Record<string, string>)?.accept ?? '').includes('raw');
    if (m[1] === 'git/blobs') return new Response(files.get(Buffer.from(m[2], 'hex').toString()) ?? '', { status: 200 });
    const p = decodeURIComponent(m[2]);
    if (init.method === 'PUT') {
      if (files.has(p)) return new Response('{}', { status: 422 });
      const body = JSON.parse(String(init.body));
      files.set(p, Buffer.from(body.content, 'base64').toString());
      commits.push(body.message);
      return new Response('{}', { status: 201 });
    }
    if (files.has(p)) return new Response(raw ? files.get(p) : JSON.stringify({ name: path.basename(p), sha: sha(p), type: 'file' }), { status: 200 });
    const children = new Map<string, string>();
    for (const f of files.keys()) {
      if (!f.startsWith(`${p}/`)) continue;
      const [name, ...rest] = f.slice(p.length + 1).split('/');
      children.set(name, rest.length ? 'dir' : 'file');
    }
    if (!children.size) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify([...children].map(([name, type]) => ({ name, type, sha: sha(`${p}/${name}`) }))), { status: 200 });
  };
}

describe.skipIf(!caseId)('Hosted ratings function', () => {
  const funcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-func-'));
  const files = new Map<string, string>();
  const commits: string[] = [];
  const outputs: Record<string, unknown> = {};
  const realFetch = globalThis.fetch;
  let handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  let bundleId = '';

  const call = (method: string, url: string, body?: unknown) =>
    new Promise<{ status: number; body: any }>((resolve) => {
      const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url }) as unknown as IncomingMessage;
      let status = 0;
      let type = '';
      const res = {
        setHeader() {},
        writeHead(s: number, headers: Record<string, string>) {
          status = s;
          type = headers['content-type'] ?? '';
        },
        end(text: string) {
          resolve({ status, body: type.startsWith('application/json') ? JSON.parse(text) : text });
        },
      } as unknown as ServerResponse;
      void handler(req, res);
    });
  const rate = (route: string, category: string, version: string, output = outputs[category]) =>
    call('POST', route, { bundleId, promptVersion: version, rater: 'Ada Lovelace', output, view: 'live' });

  beforeAll(async () => {
    const { buildRatingsFunction } = await import('../src/hosted/publish.ts');
    const { buildRequest, ensurePacketImages, loadOrBuildPacket } = await import('../src/categories/index.ts');
    const { mockProvider } = await import('../src/judge/providers/mock.ts');
    const { bundleDir, loadBundle } = await import('../src/store.ts');
    const bundle = loadBundle(caseId!);
    bundleId = bundle.bundleId;
    const categories: HostedKit['cases'][string]['bundles'][string]['categories'] = {};
    for (const [category, version] of RATED) {
      const packet = loadOrBuildPacket(bundle, version, category);
      await ensurePacketImages(packet, bundleDir(caseId!, bundleId));
      const req = buildRequest(packet, bundleDir(caseId!, bundleId), version);
      categories[category] = { [version]: { promptHash: req.promptHash, packetHash: req.packetHash, packet, request: { category } } };
      outputs[category] = JSON.parse((await mockProvider('ok').call(req, { model: 'm', effort: 'low', caseId: caseId!, repeat: 1, packet })).outputText!);
    }
    const kit: HostedKit = {
      github: { repo: 'owner/repo', branch: 'main', dir: 'benchmark/human' },
      cases: { [caseId!]: { latestBundleId: bundleId, judge: { layout: [{ runId: 'layout-run' }], typography: [{ runId: 'typography-run' }] }, bundles: { [bundleId]: { interfaceId: bundle.interfaceId, categories } } } },
    };
    await buildRatingsFunction(funcDir, kit);
    process.env.GITHUB_TOKEN = 'test';
    globalThis.fetch = fakeGitHub(files, commits) as typeof fetch;
    handler = (await import(pathToFileURL(path.join(funcDir, 'index.mjs')).href)).default;
  }, 60_000);

  afterAll(() => {
    globalThis.fetch = realFetch;
    delete process.env.GITHUB_TOKEN;
    fs.rmSync(funcDir, { recursive: true, force: true });
  });

  it('commits Layout ratings where they always went, and other categories under their own folder', async () => {
    const layout = await rate(`/api/human?path=${caseId}`, 'layout', 'v6');
    expect(layout.status).toBe(200);
    expect(layout.body.rating.category).toBeUndefined();
    expect(files.has(`benchmark/human/${caseId}/${layout.body.rating.ratingId}.json`)).toBe(true);
    expect(commits.at(-1)).toBe(`Add human rating ${caseId}/${layout.body.rating.ratingId}`);

    const typography = await rate(`/api/human?path=typography/${caseId}`, 'typography', 'v1');
    expect(typography.status).toBe(200);
    expect(typography.body.rating.category).toBe('typography');
    expect(files.has(`benchmark/human/typography/${caseId}/${typography.body.rating.ratingId}.json`)).toBe(true);
    expect(commits.at(-1)).toBe(`Add human rating typography/${caseId}/${typography.body.rating.ratingId}`);

    // The original pathname works as well as the rewritten one.
    const cq = await rate(`/api/human/content_quality/${caseId}`, 'content_quality', 'v1');
    expect(cq.status).toBe(200);
    expect(files.has(`benchmark/human/content_quality/${caseId}/${cq.body.rating.ratingId}.json`)).toBe(true);

    for (const category of ['visual_system', 'functionality']) {
      const r = await rate(`/api/human?path=${category}/${caseId}`, category, 'v1');
      expect(r.status, category).toBe(200);
      expect(r.body.rating.category).toBe(category);
      expect(files.has(`benchmark/human/${category}/${caseId}/${r.body.rating.ratingId}.json`)).toBe(true);
    }
  });

  it('rejects a rating for the wrong category, or one the site has no evidence for', async () => {
    const wrongShape = await rate(`/api/human?path=typography/${caseId}`, 'typography', 'v1', outputs.content_quality);
    expect(wrongShape.status).toBe(400);
    const notPublished = await rate(`/api/human?path=task_fit/${caseId}`, 'task_fit', 'v1', outputs.content_quality);
    expect(notPublished.status).toBe(400);
    const wrongVersion = await rate(`/api/human?path=${caseId}`, 'layout', 'v1');
    expect(wrongVersion.status).toBe(400);
  });

  it('lists, reads and exports each category separately', async () => {
    const layout = await call('GET', `/api/human?path=${caseId}`);
    expect(layout.body.ratings).toHaveLength(1);
    expect(layout.body.judge).toEqual([{ runId: 'layout-run' }]);
    const typography = await call('GET', `/api/human/typography/${caseId}`);
    expect(typography.body.ratings).toHaveLength(1);
    expect(typography.body.judge).toEqual([{ runId: 'typography-run' }]);
    expect((await call('GET', `/api/human?path=task_fit/${caseId}`)).body).toMatchObject({ ratings: [], judge: [] });
    expect(await call('GET', '/api/human')).toMatchObject({ status: 200, body: [expect.objectContaining({ ratingId: layout.body.ratings[0].ratingId })] });

    const one = await call('GET', `/api/human?path=typography/${caseId}/${typography.body.ratings[0].ratingId}`);
    expect(one.body.rating.category).toBe('typography');
    expect(one.body.request).toEqual({ category: 'typography' });
    const cqId = (await call('GET', `/api/human?path=content_quality/${caseId}`)).body.ratings[0].ratingId;
    expect((await call('GET', `/api/human?path=content_quality/${caseId}/${cqId}`)).body.rating.category).toBe('content_quality');
    expect((await call('GET', `/api/human?path=${caseId}/${cqId}`)).body.rating.category).toBeUndefined();
    expect((await call('GET', `/api/human?path=task_fit/${caseId}/${cqId}`)).status).toBe(404);

    const rows = (text: string) => text.trim().split('\n');
    const layoutCsv = rows((await call('GET', '/api/human?csv=ratings')).body);
    const typographyCsv = rows((await call('GET', '/api/human?csv=ratings&category=typography')).body);
    const cqCsv = rows((await call('GET', '/files/human/content_quality/ratings.csv')).body);
    expect(layoutCsv).toHaveLength(2);
    expect(typographyCsv).toHaveLength(2);
    expect(typographyCsv[0]).toContain('criterion_D_summary');
    expect(cqCsv).toHaveLength(2);
    expect(cqCsv[0]).toContain('criterion_C_summary');
    expect(cqCsv[0]).not.toContain('criterion_D_summary');

    const vsCsv = rows((await call('GET', '/files/human/visual_system/ratings.csv')).body);
    const fnCsv = rows((await call('GET', '/api/human?csv=ratings&category=functionality')).body);
    expect(vsCsv).toHaveLength(2);
    expect(vsCsv[0]).toContain('criterion_C_summary');
    expect(vsCsv[0]).not.toContain('criterion_D_summary');
    expect(fnCsv).toHaveLength(2);
    expect(fnCsv[0]).toContain('criterion_D_summary');
    expect((await call('GET', `/api/human/functionality/${caseId}`)).body).toMatchObject({ ratings: [expect.objectContaining({ promptVersion: 'v1' })], judge: [] });
  });
});
