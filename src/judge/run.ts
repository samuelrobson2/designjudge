import path from 'node:path';
import { EVIDENCE_DIR } from '../config.ts';
import { loadOrBuildPacket } from '../categories/index.ts';
import { ensureMarkedScreenshots } from '../categories/layout/marks.ts';
import { buildLayoutRequest, type JudgeRequest } from '../categories/layout/prompt.ts';
import type { Packet } from '../categories/types.ts';
import { bundleDir, loadBundle, runDir } from '../store.ts';
import { log, mapLimit, timestampId, writeJson } from '../util.ts';
import { estimateCost } from './pricing.ts';
import { mockProvider } from './providers/mock.ts';
import { openaiProvider } from './providers/openai.ts';
import { replayProvider } from './providers/replay.ts';
import type { Provider } from './providers/types.ts';
import type { JudgmentRecord, RunRecord } from './record.ts';
import { parseOutput, validateJudgment } from './validate.ts';

export interface JudgeOptions {
  caseIds: string[];
  provider: 'openai' | 'mock' | 'replay';
  model: string;
  repeats: number;
  effort: string;
  concurrency: number;
  promptVersion: string;
  replayRun?: string;
  mockMode?: 'ok' | 'invalid_json' | 'unknown_refs';
  label?: string;
}

function providerFor(opts: JudgeOptions): Provider {
  if (opts.provider === 'mock') return mockProvider(opts.mockMode ?? 'ok');
  if (opts.provider === 'replay') {
    if (!opts.replayRun) throw new Error('--replay-run <runId> is required with --provider replay');
    return replayProvider(opts.replayRun);
  }
  return openaiProvider;
}

