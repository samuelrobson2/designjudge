import { loadData, pseudo } from './data.js';

const { data, expand } = loadData();
const t = (s) => (expand ? pseudo(s) : s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const gbp = (n) => `£${n.toLocaleString('en-GB')}`;
const miles = (n) => `${n.toLocaleString('en-GB')} ${t(n === 1 ? 'mile' : 'miles')}`;

const PAGE_SIZE = 12;
const MAX_COMPARE = 3;
const PRICE_OPTIONS = [5000, 8000, 10000, 12500, 15000, 20000, 25000, 30000, 40000];
const DISTANCES = [
  [10, 'Within 10 miles'],
  [25, 'Within 25 miles'],
  [50, 'Within 50 miles'],
  [0, 'Any distance'],
];
const MILEAGE = [
  ['any', 'Any mileage'],
  ['10000', 'Up to 10,000 miles'],
  ['30000', 'Up to 30,000 miles'],
  ['60000', 'Up to 60,000 miles'],
];
const FUELS = ['Petrol', 'Diesel', 'Hybrid', 'Electric'];
const SORTS = [
  ['nearest', 'Nearest first'],
  ['price', 'Lowest price'],
  ['mileage', 'Lowest mileage'],
  ['newest', 'Newest first'],
  ['saving', 'Most below average'],
];

const state = {
  postcode: data.postcode,
  postcodeDraft: null,
  distance: 25,
  makes: new Set(),
  minPrice: null,
  maxPrice: null,
  mileage: 'any',
  fuels: new Set(),
  sort: 'nearest',
  shown: PAGE_SIZE,
  compare: [],
  drawerOpen: false,
};

const app = document.getElementById('app');
const compareDialog = document.getElementById('compare-dialog');
// Below this width the filters open in a drawer.
const mobile = window.matchMedia('(max-width: 1023px)');

// ---------- Data ----------

// How a car's price compares with the average asking price of similar cars.
function rating(c) {
  const share = (c.average - c.price) / c.average;
  if (share >= 0.06) return { key: 'great', label: t('Great price') };
  if (share >= 0.03) return { key: 'good', label: t('Good price') };
  if (share > -0.03) return { key: 'fair', label: t('Fair price') };
  return { key: 'high', label: t('High price') };
}
const difference = (c) => (c.average >= c.price ? `${gbp(c.average - c.price)} ${t('below average')}` : `${gbp(c.price - c.average)} ${t('above average')}`);

const inDistance = (c) => !state.distance || c.distance <= state.distance;
function matches(c, skip) {
  return (
    inDistance(c) &&
    (skip === 'make' || !state.makes.size || state.makes.has(c.make)) &&
    (state.minPrice === null || c.price >= state.minPrice) &&
    (state.maxPrice === null || c.price <= state.maxPrice) &&
    (state.mileage === 'any' || c.miles <= Number(state.mileage)) &&
    (skip === 'fuel' || !state.fuels.size || state.fuels.has(c.fuel))
  );
}

function results() {
  const list = data.cars.filter((c) => matches(c));
  const by = {
    nearest: (a, b) => a.distance - b.distance || a.price - b.price,
    price: (a, b) => a.price - b.price,
    mileage: (a, b) => a.miles - b.miles,
    newest: (a, b) => b.year - a.year || a.miles - b.miles,
    saving: (a, b) => b.average - b.price - (a.average - a.price),
  };
  return list.sort(by[state.sort]);
}

const activeFilters = () => [
  ...(state.minPrice !== null ? [['minPrice', `${t('From')} ${gbp(state.minPrice)}`]] : []),
  ...(state.maxPrice !== null ? [['maxPrice', `${t('Up to')} ${gbp(state.maxPrice)}`]] : []),
  ...[...state.makes].map((m) => [`make:${m}`, m]),
  ...(state.mileage !== 'any' ? [['mileage', t(MILEAGE.find(([v]) => v === state.mileage)[1])]] : []),
  ...[...state.fuels].map((f) => [`fuel:${f}`, t(f)]),
];

const carName = (c) => `${c.make} ${c.model}`;
const carById = (id) => data.cars.find((c) => c.id === id);

// ---------- Pieces ----------

function carSvg(c) {
  const body = {
    hatchback: 'M38 134 L56 106 Q84 76 134 72 L196 72 Q224 74 248 102 L280 110 Q294 114 294 128 L294 142 L38 142 Z',
    saloon: 'M26 134 L48 110 Q78 84 122 80 L186 78 Q212 80 234 102 L282 110 Q298 114 298 128 L298 142 L26 142 Z',
    estate: 'M28 134 L46 108 Q72 80 116 76 L246 74 Q262 76 270 100 L286 108 Q298 112 298 126 L298 142 L28 142 Z',
    SUV: 'M32 138 L42 96 Q50 72 86 68 L212 66 Q236 68 254 94 L284 104 Q296 108 296 124 L296 144 L32 144 Z',
  }[c.body];
  const glass = {
    hatchback: 'M74 106 Q94 82 134 80 L150 80 L150 106 Z M160 80 L192 80 Q214 82 232 104 L160 106 Z',
    saloon: 'M64 108 Q90 90 122 88 L150 88 L150 108 Z M160 88 L182 88 Q204 90 220 106 L160 108 Z',
    estate: 'M64 106 Q82 86 116 84 L150 84 L150 106 Z M160 84 L238 82 Q250 84 256 104 L160 106 Z',
    SUV: 'M58 98 Q64 78 90 76 L150 76 L150 100 Z M160 76 L210 76 Q230 78 244 98 L160 100 Z',
  }[c.body];
  const [front, rear] = c.body === 'saloon' ? [88, 246] : c.body === 'estate' ? [90, 246] : [94, 240];
  const wheel = (x) => `<circle cx="${x}" cy="142" r="21" fill="#23272d"/><circle cx="${x}" cy="142" r="10" fill="#aeb4bb"/><circle cx="${x}" cy="142" r="3" fill="#6d737a"/>`;
  return `
      <svg class="car__img" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${t('Illustration')}: ${esc(c.colorName.toLowerCase())} ${t(c.body)}">
        <rect width="320" height="200" fill="#eef1f4"/>
        <rect y="152" width="320" height="48" fill="#e1e5ea"/>
        <ellipse cx="166" cy="153" rx="138" ry="8" fill="rgba(20,30,40,0.16)"/>
        <path d="${body}" fill="${c.color}" stroke="rgba(0,0,0,0.28)" stroke-width="1.5"/>
        <path d="${glass}" fill="rgba(196,214,232,0.9)" stroke="rgba(0,0,0,0.18)"/>
        <path d="M40 128 L292 128" stroke="rgba(0,0,0,0.14)" stroke-width="2"/>
        <rect x="282" y="114" width="12" height="6" rx="2" fill="#f4e7b5"/>
        <rect x="30" y="118" width="8" height="7" rx="2" fill="#c8453b"/>
        ${wheel(front)}${wheel(rear)}
      </svg>`;
}

function header() {
  return `
    <a class="skip-link" href="#results">${t('Skip to results')}</a>
    <header class="site-header">
      <div class="site-header__inner">
        <div class="brand">
          <svg class="brand__mark" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#1a56db"/><path d="M6 17l3-6h10l3 6v3H6z" fill="#fff"/><circle cx="10" cy="20" r="2" fill="#1a56db"/><circle cx="18" cy="20" r="2" fill="#1a56db"/></svg>
          <span class="brand__name">Motorwise</span>
        </div>
      </div>
    </header>`;
}

function locationForm() {
  return `
      <form class="location" id="location-form" aria-label="${t('Location')}">
        <div class="location__field">
          <label for="postcode">${t('Postcode')}</label>
          <input id="postcode" name="postcode" autocomplete="postal-code" value="${esc(state.postcodeDraft ?? state.postcode)}" />
        </div>
        <div class="location__field">
          <label for="distance">${t('Distance')}</label>
          <select id="distance" data-filter="distance">
            ${DISTANCES.map(([v, l]) => `<option value="${v}" ${state.distance === v ? 'selected' : ''}>${t(l)}</option>`).join('')}
          </select>
        </div>
        <button type="submit" class="btn btn--primary">${t('Search')}</button>
      </form>`;
}

function check(type, attrs, checked, label, count) {
  const name = count === undefined ? '' : `aria-label="${label}, ${count} ${t(count === 1 ? 'car' : 'cars')}"`;
  return `
          <label class="check">
            <input type="${type}" class="check__input" ${attrs} ${name} ${checked ? 'checked' : ''} />
            <span class="check__label">${label}</span>
            ${count === undefined ? '' : `<span class="check__count">${count}</span>`}
          </label>`;
}

function filterPanel(count) {
  const inRange = data.cars.filter(inDistance);
  const makes = [...new Set(inRange.map((c) => c.make))].sort();
  const makeCount = (m) => data.cars.filter((c) => c.make === m && matches(c, 'make')).length;
  const fuelCount = (f) => data.cars.filter((c) => c.fuel === f && matches(c, 'fuel')).length;
  const priceSelect = (key, id) => `
            <select id="${id}" data-filter="${key}">
              <option value="">${t('Any')}</option>
              ${PRICE_OPTIONS.map((p) => `<option value="${p}" ${state[key] === p ? 'selected' : ''}>${gbp(p)}</option>`).join('')}
            </select>`;
  const open = state.drawerOpen && mobile.matches;
  return `
      <aside class="filters ${state.drawerOpen ? 'is-open' : ''}" id="filters" aria-labelledby="h-filters" ${open ? 'role="dialog" aria-modal="true"' : ''}>
        <div class="filters__head">
          <h2 id="h-filters">${t('Filters')}</h2>
          ${activeFilters().length ? `<button type="button" class="link-btn filters__clear" data-action="clear">${t('Clear all')}</button>` : ''}
          <button type="button" class="icon-btn filters__close" data-action="close-filters" aria-label="${t('Close filters')}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </div>
        <div class="filters__body">
          <div class="fgroup" role="group" aria-labelledby="fg-price">
            <h3 id="fg-price">${t('Price')}</h3>
            <div class="fgroup__pair">
              <div class="fgroup__field"><label for="min-price">${t('Minimum')}</label>${priceSelect('minPrice', 'min-price')}</div>
              <div class="fgroup__field"><label for="max-price">${t('Maximum')}</label>${priceSelect('maxPrice', 'max-price')}</div>
            </div>
          </div>
          ${
            makes.length
              ? `<div class="fgroup" role="group" aria-labelledby="fg-make">
            <h3 id="fg-make">${t('Make')}</h3>
            <div class="fgroup__options">${makes.map((m) => check('checkbox', `data-make="${esc(m)}"`, state.makes.has(m), esc(m), makeCount(m))).join('')}</div>
          </div>`
              : ''
          }
          <div class="fgroup" role="radiogroup" aria-labelledby="fg-mileage">
            <h3 id="fg-mileage">${t('Mileage')}</h3>
            <div class="fgroup__options">${MILEAGE.map(([v, l]) => check('radio', `name="mileage" value="${v}"`, state.mileage === v, t(l))).join('')}</div>
          </div>
          <div class="fgroup" role="group" aria-labelledby="fg-fuel">
            <h3 id="fg-fuel">${t('Fuel type')}</h3>
            <div class="fgroup__options">${FUELS.map((f) => check('checkbox', `data-fuel="${f}"`, state.fuels.has(f), t(f), fuelCount(f))).join('')}</div>
          </div>
        </div>
        <div class="filters__foot">
          <button type="button" class="btn btn--primary btn--block" data-action="close-filters">${t('Show')} ${count} ${t(count === 1 ? 'car' : 'cars')}</button>
        </div>
      </aside>`;
}

function chips() {
  const list = activeFilters();
  if (!list.length) return '';
  return `
        <div class="chips" role="group" aria-label="${t('Active filters')}">
          ${list.map(([k, label]) => `<button type="button" class="chip" data-remove="${esc(k)}"><span class="visually-hidden">${t('Remove filter')}: </span>${esc(label)}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>`).join('')}
          ${list.length > 1 ? `<button type="button" class="link-btn" data-action="clear">${t('Clear all filters')}</button>` : ''}
        </div>`;
}

function card(c) {
  const r = rating(c);
  const picked = state.compare.includes(c.id);
  const full = !picked && state.compare.length >= MAX_COMPARE;
  return `
      <article class="car" aria-labelledby="${c.id}-title">
        <div class="car__media">${carSvg(c)}</div>
        <div class="car__body">
          <h3 class="car__title" id="${c.id}-title">${esc(carName(c))}</h3>
          <p class="car__trim">${c.year} · ${esc(c.trim)}</p>
          <p class="car__price">${gbp(c.price)}</p>
          <p class="car__rating car__rating--${r.key}"><span class="badge badge--${r.key}">${r.label}</span> ${difference(c)}</p>
          <ul class="specs">
            <li>${miles(c.miles)}</li>
            <li>${t(c.fuel)}</li>
            <li>${t(c.gearbox)}</li>
          </ul>
          <div class="car__foot">
            <p class="car__loc">${esc(c.town)} · ${miles(c.distance)} ${t('away')}</p>
            <label class="compare-check ${full ? 'is-disabled' : ''}">
              <input type="checkbox" class="compare-check__input" id="compare-${c.id}" data-compare="${c.id}" aria-label="${t('Compare')} ${esc(carName(c))}" ${picked ? 'checked' : ''} ${full ? 'disabled' : ''} />
              <span>${t('Compare')}</span>
            </label>
          </div>
        </div>
      </article>`;
}

function emptyState() {
  const filters = activeFilters();
  const wider = DISTANCES.find(([v]) => v === 0 || (state.distance && v > state.distance));
  const widen = state.distance ? `<button type="button" class="btn ${filters.length ? 'btn--secondary' : 'btn--primary'}" data-distance="${wider[0]}">${t(wider[0] ? `Search within ${wider[0]} miles` : 'Search any distance')}</button>` : '';
  if (filters.length) {
    return `
        <div class="empty">
          <p class="empty__body">${t('Remove a filter, or search a wider distance.')}</p>
          <div class="empty__actions">
            ${filters.length === 1 ? `<button type="button" class="btn btn--primary" data-remove="${esc(filters[0][0])}">${t('Remove')} “${esc(filters[0][1])}”</button>` : `<button type="button" class="btn btn--primary" data-action="clear">${t('Clear all filters')}</button>`}
            ${widen}
          </div>
        </div>`;
  }
  return `
        <div class="empty">
          <p class="empty__body">${state.distance ? t('Try a wider distance, or check a different postcode.') : t('Check again later, or try a different postcode.')}</p>
          ${widen ? `<div class="empty__actions">${widen}</div>` : ''}
        </div>`;
}

function resultsTitle(n) {
  const where = state.distance ? `${t('within')} ${state.distance} ${t('miles of')} ${esc(state.postcode)}` : t('at any distance');
  if (n) return `${n} ${t(n === 1 ? 'car' : 'cars')} ${state.distance ? `${t('within')} ${state.distance} ${t('miles')}` : t('at any distance')}`;
  return activeFilters().length ? t('No cars match your filters') : `${t('No cars for sale')} ${where}`;
}

function resultsSection(list) {
  const n = list.length;
  const shown = list.slice(0, state.shown);
  const filtered = activeFilters().length;
  return `
      <section class="results" id="results" aria-labelledby="h-results">
        <div class="results__head">
          <div class="results__title">
            <h2 id="h-results">${resultsTitle(n)}</h2>
            ${n ? `<span class="results__sample">${t('Example listings')}</span>` : ''}
          </div>
          ${n ? `<p class="results__note">${t('Price ratings compare each car with the average price of the same model, age and mileage.')}</p>` : ''}
          <div class="toolbar">
            <button type="button" class="btn btn--secondary filters-btn" data-action="open-filters" aria-expanded="${state.drawerOpen}" aria-controls="filters">${t('Filters')}${filtered ? ` (${filtered})` : ''}</button>
            ${
              n
                ? `<div class="sort">
              <label for="sort">${t('Sort by')}</label>
              <select id="sort" data-filter="sort">${SORTS.map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${t(l)}</option>`).join('')}</select>
            </div>`
                : ''
            }
          </div>
        </div>
        ${chips()}
        ${
          n
            ? `<div class="grid">${shown.map(card).join('')}</div>
        ${n > shown.length ? `<div class="more"><p class="more__count">${t('Showing')} ${shown.length} ${t('of')} ${n}</p><button type="button" class="btn btn--secondary" data-action="more">${t('Show')} ${Math.min(PAGE_SIZE, n - shown.length)} ${t('more cars')}</button></div>` : ''}`
            : emptyState()
        }
      </section>`;
}

function compareBar() {
  const n = state.compare.length;
  if (!n) return '';
  const text = n === 1 ? t('1 car selected. Select another to compare.') : `${n} ${t('cars selected')}${n === MAX_COMPARE ? ` ${t('(the most you can compare)')}` : ''}`;
  return `
    <div class="compare-bar" role="region" aria-label="${t('Compare cars')}" id="compare-bar">
      <p class="compare-bar__text">${text}</p>
      <div class="compare-bar__actions">
        <button type="button" class="btn btn--ghost" data-action="clear-compare">${t('Clear')}</button>
        <button type="button" class="btn btn--primary" data-action="open-compare" ${n < 2 ? 'disabled' : ''}>${t('Compare')}${n > 1 ? ` ${n} ${t('cars')}` : ''}</button>
      </div>
    </div>`;
}

// ---------- Compare ----------

function openCompare() {
  const cars = state.compare.map(carById);
  const best = (pick, fn) => {
    const v = pick(...cars.map(fn));
    return (c) => fn(c) === v;
  };
  const rows = [
    [t('Price'), (c) => gbp(c.price), best(Math.min, (c) => c.price), t('Lowest')],
    [t('Price rating'), (c) => `${rating(c).label}, ${difference(c)}`, best(Math.max, (c) => c.average - c.price), t('Most below')],
    [t('Mileage'), (c) => miles(c.miles), best(Math.min, (c) => c.miles), t('Lowest')],
    [t('Year'), (c) => String(c.year), best(Math.max, (c) => c.year), t('Newest')],
    [t('Fuel type'), (c) => t(c.fuel)],
    [t('Gearbox'), (c) => t(c.gearbox)],
    [t('Distance'), (c) => `${miles(c.distance)}, ${esc(c.town)}`, best(Math.min, (c) => c.distance), t('Nearest')],
  ];
  compareDialog.innerHTML = `
    <div class="compare__inner">
      <div class="compare__head">
        <h2 id="h-compare">${t('Compare cars')}</h2>
        <button type="button" class="icon-btn" data-action="close-compare" aria-label="${t('Close')}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      </div>
      <div class="compare__scroll" tabindex="0" role="region" aria-labelledby="h-compare">
        <table class="compare-table">
          <thead>
            <tr><td></td>${cars.map((c) => `<th scope="col">${esc(carName(c))}<span class="compare-table__trim">${c.year} · ${esc(c.trim)}</span></th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows
              .map(
                ([label, fn, isBest, word]) =>
                  `<tr><th scope="row">${label}</th>${cars.map((c) => `<td class="${isBest && isBest(c) ? 'is-best' : ''}">${fn(c)}${isBest && isBest(c) ? `<span class="best-tag">${word}</span>` : ''}</td>`).join('')}</tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  compareDialog.showModal();
}

compareDialog.addEventListener('click', (e) => {
  if (e.target === compareDialog || e.target.closest('[data-action="close-compare"]')) compareDialog.close();
});

// ---------- Page ----------

function render() {
  const focused = document.activeElement?.id || null;
  const list = results();
  app.innerHTML = `
    ${header()}
    <main class="page" id="main">
      <div class="page__head">
        <h1>${t('Used cars for sale')}</h1>
        ${locationForm()}
      </div>
      <div class="layout">
        ${filterPanel(list.length)}
        ${resultsSection(list)}
      </div>
    </main>
    ${state.drawerOpen && mobile.matches ? '<div class="scrim" data-action="close-filters"></div>' : ''}
    ${compareBar()}`;
  const open = state.drawerOpen && mobile.matches;
  for (const el of app.querySelectorAll('.site-header, .page__head, .results, .compare-bar')) el.toggleAttribute('inert', open);
  document.body.classList.toggle('has-drawer', open);
  // Room below the page so the compare bar never covers the last results.
  const bar = document.getElementById('compare-bar');
  document.body.style.paddingBottom = bar && getComputedStyle(bar).position === 'fixed' ? `${bar.offsetHeight + 40}px` : '';
  if (open) document.querySelector('.filters__close')?.focus();
  else if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
}

app.addEventListener('change', (e) => {
  const el = e.target;
  // The postcode applies when the location form is submitted; until then the field keeps what was typed.
  if (el.id === 'postcode') {
    state.postcodeDraft = el.value;
    return;
  }
  if (el.dataset.make) el.checked ? state.makes.add(el.dataset.make) : state.makes.delete(el.dataset.make);
  if (el.dataset.fuel) el.checked ? state.fuels.add(el.dataset.fuel) : state.fuels.delete(el.dataset.fuel);
  if (el.dataset.filter === 'minPrice') state.minPrice = el.value ? Number(el.value) : null;
  if (el.dataset.filter === 'maxPrice') state.maxPrice = el.value ? Number(el.value) : null;
  if (el.dataset.filter === 'distance') state.distance = Number(el.value);
  if (el.dataset.filter === 'sort') state.sort = el.value;
  if (el.name === 'mileage') state.mileage = el.value;
  if (el.dataset.compare) {
    const id = el.dataset.compare;
    state.compare = el.checked ? [...state.compare, id].slice(0, MAX_COMPARE) : state.compare.filter((x) => x !== id);
  }
  if (!el.dataset.compare && el.dataset.filter !== 'sort') state.shown = PAGE_SIZE;
  render();
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = document.getElementById('postcode').value.trim().toUpperCase();
  if (value) state.postcode = value;
  state.postcodeDraft = null;
  state.distance = Number(document.getElementById('distance').value);
  state.shown = PAGE_SIZE;
  render();
});

app.addEventListener('click', (e) => {
  const remove = e.target.closest('[data-remove]');
  if (remove) {
    const [kind, value] = remove.dataset.remove.split(':');
    if (kind === 'make') state.makes.delete(value);
    if (kind === 'fuel') state.fuels.delete(value);
    if (kind === 'minPrice') state.minPrice = null;
    if (kind === 'maxPrice') state.maxPrice = null;
    if (kind === 'mileage') state.mileage = 'any';
    return render();
  }
  const distance = e.target.closest('[data-distance]');
  if (distance) {
    state.distance = Number(distance.dataset.distance);
    return render();
  }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'clear') {
    state.makes.clear();
    state.fuels.clear();
    state.minPrice = state.maxPrice = null;
    state.mileage = 'any';
  }
  if (action === 'open-filters') state.drawerOpen = true;
  if (action === 'close-filters') state.drawerOpen = false;
  if (action === 'more') state.shown += PAGE_SIZE;
  if (action === 'clear-compare') state.compare = [];
  if (action === 'open-compare') return openCompare();
  render();
});

mobile.addEventListener('change', () => {
  state.drawerOpen = false;
  render();
});
render();
