import { MAKES, loadData, pseudo } from './data.js';

const { data, expand } = loadData();
const t = (s) => (expand ? pseudo(s) : s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const gbp = (n) => `£${n.toLocaleString('en-GB')}`;

const state = {
  makes: new Set(),
  minPrice: null,
  maxPrice: data.emptyWithFilters ? 8000 : null,
  mileage: 'any',
  fuels: new Set(data.emptyWithFilters ? ['Electric'] : []),
  gearbox: null,
  sort: 'best',
  compare: new Set(),
  drawerOpen: false,
  shown: 9,
};
const app = document.getElementById('app');

const PRICE_OPTIONS = [5000, 8000, 10000, 12500, 15000, 20000, 25000, 30000, 40000];
const MILEAGE = [
  ['10000', 'Up to 10,000 miles'],
  ['30000', 'Up to 30,000 miles'],
  ['60000', 'Up to 60,000 miles'],
  ['any', 'Any mileage'],
];
const DEAL = { great: 'Great price', good: 'Good price', fair: 'Fair price' };

function filtered() {
  let list = data.cars.filter(
    (c) =>
      (!state.makes.size || state.makes.has(c.make)) &&
      (state.maxPrice === null || c.price <= state.maxPrice) &&
      (state.minPrice === null || c.price >= state.minPrice) &&
      (state.mileage === 'any' || c.miles <= Number(state.mileage)) &&
      (!state.fuels.size || state.fuels.has(c.fuel)) &&
      (!state.gearbox || c.gearbox === state.gearbox),
  );
  if (state.sort === 'price') list = [...list].sort((a, b) => a.price - b.price);
  if (state.sort === 'newest') list = [...list].sort((a, b) => b.year - a.year);
  if (state.sort === 'mileage') list = [...list].sort((a, b) => a.miles - b.miles);
  return list;
}

const activeFilterCount = () =>
  state.makes.size + state.fuels.size + (state.maxPrice !== null) + (state.minPrice !== null) + (state.mileage !== 'any') + (state.gearbox !== null);

function carSvg(c) {
  const shapes = {
    hatch: 'M34 132 L52 104 Q80 74 132 70 L196 70 Q226 72 250 100 L282 108 Q296 112 296 126 L296 140 L34 140 Z',
    sedan: 'M24 132 L46 108 Q76 82 120 78 L186 76 Q214 78 236 100 L284 108 Q300 112 300 126 L300 140 L24 140 Z',
    suv: 'M30 136 L40 92 Q48 70 84 66 L214 64 Q238 66 256 92 L286 102 Q298 106 298 122 L298 142 L30 142 Z',
  };
  const windows = {
    hatch: 'M70 104 Q92 80 132 78 L150 78 L150 104 Z M160 78 L194 78 Q218 80 236 102 L160 104 Z',
    sedan: 'M62 106 Q88 88 122 86 L150 86 L150 106 Z M160 86 L184 86 Q206 88 222 104 L160 106 Z',
    suv: 'M56 96 Q62 76 88 74 L150 74 L150 98 Z M160 74 L212 74 Q232 76 246 96 L160 98 Z',
  };
  return `
    <svg class="car-img__svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(`${c.year} ${c.make} ${c.model}`)}">
      <rect width="320" height="200" fill="#e9edf1"/>
      <rect y="150" width="320" height="50" fill="#d9dee4"/>
      <ellipse cx="165" cy="150" rx="140" ry="9" fill="rgba(20,30,40,0.18)"/>
      <path d="${shapes[c.body]}" fill="${c.color}" stroke="rgba(0,0,0,0.25)" stroke-width="1.5"/>
      <path d="${windows[c.body]}" fill="rgba(210,225,240,0.85)"/>
      <circle cx="${c.body === 'sedan' ? 88 : 92}" cy="142" r="20" fill="#23272d"/><circle cx="${c.body === 'sedan' ? 88 : 92}" cy="142" r="8" fill="#9aa1a9"/>
      <circle cx="${c.body === 'sedan' ? 244 : 240}" cy="142" r="20" fill="#23272d"/><circle cx="${c.body === 'sedan' ? 244 : 240}" cy="142" r="8" fill="#9aa1a9"/>
    </svg>`;
}

function header() {
  return `
    <header class="header">
      <div class="header__inner">
        <a href="#" class="logo"><svg viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#1a56db"/><path d="M6 17l3-6h10l3 6v3H6z" fill="#fff"/><circle cx="10" cy="20" r="2" fill="#1a56db"/><circle cx="18" cy="20" r="2" fill="#1a56db"/></svg><span>Motorwise</span></a>
        <form class="search" role="search" onsubmit="return false">
          <label class="visually-hidden" for="q">${t('Search cars')}</label>
          <input id="q" type="search" placeholder="${t('Make, model or keyword')}" />
          <button class="btn btn--primary" type="submit">${t('Search')}</button>
        </form>
        <nav class="header__links" aria-label="${t('Account')}">
          <a href="#" class="header__link header__link--sell">${t('Sell your car')}</a>
          <a href="#" class="header__link">♡ ${t('Saved')} (2)</a>
        </nav>
      </div>
    </header>`;
}

function filterPanel(count) {
  const makeCounts = { Volkswagen: 42, Ford: 38, Toyota: 31, BMW: 24, Audi: 22, Kia: 18 };
  return `
    <aside class="filters ${state.drawerOpen ? 'is-open' : ''}" id="filters" aria-labelledby="h-filters" ${state.drawerOpen ? 'role="dialog" aria-modal="true"' : ''}>
      <div class="filters__head">
        <h2 id="h-filters">${t('Filters')}</h2>
        <button type="button" class="link-btn" data-action="clear">${t('Clear all')}</button>
        <button type="button" class="icon-btn filters__close" data-action="close-filters" aria-label="${t('Close filters')}">✕</button>
      </div>
      <div class="filters__body">
        <fieldset class="fgroup">
          <legend>${t('Price')}</legend>
          <div class="fgroup__pair">
            <select data-filter="minPrice" aria-label="${t('Minimum price')}"><option value="">${t('No min')}</option>${PRICE_OPTIONS.map((p) => `<option value="${p}" ${state.minPrice === p ? 'selected' : ''}>${gbp(p)}</option>`).join('')}</select>
            <select data-filter="maxPrice" aria-label="${t('Maximum price')}"><option value="">${t('No max')}</option>${PRICE_OPTIONS.map((p) => `<option value="${p}" ${state.maxPrice === p ? 'selected' : ''}>${gbp(p)}</option>`).join('')}</select>
          </div>
        </fieldset>
        <fieldset class="fgroup">
          <legend>${t('Make')}</legend>
          ${MAKES.map((m) => `<label class="check"><input type="checkbox" data-make="${m}" ${state.makes.has(m) ? 'checked' : ''}/><span>${m}</span><span class="check__count">${makeCounts[m]}</span></label>`).join('')}
          <button type="button" class="link-btn">${t('Show all makes')}</button>
        </fieldset>
        <fieldset class="fgroup">
          <legend>${t('Mileage')}</legend>
          ${MILEAGE.map(([v, label]) => `<label class="check"><input type="radio" name="mileage" value="${v}" ${state.mileage === v ? 'checked' : ''}/><span>${t(label)}</span></label>`).join('')}
        </fieldset>
        <fieldset class="fgroup">
          <legend>${t('Fuel type')}</legend>
          <div class="toggles">${['Petrol', 'Diesel', 'Hybrid', 'Electric'].map((f) => `<button type="button" class="toggle ${state.fuels.has(f) ? 'is-on' : ''}" aria-pressed="${state.fuels.has(f)}" data-fuel="${f}">${t(f)}</button>`).join('')}</div>
        </fieldset>
        <fieldset class="fgroup">
          <legend>${t('Gearbox')}</legend>
          <div class="toggles">${['Manual', 'Automatic'].map((g) => `<button type="button" class="toggle ${state.gearbox === g ? 'is-on' : ''}" aria-pressed="${state.gearbox === g}" data-gearbox="${g}">${t(g)}</button>`).join('')}</div>
        </fieldset>
      </div>
      <div class="filters__foot">
        <button type="button" class="btn btn--primary btn--block" data-action="close-filters">${t('Show')} ${count} ${t('cars')}</button>
      </div>
    </aside>`;
}

function activeChips() {
  const chips = [
    ...[...state.makes].map((m) => [`make:${m}`, m]),
    ...(state.minPrice !== null ? [['minPrice', `${t('From')} ${gbp(state.minPrice)}`]] : []),
    ...(state.maxPrice !== null ? [['maxPrice', `${t('Up to')} ${gbp(state.maxPrice)}`]] : []),
    ...(state.mileage !== 'any' ? [['mileage', t(MILEAGE.find(([v]) => v === state.mileage)[1])]] : []),
    ...[...state.fuels].map((f) => [`fuel:${f}`, t(f)]),
    ...(state.gearbox ? [['gearbox', t(state.gearbox)]] : []),
  ];
  if (!chips.length) return '';
  return `
    <div class="chips" aria-label="${t('Active filters')}">
      ${chips.map(([k, label]) => `<button type="button" class="chip" data-remove="${esc(k)}">${esc(label)} <span aria-hidden="true">✕</span><span class="visually-hidden">${t('Remove filter')}</span></button>`).join('')}
      <button type="button" class="link-btn" data-action="clear">${t('Clear all')}</button>
    </div>`;
}

function card(c, i) {
  const id = `${c.make}-${c.model}-${c.year}-${i}`.replace(/\s+/g, '-');
  return `
    <article class="car" aria-labelledby="car-${id}">
      <div class="car-img">
        ${carSvg(c)}
        <button type="button" class="save" aria-label="${t('Save')} ${esc(`${c.year} ${c.make} ${c.model}`)}">♡</button>
      </div>
      <div class="car__body">
        <span class="deal deal--${c.deal}">${t(DEAL[c.deal])}</span>
        <h3 class="car__title" id="car-${id}"><a href="#">${c.year} ${esc(c.make)} ${esc(c.model)}</a></h3>
        <p class="car__trim">${esc(c.trim)}</p>
        <p class="car__price">${gbp(c.price)}</p>
        <ul class="specs">
          <li>${c.miles.toLocaleString('en-GB')} ${t('mi')}</li><li>${t(c.fuel)}</li><li>${t(c.gearbox)}</li>
        </ul>
        <div class="car__foot">
          <span class="car__loc">${esc(c.town)} · ${c.distance} ${t('mi away')}</span>
          <label class="compare"><input type="checkbox" data-compare="${i}" ${state.compare.has(i) ? 'checked' : ''}/> ${t('Compare')}</label>
        </div>
      </div>
    </article>`;
}

function results(list) {
  if (!list.length) {
    return `
      <div class="empty">
        <h2>${t('No cars match your filters')}</h2>
        <p>${t('Try removing a filter or widening your price range.')}</p>
        <div class="empty__actions">
          ${state.fuels.has('Electric') ? `<button type="button" class="btn btn--secondary" data-remove="fuel:Electric">${t('Remove “Electric”')}</button>` : ''}
          ${state.maxPrice !== null ? `<button type="button" class="btn btn--secondary" data-remove="maxPrice">${t('Remove price limit')}</button>` : ''}
          <button type="button" class="btn btn--primary" data-action="clear">${t('Clear all filters')}</button>
        </div>
      </div>`;
  }
  const shown = list.slice(0, state.shown);
  return `
    <div class="grid">${shown.map((c) => card(c, data.cars.indexOf(c))).join('')}</div>
    ${list.length > shown.length ? `<div class="more"><button type="button" class="btn btn--secondary" data-action="more">${t('Show more cars')}</button></div>` : ''}`;
}

function compareBar() {
  if (!state.compare.size) return '';
  return `
    <div class="compare-bar" role="region" aria-label="${t('Compare cars')}">
      <span><strong>${state.compare.size}</strong> ${t(state.compare.size === 1 ? 'car selected' : 'cars selected')}</span>
      <button type="button" class="link-btn" data-action="clear-compare">${t('Clear')}</button>
      <button type="button" class="btn btn--primary" ${state.compare.size < 2 ? 'disabled' : ''}>${t('Compare now')}</button>
    </div>`;
}

function render() {
  const list = filtered();
  const count = activeFilterCount() ? list.length : data.total;
  app.innerHTML = `
    ${header()}
    <main class="page">
      <div class="page__head">
        <div>
          <h1>${t('Used cars near Bristol')}</h1>
          <p class="page__count"><strong>${count.toLocaleString('en-GB')}</strong> ${t('cars for sale')}</p>
        </div>
        <div class="toolbar">
          <button type="button" class="btn btn--secondary filters-btn" data-action="open-filters">${t('Filters')}${activeFilterCount() ? ` (${activeFilterCount()})` : ''}</button>
          <label class="sort"><span>${t('Sort by')}</span>
            <select data-filter="sort">
              ${[['best', 'Best match'], ['price', 'Lowest price'], ['newest', 'Newest'], ['mileage', 'Lowest mileage']].map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${t(l)}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>
      <div class="layout">
        ${filterPanel(count)}
        <section class="results" aria-label="${t('Results')}">
          ${activeChips()}
          ${results(list)}
        </section>
      </div>
    </main>
    ${state.drawerOpen ? '<div class="scrim" data-action="close-filters"></div>' : ''}
    ${compareBar()}`;
  const filters = document.getElementById('filters');
  if (window.matchMedia('(max-width: 767px)').matches && !state.drawerOpen) filters.setAttribute('inert', '');
}

app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.make) el.checked ? state.makes.add(el.dataset.make) : state.makes.delete(el.dataset.make);
  if (el.dataset.filter === 'minPrice') state.minPrice = el.value ? Number(el.value) : null;
  if (el.dataset.filter === 'maxPrice') state.maxPrice = el.value ? Number(el.value) : null;
  if (el.dataset.filter === 'sort') state.sort = el.value;
  if (el.name === 'mileage') state.mileage = el.value;
  if (el.dataset.compare) {
    const i = Number(el.dataset.compare);
    el.checked ? state.compare.add(i) : state.compare.delete(i);
  }
  render();
});

