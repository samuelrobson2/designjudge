import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const TMP = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/dj-added-checks-${process.pid}-${Date.now()}`;
  process.env.DJ_EVIDENCE_DIR = dir;
  delete process.env.DJ_ADDED_CHECKS;
  return dir;
});

import { FUNCTIONALITY_RUBRIC_PATH, LAYOUT_RUBRIC_PATH, TYPOGRAPHY_RUBRIC_PATH, VISUAL_SYSTEM_RUBRIC_PATH } from '../src/config.ts';
import { parseRubric } from '../src/categories/layout/rubric.ts';
import { renderFindingsCriterion } from '../src/categories/layout/render.ts';
import { parseFunctionalityRubric } from '../src/categories/functionality/packet.ts';
import { ADDED_CHECKS_DEFAULT, listPromptVersions, readRubric, readsAddedChecks, rubricView } from '../src/categories/versions.ts';
import { countClaims, countsIn, openedDetail, periodClaims, sortClaimIn, sortClaims, templateText, totalClaims, validationWording } from '../src/diagnostics/functionality/page-claims.ts';
import { proximityInversion, viewportParity } from '../src/diagnostics/layout/composition.ts';
import type { Bundle, DiagnosticResult, StateRecord } from '../src/types.ts';
import { state, syntheticBundle } from './bundles.ts';

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

let n = 0;
// A bundle whose states carry the given accessibility outlines, written under the temp evidence
// folder (the checks read outlines from disk).
function withOutlines(outlines: { id: string; kind: StateRecord['kind']; vp: StateRecord['viewportId']; aria: string; extra?: Partial<StateRecord> }[], fixedTime = '2026-10-13T12:00:00+01:00'): Bundle {
  const bundleId = `b${++n}`;
  const states = outlines.map((o) => {
    const file = `states/${o.id}/aria.yml`;
    const abs = path.join(TMP, 'c', bundleId, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, o.aria.replace(/^\n/, ''));
    return state(o.id, o.kind, o.vp, { files: { aria: file }, ...o.extra });
  });
  const b = syntheticBundle(states);
  return { ...b, bundleId, config: { ...b.config, fixedTime } } as Bundle;
}
const one = (aria: string, fixedTime?: string) => withOutlines([{ id: 'desktop', kind: 'baseline', vp: 'desktop', aria }], fixedTime);
const result = (m: Map<string, { status: string; items: { summary: string }[]; evaluated: number }>, id = 'desktop') => m.get(id)!;

describe('Count Claims', () => {
  it('fails a count of more items than are listed, with no control to show more', () => {
    const r = result(
      countClaims(
        one(`
- main:
  - paragraph:
    - strong: "248"
    - text: cars for sale
  - list:
    - listitem: Ford Fiesta £8,000
    - listitem: Audi A3 £14,000
    - listitem: VW Golf £11,500
`),
      ),
    );
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toContain('counts 248 cars, but 3 list items are listed and no control shows more');
  });

  it('passes a matching count, and a larger count with a control that shows more', () => {
    const list = `
  - list:
    - listitem: Ford Fiesta
    - listitem: Audi A3
    - listitem: VW Golf`;
    expect(result(countClaims(one(`- main:\n  - heading "3 cars" [level=2]${list}`))).status).toBe('pass');
    expect(result(countClaims(one(`- main:\n  - heading "40 cars" [level=2]${list}\n  - button "Show more"`))).status).toBe('pass');
    expect(result(countClaims(one(`- main:\n  - heading "40 cars" [level=2]${list}\n  - button "Load 37 more"`))).status).toBe('pass');
  });

  it('does not read units, attributes or years as counts', () => {
    expect(countsIn('248 cars for sale').map((c) => c.n)).toEqual([248]);
    expect(countsIn('9,400 miles')).toEqual([]);
    expect(countsIn('5 doors')).toEqual([]);
    expect(countsIn('Registered in 2019')).toEqual([]);
  });
});

describe('Totals Against Line Items', () => {
  const order = (total: string, extra = '') => `
- dialog "Order #1482":
  - heading "Order #1482" [level=2]
  - list:
    - listitem: Walnut serving board £49.00
    - listitem: Linen table runner £35.00${extra}
  - text: ${total}
