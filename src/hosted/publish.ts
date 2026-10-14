// Builds the hosted rating site in Vercel's Build Output format (.vercel/output), then deploys it
// with `vercel deploy --prebuilt`. The evidence lives only on this machine, so the site is
// always built here rather than by Vercel from the repo.
//
// The site is a snapshot of the local viewer: every judge run, and the latest evidence of each
// interface a category lists, shown with each category's latest rating prompt version. Ratings are committed to the GitHub repo by one function (src/hosted/api.ts).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import { EVIDENCE_DIR, ROOT, RUNS_DIR } from '../config.ts';
import { caseDir, loadCase } from '../cases.ts';
import { loadOrBuildPacket } from '../categories/index.ts';
import { HUMAN_DIR } from '../human/store.ts';
import { loadBundle } from '../store.ts';
import { log } from '../util.ts';
import { startViewer } from '../viewer/server.ts';
import { writeInlinedSite } from './inline.ts';
import type { HostedKit, HostedVersion } from './kit.ts';

const OUT = path.join(ROOT, '.vercel', 'output');
const PUBLIC_DIR = path.join(ROOT, 'src/viewer/public');

// The rating code imports modules that also build packets and screenshots; those paths never run
// in the function, so native and browser dependencies are replaced with empty modules.
const stubNative: Plugin = {
  name: 'stub-native',
  setup(b) {
    b.onResolve({ filter: /^(sharp|playwright|playwright-core)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
  },
};

function writeJsonFile(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function copyInto(from: string, to: string) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

export async function buildHostedSite(out = OUT): Promise<void> {
  const STATIC = path.join(out, 'static');
  fs.rmSync(out, { recursive: true, force: true });
  const server = await startViewer(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
  const get = async <T = any>(p: string): Promise<T> => {
    const res = await fetch(base + p);
    const data = await res.json();
    if (!res.ok) throw new Error(`${p}: ${data.error ?? res.statusText}`);
    return data as T;
  };

  try {
    const meta = await get('meta');
    const version: string = meta.ratingVersions.at(-1);
    const categories = (Object.values(meta.categories) as { id: string; ratingVersions: string[] }[])
      .filter((c) => c.ratingVersions.length)
      .map((c) => ({ ...c, version: c.ratingVersions.at(-1)! }));
    writeJsonFile(path.join(STATIC, 'data/meta.json'), {
      ...meta,
      promptVersions: [version],
      ratingVersions: [version],
      categories: Object.fromEntries(categories.map(({ version: v, ...c }) => [c.id, { ...c, promptVersions: [v], ratingVersions: [v] }])),
      hosted: true,
    });

    // Each category's robustness tests: the summary only; the planted variants are never published.
    for (const id of Object.keys(meta.categories)) {
      writeJsonFile(path.join(STATIC, `data/robustness${id === 'layout' ? '' : `.${id}`}.json`), await get(`robustness?category=${id}`));
    }

    const cases = (await get<any[]>('cases')).filter((c) => c.inGrid || c.categories.length);
    writeJsonFile(path.join(STATIC, 'data/cases.json'), cases.map((c) => ({ ...c, bundles: c.latest ? [c.latest.bundleId] : [], humanRatings: [] })));

    const kit: HostedKit = { github: githubTarget(), cases: {} };
    const copied = new Set<string>();
    const copyEvidence = (rel: string) => {
      if (copied.has(rel)) return;
      copied.add(rel);
      copyInto(path.join(EVIDENCE_DIR, rel), path.join(STATIC, 'files/evidence', rel));
    };

    // Judge runs: each run's summary and every judgment, with the screenshots it was shown.
    const runs = await get<{ runId: string; broken?: boolean }[]>('runs');
    writeJsonFile(path.join(STATIC, 'data/runs.json'), runs);
    let judgments = 0;
    for (const { runId, broken } of runs) {
      if (broken) continue;
      const run = await get<{ judgments: { caseId: string; repeat: number }[] }>(`run/${runId}`);
      writeJsonFile(path.join(STATIC, `data/run/${runId}.json`), run);
      for (const name of fs.readdirSync(path.join(RUNS_DIR, runId)).filter((f) => f.endsWith('.csv'))) {
        copyInto(path.join(RUNS_DIR, runId, name), path.join(STATIC, 'files/runs', runId, name));
      }
      for (const j of run.judgments) {
        const one = await get<{ request: { images?: { path: string }[] } | null }>(`judgment/${runId}/${j.caseId}/${j.repeat}`).catch(() => null);
        if (!one) continue;
        writeJsonFile(path.join(STATIC, `data/judgment/${runId}/${j.caseId}/${j.repeat}.json`), one);
        for (const img of one.request?.images ?? []) copyEvidence(img.path);
        judgments++;
      }
    }
    for (const c of cases) {
      if (!c.latest) continue;
      const caseId: string = c.caseId;
      const bundleId: string = c.latest.bundleId;
      if (meta.categories[caseId]) throw new Error(`Interface ${caseId} has a category's name, which the ratings routes cannot tell apart.`);
      const data = await get(`case/${caseId}`);
      writeJsonFile(path.join(STATIC, `data/case/${caseId}.json`), { ...data, summary: { ...data.summary, bundles: [bundleId], humanRatings: [] } });

      // All captured states: every screenshot, with failing checks outlined.
      const checkmarks = await get<Record<string, { shots: { path: string; crop?: string }[] }>>(`checkmarks/${caseId}/${bundleId}`);
      writeJsonFile(path.join(STATIC, `data/checkmarks/${caseId}/${bundleId}.json`), checkmarks);
      const statePaths = [
        ...data.bundle.states.flatMap((s: { screenshots: { path: string }[] }) => s.screenshots.map((shot) => shot.path)),
        ...Object.values(checkmarks).flatMap((m) => m.shots.flatMap((shot) => [shot.path, shot.crop].filter((p): p is string => !!p))),
      ];
      for (const p of new Set(statePaths)) copyEvidence(`${caseId}/${bundleId}/${p}`);

      // What the judge sees and what a rating is checked against, per category. Layout's files keep
      // their names from before other categories were rated.
      const bundle = loadBundle(caseId, bundleId);
      const judge: Record<string, unknown[]> = {};
      const versions: Record<string, Record<string, HostedVersion>> = {};
      for (const { id, version: v } of categories) {
        const layout = id === 'layout';
        const prompt = await get(`prompt/${caseId}/${bundleId}?category=${id}&version=${v}`);
        writeJsonFile(path.join(STATIC, `data/prompt/${caseId}/${bundleId}.${layout ? '' : `${id}.`}${v}.json`), prompt);
        for (const img of prompt.images as { path: string }[]) copyEvidence(img.path);
        judge[id] = (await get(`human/${layout ? '' : `${id}/`}${caseId}`)).judge;
        versions[id] = { [v]: { promptHash: prompt.promptHash, packetHash: prompt.packetHash, packet: loadOrBuildPacket(bundle, v, id), request: prompt } };
      }
      kit.cases[caseId] = { latestBundleId: bundleId, judge, bundles: { [bundleId]: { interfaceId: bundle.interfaceId, categories: versions } } };

      const manifest = loadCase(caseId);
      if (manifest.source.type === 'static') {
        const src = path.join(caseDir(caseId), manifest.source.dir);
        await writeInlinedSite(src, path.join(STATIC, 'site', caseId));
        copyInto(src, path.join(STATIC, 'code', caseId));
      }
    }

    for (const name of fs.readdirSync(PUBLIC_DIR).filter((f) => !f.startsWith('.'))) copyInto(path.join(PUBLIC_DIR, name), path.join(STATIC, name));
    const indexFile = path.join(STATIC, 'index.html');
    fs.writeFileSync(indexFile, fs.readFileSync(indexFile, 'utf8').replace('<script type="module"', '<script>window.DJ_HOSTED = true;</script>\n    <script type="module"'));

    await buildRatingsFunction(path.join(out, 'functions', 'api', 'human.func'), kit);

    writeJsonFile(path.join(out, 'config.json'), {
      version: 3,
      routes: [
        { src: '^/api/human/?$', dest: '/api/human' },
        { src: '^/api/human/(.+)$', dest: '/api/human?path=$1' },
        { src: '^/files/human/(ratings|findings|points)\\.csv$', dest: '/api/human?csv=$1' },
        { src: '^/files/human/([a-z_]+)/(ratings|findings|points)\\.csv$', dest: '/api/human?csv=$2&category=$1' },
        { src: '^/data/(.*)$', headers: { 'cache-control': 'public, max-age=0, must-revalidate' }, continue: true },
        { src: '^/site/(.*)$', headers: { 'access-control-allow-origin': '*' }, continue: true },
        // Sites link their files relatively, which only resolves under the trailing slash.
        { src: '^/site/([^/]+)$', status: 308, headers: { Location: '/site/$1/' } },
        { handle: 'filesystem' },
        { src: '^/site/([^/]+)/$', dest: '/site/$1/index.html' },
        { src: '^/api/(.*)$', status: 404, dest: '/404.json' },
      ],
    });
    writeJsonFile(path.join(STATIC, '404.json'), { error: 'Not found' });
    log(
      `Built hosted site in ${path.relative(ROOT, out)}: ${Object.keys(kit.cases).length} interfaces, ${runs.length} judge runs (${judgments} judgments), rating ${categories.map((c) => `${c.id} ${c.version}`).join(', ')}, ${copied.size} images; ratings go to ${kit.github.repo}/${kit.github.dir} on ${kit.github.branch}`,
    );
  } finally {
    server.close();
  }
}

// The ratings function and its kit, in Vercel's function format.
export async function buildRatingsFunction(funcDir: string, kit: HostedKit): Promise<void> {
  await build({
    entryPoints: [path.join(ROOT, 'src/hosted/api.ts')],
    outfile: path.join(funcDir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    plugins: [stubNative],
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    logLevel: 'warning',
  });
  writeJsonFile(path.join(funcDir, 'kit.json'), kit);
  writeJsonFile(path.join(funcDir, '.vc-config.json'), { runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 });
}

// The GitHub repo of `origin` (override with DJ_RATINGS_REPO=owner/name); ratings go to its main
// branch unless DJ_RATINGS_BRANCH is set.
function githubTarget(): HostedKit['github'] {
  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const repo = process.env.DJ_RATINGS_REPO ?? remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  if (!repo) throw new Error('Could not tell which GitHub repo to save ratings to; set DJ_RATINGS_REPO=owner/name.');
  return { repo, branch: process.env.DJ_RATINGS_BRANCH ?? 'main', dir: path.relative(ROOT, HUMAN_DIR).split(path.sep).join('/') };
}

export function deployHostedSite(): void {
  const r = spawnSync('vercel', ['deploy', '--prebuilt', '--prod', '--yes'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('vercel deploy failed');
}
