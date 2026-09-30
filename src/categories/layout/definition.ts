import { LAYOUT_RUBRIC_PATH } from '../../config.ts';
import type { CategoryDefinition, CriterionDef } from '../types.ts';
import { buildLayoutPacket } from './packet.ts';

// Mirrors the criteria and evaluation points in layout_rubric.md; a test checks they stay in sync.
export const LAYOUT_CRITERIA: CriterionDef[] = [
  {
    id: 'A',
    name: 'Hierarchy and Grouping',
    points: [
      { key: 'primary_focus', name: 'Primary focus' },
      { key: 'task_aligned_order', name: 'Task-aligned order' },
      { key: 'grouping', name: 'Grouping' },
      { key: 'alignment', name: 'Alignment' },
      { key: 'structural_restraint', name: 'Structural restraint' },
      { key: 'focused_composition', name: 'Focused composition' },
    ],
  },
  {
    id: 'B',
    name: 'Density and Content Fit',
    points: [
      { key: 'appropriate_density', name: 'Appropriate density' },
      { key: 'efficient_use_of_space', name: 'Efficient use of space' },
      { key: 'clutter_control', name: 'Clutter control' },
      { key: 'content_fit', name: 'Content fit' },
    ],
  },
  {
    id: 'C',
    name: 'Integrity and Proportions',
    points: [
      { key: 'usable_sizing', name: 'Usable sizing' },
      { key: 'functional_proportion', name: 'Functional proportion' },
      { key: 'compositional_balance', name: 'Compositional balance' },
      { key: 'peer_consistency', name: 'Peer consistency' },
      { key: 'structural_integrity', name: 'Structural integrity' },
    ],
  },
  {
    id: 'D',
    name: 'Responsive and Content Resilience',
    points: [
      { key: 'adaptive_behavior', name: 'Adaptive behavior' },
      { key: 'growth_resilience', name: 'Growth resilience' },
      { key: 'priority_preservation', name: 'Priority preservation' },
      { key: 'reachability', name: 'Reachability' },
      { key: 'scroll_behavior', name: 'Scroll behavior' },
    ],
  },
];

export const LAYOUT_ANCHORS = [
  { score: 5, label: 'Exceptional' },
  { score: 4, label: 'Strong' },
  { score: 3, label: 'Competent' },
  { score: 2, label: 'Poor' },
  { score: 1, label: 'Failing' },
];

export const layoutCategory: CategoryDefinition = {
  id: 'layout',
  name: 'Layout',
  rubricPath: LAYOUT_RUBRIC_PATH,
  criteria: LAYOUT_CRITERIA,
  anchors: LAYOUT_ANCHORS,
  buildPacket: buildLayoutPacket,
};
