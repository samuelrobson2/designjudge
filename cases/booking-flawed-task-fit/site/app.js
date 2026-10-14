import { loadData, pseudo } from './data.js';

const { data, expand } = loadData();
const t = (s) => (expand ? pseudo(s) : s);

const state = {
  treatment: null,
  practitioner: 'any',
  date: data.dates[0].id,
  time: null,
  name: '',
  email: '',
  phone: '',
  notes: '',
  errors: {},
  submitted: false,
  confirmed: false,
};

const app = document.getElementById('app');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const selectedTreatment = () => data.treatments.find((x) => x.id === state.treatment) || null;
const selectedDate = () => data.dates.find((d) => d.id === state.date);
const practitionerName = () => data.practitioners.find((p) => p.id === state.practitioner)?.name;

function validate() {
  const errors = {};
  if (!state.treatment) errors.treatment = t('Choose a treatment');
  if (!state.time) errors.time = t('Choose an appointment time');
  if (!state.name.trim()) errors.name = t('Enter your full name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(state.email)) errors.email = t('Enter an email address, like name@example.com');
  return errors;
}

function errorSummary() {
  const entries = Object.entries(state.errors);
  if (!state.submitted || !entries.length) return '';
  const anchors = { treatment: 'section-treatment', time: 'section-time', name: 'field-name', email: 'field-email' };
  return `
    <div class="error-summary" role="alert" tabindex="-1" id="error-summary" data-component-id="error-summary">
      <h2 class="error-summary__title">${t(`Complete ${entries.length} ${entries.length === 1 ? 'thing' : 'things'} to book`)}</h2>
      <ul>${entries.map(([k, msg]) => `<li><a href="#${anchors[k]}">${esc(msg)}</a></li>`).join('')}</ul>
    </div>`;
}

function fieldError(key) {
  return state.submitted && state.errors[key] ? `<p class="field-error" id="${key}-error">${esc(state.errors[key])}</p>` : '';
}

function treatmentSection() {
  return `
    <section class="form-section" id="section-treatment" aria-labelledby="h-treatment" data-component-id="treatment-options">
      <div class="form-section__head">
        <span class="step">1</span>
        <h2 id="h-treatment">${t('Treatment')}</h2>
      </div>
      ${fieldError('treatment')}
      <div class="option-grid" role="radiogroup" aria-labelledby="h-treatment">
        ${data.treatments
          .map(
            (tr) => `
          <label class="option-card ${state.treatment === tr.id ? 'is-selected' : ''}" data-treatment="${tr.id}" data-component-type="treatment-card" data-component-id="treatment-${tr.id}">
            <input type="radio" name="treatment" value="${tr.id}" ${state.treatment === tr.id ? 'checked' : ''} />
            <span class="option-card__top">
              <span class="option-card__name">${esc(tr.name)}</span>
              <span class="option-card__price">£${tr.price}</span>
            </span>
            <span class="option-card__meta">${tr.minutes} ${t('min')}</span>
            <span class="option-card__desc">${esc(tr.description)}</span>
          </label>`,
          )
          .join('')}
      </div>
    </section>`;
}

function practitionerSection() {
  return `
    <section class="form-section" id="section-practitioner" aria-labelledby="h-practitioner" data-component-id="practitioner-options">
      <div class="form-section__head">
        <span class="step">2</span>
        <h2 id="h-practitioner">${t('Practitioner')}</h2>
      </div>
      <div class="chip-row" role="radiogroup" aria-labelledby="h-practitioner">
        ${data.practitioners
          .map(
            (p) => `
          <label class="chip ${state.practitioner === p.id ? 'is-selected' : ''}" data-practitioner="${p.id}" data-component-type="practitioner-chip">
            <input type="radio" name="practitioner" value="${p.id}" ${state.practitioner === p.id ? 'checked' : ''} />
            ${p.initials ? `<span class="avatar" aria-hidden="true">${p.initials}</span>` : ''}
            <span>${esc(p.name)}</span>
          </label>`,
          )
          .join('')}
      </div>
    </section>`;
}

function timeSection() {
  const slots = data.slots[state.date] || [];
  const group = (period, label) => {
    const list = slots.filter((s) => s.period === period);
    if (!list.length) return '';
    return `
      <div class="slot-group">
        <h3 class="slot-group__title">${t(label)}</h3>
        <div class="slot-grid">
          ${list
            .map(
              (s) => `<button type="button" class="slot ${state.time === s.time ? 'is-selected' : ''}" data-slot="${s.time}" ${s.available ? '' : 'disabled'} aria-pressed="${state.time === s.time}" data-component-type="time-slot">${s.time}</button>`,
            )
            .join('')}
        </div>
      </div>`;
  };
  const empty = `
    <div class="empty-state" data-component-id="no-times">
      <p class="empty-state__title">${t('No appointments left this week')}</p>
      <p class="empty-state__body">${t('New times are released every Monday at 8am.')}</p>
      <div class="empty-state__actions">
        <button type="button" class="btn btn--secondary">${t('Show next week')}</button>
        <a href="#" class="link">${t('Join the waitlist')}</a>
      </div>
    </div>`;
  return `
    <section class="form-section" id="section-time" aria-labelledby="h-time" data-component-id="date-time">
      <div class="form-section__head">
        <span class="step">3</span>
        <h2 id="h-time">${t('Date and time')}</h2>
      </div>
      ${fieldError('time')}
      <div class="date-strip" role="radiogroup" aria-label="${t('Date')}" data-component-id="date-picker">
        ${data.dates
          .map(
            (d) => `
          <button type="button" class="date-chip ${state.date === d.id ? 'is-selected' : ''}" data-date="${d.id}" aria-pressed="${state.date === d.id}" data-component-type="date-chip">
            <span class="date-chip__day">${esc(d.day)}</span>
            <span class="date-chip__num">${d.date}</span>
            <span class="date-chip__month">${esc(d.month)}</span>
          </button>`,
          )
          .join('')}
      </div>
      ${slots.length ? `<div class="slots" data-component-id="time-slots">${group('morning', 'Morning')}${group('afternoon', 'Afternoon')}</div>` : empty}
    </section>`;
}

function detailsSection() {
  const invalid = (k) => (state.submitted && state.errors[k] ? 'aria-invalid="true"' : '');
  return `
    <section class="form-section" id="section-details" aria-labelledby="h-details" data-component-id="details-form">
      <div class="form-section__head">
        <span class="step">4</span>
        <h2 id="h-details">${t('Your details')}</h2>
      </div>
      <div class="field-grid">
        <div class="field field--full" id="field-name" data-component-type="form-field">
          <label for="name">${t('Full name')}</label>
          <input id="name" name="name" autocomplete="name" value="${esc(state.name)}" ${invalid('name')} />
          ${fieldError('name')}
        </div>
        <div class="field" id="field-email" data-component-type="form-field">
          <label for="email">${t('Email')}</label>
          <input id="email" name="email" type="email" autocomplete="email" value="${esc(state.email)}" ${invalid('email')} />
          ${fieldError('email')}
        </div>
        <div class="field" id="field-phone" data-component-type="form-field">
          <label for="phone">${t('Phone')} <span class="optional">${t('(optional)')}</span></label>
          <input id="phone" name="phone" type="tel" autocomplete="tel" value="${esc(state.phone)}" />
        </div>
        <div class="field field--full" data-component-type="form-field">
          <label for="notes">${t('Anything we should know?')} <span class="optional">${t('(optional)')}</span></label>
          <textarea id="notes" name="notes" rows="3">${esc(state.notes)}</textarea>
        </div>
      </div>
    </section>`;
}

function summaryRows() {
  const tr = selectedTreatment();
  const d = selectedDate();
  const row = (label, value) => `
    <div class="summary__row">
      <dt>${t(label)}</dt>
      <dd class="${value ? '' : 'is-empty'}">${value ? esc(value) : t('Not selected')}</dd>
    </div>`;
  return `
    <dl class="summary__list">
      ${row('Treatment', tr ? `${tr.name} · ${tr.minutes} ${t('min')}` : '')}
      ${row('Practitioner', practitionerName())}
      ${row('Date', d ? `${d.day} ${d.date} ${d.month}` : '')}
      ${row('Time', state.time)}
    </dl>`;
}

function summary() {
  const tr = selectedTreatment();
  return `
    <aside class="summary" aria-labelledby="h-summary" data-component-id="summary">
      <div class="summary__card">
        <h2 id="h-summary">${t('Your appointment')}</h2>
        ${summaryRows()}
        <div class="summary__total">
          <span>${t('Total')}</span>
          <span class="summary__price">${tr ? `£${tr.price}` : '—'}</span>
        </div>
        <button type="submit" form="booking" class="btn btn--primary btn--block" data-action="confirm" data-component-id="confirm-button">${t('Confirm booking')}</button>
        <p class="summary__note">${t('Free cancellation up to 24 hours before your appointment.')}</p>
      </div>
    </aside>`;
}

function mobileBar() {
  const tr = selectedTreatment();
  const d = selectedDate();
  const line = tr ? `${tr.name}${state.time ? ` · ${d.day} ${d.date}, ${state.time}` : ''}` : t('Choose a treatment and time');
  return `
    <div class="action-bar" data-component-id="mobile-action-bar">
      <div class="action-bar__info">
        <span class="action-bar__line">${esc(line)}</span>
        <span class="action-bar__price">${tr ? `£${tr.price}` : ''}</span>
      </div>
      <button type="submit" form="booking" class="btn btn--primary" data-action="confirm">${t('Confirm booking')}</button>
    </div>`;
}

function confirmation() {
  const tr = selectedTreatment();
  const d = selectedDate();
  return `
    <div class="confirmation" role="status" data-component-id="confirmation">
      <h1>${t("You're booked in")}</h1>
      <p>${esc(tr.name)} ${t('with')} ${esc(practitionerName())} ${t('on')} ${esc(d.day)} ${d.date} ${esc(d.month)} ${t('at')} ${state.time}.</p>
      <p>${t('We have sent a confirmation to')} ${esc(state.email)}.</p>
    </div>`;
}

function render() {
  if (state.confirmed) {
    app.innerHTML = confirmation();
    return;
  }
  app.innerHTML = `
    <div class="page__intro">
      <h1>${t('Book an appointment')}</h1>
      <p class="lede">${t('Choose a treatment and a time that suits you. You will get a confirmation email straight away.')}</p>
    </div>
    <div class="booking-layout">
      <form id="booking" class="booking-form" novalidate data-component-id="booking-form">
        ${errorSummary()}
        ${treatmentSection()}
        ${practitionerSection()}
        ${timeSection()}
        ${detailsSection()}
      </form>
      ${summary()}
    </div>
    ${mobileBar()}`;
}

app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.name === 'treatment') state.treatment = el.value;
  if (el.name === 'practitioner') state.practitioner = el.value;
  if (state.submitted) state.errors = validate();
  render();
});

app.addEventListener('input', (e) => {
  const el = e.target;
  if (['name', 'email', 'phone', 'notes'].includes(el.name)) state[el.name] = el.value;
});

app.addEventListener('click', (e) => {
  const date = e.target.closest('[data-date]');
  if (date) {
    state.date = date.dataset.date;
    state.time = null;
    render();
    return;
  }
  const slot = e.target.closest('[data-slot]');
  if (slot && !slot.disabled) {
    state.time = slot.dataset.slot;
    if (state.submitted) state.errors = validate();
    render();
  }
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  state.submitted = true;
  state.errors = validate();
  if (Object.keys(state.errors).length) {
    render();
    document.getElementById('error-summary')?.focus({ preventScroll: true });
    return;
  }
  state.confirmed = true;
  render();
});

render();
