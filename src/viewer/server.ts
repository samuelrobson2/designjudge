import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { EVIDENCE_DIR, ROOT, RUNS_DIR } from '../config.ts';
import { caseDir, listCases, loadCase } from '../cases.ts';
import { loadOrBuildPacket } from '../categories/index.ts';
import { ensureMarkedScreenshots, markStateScreenshots } from '../categories/layout/marks.ts';
import { buildLayoutRequest, listPromptVersions, promptConfig } from '../categories/layout/prompt.ts';
import { loadExpectations, loadRun, summariseRun } from '../compare/compare.ts';
import { resolveInside, sendFile } from '../collect/server.ts';
import { DIAG_NAMES } from '../diagnostics/run.ts';
import { LAYOUT_CRITERIA } from '../categories/layout/definition.ts';
import { parseLayoutRubric } from '../categories/layout/rubric.ts';
import { bundleDir, listBundles, listRuns, loadBundle, loadDiagnostics, runDir } from '../store.ts';
import { deleteRating, HUMAN_DIR, listRatings, loadRating, saveRating } from '../human/store.ts';
import { log, readJson } from '../util.ts';

const PUBLIC_DIR = path.join(ROOT, 'src/viewer/public');

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
  };
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

// Every judge score for one interface, per run, with the evidence bundle each run judged.
function judgeScores(caseId: string) {
  return listRuns().flatMap((id) => {
    const reqFile = path.join(runDir(id), 'requests', `${caseId}.json`);
    if (!fs.existsSync(reqFile)) return [];
    try {
      const { run, judgments } = loadRun(id);
      if (run.provider === 'mock') return [];
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
        const rubric = parseLayoutRubric();
        return json(res, {
          diagNames: DIAG_NAMES,
          criteria: LAYOUT_CRITERIA.map((c) => {
            const section = rubric.criteria.find((s) => s.id === c.id);
            return {
              ...c,
              statement: section?.statement ?? '',
              points: c.points.map((p) => ({ ...p, definition: section?.points.find((x) => x.name === p.name)?.definition ?? '' })),
            };
          }),
          promptVersions: listPromptVersions(),
          // Versions the step-by-step rating form supports (findings evidence).
          ratingVersions: listPromptVersions().filter((v) => promptConfig(v).packet.evidence === 'findings'),
        });
      }
      if (kind === 'cases') return json(res, listCases().map(caseSummary));
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
        });
      }
      if (kind === 'prompt' && a) {
        const bundle = loadBundle(a, b);
        const version = url.searchParams.get('version') ?? listPromptVersions().at(-1)!;
        const packet = loadOrBuildPacket(bundle, version);
        await ensureMarkedScreenshots(packet, bundleDir(a, bundle.bundleId));
        const request = buildLayoutRequest(packet, bundleDir(a, bundle.bundleId), version);
        return json(res, {
          ...request,
          bundleId: bundle.bundleId,
          request: packet.request,
          evidenceIndex: packet.index,
          promptDescription: promptConfig(version).description,
          images: request.images.map((i) => ({ ...i, path: path.relative(EVIDENCE_DIR, i.path) })),
        });
      }
      if (kind === 'human' && a) {
        if (req.method === 'POST' && !b) {
          const result = await saveRating(a, (await readBody(req)) as Parameters<typeof saveRating>[1]);
          return json(res, result, result.errors ? 400 : 200);
        }
        if (req.method === 'DELETE' && b) {
          deleteRating(a, b);
          return json(res, { ok: true });
        }
        if (b) {
          const rating = loadRating(a, b);
          const bundle = loadBundle(a, rating.bundleId);
          const packet = loadOrBuildPacket(bundle, rating.promptVersion);
          await ensureMarkedScreenshots(packet, bundleDir(a, bundle.bundleId));
          const request = buildLayoutRequest(packet, bundleDir(a, bundle.bundleId), rating.promptVersion);
          return json(res, {
            rating,
            request: { ...request, evidenceIndex: packet.index, images: request.images.map((i) => ({ ...i, path: path.relative(EVIDENCE_DIR, i.path) })) },
          });
        }
        return json(res, {
          latestBundleId: listBundles(a).length ? loadBundle(a).bundleId : null,
          ratings: listRatings(a).map((r) => ({
            ratingId: r.ratingId,
            rater: r.rater,
            createdAt: r.createdAt,
            bundleId: r.bundleId,
            promptVersion: r.promptVersion,
            durationMs: r.durationMs,
            score: r.output.overall.score,
            anchor: r.output.overall.anchor,
          })),
          judge: judgeScores(a),
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
          expectations: loadExpectations(),
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
  log(`Viewer running at http://127.0.0.1:${port}`);
  return server;
}
