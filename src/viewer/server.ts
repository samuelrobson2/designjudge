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
import { bundleDir, listBundles, listRuns, loadBundle, loadDiagnostics, runDir } from '../store.ts';
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
    request: manifest.request,
    codeDir: path.relative(ROOT, caseDir(caseId)),
    interactiveStates: manifest.interactiveStates?.map((s) => ({ id: s.id, description: s.description })) ?? [],
    fixtures: manifest.fixtures?.supported ?? [],
    bundles,
    latest,
  };
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
      if (kind === 'meta') return json(res, { diagNames: DIAG_NAMES, criteria: LAYOUT_CRITERIA, promptVersions: listPromptVersions() });
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
          promptDescription: promptConfig(version).description,
          images: request.images.map((i) => ({ ...i, path: path.relative(EVIDENCE_DIR, i.path) })),
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
