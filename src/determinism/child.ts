// One collection (or one stored bundle) per process, because the evidence folder and the CPU
// throttle are read from the environment when the collector loads. Writes a fingerprint as JSON.
// Usage: node --import tsx src/determinism/child.ts '<Job as JSON>'

import fs from 'node:fs';
import path from 'node:path';
import { loadCase } from '../cases.ts';
import { buildAndSavePackets } from '../categories/index.ts';
import { collectCase } from '../collect/collect.ts';
import { diagnoseAndSave } from '../diagnostics/run.ts';
import { loadMutations } from '../mutate/run.ts';
import { loadBundle } from '../store.ts';
import { fixtureManifest, serveTimingFixture } from './fixture.ts';
import { fingerprint } from './fingerprint.ts';
import type { Job } from './suite.ts';

const job = JSON.parse(process.argv[2]) as Job;

async function run() {
  if (job.target.kind === 'stored') {
    const bundle = loadBundle(job.target.caseId, job.target.bundleId);
    // Bundles in a scratch folder may gain the packet images they lack; stored ones never do.
    return fingerprint(bundle, { label: job.label, drawImages: !!job.evidenceDir });
  }
  const started = Date.now();
  if (job.target.kind === 'fixture') {
    const server = await serveTimingFixture();
    try {
      const bundle = await collectCase(fixtureManifest(server.url), { functional: true });
      await buildAndSavePackets(bundle, diagnoseAndSave(bundle));
      const collectMs = Date.now() - started;
      return { ...(await fingerprint(bundle, { label: job.label, drawImages: true, replace: [[server.origin, '<origin>']] })), collectMs };
    } finally {
      await server.close();
    }
  }
  const { caseId, mutation } = job.target;
  const m = mutation ? loadMutations([caseId], mutation.dir).find((x) => x.id === mutation.id) : null;
  if (mutation && !m) throw new Error(`No mutation ${mutation.id} for ${caseId} in ${mutation.dir}`);
  const evidenceId = m ? `${caseId}--${m.id}` : caseId;
  const bundle = await collectCase(loadCase(caseId), { evidenceId, functional: true, inject: m ? { css: m.css ?? null, js: m.js ?? null } : undefined });
  await buildAndSavePackets(bundle, diagnoseAndSave(bundle));
  const collectMs = Date.now() - started;
  return { ...(await fingerprint(bundle, { label: job.label, drawImages: true })), collectMs };
}

const fp = await run();
fs.mkdirSync(path.dirname(job.out), { recursive: true });
fs.writeFileSync(job.out, JSON.stringify(fp, null, 2));
