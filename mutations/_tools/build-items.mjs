// Writes every planted item to mutations/<case>/<id>.json and regenerates mutations/README.md.
// Usage: node mutations/_tools/build-items.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUT = path.resolve(HERE, '..');

const PHONE = '@media (max-width: 767px)';

const booking = [
  {
    id: 'action-bar-covers-notes',
    kind: 'defect',
    title: 'Fixed action bar covers the end of the form',
    symptom:
      'On phones the page no longer reserves space for the fixed "Confirm booking" bar. When the user scrolls to the bottom, the bar sits on top of the "Anything we should know?" textarea, and the end of the form cannot be scrolled out from under it.',
    where: { viewports: ['phone'], widths: [320, 767], content: null, interaction: 'Scroll to the bottom of the page' },
    severity: 'moderate',
    css: `${PHONE} {\n  .page { padding-bottom: 16px !important; }\n}`,
  },
  {
    id: 'action-bar-ignores-safe-area',
    kind: 'defect',
    title: 'Bottom action bar ignores the safe-area inset',
    symptom:
      'The fixed bottom bar drops its env(safe-area-inset-bottom) padding, so on a phone with a home indicator the "Confirm booking" button sits partly inside the bottom 24 px unsafe area, where it collides with the system gesture bar.',
    where: { viewports: ['phone'], widths: [320, 767], content: null, interaction: null },
    severity: 'moderate',
    css: `${PHONE} {\n  .action-bar { padding-bottom: 12px !important; }\n}`,
  },
  {
    id: 'option-grid-two-col-phone',
    kind: 'defect',
    title: 'Treatment cards stay in two columns on phones',
    symptom:
      'The treatment options keep their two-column grid on phones. Each card is only ~140 px wide, so names, prices and descriptions are crammed and wrap every word or two. With the long (pseudo-localised) strings, words are wider than the card and spill over its border into the neighbouring card.',
    where: { viewports: ['phone'], widths: [320, 767], content: null, interaction: null },
    severity: 'moderate',
    css: `${PHONE} {\n  .option-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }\n}`,
  },
  {
    id: 'layout-min-width-overflow',
    kind: 'defect',
    title: 'Two-column layout forces horizontal scrolling on tablets',
    symptom:
      'The form column was given a 480 px minimum next to a 340 px summary. Between 768 px and about 868 px the two columns no longer fit, so the whole page scrolls sideways and the summary card (with the Confirm button) is cut off at the right edge of the screen.',
    where: { viewports: ['tablet'], widths: [768, 867], content: null, interaction: null },
    severity: 'severe',
    css: `@media (min-width: 768px) {\n  .booking-layout { grid-template-columns: minmax(480px, 1fr) 340px !important; }\n}`,
  },
  {
    id: 'slot-touch-targets-tiny',
    kind: 'defect',
    title: 'Time-slot buttons shrink to tiny tap targets',
    symptom:
      'A "compact" rule for smaller screens shrinks the time-slot buttons to 24 px tall with small text. On touch screens they are well below a comfortable tap size and packed together, so users easily hit the wrong time.',
    where: { viewports: ['tablet', 'phone'], widths: [320, 1023], content: null, interaction: null },
    severity: 'minor',
    css: `@media (max-width: 1023px) {\n  .slot { min-height: 0 !important; height: 24px; font-size: 12px; padding: 0; }\n  .slot-grid { gap: 4px !important; }\n}`,
  },
  {
    id: 'field-errors-overlap-labels',
    kind: 'defect',
    title: 'Validation messages overlap the next field',
    symptom:
      'Field error messages were absolutely positioned under their inputs "to avoid layout shift". After pressing Confirm with an empty form, no space is made for them: "Enter your full name" is jammed against the Email label, and the two-line email error is drawn on top of the next label ("Anything we should know?" on desktop, "Phone (optional)" on phones), making both unreadable.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: 'Press "Confirm booking" with the form empty, then look at the "Your details" section' },
    severity: 'moderate',
    css: `.field { position: relative; }\n.field .field-error { position: absolute; top: 100%; left: 0; right: 0; margin-top: 2px; }`,
  },
  {
    id: 'date-strip-clipped-phone',
    kind: 'defect',
    title: 'Date strip cannot be scrolled on phones',
    symptom:
      'On phones the horizontal date strip has its scrolling turned off. It looks almost the same as the scrollable version (four days visible, the fifth cut at the edge), but swiping does nothing: Friday and Saturday (and more days with dense content) cannot be reached, so they cannot be booked.',
    where: { viewports: ['phone'], widths: [320, 767], content: null, interaction: null },
    severity: 'severe',
    css: `${PHONE} {\n  .date-strip { overflow-x: hidden !important; scroll-snap-type: none !important; }\n}`,
  },
  {
    id: 'sticky-header-covers-summary',
    kind: 'defect',
    title: 'Sticky header hides the top of the sticky summary',
    symptom:
      'The site header was made sticky, but the appointment summary still sticks at 24 px from the top. Once the user scrolls, the summary slides under the header, hiding its "Your appointment" heading and first row.',
    where: { viewports: ['desktop', 'tablet'], widths: [768, 1920], content: null, interaction: 'Scroll down the page by ~700 px' },
    severity: 'moderate',
    css: `.site-header { position: sticky; top: 0; z-index: 10; }`,
  },
  {
    id: 'header-overflow-narrow-phone',
    kind: 'defect',
    title: 'Header overflows on narrow phones',
    symptom:
      'The clinic location ("Clapham") is shown in the header on phones and the brand cannot shrink. On screens narrower than ~385 px the header content is wider than the screen, so the phone number is pushed past the right edge and the page scrolls horizontally.',
    where: { viewports: ['phone'], widths: [320, 384], content: null, interaction: null },
    severity: 'moderate',
    css: `${PHONE} {\n  .brand__location { display: inline !important; }\n  .brand { flex: none; white-space: nowrap; }\n}`,
  },
  {
    id: 'late-promo-banner-shift',
    kind: 'defect',
    title: 'Late banner pushes the page down after load',
    symptom:
      'About 1.2 s after the page appears, a promotional banner is inserted between the header and the form. Everything below it jumps down (by ~60 px on desktop, ~110 px on phones where the text wraps), so a user who had started reading or tapping a treatment card ends up hitting something else.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: 'Watch the first 1-2 seconds after load' },
    severity: 'moderate',
    css: `.dj-promo { background: #fff4dc; color: #5c3d00; padding: 18px 24px; text-align: center; font-weight: 600; border-bottom: 1px solid #f0d9a8; }`,
    js: `setTimeout(function () {\n  if (document.querySelector('.dj-promo')) return;\n  var b = document.createElement('div');\n  b.className = 'dj-promo';\n  b.textContent = 'New: evening appointments on Thursdays until 9pm.';\n  var h = document.querySelector('.site-header');\n  if (h) h.after(b);\n}, 1200);`,
  },
  {
    id: 'summary-row-nowrap-expanded',
    kind: 'defect',
    title: 'Summary values overflow the summary card with long text',
    symptom:
      'Summary values are set to never wrap. With longer (localised) treatment names, once a treatment is chosen its name runs straight out of the right side of the "Your appointment" card, beyond the card border.',
    where: { viewports: ['desktop', 'tablet'], widths: [768, 1920], content: ['expanded', 'stress'], interaction: 'Select a treatment (and a time)' },
    severity: 'moderate',
    css: `.summary__row dd { white-space: nowrap; }`,
  },
  {
    id: 'form-sections-no-separation',
    kind: 'defect',
    title: 'Form steps run together with no separation',
    symptom:
      'The spacing and dividers between the numbered steps were removed. The heading of each step sits almost directly under the controls of the previous one, so it is hard to see where "Treatment" ends and "Practitioner" or "Date and time" begins.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: null },
    severity: 'minor',
    css: `.form-section { padding: 4px 0 !important; }\n.form-section + .form-section { border-top: 0 !important; }\n.form-section__head { margin-bottom: 6px !important; }`,
  },
  {
    id: 'confirm-missing-tablet-band',
    kind: 'defect',
    title: 'No Confirm button at tablet widths',
    symptom:
      'The summary sidebar is hidden below 1024 px, but the mobile action bar only appears below 768 px. Between 768 and 1023 px there is no "Confirm booking" button anywhere on the page, so the booking cannot be completed.',
    where: { viewports: ['tablet'], widths: [768, 1023], content: null, interaction: null },
    severity: 'severe',
    css: `@media (max-width: 1023px) {\n  .summary { display: none !important; }\n  .booking-layout { grid-template-columns: minmax(0, 1fr) !important; }\n}`,
  },
  {
    id: 'inputs-content-box-overflow',
    kind: 'defect',
    title: 'Text inputs are wider than their fields',
    symptom:
      'The inputs use content-box sizing with width: 100%, so padding and border are added on top. Every input and the textarea stick out ~26 px past the right side of its field: in two-column rows the Email box runs into the Phone box, and on phones the inputs poke out of the form card.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: null },
    severity: 'minor',
    css: `.field input, .field textarea { box-sizing: content-box !important; }`,
  },
  {
    id: 'harmless-retheme-blue',
    kind: 'harmless',
    title: 'Brand colour changed to blue',
    symptom: 'Primary, hover and tint colours change from teal to blue and the page background is slightly cooler. Nothing moves or resizes.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: null },
    severity: 'none',
    css: `:root { --primary: #1d4ed8; --primary-hover: #1e40af; --primary-tint: #eef2ff; --bg: #f6f8fb; }`,
  },
  {
    id: 'harmless-date-strip-scroller',
    kind: 'harmless',
    title: 'Date picker becomes a horizontal scroller on larger screens',
    symptom:
      'On tablet and desktop the dates are shown as a single row that scrolls sideways (as on phones), with a visible scrollbar and the next date partly visible at the edge. With 12 dates it is clearly scrollable; nothing is lost.',
    where: { viewports: ['desktop', 'tablet'], widths: [768, 1920], content: ['dense'], interaction: null },
    severity: 'none',
    css: `@media (min-width: 768px) {\n  .date-strip { display: flex !important; overflow-x: auto; padding-bottom: 8px; scroll-snap-type: x mandatory; }\n  .date-chip { flex: 0 0 84px; scroll-snap-align: start; }\n  .date-strip::-webkit-scrollbar { height: 8px; }\n  .date-strip::-webkit-scrollbar-track { background: #eef0f3; border-radius: 4px; }\n  .date-strip::-webkit-scrollbar-thumb { background: #b7bec8; border-radius: 4px; }\n}`,
  },
  {
    id: 'harmless-desc-line-clamp',
    kind: 'harmless',
    title: 'Treatment descriptions clamped to two lines',
    symptom: 'Long treatment descriptions are deliberately limited to two lines with an ellipsis. Names, prices and durations stay fully visible and the cards line up more evenly.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: null },
    severity: 'none',
    css: `.option-card__desc { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }`,
  },
  {
    id: 'harmless-sticky-header-offset',
    kind: 'harmless',
    title: 'Sticky header with the summary offset below it',
    symptom:
      'The site header stays at the top while scrolling, and the sticky summary is offset to stick just below the header, so nothing is hidden underneath it. Anchor jumps also leave room for the header.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: 'Scroll down the page' },
    severity: 'none',
    css: `.site-header { position: sticky; top: 0; z-index: 10; }\n.summary { top: 85px !important; }\nhtml { scroll-padding-top: 80px; }`,
  },
];

