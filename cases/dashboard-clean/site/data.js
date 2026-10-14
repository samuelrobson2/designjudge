// Content fixtures: ?fixture=empty|typical|dense|expanded|stress, or window.__DJ_FIXTURE__.

export function fixtureName() {
  return new URLSearchParams(location.search).get('fixture') || window.__DJ_FIXTURE__ || 'typical';
}

const ACCENTS = { a: 'á', e: 'é', i: 'í', o: 'ö', u: 'ü', A: 'Á', E: 'É', I: 'Í', O: 'Ö', U: 'Ü', c: 'ç', n: 'ñ', y: 'ý' };
export function pseudo(text) {
  const words = String(text)
    .split(' ')
    .map((w) => {
      if (!/[A-Za-z]/.test(w)) return w;
      const accented = [...w].map((ch) => ACCENTS[ch] || ch).join('');
      const extra = Math.ceil(w.replace(/[^A-Za-z]/g, '').length * 0.4);
      const vowel = accented.match(/[áéíöüÁÉÍÖÜ]/)?.[0] || 'é';
      return accented + vowel.toLowerCase().repeat(extra);
    });
  return `[${words.join(' ')}]`;
}

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;
// The last day with data; the dashboard is viewed on this day.
const TODAY = Date.UTC(2026, 8, 14);

const CUSTOMERS = ['Amara Okafor', 'Liam Chen', 'Sofia Rossi', 'Noah Williams', 'Isla Murphy', 'Arjun Mehta', 'Chloe Martin', 'Ethan Brooks'];
const DENSE_CUSTOMERS = [
  ...CUSTOMERS,
  'Alexandra Montgomery-Whitfield',
  'Oluwaseun Adebayo-Johnson',
  'Maximilian von Hohenberg',
  'Priyanka Venkataraman',
  'Christopher Fitzpatrick-Llewellyn',
  'Zoë Van der Berg',
  'Mohammed Al-Rashid',
  'Genevieve Beaumont-Clarke',
];

// Unit prices, and each product's typical share of store revenue.
const PRODUCTS = [
  { id: 'board', name: 'Walnut serving board', price: 49, share: 0.16 },
  { id: 'shelf', name: 'Oak wall shelf', price: 79, share: 0.13 },
  { id: 'runner', name: 'Linen table runner', price: 35, share: 0.12 },
  { id: 'mugs', name: 'Stoneware mug set', price: 39, share: 0.1 },
  { id: 'candles', name: 'Beeswax candle trio', price: 29, share: 0.08 },
];
const DENSE_PRODUCTS = [
  ...PRODUCTS,
  { id: 'throw', name: 'Wool throw blanket', price: 89, share: 0.07 },
  { id: 'bowl', name: 'Hand-thrown ceramic fruit bowl (large, speckled glaze)', price: 63, share: 0.06 },
  { id: 'baskets', name: 'Rattan storage baskets, set of three', price: 69, share: 0.05 },
  { id: 'can', name: 'Copper watering can', price: 49, share: 0.04 },
  { id: 'servers', name: 'Olive wood salad servers', price: 29, share: 0.03 },
];

// One day's trading, the same whichever range includes it.
function day(t, scale) {
  const i = Math.round(t / DAY_MS);
  const r = rng(1000 + i);
  r();
  const weekday = new Date(t).getUTCDay();
  const weekly = weekday === 0 || weekday === 6 ? 1.18 : weekday === 1 ? 0.9 : 1;
  const trend = 1 + (i - Math.round(TODAY / DAY_MS)) * 0.0012;
  const aov = 44 + (r() - 0.5) * 6;
  const orders = Math.max(1, Math.round(((34 * weekly * trend * (1 + (r() - 0.5) * 0.3)) * scale)));
  const revenue = Math.round(orders * aov);
  const sessions = Math.round(orders / (0.028 + (r() - 0.5) * 0.004));
  return { t, revenue, orders, sessions };
}

const dateText = (t) => {
  const d = new Date(t);
  return { date: d.getUTCDate(), month: MONTHS[d.getUTCMonth()] };
};
function span(from, to) {
  const a = dateText(from);
  const b = dateText(to);
  return a.month === b.month ? `${a.date}–${b.date} ${b.month}` : `${a.date} ${a.month} – ${b.date} ${b.month}`;
}

