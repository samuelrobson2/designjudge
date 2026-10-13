import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../util.ts';
import type { CriterionDef, Packet } from '../types.ts';
import { promptConfig, promptDir, type JudgeImage, type JudgeRequest } from '../layout/prompt.ts';
import { renderFindingsStates, renderSystem, type UserPart } from '../layout/render.ts';
import { parseRubric, type ParsedRubric } from '../layout/rubric.ts';
import { layoutOutputJsonSchema } from '../layout/schema.ts';
import type { NoChecksCriterion, NoChecksEvidence } from './packet.ts';

// Bump when rendering changes, so the prompt hash changes with it.
export const NO_CHECKS_RENDER_VERSION = 'no-checks-render-v1';

export interface NoChecksPrompt {
  category: string;
  // The category's name as its rubric headings use it.
  title: string;
  packetVersion: string;
  rubricPath: string;
  criteria: CriterionDef[];
  // The evidence IDs a finding can cite, as the schema describes them.
  evidenceIds: string;
  // Placeholders the category's user template adds, filled from the packet.
  sections?: (packet: Packet) => Record<string, string>;
  // Changes to how `sections` render, for the prompt hash.
  sectionsVersion?: string;
}

export function renderNoChecksCriterion(c: NoChecksCriterion, rubric: ParsedRubric): string {
  const def = rubric.criteria.find((x) => x.id === c.criterion)!;
  return [
    `<criterion id="${c.criterion}" name="${c.name}">`,
    '<rubric_criterion>',
    `Criterion ${c.criterion} — ${c.name}: ${def.statement}`,
    '',
    'Evaluation points (assess every one that applies):',
    ...def.points.map((p) => `- ${p.name}: ${p.definition}`),
    ...(def.reference ? ['', `Reference: ${def.reference}`] : []),
    ...(def.useFor ? ['', `Use this criterion for: ${def.useFor}`] : []),
    '</rubric_criterion>',
    '</criterion>',
  ].join('\n');
}

export function renderNoChecksUser(template: string, packet: Packet, rubric: ParsedRubric, sections: Record<string, string> = {}): { parts: UserPart[]; text: string } {
  const ev = packet.evidence as unknown as NoChecksEvidence;
  const values: Record<string, string> = {
    INTERFACE_ID: packet.interfaceId,
    REQUEST: packet.request,
    STATES: renderFindingsStates(ev.states),
    CRITERIA: ev.criteria.map((c) => renderNoChecksCriterion(c, rubric)).join('\n\n'),
    NOTES: ev.selection_notes.length ? `\n<notes>\n${ev.selection_notes.map((n) => `- ${n}`).join('\n')}\n</notes>\n` : '',
    ...sections,
  };
  // Split first and fill each half in one pass, so text from the interface is never read as a placeholder.
  const halves = template.split('{{SCREENSHOTS}}');
  if (halves.length !== 2) throw new Error('Prompt user template must contain {{SCREENSHOTS}} once');
  const fill = (s: string) => s.replace(/\{\{([A-Z_]+)\}\}/g, (m, key: string) => values[key] ?? m);

  const parts: UserPart[] = [{ type: 'text', text: fill(halves[0]).trimEnd() }];
  for (const s of ev.screenshots) {
    parts.push({ type: 'text', text: `Screenshot ${s.id}: ${s.shows}` });
    parts.push({ type: 'image', id: s.id });
  }
  parts.push({ type: 'text', text: fill(halves[1]).trimStart() });
  const text = parts.map((p) => (p.type === 'text' ? p.text : `[image ${p.id}]`)).join('\n\n');
  return { parts, text };
}

export function buildNoChecksRequest(spec: NoChecksPrompt, packet: Packet, bundleDirAbs: string, promptVersion: string): JudgeRequest {
  if (packet.packetVersion !== spec.packetVersion) {
    throw new Error(`${spec.title} prompt ${promptVersion} needs ${spec.packetVersion} but the packet is ${packet.packetVersion}`);
  }
  const dir = promptDir(promptVersion, spec.category);
  const config = promptConfig(promptVersion, spec.category);
  const systemTpl = fs.readFileSync(path.join(dir, 'system.md'), 'utf8');
  const userTpl = fs.readFileSync(path.join(dir, 'user.md'), 'utf8');
  const rubricRaw = fs.readFileSync(config.rubricFile ? path.join(dir, config.rubricFile) : spec.rubricPath, 'utf8').trim();
  const parsed = parseRubric(rubricRaw, spec.title, path.basename(spec.rubricPath));
  const schema = layoutOutputJsonSchema(spec.criteria, {
    describe: config.schemaDescriptions,
    decisive: config.decisiveFindings,
    materiality: config.materiality,
    category: spec.title,
    evidenceIds: spec.evidenceIds,
  });
  const instructions = renderSystem(systemTpl, parsed);
  const { parts: userParts, text: userText } = renderNoChecksUser(userTpl, packet, parsed, spec.sections?.(packet));

  const images: JudgeImage[] = packet.images.map((img) => {
    const abs = path.join(bundleDirAbs, img.path);
    return {
      id: img.id,
      stateId: img.stateId,
      kind: img.kind,
      caption: img.caption,
      detail: img.detail,
      path: abs,
      sha256: sha256(fs.readFileSync(abs)),
      width: img.width,
      height: img.height,
      scale: img.scale,
      scrollY: img.scrollY,
      estimatedTokens: img.estimatedTokens,
    };
  });
  const packetHash = sha256(JSON.stringify({ evidence: packet.evidence, images: images.map((i) => [i.id, i.sha256, i.detail]) }));
  return {
    category: spec.category,
    promptVersion,
    promptHash: sha256(systemTpl + '\n---\n' + userTpl + '\n---\n' + JSON.stringify(schema) + NO_CHECKS_RENDER_VERSION + (spec.sectionsVersion ?? '')).slice(0, 16),
    rubricHash: sha256(rubricRaw).slice(0, 16),
    packetHash: packetHash.slice(0, 16),
    instructions,
    userText,
    userParts,
    evidence: packet.evidence,
    images,
    schemaName: `${spec.category}_judgment`,
    schema,
  };
}
