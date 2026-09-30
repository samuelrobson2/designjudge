import fs from 'node:fs';
import path from 'node:path';
import { EVIDENCE_DIR, RUNS_DIR } from './config.ts';
import type { Bundle, Diagnostics, Snapshot, StateRecord } from './types.ts';
import { readJson } from './util.ts';

export function bundleDir(caseId: string, bundleId: string): string {
  return path.join(EVIDENCE_DIR, caseId, bundleId);
}

export function latestBundleId(caseId: string): string | null {
  const file = path.join(EVIDENCE_DIR, caseId, 'latest.json');
  if (!fs.existsSync(file)) return null;
  return readJson<{ bundleId: string }>(file).bundleId;
}

export function listBundles(caseId: string): string[] {
  const dir = path.join(EVIDENCE_DIR, caseId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, 'bundle.json')))
    .sort()
    .reverse();
}

export function loadBundle(caseId: string, bundleId?: string): Bundle {
  const id = bundleId ?? latestBundleId(caseId);
  if (!id) throw new Error(`No evidence collected for case "${caseId}". Run: npm run collect -- ${caseId}`);
  return readJson<Bundle>(path.join(bundleDir(caseId, id), 'bundle.json'));
}

export function loadSnapshot(bundle: Bundle, state: StateRecord): Snapshot | null {
  if (!state.files.snapshot) return null;
  return readJson<Snapshot>(path.join(bundleDir(bundle.caseId, bundle.bundleId), state.files.snapshot));
}

export function diagnosticsPath(bundle: Bundle): string {
  return path.join(bundleDir(bundle.caseId, bundle.bundleId), 'diagnostics.json');
}

export function loadDiagnostics(bundle: Bundle): Diagnostics | null {
  const file = diagnosticsPath(bundle);
  return fs.existsSync(file) ? readJson<Diagnostics>(file) : null;
}

export function packetPath(bundle: Bundle, category: string, promptVersion: string): string {
  return path.join(bundleDir(bundle.caseId, bundle.bundleId), `packet.${category}.${promptVersion}.json`);
}

export function runDir(runId: string): string {
  return path.join(RUNS_DIR, runId);
}

export function listRuns(): string[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .filter((d) => fs.existsSync(path.join(RUNS_DIR, d, 'run.json')))
    .sort()
    .reverse();
}
