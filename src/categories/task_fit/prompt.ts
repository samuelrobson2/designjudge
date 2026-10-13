import type { Packet } from '../types.ts';
import type { JudgeRequest } from '../layout/prompt.ts';
import { buildNoChecksRequest } from '../no-checks/prompt.ts';
import { TASK_FIT_CRITERIA, taskFitCategory } from './definition.ts';
import { TASK_FIT_PACKET_VERSION } from './packet.ts';

export function buildTaskFitRequest(packet: Packet, bundleDirAbs: string, promptVersion = 'v1'): JudgeRequest {
  return buildNoChecksRequest(
    {
      category: 'task_fit',
      title: 'Task Fit',
      packetVersion: TASK_FIT_PACKET_VERSION,
      rubricPath: taskFitCategory.rubricPath,
      criteria: TASK_FIT_CRITERIA,
      evidenceIds: 'screenshot IDs, S-…',
    },
    packet,
    bundleDirAbs,
    promptVersion,
  );
}
