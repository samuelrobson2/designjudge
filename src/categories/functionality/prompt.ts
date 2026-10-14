import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../util.ts';
import type { Packet } from '../types.ts';
import { promptConfig, promptDir, type JudgeImage, type JudgeRequest } from '../layout/prompt.ts';
import { FINDINGS_RENDER_VERSION, renderSystem, renderUserParts } from '../layout/render.ts';
import { layoutOutputJsonSchema } from '../layout/schema.ts';
import { FUNCTIONALITY_CRITERIA, functionalityCategory } from './definition.ts';
import { FUNCTIONALITY_PACKET_VERSION, parseFunctionalityRubric } from './packet.ts';
import { readRubric, readsAddedChecks } from '../versions.ts';

// Criteria with no automated checks, and whether measurements are rendered: before the added
// checks, C had none and Functionality had no measurements at all. After them, measurements are
// rendered and the criteria without any say so.
const UNCHECKED = ['C'];

export function buildFunctionalityRequest(packet: Packet, bundleDirAbs: string, promptVersion = 'v1'): JudgeRequest {
  const added = readsAddedChecks('functionality', promptVersion);
  const expected = FUNCTIONALITY_PACKET_VERSION + (added ? '+added-checks' : '');
  if (packet.packetVersion !== expected) {
    throw new Error(`Functionality prompt ${promptVersion} needs ${expected} but the packet is ${packet.packetVersion}`);
  }
  const unchecked = added ? [] : UNCHECKED;
  const dir = promptDir(promptVersion, 'functionality');
  const config = promptConfig(promptVersion, 'functionality');
  const systemTpl = fs.readFileSync(path.join(dir, 'system.md'), 'utf8');
  const userTpl = fs.readFileSync(path.join(dir, 'user.md'), 'utf8');
  const rubricRaw = readRubric(functionalityCategory.rubricPath, added).trim();
  const parsed = parseFunctionalityRubric(rubricRaw);
  const schema = layoutOutputJsonSchema(FUNCTIONALITY_CRITERIA, {
    describe: config.schemaDescriptions,
    decisive: config.decisiveFindings,
    materiality: config.materiality,
    category: 'Functionality',
  });
  const instructions = renderSystem(systemTpl, parsed);
  const unmeasured = parsed.criteria.filter((c) => !c.diagIds.some((id) => parsed.diagnostics.find((d) => d.diagId === id)?.kind === 'observation')).map((c) => c.id);
  const { parts: userParts, text: userText } = renderUserParts(userTpl, packet, parsed, {
    measurementBlocks: config.measurementBlocks,
    checksOnly: !added,
    uncheckedCriteria: unchecked,
    ...(added ? { unmeasuredCriteria: unmeasured } : {}),
  });

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
    category: 'functionality',
    promptVersion,
    promptHash: sha256(systemTpl + '\n---\n' + userTpl + '\n---\n' + JSON.stringify(schema) + FINDINGS_RENDER_VERSION + (added ? `+unmeasured:${unmeasured.join(',')}` : '+checks-only' + `+unchecked:${unchecked.join(',')}`)).slice(0, 16),
    rubricHash: sha256(rubricRaw).slice(0, 16),
    packetHash: packetHash.slice(0, 16),
    instructions,
    userText,
    userParts,
    evidence: packet.evidence,
    images,
    schemaName: 'functionality_judgment',
    schema,
  };
}
