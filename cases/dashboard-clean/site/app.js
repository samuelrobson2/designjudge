import { loadData, pseudo } from './data.js';

const { data, expand } = loadData();
const t = (s) => (expand ? pseudo(s) : s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = (n) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const whole = (n) => `£${Math.round(n).toLocaleString('en-GB')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The overview lists the latest orders; older ones are not needed to track this month.
const ORDERS_SHOWN = 10;

const state = { range: 'month' };
const app = document.getElementById('app');
const orderDialog = document.getElementById('order-dialog');

const ICONS = {
  store: '<path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  bag: '<path d="M6 2l-2 4v14a2 2 0 002 2h12a2 2 0 002-2V6l-2-4zM4 6h16M16 10a4 4 0 01-8 0"/>',
  box: '<path d="M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12"/>',
};
const icon = (name, cls = 'icon') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- Shell ----------

function topbar() {
  return `
    <header class="topbar" data-component-id="topbar">
      <div class="topbar__inner">
        <div class="brand"><span class="brand__mark">${icon('store')}</span><span class="brand__name">${esc(data.store)}</span></div>
      </div>
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

function change(cur, prev, points) {
  if (!prev) return '';
  const value = points ? (cur - prev) * 100 : (cur / prev - 1) * 100;
  const up = value >= 0;
  return `<span class="delta ${up ? 'delta--up' : 'delta--down'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span><span class="sr-only">${up ? t('Up') : t('Down')}</span> ${Math.abs(value).toFixed(points ? 2 : 1)}${points ? ` ${t('pts')}` : '%'}</span>`;
}

function kpis() {
  const r = data.ranges[state.range];
  const c = r.totals;
  const p = r.previousTotals;
  const has = c.orders > 0;
  const items = [
    ['orders', t('Orders'), has ? c.orders.toLocaleString('en-GB') : '0', change(c.orders, p.orders)],
    ['aov', t('Average order value'), has ? money(c.aov) : '—', has ? change(c.aov, p.aov) : ''],
    ['conversion', t('Conversion rate'), has ? `${(c.conversion * 100).toFixed(1)}%` : '—', has ? change(c.conversion, p.conversion, true) : ''],
  ];
  return `
    <section class="kpis" aria-label="${t('Key metrics')}" data-component-id="kpis">
      ${items
        .map(
          ([id, label, value, delta]) => `
      <dl class="kpi" data-component-id="kpi-${id}" data-component-type="kpi-card">
        <dt class="kpi__label">${label}</dt>
        <dd class="kpi__value">${value}</dd>
        ${delta ? `<dd class="kpi__delta">${delta}</dd>` : ''}
      </dl>`,
        )
        .join('')}
    </section>`;
}

// ---------- Revenue ----------

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function shortMoney(v) {
  if (v >= 1e6) return `£${+(v / 1e6).toFixed(1)}m`;
  if (v >= 1000) return `£${+(v / 1000).toFixed(1)}k`;
  return `£${v}`;
}

function dayLabel(ts) {
  const d = new Date(ts);
  return `${d.getUTCDate()}<span class="chart__month"> ${MONTHS[d.getUTCMonth()]}</span>`;
}

function chart(r) {
  const cur = r.current.map((d) => d.revenue);
  const prev = r.previous.map((d) => d.revenue);
  if (!cur.length) {
    return `
      <div class="chart chart--empty" data-component-id="revenue-plot" data-component-type="chart">
        <div class="chart-empty">
          ${icon('chart', 'chart-empty__icon')}
          <p class="empty__title">${t('No sales in this period yet')}</p>
          <p class="empty__body">${t('The revenue trend appears here after your first paid order.')}</p>
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
        <span class="legend__item legend__item--cur">${esc(r.period)}</span>
        <span class="legend__item legend__item--prev">${esc(r.previousPeriod)}</span>
      </div>
      <div class="chart__canvas">
        ${ticks
          .map(
            (v, i) =>
              `<span class="chart__tick" style="--f:${i / count}">${shortMoney(v)}</span><span class="chart__grid" style="--f:${i / count}" aria-hidden="true"></span>`,
          )
          .join('')}
        <svg class="chart__svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${t('Revenue per day')}, ${esc(r.period)} ${t('compared with')} ${esc(r.previousPeriod)}">
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
            return `<span class="${align} ${minor}" style="left:${x(i)}%">${dayLabel(r.current[i].t)}</span>`;
          })
          .join('')}
      </div>
    </div>`;
}

function hero() {
  const r = data.ranges[state.range];
  const c = r.totals;
  return `
    <section class="card hero" aria-labelledby="h-revenue" data-component-id="revenue-chart">
      <div class="hero__metric" data-component-id="kpi-revenue">
        <h2 id="h-revenue">${t('Revenue')}</h2>
        <p class="hero__value">${whole(c.revenue)}</p>
        ${change(c.revenue, r.previousTotals.revenue)}
      </div>
      ${chart(r)}
    </section>`;
}

// ---------- Products ----------

function topProducts() {
  const list = data.ranges[state.range].products;
  const max = Math.max(1, ...list.map((p) => p.revenue));
  const body = list.length
    ? `<ol class="products__list">${list
        .map(
          (p) => `
        <li class="product" data-component-type="product-row">
          <div class="product__row"><span class="product__name" title="${esc(p.name)}">${esc(p.name)}</span><span class="product__rev">${whole(p.revenue)}</span></div>
          <div class="bar" aria-hidden="true"><span style="width:${((p.revenue / max) * 100).toFixed(1)}%"></span></div>
          <p class="product__meta">${p.units.toLocaleString('en-GB')} ${t('sold')}</p>
        </li>`,
        )
        .join('')}</ol>`
    : `<div class="empty">
        ${icon('box', 'empty__icon')}
        <p class="empty__title">${t('No products sold yet')}</p>
        <p class="empty__body">${t('Your best sellers appear here after your first sale.')}</p>
      </div>`;
  return `
    <section class="card products" aria-labelledby="h-products" data-component-id="top-products">
      <div class="card__head"><h2 id="h-products">${t('Top products')}</h2>${list.length ? `<p class="card__sub">${t('Ranked by revenue')}</p>` : ''}</div>
      ${body}
    </section>`;
}

// ---------- Orders ----------

const statusBadge = (s) => `<span class="status status--${s.toLowerCase().replace(/\s+/g, '-')}">${t(s)}</span>`;
const itemsLabel = (n) => `${n} ${t(n === 1 ? 'item' : 'items')}`;

function orders() {
  const all = data.orders;
  if (!all.length) {
    return `
      <section class="card orders" aria-labelledby="h-orders" data-component-id="recent-orders">
        <div class="card__head"><h2 id="h-orders">${t('Recent orders')}</h2></div>
        <div class="empty">
          ${icon('bag', 'empty__icon')}
          <p class="empty__title">${t('No orders yet')}</p>
          <p class="empty__body">${t('Share your store link to get your first sale.')}</p>
          <button class="btn btn--primary" type="button" data-action="copy-link">${t('Copy store link')}</button>
        </div>
      </section>`;
  }
  const list = all.slice(0, ORDERS_SHOWN);
  const sub = all.length > list.length ? `${t('The latest')} ${list.length} ${t('orders. Select one to see its items.')}` : t('Select an order to see its items.');
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
            <td class="col-order"><button type="button" class="order-link" data-order="${i}"><span class="sr-only">${t('Order')} </span>${esc(o.id)}</button><span class="order-row__meta">${esc(o.customer)}</span></td>
            <td class="col-customer truncate" title="${esc(o.customer)}">${esc(o.customer)}</td>
            <td class="col-date">${esc(o.date)}, ${o.time}</td>
            <td class="col-items num">${o.items}</td>
            <td class="col-total num">${money(o.total)}</td>
            <td class="col-status">${statusBadge(o.status)}</td>
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </section>`;
}

// ---------- Order details ----------

function openOrder(index) {
  const o = data.orders[index];
  orderDialog.innerHTML = `
    <div class="sheet__inner">
      <div class="sheet__head">
        <div class="sheet__title">
          <h2 id="h-order">${t('Order')} ${esc(o.id)}</h2>
          <p class="sheet__sub">${esc(o.date)}, ${o.time} · ${statusBadge(o.status)}</p>
        </div>
        <button type="button" class="icon-btn icon-btn--outline" data-action="close-order" aria-label="${t('Close')}">${icon('close')}</button>
      </div>
      <div class="sheet__body">
        <section class="sheet__section" aria-labelledby="h-order-items">
          <h3 id="h-order-items">${t('Items')} <span class="sheet__count">${itemsLabel(o.items)}</span></h3>
          <ul class="lines">${o.lines
            .map((l) => `<li><span class="lines__name"><span class="lines__qty">${l.qty} × ${money(l.price)}</span> ${esc(l.name)}</span><span class="lines__amount">${money(l.qty * l.price)}</span></li>`)
            .join('')}</ul>
          <div class="lines__total"><span>${t('Total')}</span><span>${money(o.total)}</span></div>
        </section>
        <section class="sheet__section" aria-labelledby="h-order-customer">
          <h3 id="h-order-customer">${t('Customer')}</h3>
          <p>${esc(o.customer)}</p>
          <p class="muted">${esc(o.email)}</p>
        </section>
      </div>
    </div>`;
  orderDialog.showModal();
}

// ---------- Page ----------

function render() {
  const r = data.ranges[state.range];
  app.innerHTML = `
    ${topbar()}
    <main class="main" id="main">
      <div class="main__inner">
        <div class="page-head">
          <div class="page-head__title">
            <h1>${t('Sales overview')}</h1>
            <p class="page-head__sub">${esc(r.period)}, ${t('compared with')} ${esc(r.previousPeriod)}</p>
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
    </main>`;
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
  const copy = e.target.closest('[data-action="copy-link"]');
  if (copy) {
    navigator.clipboard?.writeText(location.origin).catch(() => {});
    copy.textContent = t('Link copied');
  }
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

orderDialog.addEventListener('click', (e) => {
  // A click on the dialog element itself lands on its backdrop.
  if (e.target === orderDialog || e.target.closest('[data-action="close-order"]')) orderDialog.close();
});

render();
