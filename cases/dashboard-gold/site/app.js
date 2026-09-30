import { loadData, pseudo } from './data.js';

const { data, expand } = loadData();
const t = (s) => (expand ? pseudo(s) : s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = (n) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The dashboard shows the latest orders only; the full list lives on the Orders page.
const ORDERS_SHOWN = 10;
const END_DATE = new Date(Date.UTC(2026, 8, 14));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const state = { range: 'month' };
const app = document.getElementById('app');
const navDialog = document.getElementById('nav-dialog');
const orderDialog = document.getElementById('order-dialog');

const ICONS = {
  overview: '<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>',
  orders: '<path d="M6 2l-2 4v14a2 2 0 002 2h12a2 2 0 002-2V6l-2-4zM4 6h16M16 10a4 4 0 01-8 0"/>',
  products: '<path d="M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12"/>',
  customers: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>',
  analytics: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  settings: '<path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  bag: '<path d="M6 2l-2 4v14a2 2 0 002 2h12a2 2 0 002-2V6l-2-4zM4 6h16M16 10a4 4 0 01-8 0"/>',
  box: '<path d="M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12"/>',
};
const icon = (name, cls = 'icon') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- Shell ----------

function nav() {
  const items = [
    ['overview', 'Overview'],
    ['orders', 'Orders'],
    ['products', 'Products'],
    ['customers', 'Customers'],
    ['analytics', 'Analytics'],
    ['settings', 'Settings'],
  ];
  return `
    <nav class="nav" aria-label="${t('Main')}">
      ${items
        .map(
          ([id, label]) =>
            `<a href="#" class="nav__item ${id === 'overview' ? 'is-active' : ''}" ${id === 'overview' ? 'aria-current="page"' : ''}>${icon(id)}<span class="nav__label">${t(label)}</span></a>`,
        )
        .join('')}
    </nav>`;
}

const brand = () =>
  `<div class="brand"><span class="brand__mark" aria-hidden="true">O&amp;E</span><span class="brand__name">${esc(data.store)}</span></div>`;
const user = () => `<div class="user"><span class="avatar" aria-hidden="true">MP</span><span class="user__name">${esc(data.owner)}</span></div>`;

function sidebar() {
  return `
    <aside class="sidebar" data-component-id="sidebar">
      <div class="sidebar__inner">${brand()}${nav()}${user()}</div>
    </aside>`;
}

function topbar() {
  return `
    <header class="topbar" data-component-id="mobile-topbar">
      <button type="button" class="icon-btn" data-action="open-menu" aria-label="${t('Open menu')}">${icon('menu')}</button>
      ${brand()}
      <span class="avatar topbar__avatar" role="img" aria-label="${esc(data.owner)}">MP</span>
    </header>`;
}

function rangeControl() {
  return `
    <div class="segmented" role="radiogroup" aria-label="${t('Date range')}" data-component-id="range-control">
      ${Object.entries(data.ranges)
        .map(
          ([key, r]) =>
            `<button type="button" role="radio" aria-checked="${state.range === key}" tabindex="${state.range === key ? 0 : -1}" class="segmented__btn ${state.range === key ? 'is-selected' : ''}" data-range="${key}">${esc(r.label)}</button>`,
        )
        .join('')}
    </div>`;
}

// ---------- Metrics ----------

function delta(k) {
  if (k.delta === null) return `<p class="delta-line"><span class="delta delta--none">${t('No data yet')}</span></p>`;
  const up = k.delta >= 0;
  const amount = `${Math.abs(k.delta).toFixed(1)}${k.unit ? ` ${k.unit}` : '%'}`;
  return `<p class="delta-line"><span class="delta ${up ? 'delta--up' : 'delta--down'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span><span class="sr-only">${up ? t('Up') : t('Down')}</span> ${amount}</span><span class="delta__label">${t('vs previous period')}</span></p>`;
}

function kpis() {
  const r = data.ranges[state.range];
  return `
    <section class="kpis" aria-label="${t('Key metrics')}" data-component-id="kpis">
      ${r.kpis
        .slice(1)
        .map(
          (k) => `
        <article class="kpi" data-component-id="kpi-${k.id}" data-component-type="kpi-card">
          <h2 class="kpi__label">${esc(k.label)}</h2>
          <p class="kpi__value">${esc(k.value)}</p>
          ${delta(k)}
        </article>`,
        )
        .join('')}
    </section>`;
}

// ---------- Revenue hero ----------

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function shortMoney(v) {
  if (v >= 1e6) return `£${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1000) return `£${+(v / 1000).toFixed(1)}k`;
  return `£${v}`;
}

function xLabel(n, i) {
  if (state.range === '12m') return MONTHS[(8 - (n - 1 - i) + 24) % 12];
  const d = new Date(END_DATE);
  d.setUTCDate(END_DATE.getUTCDate() - (n - 1 - i));
  return `${d.getUTCDate()}<span class="chart__month"> ${MONTHS[d.getUTCMonth()]}</span>`;
}

function chart(r) {
  const cur = r.current;
  const prev = r.previous;
  if (!cur.length) {
    return `
      <div class="chart chart--empty" data-component-id="revenue-plot" data-component-type="chart">
        <div class="chart-empty">
          ${icon('chart', 'chart-empty__icon')}
          <p class="empty__title">${t('No sales in this period yet')}</p>
          <p class="empty__body">${t('Your revenue trend will appear here as soon as your first order is paid.')}</p>
        </div>
      </div>`;
  }
  const n = cur.length;
  const max = Math.max(...cur, ...prev);
  const step = niceStep(max / 4);
  const count = Math.ceil(max / step);
  const top = step * count;
  const x = (i) => (i / (n - 1)) * 100;
  const y = (v) => 100 - (v / top) * 100;
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const ticks = Array.from({ length: count + 1 }, (_, i) => step * (count - i));
  const labelStep = Math.ceil(n / 7);
  const labels = [];
  for (let i = n - 1; i >= 0; i -= labelStep) labels.unshift(i);
  const isMinor = (i) => (n - 1 - i) % (labelStep * 2) !== 0;
  const firstMajor = labels.find((i) => !isMinor(i));
  const last = cur[n - 1];
  return `
    <div class="chart" data-component-id="revenue-plot" data-component-type="chart">
      <div class="legend">
        <span class="legend__item legend__item--cur">${t('This period')}</span>
        <span class="legend__item legend__item--prev">${t('Previous period')}</span>
      </div>
      <div class="chart__canvas">
        ${ticks
          .map(
            (v, i) =>
              `<span class="chart__tick" style="--f:${i / count}">${shortMoney(v)}</span><span class="chart__grid" style="--f:${i / count}" aria-hidden="true"></span>`,
          )
          .join('')}
        <svg class="chart__svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${t('Revenue per day, this period compared with the previous period')}">
          <defs><linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#b4532a" stop-opacity="0.16"/><stop offset="1" stop-color="#b4532a" stop-opacity="0"/></linearGradient></defs>
          <path d="${path(cur)} L100,100 L0,100 Z" fill="url(#area-fill)"/>
          <path d="${path(prev)}" class="line line--prev" vector-effect="non-scaling-stroke"/>
          <path d="${path(cur)}" class="line line--cur" vector-effect="non-scaling-stroke"/>
        </svg>
        <span class="chart__dot" style="--x:1;--y:${(y(last) / 100).toFixed(4)}" aria-hidden="true"></span>
      </div>
      <div class="chart__x" aria-hidden="true">
        ${labels
          .map((i) => {
            const pos = x(i) / 100;
            const align = pos < 0.1 ? 'is-start' : pos > 0.9 ? 'is-end' : '';
            const minor = isMinor(i) ? 'is-minor' : i === firstMajor ? 'is-first' : '';
            return `<span class="${align} ${minor}" style="left:${x(i)}%">${xLabel(n, i)}</span>`;
          })
          .join('')}
      </div>
    </div>`;
}

function hero() {
  const r = data.ranges[state.range];
  const k = r.kpis[0];
  return `
    <section class="card hero" aria-labelledby="h-revenue" data-component-id="revenue-chart">
      <div class="hero__metric" data-component-id="kpi-revenue">
        <h2 class="hero__label" id="h-revenue">${esc(k.label)} <span class="hero__period">· ${esc(r.label)}</span></h2>
        <p class="hero__value">${esc(k.value)}</p>
        ${delta(k)}
      </div>
      ${chart(r)}
    </section>`;
}

// ---------- Products ----------

function topProducts() {
  const list = data.products;
  const max = Math.max(1, ...list.map((p) => p.revenue));
  const body = list.length
    ? `<ol class="products__list">${list
        .map(
          (p) => `
        <li class="product" data-component-type="product-row">
          <div class="product__row"><span class="product__name" title="${esc(p.name)}">${esc(p.name)}</span><span class="product__rev">£${p.revenue.toLocaleString('en-GB')}</span></div>
          <div class="bar" aria-hidden="true"><span style="width:${((p.revenue / max) * 100).toFixed(1)}%"></span></div>
          <p class="product__meta">${p.units} ${t('sold')}</p>
        </li>`,
        )
        .join('')}</ol>
      <div class="card__foot"><a href="#" class="link">${t('View all products')}<span aria-hidden="true"> →</span></a></div>`
    : `<div class="empty">
        ${icon('box', 'empty__icon')}
        <p class="empty__title">${t('No products sold yet')}</p>
        <p class="empty__body">${t('Your best sellers will appear here after your first sale.')}</p>
      </div>`;
  return `
    <section class="card products" aria-labelledby="h-products" data-component-id="top-products">
      <div class="card__head"><h2 id="h-products">${t('Top products')}</h2><p class="card__sub">${t('Ranked by revenue')}</p></div>
      ${body}
    </section>`;
}

// ---------- Orders ----------

const statusBadge = (s) => `<span class="status status--${s.toLowerCase()}">${t(s)}</span>`;
const itemsLabel = (n) => `${n} ${t(n === 1 ? 'item' : 'items')}`;

function orders() {
  const all = data.orders;
  if (!all.length) {
    return `
      <section class="card orders" aria-labelledby="h-orders" data-component-id="recent-orders">
        <div class="card__head"><h2 id="h-orders">${t('Recent orders')}</h2><p class="card__sub">${t('New orders appear here as they come in')}</p></div>
        <div class="empty">
          ${icon('bag', 'empty__icon')}
          <p class="empty__title">${t('No orders yet')}</p>
          <p class="empty__body">${t('Share your store link to get your first sale.')}</p>
          <button class="btn btn--primary" type="button">${t('Copy store link')}</button>
        </div>
      </section>`;
  }
  const list = all.slice(0, ORDERS_SHOWN);
  const sub =
    all.length > list.length
      ? `${t('Latest')} ${list.length} ${t('of')} ${all.length} · ${t('select an order for details')}`
      : `${t('Select an order for details')}`;
  return `
    <section class="card orders" aria-labelledby="h-orders" data-component-id="recent-orders">
      <div class="card__head"><h2 id="h-orders">${t('Recent orders')}</h2><p class="card__sub">${sub}</p></div>
      <table class="orders__table">
        <thead><tr>
          <th scope="col" class="col-order">${t('Order')}</th>
          <th scope="col" class="col-customer">${t('Customer')}</th>
          <th scope="col" class="col-date">${t('Date')}</th>
          <th scope="col" class="col-items num">${t('Items')}</th>
          <th scope="col" class="col-total num">${t('Total')}</th>
          <th scope="col" class="col-status">${t('Status')}</th>
        </tr></thead>
        <tbody>
          ${list
            .map(
              (o, i) => `
          <tr class="order-row" data-order="${i}" data-component-type="order-row">
            <td class="col-order"><button type="button" class="order-link mono" data-order="${i}">${esc(o.id)}</button><span class="order-row__date">${esc(o.date)}</span></td>
            <td class="col-customer truncate" title="${esc(o.customer)}">${esc(o.customer)}</td>
            <td class="col-date truncate" title="${esc(o.date)}">${esc(o.date)}</td>
            <td class="col-items num">${o.items}</td>
            <td class="col-total num">${money(o.total)}</td>
            <td class="col-status">${statusBadge(o.status)}</td>
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      <ul class="orders__list">
        ${list
          .map(
            (o, i) => `
        <li><button type="button" class="order-card" data-order="${i}" data-component-type="order-card">
          <span class="order-card__line"><span class="order-card__customer truncate" title="${esc(o.customer)}">${esc(o.customer)}</span><span class="order-card__total">${money(o.total)}</span></span>
          <span class="order-card__line"><span class="order-card__meta truncate"><span class="mono">${esc(o.id)}</span> · ${esc(o.date)} · ${itemsLabel(o.items)}</span>${statusBadge(o.status)}</span>
        </button></li>`,
          )
          .join('')}
      </ul>
      <div class="card__foot"><a href="#" class="link">${all.length > list.length ? `${t('View all')} ${all.length} ${t('orders')}` : t('View all orders')}<span aria-hidden="true"> →</span></a></div>
    </section>`;
}

// ---------- Dialogs ----------

function orderLines(o) {
  const products = data.products.length ? data.products : [{ name: t('Item'), units: 1, revenue: 1 }];
  const lines = products.slice(0, Math.min(o.items, 3)).map((p, i, arr) => ({
    name: p.name,
    qty: Math.floor(o.items / arr.length) + (i < o.items % arr.length ? 1 : 0),
    price: p.revenue / p.units,
  }));
  const weight = lines.reduce((s, l) => s + l.qty * l.price, 0);
  let rest = o.total;
  return lines.map((l, i) => {
    const amount = i === lines.length - 1 ? Math.round(rest * 100) / 100 : Math.round(((o.total * l.qty * l.price) / weight) * 100) / 100;
    rest -= amount;
    return { ...l, amount };
  });
}

function openOrder(index) {
  const o = data.orders[index];
  orderDialog.innerHTML = `
    <div class="sheet__inner">
      <div class="sheet__head">
        <div class="sheet__title">
          <h2 id="h-order">${t('Order')} <span class="mono">${esc(o.id)}</span></h2>
          <p class="sheet__sub">${esc(o.date)} · ${esc(o.customer)}</p>
        </div>
        <button type="button" class="icon-btn icon-btn--outline" data-action="close-order" aria-label="${t('Close')}">${icon('close')}</button>
      </div>
      <div class="sheet__body">
        <div class="sheet__summary">
          <div><p class="sheet__label">${t('Status')}</p>${statusBadge(o.status)}</div>
          <div class="sheet__total"><p class="sheet__label">${t('Total')}</p><p class="sheet__amount">${money(o.total)}</p></div>
        </div>
        <section class="sheet__section" aria-labelledby="h-order-items">
          <h3 id="h-order-items">${t('Items')} <span class="sheet__count">${itemsLabel(o.items)}</span></h3>
          <ul class="lines">${orderLines(o)
            .map((l) => `<li><span class="lines__name"><span class="lines__qty">${l.qty} ×</span> ${esc(l.name)}</span><span class="lines__amount">${money(l.amount)}</span></li>`)
            .join('')}</ul>
          <div class="lines__total"><span>${t('Total')}</span><span>${money(o.total)}</span></div>
        </section>
        <section class="sheet__section" aria-labelledby="h-order-customer">
          <h3 id="h-order-customer">${t('Customer')}</h3>
          <p>${esc(o.customer)}</p>
          <p class="muted">${esc(o.email)}</p>
        </section>
        <section class="sheet__section" aria-labelledby="h-order-ship">
          <h3 id="h-order-ship">${t('Shipping address')}</h3>
          <p>14 Mill Lane<br />Bristol BS1 4DJ<br />${t('United Kingdom')}</p>
        </section>
      </div>
      <div class="sheet__actions">
        <button class="btn btn--secondary" type="button">${t('Refund')}</button>
        <button class="btn btn--primary" type="button">${t('Mark as fulfilled')}</button>
      </div>
    </div>`;
  orderDialog.showModal();
}

function openMenu() {
  navDialog.setAttribute('aria-label', t('Menu'));
  navDialog.innerHTML = `
    <div class="drawer__inner">
      <div class="drawer__head">${brand()}<button type="button" class="icon-btn icon-btn--outline" data-action="close-menu" aria-label="${t('Close menu')}">${icon('close')}</button></div>
      ${nav()}
      ${user()}
    </div>`;
  navDialog.showModal();
}

// ---------- Page ----------

function render() {
  const r = data.ranges[state.range];
  app.innerHTML = `
    ${sidebar()}
    <div class="frame">
      ${topbar()}
      <main class="main" id="main">
        <div class="main__inner">
          <div class="page-head">
            <div class="page-head__title">
              <h1>${t('Overview')}</h1>
              <p class="page-head__sub">${t('Sales performance for')} ${esc(r.label.toLowerCase())}</p>
            </div>
            ${rangeControl()}
          </div>
          <div class="dash">
            ${hero()}
            ${kpis()}
            ${orders()}
            ${topProducts()}
          </div>
        </div>
      </main>
    </div>`;
}

app.addEventListener('click', (e) => {
  const range = e.target.closest('[data-range]');
  if (range) {
    state.range = range.dataset.range;
    render();
    app.querySelector(`[data-range="${state.range}"]`)?.focus();
    return;
  }
  const order = e.target.closest('[data-order]');
  if (order) return openOrder(Number(order.dataset.order));
  if (e.target.closest('[data-action="open-menu"]')) openMenu();
});

app.addEventListener('keydown', (e) => {
  const btn = e.target.closest('[data-range]');
  if (!btn || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const keys = Object.keys(data.ranges);
  const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
  state.range = keys[(keys.indexOf(btn.dataset.range) + dir + keys.length) % keys.length];
  render();
  app.querySelector(`[data-range="${state.range}"]`)?.focus();
});

for (const dialog of [navDialog, orderDialog]) {
  dialog.addEventListener('click', (e) => {
    // A click on the dialog element itself lands on its backdrop.
    if (e.target === dialog || e.target.closest('[data-action="close-order"], [data-action="close-menu"]')) dialog.close();
  });
}

render();
