// The test interfaces people see on each category's home page: three products, each with a
// flawed, a baseline and a best version, shown in that order. Baseline and Best are shared by every
// category; each category has its own Flawed version, the Baseline with a few problems of that
// category only. The names and descriptions are for people only; judge prompts never include them,
// and the judge sees each interface by its opaque ID. Interfaces outside a category's grid stay
// reachable from their runs and by direct link, under a neutral name.

import { CATEGORIES } from '../categories/index.ts';

// The order categories are listed and chosen in, on the local viewer and the hosted site (the order
// of the original rating rubric).
export const CATEGORY_ORDER = ['layout', 'typography', 'visual_system', 'content_quality', 'task_fit', 'functionality'] as const;

export function orderedCategories<T extends { id: string }>(cats: T[]): T[] {
  const rank = (id: string) => {
    const i = (CATEGORY_ORDER as readonly string[]).indexOf(id);
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  return [...cats].sort((a, b) => rank(a.id) - rank(b.id));
}

export const SLOTS = [
  { id: 'flawed', name: 'Flawed' },
  { id: 'baseline', name: 'Baseline' },
  { id: 'best', name: 'Best' },
] as const;

export type SlotId = (typeof SLOTS)[number]['id'];

interface Test {
  caseId: string;
  description: string;
}

interface Product {
  id: string;
  name: string;
  baseline: string;
  best: string;
}

const BASELINE = 'This is the baseline test.';
const BEST = 'This is the best version, to test how high the judge will score.';

export const PRODUCTS: Product[] = [
  { id: 'booking', name: 'Physio booking', baseline: 'booking-baseline', best: 'booking-clean' },
  { id: 'carsearch', name: 'Car search', baseline: 'carsearch-baseline', best: 'carsearch-clean' },
  { id: 'dashboard', name: 'Store dashboard', baseline: 'dashboard-baseline', best: 'dashboard-clean' },
];

// Each category's Flawed test per product.
export const FLAWED: Record<(typeof CATEGORY_ORDER)[number], Record<string, Test>> = {
  layout: {
    booking: {
      caseId: 'booking-demoted-cta',
      description: "This is the flawed test, with errors in: the main 'Confirm booking' button moved to the end of the page and shrunk, two buttons that do nothing, and an extra policy block.",
    },
    carsearch: {
      caseId: 'carsearch-flawed-layout',
      description: "This is the flawed test, with errors in: Save buttons piled up in the page corner, car cards running off the screen on tablets and phones, and the phone filter drawer's 'Show cars' button pushed below the screen.",
    },
    dashboard: {
      caseId: 'dashboard-mobile-overflow',
      description: 'This is the flawed test, with errors in: the recent-orders table running off the screen on phones.',
    },
  },
  typography: {
    booking: {
      caseId: 'booking-flawed-typography',
      description: 'This is the flawed test, with errors in: headings set like body text, tiny 10 px supporting text, and text that shrinks to 10 px on phones.',
    },
    carsearch: {
      caseId: 'carsearch-flawed-typography',
      description: 'This is the flawed test, with errors in: car names that overpower the title while prices whisper, five mixed typefaces, and listing text that shrinks to 11 px on phones.',
    },
    dashboard: {
      caseId: 'dashboard-flawed-typography',
      description: 'This is the flawed test, with errors in: metric labels that overpower the figures, and faint, light-weight detail text.',
    },
  },
  visual_system: {
    booking: {
      caseId: 'booking-flawed-visual-system',
      description: 'This is the flawed test, with errors in: no keyboard focus ring on any control, form fields without labels for screen readers, and washed-out secondary text.',
    },
    carsearch: {
      caseId: 'carsearch-flawed-visual-system',
      description: "This is the flawed test, with errors in: hard-to-read deal badges, Save buttons with no name for screen readers, and every third car card looking greyed out like a sold listing.",
    },
    dashboard: {
      caseId: 'dashboard-flawed-visual-system',
      description: 'This is the flawed test, with errors in: hard-to-read order status badges, no focus ring on the date range or navigation, and one metric card styled unlike the others.',
    },
  },
  content_quality: {
    booking: {
      caseId: 'booking-flawed-content-quality',
      description: 'This is the flawed test, with errors in: vague error messages, and long, repetitive instructions on every step.',
    },
    carsearch: {
      caseId: 'carsearch-flawed-content-quality',
      description: 'This is the flawed test, with errors in: broken car photos, price ratings that contradict their own amounts, and the same things called by different names.',
    },
    dashboard: {
      caseId: 'dashboard-flawed-content-quality',
      description: 'This is the flawed test, with errors in: metrics labelled with contradicting time periods, and analyst jargon in labels and statuses.',
    },
  },
  task_fit: {
    booking: {
      caseId: 'booking-flawed-task-fit',
      description: 'This is the flawed test, with errors in: no way to pick a practitioner, a call-back request instead of choosing a time, and patient details that ask about a pet.',
    },
    carsearch: {
      caseId: 'carsearch-flawed-task-fit',
      description: 'This is the flawed test, with errors in: missing mileage and fuel type filters, unrequested sell, finance, insurance and warranty panels, and cars sold like shop basket items.',
    },
    dashboard: {
      caseId: 'dashboard-flawed-task-fit',
      description: 'This is the flawed test, with errors in: no revenue trend over time, a set-up checklist and upgrade offer above the metrics, and metrics the owner has to type in by hand.',
    },
  },
  functionality: {
    booking: {
      caseId: 'booking-flawed-functionality',
      description: "This is the flawed test, with errors in: a 'Confirm booking' button that does nothing, dates that can't be changed, and a script error when choosing a time.",
    },
    carsearch: {
      caseId: 'carsearch-flawed-functionality',
      description: "This is the flawed test, with errors in: a 'Filters' button that does nothing on phones, Compare boxes that untick themselves, and a make filter that changes nothing.",
    },
    dashboard: {
      caseId: 'dashboard-flawed-functionality',
      description: 'This is the flawed test, with errors in: date range buttons that do nothing, clicking an order opening the wrong one, and an order panel that cannot be closed.',
    },
  },
};

// Interfaces in no grid that still appear in older runs.
const OTHERS: Record<string, { product: string; name: string; description: string }> = {
  'dashboard-gold': {
    product: 'dashboard',
    name: 'Old gold version',
    description: 'An older, hand-polished version of the dashboard used in earlier runs. It is not one of the current test interfaces.',
  },
};

export interface Display {
  product: string;
  productName: string;
  slot: SlotId | 'other';
  slotName: string;
  label: string;
  description: string;
  // Whether the interface is one of this category's grid tests.
  inGrid: boolean;
}

const categoryName = (id: string) => CATEGORIES[id]?.name ?? id;

// How an interface is named and described on a category's pages, or null for one never named.
// Another category's Flawed test is named with that category, so it is never mistaken for this one's.
export function caseDisplay(caseId: string, category = 'layout'): Display | null {
  for (const p of PRODUCTS) {
    const make = (slot: SlotId | 'other', slotName: string, description: string, inGrid: boolean): Display => ({
      product: p.id,
      productName: p.name,
      slot,
      slotName,
      label: `${p.name} · ${slotName}`,
      description,
      inGrid,
    });
    if (caseId === p.baseline) return make('baseline', 'Baseline', BASELINE, true);
    if (caseId === p.best) return make('best', 'Best', BEST, true);
    for (const cat of CATEGORY_ORDER) {
      const t = FLAWED[cat][p.id];
      if (t?.caseId === caseId) return cat === category ? make('flawed', 'Flawed', t.description, true) : make('flawed', `Flawed (${categoryName(cat)})`, t.description, false);
    }
    const o = OTHERS[caseId];
    if (o?.product === p.id) return make('other', o.name, o.description, false);
  }
  return null;
}

// Every named interface's display, per category, for the viewer's pages.
export function caseNames(caseIds: string[]): Record<string, Record<string, Display>> {
  return Object.fromEntries(
    CATEGORY_ORDER.map((cat) => [cat, Object.fromEntries(caseIds.flatMap((id) => { const d = caseDisplay(id, cat); return d ? [[id, d]] : []; }))]),
  );
}

// Whether an interface is a test in any category's grid.
export function inAnyGrid(caseId: string): boolean {
  return CATEGORY_ORDER.some((cat) => caseDisplay(caseId, cat)?.inGrid);
}

// One category's grid as the viewer's pages draw it: products in order, each with its tests in slot order.
export function gridLayout(category = 'layout') {
  const flawed = FLAWED[category as (typeof CATEGORY_ORDER)[number]] ?? FLAWED.layout;
  return PRODUCTS.map((p) => {
    const tests: Record<SlotId, Test> = { flawed: flawed[p.id], baseline: { caseId: p.baseline, description: BASELINE }, best: { caseId: p.best, description: BEST } };
    return { id: p.id, name: p.name, tests: SLOTS.map((s) => ({ slot: s.id, slotName: s.name, label: `${p.name} · ${s.name}`, ...tests[s.id] })) };
  });
}

export function productOf(caseId: string): Product | null {
  return PRODUCTS.find((p) => caseId === p.id || caseId.startsWith(`${p.id}-`)) ?? null;
}
