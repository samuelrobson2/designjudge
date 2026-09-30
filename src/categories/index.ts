import fs from 'node:fs';
import { bundleDir, loadDiagnostics, packetPath } from '../store.ts';
import { ensureMarkedScreenshots } from './layout/marks.ts';
import type { Bundle, Diagnostics } from '../types.ts';
import { readJson, writeJson } from '../util.ts';
import { layoutCategory } from './layout/definition.ts';
import { buildLayoutPacket } from './layout/packet.ts';
import { expectedPacketVersion, listPromptVersions, promptConfig } from './layout/prompt.ts';
import type { CategoryDefinition, Packet } from './types.ts';

// Later categories (Typography, Visual System, Content Quality, Task Fit, Functionality) register here.
export const CATEGORIES: Record<string, CategoryDefinition> = {
  layout: layoutCategory,
};

// One packet per prompt version, because versions can present the evidence differently.
export async function buildAndSavePackets(bundle: Bundle, diags: Diagnostics): Promise<Packet[]> {
  const packets: Packet[] = [];
  for (const version of listPromptVersions()) {
    const packet = buildLayoutPacket(bundle, diags, promptConfig(version).packet);
    writeJson(packetPath(bundle, 'layout', version), packet);
    await ensureMarkedScreenshots(packet, bundleDir(bundle.caseId, bundle.bundleId));
    packets.push(packet);
  }
  return packets;
}

// Callers that send or show images must also await ensureMarkedScreenshots(packet, bundleDir).
export function loadOrBuildPacket(bundle: Bundle, promptVersion: string): Packet {
  const file = packetPath(bundle, 'layout', promptVersion);
  if (fs.existsSync(file)) {
    const packet = readJson<Packet>(file);
    if (packet.packetVersion === expectedPacketVersion(promptVersion)) return packet;
  }
  const diags = loadDiagnostics(bundle);
  if (!diags) throw new Error(`No diagnostics for ${bundle.caseId}; run: npm run diagnose -- ${bundle.caseId}`);
  const packet = buildLayoutPacket(bundle, diags, promptConfig(promptVersion).packet);
  writeJson(file, packet);
  return packet;
}
