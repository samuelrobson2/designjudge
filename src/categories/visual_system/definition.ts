import { VISUAL_SYSTEM_RUBRIC_PATH } from '../../config.ts';
import { LAYOUT_ANCHORS } from '../layout/definition.ts';
import type { CategoryDefinition, CriterionDef } from '../types.ts';
import { buildVisualSystemPacket } from './packet.ts';

// Mirrors the criteria and evaluation points in visual_system_rubric.md; a test checks they stay in sync.
export const VISUAL_SYSTEM_CRITERIA: CriterionDef[] = [
  {
    id: 'A',
    name: 'Color and Emphasis',
    points: [
      { key: 'palette_coherence', name: 'Palette coherence' },
      { key: 'visual_hierarchy', name: 'Visual hierarchy' },
      { key: 'semantic_consistency', name: 'Semantic consistency' },
      { key: 'purposeful_emphasis', name: 'Purposeful emphasis' },
      { key: 'perceptual_contrast', name: 'Perceptual contrast' },
    ],
  },
  {
    id: 'B',
    name: 'Components and Visual Language',
    points: [
      { key: 'component_consistency', name: 'Component consistency' },
      { key: 'surface_hierarchy', name: 'Surface hierarchy' },
      { key: 'shape_coherence', name: 'Shape coherence' },
      { key: 'icon_coherence', name: 'Icon coherence' },
      { key: 'optical_alignment', name: 'Optical alignment' },
      { key: 'detail_restraint', name: 'Detail restraint' },
    ],
  },
  {
    id: 'C',
    name: 'Interaction States and Accessibility',
    points: [
      { key: 'state_distinction', name: 'State distinction' },
      { key: 'state_consistency', name: 'State consistency' },
      { key: 'focus', name: 'Focus' },
      { key: 'accessible_semantics', name: 'Accessible semantics' },
      { key: 'targeting', name: 'Targeting' },
      { key: 'redundant_meaning', name: 'Redundant meaning' },
      { key: 'motion_restraint', name: 'Motion restraint' },
      { key: 'reduced_motion', name: 'Reduced motion' },
    ],
  },
];

export const VISUAL_SYSTEM_ANCHORS = LAYOUT_ANCHORS;

export const visualSystemCategory: CategoryDefinition = {
  id: 'visual_system',
  name: 'Visual System',
  rubricPath: VISUAL_SYSTEM_RUBRIC_PATH,
  criteria: VISUAL_SYSTEM_CRITERIA,
  anchors: VISUAL_SYSTEM_ANCHORS,
  buildPacket: buildVisualSystemPacket,
};