export async function runJudge(opts: JudgeOptions): Promise<string> {
  const provider = providerFor(opts);
  const model = opts.provider === 'mock' ? `mock-${opts.mockMode ?? 'ok'}` : opts.model;
  if (opts.provider === 'openai' && !process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Add OPENAI_API_KEY=... to .env in the project root, or use --provider mock.');
  }
  const runId = `${timestampId()}-${opts.provider}-${model}-${opts.promptVersion}`.replace(/[^A-Za-z0-9._-]/g, '_');
  const dir = runDir(runId);

  const prepared: { caseId: string; packet: Packet; req: JudgeRequest; bundleId: string; interfaceId: string }[] = [];
  for (const caseId of opts.caseIds) {
    const bundle = loadBundle(caseId);
    const packet = loadOrBuildPacket(bundle, opts.promptVersion);
    await ensureMarkedScreenshots(packet, bundleDir(caseId, bundle.bundleId));
    const req = buildLayoutRequest(packet, bundleDir(caseId, bundle.bundleId), opts.promptVersion);
    prepared.push({ caseId, packet, req, bundleId: bundle.bundleId, interfaceId: bundle.interfaceId });
    // Exactly what the judge receives (images referenced by path and hash).
    writeJson(path.join(dir, 'requests', `${caseId}.json`), {
      caseId,
      bundleId: bundle.bundleId,
      packetVersion: packet.packetVersion,
      packetHash: req.packetHash,
      promptVersion: req.promptVersion,
      promptHash: req.promptHash,
      rubricHash: req.rubricHash,
      instructions: req.instructions,
      userText: req.userText,
      userParts: req.userParts,
      evidence: req.evidence,
      images: req.images.map((i) => ({ ...i, path: path.relative(EVIDENCE_DIR, i.path) })),
      schemaName: req.schemaName,
      schema: req.schema,
      evidenceIndex: packet.index,
    });
  }

  const run: RunRecord = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    category: 'layout',
    provider: opts.provider,
    model,
    effort: opts.effort,
    repeats: opts.repeats,
    promptVersion: opts.promptVersion,
    promptHash: prepared[0]?.req.promptHash ?? '',
    rubricHash: prepared[0]?.req.rubricHash ?? '',
    label: opts.label,
    replayOf: opts.replayRun,
    mockMode: opts.provider === 'mock' ? opts.mockMode ?? 'ok' : undefined,
    cases: prepared.map((p) => ({
      caseId: p.caseId,
      bundleId: p.bundleId,
      interfaceId: p.interfaceId,
      packetHash: p.req.packetHash,
      requestFile: `requests/${p.caseId}.json`,
    })),
  };
  writeJson(path.join(dir, 'run.json'), run);

  const jobs = prepared.flatMap((p) => Array.from({ length: opts.repeats }, (_, i) => ({ ...p, repeat: i + 1 })));
  const approxTokens = prepared.reduce((s, p) => s + p.req.images.reduce((a, i) => a + i.estimatedTokens, 0) + (p.req.instructions.length + p.req.userText.length) / 4, 0);
  log(`[judge] run ${runId}: ${jobs.length} calls (${prepared.length} cases × ${opts.repeats}), ~${Math.round(approxTokens / Math.max(1, prepared.length) / 1000)}k input tokens per call, provider ${provider.name}, model ${model}`);

  const records = await mapLimit(jobs, opts.concurrency, async (job) => {
    const startedAt = new Date().toISOString();
    const res = await provider.call(job.req, { model: opts.model, effort: opts.effort, caseId: job.caseId, repeat: job.repeat, packet: job.packet });
    let status: JudgmentRecord['status'] = 'provider_error';
    let output: JudgmentRecord['output'] = null;
    let validation: JudgmentRecord['validation'] = null;
    let error = res.error;
    if (res.status === 'ok' || (res.status === 'incomplete' && res.outputText)) {
      const parsed = parseOutput(res.outputText);
      if (parsed.error) {
        status = 'invalid_output';
        error = parsed.error;
      } else {
        const v = validateJudgment(parsed.value, job.packet);
        output = v.output;
        validation = v.validation;
        status = v.validation.schemaValid ? 'ok' : 'invalid_output';
        if (!v.validation.schemaValid) error = `Schema validation failed: ${v.validation.schemaErrors.slice(0, 3).join('; ')}`;
      }
    }
    const rec: JudgmentRecord = {
      schemaVersion: 1,
      runId,
      category: 'layout',
      caseId: job.caseId,
      bundleId: job.bundleId,
      interfaceId: job.interfaceId,
      repeat: job.repeat,
      provider: provider.name,
      model,
      modelReported: res.modelReported,
      effort: opts.effort,
      promptVersion: job.req.promptVersion,
      promptHash: job.req.promptHash,
      rubricHash: job.req.rubricHash,
      packetHash: job.req.packetHash,
      startedAt,
      latencyMs: res.latencyMs,
      providerStatus: res.status,
      status,
      error,
      notes: res.notes,
      usage: res.usage,
      costUsd: opts.provider === 'openai' ? estimateCost(opts.model, res.usage) : 0,
      output,
      outputText: res.outputText,
      reasoningSummary: res.reasoningSummary ?? null,
      validation,
      rawResponse: res.rawResponse,
    };
    writeJson(path.join(dir, 'judgments', job.caseId, `r${job.repeat}.json`), rec);
    if (res.rawRequest) writeJson(path.join(dir, 'raw-requests', job.caseId, `r${job.repeat}.json`), res.rawRequest);
    const score = output?.overall.score ?? '—';
    log(`  ${status === 'ok' ? '✓' : '✗'} ${job.caseId} r${job.repeat}: score ${score}${error ? ` (${error.slice(0, 120)})` : ''} ${res.latencyMs} ms${rec.costUsd ? ` $${rec.costUsd.toFixed(4)}` : ''}`);
    return rec;
  });

  run.finishedAt = new Date().toISOString();
  run.totals = {
    calls: records.length,
    ok: records.filter((r) => r.status === 'ok').length,
    invalid: records.filter((r) => r.status === 'invalid_output').length,
    errors: records.filter((r) => r.status === 'provider_error').length,
    costUsd: Math.round(records.reduce((s, r) => s + (r.costUsd ?? 0), 0) * 10000) / 10000,
    inputTokens: records.reduce((s, r) => s + (r.usage?.inputTokens ?? 0), 0),
    outputTokens: records.reduce((s, r) => s + (r.usage?.outputTokens ?? 0), 0),
    latencyMsMean: Math.round(records.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, records.length)),
  };
  writeJson(path.join(dir, 'run.json'), run);
  return runId;
}
