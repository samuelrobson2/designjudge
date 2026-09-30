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

const CARS = [
  { make: 'Volkswagen', model: 'Golf', trim: '1.5 TSI Life 5dr', year: 2019, price: 14495, miles: 32400, fuel: 'Petrol', gearbox: 'Manual', body: 'hatch', color: '#2f5d8a', town: 'Bristol', distance: 4, deal: 'great' },
  { make: 'Toyota', model: 'Corolla', trim: '1.8 Hybrid Icon Tech', year: 2021, price: 17950, miles: 21800, fuel: 'Hybrid', gearbox: 'Automatic', body: 'hatch', color: '#b8bcc2', town: 'Bath', distance: 12, deal: 'good' },
  { make: 'Ford', model: 'Puma', trim: '1.0 EcoBoost ST-Line', year: 2020, price: 15250, miles: 28900, fuel: 'Petrol', gearbox: 'Manual', body: 'suv', color: '#a3262a', town: 'Bristol', distance: 6, deal: 'fair' },
  { make: 'Kia', model: 'Niro', trim: '64kWh 2 Long Range', year: 2022, price: 21495, miles: 15300, fuel: 'Electric', gearbox: 'Automatic', body: 'suv', color: '#e8e9eb', town: 'Keynsham', distance: 8, deal: 'great' },
  { make: 'BMW', model: '3 Series', trim: '320d M Sport', year: 2018, price: 16995, miles: 54200, fuel: 'Diesel', gearbox: 'Automatic', body: 'sedan', color: '#1c1f24', town: 'Clevedon', distance: 15, deal: 'good' },
  { make: 'Audi', model: 'A3', trim: '35 TFSI Sport', year: 2020, price: 18750, miles: 26100, fuel: 'Petrol', gearbox: 'Manual', body: 'hatch', color: '#6c7178', town: 'Bristol', distance: 3, deal: 'fair' },
  { make: 'Volkswagen', model: 'Polo', trim: '1.0 TSI Match', year: 2018, price: 9995, miles: 41700, fuel: 'Petrol', gearbox: 'Manual', body: 'hatch', color: '#c9c3b6', town: 'Weston-super-Mare', distance: 19, deal: 'great' },
  { make: 'Toyota', model: 'RAV4', trim: '2.5 VVT-i Hybrid Design', year: 2020, price: 24500, miles: 38800, fuel: 'Hybrid', gearbox: 'Automatic', body: 'suv', color: '#3d4a3a', town: 'Portishead', distance: 10, deal: 'good' },
  { make: 'Ford', model: 'Focus', trim: '1.0 EcoBoost Titanium', year: 2019, price: 11750, miles: 36500, fuel: 'Petrol', gearbox: 'Manual', body: 'hatch', color: '#5b7aa6', town: 'Bristol', distance: 5, deal: 'fair' },
];

