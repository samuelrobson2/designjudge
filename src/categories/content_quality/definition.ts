import { CONTENT_QUALITY_RUBRIC_PATH } from '../../config.ts';
import { LAYOUT_ANCHORS } from '../layout/definition.ts';
import type { CategoryDefinition, CriterionDef } from '../types.ts';
import { buildContentQualityPacket } from './packet.ts';

// Mirrors the criteria and evaluation points in content_quality_rubric.md; a test checks they stay in sync.
export const CONTENT_QUALITY_CRITERIA: CriterionDef[] = [
  {
    id: 'A',
    name: 'Clarity and Actionability',
    points: [
      { key: 'clear_language', name: 'Clear language' },
      { key: 'action_clarity', name: 'Action clarity' },
      { key: 'useful_guidance', name: 'Useful guidance' },
      { key: 'state_communication', name: 'State communication' },
      { key: 'specificity', name: 'Specificity' },
    ],
  },
  {
    id: 'B',
    name: 'Concision and Consistency',
    points: [
      { key: 'necessity', name: 'Necessity' },
      { key: 'redundancy', name: 'Redundancy' },
      { key: 'proportion', name: 'Proportion' },
      { key: 'terminology', name: 'Terminology' },
      { key: 'voice_and_tone', name: 'Voice and tone' },
      { key: 'structural_restraint', name: 'Structural restraint' },
    ],
  },
  {
    id: 'C',
    name: 'Image Fit and Coherence',
    points: [
      { key: 'purpose', name: 'Purpose' },
      { key: 'relevance', name: 'Relevance' },
      { key: 'framing', name: 'Framing' },
      { key: 'quality', name: 'Quality' },
      { key: 'coherence', name: 'Coherence' },
    ],
  },
];

export const CONTENT_QUALITY_ANCHORS = LAYOUT_ANCHORS;

export const contentQualityCategory: CategoryDefinition = {
  id: 'content_quality',
  name: 'Content Quality',
  rubricPath: CONTENT_QUALITY_RUBRIC_PATH,
  criteria: CONTENT_QUALITY_CRITERIA,
  anchors: CONTENT_QUALITY_ANCHORS,
  buildPacket: buildContentQualityPacket,
};