`;
  it('fails a total that does not add up from its line items', () => {
    const r = result(totalClaims(one(order('Total £33.86'))));
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toContain('2 line amounts add up to £84 (£49 + £35), but "Total £33.86" says £33.86');
  });

  it('passes a total that adds up, and does not evaluate one with an adjustment line', () => {
    expect(result(totalClaims(one(order('Total £84.00')))).status).toBe('pass');
    const adjusted = result(totalClaims(one(order('Total £33.86', '\n    - listitem: Delivery £4.99'))));
    expect(adjusted.status).toBe('pass');
    expect(adjusted.evaluated).toBe(0);
  });
});

describe('Sort-Order Claims', () => {
  const ranked = (items: string[]) => `
- region "Top products":
  - paragraph: Ranked by revenue
  - list:
${items.map((i) => `    - listitem: ${i}`).join('\n')}
`;
  it('fails a stated order the values do not follow', () => {
    const r = result(sortClaims(one(ranked(['Oak wall shelf £3,239 41 sold', 'Beeswax candle trio £2,552 88 sold', 'Linen runner £2,900 30 sold']))));
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toContain('1 of 2 neighbouring pairs are the other way round');
  });

  it('passes values in the stated order', () => {
    expect(result(sortClaims(one(ranked(['Oak wall shelf £3,239', 'Linen runner £2,900', 'Beeswax candle trio £2,552'])))).status).toBe('pass');
  });

  it('reads the order stated, and takes a distance only with "away" or "from"', () => {
    expect(sortClaimIn('Sorted by price: low to high')).toEqual({ unit: 'money', dir: 'asc' });
    expect(sortClaimIn('Nearest first')).toEqual({ unit: 'distance', dir: 'asc' });
    expect(sortClaimIn('Newest')).toEqual({ unit: 'year', dir: 'desc' });
    expect(sortClaimIn('Welcome back')).toBeNull();
    // Mileage falls while distance rises: the order is judged by distance only.
    const r = result(sortClaims(one(`
- main:
  - paragraph: Nearest first
  - list:
    - listitem: Golf · 42,000 miles · 2 miles away
    - listitem: Corsa · 9,400 miles · 5 miles away
    - listitem: A3 · 61,000 miles · 11 miles from Bristol
`)));
    expect(r.status).toBe('pass');
    expect(r.evaluated).toBe(1);
  });

  it('does not take a threshold price ("£50 off") as the item\'s price', () => {
    const r = result(sortClaims(one(ranked(['Gift set £40 · £5 off', 'Candle £30', 'Soap £20 · save on orders £50 above']))));
    expect(r.status).toBe('pass');
  });
});

describe('Period Claims', () => {
  const recent = (heading: string, dates: string[]) => `
- region "Recent orders":
  - heading "${heading}" [level=2]
  - list:
${dates.map((d) => `    - listitem: Order ${d}`).join('\n')}
`;
  it('fails dates listed outside the stated window, at the page clock', () => {
    const r = result(periodClaims(one(recent('Orders in the last 7 days', ['12 Oct', '9 Oct', '2 Sep']))));
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toContain('1 of the 3 dates listed fall outside that period');
  });

  it('passes dates inside the window, and reads only real month names', () => {
    expect(result(periodClaims(one(recent('Orders in the last 7 days', ['12 Oct', '9 Oct', '7 Oct'])))).status).toBe('pass');
    const notDates = result(periodClaims(one(recent('Orders in the last 7 days', ['12 Oct', '3 Mart', '4 Junction']))));
    expect(notDates.evaluated).toBe(0);
  });

  const range = (selected: string, label: string) => `
- main:
  - radiogroup "Date range":
    - radio "Last 7 days"
    - radio "${selected}" [checked]
  - heading "${label}" [level=2]
