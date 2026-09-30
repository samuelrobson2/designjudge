import type { JudgeRequest } from '../../categories/layout/prompt.ts';
import type { Packet } from '../../categories/types.ts';

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface ProviderResult {
  status: 'ok' | 'error' | 'incomplete' | 'refusal';
  outputText: string | null;
  // Summary of the model's reasoning, when the provider returns one.
  reasoningSummary?: string | null;
  usage: Usage | null;
  latencyMs: number;
  modelReported: string | null;
  rawRequest: unknown;
  rawResponse: unknown;
  error?: string;
  notes: string[];
}

export interface CallOptions {
  model: string;
  effort: string;
  caseId: string;
  repeat: number;
  packet: Packet;
}

export interface Provider {
  name: string;
  call(req: JudgeRequest, opts: CallOptions): Promise<ProviderResult>;
}
