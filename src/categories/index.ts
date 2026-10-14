import fs from 'node:fs';
import path from 'node:path';
import { bundleDir, loadDiagnostics, packetPath } from '../store.ts';
import { ensureMarkedScreenshots } from './layout/marks.ts';
import type { Bundle, Diagnostics } from '../types.ts';
import { readJson, writeJson } from '../util.ts';
import { contentQualityCategory } from './content_quality/definition.ts';
import { CONTENT_QUALITY_PACKET_VERSION } from './content_quality/packet.ts';
import { buildContentQualityRequest } from './content_quality/prompt.ts';
import { layoutCategory } from './layout/definition.ts';
import { buildLayoutPacket } from './layout/packet.ts';
import { buildLayoutRequest, expectedPacketVersion, listPromptVersions, promptConfig, type JudgeRequest } from './layout/prompt.ts';
import { parseRubric, type ParsedRubric } from './layout/rubric.ts';
import { taskFitCategory } from './task_fit/definition.ts';
import { TASK_FIT_PACKET_VERSION } from './task_fit/packet.ts';
import { buildTaskFitRequest } from './task_fit/prompt.ts';
import { typographyCategory } from './typography/definition.ts';
import { TYPOGRAPHY_PACKET_VERSION } from './typography/packet.ts';
import { buildTypographyRequest } from './typography/prompt.ts';
import { ensureComposedImages } from './typography/specimen.ts';
import { functionalityCategory } from './functionality/definition.ts';
import { FUNCTIONALITY_PACKET_VERSION, requireFunctionalProbes } from './functionality/packet.ts';
import { buildFunctionalityRequest } from './functionality/prompt.ts';
import { visualSystemCategory } from './visual_system/definition.ts';
import { VISUAL_SYSTEM_PACKET_VERSION } from './visual_system/packet.ts';
import { buildVisualSystemRequest } from './visual_system/prompt.ts';
import { ensureVisualSystemImages } from './visual_system/sheets.ts';
import type { CategoryDefinition, Packet } from './types.ts';
import { readRubric, readsAddedChecks } from './versions.ts';

export const CATEGORIES: Record<string, CategoryDefinition> = {
  layout: layoutCategory,
  typography: typographyCategory,
  task_fit: taskFitCategory,
  content_quality: contentQualityCategory,
  visual_system: visualSystemCategory,
  functionality: functionalityCategory,
};

// Packet versions of the categories whose packet is the same for every prompt version.
const PACKET_VERSIONS: Record<string, string> = {
  typography: TYPOGRAPHY_PACKET_VERSION,
  task_fit: TASK_FIT_PACKET_VERSION,
  content_quality: CONTENT_QUALITY_PACKET_VERSION,
  visual_system: VISUAL_SYSTEM_PACKET_VERSION,
  functionality: FUNCTIONALITY_PACKET_VERSION,
};

const REQUESTS: Record<string, (packet: Packet, bundleDirAbs: string, promptVersion: string) => JudgeRequest> = {
  layout: buildLayoutRequest,
  typography: buildTypographyRequest,
  task_fit: buildTaskFitRequest,
  content_quality: buildContentQualityRequest,
  visual_system: buildVisualSystemRequest,
  functionality: buildFunctionalityRequest,
};

export function categoryOf(id: string): CategoryDefinition {
  const c = CATEGORIES[id];
  if (!c) throw new Error(`Unknown category "${id}" (known: ${Object.keys(CATEGORIES).join(', ')})`);
  return c;
}

export function parseCategoryRubric(c: CategoryDefinition): ParsedRubric {
  return parseRubric(readRubric(c.rubricPath), c.name, path.basename(c.rubricPath));
}

export function buildPacket(category: string, bundle: Bundle, diags: Diagnostics, promptVersion: string): Packet {
  if (category === 'layout') return buildLayoutPacket(bundle, diags, promptConfig(promptVersion).packet);
  return readsAddedChecks(category, promptVersion) ? categoryOf(category).buildPacket(bundle, diags, { addedChecks: true }) : categoryOf(category).buildPacket(bundle, diags);
}

// Packet versions of categories other than Layout; versions that read the added checks get their own.
export function categoryPacketVersion(category: string, promptVersion: string): string {
  return PACKET_VERSIONS[category] + (readsAddedChecks(category, promptVersion) ? '+added-checks' : '');
}

function packetVersionFor(category: string, promptVersion: string): string {
  return category in PACKET_VERSIONS ? categoryPacketVersion(category, promptVersion) : expectedPacketVersion(promptVersion);
}

// Draws the images a packet sends that are not on disk yet (marked copies, specimen and palette sheets).
export async function ensurePacketImages(packet: Packet, dir: string): Promise<void> {
  await ensureVisualSystemImages(packet, dir);
  await ensureMarkedScreenshots(packet, dir);
  await ensureComposedImages(packet, dir);
}

// Why a category's evidence cannot be built from this bundle (Functionality without its probe), or null.
export function packetUnavailable(category: string, bundle: Bundle): string | null {
  try {
    if (category === 'functionality') requireFunctionalProbes(bundle);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

// One packet per prompt version, because versions can present the evidence differently. A
// category whose evidence is missing gets no packet, and any saved earlier is removed.
export async function buildAndSavePackets(bundle: Bundle, diags: Diagnostics): Promise<Packet[]> {
  const packets: Packet[] = [];
  for (const category of Object.keys(CATEGORIES)) {
    if (packetUnavailable(category, bundle)) {
      for (const version of listPromptVersions(category)) fs.rmSync(packetPath(bundle, category, version), { force: true });
      continue;
    }
    for (const version of listPromptVersions(category)) {
      const packet = buildPacket(category, bundle, diags, version);
      writeJson(packetPath(bundle, category, version), packet);
      await ensurePacketImages(packet, bundleDir(bundle.caseId, bundle.bundleId));
      packets.push(packet);
    }
  }
  return packets;
}

// Callers that send or show images must also await ensurePacketImages(packet, bundleDir).
export function loadOrBuildPacket(bundle: Bundle, promptVersion: string, category = 'layout'): Packet {
  const unavailable = packetUnavailable(category, bundle);
  if (unavailable) throw new Error(unavailable);
  const file = packetPath(bundle, category, promptVersion);
  if (fs.existsSync(file)) {
    const packet = readJson<Packet>(file);
    if (packet.packetVersion === packetVersionFor(category, promptVersion)) return packet;
  }
  const diags = loadDiagnostics(bundle);
  if (!diags) throw new Error(`No diagnostics for ${bundle.caseId}; run: npm run diagnose -- ${bundle.caseId}`);
  const packet = buildPacket(category, bundle, diags, promptVersion);
  writeJson(file, packet);
  return packet;
}

export function buildRequest(packet: Packet, bundleDirAbs: string, promptVersion: string): JudgeRequest {
  return (REQUESTS[packet.category] ?? buildLayoutRequest)(packet, bundleDirAbs, promptVersion);
}
