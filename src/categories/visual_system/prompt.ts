import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../util.ts';
import type { Packet } from '../types.ts';
import { promptConfig, promptDir, type JudgeImage, type JudgeRequest } from '../layout/prompt.ts';
import { FINDINGS_RENDER_VERSION, renderSystem, renderUserParts } from '../layout/render.ts';
import { layoutOutputJsonSchema } from '../layout/schema.ts';
import { VISUAL_SYSTEM_CRITERIA, visualSystemCategory } from './definition.ts';
import { parseVisualSystemRubric, VISUAL_SYSTEM_PACKET_VERSION } from './packet.ts';
import { readRubric, readsAddedChecks } from '../versions.ts';

// Criteria whose evidence has measurements but no automated checks.
const UNCHECKED = ['B'];

export function buildVisualSystemRequest(packet: Packet, bundleDirAbs: string, promptVersion = 'v1'): JudgeRequest {
  const added = readsAddedChecks('visual_system', promptVersion);
  const expected = VISUAL_SYSTEM_PACKET_VERSION + (added ? '+added-checks' : '');
  if (packet.packetVersion !== expected) {
    throw new Error(`Visual System prompt ${promptVersion} needs ${expected} but the packet is ${packet.packetVersion}`);
  }
  const dir = promptDir(promptVersion, 'visual_system');
  const config = promptConfig(promptVersion, 'visual_system');
  const systemTpl = fs.readFileSync(path.join(dir, 'system.md'), 'utf8');
  const userTpl = fs.readFileSync(path.join(dir, 'user.md'), 'utf8');
  const rubricRaw = readRubric(visualSystemCategory.rubricPath, added).trim();
  const parsed = parseVisualSystemRubric(rubricRaw);
  const schema = layoutOutputJsonSchema(VISUAL_SYSTEM_CRITERIA, {
    describe: config.schemaDescriptions,
    decisive: config.decisiveFindings,
    materiality: config.materiality,
    category: 'Visual System',
  });
  const instructions = renderSystem(systemTpl, parsed);
  const { parts: userParts, text: userText } = renderUserParts(userTpl, packet, parsed, { measurementBlocks: config.measurementBlocks, uncheckedCriteria: UNCHECKED });

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
    category: 'visual_system',
    promptVersion,
    promptHash: sha256(systemTpl + '\n---\n' + userTpl + '\n---\n' + JSON.stringify(schema) + FINDINGS_RENDER_VERSION + (config.measurementBlocks ? '+measurement-blocks' : '') + `+unchecked:${UNCHECKED.join(',')}`).slice(0, 16),
    rubricHash: sha256(rubricRaw).slice(0, 16),
    packetHash: packetHash.slice(0, 16),
    instructions,
    userText,
    userParts,
    evidence: packet.evidence,
    images,
    schemaName: 'visual_system_judgment',
    schema,
  };
}