const dashboard = [
  {
    id: 'kpi-min-width-overlap-band',
    kind: 'defect',
    title: 'KPI cards overlap each other in a narrow desktop band',
    symptom:
      'KPI cards were given a 300 px minimum width. In the four-column layout between 1440 px and ~1560 px wide the grid columns are narrower than that, so each card overlaps the one to its right by up to ~30 px, hiding the left edge of the next card. It does not appear at 1920 px or below 1440 px (two columns).',
    where: { viewports: [], widths: [1440, 1559], content: null, interaction: null },
    severity: 'moderate',
    css: `@media (min-width: 1440px) {\n  .kpi { min-width: 300px; }\n}`,
  },
  {
    id: 'kpi-label-clipped',
    kind: 'defect',
    title: 'KPI labels cut off without an ellipsis',
    symptom:
      'KPI labels are forced onto one line with overflow hidden but no ellipsis. On phones, longer (localised) labels such as "Average order value" or "Conversion rate" are chopped off mid-word at the card edge with no hint that text is missing.',
    where: { viewports: ['phone'], widths: [320, 767], content: ['expanded', 'stress'], interaction: null },
    severity: 'minor',
    css: `.kpi__label { white-space: nowrap; overflow: hidden; }`,
  },
  {
    id: 'order-panel-offscreen-phone',
    kind: 'defect',
    title: 'Order panel wider than the phone screen',
    symptom:
      'The desktop 440 px side panel is used unchanged on phones. When an order is opened, the panel extends ~80 px past the left edge of the 360 px screen: the order number, date, item names and customer details are cut off on the left, and the panel cannot be scrolled sideways.',
    where: { viewports: ['phone'], widths: [320, 767], content: null, interaction: 'Tap an order in "Recent orders"' },
    severity: 'severe',
    css: `${PHONE} {\n  .panel { width: 440px !important; }\n}`,
  },
  {
    id: 'scrim-above-order-panel',
    kind: 'defect',
    title: 'Dimmed backdrop covers the order panel',
    symptom:
      'The backdrop behind the order panel was given a z-index, so it is painted on top of the panel. After opening an order the panel appears greyed out, and any tap on its buttons hits the backdrop and closes the panel instead.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: 'Click an order in "Recent orders"' },
    severity: 'severe',
    css: `.scrim { z-index: 1; }`,
  },
  {
    id: 'topbar-covers-drawer',
    kind: 'defect',
    title: 'Top bar is stacked above the navigation drawer',
    symptom:
      'On tablet and phone the sticky top bar has a higher z-index than the slide-out navigation drawer. When the menu is opened, the top bar covers the drawer header, so the drawer\'s store name and close (X) button are hidden and the menu cannot be closed.',
    where: { viewports: ['tablet', 'phone'], widths: [320, 1023], content: null, interaction: 'Tap the menu (hamburger) button' },
    severity: 'severe',
    css: `@media (max-width: 1023px) {\n  .topbar { z-index: 30 !important; }\n}`,
  },
  {
    id: 'chart-y-axis-too-narrow',
    kind: 'defect',
    title: 'Revenue axis labels spill into the chart',
    symptom:
      'The y-axis column of the revenue chart is only 14 px wide. The price labels ("£1.8k", "£45k") are wider than that and run to the right into the plot area, overlapping the gridlines and the start of the revenue lines.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: null },
    severity: 'moderate',
    css: `.chart { grid-template-columns: 14px minmax(0, 1fr) !important; }`,
  },
  {
    id: 'chart-x-labels-unanchored',
    kind: 'defect',
    title: 'Chart x-axis labels are off-centre from their points',
    symptom:
      'The x-axis labels lost their centring transform, so every label starts at its data point instead of being centred under it. The labels look shifted right relative to the data, and the last label hangs past the right end of the plot.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: null },
    severity: 'minor',
    css: `.chart__x span { transform: none !important; }`,
  },
  {
    id: 'orders-table-nowrap-overflow',
    kind: 'defect',
    title: 'Orders table overflows its card at tablet width',
    symptom:
      'Table cells are set to never wrap. With long customer names plus localised dates and headings (stress content), the six-column orders table becomes wider than its card at tablet widths (768 to ~890 px), sticking out of the card and making the whole page scroll sideways by over 100 px, with the Status column off-screen. The same happens again just above 1024 px, where the sidebar returns and narrows the content.',
    where: { viewports: ['tablet'], widths: [768, 889], content: ['stress'], interaction: null },
    severity: 'moderate',
    css: `.orders-table th, .orders-table td { white-space: nowrap; }`,
  },
  {
    id: 'product-name-nowrap',
    kind: 'defect',
    title: 'Long product names push revenue out of the card',
    symptom:
      'Product names in "Top products" are forced onto one line. A long name such as "Hand-thrown ceramic fruit bowl (large, speckled glaze)" is wider than the card, pushing its revenue figure past the card edge. On phones this happens with dense content and the page scrolls sideways; on desktop it takes the longer localised names (stress), where the revenue figure sits outside the card.',
    where: { viewports: ['desktop', 'phone'], content: ['dense', 'stress'], interaction: null },
    severity: 'moderate',
    css: `.product__name { white-space: nowrap; }`,
  },
  {
    id: 'sidebar-fixed-overlaps-main',
    kind: 'defect',
    title: 'Fixed sidebar covers the left edge of the content',
    symptom:
      'The sidebar was changed to position: fixed with a hard-coded 180 px content offset, but the sidebar is 240 px wide. On wide screens it covers the first ~24 px of the page: the start of the "Overview" heading and the left edges of the KPI cards and chart are hidden beneath it.',
    where: { viewports: ['desktop'], widths: [1024, 1920], content: null, interaction: null },
    severity: 'moderate',
    css: `@media (min-width: 1024px) {\n  .shell { display: block !important; }\n  .sidebar { position: fixed !important; left: 0; top: 0; width: 240px; z-index: 3; }\n  .main { margin-left: 180px; width: auto !important; }\n}`,
  },
  {
    id: 'chart-late-render-shift',
    kind: 'defect',
    title: 'Chart appears late and shoves the page down',
    symptom:
      'The revenue chart has no reserved height while it "loads". For the first ~1.5 s the chart card is just a header, then the 280 px chart pops in and everything below it (top products on narrow screens, recent orders) jumps down.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: 'Watch the first 1-2 seconds after load' },
    severity: 'moderate',
    css: `.dj-chart-pending .chart, .dj-chart-pending .chart-card .empty { display: none !important; }`,
    js: `document.documentElement.classList.add('dj-chart-pending');\nsetTimeout(function () { document.documentElement.classList.remove('dj-chart-pending'); }, 1500);`,
  },
  {
    id: 'segmented-overflow-phone',
    kind: 'defect',
    title: 'Date-range control overflows the phone screen with long labels',
    symptom:
      'On phones the date-range buttons no longer scroll inside their own track. With longer (localised) labels the control is wider than the screen, so it sticks out past the right edge and the whole page scrolls sideways; the last range is cut off.',
    where: { viewports: ['phone'], widths: [320, 767], content: ['expanded', 'stress'], interaction: null },
    severity: 'moderate',
    css: `${PHONE} {\n  .segmented { overflow-x: visible !important; display: inline-flex !important; }\n}`,
  },
  {
    id: 'orders-list-cramped-phone',
    kind: 'defect',
    title: 'Mobile order list loses its row separation',
    symptom:
      'On phones the dividers and vertical padding between orders were removed. The lines of consecutive orders run into each other, so it is hard to tell which customer, date and total belong to which order.',
    where: { viewports: ['phone'], widths: [320, 767], content: null, interaction: null },
    severity: 'minor',
    css: `${PHONE} {\n  .order-card { padding: 1px 0 !important; gap: 0 !important; }\n  .orders-list li + li { border-top: 0 !important; }\n}`,
  },
  {
    id: 'drawer-peeks-when-closed',
    kind: 'defect',
    title: 'Closed navigation drawer still peeks in from the left',
    symptom:
      'The closed drawer is moved off-screen by a hard-coded 262 px instead of its full 280 px width. An 18 px white strip with a shadow stays visible along the left edge of the screen, covering part of the menu button and the left edge of the content.',
    where: { viewports: ['tablet', 'phone'], widths: [320, 1023], content: null, interaction: null },
    severity: 'minor',
    css: `@media (max-width: 1023px) {\n  .drawer:not(.is-open) { transform: translateX(-262px) !important; }\n}`,
  },
  {
    id: 'harmless-accent-teal',
    kind: 'harmless',
    title: 'Accent colour changed to teal',
    symptom: 'The accent (active nav item, chart line, bars, links) changes from rust to teal. Only colours change.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: null },
    severity: 'none',
    css: `:root { --accent: #0f766e; --accent-soft: #e6f4f1; }\n.area { fill: rgba(15, 118, 110, 0.08); }`,
  },
  {
    id: 'harmless-product-name-ellipsis',
    kind: 'harmless',
    title: 'Long product names truncated with an ellipsis',
    symptom: 'Product names that do not fit on one line end with an ellipsis, while the revenue figure stays fully visible on the right. Intentional, tidy truncation.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: ['dense', 'stress'], interaction: null },
    severity: 'none',
    css: `.product__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }`,
  },
  {
    id: 'harmless-orders-table-scroller',
    kind: 'harmless',
    title: 'Orders table scrolls sideways inside its card',
    symptom:
      'On tablet and desktop the orders table keeps a 760 px minimum width and scrolls horizontally inside the card when there is less room, with a visible scrollbar. The page itself does not scroll sideways.',
    where: { viewports: ['tablet'], widths: [768, 1100], content: null, interaction: null },
    severity: 'none',
    css: `@media (min-width: 768px) {\n  .orders-card { overflow-x: auto; }\n  .orders-table { min-width: 760px; }\n  .orders-card::-webkit-scrollbar { height: 8px; }\n  .orders-card::-webkit-scrollbar-track { background: #eef0f3; border-radius: 4px; }\n  .orders-card::-webkit-scrollbar-thumb { background: #b7bec8; border-radius: 4px; }\n}`,
  },
  {
    id: 'harmless-kpi-accent-rule',
    kind: 'harmless',
    title: 'KPI cards get a coloured top rule',
    symptom: 'Each KPI card gets a 3 px accent-coloured top border and a slightly heavier value weight. Decorative only.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: null },
    severity: 'none',
    css: `.kpi { border-top: 3px solid var(--accent); }\n.kpi__value { font-weight: 720; }`,
  },
];

