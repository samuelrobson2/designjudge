import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { EVIDENCE_DIR, ROOT, RUNS_DIR } from '../config.ts';
import { caseDir, listCases, loadCase } from '../cases.ts';
import { buildRequest, CATEGORIES, categoryOf, ensurePacketImages, loadOrBuildPacket, parseCategoryRubric } from '../categories/index.ts';
import { markStateScreenshots } from '../categories/layout/marks.ts';
import { listPromptVersions, promptConfig } from '../categories/layout/prompt.ts';
import { loadExpectations, loadRun, summariseRun, type CategoryExpectations } from '../compare/compare.ts';
import { resolveInside, sendFile } from '../collect/server.ts';
import { shownInteractiveStates } from '../collect/shown.ts';
import { DIAG_NAMES } from '../diagnostics/run.ts';
import { LAYOUT_CRITERIA } from '../categories/layout/definition.ts';
import { parseLayoutRubric, type ParsedRubric } from '../categories/layout/rubric.ts';
import type { CriterionDef } from '../categories/types.ts';
import { bundleDir, listBundles, listRuns, loadBundle, loadDiagnostics, runDir } from '../store.ts';
import { deleteRating, HUMAN_DIR, listRatings, loadRating, saveRating } from '../human/store.ts';
import { ratingListItem } from '../human/rating.ts';
import type { RunRecord } from '../judge/record.ts';
import { log, readJson } from '../util.ts';
import { caseNames, CATEGORY_ORDER, gridLayout, inAnyGrid, orderedCategories } from './grid.ts';
import { robustness } from './robustness.ts';

const PUBLIC_DIR = path.join(ROOT, 'src/viewer/public');

// Criteria with the rubric's statement and point definitions, for display.
function criteriaWithText(criteria: CriterionDef[], rubric: ParsedRubric) {
  return criteria.map((c) => {
    const section = rubric.criteria.find((s) => s.id === c.id);
    return {
      ...c,
      statement: section?.statement ?? '',
      points: c.points.map((p) => ({ ...p, definition: section?.points.find((x) => x.name === p.name)?.definition ?? '' })),
    };
  });
}

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function caseSummary(caseId: string) {
  const manifest = loadCase(caseId);
  const bundles = listBundles(caseId);
  let latest: unknown = null;
  if (bundles.length) {
    const bundle = loadBundle(caseId);
    const diags = loadDiagnostics(bundle);
    latest = {
      bundleId: bundle.bundleId,
      interfaceId: bundle.interfaceId,
      createdAt: bundle.createdAt,
      collected: bundle.states.filter((s) => s.status === 'collected').length,
      errors: bundle.states.filter((s) => s.status === 'error').length,
      unavailable: bundle.coverage.filter((c) => c.status === 'unavailable').length,
      failing: diags ? diags.results.filter((r) => r.status === 'fail').map((r) => r.key) : [],
    };
  }
  return {
    caseId,
    title: manifest.title,
    summary: manifest.summary ?? null,
    request: manifest.request,
    codeDir: path.relative(ROOT, caseDir(caseId)),
    interactiveStates: manifest.interactiveStates?.map((s) => ({ id: s.id, description: s.description })) ?? [],
    fixtures: manifest.fixtures?.supported ?? [],
    bundles,
    latest,
    humanRatings: listRatings(caseId).map((r) => ({ rater: r.rater, bundleId: r.bundleId })),
    inGrid: inAnyGrid(caseId),
  };
}

