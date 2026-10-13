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

// `average` is the average asking price of similar cars (same model, age and mileage band);
// distances are from the sample postcode below.
const CARS = [
  { make: 'Volkswagen', model: 'Golf', trim: '1.5 TSI Life 5dr', year: 2019, price: 14495, average: 15600, miles: 32400, fuel: 'Petrol', gearbox: 'Manual', body: 'hatchback', color: '#2f5d8a', colorName: 'Blue', town: 'Bristol', distance: 3 },
  { make: 'Toyota', model: 'Corolla', trim: '1.8 Hybrid Icon Tech', year: 2021, price: 17950, average: 18700, miles: 21800, fuel: 'Hybrid', gearbox: 'Automatic', body: 'hatchback', color: '#b8bcc2', colorName: 'Silver', town: 'Bath', distance: 13 },
  { make: 'Ford', model: 'Puma', trim: '1.0 EcoBoost ST-Line', year: 2020, price: 15250, average: 15400, miles: 28900, fuel: 'Petrol', gearbox: 'Manual', body: 'SUV', color: '#a3262a', colorName: 'Red', town: 'Keynsham', distance: 7 },
  { make: 'Kia', model: 'Niro', trim: '64kWh 2 Long Range', year: 2022, price: 21495, average: 23100, miles: 15300, fuel: 'Electric', gearbox: 'Automatic', body: 'SUV', color: '#e8e9eb', colorName: 'White', town: 'Clevedon', distance: 14 },
  { make: 'BMW', model: '3 Series', trim: '320d M Sport', year: 2018, price: 16995, average: 17300, miles: 54200, fuel: 'Diesel', gearbox: 'Automatic', body: 'saloon', color: '#1c1f24', colorName: 'Black', town: 'Portishead', distance: 9 },
  { make: 'Audi', model: 'A3', trim: '35 TFSI Sport', year: 2020, price: 18750, average: 18200, miles: 26100, fuel: 'Petrol', gearbox: 'Manual', body: 'hatchback', color: '#6c7178', colorName: 'Grey', town: 'Bristol', distance: 4 },
  { make: 'Volkswagen', model: 'Polo', trim: '1.0 TSI Match', year: 2018, price: 9995, average: 10900, miles: 41700, fuel: 'Petrol', gearbox: 'Manual', body: 'hatchback', color: '#c9c3b6', colorName: 'Beige', town: 'Weston-super-Mare', distance: 19 },
  { make: 'Toyota', model: 'RAV4', trim: '2.5 Hybrid Design', year: 2020, price: 24500, average: 25250, miles: 38800, fuel: 'Hybrid', gearbox: 'Automatic', body: 'SUV', color: '#3d4a3a', colorName: 'Green', town: 'Thornbury', distance: 12 },
  { make: 'Ford', model: 'Focus', trim: '1.0 EcoBoost Titanium', year: 2019, price: 11750, average: 12100, miles: 36500, fuel: 'Petrol', gearbox: 'Manual', body: 'hatchback', color: '#5b7aa6', colorName: 'Blue', town: 'Bristol', distance: 5 },
  { make: 'Skoda', model: 'Octavia Estate', trim: '2.0 TDI SE Technology', year: 2019, price: 13995, average: 14800, miles: 61200, fuel: 'Diesel', gearbox: 'Automatic', body: 'estate', color: '#4a5561', colorName: 'Grey', town: 'Yate', distance: 11 },
  { make: 'Hyundai', model: 'Kona', trim: '1.6 Hybrid Premium SE', year: 2021, price: 17495, average: 17400, miles: 19800, fuel: 'Hybrid', gearbox: 'Automatic', body: 'SUV', color: '#d6b13b', colorName: 'Yellow', town: 'Nailsea', distance: 10 },
  { make: 'Vauxhall', model: 'Corsa', trim: '1.2 Turbo SRi', year: 2020, price: 10250, average: 11300, miles: 9400, fuel: 'Petrol', gearbox: 'Manual', body: 'hatchback', color: '#b02b36', colorName: 'Red', town: 'Bristol', distance: 2 },
  { make: 'Nissan', model: 'Leaf', trim: '40kWh N-Connecta', year: 2021, price: 14250, average: 14900, miles: 18200, fuel: 'Electric', gearbox: 'Automatic', body: 'hatchback', color: '#eef0f2', colorName: 'White', town: 'Chepstow', distance: 31 },
  { make: 'Honda', model: 'Jazz', trim: '1.5 Hybrid EX', year: 2022, price: 18995, average: 18800, miles: 8100, fuel: 'Hybrid', gearbox: 'Automatic', body: 'hatchback', color: '#9fb4c7', colorName: 'Blue', town: 'Frome', distance: 38 },
];

