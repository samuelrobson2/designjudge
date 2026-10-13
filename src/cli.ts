import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { EVIDENCE_DIR_OVERRIDDEN, ROOT } from './config.ts';
import { listCases, loadCase } from './cases.ts';
import { collectCase } from './collect/collect.ts';
import { diagnoseAndSave } from './diagnostics/run.ts';
import { latestBundleId, loadBundle } from './store.ts';
import { log } from './util.ts';

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const HELP = `designjudge — Layout judge and evaluation harness

Usage:
  npm run collect  -- [caseId ...] [--functional]  Collect evidence (all cases if none given), then run diagnostics and build judge packets
      --functional                    also run the Functionality probe (uses every control, link and form), which judging Functionality needs
  npm run diagnose -- [caseId ...]            Recompute diagnostics and packets from saved evidence (no browser)
  npm run probe    -- [caseId ...] [--functional]  Add the Visual System probes (and with --functional the Functionality probe) to the latest evidence (no recollection), then rerun diagnostics and packets
  npm run judge    -- [caseId ...] [options]  Run the judge on the latest evidence
      --category layout|typography|task_fit|content_quality|visual_system|functionality  (default layout)
      --provider openai|mock|replay   (default openai)
      --model <id>                    (default gpt-6-sol)
      --repeats <n>                   (default 5)
      --effort <none|low|medium|high|xhigh|max>  reasoning effort (default medium)
      --concurrency <n>               (default 3)
      --prompt <version>              prompt version of the category (default: its latest)
      --replay-run <runId>            source run for --provider replay
      --mock-mode ok|invalid_json|unknown_refs  (default ok)
      --label <text>                  free-text label stored with the run
  npm run visual   -- [caseId ...]            Add Visual System screenshots to the latest evidence: each kind of control in each state, plus colour-blind and greyscale views
  npm run mutate   -- [caseId ...] [--only id,id] [--concurrency n] [--dir <folder>] [--rescore <runId>]  Planted-defect testing: collect each breakage in mutations/ and compare its check results, and the evidence each category's judge would receive, with a clean control
      --functional                    run the Functionality probe (on by itself for --dir mutations-functionality)
      --judge                         also judge the control and each variant for real, in the folder's category (or --category), and check
                                      each variant against its control: harmless-* the same, anything else lower. With --rescore, judges that run's evidence
      --repeats <n>                   judgments per variant (default 3); --base-repeats <n> per control (default 5)
      --provider, --model, --effort, --prompt, --mock-mode   as for judge
  npm run report   -- [caseId ...] [--prompt <version>]  Write summary.csv and checks.csv for the latest evidence (no judge run) to artifacts/reports/latest
  npm run compare  -- <runId> [runId ...]     Summarise runs (stability, pair deltas, validity, cost) and write summary.csv, checks.csv and findings.csv
  npm run view     -- [--port 4600]           Open the web viewer
  npm run publish  -- [--build-only]          Build the hosted rating site from the latest evidence and deploy it to Vercel
  npm run human-csvs                          Rewrite benchmark/human/*.csv (Layout) and benchmark/human/<category>/*.csv from the rating files (e.g. after git pull brings in hosted ratings)
  npm run determinism -- [caseId ...] [--e2e] [--rates 1,6,20] [--parallel 3] [--only id,id] [--dir <folder>]  Collect the timing test page (and with --e2e, real cases and
                                      the breakages that move things after load) at each CPU throttle and in parallel into a scratch folder, and report any
                                      difference in the states, check results or judge evidence; named cases, or --only breakages, imply --e2e
      --compare <folder> [caseId ...]  instead compare the latest evidence in <folder> (collected with DJ_EVIDENCE_DIR=<folder>) with the stored evidence
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
      category: { type: 'string' },
      provider: { type: 'string', default: 'openai' },
      model: { type: 'string', default: 'gpt-6-sol' },
      repeats: { type: 'string' },
      'base-repeats': { type: 'string', default: '5' },
      judge: { type: 'boolean', default: false },
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
      functional: { type: 'boolean', default: false },
      e2e: { type: 'boolean', default: false },
      rates: { type: 'string' },
      parallel: { type: 'string' },
      compare: { type: 'string' },
    },
  });

  switch (command) {
    case 'collect': {
      for (const id of await resolveCases(positionals)) {
        const bundle = await collectCase(loadCase(id), { functional: values.functional });
        await postCollect(id, bundle.bundleId);
      }
      await refreshReport();
      break;
    }
    case 'visual': {
      const { collectVisualForCase } = await import('./collect/visual.ts');
      for (const id of await resolveCases(positionals)) await collectVisualForCase(id);
      break;
    }
    case 'probe': {
      const { probeCase } = await import('./collect/probes.ts');
      for (const id of await resolveCases(positionals)) {
        await probeCase(id, { functional: values.functional });
        await postCollect(id);
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
      const category = values.category ?? 'layout';
      const runId = await runJudge({
        caseIds: await resolveCases(positionals),
        category,
        provider: values.provider as 'openai' | 'mock' | 'replay',
        model: values.model!,
        repeats: parseInt(values.repeats ?? '5', 10),
        effort: values.effort!,
        concurrency: parseInt(values.concurrency!, 10),
        promptVersion: values.prompt ?? listPromptVersions(category).at(-1)!,
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
      const { runMutations, rescoreRun, loadMutations, MUTATIONS_DIR } = await import('./mutate/run.ts');
      const { categoryForDir } = await import('./mutate/judge.ts');
      const only = values.only ? values.only.split(',') : undefined;
      let runId = values.rescore;
      if (runId) rescoreRun(runId, { dir: values.dir });
      else runId = path.basename(await runMutations({ caseIds: positionals, only, concurrency: parseInt(values.concurrency!, 10), dir: values.dir, functional: values.functional || categoryForDir(values.dir) === 'functionality' }));
      if (values.judge) {
        const { judgeMutationRun } = await import('./mutate/judge.ts');
        await judgeMutationRun({
          runId,
          mutations: loadMutations(undefined, values.dir ? path.resolve(values.dir) : MUTATIONS_DIR),
          category: values.category ?? categoryForDir(values.dir),
          promptVersion: values.prompt,
          provider: values.provider as 'openai' | 'mock',
          model: values.model!,
          effort: values.effort!,
          concurrency: parseInt(values.concurrency!, 10),
          mockMode: values['mock-mode'] as 'ok' | 'invalid_json' | 'unknown_refs',
          repeats: parseInt(values.repeats ?? '3', 10),
          baseRepeats: parseInt(values['base-repeats']!, 10),
          only,
        });
      }
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
      const { CATEGORIES } = await import('./categories/index.ts');
      writeHumanCsvs();
      const counts = Object.values(CATEGORIES).map((c) => `${c.name} ${listRatings(undefined, c.id).length}`);
      log(`ratings.csv, findings.csv and points.csv written to ${path.relative(process.cwd(), HUMAN_DIR)} for Layout and to its subfolder for each other category with ratings (${counts.join(', ')})`);
      break;
    }
    case 'determinism': {
      const { compareEvidence, runDeterminism } = await import('./determinism/suite.ts');
      const { describeDiff } = await import('./determinism/fingerprint.ts');
      const os = await import('node:os');
      const root = path.resolve(values.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'dj-determinism-')));
      if (values.compare) {
        const diffs = await compareEvidence({}, { dir: path.resolve(values.compare) }, await resolveCases(positionals), root);
        for (const d of diffs) log(describeDiff(d, 20));
        log(`[determinism] ${diffs.filter((d) => !d.differences.length).length}/${diffs.length} cases identical`);
        break;
      }
      const results = await runDeterminism({
        root,
        e2e: values.e2e || positionals.length > 0 || !!values.only,
        only: values.only?.split(','),
        rates: values.rates?.split(',').map(Number),
        parallel: values.parallel ? parseInt(values.parallel, 10) : undefined,
        cases: positionals.length ? await resolveCases(positionals) : undefined,
      });
      log(`[determinism] ${results.filter((r) => r.passed).length}/${results.length} passed; evidence in ${root}`);
      if (results.some((r) => !r.passed)) process.exitCode = 1;
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
  if (EVIDENCE_DIR_OVERRIDDEN) {
    log('[report] not refreshed: DJ_EVIDENCE_DIR points at another evidence folder');
    return;
  }
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