const EXTRA = [
  { make: 'Mercedes-Benz', model: 'GLC', trim: 'GLC 300de 4MATIC AMG Line Premium Plus Coupé', year: 2021, price: 38995, miles: 29100, fuel: 'Hybrid', gearbox: 'Automatic', body: 'suv', color: '#2b2e33', town: 'Chipping Sodbury', distance: 17, deal: 'fair' },
  { make: 'Volkswagen', model: 'ID.3', trim: 'Pro Performance Life 58kWh', year: 2022, price: 22495, miles: 12100, fuel: 'Electric', gearbox: 'Automatic', body: 'hatch', color: '#7da3a1', town: 'Bristol', distance: 2, deal: 'great' },
  { make: 'Skoda', model: 'Octavia Estate', trim: '2.0 TDI SE Technology DSG', year: 2019, price: 13995, miles: 61200, fuel: 'Diesel', gearbox: 'Automatic', body: 'sedan', color: '#4a5561', town: 'Thornbury', distance: 14, deal: 'good' },
  { make: 'Hyundai', model: 'Kona', trim: '1.6 GDi Hybrid Premium SE', year: 2021, price: 17495, miles: 19800, fuel: 'Hybrid', gearbox: 'Automatic', body: 'suv', color: '#d6b13b', town: 'Nailsea', distance: 11, deal: 'good' },
  { make: 'Vauxhall', model: 'Corsa', trim: '1.2 Turbo SRi Premium', year: 2020, price: 10250, miles: 24400, fuel: 'Petrol', gearbox: 'Manual', body: 'hatch', color: '#b02b36', town: 'Bristol', distance: 7, deal: 'great' },
  { make: 'Tesla', model: 'Model 3', trim: 'Long Range Dual Motor AWD', year: 2021, price: 27995, miles: 34600, fuel: 'Electric', gearbox: 'Automatic', body: 'sedan', color: '#f2f2f2', town: 'Cribbs Causeway', distance: 9, deal: 'good' },
  { make: 'Nissan', model: 'Qashqai', trim: '1.3 DiG-T MH N-Connecta Xtronic', year: 2022, price: 21250, miles: 17900, fuel: 'Petrol', gearbox: 'Automatic', body: 'suv', color: '#76797e', town: 'Yate', distance: 13, deal: 'fair' },
  { make: 'Peugeot', model: '208', trim: '1.2 PureTech Allure Premium', year: 2021, price: 12495, miles: 22300, fuel: 'Petrol', gearbox: 'Manual', body: 'hatch', color: '#e3a33b', town: 'Bristol', distance: 4, deal: 'good' },
  { make: 'Land Rover', model: 'Range Rover Evoque', trim: '2.0 D200 R-Dynamic SE Mild Hybrid', year: 2020, price: 29995, miles: 41200, fuel: 'Diesel', gearbox: 'Automatic', body: 'suv', color: '#3a3f47', town: 'Frenchay', distance: 6, deal: 'fair' },
  { make: 'Mazda', model: 'CX-5', trim: '2.0 Skyactiv-G Sport Nav+', year: 2019, price: 15995, miles: 39900, fuel: 'Petrol', gearbox: 'Manual', body: 'suv', color: '#8e1f24', town: 'Clevedon', distance: 15, deal: 'great' },
  { make: 'Honda', model: 'Jazz', trim: '1.5 i-MMD Hybrid EX', year: 2021, price: 16750, miles: 14800, fuel: 'Hybrid', gearbox: 'Automatic', body: 'hatch', color: '#9fb4c7', town: 'Bath', distance: 12, deal: 'good' },
  { make: 'Renault', model: 'Clio', trim: '1.0 TCe Iconic', year: 2020, price: 9495, miles: 27100, fuel: 'Petrol', gearbox: 'Manual', body: 'hatch', color: '#e05a2b', town: 'Bristol', distance: 5, deal: 'great' },
  { make: 'Volvo', model: 'XC40', trim: 'Recharge Twin Pure Electric Plus', year: 2022, price: 31995, miles: 11600, fuel: 'Electric', gearbox: 'Automatic', body: 'suv', color: '#5f6e7d', town: 'Keynsham', distance: 8, deal: 'fair' },
  { make: 'Fiat', model: '500', trim: '1.0 Mild Hybrid Dolcevita', year: 2021, price: 9995, miles: 16400, fuel: 'Hybrid', gearbox: 'Manual', body: 'hatch', color: '#a9cfc5', town: 'Portishead', distance: 10, deal: 'good' },
  { make: 'Cupra', model: 'Formentor', trim: '1.5 TSI V2 DSG', year: 2022, price: 25495, miles: 13900, fuel: 'Petrol', gearbox: 'Automatic', body: 'suv', color: '#40464d', town: 'Bristol', distance: 3, deal: 'fair' },
];

export const MAKES = ['Volkswagen', 'Ford', 'Toyota', 'BMW', 'Audi', 'Kia'];

export function loadData(name = fixtureName()) {
  const dense = name === 'dense' || name === 'stress';
  const expand = name === 'expanded' || name === 'stress';
  let cars = name === 'empty' ? [] : dense ? [...CARS, ...EXTRA] : CARS;
  if (expand) cars = cars.map((c) => ({ ...c, trim: pseudo(c.trim), town: pseudo(c.town) }));
  return {
    data: {
      fixture: name,
      cars,
      total: name === 'empty' ? 0 : dense ? 1248 : 248,
      emptyWithFilters: name === 'empty',
    },
    expand,
  };
}
