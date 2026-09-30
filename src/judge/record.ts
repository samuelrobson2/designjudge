import type { LayoutJudgment } from '../categories/layout/schema.ts';
import type { Usage } from './providers/types.ts';
import type { Validation } from './validate.ts';

export interface JudgmentRecord {
  schemaVersion: 1;
  runId: string;
  category: string;
  caseId: string;
  bundleId: string;
  interfaceId: string;
  repeat: number;
  provider: string;
  model: string;
  modelReported: string | null;
  effort: string;
  promptVersion: string;
  promptHash: string;
  rubricHash: string;
  packetHash: string;
  startedAt: string;
  latencyMs: number;
  providerStatus: 'ok' | 'error' | 'incomplete' | 'refusal';
  status: 'ok' | 'invalid_output' | 'provider_error';
  error?: string;
  notes: string[];
  usage: Usage | null;
  costUsd: number | null;
  output: LayoutJudgment | null;
  outputText: string | null;
  // Summary of the model's reasoning (null for providers or models that return none).
  reasoningSummary: string | null;
  validation: Validation | null;
  rawResponse: unknown;
}

export interface RunRecord {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  finishedAt?: string;
  category: string;
  provider: string;
  model: string;
  effort: string;
  repeats: number;
  promptVersion: string;
  promptHash: string;
  rubricHash: string;
  label?: string;
  replayOf?: string;
  mockMode?: string;
  cases: { caseId: string; bundleId: string; interfaceId: string; packetHash: string; requestFile: string }[];
  totals?: { calls: number; ok: number; invalid: number; errors: number; costUsd: number; inputTokens: number; outputTokens: number; latencyMsMean: number };
}
