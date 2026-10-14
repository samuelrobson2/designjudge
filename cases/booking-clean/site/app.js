import { loadData, pseudo } from './data.js';

const { data, expand } = loadData();
const t = (s) => (expand ? pseudo(s) : s);

const DAYS_SHOWN = 6;

const app = document.getElementById('app');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const timesOn = (dateId, practitioner) => (data.availability[dateId] || []).filter((s) => practitioner === 'any' || s.practitioners.includes(practitioner));
const pageDates = (page) => data.dates.slice(page * DAYS_SHOWN, page * DAYS_SHOWN + DAYS_SHOWN);
const pageCount = Math.ceil(data.dates.length / DAYS_SHOWN);
const firstOpenDate = (page, practitioner) => pageDates(page).find((d) => timesOn(d.id, practitioner).length) || null;

const state = {
  treatment: null,
  practitioner: 'any',
  page: 0,
  date: firstOpenDate(0, 'any')?.id ?? null,
  time: null,
  // The practitioner the chosen time is booked with when "Any available" is selected.
  assigned: null,
  name: '',
  email: '',
  phone: '',
  notes: '',
  errors: {},
  submitted: false,
  confirmed: false,
};

const treatmentOf = () => data.treatments.find((x) => x.id === state.treatment) || null;
const dateOf = () => data.dates.find((d) => d.id === state.date) || null;
const nameOf = (id) => data.practitioners.find((p) => p.id === id)?.name ?? '';
const dateText = (d) => `${d.day} ${d.date} ${d.month}`;

function rangeText(dates) {
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first.month === last.month ? `${first.date}–${last.date} ${last.month}` : `${first.date} ${first.month} – ${last.date} ${last.month}`;
}

function practitionerText() {
  if (state.practitioner !== 'any') return nameOf(state.practitioner);
  if (state.assigned) return `${nameOf(state.assigned)} ${t('(first available)')}`;
  return t('Any available');
}

function validate() {
  const errors = {};
  if (!state.treatment) errors.treatment = t('Choose a treatment');
  if (!state.time) errors.time = t('Choose a date and time');
  if (!state.name.trim()) errors.name = t('Enter your full name');
  if (!state.email.trim()) errors.email = t('Enter your email address');
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(state.email.trim())) errors.email = t('Enter an email address in the correct format, like name@example.com');
  return errors;
}

// ---------- Header ----------

function header() {
  return `
    <a class="skip-link" href="#booking">${t('Skip to booking form')}</a>
    <header class="site-header" data-component-id="site-header">
      <div class="site-header__inner">
        <div class="brand">
          <svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#0f766e" /><path d="M9 17c3-5 11-5 14 0M11 21c2.5-3 7.5-3 10 0" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" /></svg>
          <span class="brand__name">Harbour Physio</span>
        </div>
      </div>
    </header>`;
}

// ---------- Form sections ----------

function sectionHead(n, id, title, hint) {
  return `
      <div class="form-section__head">
        <h2><span class="step">${n}</span> <span id="${id}">${title}</span></h2>
        ${hint ? `<p class="hint">${hint}</p>` : ''}
      </div>`;
}

function errorSummary() {
  const entries = Object.entries(state.errors);
  if (!state.submitted || !entries.length) return '';
  const anchors = { treatment: 'section-treatment', time: 'section-time', name: 'name', email: 'email' };
  return `
    <div class="error-summary" role="alert" tabindex="-1" id="error-summary" data-component-id="error-summary">
      <h2 class="error-summary__title">${t('Before you can book')}</h2>
      <ul class="error-summary__list">${entries.map(([k, msg]) => `<li><a href="#${anchors[k]}">${esc(msg)}</a></li>`).join('')}</ul>
    </div>`;
}

function fieldError(key) {
  return state.submitted && state.errors[key] ? `<p class="field-error" id="${key}-error">${esc(state.errors[key])}</p>` : '';
}

