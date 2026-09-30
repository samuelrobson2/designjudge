import type { Bundle, Diagnostics } from '../types.ts';

export interface CriterionDef {
  id: string;
  name: string;
  points: { key: string; name: string }[];
}

export interface PacketImage {
  id: string;
  stateId: string;
  kind: 'viewport' | 'full' | 'scrolled';
  path: string;
  detail: 'high' | 'original';
  caption: string;
  width: number;
  height: number;
  scale: number;
  scrollY: number;
  estimatedTokens: number;
  // Marked copy: the clean screenshot it was drawn from, and the findings outlined on it.
  sourcePath?: string;
  marks?: ImageMark[];
}

export interface ImageMark {
  label: string;
  kind: 'fail';
  rect: { x: number; y: number; w: number; h: number };
}

export interface EvidenceIndexEntry {
  type: 'screenshot' | 'check' | 'check_item' | 'observation' | 'observation_item';
  stateId: string | null;
  resultKey?: string;
  itemN?: number;
  status?: string;
  secondary?: boolean;
}

export interface Packet {
  packetVersion: string;
  category: string;
  bundleId: string;
  caseId: string;
  interfaceId: string;
  request: string;
  evidence: Record<string, unknown>;
  images: PacketImage[];
  index: Record<string, EvidenceIndexEntry>;
  selectionNotes: string[];
  builtAt: string;
}

export interface CategoryDefinition {
  id: string;
  name: string;
  rubricPath: string;
  criteria: CriterionDef[];
  anchors: { score: number; label: string }[];
  buildPacket(bundle: Bundle, diags: Diagnostics, opts?: unknown): Packet;
}
