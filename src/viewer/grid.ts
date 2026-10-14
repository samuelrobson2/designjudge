// The test interfaces people see on each category's home page: three products, each with a
// flawed, a baseline and a best version, shown in that order. Baseline and Best are shared by every
// category; each category has its own Flawed version, the Baseline with a few problems of that
// category only. The names and descriptions are for people only; judge prompts never include them,
// and the judge sees each interface by its opaque ID. Interfaces outside a category's grid stay
// reachable from their runs and by direct link, under a neutral name.

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

const BASELINE = 'The original version, as first generated.';
const BEST = 'Cleaned up, to test how high the judge will score.';

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
      description: "Errors: Confirm button moved to the end and shrunk, two dead buttons, an extra policy block.",
    },
    carsearch: {
      caseId: 'carsearch-flawed-layout',
      description: "Errors: Save buttons piled in a corner, cards off-screen on tablet and phone, filter button below the screen.",
    },
    dashboard: {
      caseId: 'dashboard-mobile-overflow',
      description: "Errors: orders table runs off the screen on phones.",
    },
  },
  typography: {
    booking: {
      caseId: 'booking-flawed-typography',
      description: "Errors: headings set like body text, tiny 10 px supporting text, text shrinking on phones.",
    },
    carsearch: {
      caseId: 'carsearch-flawed-typography',
      description: "Errors: car names overpower prices, five mixed typefaces, 11 px text on phones.",
    },
    dashboard: {
      caseId: 'dashboard-flawed-typography',
      description: "Errors: labels overpower the figures, faint light-weight text.",
    },
  },
  visual_system: {
    booking: {
      caseId: 'booking-flawed-visual-system',
      description: "Errors: no focus ring, unlabelled form fields, washed-out secondary text.",
    },
    carsearch: {
      caseId: 'carsearch-flawed-visual-system',
      description: "Errors: hard-to-read deal badges, unnamed Save buttons, cards that look sold.",
    },
    dashboard: {
      caseId: 'dashboard-flawed-visual-system',
      description: "Errors: hard-to-read status badges, hidden focus rings, one mismatched metric card.",
    },
  },
  content_quality: {
    booking: {
      caseId: 'booking-flawed-content-quality',
      description: "Errors: vague error messages, long repetitive instructions.",
    },
    carsearch: {
      caseId: 'carsearch-flawed-content-quality',
      description: "Errors: broken car photos, contradictory price ratings, inconsistent names.",
    },
    dashboard: {
      caseId: 'dashboard-flawed-content-quality',
      description: "Errors: contradicting time periods, analyst jargon.",
    },
  },
  task_fit: {
    booking: {
      caseId: 'booking-flawed-task-fit',
      description: "Errors: no practitioner choice, a call-back instead of picking a time, pet details.",
    },
    carsearch: {
      caseId: 'carsearch-flawed-task-fit',
      description: "Errors: no mileage or fuel filters, unrequested sell and finance panels, shop-basket buying.",
    },
    dashboard: {
      caseId: 'dashboard-flawed-task-fit',
      description: "Errors: no revenue trend, a set-up checklist and upsell above the metrics, metrics typed in by hand.",
    },
  },
  functionality: {
    booking: {
      caseId: 'booking-flawed-functionality',
      description: "Errors: Confirm does nothing, dates can't be changed, a script error on choosing a time.",
    },
    carsearch: {
      caseId: 'carsearch-flawed-functionality',
      description: "Errors: Filters dead on phones, Compare unticks itself, make filter ignored.",
    },
    dashboard: {
      caseId: 'dashboard-flawed-functionality',
      description: "Errors: range buttons dead, the wrong order opens, the order panel can't close.",
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

// How an interface is named and described on a category's pages, or null for one never named.
// The name stays the same in every category. inGrid says whether it is one of this category's tests.
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
      if (t?.caseId === caseId) return make('flawed', 'Flawed', t.description, cat === category);
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