app.addEventListener('click', (e) => {
  const fuel = e.target.closest('[data-fuel]');
  if (fuel) {
    const f = fuel.dataset.fuel;
    state.fuels.has(f) ? state.fuels.delete(f) : state.fuels.add(f);
    return render();
  }
  const gear = e.target.closest('[data-gearbox]');
  if (gear) {
    state.gearbox = state.gearbox === gear.dataset.gearbox ? null : gear.dataset.gearbox;
    return render();
  }
  const remove = e.target.closest('[data-remove]');
  if (remove) {
    const [kind, value] = remove.dataset.remove.split(':');
    if (kind === 'make') state.makes.delete(value);
    if (kind === 'fuel') state.fuels.delete(value);
    if (kind === 'minPrice') state.minPrice = null;
    if (kind === 'maxPrice') state.maxPrice = null;
    if (kind === 'mileage') state.mileage = 'any';
    if (kind === 'gearbox') state.gearbox = null;
    return render();
  }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'clear') {
    state.makes.clear();
    state.fuels.clear();
    state.minPrice = state.maxPrice = state.gearbox = null;
    state.mileage = 'any';
  }
  if (action === 'open-filters') state.drawerOpen = true;
  if (action === 'close-filters') state.drawerOpen = false;
  if (action === 'more') state.shown += 9;
  if (action === 'clear-compare') state.compare.clear();
  render();
});

window.matchMedia('(max-width: 767px)').addEventListener('change', render);
render();
