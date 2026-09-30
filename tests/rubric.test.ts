import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../src/config.ts';
import { renderSystem, renderUserParts } from '../src/categories/layout/render.ts';
import { judgeRubricText, parseLayoutRubric, screenshotMatcher } from '../src/categories/layout/rubric.ts';
import type { Packet } from '../src/categories/types.ts';

const parsed = parseLayoutRubric();

describe('layout_rubric.md parsing', () => {
  it('finds all twelve diagnostics with a pass definition or reference values', () => {
    expect(parsed.diagnostics.map((d) => d.diagId)).toEqual([
      'region_overlap',
      'container_overflow',
      'page_horizontal_overflow',
      'interactive_reachability',
      'collapsed_dimensions',
      'occluded_content',
      'responsive_layout_failures',
      'content_growth_failures',
      'spatial_grouping',
      'responsive_adaptation',
      'alignment_outliers',
      'layout_stability',
    ]);
    for (const d of parsed.diagnostics) {
      if (d.kind === 'deterministic') expect(d.pass, d.name).toBeTruthy();
      else expect(d.reference, d.name).toBeTruthy();
    }
    expect(parsed.diagnostics.find((d) => d.diagId === 'spatial_grouping')!.reference).toContain('~2× is a useful reference');
  });

  it("maps each criterion's Relevant Evidence to diagnostics", () => {
    const map = Object.fromEntries(parsed.criteria.map((c) => [c.id, c.diagIds]));
    expect(map).toEqual({
      A: ['responsive_adaptation', 'interactive_reachability', 'spatial_grouping', 'alignment_outliers', 'region_overlap'],
      B: ['container_overflow', 'content_growth_failures'],
      C: ['responsive_adaptation', 'collapsed_dimensions', 'region_overlap', 'occluded_content', 'container_overflow'],
      D: ['responsive_adaptation', 'responsive_layout_failures', 'content_growth_failures', 'page_horizontal_overflow', 'interactive_reachability', 'layout_stability'],
    });
  });

  it("maps each criterion's screenshot list to states", () => {
    const b = screenshotMatcher(parsed.criteria.find((c) => c.id === 'B')!.screenshotsLine);
    expect(['desktop', 'tablet', 'mobile', 'stress-desktop'].every(b)).toBe(true);
    expect(b('interactive-validation-mobile') || b('sweep-768')).toBe(false);
    const d = screenshotMatcher(parsed.criteria.find((c) => c.id === 'D')!.screenshotsLine);
    expect(d('interactive-validation-mobile') && d('sweep-768')).toBe(true);
  });
});

describe('Text-rendered prompt (v3)', () => {
  const dir = path.join(ROOT, 'src/categories/layout/prompts/v3');
  const system = renderSystem(fs.readFileSync(path.join(dir, 'system.md'), 'utf8'), parsed);
  const packet = {
    request: 'Build a booking page.',
    interfaceId: 'iface-test',
    evidence: {
      states: [
        { state: 'desktop', label: 'Baseline Desktop', viewport: '1920×1080', fixture: 'typical', status: 'collected' },
        { state: 'stress-desktop', label: 'Combined Stress (desktop)', viewport: '1920×1080', fixture: 'stress', status: 'collected' },
      ],
      screenshots: [{ id: 'S-desktop-viewport', shows: 'Baseline Desktop at load' }],
      criteria: parsed.criteria.map((c) => ({
        criterion: c.id,
        name: c.name,
        relevant_screenshots: ['S-desktop-viewport'],
        diagnostic_evidence:
          c.id === 'A'
            ? [{ id: 'O-spatial_grouping-desktop', observation: 'Spatial Grouping and Separation', state: 'desktop', status: 'observed', summary: '3 groups detected.' }]
            : [{ id: 'C-region_overlap-desktop', check: 'Region Overlap', state: 'desktop', status: 'pass', summary: 'No collisions.' }],
      })),
      selection_notes: [],
    },
  } as unknown as Packet;
  const { parts, text } = renderUserParts(fs.readFileSync(path.join(dir, 'user.md'), 'utf8'), packet, parsed);

  it('puts the five scoring anchors and the rubric assessment rules in the system prompt', () => {
    for (const a of parsed.anchors) expect(system).toContain(`${a.score} · ${a.label}: ${a.text}`);
    expect(system).toContain('Assess every listed evaluation point that is applicable.');
  });

  it('places each criterion, verbatim, directly above its evidence', () => {
    for (const c of parsed.criteria) {
      const at = text.indexOf(`Criterion ${c.id} — ${c.name}: ${c.statement}`);
      expect(at, c.id).toBeGreaterThan(-1);
      for (const p of c.points) expect(text.indexOf(`- ${p.name}: ${p.definition}`, at)).toBeGreaterThan(at);
      expect(text.indexOf('<evidence>', at)).toBeGreaterThan(at);
    }
  });

  it('gives each observation its reference and each check its pass definition next to the results', () => {
    const spatial = parsed.diagnostics.find((d) => d.diagId === 'spatial_grouping')!;
    expect(text).toContain(`Spatial Grouping and Separation — Reference: ${spatial.reference}`);
    const overlap = parsed.diagnostics.find((d) => d.diagId === 'region_overlap')!;
    expect(text).toContain(`PASS means: ${overlap.pass}`);
  });

  it('explains pseudo-localized text on stress states and interleaves screenshots', () => {
    expect(text).toContain('pseudo-localized on purpose');
    expect(parts.filter((p) => p.type === 'image').map((p) => (p as { id: string }).id)).toEqual(['S-desktop-viewport']);
    expect(text.indexOf('[image S-desktop-viewport]')).toBeLessThan(text.indexOf('<criterion id="A"'));
  });

  it('contains no diagnostic implementation specs', () => {
    for (const phrase of ['getBoundingClientRect', 'scrollWidth - clientWidth', 'PerformanceObserver', 'On failure report']) {
      expect(system + text).not.toContain(phrase);
    }
  });
});

describe('Judge-facing rubric (prompt v2)', () => {
  const text = judgeRubricText(parsed);

  it('keeps states, criteria, and scoring verbatim', () => {
    expect(text).toContain(parsed.states);
    for (const c of parsed.criteria) expect(text).toContain(c.text);
    expect(text).toContain('Select the 1–5 anchor that best characterizes the overall quality of the Layout');
  });

  it('omits the diagnostic implementation specs', () => {
    for (const phrase of ['getBoundingClientRect', 'scrollWidth - clientWidth', 'PerformanceObserver', 'Build a set of visible layout elements', 'On failure report']) {
      expect(text).not.toContain(phrase);
    }
  });
});
