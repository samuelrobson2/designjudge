import fs from 'node:fs';
import path from 'node:path';
import { runDir } from '../../store.ts';
import { readJson } from '../../util.ts';
import type { JudgmentRecord } from '../record.ts';
import type { Provider, ProviderResult } from './types.ts';

// Replays raw responses from an earlier run so parsing and validation changes can be tested
// without new model calls.
export function replayProvider(sourceRunId: string): Provider {
  return {
    name: 'replay',
    async call(_req, opts): Promise<ProviderResult> {
      const file = path.join(runDir(sourceRunId), 'judgments', opts.caseId, `r${opts.repeat}.json`);
      if (!fs.existsSync(file)) {
        return {
          status: 'error',
          outputText: null,
          usage: null,
          latencyMs: 0,
          modelReported: null,
          rawRequest: null,
          rawResponse: null,
          error: `No judgment to replay at ${file}`,
          notes: [],
        };
      }
      const rec = readJson<JudgmentRecord>(file);
      return {
        status: rec.providerStatus,
        outputText: rec.outputText,
        usage: rec.usage,
        latencyMs: rec.latencyMs,
        modelReported: rec.modelReported,
        rawRequest: { replayOf: `${sourceRunId}/${opts.caseId}/r${opts.repeat}` },
        rawResponse: rec.rawResponse,
        error: rec.error,
        notes: [`Replayed from run ${sourceRunId}`],
      };
    },
  };
}
