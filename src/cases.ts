import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { CASES_DIR, FIXTURES } from './config.ts';
import type { CaseManifest } from './types.ts';

const stepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('click'), selector: z.string() }),
  z.object({ action: z.literal('fill'), selector: z.string(), value: z.string() }),
  z.object({ action: z.literal('select'), selector: z.string(), value: z.string() }),
  z.object({ action: z.literal('check'), selector: z.string() }),
  z.object({ action: z.literal('uncheck'), selector: z.string() }),
  z.object({ action: z.literal('press'), key: z.string(), selector: z.string().optional() }),
  z.object({ action: z.literal('hover'), selector: z.string() }),
  z.object({ action: z.literal('focus'), selector: z.string() }),
  z.object({ action: z.literal('scrollTo'), selector: z.string() }),
  z.object({ action: z.literal('wait'), ms: z.number().int().nonnegative() }),
  z.object({ action: z.literal('waitFor'), selector: z.string() }),
]);

export const manifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  request: z.string().min(1),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('static'), dir: z.string() }),
    z.object({ type: z.literal('url'), url: z.string().url() }),
  ]),
  entry: z.string().optional(),
  fixtures: z.object({ supported: z.array(z.enum(FIXTURES)) }).optional(),
  interactiveStates: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        description: z.string(),
        viewports: z.array(z.enum(['desktop', 'mobile'])).min(1),
        steps: z.array(stepSchema).min(1),
        stepsByViewport: z.object({ desktop: z.array(stepSchema).min(1).optional(), mobile: z.array(stepSchema).min(1).optional() }).optional(),
        capture: z.object({ scrollTo: z.string().optional() }).optional(),
      }),
    )
    .optional(),
  rtlRequired: z.boolean().optional(),
});

export function caseDir(caseId: string): string {
  return path.join(CASES_DIR, caseId);
}

export function loadCase(caseId: string): CaseManifest {
  const file = path.join(caseDir(caseId), 'case.json');
  if (!fs.existsSync(file)) throw new Error(`No case manifest at ${file}`);
  const parsed = manifestSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (parsed.id !== caseId) throw new Error(`Case id "${parsed.id}" does not match folder "${caseId}"`);
  return parsed as CaseManifest;
}

export function listCases(): string[] {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs
    .readdirSync(CASES_DIR)
    .filter((d) => fs.existsSync(path.join(CASES_DIR, d, 'case.json')))
    .sort();
}