// The categories each interface belongs to: those whose expectations name it (in a pair or a
// note) or with a judge run that included it. Runs saved before categories existed are Layout
// runs. The home pages list the grid (grid.ts) instead.
export function caseCategories(
  expectations: Record<string, CategoryExpectations | null>,
  runs: { category?: string; cases: { caseId: string }[] }[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (caseId: string, category: string) => {
    const list = out.get(caseId) ?? [];
    if (!list.includes(category)) out.set(caseId, [...list, category]);
  };
  for (const [category, e] of Object.entries(expectations)) {
    for (const p of e?.pairs ?? []) [p.baseline, p.variant].forEach((id) => add(id, category));
    for (const id of Object.keys(e?.notes ?? {})) add(id, category);
  }
  for (const run of runs) for (const c of run.cases) add(c.caseId, run.category ?? 'layout');
  return out;
}

function savedCaseCategories() {
  const runs = listRuns().flatMap((id) => {
    try {
      return [readJson<RunRecord>(path.join(runDir(id), 'run.json'))];
    } catch {
      return [];
    }
  });
  return caseCategories(Object.fromEntries(Object.keys(CATEGORIES).map((id) => [id, loadExpectations(id)])), runs);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Every judge score for one interface in one category, per run, with the evidence bundle each
// run judged.
function judgeScores(caseId: string, category = 'layout') {
  return listRuns().flatMap((id) => {
    const reqFile = path.join(runDir(id), 'requests', `${caseId}.json`);
    if (!fs.existsSync(reqFile)) return [];
    try {
      const { run, judgments } = loadRun(id);
      if (run.provider === 'mock' || (run.category ?? 'layout') !== category) return [];
      const js = judgments.filter((j) => j.caseId === caseId);
      return [
        {
          runId: id,
          createdAt: run.createdAt,
          model: run.model,
          promptVersion: run.promptVersion,
          label: run.label ?? '',
          bundleId: readJson<{ bundleId: string }>(reqFile).bundleId,
          scores: js.map((j) => j.output?.overall.score ?? null),
        },
      ];
    } catch {
      return [];
    }
  });
}

function listCodeFiles(caseId: string) {
  const manifest = loadCase(caseId);
  if (manifest.source.type !== 'static') return [];
  const root = path.join(caseDir(caseId), manifest.source.dir);
  const out: { path: string; bytes: number }[] = [];
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out.push({ path: path.relative(root, p), bytes: fs.statSync(p).size });
    }
  };
  walk(root);
  return out;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  try {
    if (parts[0] === 'api') {
      const [, kind, a, b, c] = parts;
      if (kind === 'meta') {
        const layout = criteriaWithText(LAYOUT_CRITERIA, parseLayoutRubric());
        // Layout versions the step-by-step rating form supports (findings evidence).
        const layoutRatingVersions = listPromptVersions().filter((v) => promptConfig(v).packet.evidence === 'findings');
        return json(res, {
          diagNames: DIAG_NAMES,
          criteria: layout,
          categories: Object.fromEntries(
            orderedCategories(Object.values(CATEGORIES)).map((cat) => [
              cat.id,
              {
                id: cat.id,
                name: cat.name,
                criteria: cat.id === 'layout' ? layout : criteriaWithText(cat.criteria, parseCategoryRubric(cat)),
                promptVersions: listPromptVersions(cat.id),
                ratingVersions: cat.id === 'layout' ? layoutRatingVersions : listPromptVersions(cat.id),
              },
            ]),
          ),
          promptVersions: listPromptVersions(),
          ratingVersions: layoutRatingVersions,
          // Per category: its grid of test interfaces, and how every interface is named on its pages.
          grid: Object.fromEntries(CATEGORY_ORDER.map((id) => [id, gridLayout(id)])),
          names: caseNames(listCases()),
        });
      }
      if (kind === 'robustness') {
        return json(res, robustness(categoryOf(url.searchParams.get('category') ?? 'layout').id));
      }
      if (kind === 'cases') {
        const categories = savedCaseCategories();
        return json(res, listCases().map((id) => ({ ...caseSummary(id), categories: categories.get(id) ?? [] })));
      }
      if (kind === 'checkmarks' && a) {
        const bundle = loadBundle(a, b);
        const diags = loadDiagnostics(bundle);
        return json(res, diags ? await markStateScreenshots(bundle, diags, bundleDir(a, bundle.bundleId), DIAG_NAMES) : {});
      }
      if (kind === 'case' && a) {
        const bundle = loadBundle(a, b);
        return json(res, {
          summary: caseSummary(a),
          manifest: loadCase(a),
          codeFiles: listCodeFiles(a),
          bundle,
          diagnostics: loadDiagnostics(bundle),
          // The interactive states every judge sees, with the control clicked to reach each one.
          shownStates: shownInteractiveStates(bundle).map((s) => ({
            id: s.id,
            viewportId: s.viewportId,
            selector: (s.steps?.[0]?.step as { selector?: string } | undefined)?.selector ?? null,
          })),
        });
      }
      if (kind === 'prompt' && a) {
        const bundle = loadBundle(a, b);
        const category = categoryOf(url.searchParams.get('category') ?? 'layout').id;
        const version = url.searchParams.get('version') ?? listPromptVersions(category).at(-1)!;
        const packet = loadOrBuildPacket(bundle, version, category);
        await ensurePacketImages(packet, bundleDir(a, bundle.bundleId));
        const request = buildRequest(packet, bundleDir(a, bundle.bundleId), version);
        const composed = new Set(packet.images.filter((i) => i.composed).map((i) => i.id));
        return json(res, {
          ...request,
          bundleId: bundle.bundleId,
          request: packet.request,
          evidenceIndex: packet.index,
          promptDescription: promptConfig(version, category).description,
          images: request.images.map((i) => ({ ...i, path: path.relative(EVIDENCE_DIR, i.path), ...(composed.has(i.id) ? { composed: true } : {}) })),
        });
      }
      if (kind === 'human' && a) {
        // /api/human/<case>[/<ratingId>] for Layout, /api/human/<category>/<case>[/<ratingId>] otherwise.
        const [category, caseId, ratingId] = a !== 'layout' && CATEGORIES[a] ? [a, b, c] : ['layout', a, b];
        if (!caseId) return json(res, { error: 'Not found' }, 404);
        if (req.method === 'POST' && !ratingId) {
          const result = await saveRating(caseId, (await readBody(req)) as Parameters<typeof saveRating>[1], category);
          return json(res, result, result.errors ? 400 : 200);
        }
        if (req.method === 'DELETE' && ratingId) {
          deleteRating(caseId, ratingId, category);
          return json(res, { ok: true });
        }
        if (ratingId) {
          const rating = loadRating(caseId, ratingId, category);
          const bundle = loadBundle(caseId, rating.bundleId);
          const packet = loadOrBuildPacket(bundle, rating.promptVersion, category);
          await ensurePacketImages(packet, bundleDir(caseId, bundle.bundleId));
          const request = buildRequest(packet, bundleDir(caseId, bundle.bundleId), rating.promptVersion);
          return json(res, {
            rating,
            request: { ...request, evidenceIndex: packet.index, images: request.images.map((i) => ({ ...i, path: path.relative(EVIDENCE_DIR, i.path) })) },
          });
        }
        return json(res, {
          latestBundleId: listBundles(caseId).length ? loadBundle(caseId).bundleId : null,
          ratings: listRatings(caseId, category).map(ratingListItem),
          judge: judgeScores(caseId, category),
        });
      }
      if (kind === 'runs') {
        return json(
          res,
          listRuns().map((id) => {
            try {
              return readJson(path.join(runDir(id), 'run.json'));
            } catch {
              return { runId: id, broken: true };
            }
          }),
        );
      }
      if (kind === 'run' && a) {
        const { run, judgments } = loadRun(a);
        return json(res, {
          run,
          report: summariseRun(a),
          expectations: loadExpectations(run.category ?? 'layout'),
          judgments: judgments.map((j) => ({
            caseId: j.caseId,
            repeat: j.repeat,
            status: j.status,
            score: j.output?.overall.score ?? null,
            anchor: j.output?.overall.anchor ?? null,
            error: j.error ?? null,
            costUsd: j.costUsd,
            latencyMs: j.latencyMs,
            usage: j.usage,
            refErrors: j.validation?.refIssues.filter((i) => i.severity === 'error').length ?? null,
          })),
        });
      }
      if (kind === 'judgment' && a && b && c) {
        const file = path.join(runDir(a), 'judgments', b, `r${c}.json`);
        const reqFile = path.join(runDir(a), 'requests', `${b}.json`);
        return json(res, {
          judgment: readJson(file),
          request: fs.existsSync(reqFile) ? readJson(reqFile) : null,
        });
      }
      return json(res, { error: 'Not found' }, 404);
    }

    if (parts[0] === 'files' && parts[1] === 'evidence') {
      const file = resolveInside(EVIDENCE_DIR, '/' + parts.slice(2).join('/'));
      if (!file) return json(res, { error: 'Forbidden' }, 403);
      return sendFile(res, file);
    }
    if (parts[0] === 'files' && parts[1] === 'human') {
      const file = resolveInside(HUMAN_DIR, '/' + parts.slice(2).join('/'));
      if (!file) return json(res, { error: 'Forbidden' }, 403);
      return sendFile(res, file);
    }
    if (parts[0] === 'files' && parts[1] === 'runs') {
      const file = resolveInside(RUNS_DIR, '/' + parts.slice(2).join('/'));
      if (!file) return json(res, { error: 'Forbidden' }, 403);
      return sendFile(res, file);
    }
    if (parts[0] === 'site' && parts[1]) {
      const manifest = loadCase(parts[1]);
      if (manifest.source.type !== 'static') return json(res, { error: 'Not a static case' }, 400);
      const root = path.join(caseDir(parts[1]), manifest.source.dir);
      const rest = '/' + parts.slice(2).join('/');
      if (parts.length === 2 && !url.pathname.endsWith('/')) {
        res.writeHead(302, { location: `/site/${parts[1]}/${url.search}` });
        return res.end();
      }
      const file = resolveInside(root, rest === '/' ? '/index.html' : rest);
      if (!file) return json(res, { error: 'Forbidden' }, 403);
      // The rating page shows the interface in a sandboxed frame (an opaque origin), which can
      // only load its module scripts with CORS.
      res.setHeader('access-control-allow-origin', '*');
      return sendFile(res, file);
    }
    if (parts[0] === 'code' && parts[1]) {
      const manifest = loadCase(parts[1]);
      if (manifest.source.type !== 'static') return json(res, { error: 'Not a static case' }, 400);
      const root = path.join(caseDir(parts[1]), manifest.source.dir);
      const file = resolveInside(root, '/' + parts.slice(2).join('/'));
      if (!file || !fs.existsSync(file)) return json(res, { error: 'Not found' }, 404);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(fs.readFileSync(file));
    }

    const file = resolveInside(PUBLIC_DIR, url.pathname === '/' ? '/index.html' : url.pathname);
    if (!file || !fs.existsSync(file)) return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    return sendFile(res, file);
  } catch (err) {
    return json(res, { error: (err as Error).message }, 500);
  }
}

export async function startViewer(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => json(res, { error: String(err) }, 500));
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  if (port) log(`Viewer running at http://127.0.0.1:${port}`);
  return server;
}