const EXTRA = [
  { make: 'Mercedes-Benz', model: 'GLC', trim: '300de 4MATIC AMG Line Premium Plus', year: 2021, price: 38995, average: 39600, miles: 29100, fuel: 'Hybrid', gearbox: 'Automatic', body: 'SUV', color: '#2b2e33', colorName: 'Black', town: 'Chipping Sodbury', distance: 17 },
  { make: 'Volkswagen', model: 'ID.3', trim: 'Pro Performance Life 58kWh', year: 2022, price: 22495, average: 24300, miles: 12100, fuel: 'Electric', gearbox: 'Automatic', body: 'hatchback', color: '#7da3a1', colorName: 'Green', town: 'Bristol', distance: 2 },
  { make: 'Vauxhall', model: 'Astra', trim: '1.2 Turbo SRi Nav', year: 2020, price: 11495, average: 11900, miles: 33800, fuel: 'Petrol', gearbox: 'Manual', body: 'hatchback', color: '#5d6672', colorName: 'Grey', town: 'Bristol', distance: 6 },
  { make: 'Tesla', model: 'Model 3', trim: 'Long Range Dual Motor AWD', year: 2021, price: 27995, average: 28400, miles: 34600, fuel: 'Electric', gearbox: 'Automatic', body: 'saloon', color: '#f2f2f2', colorName: 'White', town: 'Cribbs Causeway', distance: 8 },
  { make: 'Nissan', model: 'Qashqai', trim: '1.3 DiG-T MH N-Connecta Xtronic', year: 2022, price: 21250, average: 21000, miles: 17900, fuel: 'Petrol', gearbox: 'Automatic', body: 'SUV', color: '#76797e', colorName: 'Grey', town: 'Yate', distance: 11 },
  { make: 'Peugeot', model: '208', trim: '1.2 PureTech Allure Premium', year: 2021, price: 12495, average: 13300, miles: 22300, fuel: 'Petrol', gearbox: 'Manual', body: 'hatchback', color: '#e3a33b', colorName: 'Orange', town: 'Bristol', distance: 4 },
  { make: 'Land Rover', model: 'Range Rover Evoque', trim: '2.0 D200 R-Dynamic SE Mild Hybrid', year: 2020, price: 29995, average: 29700, miles: 41200, fuel: 'Diesel', gearbox: 'Automatic', body: 'SUV', color: '#3a3f47', colorName: 'Grey', town: 'Frenchay', distance: 6 },
  { make: 'Mazda', model: 'CX-5', trim: '2.0 Skyactiv-G Sport Nav+', year: 2019, price: 15995, average: 17200, miles: 39900, fuel: 'Petrol', gearbox: 'Manual', body: 'SUV', color: '#8e1f24', colorName: 'Red', town: 'Clevedon', distance: 14 },
  { make: 'Honda', model: 'Civic', trim: '1.0 VTEC Turbo SR', year: 2019, price: 13750, average: 14100, miles: 30800, fuel: 'Petrol', gearbox: 'Manual', body: 'hatchback', color: '#9fb4c7', colorName: 'Blue', town: 'Bath', distance: 13 },
  { make: 'Renault', model: 'Clio', trim: '1.0 TCe Iconic', year: 2020, price: 9495, average: 10300, miles: 27100, fuel: 'Petrol', gearbox: 'Manual', body: 'hatchback', color: '#e05a2b', colorName: 'Orange', town: 'Bristol', distance: 5 },
  { make: 'Volvo', model: 'XC40', trim: 'Recharge Twin Pure Electric Plus', year: 2022, price: 31995, average: 31700, miles: 11600, fuel: 'Electric', gearbox: 'Automatic', body: 'SUV', color: '#5f6e7d', colorName: 'Blue', town: 'Keynsham', distance: 7 },
  { make: 'Seat', model: 'Leon Estate', trim: '1.5 TSI EVO FR Sport DSG', year: 2021, price: 17250, average: 17900, miles: 24600, fuel: 'Petrol', gearbox: 'Automatic', body: 'estate', color: '#40464d', colorName: 'Grey', town: 'Bristol', distance: 3 },
];

export const SAMPLE_POSTCODE = 'BS1 4DJ';

export function loadData(name = fixtureName()) {
  const dense = name === 'dense' || name === 'stress';
  const expand = name === 'expanded' || name === 'stress';
  let cars = name === 'empty' ? [] : dense ? [...CARS, ...EXTRA] : CARS;
  cars = cars.map((c, i) => ({ ...c, id: `car-${i + 1}` }));
  if (expand) cars = cars.map((c) => ({ ...c, trim: pseudo(c.trim), town: pseudo(c.town), colorName: pseudo(c.colorName) }));
  return { data: { fixture: name, cars, postcode: SAMPLE_POSTCODE }, expand };
}
