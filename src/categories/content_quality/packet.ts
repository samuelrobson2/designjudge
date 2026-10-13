// The Content Quality judge's evidence: the request; screenshots of the desktop and phone states
// at load, after the interactions found automatically, and with empty content; and the words of
// those states (text.ts). Content Quality has no automated checks.

import fs from 'node:fs';
import { CONTENT_QUALITY_RUBRIC_PATH } from '../../config.ts';
import type { Bundle } from '../../types.ts';
import type { Packet } from '../types.ts';
import { parseRubric, type ParsedRubric } from '../layout/rubric.ts';
import { buildNoChecksPacket, type NoChecksEvidence } from '../no-checks/packet.ts';
import { pageTextBlocks } from './text.ts';

export const CONTENT_QUALITY_PACKET_VERSION = 'content-quality-packet-v2';

export function parseContentQualityRubric(raw = fs.readFileSync(CONTENT_QUALITY_RUBRIC_PATH, 'utf8')): ParsedRubric {
  return parseRubric(raw, 'Content Quality', 'content_quality_rubric.md');
}

export function buildContentQualityPacket(bundle: Bundle): Packet {
  const packet = buildNoChecksPacket(bundle, {
    category: 'content_quality',
    packetVersion: CONTENT_QUALITY_PACKET_VERSION,
    rubric: parseContentQualityRubric(),
    baselines: ['desktop', 'mobile'],
    emptyContent: true,
  });
  const ev = packet.evidence as unknown as NoChecksEvidence;
  const byId = new Map(bundle.states.map((s) => [s.id, s]));
  const { blocks, notes } = pageTextBlocks(bundle, ev.states.map((s) => byId.get(s.state)!), packet.index);
  ev.page_text = blocks;
  ev.selection_notes.push(...notes);
  return packet;
}
