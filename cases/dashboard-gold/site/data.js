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
const PRODUCTS = [
  { name: 'Walnut serving board', units: 142, revenue: 6958 },
  { name: 'Linen table runner', units: 118, revenue: 4130 },
  { name: 'Stoneware mug set', units: 96, revenue: 3744 },
  { name: 'Beeswax candle trio', units: 88, revenue: 2552 },
  { name: 'Oak wall shelf', units: 41, revenue: 3239 },
];
const DENSE_PRODUCTS = [
  ...PRODUCTS,
  { name: 'Hand-thrown ceramic fruit bowl (large, speckled glaze)', units: 37, revenue: 2331 },
  { name: 'Wool throw blanket', units: 33, revenue: 2937 },
  { name: 'Copper watering can', units: 29, revenue: 1421 },
  { name: 'Rattan storage basket set of three', units: 27, revenue: 1863 },
  { name: 'Olive wood salad servers', units: 24, revenue: 696 },
];
const STATUSES = ['Paid', 'Fulfilled', 'Pending', 'Fulfilled', 'Paid', 'Refunded', 'Fulfilled', 'Paid'];

function series(days, base, rand) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const weekly = Math.sin((i / 7) * Math.PI * 2) * 0.12;
    out.push(Math.round(base * (1 + weekly + (rand() - 0.5) * 0.3 + i * 0.006)));
  }
  return out;
}

const RANGES = {
  '7d': { label: '7 days', days: 7, scale: 0.24 },
  '30d': { label: '30 days', days: 30, scale: 1 },
  month: { label: 'This month', days: 14, scale: 0.52 },
  '12m': { label: '12 months', days: 12, scale: 11.4 },
};

export function loadData(name = fixtureName()) {
  const dense = name === 'dense' || name === 'stress';
  const expand = name === 'expanded' || name === 'stress';
  const empty = name === 'empty';
  const rand = rng(42);
  const customers = dense ? DENSE_CUSTOMERS : CUSTOMERS;
  const orderCount = empty ? 0 : dense ? 24 : 8;
  const orders = Array.from({ length: orderCount }, (_, i) => {
    const items = 1 + Math.floor(rand() * (dense ? 9 : 4));
    const total = Math.round((18 + rand() * (dense ? 900 : 180)) * 100) / 100;
    const day = 14 - Math.floor(i / 2);
    return {
      id: `#${(dense ? 104820 : 1482) - i}`,
      customer: customers[i % customers.length],
      email: `${customers[i % customers.length].split(' ')[0].toLowerCase()}@example.com`,
      date: `${day} Sep`,
      items,
      total,
      status: STATUSES[i % STATUSES.length],
    };
  });
  const multiplier = dense ? 26 : 1;
  const ranges = {};
  for (const [key, r] of Object.entries(RANGES)) {
    const r2 = rng(7 + r.days);
    const current = empty ? [] : series(r.days, (dense ? 41000 : 1600) * (key === '12m' ? 30 : 1), r2);
    const previous = empty ? [] : series(r.days, (dense ? 37000 : 1450) * (key === '12m' ? 30 : 1), r2);
    const revenue = current.reduce((a, b) => a + b, 0);
    ranges[key] = {
      label: r.label,
      current,
      previous,
      kpis: empty
        ? [
            { id: 'revenue', label: 'Revenue', value: '£0', delta: null },
            { id: 'orders', label: 'Orders', value: '0', delta: null },
            { id: 'aov', label: 'Avg. order value', value: '—', delta: null },
            { id: 'conversion', label: 'Conversion rate', value: '—', delta: null },
          ]
        : [
            { id: 'revenue', label: 'Revenue', value: `£${revenue.toLocaleString('en-GB')}`, delta: 12.4 * r.scale ** 0.1 },
            { id: 'orders', label: 'Orders', value: Math.round((revenue / 37.55) * (dense ? 1 : 1)).toLocaleString('en-GB'), delta: 8.1 },
            { id: 'aov', label: 'Avg. order value', value: dense ? '£1,284.72' : '£37.55', delta: 3.9 },
            { id: 'conversion', label: 'Conversion rate', value: '2.9%', delta: -0.3, unit: 'pts' },
          ],
    };
  }
  const data = {
    fixture: name,
    store: 'Oak & Ember',
    owner: 'Maya Patel',
    orders,
    products: empty ? [] : dense ? DENSE_PRODUCTS : PRODUCTS,
    ranges,
    multiplier,
  };
  if (expand) {
    data.orders = data.orders.map((o) => ({ ...o, customer: pseudo(o.customer), status: o.status, date: pseudo(o.date) }));
    data.products = data.products.map((p) => ({ ...p, name: pseudo(p.name) }));
    for (const r of Object.values(data.ranges)) {
      r.label = pseudo(r.label);
      r.kpis = r.kpis.map((k) => ({ ...k, label: pseudo(k.label) }));
    }
  }
  return { data, expand };
}
