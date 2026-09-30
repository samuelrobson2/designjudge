import fs from 'node:fs';
import { PRICING_PATH } from '../config.ts';
import type { Usage } from './providers/types.ts';

interface Pricing {
  longContextThreshold: number;
  models: Record<string, { input: number; cachedInput: number; output: number }>;
}

let cached: Pricing | null = null;

function pricing(): Pricing {
  if (!cached) cached = JSON.parse(fs.readFileSync(PRICING_PATH, 'utf8')) as Pricing;
  return cached;
}

// Estimated cost in USD, or null when the model has no price entry.
export function estimateCost(model: string, usage: Usage | null): number | null {
  if (!usage) return null;
  const p = pricing().models[model];
  if (!p) return null;
  const long = usage.inputTokens > pricing().longContextThreshold;
  const inMult = long ? 2 : 1;
  const outMult = long ? 1.5 : 1;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const cost =
    (uncached * p.input * inMult + usage.cachedInputTokens * p.cachedInput * inMult + usage.outputTokens * p.output * outMult) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
