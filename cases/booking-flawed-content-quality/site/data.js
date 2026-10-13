// Content fixtures. The harness selects one by name (window.__DJ_FIXTURE__); for manual viewing
// use ?fixture=empty|typical|dense|expanded|stress.

export function fixtureName() {
  const fromQuery = new URLSearchParams(location.search).get('fixture');
  return fromQuery || window.__DJ_FIXTURE__ || 'typical';
}

const ACCENTS = { a: 'á', e: 'é', i: 'í', o: 'ö', u: 'ü', A: 'Á', E: 'É', I: 'Í', O: 'Ö', U: 'Ü', c: 'ç', n: 'ñ', y: 'ý' };

// Pseudo-localization: accented characters, ~40% longer words, bracketed.
export function pseudo(text) {
  const words = text.split(' ').map((w) => {
    if (!/[A-Za-z]/.test(w)) return w;
    const accented = [...w].map((ch) => ACCENTS[ch] || ch).join('');
    const extra = Math.ceil(w.replace(/[^A-Za-z]/g, '').length * 0.4);
    const vowel = accented.match(/[áéíöüÁÉÍÖÜ]/)?.[0] || 'é';
    return accented + vowel.toLowerCase().repeat(extra);
  });
  return `[${words.join(' ')}]`;
}

const TREATMENTS = [
  { id: 'initial', name: 'Initial assessment', minutes: 45, price: 65, description: 'A full assessment and treatment plan for a new injury or condition.' },
  { id: 'follow-up', name: 'Follow-up session', minutes: 30, price: 50, description: 'Continue treatment with the physio you saw last time.' },
  { id: 'sports-massage', name: 'Sports massage', minutes: 45, price: 55, description: 'Deep tissue massage for recovery and muscle tension.' },
  { id: 'pregnancy', name: 'Pregnancy physio', minutes: 45, price: 70, description: 'Specialist care for pelvic and back pain during and after pregnancy.' },
];

const DENSE_TREATMENTS = [
  ...TREATMENTS,
  { id: 'acupuncture', name: 'Acupuncture add-on', minutes: 20, price: 30, description: 'Western medical acupuncture alongside a physiotherapy session, for pain relief.' },
  { id: 'gait', name: 'Running and gait analysis', minutes: 60, price: 95, description: 'Video analysis of your running technique with a tailored strengthening programme.' },
  { id: 'pilates', name: 'Clinical Pilates (1:1)', minutes: 55, price: 60, description: 'Supervised rehabilitation exercise on reformer equipment, adapted to your injury.' },
  { id: 'shockwave', name: 'Shockwave therapy', minutes: 30, price: 80, description: 'For persistent tendon problems such as tennis elbow, plantar fasciitis, and Achilles pain.' },
];

const PRACTITIONERS = [
  { id: 'any', name: 'Any available', initials: '' },
  { id: 'priya', name: 'Priya Shah', initials: 'PS' },
  { id: 'tom', name: 'Tom Evans', initials: 'TE' },
  { id: 'ana', name: 'Ana Costa', initials: 'AC' },
];

const DENSE_PRACTITIONERS = [
  ...PRACTITIONERS,
  { id: 'kwame', name: 'Kwame Mensah-Bonsu', initials: 'KM' },
  { id: 'ellie', name: 'Eleanor Fitzgerald-Hughes', initials: 'EF' },
  { id: 'jun', name: 'Jun Watanabe', initials: 'JW' },
];

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function makeDates(count) {
  const start = new Date(2026, 8, 14);
  const out = [];
  for (let i = 0; out.length < count; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (d.getDay() === 0) continue;
    out.push({ id: d.toISOString().slice(0, 10), day: DAY[d.getDay()], date: d.getDate(), month: MONTH[d.getMonth()] });
  }
  return out;
}

function makeSlots(dates, morning, afternoon, emptyAll) {
  const slots = {};
  const morningTimes = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30'];
  const afternoonTimes = ['13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00'];
  dates.forEach((d, di) => {
    if (emptyAll) {
      slots[d.id] = [];
      return;
    }
    const m = morningTimes.slice(0, morning).map((t, i) => ({ time: t, period: 'morning', available: (i + di) % 4 !== 1 }));
    const a = afternoonTimes.slice(0, afternoon).map((t, i) => ({ time: t, period: 'afternoon', available: (i + di) % 5 !== 2 }));
    slots[d.id] = [...m, ...a];
  });
  return slots;
}

export function loadData(name = fixtureName()) {
  const dense = name === 'dense' || name === 'stress';
  const expand = name === 'expanded' || name === 'stress';
  const dates = makeDates(dense ? 12 : 6);
  const data = {
    fixture: name,
    treatments: dense ? DENSE_TREATMENTS : TREATMENTS,
    practitioners: dense ? DENSE_PRACTITIONERS : PRACTITIONERS,
    dates,
    slots: makeSlots(dates, dense ? 10 : 4, dense ? 10 : 4, name === 'empty'),
  };
  if (expand) {
    data.treatments = data.treatments.map((t) => ({ ...t, name: pseudo(t.name), description: pseudo(t.description) }));
    data.practitioners = data.practitioners.map((p) => ({ ...p, name: pseudo(p.name) }));
    data.dates = data.dates.map((d) => ({ ...d, day: pseudo(d.day), month: pseudo(d.month) }));
  }
  return { data, expand };
}
