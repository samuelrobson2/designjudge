import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../util.ts';
import type { Packet } from '../types.ts';
import { promptConfig, promptDir, type JudgeImage, type JudgeRequest } from '../layout/prompt.ts';
import { FINDINGS_RENDER_VERSION, renderSystem, renderUserParts } from '../layout/render.ts';
import { layoutOutputJsonSchema } from '../layout/schema.ts';
import { TYPOGRAPHY_CRITERIA, typographyCategory } from './definition.ts';
import { parseTypographyRubric, TYPOGRAPHY_PACKET_VERSION } from './packet.ts';
import { readRubric, readsAddedChecks } from '../versions.ts';

const PSEUDO_NOTE =
  'Text in this state is pseudo-localized on purpose (accented letters, about 40% longer, wrapped in [brackets]) to simulate translated strings. Judge how the typography handles the longer text; the altered wording is not a defect.';
export function buildTypographyRequest(packet: Packet, bundleDirAbs: string, promptVersion = 'v1'): JudgeRequest {
  const added = readsAddedChecks('typography', promptVersion);
  const expected = TYPOGRAPHY_PACKET_VERSION + (added ? '+added-checks' : '');
  if (packet.packetVersion !== expected) {
    throw new Error(`Typography prompt ${promptVersion} needs ${expected} but the packet is ${packet.packetVersion}`);
  }
  const dir = promptDir(promptVersion, 'typography');
  const config = promptConfig(promptVersion, 'typography');
  const systemTpl = fs.readFileSync(path.join(dir, 'system.md'), 'utf8');
  const userTpl = fs.readFileSync(path.join(dir, 'user.md'), 'utf8');
  const rubricRaw = readRubric(typographyCategory.rubricPath, added).trim();
  const parsed = parseTypographyRubric(rubricRaw);
  const schema = layoutOutputJsonSchema(TYPOGRAPHY_CRITERIA, {
    describe: config.schemaDescriptions,
    decisive: config.decisiveFindings,
    materiality: config.materiality,
    category: 'Typography',
  });
  const instructions = renderSystem(systemTpl, parsed);
  const { parts: userParts, text: userText } = renderUserParts(userTpl, packet, parsed, {
    pseudoNote: PSEUDO_NOTE,
    measurementBlocks: config.measurementBlocks,
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
    category: 'typography',
    promptVersion,
    promptHash: sha256(systemTpl + '\n---\n' + userTpl + '\n---\n' + JSON.stringify(schema) + FINDINGS_RENDER_VERSION + (config.measurementBlocks ? '+measurement-blocks' : '') + PSEUDO_NOTE).slice(0, 16),
    rubricHash: sha256(rubricRaw).slice(0, 16),
    packetHash: packetHash.slice(0, 16),
    instructions,
    userText,
    userParts,
    evidence: packet.evidence,
    images,
    schemaName: 'typography_judgment',
    schema,
  };
}