function treatmentSection() {
  return `
    <section class="form-section" id="section-treatment" aria-labelledby="h-treatment" data-component-id="treatment-options">
      ${sectionHead(1, 'h-treatment', t('Treatment'), t('Not sure which to choose? Book an initial assessment.'))}
      ${fieldError('treatment')}
      <div class="option-list" role="radiogroup" aria-labelledby="h-treatment" ${state.submitted && state.errors.treatment ? 'aria-describedby="treatment-error"' : ''}>
        ${data.treatments
          .map(
            (tr) => `
        <div class="option ${state.treatment === tr.id ? 'is-selected' : ''}" data-treatment="${tr.id}" data-component-id="treatment-${tr.id}">
          <input type="radio" class="option__radio" id="tr-${tr.id}" name="treatment" value="${tr.id}" ${state.treatment === tr.id ? 'checked' : ''} aria-describedby="tr-${tr.id}-price tr-${tr.id}-desc" />
          <div class="option__body">
            <div class="option__top">
              <label class="option__name" for="tr-${tr.id}">${esc(tr.name)}</label>
              <span class="option__price" id="tr-${tr.id}-price">£${tr.price}</span>
            </div>
            <p class="option__desc" id="tr-${tr.id}-desc">${tr.minutes} ${t('minutes')} · ${esc(tr.description)}</p>
          </div>
        </div>`,
          )
          .join('')}
      </div>
    </section>`;
}

function practitionerSection() {
  const options = [{ id: 'any', name: t('Any available') }, ...data.practitioners];
  return `
    <section class="form-section" id="section-practitioner" aria-labelledby="h-practitioner" data-component-id="practitioner-options">
      ${sectionHead(2, 'h-practitioner', t('Practitioner'), t('Choose Any available to see every open time.'))}
      <div class="chip-row" role="radiogroup" aria-labelledby="h-practitioner">
        ${options
          .map(
            (p) => `
        <label class="chip ${state.practitioner === p.id ? 'is-selected' : ''}" data-practitioner="${p.id}">
          <input type="radio" class="visually-hidden" name="practitioner" value="${p.id}" ${state.practitioner === p.id ? 'checked' : ''} />
          ${esc(p.name)}
        </label>`,
          )
          .join('')}
      </div>
    </section>`;
}

function slotGroup(times, period, label) {
  const list = times.filter((s) => s.period === period);
  if (!list.length) return '';
  return `
      <div class="slot-group" data-component-id="slots-${period}">
        <h3 class="slot-group__title">${t(label)}</h3>
        <div class="slot-grid">
          ${list
            .map((s) => `<button type="button" class="slot ${state.time === s.time ? 'is-selected' : ''}" data-slot="${s.time}" aria-pressed="${state.time === s.time}" data-component-type="time-slot">${s.time}</button>`)
            .join('')}
        </div>
      </div>`;
}

