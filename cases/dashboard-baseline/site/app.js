import { loadData, pseudo } from './data.js';

const { data, expand } = loadData();
const t = (s) => (expand ? pseudo(s) : s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = (n) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const state = { range: 'month', order: null, menuOpen: false };
const app = document.getElementById('app');

const ICONS = {
  overview: '<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>',
  orders: '<path d="M6 2l-2 4v14a2 2 0 002 2h12a2 2 0 002-2V6l-2-4zM4 6h16M16 10a4 4 0 01-8 0"/>',
  products: '<path d="M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12"/>',
  customers: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>',
  analytics: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  settings: '<path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

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
      ${items.map(([id, label]) => `<a href="#" class="nav__item ${id === 'overview' ? 'is-active' : ''}" ${id === 'overview' ? 'aria-current="page"' : ''}>${icon(id)}<span>${t(label)}</span></a>`).join('')}
    </nav>`;
}

function sidebar() {
  return `
    <aside class="sidebar" data-component-id="sidebar">
      <div class="brand"><span class="brand__mark" aria-hidden="true">O&amp;E</span><span class="brand__name">${esc(data.store)}</span></div>
      ${nav()}
      <div class="sidebar__user"><span class="avatar" aria-hidden="true">MP</span><span>${esc(data.owner)}</span></div>
    </aside>`;
}

function drawer() {
  return `
    <div class="drawer ${state.menuOpen ? 'is-open' : ''}" ${state.menuOpen ? '' : 'inert'} data-component-id="nav-drawer">
      <div class="drawer__head"><span class="brand__name">${esc(data.store)}</span><button class="icon-btn" data-action="close-menu" aria-label="${t('Close menu')}">${icon('close')}</button></div>
      ${nav()}
    </div>`;
}

function topbar() {
  return `
    <header class="topbar" data-component-id="mobile-topbar">
      <button class="icon-btn" data-action="open-menu" aria-label="${t('Open menu')}">${icon('menu')}</button>
      <span class="brand__name">${esc(data.store)}</span>
      <span class="avatar" aria-hidden="true">MP</span>
    </header>`;
}

function rangeControl() {
  return `
    <div class="segmented" role="radiogroup" aria-label="${t('Date range')}" data-component-id="range-control">
      ${Object.entries(data.ranges)
        .map(([key, r]) => `<button type="button" role="radio" aria-checked="${state.range === key}" class="segmented__btn ${state.range === key ? 'is-selected' : ''}" data-range="${key}">${esc(r.label)}</button>`)
        .join('')}
    </div>`;
}

function sparkline(values) {
  if (!values.length) return '';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / Math.max(1, max - min)) * 26 - 2}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

function kpis() {
  const r = data.ranges[state.range];
  return `
    <section class="kpis" aria-label="${t('Key metrics')}" data-component-id="kpis">
      ${r.kpis
        .map((k) => {
          const up = k.delta !== null && k.delta >= 0;
          const delta =
            k.delta === null
              ? `<span class="delta delta--none">${t('No data yet')}</span>`
              : `<span class="delta ${up ? 'delta--up' : 'delta--down'}">${up ? '▲' : '▼'} ${Math.abs(k.delta).toFixed(1)}${k.unit ? ` ${k.unit}` : '%'}</span><span class="delta__label">${t('vs previous period')}</span>`;
          return `
          <article class="kpi" data-component-id="kpi-${k.id}" data-component-type="kpi-card">
            <h2 class="kpi__label">${esc(k.label)}</h2>
            <p class="kpi__value">${esc(k.value)}</p>
            <div class="kpi__foot">${delta}</div>
            <div class="kpi__spark ${up ? 'is-up' : 'is-down'}">${sparkline(r.current.slice(-12))}</div>
          </article>`;
        })
        .join('')}
    </section>`;
}

function chart() {
  const r = data.ranges[state.range];
  const cur = r.current;
  const prev = r.previous;
  if (!cur.length) {
    return `
      <section class="card chart-card" aria-labelledby="h-revenue" data-component-id="revenue-chart">
        <div class="card__head"><h2 id="h-revenue">${t('Revenue')}</h2></div>
        <div class="empty">
          <p class="empty__title">${t('No sales in this period yet')}</p>
          <p class="empty__body">${t('Revenue will appear here as soon as your first order is paid.')}</p>
        </div>
      </section>`;
  }
  const max = Math.max(...cur, ...prev) * 1.1;
  const W = 100;
  const H = 100;
  const x = (i) => (i / (cur.length - 1)) * W;
  const y = (v) => H - (v / max) * H;
  const line = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const area = `${line(cur)} L${W},${H} L0,${H} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((max * f) / 100) * 100);
  const labels = cur.map((_, i) => i).filter((i) => i % Math.ceil(cur.length / 6) === 0 || i === cur.length - 1);
  return `
    <section class="card chart-card" aria-labelledby="h-revenue" data-component-id="revenue-chart">
      <div class="card__head">
        <div>
          <h2 id="h-revenue">${t('Revenue')}</h2>
          <p class="card__sub">${esc(r.label)} · ${t('compared with the previous period')}</p>
        </div>
        <div class="legend"><span class="legend__item legend__item--cur">${t('This period')}</span><span class="legend__item legend__item--prev">${t('Previous period')}</span></div>
      </div>
      <div class="chart" data-component-type="chart" data-component-id="revenue-plot">
        <div class="chart__y">${ticks.slice().reverse().map((v) => `<span>£${v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v}</span>`).join('')}</div>
        <div class="chart__plot">
          <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${t('Revenue line chart')}">
            ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" class="grid" vector-effect="non-scaling-stroke"/>`).join('')}
            <path d="${area}" class="area"/>
            <path d="${line(prev)}" class="line line--prev" vector-effect="non-scaling-stroke"/>
            <path d="${line(cur)}" class="line line--cur" vector-effect="non-scaling-stroke"/>
          </svg>
          <div class="chart__x">${labels.map((i) => `<span style="left:${x(i)}%">${state.range === '12m' ? ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'][i] : `${i + 1}`}</span>`).join('')}</div>
        </div>
      </div>
    </section>`;
}

function topProducts() {
  const list = data.products;
  const max = Math.max(1, ...list.map((p) => p.revenue));
  return `
    <section class="card products-card" aria-labelledby="h-products" data-component-id="top-products">
      <div class="card__head"><h2 id="h-products">${t('Top products')}</h2><a href="#" class="link">${t('View all')}</a></div>
      ${
        list.length
          ? `<ol class="products">${list
              .map(
                (p) => `
            <li class="product" data-component-type="product-row">
              <div class="product__row"><span class="product__name">${esc(p.name)}</span><span class="product__rev">£${p.revenue.toLocaleString('en-GB')}</span></div>
              <div class="bar"><span style="width:${(p.revenue / max) * 100}%"></span></div>
              <span class="product__units">${p.units} ${t('sold')}</span>
            </li>`,
              )
              .join('')}</ol>`
          : `<div class="empty"><p class="empty__title">${t('No products sold yet')}</p><p class="empty__body">${t('Your best sellers will appear here after your first sale.')}</p></div>`
      }
    </section>`;
}

function statusBadge(s) {
  return `<span class="status status--${s.toLowerCase()}">${t(s)}</span>`;
}

function orders() {
  const list = data.orders;
  if (!list.length) {
    return `
      <section class="card orders-card" aria-labelledby="h-orders" data-component-id="recent-orders">
        <div class="card__head"><h2 id="h-orders">${t('Recent orders')}</h2></div>
        <div class="empty">
          <p class="empty__title">${t('No orders yet')}</p>
          <p class="empty__body">${t('Share your store link to get your first sale.')}</p>
          <button class="btn btn--primary" type="button">${t('Copy store link')}</button>
        </div>
      </section>`;
  }
  return `
    <section class="card orders-card" aria-labelledby="h-orders" data-component-id="recent-orders">
      <div class="card__head"><h2 id="h-orders">${t('Recent orders')}</h2><a href="#" class="link">${t('View all orders')}</a></div>
      <table class="orders-table">
        <thead><tr><th>${t('Order')}</th><th>${t('Customer')}</th><th>${t('Date')}</th><th class="num">${t('Items')}</th><th class="num">${t('Total')}</th><th>${t('Status')}</th></tr></thead>
        <tbody>
          ${list
            .map(
              (o, i) => `
            <tr class="order-row" data-order="${i}" tabindex="0" data-component-type="order-row">
              <td class="mono">${esc(o.id)}</td><td>${esc(o.customer)}</td><td>${esc(o.date)}</td><td class="num">${o.items}</td><td class="num">${money(o.total)}</td><td>${statusBadge(o.status)}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      <ul class="orders-list">
        ${list
          .map(
            (o, i) => `
          <li><button type="button" class="order-card" data-order="${i}" data-component-type="order-card">
            <span class="order-card__top"><span class="mono">${esc(o.id)}</span>${statusBadge(o.status)}</span>
            <span class="order-card__customer">${esc(o.customer)}</span>
            <span class="order-card__meta">${esc(o.date)} · ${o.items} ${t(o.items === 1 ? 'item' : 'items')}<span class="order-card__total">${money(o.total)}</span></span>
          </button></li>`,
          )
          .join('')}
      </ul>
    </section>`;
}

function orderPanel() {
  if (state.order === null) return '';
  const o = data.orders[state.order];
  const lines = data.products.slice(0, Math.min(o.items, 3));
  return `
    <div class="scrim" data-action="close-order"></div>
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="h-order" data-component-id="order-panel">
      <div class="panel__head">
        <div><h2 id="h-order">${t('Order')} ${esc(o.id)}</h2><p class="card__sub">${esc(o.date)} · ${esc(o.customer)}</p></div>
        <button class="icon-btn" data-action="close-order" aria-label="${t('Close')}">${icon('close')}</button>
      </div>
      <div class="panel__body">
        ${statusBadge(o.status)}
        <h3>${t('Items')}</h3>
        <ul class="panel__lines">${lines.map((p) => `<li><span>${esc(p.name)}</span><span>${money(p.revenue / p.units)}</span></li>`).join('')}</ul>
        <div class="panel__total"><span>${t('Total')}</span><span>${money(o.total)}</span></div>
        <h3>${t('Customer')}</h3>
        <p>${esc(o.customer)}<br/><span class="muted">${esc(o.email)}</span></p>
        <h3>${t('Shipping address')}</h3>
        <p>14 Mill Lane<br/>Bristol BS1 4DJ</p>
      </div>
      <div class="panel__actions">
        <button class="btn btn--secondary" type="button">${t('Refund')}</button>
        <button class="btn btn--primary" type="button">${t('Mark as fulfilled')}</button>
      </div>
    </div>`;
}

function render() {
  app.innerHTML = `
    ${sidebar()}
    ${topbar()}
    ${drawer()}
    <main class="main" id="main">
      <div class="page-head">
        <div>
          <h1>${t('Overview')}</h1>
          <p class="page-head__sub">${t('Sales performance for')} ${esc(data.ranges[state.range].label.toLowerCase())}</p>
        </div>
        <div class="page-head__actions">${rangeControl()}<button class="btn btn--secondary" type="button">${t('Export')}</button></div>
      </div>
      ${kpis()}
      <div class="row-2">${chart()}${topProducts()}</div>
      ${orders()}
    </main>
    ${orderPanel()}`;
}

app.addEventListener('click', (e) => {
  const range = e.target.closest('[data-range]');
  if (range) {
    state.range = range.dataset.range;
    return render();
  }
  const order = e.target.closest('[data-order]');
  if (order) {
    state.order = Number(order.dataset.order);
    return render();
  }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'close-order') state.order = null;
  if (action === 'open-menu') state.menuOpen = true;
  if (action === 'close-menu') state.menuOpen = false;
  if (action) render();
});

render();
