// Writes every planted Visual System item to mutations-visual-system/<case>/<id>.json and
// regenerates the README's table. Usage: node mutations-visual-system/_tools/build.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PHONE = '@media (max-width: 767px)';

// Re-applies a change after every render (the cases redraw with innerHTML).
const onRender = (body) => `const apply = () => { ${body} };
const mo = new MutationObserver(() => { mo.disconnect(); apply(); mo.observe(document.body, { childList: true, subtree: true }); });
apply();
mo.observe(document.body, { childList: true, subtree: true });`;

const items = [
  // ---------- booking-baseline ----------
  {
    case: 'booking-baseline',
    id: 'muted-text-washed-out',
    kind: 'defect',
    title: 'Secondary text washed out to a pale grey',
    symptom: 'The muted text colour is lightened to #a3aab4, so treatment descriptions and durations, the practitioner hint, the summary note and the field hints read at about 2.4:1 against white.',
    measure: 'Required Contrast: text below 4.5:1',
    where: {},
    severity: 'moderate',
    css: ':root { --muted: #a3aab4; }',
  },
  {
    case: 'booking-baseline',
    id: 'focus-ring-removed',
    kind: 'defect',
    title: 'Keyboard focus ring removed from every control',
    symptom: 'A reset rule removes the outline from focused buttons, links and fields and puts nothing in its place, so a keyboard user cannot see which date, time or button is focused.',
    measure: 'Keyboard Focus Visibility',
    where: { viewports: ['desktop'] },
    severity: 'severe',
    css: 'a:focus, button:focus, input:focus, select:focus, textarea:focus, [tabindex]:focus { outline: none !important; box-shadow: none !important; }',
  },
  {
    case: 'booking-baseline',
    id: 'labels-not-tied-to-fields',
    kind: 'defect',
    title: 'Field labels no longer tied to their fields',
    symptom: 'The text above "Full name", "Email", "Phone" and "Anything we should know?" looks the same but is plain text rather than a label, so the fields have no accessible name: a screen reader announces each as an unnamed edit field, and clicking the text no longer focuses the field.',
    measure: 'Automated Accessibility Violations: label',
    where: {},
    severity: 'moderate',
    js: onRender(`document.querySelectorAll('.field label').forEach((l) => {
  const s = document.createElement('span');
  s.className = 'field__label';
  s.innerHTML = l.innerHTML;
  l.replaceWith(s);
});`),
    css: '.field .field__label { font-size: 14px; font-weight: 560; }',
  },
  {
    case: 'booking-baseline',
    id: 'confirm-colour-drift',
    kind: 'defect',
    title: 'Summary Confirm button in a hard-coded near-match of the brand colour',
    symptom: "The summary panel's Confirm button is given a hard-coded #12786f instead of the brand variable, a shade that almost but not quite matches every other primary element.",
    measure: 'Rendered Style Vocabulary: near-duplicate colour',
    where: { viewports: ['desktop', 'tablet'] },
    severity: 'minor',
    css: '.summary .btn--primary { background: #12786f; }',
  },
  {
    case: 'booking-baseline',
    id: 'odd-treatment-card',
    kind: 'defect',
    title: 'One treatment card styled differently from the others',
    symptom: 'The third treatment card has square corners, a darker border and a drop shadow, while the other three are flat with rounded corners, so it looks like a different kind of element or a promoted option.',
    measure: 'Peer Visual Consistency',
    where: {},
    severity: 'minor',
    css: '.option-card:nth-child(3) { border-radius: 2px; border-color: #7b8491; box-shadow: 0 3px 8px rgba(16, 24, 40, 0.18); }',
  },
  {
    case: 'booking-baseline',
    id: 'date-chips-tiny-phone',
    kind: 'defect',
    title: 'Date chips shrink to tiny tap targets on phones',
    symptom: 'On phones the date picker becomes a row of 20 × 20 px chips 2 px apart, too small and too close together to tap reliably.',
    measure: 'Minimum Pointer Target Size',
    where: { viewports: ['phone'], widths: [320, 767] },
    severity: 'moderate',
    css: `${PHONE} {
  .date-strip { gap: 2px !important; }
  .date-chip { flex: 0 0 20px !important; width: 20px !important; min-width: 0 !important; height: 20px; min-height: 0; padding: 0 !important; overflow: hidden; font-size: 9px; }
  .date-chip__num { font-size: 10px; }
  .date-chip__day, .date-chip__month { display: none; }
}`,
  },
  {
    case: 'booking-baseline',
    id: 'harmless-retheme-blue',
    kind: 'harmless',
    title: 'Brand colour changed to blue',
    symptom: 'The primary colour, its hover shade and its tint change from teal to blue through the theme variables, consistently everywhere.',
    measure: 'none',
    where: {},
    severity: 'none',
    css: ':root { --primary: #1d4ed8; --primary-hover: #1e40af; --primary-tint: #eef2ff; }',
  },
  {
    case: 'booking-baseline',
    id: 'harmless-visible-focus-ring',
    kind: 'harmless',
    title: 'A stronger keyboard focus ring',
    symptom: 'Every control gets a 2 px amber focus ring offset from its edge in place of the browser default.',
    measure: 'none',
    where: {},
    severity: 'none',
    css: ':focus-visible { outline: 2px solid #b45309 !important; outline-offset: 2px; }',
  },
  // ---------- carsearch-baseline ----------
  {
    case: 'carsearch-baseline',
    id: 'save-buttons-unnamed',
    kind: 'defect',
    title: 'Save buttons lose their accessible names',
    symptom: 'The heart-shaped Save buttons on the car cards lose their aria-label, so a screen reader announces each one as "button" with no name.',
    measure: 'Automated Accessibility Violations: button-name',
    where: {},
    severity: 'moderate',
    js: onRender(`document.querySelectorAll('.save[aria-label]').forEach((b) => { b.removeAttribute('aria-label'); b.textContent = ''; b.style.backgroundImage = 'radial-gradient(circle, #e11d48 30%, transparent 32%)'; });`),
  },
  {
    case: 'carsearch-baseline',
    id: 'deal-badges-low-contrast',
    kind: 'defect',
    title: 'Deal badges drawn in pale text on pale tints',
    symptom: 'The "Great price" and "Good price" badges are recoloured to pale green and pale blue text on their pale tints, about 1.8:1, so the deal rating is hard to read.',
    measure: 'Required Contrast: text below 4.5:1',
    where: {},
    severity: 'moderate',
    css: '.deal--great { color: #86c99c; } .deal--good { color: #93b4ef; }',
  },
  {
    case: 'carsearch-baseline',
    id: 'toggle-buttons-tiny',
    kind: 'defect',
    title: 'Fuel and gearbox toggles packed into tiny buttons',
    symptom: 'The fuel-type and gearbox toggle buttons shrink to 16 px tall with 2 px between them, too small and too close together to hit reliably with a pointer or a finger.',
    measure: 'Minimum Pointer Target Size',
    where: {},
    severity: 'minor',
    css: '.toggles { gap: 2px !important; } .toggle { height: 16px; min-height: 0 !important; padding: 0 5px !important; font-size: 10px !important; line-height: 14px; }',
  },
  {
    case: 'carsearch-baseline',
    id: 'harmless-rounder-cards',
    kind: 'harmless',
    title: 'Car cards get larger rounded corners',
    symptom: 'Every car card and its image get 14 px corners instead of 10 px, consistently.',
    measure: 'none',
    where: {},
    severity: 'none',
    css: '.car { border-radius: 14px !important; } .car-img { border-radius: 14px 14px 0 0 !important; }',
  },
  // ---------- dashboard-baseline ----------
  {
    case: 'dashboard-baseline',
    id: 'nav-icons-mixed-with-emoji',
    kind: 'defect',
    title: 'Two navigation icons replaced with emoji',
    symptom: 'The Orders and Settings items in the sidebar show emoji (📦, ⚙️) where the other items show line icons, mixing two icon styles in one list.',
    measure: 'Rendered Style Vocabulary: icons in more than one kind',
    where: { viewports: ['desktop'] },
    severity: 'minor',
    js: onRender(`document.querySelectorAll('.nav__item').forEach((a) => {
  const label = a.textContent.trim();
  const emoji = { Orders: '📦', Settings: '⚙️' }[label];
  const svg = a.querySelector('svg');
  if (emoji && svg) { const s = document.createElement('span'); s.className = 'icon'; s.textContent = emoji; svg.replaceWith(s); }
});`),
  },
  {
    case: 'dashboard-baseline',
    id: 'kpi-values-pulse',
    kind: 'defect',
    title: 'KPI values pulse forever, even with reduced motion',
    symptom: 'The four KPI values fade in and out continuously, and keep doing so when the user has asked the system for reduced motion.',
    measure: 'Rendered Style Vocabulary: animations under reduced motion',
    where: { viewports: ['desktop'] },
    severity: 'minor',
    css: '@keyframes dj-pulse { 50% { opacity: 0.55; } } .kpi__value { animation: dj-pulse 1.4s ease-in-out infinite; }',
  },
  {
    case: 'dashboard-baseline',
    id: 'odd-kpi-card',
    kind: 'defect',
    title: 'One KPI card styled differently from the others',
    symptom: 'The second KPI card loses its border and gets a deep drop shadow and tighter corners, while the other three are flat bordered cards.',
    measure: 'Peer Visual Consistency',
    where: {},
    severity: 'minor',
    css: '.kpi:nth-child(2) { border-color: transparent; border-radius: 4px; box-shadow: 0 8px 20px rgba(16, 24, 40, 0.18); }',
  },
  {
    case: 'dashboard-baseline',
    id: 'status-badges-low-contrast',
    kind: 'defect',
    title: 'Order status badges in pale text',
    symptom: 'The "Paid" and "Pending" status badges are recoloured to pale green and pale amber text on their tints, about 1.7:1, so order status is hard to read.',
    measure: 'Required Contrast: text below 4.5:1',
    where: {},
    severity: 'moderate',
    css: '.status--paid { color: #93d3ab !important; } .status--pending { color: #f2c27c !important; }',
  },
  {
    case: 'dashboard-baseline',
    id: 'range-and-nav-focus-hidden',
    kind: 'defect',
    title: 'No focus indication on the date range and navigation',
    symptom: 'The date-range buttons and sidebar links have their focus outline removed with no replacement, so keyboard users cannot see where they are.',
    measure: 'Keyboard Focus Visibility',
    where: { viewports: ['desktop'] },
    severity: 'moderate',
    css: '.segmented__btn:focus, .nav__item:focus { outline: none !important; }',
  },
  {
    case: 'dashboard-baseline',
    id: 'harmless-card-elevation',
    kind: 'harmless',
    title: 'All cards get the same soft shadow',
    symptom: 'Every card and KPI card gets one shared, subtle shadow, consistently.',
    measure: 'none',
    where: {},
    severity: 'none',
    css: '.card, .kpi { box-shadow: 0 1px 3px rgba(16, 24, 40, 0.08); }',
  },
  // ---------- booking-clean ----------
  {
    case: 'booking-clean',
    id: 'muted-text-washed-out',
    kind: 'defect',
    title: 'Secondary text washed out to a pale grey',
    symptom: 'The muted text colour is lightened to #a3aab4, so the treatment durations and descriptions, the section hints, the date-picker range and the summary labels read at about 2.4:1 against white.',
    measure: 'Required Contrast: text below 4.5:1',
    where: {},
    severity: 'moderate',
    css: ':root { --muted: #a3aab4; }',
  },
  {
    case: 'booking-clean',
    id: 'slots-look-unavailable',
    kind: 'defect',
    title: 'Every third time slot looks unavailable',
    symptom: 'Every third time slot is drawn with a grey fill, a dashed border and its time struck through, the way unavailable options usually look, although it can be booked like the rest, so a third of the open times appear taken.',
    measure: 'Peer Visual Consistency',
    where: {},
    severity: 'moderate',
    css: '.slot:nth-child(3n):not(.is-selected) { background: #f1f3f5; border-style: dashed; color: var(--muted); text-decoration: line-through; }',
  },
  {
    case: 'booking-clean',
    id: 'focus-ring-removed',
    kind: 'defect',
    title: 'Keyboard focus ring removed from every control',
    symptom: 'A reset rule removes the outline from focused treatments, practitioners, dates, times, fields and buttons and puts nothing in its place, so a keyboard user cannot see where they are in the form.',
    measure: 'Keyboard Focus Visibility',
    where: { viewports: ['desktop'] },
    severity: 'severe',
    css: ':focus, :focus-visible, .chip:has(input:focus-visible) { outline: none !important; box-shadow: none !important; }',
  },
  {
    case: 'booking-clean',
    id: 'harmless-retheme-blue',
    kind: 'harmless',
    title: 'Brand colour changed to blue',
    symptom: 'The primary colour, its hover shade and its tint change from teal to blue through the theme variables, consistently everywhere.',
    measure: 'none',
    where: {},
    severity: 'none',
    css: ':root { --primary: #1d4ed8; --primary-hover: #1e40af; --primary-tint: #eef2ff; }',
  },
  // ---------- carsearch-clean ----------
  {
    case: 'carsearch-clean',
    id: 'price-ratings-washed-out',
    kind: 'defect',
    title: 'Price ratings drawn in pale text on pale tints',
    symptom: 'The "Great price" and "Good price" ratings and their "£… below average" text are recoloured to pale green and pale blue, about 1.8–2.2:1, so whether a car is a good deal is hard to read.',
    measure: 'Required Contrast: text below 4.5:1',
    where: {},
    severity: 'moderate',
    css: '.car__rating--great { color: #8fd0a6; } .car__rating--good { color: #9ab8f0; }',
  },
  {
    case: 'carsearch-clean',
    id: 'cards-look-sold',
    kind: 'defect',
    title: 'Every third car card looks greyed out',
    symptom: 'Every third car card gets a grey fill, a dashed grey border and tight corners, the way sold or unavailable listings usually look, while the others stay white with rounded corners, so a third of the results appear not for sale.',
    measure: 'Peer Visual Consistency',
    where: {},
    severity: 'moderate',
    css: '.car:nth-child(3n) { background: #eef0f3; border: 1px dashed #9aa3b0; border-radius: 3px; }',
  },
  {
    case: 'carsearch-clean',
    id: 'search-fields-unnamed',
    kind: 'defect',
    title: 'Search and filter fields lose their names',
    symptom: 'The text above "Postcode", "Distance", "Minimum", "Maximum" and "Sort by" looks the same but is plain text rather than a label, so the fields and dropdowns have no accessible name: a screen reader announces each as an unnamed field, and clicking the text no longer focuses it.',
    measure: 'Automated Accessibility Violations: label, select-name',
    where: {},
    severity: 'moderate',
    js: onRender(`document.querySelectorAll('label[for="postcode"], label[for="distance"], label[for="min-price"], label[for="max-price"], label[for="sort"]').forEach((l) => {
  const s = document.createElement('span');
  s.className = 'dj-label';
  s.innerHTML = l.innerHTML;
  l.replaceWith(s);
});`),
    css: '.dj-label { color: var(--muted); }',
  },
  {
    case: 'carsearch-clean',
    id: 'harmless-rounder-cards',
    kind: 'harmless',
    title: 'Car cards get larger rounded corners',
    symptom: 'Every car card gets 16 px corners instead of 12 px, consistently.',
    measure: 'none',
    where: {},
    severity: 'none',
    css: '.car { border-radius: 16px; }',
  },
  // ---------- dashboard-clean ----------
  {
    case: 'dashboard-clean',
    id: 'gains-and-losses-pale',
    kind: 'defect',
    title: 'Gains, losses and "Delivered" drawn in pale text',
    symptom: 'The up and down colours are lightened to pale green and pale red, so every KPI change ("▲ 12.4%"), the revenue comparison and the "Delivered" badges read at about 2:1, and whether sales rose or fell is hard to make out.',
    measure: 'Required Contrast: text below 4.5:1',
    where: {},
    severity: 'moderate',
    css: ':root { --up: #86c79f; --down: #ec9d97; }',
  },
  {
    case: 'dashboard-clean',
    id: 'minor-odd-kpi-card-inverted',
    kind: 'defect',
    title: 'One metric card inverted to a dark fill',
    symptom: 'The "Average order value" card is drawn as a dark, borderless, shadowed tile with pill-like corners while the other metric cards stay light and bordered, so it reads as an alert or the most important figure although it is an ordinary metric.',
    measure: 'Peer Visual Consistency',
    where: {},
    severity: 'minor',
    css: '.kpi:nth-child(2) { background: #1b1d21; border-color: transparent; border-radius: 24px; box-shadow: 0 10px 24px rgba(16, 24, 40, 0.28); } .kpi:nth-child(2) .kpi__label, .kpi:nth-child(2) .kpi__value { color: #f5f5f2; }',
  },
  {
    case: 'dashboard-clean',
    id: 'range-and-order-focus-hidden',
    kind: 'defect',
    title: 'No focus indication on the date range and orders',
    symptom: 'The date-range buttons and the order links have their focus outline removed with no replacement, so a keyboard user cannot see which range or order they are on.',
    measure: 'Keyboard Focus Visibility',
    where: { viewports: ['desktop'] },
    severity: 'moderate',
    css: '.segmented__btn:focus, .segmented__btn:focus-visible, .order-link:focus, .order-link:focus-visible { outline: none !important; box-shadow: none !important; }',
  },
  {
    case: 'dashboard-clean',
    id: 'harmless-card-elevation',
    kind: 'harmless',
    title: 'All cards get the same soft shadow',
    symptom: 'Every card and KPI card gets one shared, subtle shadow, consistently.',
    measure: 'none',
    where: {},
    severity: 'none',
    css: '.card, .kpi { box-shadow: 0 1px 3px rgba(16, 24, 40, 0.08); }',
  },
];

const byCase = new Map();
for (const it of items) byCase.set(it.case, [...(byCase.get(it.case) ?? []), it]);
for (const [caseId, list] of byCase) {
  const dir = path.join(ROOT, caseId);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) fs.rmSync(path.join(dir, f));
  for (const it of list) {
    const { measure: _m, ...out } = it;
    fs.writeFileSync(path.join(dir, `${it.id}.json`), `${JSON.stringify({ css: null, js: null, ...out }, null, 2)}\n`);
  }
}
const table = items.map((it) => `| ${it.case} | ${it.id} | ${it.kind} | ${it.severity} | ${it.title} | ${it.measure} |`).join('\n');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/<!-- table -->[\s\S]*<!-- \/table -->/, `<!-- table -->\n| Case | Id | Kind | Severity | What it changes | Evidence that should move |\n| --- | --- | --- | --- | --- | --- |\n${table}\n<!-- /table -->`);
fs.writeFileSync(path.join(ROOT, 'README.md'), readme);
console.log(`${items.length} items written`);
