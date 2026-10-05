import { describe, expect, it } from 'vitest';
import { critiquesByScreen, designerComments, parseCsv, parsePythonStrings } from '../src/calibration/uicrit.ts';

describe('UICrit parsing', () => {
  it('parses quoted CSV fields with commas, doubled quotes and newlines', () => {
    expect(parseCsv('a,b\n"x, ""y""","line 1\nline 2"\n')).toEqual([
      ['a', 'b'],
      ['x, "y"', 'line 1\nline 2'],
    ]);
  });

  it('parses Python string lists with either quote style and escapes', () => {
    expect(parsePythonStrings(`['it\\'s\\nfine', "say \\"hi\\"", 'caf\\xe9']`)).toEqual(["it's\nfine", 'say "hi"', 'café']);
  });

  it('keeps only designer-written comments, without headers or bounding boxes', () => {
    const literal = `["Comment 1\\nAmounts are not\\nright aligned.\\nBounding Box: [0.1, 0.2, 0.3, 0.4]", 'LLM Comment 1\\nGenerated.\\nBounding Box: [0, 0, 1, 1]', "Comment 2\\nText wraps.\\n\\nBounding Box: [1.2e-05, 0.5, 0.6, 0.7]"]`;
    expect(designerComments(literal)).toEqual(['Amounts are not right aligned.', 'Text wraps.']);
  });

  it('groups rows by screen with every distinct task, mean ratings and all feedback', () => {
    const rows = [
      ['rico_id', 'task', 'aesthetics_rating', 'learnability', 'efficency', 'usability_rating', 'design_quality_rating', 'comments'],
      ['15', 'Start a workout', '6', '3', '3', '7', '6', `["Comment 1\\nToo cramped.\\nBounding Box: [0, 0, 1, 1]"]`],
      ['15', 'Start a workout', '5', '4', '2', '6', '7', `["Comment 1\\nLow contrast.\\nBounding Box: [0, 0, 1, 1]"]`],
      ['15', 'Browse plans', '6', '', '3', '6', '6', `[]`],
    ];
    expect(critiquesByScreen(rows)).toEqual([
      {
        screenId: '15',
        prompt: 'Start a workout\nBrowse plans',
        ratings: { design_quality: 6.3, aesthetics: 5.7, usability: 6.3, learnability: 3.5, efficiency: 2.7 },
        feedback: ['Too cramped.', 'Low contrast.'],
      },
    ]);
  });
});
