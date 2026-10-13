// Writes every planted Functionality item to mutations-functionality/<case>/<id>.json and
// regenerates the README's table. Usage: node mutations-functionality/_tools/build.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// Re-applies a change after every render (the cases redraw with innerHTML).
const onRender = (body) => `const apply = () => { ${body} };
const mo = new MutationObserver(() => { mo.disconnect(); apply(); mo.observe(document.body, { childList: true, subtree: true, attributes: true }); });
apply();
mo.observe(document.body, { childList: true, subtree: true, attributes: true });`;

// A listener on the document in the capture phase runs before the case's own listeners on #app.
const intercept = (type, selector, body) => `document.addEventListener('${type}', (e) => {
  const el = e.target.closest && e.target.closest(${JSON.stringify(selector)});
  if (!el) return;
  ${body}
}, true);`;

const items = [
  // ---------- booking-baseline ----------
  {
    case: 'booking-baseline',
    id: 'confirm-swallowed',
    kind: 'defect',
    title: 'Confirm booking does nothing',
    symptom: 'Pressing "Confirm booking" (in the summary or the phone action bar) does nothing at all: no validation messages for an incomplete form and no confirmation for a complete one, so the booking can never be made.',
    measure: 'No-Effect Action Controls; Form Submission Response',
    where: {},
    severity: 'severe',
    js: `document.addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);`,
  },
  {
    case: 'booking-baseline',
    id: 'silent-validation',
    kind: 'defect',
    title: 'Incomplete bookings are silently ignored',
    symptom: 'Pressing "Confirm booking" with required details missing does nothing: no error summary and no field messages, so the user cannot tell why nothing happened. A complete booking still confirms.',
    measure: 'Invalid Submission Feedback',
    where: { interaction: 'Press "Confirm booking" with the form empty' },
    severity: 'moderate',
    js: `document.addEventListener('submit', (e) => {
  const missing = !document.querySelector('.option-card.is-selected') || !document.querySelector('.slot.is-selected') || !document.getElementById('name')?.value.trim() || !document.getElementById('email')?.value.includes('@');
  if (missing) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);`,
  },
  {
    case: 'booking-baseline',
    id: 'date-chips-dead',
    kind: 'defect',
    title: 'Dates cannot be changed',
    symptom: 'Clicking another date in the date strip does nothing: the first date stays selected and its times stay listed, so only appointments on that day can be booked.',
    measure: 'Toggle / Selection State',
    where: {},
    severity: 'severe',
    js: intercept('click', '[data-date]', 'e.stopPropagation();'),
  },
  {
    case: 'booking-baseline',
    id: 'phone-field-rejects-input',
    kind: 'defect',
    title: 'Phone field rejects every character',
    symptom: 'An over-strict input mask strips every character typed into the Phone field, so it stays empty whatever the user types.',
    measure: 'Editable Control Response',
    where: {},
    severity: 'moderate',
    js: `document.addEventListener('input', (e) => { if (e.target.id === 'phone') e.target.value = e.target.value.replace(/[^+]/g, ''); }, true);`,
  },
  {
    case: 'booking-baseline',
    id: 'error-links-broken',
    kind: 'defect',
    title: 'Error summary links point nowhere',
    symptom: 'After a failed submission, the links in the error summary ("Choose a treatment", "Enter your full name", …) point at IDs that do not exist on the page, so clicking them does not take the user to the problem.',
    measure: 'Internal Navigation Integrity',
    where: { interaction: 'Press "Confirm booking" with the form empty, then click a link in the error summary' },
    severity: 'minor',
    js: onRender(`document.querySelectorAll('.error-summary a[href^="#"]').forEach((a) => { if (!a.getAttribute('href').startsWith('#step-')) a.setAttribute('href', '#step-' + a.getAttribute('href').slice(1)); });`),
  },
  {
    case: 'booking-baseline',
    id: 'slot-click-throws',
    kind: 'defect',
    title: 'Choosing a time raises a script error',
    symptom: 'Every click on a time slot raises an uncaught script error (a tracking call to a function that does not exist). The slot is still selected, but the error is a sign of broken code on the main path.',
    measure: 'Runtime Errors',
    where: {},
    severity: 'minor',
    js: intercept('click', '[data-slot]', 'window.djTrackSlot(el.dataset.slot);'),
  },
  {
    case: 'booking-baseline',
    id: 'harmless-retheme-blue',
    kind: 'harmless',
    title: 'Brand colour changed to blue',
    symptom: 'The primary colour, its hover shade and its tint change from teal to blue. Nothing about behaviour changes.',
    measure: 'none',
    where: {},
    severity: 'none',
    css: ':root { --primary: #1d4ed8; --primary-hover: #1e40af; --primary-tint: #eef2ff; }',
  },
  {
    case: 'booking-baseline',
    id: 'harmless-notes-counter',
    kind: 'harmless',
    title: 'Character counter under the notes field',
    symptom: 'A "0 / 500 characters" counter appears under "Anything we should know?" and counts as the user types.',
    measure: 'none',
    where: {},
    severity: 'none',
    js: `${onRender(`const ta = document.getElementById('notes');
if (ta && !document.getElementById('notes-count')) { const p = document.createElement('p'); p.id = 'notes-count'; p.className = 'optional'; p.textContent = ta.value.length + ' / 500 characters'; ta.after(p); }`)}
document.addEventListener('input', (e) => { if (e.target.id === 'notes') { const p = document.getElementById('notes-count'); if (p) p.textContent = e.target.value.length + ' / 500 characters'; } });`,
  },
  // ---------- carsearch-baseline ----------
  {
    case: 'carsearch-baseline',
    id: 'filters-button-dead',
    kind: 'defect',
    title: 'Filters button does nothing on phones',
    symptom: 'On phones the "Filters" button no longer opens the filter drawer, so a phone user cannot filter the results at all.',
    measure: 'No-Effect Action Controls',
    where: { viewports: ['phone'], widths: [320, 767] },
    severity: 'severe',
    js: intercept('click', '[data-action="open-filters"]', 'e.stopPropagation();'),
  },
  {
    case: 'carsearch-baseline',
    id: 'compare-unticks',
    kind: 'defect',
    title: 'Compare boxes untick themselves',
    symptom: 'Ticking "Compare" on a car unticks it again straight away, so cars can never be added to the comparison.',
    measure: 'Toggle / Selection State',
    where: {},
    severity: 'moderate',
    js: `document.addEventListener('change', (e) => { if (e.target.matches && e.target.matches('[data-compare]')) { e.stopImmediatePropagation(); e.target.checked = false; } }, true);`,
  },
  {
    case: 'carsearch-baseline',
    id: 'clear-all-throws',
    kind: 'defect',
    title: '"Clear all" crashes instead of clearing',
    symptom: '"Clear all" in the filters raises a script error and leaves every filter in place.',
    measure: 'No-Effect Action Controls; Runtime Errors',
    where: {},
    severity: 'moderate',
    js: intercept('click', '[data-action="clear"]', "e.stopPropagation(); throw new TypeError('Cannot read properties of undefined (reading \\'reset\\')');"),
  },
  {
    case: 'carsearch-baseline',
    id: 'filter-chip-remove-dead',
    kind: 'defect',
    title: 'Active filter chips cannot be removed',
    symptom: 'Clicking the ✕ on an active filter chip does nothing, so a filter can only be removed from the filter panel.',
    measure: 'No-Effect Action Controls',
    where: { interaction: 'Apply a filter, then click the ✕ on its chip' },
    severity: 'moderate',
    js: intercept('click', '[data-remove]', 'e.stopPropagation();'),
  },
  {
    case: 'carsearch-baseline',
    id: 'harmless-save-works',
    kind: 'harmless',
    title: 'Save buttons toggle a saved state',
    symptom: 'The heart buttons on the car cards now toggle: a click fills the heart and marks the button pressed.',
    measure: 'none (fixes an existing failure)',
    where: {},
    severity: 'none',
    js: `document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.save');
  if (!b) return;
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? '♥' : '♡';
}, true);`,
  },
  // ---------- dashboard-baseline ----------
  {
    case: 'dashboard-baseline',
    id: 'range-state-not-exposed',
    kind: 'defect',
    title: 'Date range selection not exposed',
    symptom: 'Choosing another date range highlights it, but its radio state stays on "7 days", so assistive technology and anything reading the control state report the wrong range.',
    measure: 'Toggle / Selection State',
    where: {},
    severity: 'minor',
    js: onRender(`document.querySelectorAll('.segmented__btn[role="radio"]').forEach((b, i) => { const want = i === 0 ? 'true' : 'false'; if (b.getAttribute('aria-checked') !== want) b.setAttribute('aria-checked', want); });`),
  },
  {
    case: 'dashboard-baseline',
    id: 'order-panel-cannot-close',
    kind: 'defect',
    title: 'Order panel cannot be closed',
    symptom: 'Once an order is opened, neither its Close button nor the backdrop closes the panel, leaving the user stuck on that order.',
    measure: 'No-Effect Action Controls',
    where: { interaction: 'Click an order in "Recent orders", then try to close the panel' },
    severity: 'severe',
    js: intercept('click', '[data-action="close-order"]', 'e.stopPropagation();'),
  },
  {
    case: 'dashboard-baseline',
    id: 'menu-button-blocked',
    kind: 'defect',
    title: 'Invisible layer blocks the menu button',
    symptom: 'A transparent element left in the top-left corner sits over the menu (hamburger) button on phones and tablets, so taps on it never reach the button and the navigation cannot be opened.',
    measure: 'Interactive Control Operability',
    where: { viewports: ['tablet', 'phone'], widths: [320, 1023] },
    severity: 'severe',
    js: `const d = document.createElement('div'); d.className = 'tour-anchor'; d.style.cssText = 'position:fixed;top:0;left:0;width:72px;height:72px;z-index:1000'; document.body.append(d);`,
  },
  {
    case: 'dashboard-baseline',
    id: 'view-all-orders-404',
    kind: 'defect',
    title: '"View all orders" opens a missing page',
    symptom: 'The "View all orders" link points at orders.html, which does not exist, so it opens a "not found" page.',
    measure: 'Internal Navigation Integrity',
    where: {},
    severity: 'moderate',
    js: onRender(`document.querySelectorAll('.orders-card .card__head a').forEach((a) => { if (a.getAttribute('href') !== 'orders.html') a.setAttribute('href', 'orders.html'); });`),
  },
  {
    case: 'dashboard-baseline',
    id: 'harmless-export-toast',
    kind: 'harmless',
    title: 'Export shows a confirmation',
    symptom: 'Clicking "Export" shows a small "Export started" message at the bottom of the screen.',
    measure: 'none (fixes an existing failure)',
    where: {},
    severity: 'none',
    js: `document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('button');
  if (!b || b.textContent.trim() !== 'Export') return;
  let t = document.getElementById('export-toast');
  if (!t) { t = document.createElement('div'); t.id = 'export-toast'; t.setAttribute('role', 'status'); t.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:8px 14px;border-radius:8px'; document.body.append(t); }
  t.textContent = 'Export started';
});`,
  },
  {
    case: 'dashboard-baseline',
    id: 'harmless-accent-teal',
    kind: 'harmless',
    title: 'Accent colour changed to teal',
    symptom: 'The accent colour and its tint change from orange to teal. Nothing about behaviour changes.',
    measure: 'none',
    where: {},
    severity: 'none',
    css: ':root { --accent: #0f766e; --accent-soft: #e6f4f1; }',
  },
  // ---------- booking-clean ----------
  {
    case: 'booking-clean',
    id: 'confirm-swallowed',
    kind: 'defect',
    title: 'Confirm booking does nothing',
    symptom: 'Pressing "Confirm booking" does nothing at all: no messages for an incomplete form and no confirmation for a complete one, so the booking can never be made.',
    measure: 'No-Effect Action Controls; Form Submission Response',
    where: {},
    severity: 'severe',
    js: `document.addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);`,
  },
  {
    case: 'booking-clean',
    id: 'email-field-cleared',
    kind: 'defect',
    title: 'Email field empties when the user moves on',
    symptom: 'Whatever is typed into "Email" is wiped as soon as the user moves to the next field, so a booking can only be confirmed by typing the email again as the very last thing.',
    measure: 'Editable Control Response',
    where: {},
    severity: 'moderate',
    js: `document.addEventListener('change', (e) => { if (e.target.id === 'email') { e.target.value = ''; e.target.dispatchEvent(new Event('input', { bubbles: true })); } }, true);`,
  },
  {
    case: 'booking-clean',
    id: 'silent-validation',
    kind: 'defect',
    title: 'Incomplete bookings are silently ignored',
    symptom: 'Pressing "Confirm booking" with required details missing does nothing: no error summary and no field messages, so the user cannot tell why nothing happened. A complete booking still confirms.',
    measure: 'Invalid Submission Feedback',
    where: { interaction: 'Press "Confirm booking" with the form empty' },
    severity: 'moderate',
    js: `document.addEventListener('submit', (e) => {
  const missing = !document.querySelector('.option.is-selected') || !document.querySelector('.slot.is-selected') || !document.getElementById('name')?.value.trim() || !document.getElementById('email')?.value.includes('@');
  if (missing) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);`,
  },
  {
    case: 'booking-clean',
    id: 'harmless-notes-counter',
    kind: 'harmless',
    title: 'Character counter under the notes field',
    symptom: 'A "0 / 500 characters" counter appears under "Anything we should know?" and counts as the user types.',
    measure: 'none',
    where: {},
    severity: 'none',
    js: `${onRender(`const ta = document.getElementById('notes');
if (ta && !document.getElementById('notes-count')) { const p = document.createElement('p'); p.id = 'notes-count'; p.className = 'field-hint'; p.textContent = ta.value.length + ' / 500 characters'; ta.after(p); }`)}
document.addEventListener('input', (e) => { if (e.target.id === 'notes') { const p = document.getElementById('notes-count'); if (p) p.textContent = e.target.value.length + ' / 500 characters'; } });`,
  },
  // ---------- carsearch-clean ----------
  {
    case: 'carsearch-clean',
    id: 'filters-button-dead',
    kind: 'defect',
    title: 'Filters button does nothing on phones',
    symptom: 'On phones and tablets the "Filters" button no longer opens the filter drawer, so the results cannot be narrowed by price, make, mileage or fuel at all.',
    measure: 'No-Effect Action Controls',
    where: { viewports: ['tablet', 'phone'], widths: [320, 1023] },
    severity: 'severe',
    js: intercept('click', '[data-action="open-filters"]', 'e.stopPropagation();'),
  },
  {
    case: 'carsearch-clean',
    id: 'make-filter-ignored',
    kind: 'defect',
    title: 'Ticking a make does not filter the results',
    symptom: 'Ticking a make (for example "Audi") ticks the box, but the results, the count in the heading and the active-filter chips stay as they were, so the list shows every make while the filter says only one is wanted.',
    measure: 'none (judged from the screenshots)',
    where: { interaction: 'Tick a make in the filters' },
    severity: 'severe',
    js: `document.addEventListener('change', (e) => { if (e.target.matches && e.target.matches('[data-make]')) e.stopImmediatePropagation(); }, true);`,
  },
  {
    case: 'carsearch-clean',
    id: 'search-throws',
    kind: 'defect',
    title: 'Search fails with a script error and no message',
    symptom: 'Pressing "Search" after changing the postcode or distance raises a script error: the results stay as they were and nothing tells the user that the search failed or what to do.',
    measure: 'Runtime Errors; Form Submission Response',
    where: {},
    severity: 'moderate',
    js: `document.addEventListener('submit', (e) => { if (e.target.id !== 'location-form') return; e.preventDefault(); e.stopImmediatePropagation(); throw new TypeError("Cannot read properties of undefined (reading 'lat')"); }, true);`,
  },
  {
    case: 'carsearch-clean',
    id: 'harmless-retheme-green',
    kind: 'harmless',
    title: 'Primary colour changed to green',
    symptom: 'The primary colour, its hover shade and its tint change from blue to green. Nothing about behaviour changes.',
    measure: 'none',
    where: {},
    severity: 'none',
    css: ':root { --primary: #15803d; --primary-hover: #166534; --primary-soft: #e8f5ec; }',
  },
  // ---------- dashboard-clean ----------
  {
    case: 'dashboard-clean',
    id: 'range-buttons-dead',
    kind: 'defect',
    title: 'Date range cannot be changed',
    symptom: 'Clicking "30 days" or another range does nothing: the selected range, the figures, the chart and the lists stay on the first range, so no other period can be reviewed.',
    measure: 'No-Effect Action Controls; Toggle / Selection State',
    where: {},
    severity: 'severe',
    js: intercept('click', '[data-range]', 'e.stopPropagation();'),
  },
  {
    case: 'dashboard-clean',
    id: 'order-panel-cannot-close',
    kind: 'defect',
    title: 'Order panel cannot be closed',
    symptom: 'Once an order is opened, neither its Close button, the backdrop nor Escape closes the panel, leaving the user stuck on that order.',
    measure: 'No-Effect Action Controls',
    where: { interaction: 'Click an order in "Recent orders", then try to close the panel' },
    severity: 'severe',
    js: `document.addEventListener('click', (e) => { if ((e.target.closest && e.target.closest('[data-action="close-order"]')) || e.target.id === 'order-dialog') e.stopPropagation(); }, true);
document.getElementById('order-dialog').addEventListener('cancel', (e) => e.preventDefault());`,
  },
  {
    case: 'dashboard-clean',
    id: 'wrong-order-opens',
    kind: 'defect',
    title: 'Clicking an order opens the next one',
    symptom: 'Clicking an order in "Recent orders" opens the details of the order below it (clicking #1482 shows #1481, with another customer and time), so the panel never shows the order that was chosen.',
    measure: 'none (judged from the screenshots)',
    where: { interaction: 'Click an order in "Recent orders"' },
    severity: 'severe',
    js: onRender(`const rows = [...document.querySelectorAll('tr.order-row')];
rows.forEach((tr, i) => {
  if (tr.dataset.djShifted) return;
  const next = String((i + 1) % rows.length);
  tr.dataset.djShifted = '1';
  tr.dataset.order = next;
  tr.querySelectorAll('[data-order]').forEach((b) => { b.dataset.order = next; });
});`),
  },
  {
    case: 'dashboard-clean',
    id: 'harmless-accent-teal',
    kind: 'harmless',
    title: 'Accent colour changed to teal',
    symptom: 'The accent colour, its hover shade and its tint change from orange to teal. Nothing about behaviour changes.',
    measure: 'none',
    where: {},
    severity: 'none',
    css: ':root { --accent: #0f766e; --accent-strong: #115e59; --accent-soft: #e6f4f1; }',
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