function timeSection() {
  const dates = pageDates(state.page);
  const range = rangeText(dates);
  const times = state.date ? timesOn(state.date, state.practitioner) : [];
  const anyOpen = dates.some((d) => timesOn(d.id, state.practitioner).length);
  const hint = state.practitioner === 'any' ? t('Showing times with any available practitioner.') : `${t('Showing times with')} ${esc(nameOf(state.practitioner))}.`;
  const chevron = (d) => `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const empty = `
      <div class="empty-state" data-component-id="no-times">
        <p class="empty-state__title">${t('No appointments available')} ${range}</p>
        ${state.practitioner === 'any' ? '' : `<p class="empty-state__body">${t('Try later dates, or choose Any available to see times with every practitioner.')}</p>`}
        ${state.page < pageCount - 1 ? `<button type="button" class="btn btn--secondary" data-week="1">${t('Show later dates')}</button>` : ''}
      </div>`;
  return `
    <section class="form-section" id="section-time" aria-labelledby="h-time" data-component-id="date-time">
      ${sectionHead(3, 'h-time', t('Date and time'), hint)}
      ${fieldError('time')}
      <div class="date-picker" data-component-id="date-picker">
        <div class="date-picker__nav">
          <p class="date-picker__range" id="date-range">${range}</p>
          <div class="date-picker__buttons">
            <button type="button" class="icon-btn" data-week="-1" aria-label="${t('Earlier dates')}" ${state.page === 0 ? 'disabled' : ''}>${chevron('M12 4l-6 6 6 6')}</button>
            <button type="button" class="icon-btn" data-week="1" aria-label="${t('Later dates')}" ${state.page >= pageCount - 1 ? 'disabled' : ''}>${chevron('M8 4l6 6-6 6')}</button>
          </div>
        </div>
        <div class="date-strip" role="group" aria-labelledby="date-range">
          ${dates
            .map((d) => {
              const open = timesOn(d.id, state.practitioner).length > 0;
              return `
          <button type="button" class="date-chip ${state.date === d.id && open ? 'is-selected' : ''}" data-date="${d.id}" aria-pressed="${state.date === d.id && open}" ${open ? '' : 'disabled'} data-component-type="date-chip">
            <span class="date-chip__day">${esc(d.day)}</span>
            <span class="date-chip__date">${d.date} ${esc(d.month)}</span>
          </button>`;
            })
            .join('')}
        </div>
      </div>
      ${anyOpen && times.length ? `${slotGroup(times, 'morning', 'Morning')}${slotGroup(times, 'afternoon', 'Afternoon')}` : empty}
    </section>`;
}

function detailsSection() {
  const invalid = (k) => (state.submitted && state.errors[k] ? `aria-invalid="true" aria-describedby="${k}-error"` : '');
  return `
    <section class="form-section" id="section-details" aria-labelledby="h-details" data-component-id="details-form">
      ${sectionHead(4, 'h-details', t('Your details'), t('We will email your booking confirmation.'))}
      <div class="field" id="field-name">
        <label for="name">${t('Full name')}</label>
        <input id="name" name="name" autocomplete="name" value="${esc(state.name)}" ${invalid('name')} />
        ${fieldError('name')}
      </div>
      <div class="field" id="field-email">
        <label for="email">${t('Email')}</label>
        <input id="email" name="email" type="email" autocomplete="email" spellcheck="false" value="${esc(state.email)}" ${invalid('email')} />
        ${fieldError('email')}
      </div>
      <div class="field" id="field-phone">
        <label for="phone">${t('Phone')} <span class="optional">${t('(optional)')}</span></label>
        <input id="phone" name="phone" type="tel" autocomplete="tel" value="${esc(state.phone)}" />
      </div>
      <div class="field" id="field-notes">
        <label for="notes">${t('Anything we should know?')} <span class="optional">${t('(optional)')}</span></label>
        <p class="field-hint" id="notes-hint">${t('For example, the injury or pain you would like treated.')}</p>
        <textarea id="notes" name="notes" rows="3" aria-describedby="notes-hint">${esc(state.notes)}</textarea>
      </div>
    </section>`;
}

// ---------- Summary ----------

function summaryRows(rows) {
  return `
      <dl class="summary__list">
        ${rows
          .map(
            ([label, value, cls = '']) => `
        <div class="summary__row ${cls}">
          <dt>${label}</dt>
          <dd class="${value ? '' : 'is-empty'}">${value ? esc(value) : t('Not chosen')}</dd>
        </div>`,
          )
          .join('')}
      </dl>`;
}

function summary() {
  const tr = treatmentOf();
  const d = dateOf();
  return `
    <aside class="summary" aria-labelledby="h-summary" data-component-id="summary">
      <div class="summary__card">
        <h2 id="h-summary">${t('Your appointment')}</h2>
        ${summaryRows([
          [t('Treatment'), tr ? tr.name : ''],
          [t('Practitioner'), practitionerText()],
          [t('Date'), d ? dateText(d) : ''],
          [t('Time'), state.time],
          [t('Price'), tr ? `£${tr.price}` : '', 'summary__row--total'],
        ])}
        <button type="submit" form="booking" class="btn btn--primary btn--block" data-action="confirm" data-component-id="confirm-button">${t('Confirm booking')}</button>
      </div>
    </aside>`;
}

function confirmation() {
  const tr = treatmentOf();
  const d = dateOf();
  return `
    <main id="main" class="page">
      <div class="confirmation" role="status" tabindex="-1" id="confirmation" data-component-id="confirmation">
        <h1>${t('Your appointment is booked')}</h1>
        <p class="confirmation__lede">${t('We have emailed the details to')} ${esc(state.email.trim())}.</p>
        ${summaryRows([
          [t('Treatment'), `${tr.name}, ${tr.minutes} ${t('minutes')}`],
          [t('Practitioner'), nameOf(state.assigned)],
          [t('Date and time'), `${dateText(d)}, ${state.time}`],
          [t('Price'), `£${tr.price}`, 'summary__row--total'],
        ])}
        <button type="button" class="btn btn--secondary" data-action="new">${t('Book another appointment')}</button>
      </div>
    </main>`;
}

// ---------- Page ----------

function render() {
  const focused = document.activeElement?.id || null;
  if (state.confirmed) {
    app.innerHTML = `${header()}${confirmation()}`;
    document.getElementById('confirmation')?.focus();
    return;
  }
  app.innerHTML = `
    ${header()}
    <main id="main" class="page">
      <h1 class="page__title">${t('Book an appointment')}</h1>
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
    </main>`;
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
}

function setPractitioner(id) {
  state.practitioner = id;
  if (state.time) {
    const slot = timesOn(state.date, id).find((s) => s.time === state.time);
    if (!slot) {
      state.time = null;
      state.assigned = null;
    } else {
      state.assigned = id === 'any' ? (slot.practitioners.includes(state.assigned) ? state.assigned : slot.practitioners[0]) : id;
    }
  }
  if (!state.date || !timesOn(state.date, id).length) state.date = firstOpenDate(state.page, id)?.id ?? state.date;
}

app.addEventListener('change', (e) => {
  const el = e.target;
  // Text fields update the state as they are typed in; re-rendering on change would replace the
  // field the user is moving to.
  if (['name', 'email', 'phone', 'notes'].includes(el.name)) return;
  if (el.name === 'treatment') state.treatment = el.value;
  if (el.name === 'practitioner') setPractitioner(el.value);
  if (state.submitted) state.errors = validate();
  render();
});

app.addEventListener('input', (e) => {
  const el = e.target;
  if (['name', 'email', 'phone', 'notes'].includes(el.name)) state[el.name] = el.value;
});

app.addEventListener('click', (e) => {
  const option = e.target.closest('[data-treatment]');
  if (option && !e.target.closest('input, label')) {
    state.treatment = option.dataset.treatment;
    if (state.submitted) state.errors = validate();
    render();
    document.getElementById(`tr-${state.treatment}`)?.focus({ preventScroll: true });
    return;
  }
  const week = e.target.closest('[data-week]');
  if (week && !week.disabled) {
    state.page = Math.max(0, Math.min(pageCount - 1, state.page + Number(week.dataset.week)));
    state.date = firstOpenDate(state.page, state.practitioner)?.id ?? pageDates(state.page)[0].id;
    state.time = null;
    state.assigned = null;
    render();
    return;
  }
  const date = e.target.closest('[data-date]');
  if (date && !date.disabled) {
    state.date = date.dataset.date;
    state.time = null;
    state.assigned = null;
    render();
    return;
  }
  const slot = e.target.closest('[data-slot]');
  if (slot) {
    const s = timesOn(state.date, state.practitioner).find((x) => x.time === slot.dataset.slot);
    state.time = s.time;
    state.assigned = state.practitioner === 'any' ? s.practitioners[0] : state.practitioner;
    if (state.submitted) state.errors = validate();
    render();
    return;
  }
  if (e.target.closest('[data-action="new"]')) {
    Object.assign(state, { treatment: null, practitioner: 'any', page: 0, date: firstOpenDate(0, 'any')?.id ?? null, time: null, assigned: null, errors: {}, submitted: false, confirmed: false });
    render();
    window.scrollTo(0, 0);
  }
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  state.submitted = true;
  state.errors = validate();
  if (Object.keys(state.errors).length) {
    render();
    const box = document.getElementById('error-summary');
    box?.scrollIntoView({ block: 'start' });
    box?.focus({ preventScroll: true });
    return;
  }
  state.confirmed = true;
  render();
  window.scrollTo(0, 0);
});

render();