const RANGES = {
  '7d': { label: '7 days', days: 7 },
  month: { label: 'This month', days: new Date(TODAY).getUTCDate(), sameDaysLastMonth: true },
  '30d': { label: '30 days', days: 30 },
  '90d': { label: '90 days', days: 90 },
};

function totals(days) {
  const revenue = days.reduce((s, d) => s + d.revenue, 0);
  const orders = days.reduce((s, d) => s + d.orders, 0);
  const sessions = days.reduce((s, d) => s + d.sessions, 0);
  return { revenue, orders, aov: orders ? revenue / orders : 0, conversion: sessions ? orders / sessions : 0 };
}

function makeOrders(count, customers, products, perOrderMax) {
  const r = rng(42);
  const out = [];
  // Newest first, a little over an hour apart, ending just before the dashboard is viewed.
  let at = TODAY + 9 * 3600000 + 18 * 60000;
  for (let i = 0; i < count; i++) {
    const lines = [];
    // Most orders are one item, as the average order value implies; larger stores see bigger baskets.
    const roll = r();
    const kinds = perOrderMax > 3 ? 1 + Math.floor(roll * 3) : roll < 0.7 ? 1 : 2;
    const used = new Set();
    while (lines.length < kinds) {
      const p = products[Math.floor(r() * products.length)];
      if (used.has(p.id)) continue;
      used.add(p.id);
      const qty = perOrderMax > 3 ? 1 + Math.floor(r() * 3) : r() < 0.85 ? 1 : 2;
      lines.push({ productId: p.id, name: p.name, qty, price: p.price });
    }
    const d = new Date(at);
    const ageDays = Math.floor((TODAY - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / DAY_MS);
    out.push({
      id: `#${1482 - i}`,
      customer: customers[i % customers.length],
      email: `${customers[i % customers.length].toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.com`,
      date: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
      time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
      lines,
      items: lines.reduce((s, l) => s + l.qty, 0),
      total: lines.reduce((s, l) => s + l.qty * l.price, 0),
      status: ageDays === 0 ? 'To ship' : ageDays === 1 ? 'Shipped' : 'Delivered',
    });
    at -= (55 + Math.floor(r() * 70)) * 60000;
  }
  return out;
}

export function loadData(name = fixtureName()) {
  const dense = name === 'dense' || name === 'stress';
  const expand = name === 'expanded' || name === 'stress';
  const empty = name === 'empty';
  const scale = dense ? 25 : 1;
  const products = empty ? [] : dense ? DENSE_PRODUCTS : PRODUCTS;
  const ranges = {};
  for (const [key, r] of Object.entries(RANGES)) {
    const start = TODAY - (r.days - 1) * DAY_MS;
    const prevEnd = r.sameDaysLastMonth ? Date.UTC(2026, 7, r.days) : start - DAY_MS;
    const prevStart = prevEnd - (r.days - 1) * DAY_MS;
    const current = empty ? [] : Array.from({ length: r.days }, (_, i) => day(start + i * DAY_MS, scale));
    const previous = empty ? [] : Array.from({ length: r.days }, (_, i) => day(prevStart + i * DAY_MS, scale));
    const cur = totals(current);
    ranges[key] = {
      label: r.label,
      period: span(start, TODAY),
      previousPeriod: span(prevStart, prevEnd),
      current,
      previous,
      totals: cur,
      previousTotals: totals(previous),
      products: products
        .map((p) => {
          const units = Math.round((p.share * cur.revenue) / p.price);
          return { ...p, units, revenue: units * p.price };
        })
        .sort((a, b) => b.revenue - a.revenue),
    };
  }
  const data = {
    fixture: name,
    store: 'Oak & Ember',
    orders: empty ? [] : makeOrders(dense ? 24 : 8, dense ? DENSE_CUSTOMERS : CUSTOMERS, products, dense ? 9 : 3),
    ranges,
  };
  if (expand) {
    data.orders = data.orders.map((o) => ({ ...o, customer: pseudo(o.customer), lines: o.lines.map((l) => ({ ...l, name: pseudo(l.name) })) }));
    for (const r of Object.values(data.ranges)) {
      r.label = pseudo(r.label);
      r.products = r.products.map((p) => ({ ...p, name: pseudo(p.name) }));
    }
  }
  return { data, expand };
}
