import { FUNCTIONALITY_RUBRIC_PATH } from '../../config.ts';
import { LAYOUT_ANCHORS } from '../layout/definition.ts';
import type { CategoryDefinition, CriterionDef } from '../types.ts';
import { buildFunctionalityPacket } from './packet.ts';

// Mirrors the criteria and evaluation points in functionality_rubric.md; a test checks they stay in sync.
export const FUNCTIONALITY_CRITERIA: CriterionDef[] = [
  {
    id: 'A',
    name: 'Task Completion',
    points: [
      { key: 'end_to_end_completion', name: 'End-to-end completion' },
      { key: 'meaningful_outcome', name: 'Meaningful outcome' },
      { key: 'path_continuity', name: 'Path continuity' },
      { key: 'primary_path_reliability', name: 'Primary-path reliability' },
    ],
  },
  {
    id: 'B',
    name: 'Interaction Correctness',
    points: [
      { key: 'control_behavior', name: 'Control behavior' },
      { key: 'input_handling', name: 'Input handling' },
      { key: 'consistency', name: 'Consistency' },
      { key: 'predictability', name: 'Predictability' },
    ],
  },
  {
    id: 'C',
    name: 'State and Data Integrity',
    points: [
      { key: 'state_accuracy', name: 'State accuracy' },
      { key: 'data_consistency', name: 'Data consistency' },
      { key: 'derived_results', name: 'Derived results' },
      { key: 'no_simulated_success', name: 'No simulated success' },
      { key: 'persistence_where_needed', name: 'Persistence where needed' },
    ],
  },
  {
    id: 'D',
    name: 'Feedback and Recovery',
    points: [
      { key: 'action_feedback', name: 'Action feedback' },
      { key: 'validation', name: 'Validation' },
      { key: 'failure_handling', name: 'Failure handling' },
      { key: 'recovery', name: 'Recovery' },
    ],
  },
];

export const FUNCTIONALITY_ANCHORS = LAYOUT_ANCHORS;

export const functionalityCategory: CategoryDefinition = {
  id: 'functionality',
  name: 'Functionality',
  rubricPath: FUNCTIONALITY_RUBRIC_PATH,
  criteria: FUNCTIONALITY_CRITERIA,
  anchors: FUNCTIONALITY_ANCHORS,
  buildPacket: buildFunctionalityPacket,
};