`;
  it('fails a metric label naming another period than the one selected', () => {
    const r = result(periodClaims(one(range('Last 30 days', 'Revenue · last 7 days'))));
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toContain('"Last 30 days" is selected in "Date range"');
  });

  it('passes a matching label, a comparison, and a bare "N days" option', () => {
    expect(result(periodClaims(one(range('Last 30 days', 'Revenue · last 30 days')))).status).toBe('pass');
    expect(result(periodClaims(one(range('Last 30 days', 'Revenue, up 4% vs last 7 days')))).status).toBe('pass');
    expect(result(periodClaims(one(range('30 days', 'Revenue · last 30 days')))).status).toBe('pass');
  });

  it('does nothing without the fixed clock', () => {
    expect(result(periodClaims(one(recent('Orders in the last 7 days', ['12 Oct', '2 Sep']), ''))).evaluated).toBe(0);
  });
});

describe('Opened Detail Identity', () => {
  const opened = (heading: string) =>
    withOutlines([
      {
        id: 'interactive-auto-desktop',
        kind: 'interactive',
        vp: 'desktop',
        aria: `- dialog "${heading}":\n  - heading "${heading}" [level=2]\n`,
        extra: { interactiveDescription: 'After clicking the "#1482 Amara Okafor £33.86" row: a dialog or overlay appeared' },
      },
    ]);
  it('fails a detail that names another item than the one clicked', () => {
    const r = result(openedDetail(opened('Order #1479')), 'interactive-auto-desktop');
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toContain('a different identifier from the one clicked');
  });
  it('passes the item clicked', () => {
    expect(result(openedDetail(opened('Order #1482')), 'interactive-auto-desktop').status).toBe('pass');
  });
});

describe('Unfilled Template Values', () => {
  const page = (lines: string[]) => one(`- main:\n${lines.map((l) => `  - ${l}`).join('\n')}\n`);
  it('fails placeholders, programming values and message keys shown as text', () => {
    for (const t of ['text: "Hello {{firstName}}"', 'text: "Price: undefined"', 'text: "£null"', 'text: checkout.errors.card_declined', 'heading "Total: NaN" [level=2]']) {
      expect(result(templateText(page([t]))).status, t).toBe('fail');
    }
  });
  it('passes ordinary words, web addresses, file names and link targets', () => {
    const r = result(
      templateText(
        page(['text: Null and void clauses explained', 'text: Visit www.example.co.uk', 'text: Download report.final.pdf', 'link "Docs":\n    - /url: "/a.b.c_{{id}}"', 'text: To infinity and beyond']),
      ),
    );
    expect(r.status).toBe('pass');
  });
});

describe('Validation Message Wording', () => {
  it('flags only the generic messages that appeared after the interaction', () => {
    const b = withOutlines([
      { id: 'desktop', kind: 'baseline', vp: 'desktop', aria: '- form "Book":\n  - textbox "Email"\n  - button "Book now"\n' },
      {
        id: 'interactive-auto-desktop',
        kind: 'interactive',
        vp: 'desktop',
        aria: '- form "Book":\n  - textbox "Email" [invalid]\n  - text: Invalid input\n  - textbox "Date" [invalid]\n  - text: Choose a date after today\n  - button "Book now"\n',
        extra: { interactiveDescription: 'After clicking the "Book now" button: 2 messages appeared' },
      },
    ]);
    const r = validationWording(b).get('interactive-auto-desktop')!;
    expect(r.items).toHaveLength(1);
    expect(r.items[0].summary).toBe('1 of the 2 messages that appeared after clicking the "Book now" button name neither the field nor the fix: "Invalid input".');
  });
});

describe('Viewport Content Parity', () => {
  const pages = (phone: string, phoneLater?: string, tablet = '- heading "Your appointment" [level=2]\n') =>
    withOutlines([
      { id: 'desktop', kind: 'baseline', vp: 'desktop', aria: '- heading "Book a visit" [level=1]\n- heading "Your appointment" [level=2]\n' },
      { id: 'tablet', kind: 'baseline', vp: 'tablet', aria: `- heading "Book a visit" [level=1]\n${tablet}` },
      { id: 'mobile', kind: 'baseline', vp: 'mobile', aria: phone },
      ...(phoneLater ? [{ id: 'interactive-auto-mobile', kind: 'interactive' as const, vp: 'mobile' as const, aria: phoneLater }] : []),
    ]);
  it('reports a heading the phone page shows nowhere', () => {
    const r = viewportParity(pages('- heading "Book a visit" [level=1]\n'))!;
    expect(r.items.map((i) => i.summary)).toEqual(['The heading "Your appointment" on the desktop and tablet page is not on the phone page, nor in any phone state captured']);
  });
  it('accepts it in a phone state reached by an interaction, under another role, or missing on the tablet too', () => {
    expect(viewportParity(pages('- heading "Book a visit" [level=1]\n', '- dialog "Your appointment":\n  - text: 10:00\n'))!.items).toEqual([]);
    expect(viewportParity(pages('- heading "Book a visit" [level=1]\n- region "Your appointment"\n'))!.items).toEqual([]);
    expect(viewportParity(pages('- heading "Book a visit" [level=1]\n', undefined, ''))!.items).toEqual([]);
  });
});

describe('Proximity Inversion', () => {
  const spatial = (between: number, within: number): DiagnosticResult =>
    ({ key: 'spatial_grouping@desktop', diagId: 'spatial_grouping', kind: 'observation', stateId: 'desktop', status: 'observed', summary: '', secondary: [], items: [{ n: 1, summary: '', elements: [], data: { level: 'items', groups: 4, betweenMedianPx: between, withinMedianPx: within } }] }) as unknown as DiagnosticResult;
  it('fails items closer together than their own parts', () => {
    const r = proximityInversion(spatial(4, 16));
    expect(r.status).toBe('fail');
    expect(r.items[0].summary).toBe("4 items sit 4 px apart while the parts inside each item are 16 px apart, so each item's parts sit closer to the next item than to each other");
  });
  it('passes separated items, and tight items whose parts are tighter still', () => {
    expect(proximityInversion(spatial(24, 16)).status).toBe('pass');
    expect(proximityInversion(spatial(6, 8)).status).toBe('pass');
  });
});

describe('Versions that read the added checks', () => {
  it('are off by default, and listed only on request', () => {
    expect(ADDED_CHECKS_DEFAULT).toBe(false);
    expect(listPromptVersions('layout')).not.toContain('v7');
    expect(listPromptVersions('layout', { all: true })).toContain('v7');
    expect(listPromptVersions('functionality')).toEqual(['v1']);
    expect(readsAddedChecks('layout', 'v6')).toBe(false);
    expect(readsAddedChecks('layout', 'v7')).toBe(true);
    expect(readsAddedChecks('layout', 'v10')).toBe(true);
    expect(readsAddedChecks('typography', 'v1')).toBe(false);
    expect(readsAddedChecks('task_fit', 'v9')).toBe(false);
  });

  it('see their own rubric lines, and older versions the lines as before', () => {
    const raw = 'a\n<!-- before added checks -->\nold\n<!-- end -->\n<!-- added checks -->\nnew\n<!-- end -->\nb\n';
    expect(rubricView(raw, false)).toBe('a\nold\nb\n');
    expect(rubricView(raw, true)).toBe('a\nnew\nb\n');
    for (const f of [LAYOUT_RUBRIC_PATH, TYPOGRAPHY_RUBRIC_PATH, VISUAL_SYSTEM_RUBRIC_PATH, FUNCTIONALITY_RUBRIC_PATH]) {
      expect(readRubric(f, false)).not.toMatch(/added checks|<!--/);
      expect(readRubric(f, true)).not.toMatch(/added checks|<!--/);
    }
  });

  it('map each added check to its criterion', () => {
    const FILES: Record<string, string> = { layout: LAYOUT_RUBRIC_PATH, typography: TYPOGRAPHY_RUBRIC_PATH, visual_system: VISUAL_SYSTEM_RUBRIC_PATH, functionality: FUNCTIONALITY_RUBRIC_PATH };
    const TITLES: Record<string, string> = { layout: 'Layout', typography: 'Typography', visual_system: 'Visual System', functionality: 'Functionality' };
    const ids = (cat: string, added = true) => Object.fromEntries(parseRubric(readRubric(FILES[cat], added), TITLES[cat], path.basename(FILES[cat])).criteria.map((c) => [c.id, c.diagIds]));
    expect(ids('functionality').C).toEqual(['count_claims', 'total_claims', 'sort_claims', 'period_claims', 'opened_detail', 'template_text']);
    expect(ids('functionality').D).toEqual(['invalid_submission', 'runtime_errors', 'validation_wording']);
    expect(ids('visual_system').C).toEqual(expect.arrayContaining(['label_in_name', 'reduced_motion']));
    expect(ids('typography').B).toContain('squeezed_wrapping');
    const layout = Object.values(ids('layout')).flat();
    for (const id of ['broken_images', 'proximity_inversion', 'text_truncation', 'row_imbalance', 'hidden_scroll_items', 'pinned_over_used', 'viewport_parity']) expect(layout).toContain(id);
    expect(Object.values(ids('layout', false)).flat()).not.toContain('broken_images');
    expect(ids('functionality', false).C).toEqual([]);
  });

  it('say a criterion has no measurements, rather than that all are within the reference', () => {
    const parsed = parseFunctionalityRubric(readRubric(FUNCTIONALITY_RUBRIC_PATH, true));
    const text = renderFindingsCriterion({ criterion: 'A', name: 'Task Completion', checks: [], observations: [] }, parsed, { unmeasuredCriteria: ['A', 'B', 'C'] });
    expect(text).toContain('Measurements: none apply to this criterion.');
  });
});
