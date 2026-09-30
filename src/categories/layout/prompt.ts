import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../config.ts';
import { sha256 } from '../../util.ts';
import type { Packet } from '../types.ts';
import { layoutCategory } from './definition.ts';
import { packetVersionFor, type PacketOptions } from './packet.ts';
import { FINDINGS_RENDER_VERSION, RENDER_VERSION, renderSystem, renderUserParts, type UserPart } from './render.ts';
import { judgeRubricText, parseLayoutRubric } from './rubric.ts';
import { layoutOutputJsonSchema, type SchemaOptions } from './schema.ts';

export interface JudgeImage {
  id: string;
  stateId: string;
  kind: 'viewport' | 'full' | 'scrolled';
  caption: string;
  detail: 'high' | 'original';
  path: string;
  sha256: string;
  width: number;
  height: number;
  scale: number;
  scrollY: number;
  estimatedTokens: number;
}

export interface JudgeRequest {
  category: string;
  promptVersion: string;
  promptHash: string;
  rubricHash: string;
  packetHash: string;
  instructions: string;
  userText: string;
  // Present for text-rendered versions: the user message in order, with images inline.
  userParts?: UserPart[];
  // Structured evidence the message was rendered from (for inspection; not sent as JSON).
  evidence?: Record<string, unknown>;
  images: JudgeImage[];
  schemaName: string;
  schema: object;
}

export interface PromptConfig {
  description: string;
  rubric: 'full' | 'judge' | 'llm';
  render?: 'json' | 'text';
  packet: PacketOptions;
  // Field descriptions in the output schema (they carry the output instructions).
  schemaDescriptions?: boolean;
  // Whether the judge names the findings that decided the score (default true).
  decisiveFindings?: boolean;
  materiality?: SchemaOptions['materiality'];
  // A file in the prompt folder whose text replaces the rubric's scoring section.
  scoring?: string;
  // Findings packets: each measured value as a block shaped like a check issue.
  measurementBlocks?: boolean;
}

function promptDir(version: string): string {
  return path.join(ROOT, 'src/categories/layout/prompts', version);
}

export function listPromptVersions(): string[] {
  return fs
    .readdirSync(path.join(ROOT, 'src/categories/layout/prompts'))
    .filter((v) => fs.existsSync(path.join(promptDir(v), 'config.json')))
    .sort();
}

export function promptConfig(version: string): PromptConfig {
  const file = path.join(promptDir(version), 'config.json');
  if (!fs.existsSync(file)) throw new Error(`Unknown prompt version "${version}" (no ${file})`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as PromptConfig;
}

export function expectedPacketVersion(version: string): string {
  return packetVersionFor(promptConfig(version).packet);
}

export function buildLayoutRequest(packet: Packet, bundleDirAbs: string, promptVersion = 'v1'): JudgeRequest {
  const dir = promptDir(promptVersion);
  const config = promptConfig(promptVersion);
  if (packet.packetVersion !== expectedPacketVersion(promptVersion)) {
    throw new Error(`Prompt ${promptVersion} needs ${expectedPacketVersion(promptVersion)} but the packet is ${packet.packetVersion}`);
  }
  const systemTpl = fs.readFileSync(path.join(dir, 'system.md'), 'utf8');
  const userTpl = fs.readFileSync(path.join(dir, 'user.md'), 'utf8');
  const scoringTpl = config.scoring ? fs.readFileSync(path.join(dir, config.scoring), 'utf8').trim() : undefined;
  const rubricRaw = fs.readFileSync(layoutCategory.rubricPath, 'utf8').trim();
  const schema = layoutOutputJsonSchema(undefined, { describe: config.schemaDescriptions, decisive: config.decisiveFindings, materiality: config.materiality });

  let instructions: string;
  let userText: string;
  let userParts: UserPart[] | undefined;
  if (config.render === 'text') {
    const parsed = parseLayoutRubric(rubricRaw);
    instructions = renderSystem(systemTpl, parsed, scoringTpl);
    ({ parts: userParts, text: userText } = renderUserParts(userTpl, packet, parsed, { measurementBlocks: config.measurementBlocks }));
  } else {
    const rubric = config.rubric === 'judge' ? judgeRubricText() : rubricRaw;
    instructions = systemTpl.replace('{{RUBRIC}}', rubric);
    userText = userTpl
      .replace('{{REQUEST_JSON}}', JSON.stringify(packet.request))
      .replace('{{EVIDENCE_JSON}}', JSON.stringify(packet.evidence, null, 1));
  }
  const rubric = rubricRaw;

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
  const renderVersion =
    config.render !== 'text' ? '' : config.packet.evidence === 'findings' ? FINDINGS_RENDER_VERSION + (config.measurementBlocks ? '+measurement-blocks' : '') : RENDER_VERSION;
  return {
    category: 'layout',
    promptVersion,
    promptHash: sha256(systemTpl + '\n---\n' + userTpl + '\n---\n' + JSON.stringify(schema) + renderVersion + (scoringTpl ?? '')).slice(0, 16),
    rubricHash: sha256(rubric).slice(0, 16),
    packetHash: packetHash.slice(0, 16),
    instructions,
    userText,
    userParts,
    evidence: packet.evidence,
    images,
    schemaName: 'layout_judgment',
    schema,
  };
}
