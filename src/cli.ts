import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT } from './config.ts';
import { listCases, loadCase } from './cases.ts';
import { collectCase } from './collect/collect.ts';
import { diagnoseAndSave } from './diagnostics/run.ts';
import { latestBundleId, loadBundle } from './store.ts';
import { log } from './util.ts';

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const HELP = `designjudge — Layout judge and evaluation harness

Usage:
  npm run collect  -- [caseId ...]            Collect evidence (all cases if none given), then run diagnostics and build judge packets
  npm run diagnose -- [caseId ...]            Recompute diagnostics and packets from saved evidence (no browser)
  npm run judge    -- [caseId ...] [options]  Run the Layout judge on the latest evidence
      --provider openai|mock|replay   (default openai)
      --model <id>                    (default gpt-6-sol)
      --repeats <n>                   (default 5)
      --effort <none|low|medium|high|xhigh|max>  reasoning effort (default medium)
      --concurrency <n>               (default 3)
      --prompt <version>              v1 = full rubric, evidence by type; v2 = judge rubric, evidence by criterion (default: latest)
      --replay-run <runId>            source run for --provider replay
      --mock-mode ok|invalid_json|unknown_refs  (default ok)
      --label <text>                  free-text label stored with the run
  npm run mutate   -- [caseId ...] [--only id,id] [--concurrency n] [--dir <folder>] [--rescore <runId>]  Planted-defect testing: collect each breakage in mutations/ and compare its check results with a clean control
  npm run report   -- [caseId ...] [--prompt <version>]  Write summary.csv and checks.csv for the latest evidence (no judge run) to artifacts/reports/latest
  npm run compare  -- <runId> [runId ...]     Summarise runs (stability, pair deltas, validity, cost) and write summary.csv, checks.csv and findings.csv
  npm run view     -- [--port 4600]           Open the web viewer
  npm run publish  -- [--build-only]          Build the hosted rating site from the latest evidence and deploy it to Vercel
  npm run human-csvs                          Rewrite benchmark/human/*.csv from the rating files (e.g. after git pull brings in hosted ratings)
  npm run calibration-data                    Download UICrit designer critiques and their Rico screenshots into artifacts/calibration
`;

async function resolveCases(ids: string[]): Promise<string[]> {
  const all = listCases();
  if (!ids.length) return all;
  for (const id of ids) if (!all.includes(id)) throw new Error(`Unknown case "${id}". Known: ${all.join(', ')}`);
  return ids;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      provider: { type: 'string', default: 'openai' },
      model: { type: 'string', default: 'gpt-6-sol' },
      repeats: { type: 'string', default: '5' },
      effort: { type: 'string', default: 'medium' },
      concurrency: { type: 'string', default: '3' },
      prompt: { type: 'string' },
      'replay-run': { type: 'string' },
      'mock-mode': { type: 'string', default: 'ok' },
      label: { type: 'string' },
      port: { type: 'string', default: '4600' },
      only: { type: 'string' },
      dir: { type: 'string' },
      rescore: { type: 'string' },
      'build-only': { type: 'boolean', default: false },
    },
  });

  switch (command) {
    case 'collect': {
      for (const id of await resolveCases(positionals)) {
        const bundle = await collectCase(loadCase(id));
        await postCollect(id, bundle.bundleId);
      }
      await refreshReport();
      break;
    }
    case 'diagnose': {
      for (const id of await resolveCases(positionals)) await postCollect(id);
      await refreshReport();
      break;
    }
    case 'judge': {
      const { runJudge } = await import('./judge/run.ts');
      const { listPromptVersions } = await import('./categories/layout/prompt.ts');
      const runId = await runJudge({
        caseIds: await resolveCases(positionals),
        provider: values.provider as 'openai' | 'mock' | 'replay',
        model: values.model!,
        repeats: parseInt(values.repeats!, 10),
        effort: values.effort!,
        concurrency: parseInt(values.concurrency!, 10),
        promptVersion: values.prompt ?? listPromptVersions().at(-1)!,
        replayRun: values['replay-run'],
        mockMode: values['mock-mode'] as 'ok' | 'invalid_json' | 'unknown_refs',
        label: values.label,
      });
      const { compareRuns } = await import('./compare/compare.ts');
      compareRuns([runId]);
      log(`\nRun ${runId} complete. Open the viewer with: npm run view`);
      break;
    }
    case 'mutate': {
      const { runMutations, rescoreRun } = await import('./mutate/run.ts');
      if (values.rescore) {
        rescoreRun(values.rescore, { dir: values.dir });
        break;
      }
      await runMutations({ caseIds: positionals, only: values.only ? values.only.split(',') : undefined, concurrency: parseInt(values.concurrency!, 10), dir: values.dir });
      break;
    }
    case 'report': {
      const { writeEvidenceReport } = await import('./report/csv.ts');
      const { listPromptVersions } = await import('./categories/layout/prompt.ts');
      const dir = writeEvidenceReport(await resolveCases(positionals), values.prompt ?? listPromptVersions().at(-1)!);
      log(`summary.csv and checks.csv written to ${path.relative(process.cwd(), dir)}`);
      break;
    }
    case 'compare': {
      const { compareRuns } = await import('./compare/compare.ts');
      if (!positionals.length) throw new Error('Pass one or more run IDs.');
      compareRuns(positionals);
      break;
    }
    case 'view': {
      const { startViewer } = await import('./viewer/server.ts');
      await startViewer(parseInt(values.port!, 10));
      break;
    }
    case 'publish': {
      const { buildHostedSite, deployHostedSite } = await import('./hosted/publish.ts');
      await buildHostedSite();
      if (!values['build-only']) deployHostedSite();
      break;
    }
    case 'human-csvs': {
      const { HUMAN_DIR, listRatings, writeHumanCsvs } = await import('./human/store.ts');
      writeHumanCsvs();
      log(`ratings.csv, findings.csv and points.csv written to ${path.relative(process.cwd(), HUMAN_DIR)} (${listRatings().length} ratings)`);
      break;
    }
    case 'calibration-data': {
      const { buildCalibrationDataset } = await import('./calibration/uicrit.ts');
      await buildCalibrationDataset();
      break;
    }
    default:
      process.stdout.write(HELP);
  }
}

// Keeps artifacts/reports/latest in step with the newest evidence for every case.
async function refreshReport() {
  const { writeEvidenceReport } = await import('./report/csv.ts');
  const { listPromptVersions } = await import('./categories/layout/prompt.ts');
  const withEvidence = listCases().filter((id) => latestBundleId(id));
  const dir = writeEvidenceReport(withEvidence, listPromptVersions().at(-1)!);
  log(`[report] summary.csv and checks.csv written to ${path.relative(process.cwd(), dir)}`);
}

async function postCollect(caseId: string, bundleId?: string) {
  const bundle = loadBundle(caseId, bundleId);
  const diags = diagnoseAndSave(bundle);
  const fails = diags.results.filter((r) => r.status === 'fail');
  log(`[diagnose] ${caseId}/${bundle.bundleId}: ${diags.results.length} results, ${fails.length} failing`);
  const { buildAndSavePackets } = await import('./categories/index.ts');
  await buildAndSavePackets(bundle, diags);
}

main().catch((err) => {
  log(`Error: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
