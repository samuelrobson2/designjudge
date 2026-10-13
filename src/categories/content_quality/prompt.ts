import type { Packet } from '../types.ts';
import type { JudgeRequest } from '../layout/prompt.ts';
import type { NoChecksEvidence } from '../no-checks/packet.ts';
import { buildNoChecksRequest } from '../no-checks/prompt.ts';
import { CONTENT_QUALITY_CRITERIA, contentQualityCategory } from './definition.ts';
import { CONTENT_QUALITY_PACKET_VERSION } from './packet.ts';
import { renderPageText } from './text.ts';

export function buildContentQualityRequest(packet: Packet, bundleDirAbs: string, promptVersion = 'v2'): JudgeRequest {
  return buildNoChecksRequest(
    {
      category: 'content_quality',
      title: 'Content Quality',
      packetVersion: CONTENT_QUALITY_PACKET_VERSION,
      rubricPath: contentQualityCategory.rubricPath,
      criteria: CONTENT_QUALITY_CRITERIA,
      evidenceIds: 'screenshot IDs, S-…, and page text IDs, T-…',
      sections: (p) => ({ PAGE_TEXT: renderPageText((p.evidence as unknown as NoChecksEvidence).page_text ?? []) }),
      sectionsVersion: 'page-text-v1',
    },
    packet,
    bundleDirAbs,
    promptVersion,
  );
}
