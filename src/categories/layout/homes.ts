// Where each diagnostic's full results are shown when a prompt shows each result once (other
// criteria that list the diagnostic get a one-line pointer). Each home is a criterion whose
// Relevant Evidence names the diagnostic.
export const DIAGNOSTIC_HOME: Record<string, string> = {
  spatial_grouping: 'A',
  alignment_outliers: 'A',
  container_overflow: 'B',
  region_overlap: 'C',
  collapsed_dimensions: 'C',
  occluded_content: 'C',
  page_horizontal_overflow: 'D',
  interactive_reachability: 'D',
  responsive_layout_failures: 'D',
  content_growth_failures: 'D',
  responsive_adaptation: 'D',
  layout_stability: 'D',
};
