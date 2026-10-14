import { TYPOGRAPHY_RUBRIC_PATH } from '../../config.ts';
import { LAYOUT_ANCHORS } from '../layout/definition.ts';
import type { CategoryDefinition, CriterionDef } from '../types.ts';
import { buildTypographyPacket } from './packet.ts';

// Mirrors the criteria and evaluation points in typography_rubric.md; a test checks they stay in sync.
export const TYPOGRAPHY_CRITERIA: CriterionDef[] = [
  {
    id: 'A',
    name: 'Hierarchy and Emphasis',
    points: [
      { key: 'role_distinction', name: 'Role distinction' },
      { key: 'hierarchical_progression', name: 'Hierarchical progression' },
      { key: 'task_aligned_emphasis', name: 'Task-aligned emphasis' },
      { key: 'economy_of_emphasis', name: 'Economy of emphasis' },
    ],
  },
  {
    id: 'B',
    name: 'Legibility and Reading Comfort',
    points: [
      { key: 'readable_sizing', name: 'Readable sizing' },
      { key: 'appropriate_weight', name: 'Appropriate weight' },
      { key: 'line_height', name: 'Line height' },
      { key: 'measure', name: 'Measure' },
      { key: 'multi_line_treatment', name: 'Multi-line treatment' },
    ],
  },
  {
    id: 'C',
    name: 'System Coherence and Restraint',
    points: [
      { key: 'scale_coherence', name: 'Scale coherence' },
      { key: 'role_consistency', name: 'Role consistency' },
      { key: 'typeface_restraint', name: 'Typeface restraint' },
      { key: 'weight_restraint', name: 'Weight restraint' },
    ],
  },
  {
    id: 'D',
    name: 'Responsive Typography Resilience',
    points: [
      { key: 'responsive_adaptation', name: 'Responsive adaptation' },
      { key: 'hierarchy_preservation', name: 'Hierarchy preservation' },
      { key: 'reading_preservation', name: 'Reading preservation' },
    ],
  },
];

export const TYPOGRAPHY_ANCHORS = LAYOUT_ANCHORS;

export const typographyCategory: CategoryDefinition = {
  id: 'typography',
  name: 'Typography',
  rubricPath: TYPOGRAPHY_RUBRIC_PATH,
  criteria: TYPOGRAPHY_CRITERIA,
  anchors: TYPOGRAPHY_ANCHORS,
  buildPacket: buildTypographyPacket,
};