const carsearch = [
  {
    id: 'grid-min-card-width-overflow',
    kind: 'defect',
    title: 'Results grid keeps three 300 px columns',
    symptom:
      'The results grid always uses three columns with a 300 px minimum. Below ~1270 px the columns no longer fit, so car cards run off the right edge of the page and the page scrolls sideways; on phones two of the three columns are off-screen.',
    where: { viewports: ['tablet', 'phone'], widths: [320, 1269], content: null, interaction: null },
    severity: 'severe',
    css: `.grid { grid-template-columns: repeat(3, minmax(300px, 1fr)) !important; }`,
  },
  {
    id: 'car-image-cropped-phone',
    kind: 'defect',
    title: 'Car photos cropped to a thin strip on phones',
    symptom:
      'To make the list denser on phones, the image box was fixed at 88 px tall. The picture is cropped to a thin letterbox, cutting off the roof and wheels, so the photo no longer shows the car properly.',
    where: { viewports: ['phone'], widths: [320, 767], content: null, interaction: null },
    severity: 'moderate',
    css: `${PHONE} {\n  .car-img { aspect-ratio: auto !important; height: 88px; }\n}`,
  },
  {
    id: 'compare-bar-offscreen-expanded',
    kind: 'defect',
    title: 'Compare bar runs off the phone screen with long text',
    symptom:
      'On phones the fixed compare bar is sized to its content and never wraps. With longer (localised) labels it becomes wider than the screen, so the "Compare now" button is cut off past the right edge; because the bar is fixed it cannot be scrolled into view.',
    where: { viewports: ['phone'], widths: [320, 767], content: ['expanded', 'stress'], interaction: 'Tick "Compare" on two cars' },
    severity: 'severe',
    css: `${PHONE} {\n  .compare-bar { right: auto !important; white-space: nowrap; }\n}`,
  },
  {
    id: 'filters-drawer-footer-unreachable',
    kind: 'defect',
    title: 'Filter drawer footer pushed off the bottom of the screen',
    symptom:
      'In the phone filter drawer the filter list no longer scrolls on its own. The list is taller than the screen, so the lower filters and the "Show N cars" button are pushed below the bottom edge of the fixed drawer and cannot be reached.',
    where: { viewports: ['phone'], widths: [320, 767], content: null, interaction: 'Tap "Filters" to open the filter drawer' },
    severity: 'severe',
    css: `${PHONE} {\n  .filters__body { flex: none !important; overflow: visible !important; }\n}`,
  },
  {
    id: 'header-search-fixed-basis',
    kind: 'defect',
    title: 'Header search box too wide at small tablet widths',
    symptom:
      'The header search box has a fixed 560 px width from 768 px up. Between 768 px and ~850 px the header content is wider than the screen, so the "Saved" link is pushed off the right edge and the page scrolls sideways.',
    where: { viewports: ['tablet'], widths: [768, 849], content: null, interaction: null },
    severity: 'moderate',
    css: `@media (min-width: 768px) {\n  .search { flex: 0 0 560px !important; }\n}`,
  },
  {
    id: 'active-chips-nowrap',
    kind: 'defect',
    title: 'Active filter chips squashed onto one line',
    symptom:
      'The row of active-filter chips can no longer wrap. With several filters applied, the chips are squeezed into one line: their text breaks into two-line pills and on narrow screens the row runs past the edge of the results column.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: 'Apply several filters (all makes, max price, mileage, fuel, gearbox)' },
    severity: 'moderate',
    css: `.chips { flex-wrap: nowrap !important; }`,
  },
  {
    id: 'trim-fixed-height-overlap',
    kind: 'defect',
    title: 'Wrapped trim text overlaps the price',
    symptom:
      'The grey trim line under each car title has a fixed one-line height. When the trim wraps (longer localised trims in the narrow two-column cards just above the 768 px breakpoint), the second line spills down and is drawn on top of the large price, making both hard to read. From ~850 px the trims fit on one line and the problem disappears.',
    where: { viewports: ['tablet'], widths: [768, 820], content: ['expanded', 'stress'], interaction: null },
    severity: 'moderate',
    css: `.car__trim { height: 20px; }`,
  },
  {
    id: 'car-location-nowrap-hides-compare',
    kind: 'defect',
    title: 'Long location text hides the Compare checkbox',
    symptom:
      'The location line in each card footer is forced onto one line. For long town names (especially localised), it pushes the "Compare" checkbox past the right edge of the card, where it is clipped and cannot be used.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: ['expanded', 'stress'], interaction: null },
    severity: 'moderate',
    css: `.car__loc { white-space: nowrap; }`,
  },
  {
    id: 'grid-gap-collapsed',
    kind: 'defect',
    title: 'Result cards almost touch side by side',
    symptom:
      'The horizontal gap between result cards shrank to 3 px while the vertical gap stays 20 px. Side-by-side cards nearly merge, making the grid look like wide double cards and making it harder to tell which details belong to which car.',
    where: { viewports: ['desktop', 'tablet'], widths: [768, 1920], content: null, interaction: null },
    severity: 'minor',
    css: `.grid { column-gap: 3px !important; }`,
  },
  {
    id: 'car-images-late-size-shift',
    kind: 'defect',
    title: 'Car images appear late and push the listings down',
    symptom:
      'Car image boxes have no reserved size until the images "load". For the first ~1.5 s the cards show text only, then every image pops in at full height and all card content, the rest of the grid and "Show more" jump down.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: 'Watch the first 1-2 seconds after load' },
    severity: 'moderate',
    css: `.dj-img-pending .car-img { aspect-ratio: auto !important; height: 0; overflow: hidden; }`,
    js: `document.documentElement.classList.add('dj-img-pending');\nsetTimeout(function () { document.documentElement.classList.remove('dj-img-pending'); }, 1500);`,
  },
  {
    id: 'empty-actions-grid-overflow',
    kind: 'defect',
    title: 'Empty-state buttons overflow on small screens',
    symptom:
      'The "no results" recovery buttons were laid out as a fixed three-column row. On phones and small tablets the centred row of three buttons is wider than the empty-state box, so it spills out on both sides: the first button is cut off past the left edge of the screen (where it cannot be scrolled to) and the last one past the right edge.',
    where: { viewports: ['tablet', 'phone'], widths: [320, 840], content: ['empty'], interaction: null },
    severity: 'moderate',
    css: `.empty__actions { display: grid !important; grid-template-columns: repeat(3, max-content); justify-content: center; }`,
  },
  {
    id: 'compare-bar-above-filters-drawer',
    kind: 'defect',
    title: 'Compare bar sits on top of the filter drawer',
    symptom:
      'The compare bar was given a high z-index. On phones, with cars ticked for comparison, opening the filter drawer leaves the compare bar floating over the drawer and its backdrop, covering the drawer\'s "Show N cars" button.',
    where: { viewports: ['phone'], widths: [320, 767], content: null, interaction: 'Tick "Compare" on two cars, then open Filters' },
    severity: 'moderate',
    css: `.compare-bar { z-index: 40; }`,
  },
  {
    id: 'save-buttons-escape-image',
    kind: 'defect',
    title: 'Save (heart) buttons pile up in the page corner',
    symptom:
      'The image box lost position: relative, so every heart "Save" button is positioned against the page instead of its photo. All of them stack in the top-right corner of the page on top of the header links, and none appear on the car photos.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: null },
    severity: 'severe',
    css: `.car-img { position: static !important; }`,
  },
  {
    id: 'harmless-green-theme',
    kind: 'harmless',
    title: 'Primary colour changed to green',
    symptom: 'Buttons, links, chips and toggles change from blue to green. Only colours change.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: null },
    severity: 'none',
    css: `:root { --primary: #0e7c66; --primary-hover: #0a5f4e; --primary-soft: #e6f4f0; --good: #0e7c66; }`,
  },
  {
    id: 'harmless-deal-badge-on-image',
    kind: 'harmless',
    title: 'Deal badge overlaid on the car photo',
    symptom: 'The "Great price" / "Good price" badge is moved onto the top-left corner of the photo as a sticker. It intentionally overlaps the image, away from the save button, and hides nothing important.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: null, interaction: null },
    severity: 'none',
    css: `.car { position: relative; }\n.deal { position: absolute; top: 10px; left: 10px; margin: 0; box-shadow: 0 1px 2px rgba(16, 24, 40, 0.15); }`,
  },
  {
    id: 'harmless-trim-ellipsis',
    kind: 'harmless',
    title: 'Trim line truncated with an ellipsis',
    symptom: 'Each car\'s trim description is kept to one line and ends with an ellipsis if it is too long. Deliberate truncation of secondary text; title and price stay intact.',
    where: { viewports: ['desktop', 'tablet', 'phone'], content: ['stress'], interaction: null },
    severity: 'none',
    css: `.car__trim { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
  },
  {
    id: 'harmless-chips-scroller-phone',
    kind: 'harmless',
    title: 'Active filter chips scroll sideways on phones',
    symptom:
      'On phones the active-filter chips sit in a single row that scrolls horizontally inside the results column, with the next chip visibly cut at the edge. The page itself does not scroll sideways.',
    where: { viewports: ['phone'], widths: [320, 767], content: null, interaction: 'Apply several filters' },
    severity: 'none',
    css: `${PHONE} {\n  .chips { position: relative; flex-wrap: nowrap; overflow-x: auto; padding-bottom: 8px; }\n  .chip, .chips .link-btn { flex: none; white-space: nowrap; }\n  .chips::-webkit-scrollbar { height: 6px; }\n  .chips::-webkit-scrollbar-track { background: #eef0f3; border-radius: 3px; }\n  .chips::-webkit-scrollbar-thumb { background: #b7bec8; border-radius: 3px; }\n}`,
  },
];

const CASES = { 'booking-baseline': booking, 'dashboard-baseline': dashboard, 'carsearch-baseline': carsearch };

function fmtWhere(w) {
  const parts = [];
  parts.push(w.viewports.length ? w.viewports.join('/') : 'no fixed viewport');
  if (w.widths) parts.push(`${w.widths[0]}–${w.widths[1]} px`);
  if (w.content) parts.push(w.content.join('/'));
  if (w.interaction) parts.push(`after: ${w.interaction}`);
  return parts.join('; ');
}

const rows = [];
for (const [caseId, items] of Object.entries(CASES)) {
  const dir = path.join(MUT, caseId);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) fs.unlinkSync(path.join(dir, f));
  for (const it of items) {
    const where = { viewports: it.where.viewports };
    if (it.where.widths) where.widths = it.where.widths;
    if (it.where.content) where.content = it.where.content;
    where.interaction = it.where.interaction ?? null;
    const out = { id: it.id, case: caseId, kind: it.kind, title: it.title, symptom: it.symptom, where, severity: it.severity, css: it.css, js: it.js ?? null };
    fs.writeFileSync(path.join(dir, `${it.id}.json`), `${JSON.stringify(out, null, 2)}\n`);
    rows.push(`| ${caseId} | ${it.id} | ${it.kind} | ${it.severity} | ${fmtWhere(where)} | ${it.title} |`);
  }
}

const counts = Object.entries(CASES)
  .map(([c, items]) => `- ${c}: ${items.filter((i) => i.kind === 'defect').length} defects, ${items.filter((i) => i.kind === 'harmless').length} harmless`)
  .join('\n');

const readme = `# Planted layout mutations

Each JSON file in \`mutations/<case-id>/\` is one self-contained change to a baseline site: \`css\` is appended in a \`<style>\` at the end of \`<head>\`; \`js\` (if any) runs once after DOMContentLoaded. \`kind\` is \`defect\` or \`harmless\`.

${counts}

Tools:

- \`_tools/build-items.mjs\` regenerates all item files and this README.
- \`_tools/preview.mjs <case> <item-id|baseline|all> [--vp=..] [--fixture=..] [--base]\` serves the case, applies the item and writes screenshots to \`_previews/<case>/\`.

| Case | Id | Kind | Severity | Where | Title |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
fs.writeFileSync(path.join(MUT, 'README.md'), readme);
console.log(`wrote ${rows.length} items`);
