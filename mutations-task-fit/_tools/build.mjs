// Writes every planted Task Fit item to mutations-task-fit/<case>/<id>.json and regenerates the
// README's table. Usage: node mutations-task-fit/_tools/build.mjs

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

// Replaces the text of matching elements whose whole text is a key of the map.
const retext = (selector, map) => `document.querySelectorAll(${JSON.stringify(selector)}).forEach((el) => { const to = ${JSON.stringify(map)}[el.textContent.trim()]; if (to !== undefined && el.textContent !== to) el.textContent = to; });`;

const items = [
  // ---------- booking-clean ----------
  {
    case: 'booking-clean',
    id: 'no-practitioner-step',
    kind: 'defect',
    criterion: 'B',
    title: 'No way to pick a practitioner',
    symptom: 'The practitioner step is gone: the form runs Treatment, Date and time, Your details (numbered 1 to 3), times are shown for any practitioner, and the summary no longer mentions one. The request explicitly asks for patients to pick a practitioner.',
    where: {},
    severity: 'severe',
    css: '#section-practitioner { display: none !important; }',
    js: onRender(`document.querySelectorAll('.form-section:not(#section-practitioner) .step').forEach((s, i) => { if (s.textContent !== String(i + 1)) s.textContent = String(i + 1); });
${retext('#section-time .hint', { 'Showing times with any available practitioner.': 'Showing all available times.' })}
document.querySelectorAll('.summary__row').forEach((r) => { if (r.querySelector('dt')?.textContent.trim() === 'Practitioner') r.remove(); });`),
  },
  {
    case: 'booking-clean',
    id: 'callback-instead-of-times',
    kind: 'defect',
    criterion: 'A',
    title: 'Call-back request instead of choosing a time',
    symptom: 'Step 3 no longer shows dates and times. It asks "When can we call you?" with four call-back windows and says the clinic will phone within two working days to arrange the appointment, so the patient cannot see or choose an available time on the page, as the request asks.',
    where: {},
    severity: 'severe',
    css: `.callback__label { font-weight: 600; margin-bottom: 12px; }
.callback .chip:has(input:checked) { border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary); background: var(--primary-tint); color: var(--primary-hover); }`,
    js: onRender(`const sec = document.getElementById('section-time');
if (sec && !sec.querySelector('.callback')) {
  sec.querySelectorAll('.date-picker, .slot-group, .empty-state').forEach((el) => el.remove());
  const h = sec.querySelector('#h-time'); if (h) h.textContent = 'When can we call you?';
  const hint = sec.querySelector('.hint'); if (hint) hint.textContent = 'We will phone you within two working days to arrange your appointment.';
  const box = document.createElement('div');
  box.className = 'callback';
  box.innerHTML = '<p class="callback__label">Best time to call</p><div class="chip-row">' + ['Weekday mornings', 'Weekday afternoons', 'Evenings after 5pm', 'Saturdays'].map((l) => '<label class="chip"><input type="checkbox" class="visually-hidden" />' + l + '</label>').join('') + '</div>';
  sec.append(box);
}
document.querySelectorAll('.error-summary a[href="#section-time"], #time-error').forEach((el) => { if (el.textContent !== 'Choose when we can call you') el.textContent = 'Choose when we can call you'; });
document.querySelectorAll('.summary__row').forEach((r) => {
  const dt = r.querySelector('dt'); const label = dt?.textContent.trim();
  if (label === 'Time') r.remove();
  if (label === 'Date') { dt.textContent = 'Date and time'; const dd = r.querySelector('dd'); if (dd.textContent !== 'Arranged by phone') { dd.textContent = 'Arranged by phone'; dd.className = 'is-empty'; } }
});`),
  },
  {
    case: 'booking-clean',
    id: 'pet-details-fields',
    kind: 'defect',
    criterion: 'D',
    title: "Patient details ask about the patient's pet",
    symptom: 'The "Your details" step asks for the pet\'s name, species (dog, cat, rabbit, other) and breed, and the notes hint asks about "your pet\'s symptoms or vaccination history": fields from a vet clinic\'s form on a physiotherapy booking page.',
    where: {},
    severity: 'moderate',
    css: '.field select { width: 100%; min-height: 48px; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); font: inherit; color: inherit; }',
    js: onRender(`const phone = document.getElementById('field-phone');
if (phone && !document.getElementById('field-pet-name')) {
  phone.insertAdjacentHTML('afterend', '<div class="field" id="field-pet-name"><label for="pet-name">Pet\\'s name</label><input id="pet-name" name="pet-name" /></div><div class="field" id="field-species"><label for="species">Species</label><select id="species" name="species"><option>Dog</option><option>Cat</option><option>Rabbit</option><option>Other</option></select></div><div class="field" id="field-breed"><label for="breed">Breed <span class="optional">(optional)</span></label><input id="breed" name="breed" /></div>');
}
${retext('#notes-hint', { 'For example, the injury or pain you would like treated.': "For example, your pet's symptoms or vaccination history." })}`),
  },
  {
    case: 'booking-clean',
    id: 'harmless-reworded-hints',
    kind: 'harmless',
    criterion: '',
    title: 'Hints reworded',
    symptom: 'The four hint lines say the same things in other words, for example "If you\'re not sure which to choose, book an initial assessment."',
    where: {},
    severity: 'none',
    js: onRender(retext('.hint, .field-hint', {
      'Not sure which to choose? Book an initial assessment.': "If you're not sure which to choose, book an initial assessment.",
      'Choose Any available to see every open time.': 'Pick Any available to see all open times.',
      'We will email your booking confirmation.': "We'll email you to confirm your booking.",
      'For example, the injury or pain you would like treated.': "For example, the injury or pain you'd like us to treat.",
    })),
  },
  // ---------- carsearch-clean ----------
  {
    case: 'carsearch-clean',
    id: 'no-mileage-fuel-filters',
    kind: 'defect',
    criterion: 'B',
    title: 'No mileage or fuel type filters',
    symptom: 'The filter panel (and the phone filter drawer) offers only Price and Make. The Mileage and Fuel type filters the request names are missing.',
    where: {},
    severity: 'severe',
    css: '.fgroup[aria-labelledby="fg-mileage"], .fgroup[aria-labelledby="fg-fuel"] { display: none !important; }',
  },
  {
    case: 'carsearch-clean',
    id: 'sell-finance-insurance-panels',
    kind: 'defect',
    criterion: 'C',
    title: 'Sell, finance, insurance and warranty panels above the results',
    symptom: 'Four unrequested panels sit between the search and the results: "Sell your car" with a valuation form, "Car finance" with an eligibility check, "Car insurance" quotes and "Extended warranty". They push the listings down, most of the first screen on a phone.',
    where: {},
    severity: 'moderate',
    css: `.extras { flex-basis: 100%; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.extras__card { display: flex; flex-direction: column; gap: 10px; padding: 20px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.extras__card h2 { font-size: var(--text-base); font-weight: 600; }
.extras__card p { color: var(--muted); }
.extras__row { display: flex; gap: 8px; }
.extras__row input { min-width: 0; flex: 1; }
.extras__card .btn { align-self: flex-start; }
@media (max-width: 1279px) { .extras { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 767px) { .extras { grid-template-columns: minmax(0, 1fr); } }`,
    js: onRender(`const head = document.querySelector('.page__head');
if (head && !head.querySelector('.extras')) {
  head.insertAdjacentHTML('beforeend', '<section class="extras" aria-label="More from Motorwise">'
    + '<div class="extras__card"><h2>Sell your car</h2><p>Get a free instant valuation and sell within 24 hours.</p><div class="extras__row"><input aria-label="Registration" placeholder="Registration" /><input aria-label="Mileage" placeholder="Mileage" /></div><button type="button" class="btn btn--primary">Value my car</button></div>'
    + '<div class="extras__card"><h2>Car finance</h2><p>See how much you could borrow before you choose a car.</p><button type="button" class="btn btn--secondary">Check my eligibility</button></div>'
    + '<div class="extras__card"><h2>Car insurance</h2><p>Compare quotes from over 40 insurers in minutes.</p><button type="button" class="btn btn--secondary">Get a quote</button></div>'
    + '<div class="extras__card"><h2>Extended warranty</h2><p>Cover repairs for up to three years after you buy.</p><button type="button" class="btn btn--secondary">Add a warranty</button></div>'
    + '</section>');
}`),
  },
  {
    case: 'carsearch-clean',
    id: 'shop-basket-actions',
    kind: 'defect',
    criterion: 'D',
    title: 'Used cars sold like basket items',
    symptom: 'Every car has an "Add to basket" button and an "In stock · Free delivery in 3–5 days" line, the header shows "Basket (0)" and the results heading counts "products": an online shop\'s vocabulary and actions, not those of buying a used car from a seller (viewing, contacting the seller, test drives).',
    where: {},
    severity: 'moderate',
    css: `.basket { margin-left: auto; font-weight: 600; color: var(--primary); text-decoration: none; }
.basket-btn { min-height: 36px; padding: 6px 14px; }`,
    js: onRender(`document.querySelectorAll('.car__foot').forEach((f) => { if (!f.querySelector('.basket-btn')) f.insertAdjacentHTML('beforeend', '<button type="button" class="btn btn--primary basket-btn">Add to basket</button>'); });
document.querySelectorAll('.specs').forEach((s) => { if (!s.querySelector('.stock')) s.insertAdjacentHTML('beforeend', '<li class="stock">In stock · Free delivery in 3–5 days</li>'); });
const inner = document.querySelector('.site-header__inner');
if (inner && !inner.querySelector('.basket')) inner.insertAdjacentHTML('beforeend', '<a class="basket" href="#basket">Basket (0)</a>');
const h = document.getElementById('h-results');
if (h && / cars? /.test(h.textContent)) h.textContent = h.textContent.replace(/ cars? /, (m) => (m === ' car ' ? ' product ' : ' products '));`),
  },
  {
    case: 'carsearch-clean',
    id: 'harmless-retheme-green',
    kind: 'harmless',
    criterion: '',
    title: 'Primary colour changed to green',
    symptom: 'The primary colour, its hover shade and its tint change from blue to green. Nothing else changes.',
    where: {},
    severity: 'none',
    css: ':root { --primary: #0f7a4a; --primary-hover: #0b603a; --primary-soft: #e3f4ec; --good: #0f7a4a; }',
  },
  // ---------- dashboard-clean ----------
  {
    case: 'dashboard-clean',
    id: 'no-revenue-trend',
    kind: 'defect',
    criterion: 'B',
    title: 'No revenue trend',
    symptom: 'The revenue card shows only the total and its change. The chart of revenue over time, which the request asks for, is gone.',
    where: {},
    severity: 'severe',
    css: '.hero .chart { display: none !important; } .hero { align-self: start !important; }',
  },
  {
    case: 'dashboard-clean',
    id: 'metrics-typed-in-by-hand',
    kind: 'defect',
    criterion: 'A',
    title: 'Metrics are boxes the owner types into',
    symptom: 'Revenue, orders, average order value and conversion rate are editable text boxes, and a banner says "Type this month\'s figures into the boxes, then save to update your dashboard" with a "Save figures" button: a data-entry form rather than a dashboard that tracks the figures for the owner.',
    where: {},
    severity: 'severe',
    css: `.metric-input { width: 100%; max-width: 300px; padding: 2px 10px; font: inherit; color: inherit; letter-spacing: inherit; background: var(--surface); border: 1px solid #c9c6bd; border-radius: 8px; }
.manual-entry { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 16px; padding: 14px 18px; background: #fff8e6; border: 1px solid #f0dca8; border-radius: 10px; }`,
    js: onRender(`document.querySelectorAll('.hero__value, .kpi__value').forEach((el) => {
  if (el.querySelector('input')) return;
  const label = el.closest('.hero') ? 'Revenue' : el.parentElement.querySelector('.kpi__label')?.textContent ?? '';
  const v = el.textContent.trim();
  el.textContent = '';
  const input = document.createElement('input');
  input.className = 'metric-input';
  input.value = v;
  input.setAttribute('aria-label', label);
  el.append(input);
});
const head = document.querySelector('.page-head');
if (head && !head.querySelector('.manual-entry')) head.insertAdjacentHTML('beforeend', '<div class="manual-entry"><p>Type this month\\'s figures into the boxes, then save to update your dashboard.</p><button type="button" class="btn btn--primary">Save figures</button></div>');`),
  },
  {
    case: 'dashboard-clean',
    id: 'setup-checklist-and-upsells',
    kind: 'defect',
    criterion: 'C',
    title: 'Store set-up checklist and upgrade offer above the metrics',
    symptom: 'A "Finish setting up Oak & Ember" checklist (custom domain, email campaign, loyalty programme, Instagram shop app) and a "Try Oak & Ember Pro free for 14 days" offer fill the top of the page, above the revenue and metrics the owner came to track.',
    where: {},
    severity: 'moderate',
    css: `.setup { flex-basis: 100%; display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; }
.setup__card { padding: 20px 24px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); display: flex; flex-direction: column; gap: 12px; }
.setup__card h2 { font-size: var(--text-md); font-weight: 600; }
.setup__bar { height: 6px; border-radius: 3px; background: #f1efeb; overflow: hidden; }
.setup__bar span { display: block; width: 33%; height: 100%; background: var(--accent); }
.setup__list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 24px; }
.setup__list li { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.setup__list .done { color: var(--muted); text-decoration: line-through; }
.setup__card .btn { align-self: flex-start; }
.setup__list .btn { min-height: 32px; padding: 4px 12px; border: 1px solid var(--border); background: var(--surface); }
@media (max-width: 1023px) { .setup { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 639px) { .setup__list { grid-template-columns: minmax(0, 1fr); } }`,
    js: onRender(`const head = document.querySelector('.page-head');
if (head && !head.querySelector('.setup')) {
  const step = (label, action) => '<li><span class="' + (action ? '' : 'done') + '">' + label + '</span>' + (action ? '<button type="button" class="btn">' + action + '</button>' : '') + '</li>';
  head.insertAdjacentHTML('beforeend', '<section class="setup" aria-label="Set up your store">'
    + '<div class="setup__card"><h2>Finish setting up Oak &amp; Ember</h2><p class="muted">2 of 6 steps complete</p><div class="setup__bar" aria-hidden="true"><span></span></div><ul class="setup__list">'
    + step('Add your first product') + step('Set up payments') + step('Connect a custom domain', 'Connect') + step('Send your first email campaign', 'Create campaign') + step('Start a loyalty programme', 'Set up') + step('Install the Instagram shop app', 'Install')
    + '</ul></div>'
    + '<div class="setup__card"><h2>Try Oak &amp; Ember Pro free for 14 days</h2><p class="muted">AI product descriptions, abandoned-basket emails, gift cards and priority support.</p><button type="button" class="btn btn--primary">Start free trial</button></div>'
    + '</section>');
}`),
  },
  {
    case: 'dashboard-clean',
    id: 'harmless-accent-teal',
    kind: 'harmless',
    criterion: '',
    title: 'Accent colour changed to teal',
    symptom: 'The accent colour, its darker shade and its tint change from orange to teal. Nothing else changes.',
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
    const { criterion: _c, ...out } = it;
    fs.writeFileSync(path.join(dir, `${it.id}.json`), `${JSON.stringify({ css: null, js: null, ...out }, null, 2)}\n`);
  }
}
const table = items.map((it) => `| ${it.case} | ${it.id} | ${it.kind} | ${it.criterion || '–'} | ${it.title} |`).join('\n');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/<!-- table -->[\s\S]*<!-- \/table -->/, `<!-- table -->\n| Case | Id | Kind | Criterion | What it changes |\n| --- | --- | --- | --- | --- |\n${table}\n<!-- /table -->`);
fs.writeFileSync(path.join(ROOT, 'README.md'), readme);
console.log(`${items.length} items written`);
