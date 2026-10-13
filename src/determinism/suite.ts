// Determinism suite: the same interface collected on a fast and a slow machine, or alongside other
// collections, must give the same evidence. Collects each target at every CPU throttle in turn,
// then several times in parallel, and compares each collection with the first. The timing fixture
// always runs; with e2e, real cases and the planted breakages that move things after load run too.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';
import { log } from '../util.ts';
import { describeDiff, diffFingerprints, type Fingerprint, type FingerprintDiff } from './fingerprint.ts';

export type Target =
  | { kind: 'fixture' }
  | { kind: 'case'; caseId: string; mutation?: { dir: string; id: string } }
  | { kind: 'stored'; caseId: string; bundleId?: string };

export interface Job {
  label: string;
  target: Target;
  out: string;
  // Evidence folder for collections; stored bundles are read from the default one.
  evidenceDir?: string;
  throttle?: number;
}

export const DEFAULT_RATES = [1, 6, 20];
export const E2E_CASES = [
  'booking-baseline',
  'booking-clean',
  'booking-demoted-cta',
  'carsearch-baseline',
  'carsearch-clean',
  'dashboard-baseline',
  'dashboard-clean',
  'dashboard-gold',
  'dashboard-mobile-overflow',
];
export const E2E_MUTATIONS: { caseId: string; dir: string; id: string }[] = [
  { caseId: 'booking-baseline', dir: 'mutations', id: 'late-promo-banner-shift' },
  { caseId: 'carsearch-baseline', dir: 'mutations', id: 'car-images-late-size-shift' },
  { caseId: 'dashboard-baseline', dir: 'mutations', id: 'chart-late-render-shift' },
  { caseId: 'dashboard-baseline', dir: 'mutations-visual-system', id: 'kpi-values-pulse' },
];

export function targetName(t: Target): string {
  if (t.kind === 'fixture') return 'timing-fixture';
  if (t.kind === 'stored') return `${t.caseId} (stored)`;
  return t.mutation ? `${t.caseId}+${t.mutation.id}` : t.caseId;
}

export function runJob(job: Job): Promise<Fingerprint> {
  const env = { ...process.env };
  delete env.DJ_EVIDENCE_DIR;
  delete env.DJ_CPU_THROTTLE;
  if (job.evidenceDir) env.DJ_EVIDENCE_DIR = job.evidenceDir;
  if (job.throttle && job.throttle !== 1) env.DJ_CPU_THROTTLE = String(job.throttle);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'src/determinism/child.ts'), JSON.stringify(job)], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 && fs.existsSync(job.out)) resolve(JSON.parse(fs.readFileSync(job.out, 'utf8')) as Fingerprint);
      else reject(new Error(`${job.label} exited with ${code}: ${stderr.trim().split('\n').slice(-5).join('\n')}`));
    });
  });
}

export interface TargetResult {
  target: string;
  runs: { label: string; throttle: number; parallel: boolean; collectMs?: number; unsettled: number }[];
  diffs: FingerprintDiff[];
  passed: boolean;
}

export interface SuiteOptions {
  root: string;
  e2e?: boolean;
  rates?: number[];
  parallel?: number;
  cases?: string[];
  // Only these planted breakages (with no cases unless named).
  only?: string[];
}

async function runTarget(target: Target, opts: Required<Pick<SuiteOptions, 'root' | 'rates' | 'parallel'>>): Promise<TargetResult> {
  const name = targetName(target).replace(/[^\w.+-]/g, '_');
  const job = (label: string, throttle: number): Job => ({
    label,
    target,
    throttle,
    evidenceDir: path.join(opts.root, name, label),
    out: path.join(opts.root, name, `${label}.json`),
  });
  const runs: { fp: Fingerprint; throttle: number; parallel: boolean }[] = [];
  for (const rate of opts.rates) {
    log(`[determinism] ${targetName(target)} at ${rate}x CPU throttle`);
    runs.push({ fp: await runJob(job(`${rate}x`, rate)), throttle: rate, parallel: false });
  }
  if (opts.parallel > 1) {
    log(`[determinism] ${targetName(target)}: ${opts.parallel} collections in parallel`);
    const fps = await Promise.all(Array.from({ length: opts.parallel }, (_, i) => runJob(job(`parallel-${i + 1}`, 1))));
    runs.push(...fps.map((fp) => ({ fp, throttle: 1, parallel: true })));
  }
  const [first, ...rest] = runs;
  const diffs = await Promise.all(rest.map((r) => diffFingerprints(first.fp, r.fp)));
  return {
    target: targetName(target),
    runs: runs.map((r) => ({ label: r.fp.label, throttle: r.throttle, parallel: r.parallel, collectMs: r.fp.collectMs, unsettled: r.fp.settle.unsettled })),
    diffs,
    passed: diffs.every((d) => !d.differences.length),
  };
}

export async function runDeterminism(opts: SuiteOptions): Promise<TargetResult[]> {
  const o = { root: opts.root, rates: opts.rates ?? DEFAULT_RATES, parallel: opts.parallel ?? 3 };
  const targets: Target[] = [{ kind: 'fixture' }];
  if (opts.e2e) {
    for (const caseId of opts.cases ?? (opts.only ? [] : E2E_CASES)) targets.push({ kind: 'case', caseId });
    for (const m of E2E_MUTATIONS) {
      if (opts.only ? opts.only.includes(m.id) : !opts.cases) targets.push({ kind: 'case', caseId: m.caseId, mutation: { dir: path.join(ROOT, m.dir), id: m.id } });
    }
  }
  const results: TargetResult[] = [];
  for (const t of targets) {
    const r = await runTarget(t, o);
    results.push(r);
    log(`[determinism] ${r.passed ? 'PASS' : 'FAIL'} ${r.target}`);
    for (const d of r.diffs) log(describeDiff(d));
    for (const run of r.runs) log(`  ${run.label}: ${run.collectMs ? `${(run.collectMs / 1000).toFixed(0)} s` : ''}${run.unsettled ? `, ${run.unsettled} states never went quiet` : ''}`);
  }
  fs.mkdirSync(o.root, { recursive: true });
  fs.writeFileSync(path.join(o.root, 'determinism.json'), JSON.stringify(results, null, 2));
  return results;
}

// Compares the latest bundle of each case in two evidence folders (undefined: the default one), or
// the given bundle IDs, so a change to the collector shows exactly what it changes in the evidence.
export async function compareEvidence(
  a: { dir?: string; bundleIds?: Record<string, string> },
  b: { dir?: string; bundleIds?: Record<string, string> },
  caseIds: string[],
  scratch: string,
  concurrency = 2,
): Promise<FingerprintDiff[]> {
  const job = (side: 'a' | 'b', s: typeof a, caseId: string): Job => ({
    label: `${caseId} ${s.dir ? path.basename(s.dir) : 'stored'}`,
    target: { kind: 'stored', caseId, bundleId: s.bundleIds?.[caseId] },
    evidenceDir: s.dir,
    out: path.join(scratch, 'compare', `${caseId}-${side}.json`),
  });
  const out: FingerprintDiff[] = [];
  const queue = [...caseIds];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const [x, y] = await Promise.all([runJob(job('a', a, c)), runJob(job('b', b, c))]);
        out.push(await diffFingerprints(x, y));
      }
    }),
  );
  return out.sort((x, y) => x.a.localeCompare(y.a));
}
