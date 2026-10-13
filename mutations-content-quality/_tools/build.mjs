// Writes every planted Content Quality item to mutations-content-quality/<case>/<id>.json and
// regenerates the README's table. Usage: node mutations-content-quality/_tools/build.mjs

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
    id: 'vague-error-messages',
    kind: 'defect',
    criterion: 'A',
    title: 'Validation messages say nothing useful',
    symptom: 'After "Confirm booking" with missing details, the summary box is titled "Error" and lists "Field required", "Invalid selection", "Invalid input" and "Error: validation failed", and every message under a field reads "Invalid", so the patient cannot tell what is missing or how to fix it.',
    where: { interaction: 'Press "Confirm booking" with the form empty' },
    severity: 'severe',
    js: onRender(`const t = document.querySelector('.error-summary__title'); if (t && t.textContent !== 'Error') t.textContent = 'Error';
const vague = ['Field required', 'Invalid selection', 'Invalid input', 'Error: validation failed'];
document.querySelectorAll('.error-summary a').forEach((a, i) => { const to = vague[i % vague.length]; if (a.textContent !== to) a.textContent = to; });
document.querySelectorAll('.field-error').forEach((p) => { if (p.textContent !== 'Invalid') p.textContent = 'Invalid'; });`),
  },
  {
    case: 'booking-clean',
    id: 'padded-instructions',
    kind: 'defect',
    criterion: 'B',
    title: 'Every step buried in long, repetitive instructions',
    symptom: 'Three paragraphs of welcome and "how to use this page" text open the form, each step\'s one-line hint becomes a paragraph restating what the step plainly shows ("In this step, please select the treatment that you would like to book from the list of treatments shown below…"), and the summary ends with a note to check the summary.',
    where: {},
    severity: 'moderate',
    css: `.intro-copy { display: grid; gap: 12px; padding: 32px 0 4px; color: var(--muted); }
.summary-note { margin-top: 16px; color: var(--muted); }`,
    js: onRender(`const form = document.getElementById('booking');
if (form && !form.querySelector('.intro-copy')) {
  form.insertAdjacentHTML('afterbegin', '<div class="intro-copy"><p>Welcome to the Harbour Physio online appointment booking system. We are delighted that you have chosen to book your physiotherapy appointment with us online today.</p><p>Booking an appointment online is quick, easy and convenient. Simply follow the steps on this page in order, from the first step to the last step, and then confirm your booking at the end of the process. Each step is numbered so that you always know which step you are on.</p><p>Please note that all of the required fields must be completed before your booking can be confirmed. If you have any questions about the booking process, please do not hesitate to contact our friendly reception team, who will be happy to help you with your booking.</p></div>');
}
${retext('.hint, .field-hint', {
  'Not sure which to choose? Book an initial assessment.': 'In this step, please select the treatment that you would like to book from the list of treatments shown below. Each treatment shows its name, its price and its length in minutes, together with a short description of the treatment. If you are not sure which treatment to choose, we recommend that you choose an initial assessment.',
  'Choose Any available to see every open time.': 'In this step, please choose the practitioner that you would like to see. If you do not mind which practitioner you see, please choose Any available, which will show you all of the available appointment times with all of our practitioners.',
  'Showing times with any available practitioner.': 'In this step, please choose a date and then a time for your appointment. The dates are shown in the date strip below, and the times are shown below the dates, divided into morning times and afternoon times. Times are shown for any available practitioner.',
  'We will email your booking confirmation.': 'In this step, please enter your personal details in the fields below so that we are able to contact you about your appointment. We will send a confirmation of your booking to the email address that you enter below.',
  'For example, the injury or pain you would like treated.': 'Please use this box to tell us anything at all that you think we should know before your appointment, for example the injury or the pain that you would like to have treated at your appointment.',
})}
const card = document.querySelector('.summary__card');
if (card && !card.querySelector('.summary-note')) card.insertAdjacentHTML('beforeend', '<p class="summary-note">Please check that all of the details shown above in this summary of your appointment are correct before you press the button above to confirm your booking.</p>');`),
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
    id: 'broken-car-photos',
    kind: 'defect',
    criterion: 'C',
    title: 'Car photos fail to load',
    symptom: 'Every listing\'s picture is a broken image showing only a file name such as "IMG_2041.jpg", so no car can be recognised from its photo.',
    where: {},
    severity: 'severe',
    css: '.car__media img.car__img { object-fit: contain; background: #eef1f4; color: #586174; }',
    js: onRender(`document.querySelectorAll('.car__media').forEach((m) => {
  if (m.querySelector('img')) return;
  const n = 2040 + Number((m.closest('.car')?.getAttribute('aria-labelledby') ?? '').replace(/\\D/g, '') || 0);
  m.innerHTML = '<img class="car__img" src="photos/IMG_' + n + '.jpg" alt="IMG_' + n + '.jpg" />';
});`),
  },
  {
    case: 'carsearch-clean',
    id: 'price-ratings-contradict',
    kind: 'defect',
    criterion: 'A',
    title: 'Price ratings contradict their own amounts',
    symptom: 'Each rating badge now disagrees with the figure beside it: "Great price · £1,050 above average", "High price · £550 below average", "Good price · £805 above average", while the note above the results still says the ratings compare each car with the average price.',
    where: {},
    severity: 'severe',
    js: onRender(`document.querySelectorAll('.car__rating').forEach((p) => {
  if (p.dataset.flipped || p.classList.contains('car__rating--fair')) return;
  p.dataset.flipped = '1';
  const node = [...p.childNodes].find((n) => n.nodeType === 3 && /(below|above) average/.test(n.textContent));
  if (node) node.textContent = node.textContent.replace(/below|above/, (w) => (w === 'below' ? 'above' : 'below'));
});`),
  },
  {
    case: 'carsearch-clean',
    id: 'inconsistent-names',
    kind: 'defect',
    criterion: 'B',
    title: 'Same things called by different names',
    symptom: 'The Compare checkbox is labelled "Compare", "Shortlist", "Add to comparison" or "Watch" from card to card; the results count "vehicles", the filter drawer shows "listings", the note calls ratings "deal scores" for each "motor", and the filters say "Brand" and "Odometer" where the cards say make names and miles.',
    where: {},
    severity: 'moderate',
    js: onRender(`const names = ['Compare', 'Shortlist', 'Add to comparison', 'Watch'];
document.querySelectorAll('.compare-check > span').forEach((s, i) => { const to = names[i % names.length]; if (s.textContent !== to) s.textContent = to; });
const h = document.getElementById('h-results');
if (h && / cars? /.test(h.textContent)) h.textContent = h.textContent.replace(/ cars? /, (m) => (m === ' car ' ? ' vehicle ' : ' vehicles '));
${retext('#fg-make, #fg-mileage, .results__note', {
  Make: 'Brand',
  Mileage: 'Odometer',
  'Price ratings compare each car with the average price of the same model, age and mileage.': 'Deal scores compare each motor with the average price of the same model, age and mileage.',
})}
document.querySelectorAll('.filters__foot .btn').forEach((b) => { if (/ cars?$/.test(b.textContent)) b.textContent = b.textContent.replace(/ cars?$/, (m) => (m === ' car' ? ' listing' : ' listings')); });`),
  },
  {
    case: 'carsearch-clean',
    id: 'harmless-reworded-note',
    kind: 'harmless',
    criterion: '',
    title: 'Results note and empty-state advice reworded',
    symptom: 'The note above the results and the empty-state advice say the same things in other words ("Each price rating compares the car with the average price of cars of the same model, age and mileage.").',
    where: {},
    severity: 'none',
    js: onRender(retext('.results__note, .empty__body', {
      'Price ratings compare each car with the average price of the same model, age and mileage.': 'Each price rating compares the car with the average price of cars of the same model, age and mileage.',
      'Try a wider distance, or check a different postcode.': 'Try searching a wider distance, or check your postcode.',
      'Remove a filter, or search a wider distance.': 'Remove a filter, or try a wider distance.',
    })),
  },
  // ---------- dashboard-clean ----------
  {
    case: 'dashboard-clean',
    id: 'jargon-labels',
    kind: 'defect',
    criterion: 'A',
    title: 'Metrics and columns labelled in analyst jargon',
    symptom: 'Labels become internal abbreviations: "GMV (gross, pre-refund)", "Txn count", "AOV (μ)", "CVR (sess→ord)", "SKU perf.", "Order log (n=8)", columns "Ord#", "Cust", "Ts", "Qty", "Amt", "Fulfil. stat", statuses "UNFUL" and "FUL/IT", and the period line "MTD vs PMTD", so a store owner has to decode every figure.',
    where: {},
    severity: 'severe',
    js: onRender(`${retext('#h-revenue, .kpi__label, #h-products, #h-orders, .card__sub, .orders__table th, .status, .page-head__sub', {
  Revenue: 'GMV (gross, pre-refund)',
  Orders: 'Txn count',
  'Average order value': 'AOV (μ)',
  'Conversion rate': 'CVR (sess→ord)',
  'Top products': 'SKU perf.',
  'Ranked by revenue': 'Sorted rev desc',
  'Recent orders': 'Order log (n=8)',
  'Select an order to see its items.': 'Click row → line items',
  Order: 'Ord#',
  Customer: 'Cust',
  Date: 'Ts',
  Items: 'Qty',
  Total: 'Amt',
  Status: 'Fulfil. stat',
  'To ship': 'UNFUL',
  Shipped: 'FUL/IT',
  Delivered: 'FUL/DLV',
  '1–14 Sep, compared with 1–14 Aug': 'MTD vs PMTD',
})}
document.querySelectorAll('.product__meta').forEach((p) => { if (/ sold$/.test(p.textContent)) p.textContent = p.textContent.replace(/ sold$/, 'u'); });`),
  },
  {
    case: 'dashboard-clean',
    id: 'conflicting-periods',
    kind: 'defect',
    criterion: 'A',
    title: 'Figures labelled with periods that contradict each other',
    symptom: 'With "This month" selected and the page saying "1–14 Sep, compared with 1–14 Aug", the cards claim other periods: "Revenue, last 7 days", "Orders this year", "Average order value, all time", "Conversion rate, today", top products "Last 90 days, ranked by units sold" (they are ranked by revenue) and "Orders from the last hour" over a list spanning two days.',
    where: {},
    severity: 'severe',
    js: onRender(retext('#h-revenue, .kpi__label, .card__sub, .legend__item--prev', {
      Revenue: 'Revenue, last 7 days',
      Orders: 'Orders this year',
      'Average order value': 'Average order value, all time',
      'Conversion rate': 'Conversion rate, today',
      'Ranked by revenue': 'Last 90 days, ranked by units sold',
      'Select an order to see its items.': 'Orders from the last hour. Select one to see its items.',
      '1–14 Aug': 'Same days last year',
    })),
  },
  {
    case: 'dashboard-clean',
    id: 'harmless-range-labels',
    kind: 'harmless',
    criterion: '',
    title: 'Date range buttons reworded',
    symptom: 'The date range buttons read "Last 7 days", "This month", "Last 30 days" and "Last 90 days" instead of "7 days", "This month", "30 days" and "90 days".',
    where: {},
    severity: 'none',
    js: onRender(retext('.segmented__btn', { '7 days': 'Last 7 days', '30 days': 'Last 30 days', '90 days': 'Last 90 days' })),
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
