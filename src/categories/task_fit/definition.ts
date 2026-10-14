import { TASK_FIT_RUBRIC_PATH } from '../../config.ts';
import { LAYOUT_ANCHORS } from '../layout/definition.ts';
import type { CategoryDefinition, CriterionDef } from '../types.ts';
import { buildTaskFitPacket } from './packet.ts';

// Mirrors the criteria and evaluation points in task_fit_rubric.md; a test checks they stay in sync.
export const TASK_FIT_CRITERIA: CriterionDef[] = [
  {
    id: 'A',
    name: 'Intent and Interface Choice',
    points: [
      { key: 'core_intent', name: 'Core intent' },
      { key: 'interface_choice', name: 'Interface choice' },
      { key: 'task_priority', name: 'Task priority' },
    ],
  },
  {
    id: 'B',
    name: 'Requirement Coverage',
    points: [
      { key: 'explicit_requirements', name: 'Explicit requirements' },
      { key: 'necessary_support', name: 'Necessary support' },
      { key: 'priority', name: 'Priority' },
    ],
  },
  {
    id: 'C',
    name: 'Scope and Restraint',
    points: [
      { key: 'relevant_scope', name: 'Relevant scope' },
      { key: 'restraint', name: 'Restraint' },
      { key: 'appropriate_defaults', name: 'Appropriate defaults' },
    ],
  },
  {
    id: 'D',
    name: 'Domain Fit',
    points: [
      { key: 'domain_relevance', name: 'Domain relevance' },
      { key: 'specificity', name: 'Specificity' },
      { key: 'no_unsupported_fabrication', name: 'No unsupported fabrication' },
    ],
  },
];

export const TASK_FIT_ANCHORS = LAYOUT_ANCHORS;

export const taskFitCategory: CategoryDefinition = {
  id: 'task_fit',
  name: 'Task Fit',
  rubricPath: TASK_FIT_RUBRIC_PATH,
  criteria: TASK_FIT_CRITERIA,
  anchors: TASK_FIT_ANCHORS,
  buildPacket: buildTaskFitPacket,
};
