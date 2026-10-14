// Content fixtures. The harness selects one by name (window.__DJ_FIXTURE__); for manual viewing
// use ?fixture=empty|typical|dense|expanded|stress.

export function fixtureName() {
  const fromQuery = new URLSearchParams(location.search).get('fixture');
  return fromQuery || window.__DJ_FIXTURE__ || 'typical';
}

const ACCENTS = { a: 'á', e: 'é', i: 'í', o: 'ö', u: 'ü', A: 'Á', E: 'É', I: 'Í', O: 'Ö', U: 'Ü', c: 'ç', n: 'ñ', y: 'ý' };

// Pseudo-localization: accented characters, ~40% longer words, bracketed.
export function pseudo(text) {
  const words = String(text).split(' ').map((w) => {
    if (!/[A-Za-z]/.test(w)) return w;
    const accented = [...w].map((ch) => ACCENTS[ch] || ch).join('');
    const extra = Math.ceil(w.replace(/[^A-Za-z]/g, '').length * 0.4);
    const vowel = accented.match(/[áéíöüÁÉÍÖÜ]/)?.[0] || 'é';
    return accented + vowel.toLowerCase().repeat(extra);
  });
  return `[${words.join(' ')}]`;
}

const TREATMENTS = [
  { id: 'initial', name: 'Initial assessment', minutes: 45, price: 65, description: 'For a new injury or condition, with a treatment plan.' },
  { id: 'follow-up', name: 'Follow-up session', minutes: 30, price: 50, description: 'Further treatment after your initial assessment.' },
  { id: 'sports-massage', name: 'Sports massage', minutes: 45, price: 55, description: 'Deep tissue massage to ease tension and aid recovery.' },
  { id: 'pregnancy', name: 'Pregnancy physiotherapy', minutes: 45, price: 70, description: 'For pelvic, hip and back pain during or after pregnancy.' },
];

const DENSE_TREATMENTS = [
  ...TREATMENTS,
  { id: 'acupuncture', name: 'Acupuncture with physiotherapy', minutes: 45, price: 75, description: 'Acupuncture for pain relief, alongside physiotherapy.' },
  { id: 'gait', name: 'Running and gait analysis', minutes: 60, price: 95, description: 'Video analysis of how you run, with exercises to follow.' },
  { id: 'pilates', name: 'Clinical Pilates, one to one', minutes: 55, price: 60, description: 'Supervised rehabilitation exercise, adapted to your injury.' },
  { id: 'shockwave', name: 'Shockwave therapy', minutes: 30, price: 80, description: 'For long-standing tendon pain, such as tennis elbow.' },
];

const PRACTITIONERS = [
  { id: 'priya', name: 'Priya Shah' },
  { id: 'tom', name: 'Tom Evans' },
  { id: 'ana', name: 'Ana Costa' },
];

const DENSE_PRACTITIONERS = [
  ...PRACTITIONERS,
  { id: 'kwame', name: 'Kwame Mensah-Bonsu' },
  { id: 'ellie', name: 'Eleanor Fitzgerald-Hughes' },
  { id: 'jun', name: 'Jun Watanabe' },
];

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');

// Bookable days (Monday to Saturday) from tomorrow.
function makeDates(count) {
  const now = new Date();
  const out = [];
  for (let i = 1; out.length < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (d.getDay() === 0) continue;
    out.push({ id: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, day: DAY[d.getDay()], date: d.getDate(), month: MONTH[d.getMonth()], saturday: d.getDay() === 6 });
  }
  return out;
}

const MORNING = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'];
const AFTERNOON = ['13:30', '14:00', '14:30', '15:00', '15:30', '16:30'];
const DENSE_MORNING = ['08:00', '08:30', ...MORNING, '12:00'];
const DENSE_AFTERNOON = [...AFTERNOON, '17:00', '17:30', '18:00'];

// Which practitioners are free at each time: a fixed pattern, so every load shows the same diary.
function makeAvailability(dates, practitioners, morning, afternoon, empty) {
  const out = {};
  dates.forEach((d, di) => {
    if (empty) {
      out[d.id] = [];
      return;
    }
    const times = [...morning.map((t) => [t, 'morning']), ...(d.saturday ? [] : afternoon.map((t) => [t, 'afternoon']))];
    out[d.id] = times
      .map(([time, period], ti) => ({
        time,
        period,
        practitioners: practitioners.filter((p, pi) => (3 * ti + 2 * di + 5 * pi) % 7 < 2).map((p) => p.id),
      }))
      .filter((s) => s.practitioners.length);
  });
  return out;
}

export function loadData(name = fixtureName()) {
  const dense = name === 'dense' || name === 'stress';
  const expand = name === 'expanded' || name === 'stress';
  const dates = makeDates(18);
  const practitioners = dense ? DENSE_PRACTITIONERS : PRACTITIONERS;
  const data = {
    fixture: name,
    treatments: dense ? DENSE_TREATMENTS : TREATMENTS,
    practitioners,
    dates,
    availability: makeAvailability(dates, practitioners, dense ? DENSE_MORNING : MORNING, dense ? DENSE_AFTERNOON : AFTERNOON, name === 'empty'),
  };
  if (expand) {
    data.treatments = data.treatments.map((t) => ({ ...t, name: pseudo(t.name), description: pseudo(t.description) }));
    data.practitioners = data.practitioners.map((p) => ({ ...p, name: pseudo(p.name) }));
    data.dates = data.dates.map((d) => ({ ...d, day: pseudo(d.day), month: pseudo(d.month) }));
  }
  return { data, expand };
}
