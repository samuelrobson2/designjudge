// The Task Fit judge's evidence: the request, and screenshots of the desktop and phone states at
// load and after the interactions found automatically. Task Fit has no automated checks.

import fs from 'node:fs';
import { TASK_FIT_RUBRIC_PATH } from '../../config.ts';
import type { Bundle } from '../../types.ts';
import type { Packet } from '../types.ts';
import { parseRubric, type ParsedRubric } from '../layout/rubric.ts';
import { buildNoChecksPacket } from '../no-checks/packet.ts';

export const TASK_FIT_PACKET_VERSION = 'task-fit-packet-v2';

export function parseTaskFitRubric(raw = fs.readFileSync(TASK_FIT_RUBRIC_PATH, 'utf8')): ParsedRubric {
  return parseRubric(raw, 'Task Fit', 'task_fit_rubric.md');
}

export function buildTaskFitPacket(bundle: Bundle): Packet {
  return buildNoChecksPacket(bundle, {
    category: 'task_fit',
    packetVersion: TASK_FIT_PACKET_VERSION,
    rubric: parseTaskFitRubric(),
    baselines: ['desktop', 'mobile'],
  });
}
