// designjudge viewer. Interface-derived text is always rendered with textContent.

const $app = document.getElementById('app');
const $drawer = document.getElementById('drawer');
const $modal = document.getElementById('modal');
let META = null;

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

// Like replaceChildren/append, but children may be arrays or null (as with h()).
const mount = (el, ...children) => el.replaceChildren(h('div', { style: { display: 'contents' } }, ...children));
const add = (el, ...children) => el.append(h('div', { style: { display: 'contents' } }, ...children));

// On the hosted rating site everything except ratings is a static snapshot under /data.
const HOSTED = !!window.DJ_HOSTED;
function apiUrl(path) {
  if (!HOSTED || path.startsWith('human/')) return '/api/' + path;
  const [p, q] = path.split('?');
  const v = new URLSearchParams(q ?? '').get('version');
  return `/data/${p}${v ? `.${v}` : ''}.json`;
}

async function api(path) {
  const res = await fetch(apiUrl(path));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const pill = (status, label) => h('span', { class: `pill pill-${status}` }, label ?? String(status).replace(/_/g, ' '));
const fmtCost = (v) => (v === null || v === undefined ? '—' : `$${Number(v).toFixed(v < 0.1 ? 4 : 2)}`);
const fmtMs = (v) => (v === null || v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const fmtDate = (s) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const imgSrc = (path) => `/files/evidence/${path}`;

// ---------- Modal and drawer ----------

function openModal(content) {
  $modal.replaceChildren(h('div', { class: 'modal__inner', onclick: (e) => e.stopPropagation() }, content));
  $modal.hidden = false;
}
$modal.addEventListener('click', () => ($modal.hidden = true));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $modal.hidden = true;
    closeDrawer();
  }
});

let drawerOnClose = null;
function openDrawer(title, content, onClose) {
  drawerOnClose?.();
  drawerOnClose = onClose;
  $drawer.replaceChildren(
    h('div', { class: 'drawer__head' }, h('strong', { class: 'mono' }, title), h('button', { class: 'close', onclick: closeDrawer, 'aria-label': 'Close' }, '×')),
    h('div', { class: 'drawer__body' }, content),
  );
  $drawer.hidden = false;
}
function closeDrawer() {
  $drawer.hidden = true;
  drawerOnClose?.();
  drawerOnClose = null;
}

// ---------- Parsing what was sent ----------

function parseUserText(text) {
  const reqBlock = text.match(/<user_request>([\s\S]*?)<\/user_request>/);
  let request = '';
  if (reqBlock) {
    const lines = reqBlock[1].trim().split('\n');
    const last = lines[lines.length - 1];
    try {
      request = JSON.parse(last);
    } catch {
      request = last;
    }
  }
  const evBlock = text.match(/<evaluation_material>([\s\S]*?)<\/evaluation_material>/);
  let evidence = null;
  try {
    evidence = JSON.parse(evBlock[1]);
  } catch {
    evidence = null;
  }
  return { request, evidence };
}

// Finds a result or item by evidence ID within the evidence the judge received.
function findEvidence(evidence, id) {
  const groups = [
    ...(evidence.deterministic_findings ?? []),
    ...(evidence.failure_matrices ?? []),
    ...(evidence.quantitative_observations ?? []),
    ...(evidence.criteria ?? []).flatMap((c) => c.diagnostic_evidence),
  ];
  for (const r of groups) {
    if (r.id === id) return { result: r };
    const item = (r.items ?? []).find((i) => i.id === id);
    if (item) return { result: r, item };
  }
  return null;
}

// ---------- Evidence rendering (exactly as sent) ----------

function displayWidth(img) {
  const scale = img.scale ?? (img.width >= 1000 ? 1 : 2);
  return Math.round(img.width / scale);
}

function fmtValue(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function kvList(data) {
  const entries = Object.entries(data ?? {});
  if (!entries.length) return null;
  return h('div', { class: 'kv' }, entries.map(([k, v]) => [h('span', { class: 'k' }, k), h('span', { class: 'v' }, fmtValue(v))]));
}

function elementList(elements) {
  if (!elements?.length) return null;
  return h(
    'div',
    { class: 'elements' },
    elements.map((e) =>
      h(
        'div',
        { class: 'element' },
        h('span', { class: 'element__sel' }, e.el),
        e.name ? h('span', {}, `“${e.name}”`) : null,
        e.component ? pill('outline', e.component) : null,
        e.box ? h('span', { class: 'element__box' }, `[${e.box.join(', ')}]`) : null,
      ),
    ),
  );
}

function locateModal(ctx, stateId, itemId, elements) {
  const img = ctx.images.find((i) => i.stateId === stateId && i.kind === 'full') ?? ctx.images.find((i) => i.stateId === stateId);
  if (!img) return;
  const scale = img.scale ?? (img.width >= 1000 ? 1 : 2);
  const offsetY = img.kind === 'viewport' ? img.scrollY ?? 0 : 0;
  const wrap = h('div', { class: 'overlay-wrap' }, h('img', { src: imgSrc(img.path), style: { maxWidth: `${displayWidth(img)}px` } }));
  elements.forEach((e, i) => {
    const [x, y, w, bh] = e.box;
    wrap.append(
      h('div', {
        class: `box ${i ? 'alt' : ''}`,
        style: {
          left: `${((x * scale) / img.width) * 100}%`,
          top: `${(((y - offsetY) * scale) / img.height) * 100}%`,
          width: `${((w * scale) / img.width) * 100}%`,
          height: `${((bh * scale) / img.height) * 100}%`,
        },
      }),
    );
  });
  openModal(
    h(
      'div',
      {},
      h('p', { class: 'small muted', style: { marginBottom: '10px' } }, h('code', {}, itemId), ` — element boxes drawn on `, h('code', {}, img.id), ', one of the screenshots the judge received. The judge saw the screenshot without boxes.'),
      wrap,
    ),
  );
  const img0 = wrap.querySelector('img');
  const focusBox = () => wrap.querySelector('.box')?.scrollIntoView({ block: 'center' });
  if (img0.complete) focusBox();
  else img0.addEventListener('load', focusBox, { once: true });
}

function itemView(item, result, ctx) {
  const canLocate = ctx.images && item.elements?.some((e) => e.box) && ctx.images.some((i) => i.stateId === result.state);
  return h(
    'div',
    { class: 'item', id: `ev-${item.id}` },
    h(
      'div',
      { class: 'item__head' },
      h('code', { class: 'item__id' }, item.id),
      canLocate ? h('span', { class: 'item__actions' }, h('button', { class: 'link-btn', onclick: () => locateModal(ctx, result.state, item.id, item.elements.filter((e) => e.box)) }, 'Show on screenshot')) : null,
    ),
    h('p', { class: 'item__summary' }, item.summary),
    elementList(item.elements),
    kvList(item.data),
  );
}

function matrixView(matrix) {
  const rows = Object.entries(matrix).map(([name, text]) => ({
    name,
    cells: text.split(', ').map((cell) => {
      const i = cell.indexOf(': ');
      return { column: cell.slice(0, i), status: cell.slice(i + 2) };
    }),
  }));
  const columns = rows[0]?.cells.map((c) => c.column) ?? [];
  const cellView = (status) => {
    if (status.startsWith('FAIL')) return h('span', { class: 'cellfail', title: status }, status.replace('FAIL', '✕'));
    if (status === 'pass') return h('span', { class: 'dot', title: 'pass' });
    return h('span', { class: 'dot dot-na', title: status });
  };
  return h(
    'div',
    { class: 'matrix-wrap' },
    h(
      'table',
      { class: 'matrix' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), columns.map((c) => h('th', {}, c)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.name), r.cells.map((c) => h('td', {}, cellView(c.status)))))),
    ),
  );
}

function resultView(r, ctx, heading) {
  const name = heading ?? r.check ?? r.observation;
  return h(
    'div',
    { class: 'result', id: `ev-${r.id}` },
    h('div', { class: 'result__head' }, h('span', { class: 'result__name' }, name), pill(r.status), h('code', { class: 'result__id' }, r.id)),
    h('p', { class: 'result__summary' }, r.summary),
    r.reason && r.reason !== r.summary ? h('p', { class: 'result__meta' }, `Reason: ${r.reason}`) : null,
    r.evaluated ? h('p', { class: 'result__meta' }, `Evaluated: ${r.evaluated}`) : null,
    r.matrix ? matrixView(r.matrix) : null,
    r.items?.length ? h('div', { class: 'items' }, r.items.map((it) => itemView(it, r, ctx))) : null,
    r.more_items_not_shown ? h('p', { class: 'note' }, `${r.more_items_not_shown} further items exist but were not included in the judge's input.`) : null,
    (r.not_failures ?? []).map((nf) =>
      h('div', {}, h('p', { class: 'subhead' }, `${nf.label} · ${nf.count}`), h('ul', { class: 'bullets' }, nf.examples.map((ex) => h('li', {}, ex)))),
    ),
  );
}

function groupByState(results, evidence) {
  const labels = new Map((evidence.states ?? []).map((s) => [s.state, s.label]));
  const groups = [];
  for (const r of results) {
    let g = groups.find((x) => x.state === r.state);
    if (!g) groups.push((g = { state: r.state, label: labels.get(r.state) ?? (r.state === 'all' ? 'Across states' : r.state), results: [] }));
    g.results.push(r);
  }
  return groups;
}

function stateGroups(results, evidence, ctx) {
  return groupByState(results, evidence).map((g) =>
    h(
      'div',
      { class: 'panel state-group' },
      h('div', { class: 'state-group__head' }, h('h3', {}, g.label), h('code', { class: 'faint' }, g.state)),
      g.results.map((r) => resultView(r, ctx)),
    ),
  );
}

// Prompt v2: one criterion's relevant screenshots and diagnostics, grouped by diagnostic.
function criterionEvidenceView(c, evidence, ctx) {
  const labels = new Map((evidence.states ?? []).map((s) => [s.state, s.label]));
  const groups = [];
  for (const r of c.diagnostic_evidence) {
    const name = r.check ?? r.observation;
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, kind: r.check ? 'Deterministic finding' : 'Quantitative observation', results: [] }));
    g.results.push(r);
  }
  const jump = (id) => document.getElementById(`ev-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'panel panel--pad small' },
      h('p', { class: 'muted' }, 'Relevant evidence named in the rubric'),
      h('p', {}, h('strong', {}, 'Screenshots: '), c.rubric_relevant_evidence.screenshots),
      h('p', {}, h('strong', {}, 'Diagnostic evidence: '), c.rubric_relevant_evidence.diagnostic_evidence),
      h('div', { class: 'chips' }, c.relevant_screenshots.map((id) => h('button', { class: 'chip', onclick: () => jump(id) }, id))),
    ),
    groups.map((g) =>
      h(
        'div',
        { class: 'panel state-group' },
        h('div', { class: 'state-group__head' }, h('h3', {}, g.name), h('span', { class: 'faint small' }, g.kind)),
        g.results.map((r) => resultView(r, ctx, r.state === 'all' ? 'All states' : labels.get(r.state) ?? r.state)),
      ),
    ),
  );
}

function screenshotView(entry, img) {
  const width = img ? displayWidth(img) : 360;
  return h(
    'figure',
    { class: 'shot', id: `ev-${entry.id}`, style: { width: `${width}px` } },
    h('div', { class: 'shot__head' }, h('code', {}, entry.id)),
    h('p', { class: 'shot__shows' }, entry.shows),
    img
      ? h('div', { class: 'shot__frame' }, h('img', { src: imgSrc(img.path), loading: 'lazy', alt: entry.id, onclick: () => openModal(h('img', { src: imgSrc(img.path), style: { maxWidth: `${width}px` } })) }))
      : h('p', { class: 'muted' }, 'Image file not found.'),
  );
}

function statesTable(evidence) {
  const rows = [
    ...(evidence.states ?? []).map((s) => ({
      state: s.state,
      label: s.label,
      detail: [s.viewport, s.fixture ? `fixture: ${s.fixture}` : null, s.interaction ? `interaction: ${s.interaction}` : null, s.reached_by ? `reached by ${s.reached_by}` : null, s.interaction_note, s.note, s.error]
        .filter(Boolean)
        .join(' · '),
      status: s.status,
    })),
    ...(evidence.other_coverage ?? []).map((c) => ({ state: c.state, label: c.label ?? '', detail: c.reason ?? c.detail ?? '', status: c.status })),
  ];
  return h(
    'div',
    { class: 'panel' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, 'State'), h('th', {}, 'Status'), h('th', {}, 'Details'))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, h('div', {}, r.label || r.state), h('code', { class: 'faint' }, r.state)), h('td', {}, pill(r.status === 'collected' ? 'pass' : r.status, r.status.replace(/_/g, ' '))), h('td', { class: 'small' }, r.detail)))),
    ),
  );
}

// Exact message text, styled line by line for reading. The words are unchanged.
function messageText(text) {
  return h(
    'div',
    { class: 'message-text' },
    text.split('\n').map((line) => {
      let cls = '';
      if (/^<\/?[a-z_]+(\s[^>]*)?>$/.test(line.trim())) cls = 'tag';
      else if (/^(Criterion [A-Z] — |# )/.test(line)) cls = 'strong';
      else if (/^(Evaluation points|Deterministic findings|Quantitative observations|Other coverage:|Meaningful transitions|Screenshots the rubric names)/.test(line)) cls = 'head';
      else if (/^\S.*(\. PASS means: | — Reference: )/.test(line)) cls = 'diag';
      else if (/ — FAIL \[/.test(line)) cls = 'fail';
      return h('div', { class: `line ${cls}` }, line || '\u00a0');
    }),
  );
}

// Text-rendered prompts (v3+): the message exactly as sent, in order, with screenshots inline.
function messageDoc(input) {
  const imgById = new Map(input.images.map((i) => [i.id, i]));
  const parts = input.userParts;
  const lead = [];
  const shots = [];
  const trail = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const next = parts[i + 1];
    if (p.type === 'text' && next?.type === 'image') {
      shots.push({ caption: p.text, id: next.id });
      i++;
    } else if (p.type === 'text') (shots.length ? trail : lead).push(p.text);
  }
  const chunks = trail.join('\n\n').split(/(?=<criterion id=")|(?=<notes>)/);
  const sections = [
    [
      'system',
      'System instructions',
      null,
      h('div', { class: 'panel panel--pad' }, h('p', { class: 'small muted', style: { marginBottom: '10px' } }, 'Fixed for every interface. Includes the rubric’s assessment rules and scoring anchors verbatim.'), h('div', { class: 'scroll-box' }, messageText(input.instructions))),
    ],
    ['task', 'Task and states', null, h('div', { class: 'panel panel--pad' }, messageText(lead.join('\n\n')))],
    [
      'screenshots',
      'Screenshots',
      shots.length,
      h(
        'div',
        { class: 'shots' },
        shots.map((s) => {
          const img = imgById.get(s.id);
          const width = img ? displayWidth(img) : 360;
          return h(
            'figure',
            { class: 'shot', id: `ev-${s.id}`, style: { width: `${width}px` } },
            h('div', { class: 'shot__head' }, h('span', { class: 'small' }, s.caption)),
            img ? h('div', { class: 'shot__frame' }, h('img', { src: imgSrc(img.path), loading: 'lazy', alt: s.id, onclick: () => openModal(h('img', { src: imgSrc(img.path), style: { maxWidth: `${width}px` } })) })) : null,
          );
        }),
      ),
    ],
  ];
  let carry = '';
  for (const chunk of chunks) {
    const crit = chunk.match(/^<criterion id="([A-Z])" name="([^"]+)">/);
    if (crit) sections.push([`crit-${crit[1]}`, `${crit[1]} · ${crit[2]}`, null, h('div', { class: 'panel panel--pad' }, messageText((carry + chunk).trim()))]), (carry = '');
    else if (chunk.startsWith('<notes>')) sections.push(['closing', 'Notes and closing', null, h('div', { class: 'panel panel--pad' }, messageText(chunk.trim()))]);
    else carry += chunk;
  }
  if (input.schema) sections.push(['schema', 'Output schema', null, h('div', { class: 'panel panel--pad' }, h('details', { class: 'disclosure', style: { marginTop: 0 } }, h('summary', {}, 'Required JSON schema'), h('pre', {}, JSON.stringify(input.schema, null, 2))))]);
  return docLayout(sections);
}

function docLayout(sections) {
  return h(
    'div',
    { class: 'doc' },
    h(
      'nav',
      { class: 'toc' },
      sections.map(([id, title, count]) =>
        h('button', { onclick: () => document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, title, count !== null ? h('span', { class: 'count' }, count) : null),
      ),
    ),
    h(
      'div',
      { class: 'doc__body' },
      sections.map(([id, title, count, body]) => [
        h('div', { class: 'section-title', id: `sec-${id}` }, h('h2', {}, title), count !== null ? h('span', { class: 'count' }, count) : null),
        body,
      ]),
    ),
  );
}

// input: { instructions, userText, userParts?, images, schema }
function evidenceDoc(input) {
  if (input.userParts) return messageDoc(input);
  const { request, evidence } = parseUserText(input.userText);
  if (!evidence) return h('div', { class: 'notice' }, 'Could not parse the evaluation material from the request text.');
  const ctx = { images: input.images ?? [] };
  const imgById = new Map(ctx.images.map((i) => [i.id, i]));
  const det = evidence.deterministic_findings ?? [];
  const obs = evidence.quantitative_observations ?? [];
  const mats = evidence.failure_matrices ?? [];
  const shots = evidence.screenshots ?? [];

  const byType = evidence.criteria
    ? evidence.criteria.map((c) => [`crit-${c.criterion}`, `${c.criterion} · ${c.name}`, c.diagnostic_evidence.length, criterionEvidenceView(c, evidence, ctx)])
    : [
        ['checks', 'Deterministic findings', det.length, h('div', {}, stateGroups(det, evidence, ctx))],
        ['matrices', 'Failure matrices', mats.length, h('div', { class: 'panel' }, mats.map((r) => resultView(r, ctx)))],
        ['observations', 'Quantitative observations', obs.length, h('div', {}, stateGroups(obs, evidence, ctx))],
      ];
  const sections = [
    ['request', 'User request', null, h('div', { class: 'panel request' }, request)],
    ['states', 'States', (evidence.states ?? []).length, statesTable(evidence)],
    ['screenshots', 'Screenshots', shots.length, h('div', { class: 'shots' }, shots.map((s) => screenshotView(s, imgById.get(s.id))))],
    ...byType,
    [
      'transitions',
      'Sweep transitions',
      (evidence.sweep_transitions ?? []).length,
      h(
        'div',
        { class: 'panel' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Width'), h('th', {}, 'What changed'), h('th', {}, 'Screenshot'))),
          h(
            'tbody',
            {},
            (evidence.sweep_transitions ?? []).map((t) =>
              h(
                'tr',
                {},
                h('td', { class: 'mono' }, `${t.width}px`),
                h('td', {}, h('ul', { class: 'bullets', style: { margin: 0 } }, t.reasons.map((x) => h('li', {}, x)))),
                h('td', {}, t.screenshot ? h('button', { class: 'link-btn mono', onclick: () => document.getElementById(`ev-${t.screenshot}`)?.scrollIntoView({ behavior: 'smooth' }) }, t.screenshot) : h('span', { class: 'faint' }, 'not sent')),
              ),
            ),
          ),
        ),
      ),
    ],
    ['notes', 'Selection notes', (evidence.selection_notes ?? []).length, h('div', { class: 'panel panel--pad' }, h('ul', { class: 'bullets', style: { margin: 0 } }, (evidence.selection_notes ?? []).map((n) => h('li', {}, n))))],
    [
      'instructions',
      'Instructions and raw text',
      null,
      h(
        'div',
        { class: 'panel panel--pad' },
        h(
          'p',
          { class: 'small muted' },
          evidence.criteria
            ? 'The system instructions include the judge-facing rubric: evaluation states, criteria and scoring verbatim from layout_rubric.md, with each diagnostic described by what it measures and its reference values only.'
            : 'The system instructions include layout_rubric.md verbatim.',
          ' The user message is the request and evaluation material above, followed by the screenshots in the order shown.',
        ),
        h('details', { class: 'disclosure' }, h('summary', {}, 'System instructions'), h('pre', {}, input.instructions)),
        h('details', { class: 'disclosure' }, h('summary', {}, 'User message text, exactly as sent'), h('pre', {}, input.userText)),
        input.schema ? h('details', { class: 'disclosure' }, h('summary', {}, 'Required output schema'), h('pre', {}, JSON.stringify(input.schema, null, 2))) : null,
      ),
    ],
  ].filter(([, , count]) => count === null || count > 0);

  return docLayout(sections);
}

function inputStrip(input) {
  const textTokens = Math.round((input.instructions.length + input.userText.length) / 4);
  const imageTokens = (input.images ?? []).reduce((s, i) => s + (i.estimatedTokens ?? 0), 0);
  return h(
    'div',
    { class: 'summary-strip' },
    `Prompt ${input.promptVersion} (${input.promptHash}) · packet ${input.packetHash} · ${input.images.length} screenshots · about ${Math.round(textTokens / 1000)}k text + ${Math.round(imageTokens / 1000)}k image tokens. The judge never sees the case name or file paths.`,
  );
}

// ---------- Home ----------

async function renderHome() {
  const [cases, runs] = await Promise.all([api('cases'), api('runs')]);
  mount($app,
    HOSTED
      ? h(
          'div',
          { class: 'page-head' },
          h('h1', {}, 'Rate these interfaces'),
          h('p', {}, 'Each interface was built from a short prompt. Pick one, look through its screenshots and give its layout a score from 1 to 5. Ratings are public and show the name you enter.'),
        )
      : null,
    h('div', { class: 'section-title' }, h(HOSTED ? 'h2' : 'h1', {}, 'Test Interfaces'), h('span', { class: 'count' }, cases.length)),
    h(
      'div',
      { class: 'cards' },
      cases.map((c) =>
        h(
          'div',
          { class: 'card' },
          h('h3', {}, h('a', { href: `#/case/${c.caseId}` }, c.title)),
          c.summary ? h('p', { class: 'card__summary' }, c.summary) : null,
          h('p', { class: 'card__request' }, h('span', { class: 'card__label' }, 'Prompt: '), c.request),
          h(
            'div',
            { class: 'card__foot' },
            c.latest ? h('a', { class: 'btn-primary', href: `#/rate/${c.latest.interfaceId}` }, 'Rate this interface') : h('span', { class: 'muted' }, 'Not collected yet'),
            h('a', { class: 'btn-ghost', href: `/site/${c.caseId}/`, target: '_blank' }, 'Open ↗'),
          ),
        ),
      ),
    ),
    h('div', { class: 'section-title' }, h(HOSTED ? 'h2' : 'h1', {}, 'Judge runs'), h('span', { class: 'count' }, runs.length)),
    runs.length
      ? h(
          'div',
          { class: 'panel' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, ['Date', 'Model', 'Effort', 'Calls', 'Valid', 'Cost', 'Label'].map((t, i) => h('th', { class: i >= 3 && i <= 5 ? 'num' : '' }, t)))),
            h(
              'tbody',
              {},
              runs.map((r) =>
                h(
                  'tr',
                  { class: 'link-row', onclick: () => (location.hash = `#/run/${r.runId}`) },
                  h('td', {}, fmtDate(r.createdAt)),
                  h('td', {}, r.model, r.provider === 'mock' ? h('span', { class: 'faint small' }, ' · harness test') : null),
                  h('td', {}, r.effort),
                  h('td', { class: 'num' }, r.totals?.calls ?? '…'),
                  h('td', { class: 'num' }, r.totals ? `${r.totals.ok}/${r.totals.calls}` : '…'),
                  h('td', { class: 'num' }, fmtCost(r.totals?.costUsd)),
                  h('td', { class: 'muted' }, r.label ?? ''),
                ),
              ),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'No runs yet.'),
  );
}

// ---------- Interface ----------

async function renderCase(caseId, tab, version) {
  const [data, human] = await Promise.all([
    api(`case/${caseId}`),
    api(`human/${caseId}`).catch((err) => ({ error: err.message, latestBundleId: null, ratings: [], judge: [] })),
  ]);
  const { summary, bundle } = data;
  const tabs = [
    ['human', `Human ratings (${human.ratings.length})`],
    ['evidence', 'What the judge sees'],
    ['states', 'All captured states'],
    ['code', 'Code'],
  ];
  const body = h('div');
  mount($app,
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Test Interfaces'), ' / ', caseId),
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'row' },
        h('h1', {}, summary.title),
        h('span', { class: 'spacer' }),
        h('a', { class: 'btn-ghost', href: `/site/${caseId}/`, target: '_blank' }, 'Open interface ↗'),
        summary.latest ? h('a', { class: 'btn-primary', href: `#/rate/${summary.latest.interfaceId}` }, 'Rate interface') : null,
      ),
      summary.summary ? h('p', {}, summary.summary) : null,
      h('p', { class: 'meta' }, `Collected ${fmtDate(bundle.createdAt)} · ${bundle.browser.name} ${bundle.browser.version} · shown to the judge as ${bundle.interfaceId}`),
    ),
    h('nav', { class: 'tabs' }, tabs.map(([id, label]) => h('a', { href: `#/case/${caseId}?tab=${id}`, class: tab === id ? 'active' : '' }, label))),
    body,
  );
  if (tab === 'evidence') {
    const v = version && META.promptVersions.includes(version) ? version : META.promptVersions.at(-1);
    const input = await api(`prompt/${caseId}/${bundle.bundleId}?version=${v}`);
    body.append(
      h(
        'div',
        { class: 'row', style: { marginBottom: '12px' } },
        h('span', { class: 'small muted' }, 'Prompt version'),
        h('div', { class: 'repeats' }, META.promptVersions.map((pv) => h('a', { href: `#/case/${caseId}?tab=evidence&v=${pv}`, class: pv === v ? 'active' : '', style: { width: 'auto', padding: '0 10px' } }, pv))),
        h('span', { class: 'small muted' }, input.promptDescription ?? ''),
      ),
      inputStrip(input),
      evidenceDoc(input),
    );
  }
  if (tab === 'states') body.append(renderAllStates(data, await api(`checkmarks/${caseId}/${bundle.bundleId}`)));
  if (tab === 'code') body.append(renderCode(caseId, data.codeFiles));
  if (tab === 'human') body.append(humanRatingsTab(caseId, human, summary.latest?.interfaceId));
}

function renderAllStates({ bundle, diagnostics }, checkmarks = {}) {
  const byKey = new Map((diagnostics?.results ?? []).map((r) => [r.key, r]));
  const checks = ['region_overlap', 'container_overflow', 'page_horizontal_overflow', 'interactive_reachability', 'collapsed_dimensions', 'occluded_content'];
  const src = (p) => `/files/evidence/${bundle.caseId}/${bundle.bundleId}/${p}`;
  const card = (s) =>
    h(
      'div',
      { class: 'panel state-card' },
      h('div', { class: 'row' }, h('strong', {}, s.label), h('span', { class: 'spacer' }), s.status === 'collected' ? null : pill('error', s.status)),
      h('code', { class: 'faint' }, s.id),
      h('p', { class: 'small muted' }, `${s.viewport.width}×${s.viewport.height} @${s.viewport.dpr}x${s.viewport.isMobile ? ' mobile' : ''}${s.fixture ? ` · ${s.fixture}` : ''}`),
      s.error ? h('p', { class: 'issue' }, s.error) : null,
      (s.steps ?? []).filter((st) => st.via === 'dispatch' || !st.ok).map((st) => h('p', { class: 'issue' }, st.note ?? st.error)),
      h(
        'div',
        { class: 'thumbs' },
        s.screenshots.map((shot) => {
          // Failing check items are outlined in red and numbered; see the list below the images.
          const marked = checkmarks[s.id]?.shots.find((m) => m.kind === shot.kind);
          const p = marked?.path ?? shot.path;
          const open = () => openModal(h('img', { src: src(p), style: { maxWidth: `${Math.round(shot.width / shot.scale)}px` } }));
          // Marked screenshots show a close-up of the outlined area; click for the whole page.
          return marked?.crop
            ? h('figure', { class: 'thumb-marked' }, h('img', { src: src(marked.crop), loading: 'lazy', title: `${shot.kind}: failing checks outlined (click for the whole page)`, onclick: open }), h('figcaption', {}, shot.kind))
            : h('img', { src: src(p), loading: 'lazy', title: shot.kind, onclick: open });
        }),
      ),
      checkmarks[s.id]?.legend.length
        ? h(
            'ol',
            { class: 'small mark-legend' },
            checkmarks[s.id].legend.map((l) =>
              h('li', {}, h('span', { class: 'mark-tag' }, String(l.n)), h('strong', {}, `${l.check}: `), l.summary, l.shown ? null : h('span', { class: 'muted' }, ' (not in these screenshots)')),
            ),
          )
        : null,
      h(
        'div',
        { class: 'check-pills' },
        checks.map((c) => {
          const r = byKey.get(`${c}@${s.id}`);
          return r ? h('span', { title: r.summary }, pill(r.status, `${META.diagNames[c]}${r.status === 'fail' ? ` · ${r.items.length}` : ''}`)) : null;
        }),
      ),
    );
  const fresh = bundle.states.filter((s) => s.kind !== 'sweep');
  const sweep = bundle.states.filter((s) => s.kind === 'sweep');
  const discovery = bundle.interactiveDiscovery ?? [];
  const filled = bundle.states.filter((s) => s.stressFill);
  return h(
    'div',
    {},
    h('p', { class: 'muted', style: { marginBottom: '20px' } }, 'Every state the harness captured, with its underlying check results. The judge sees the anchor and interactive states directly; fixture and sweep states reach it only through the failure matrices.'),
    discovery.length
      ? h(
          'div',
          { class: 'panel panel--pad', style: { marginBottom: '20px' } },
          h('h3', {}, 'Interactive states found automatically'),
          h('p', { class: 'small muted', style: { margin: '4px 0 10px' } }, 'Each distinct control was clicked on a fresh page. The three largest layout changes at each viewport are checked; the judge sees screenshots of the largest one at desktop and mobile.'),
          discovery.map((d) =>
            h(
              'details',
              { class: 'disclosure' },
              h('summary', {}, `${d.viewport}: ${d.chosen ? d.chosen.description : d.error ?? 'no significant change'} · ${d.attempts.length} controls tried`),
              h(
                'table',
                { style: { marginTop: '8px' } },
                h('thead', {}, h('tr', {}, h('th', {}, 'Control'), h('th', {}, 'Outcome'), h('th', { class: 'num' }, 'Score'), h('th', {}, 'Change'))),
                h(
                  'tbody',
                  {},
                  d.attempts.map((a) =>
                    h(
                      'tr',
                      {},
                      h(
                        'td',
                        {},
                        `${a.role} “${a.label}”`,
                        d.chosen && a.selector === d.chosen.selector ? pill('pass', 'chosen') : (d.alsoKept ?? []).some((k) => k.selector === a.selector) ? pill('observed', 'also checked') : null,
                      ),
                      h('td', {}, a.outcome.replace(/_/g, ' ')),
                      h('td', { class: 'num' }, a.score),
                      h('td', { class: 'small muted' }, a.description ?? ''),
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
      : null,
    filled.length
      ? h(
          'div',
          { class: 'panel panel--pad', style: { marginBottom: '20px' } },
          h('h3', {}, 'Stress states filled in'),
          h('p', { class: 'small muted', style: { margin: '4px 0 10px' } }, 'Empty text fields get long text, dropdowns their longest option, checkboxes are checked, and empty single-choice groups get an option. Changes that navigate, open a dialog or large overlay, or remove content are undone.'),
          filled.map((s) => {
            const k = s.stressFill.kept;
            return h(
              'details',
              { class: 'disclosure' },
              h('summary', {}, `${s.label}: ${k.fill} filled, ${k.choose} chosen, ${k.select} dropdowns set, ${k.check} checked · ${s.stressFill.actions.length} controls tried`),
              s.stressFill.actions.length
                ? h(
                    'table',
                    { style: { marginTop: '8px' } },
                    h('thead', {}, h('tr', {}, h('th', {}, 'Control'), h('th', {}, 'Action'), h('th', {}, 'Outcome'), h('th', {}, 'Value or reason'))),
                    h(
                      'tbody',
                      {},
                      s.stressFill.actions.map((a) =>
                        h(
                          'tr',
                          {},
                          h('td', {}, a.control),
                          h('td', {}, a.kind),
                          h('td', {}, a.outcome === 'kept' ? pill('pass', 'kept') : a.outcome),
                          h('td', { class: 'small muted' }, a.reason ?? a.value ?? ''),
                        ),
                      ),
                    ),
                  )
                : h('p', { class: 'small muted' }, 'No fillable controls.'),
            );
          }),
        )
      : null,
    h('div', { class: 'states-grid' }, fresh.map(card)),
    h('div', { class: 'section-title' }, h('h2', {}, 'Responsive sweep'), h('span', { class: 'count' }, sweep.length)),
    h('div', { class: 'states-grid' }, sweep.map(card)),
  );
}

function renderCode(caseId, files) {
  const view = h('div', { class: 'panel code-view' }, h('p', { class: 'muted', style: { padding: '20px' } }, 'Select a file.'));
  const buttons = [];
  const open = async (p, btn) => {
    buttons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const res = await fetch(`/code/${caseId}/${p}`);
    view.replaceChildren(h('pre', {}, await res.text()));
  };
  return h(
    'div',
    { class: 'code-layout' },
    h(
      'div',
      { class: 'file-list' },
      h('p', { class: 'small muted', style: { marginBottom: '8px' } }, `cases/${caseId}/site`),
      files.map((f) => {
        const b = h('button', { onclick: () => open(f.path, b) }, f.path);
        buttons.push(b);
        return b;
      }),
    ),
    view,
  );
}

// ---------- Run ----------

async function renderRun(runId) {
  const { run, report } = await api(`run/${runId}`);
  const t = run.totals;
  mount($app,
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Runs'), ' / ', runId),
    h(
      'div',
      { class: 'page-head' },
      h('h1', {}, `${run.model} · ${run.repeats} repeats`),
      h('p', { class: 'meta' }, `${fmtDate(run.createdAt)} · ${run.provider} · effort ${run.effort} · prompt ${run.promptVersion} (${run.promptHash})${run.label ? ` · ${run.label}` : ''}`),
      t ? h('p', { class: 'meta' }, `${t.ok}/${t.calls} valid outputs · ${fmtCost(t.costUsd)} · average ${fmtMs(t.latencyMsMean)} per call · `, h('a', { href: `/files/runs/${runId}/summary.csv` }, 'summary.csv'), ' · ', h('a', { href: `/files/runs/${runId}/checks.csv` }, 'checks.csv'), ' · ', h('a', { href: `/files/runs/${runId}/findings.csv` }, 'findings.csv'), ' · ', h('a', { href: `/files/runs/${runId}/points.csv` }, 'points.csv')) : null,
    ),
    run.provider === 'mock' ? h('div', { class: 'notice' }, 'Mock provider: these results test the harness only. They say nothing about judge quality.') : null,
    h(
      'div',
      { class: 'panel' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Interface'), h('th', {}, 'Scores by repeat'), h('th', { class: 'num' }, 'Mean'), h('th', { class: 'num' }, 'SD'), h('th', {}, 'Human score'))),
        h(
          'tbody',
          {},
          report.cases.map((c) =>
            h(
              'tr',
              {},
              h('td', {}, h('div', {}, c.caseId), c.baseline ? h('div', { class: 'small faint' }, `variant of ${c.baseline}`) : null),
              h('td', {}, h('div', { class: 'repeats' }, c.scores.map((s, i) => h('a', { href: `#/judgment/${runId}/${c.caseId}/${i + 1}`, title: `Repeat ${i + 1}` }, s ?? '×')))),
              h('td', { class: 'num' }, c.mean ?? '—'),
              h('td', { class: 'num' }, c.sd ?? '—'),
              h('td', { class: 'faint' }, 'to fill in'),
            ),
          ),
        ),
      ),
    ),
    report.pairs.length
      ? h(
          'div',
          { style: { marginTop: '40px' } },
          h('div', { class: 'section-title' }, h('h2', {}, 'Baseline vs. variant'), h('span', { class: 'count small' }, 'expected outcomes are hidden from the judge')),
          h(
            'div',
            { class: 'panel' },
            h(
              'table',
              {},
              h('thead', {}, h('tr', {}, h('th', {}, 'Pair'), h('th', {}, 'Expected'), h('th', { class: 'num' }, 'Δ mean'), h('th', { class: 'num' }, 'Variant lower'), h('th', {}, 'Result'), h('th', {}, 'Planted check cited'))),
              h(
                'tbody',
                {},
                report.pairs.map((p) =>
                  h(
                    'tr',
                    {},
                    h('td', {}, h('div', {}, `${p.baseline} → ${p.variant}`), h('div', { class: 'small muted', style: { maxWidth: '520px' } }, p.change)),
                    h('td', {}, (p.expected ?? '').replace(/_/g, ' ')),
                    h('td', { class: 'num' }, p.delta ?? '—'),
                    h('td', { class: 'num' }, p.pLower === null ? '—' : `${Math.round(p.pLower * 100)}%`),
                    h('td', {}, pill(p.verdict === 'as_expected' ? 'pass' : p.verdict === 'not_as_expected' ? 'fail' : 'na', p.verdict.replace(/_/g, ' '))),
                    h('td', {}, p.detection.citedTargetCheck === null ? h('span', { class: 'faint' }, 'no check targets this') : `${p.detection.citedTargetCheck} of ${p.detection.repeats}`),
                  ),
                ),
              ),
            ),
          ),
        )
      : '',
    h(
      'details',
      { class: 'disclosure', style: { marginTop: '28px' } },
      h('summary', {}, 'Tokens, cost and evidence references by interface'),
      h(
        'div',
        { class: 'panel', style: { marginTop: '12px' } },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, ['Interface', 'Input tokens', 'Cached', 'Output tokens', 'Cost', 'Latency', 'Refs resolving', 'Ref errors'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
          h(
            'tbody',
            {},
            report.cases.map((c) =>
              h(
                'tr',
                {},
                h('td', {}, c.caseId),
                h('td', { class: 'num' }, c.inputTokensMean.toLocaleString()),
                h('td', { class: 'num' }, c.cachedTokensMean.toLocaleString()),
                h('td', { class: 'num' }, c.outputTokensMean.toLocaleString()),
                h('td', { class: 'num' }, fmtCost(c.costUsd)),
                h('td', { class: 'num' }, fmtMs(c.latencyMsMean)),
                h('td', { class: 'num' }, c.refValidity === null ? '—' : `${Math.round(c.refValidity * 100)}%`),
                h('td', { class: 'num' }, c.refErrors),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

// ---------- Judgment ----------

async function renderJudgment(runId, caseId, repeat, tab) {
  const [{ judgment: j, request }, { report }] = await Promise.all([api(`judgment/${runId}/${caseId}/${repeat}`), api(`run/${runId}`)]);
  const repeats = report.cases.find((c) => c.caseId === caseId)?.scores.length ?? 1;
  const base = `#/judgment/${runId}/${caseId}`;
  const o = j.output;
  const body = h('div');
  mount($app,
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Runs'), ' / ', h('a', { href: `#/run/${runId}` }, `${j.model} run`), ' / ', caseId),
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'row' },
        h('h1', {}, caseId),
        h('span', { class: 'spacer' }),
        h('div', { class: 'repeats' }, Array.from({ length: repeats }, (_, i) => h('a', { href: `${base}/${i + 1}?tab=${tab}`, class: String(i + 1) === String(repeat) ? 'active' : '' }, `r${i + 1}`))),
      ),
      h('p', { class: 'meta' }, `${j.model} · effort ${j.effort} · prompt ${j.promptVersion} · ${fmtMs(j.latencyMs)} · ${fmtCost(j.costUsd)}${j.usage ? ` · ${j.usage.inputTokens.toLocaleString()} input (${j.usage.cachedInputTokens.toLocaleString()} cached), ${j.usage.outputTokens.toLocaleString()} output tokens` : ''}`),
    ),
    j.provider === 'mock' ? h('div', { class: 'notice' }, 'Mock provider output. It tests the harness only.') : null,
    h(
      'nav',
      { class: 'tabs' },
      [
        ['judgment', 'Judgment'],
        ['input', 'What the judge saw'],
        ['raw', 'Raw output'],
      ].map(([id, label]) => h('a', { href: `${base}/${repeat}?tab=${id}`, class: tab === id ? 'active' : '' }, label)),
    ),
    body,
  );

  if (tab === 'input') {
    if (request) body.append(inputStrip(request), evidenceDoc(request));
    else body.append(h('p', { class: 'muted' }, 'The request file for this run is missing.'));
    return;
  }
  if (tab === 'raw') {
    add(body,
      h('div', { class: 'panel panel--pad' }, h('h3', {}, 'Output'), h('pre', { style: { marginTop: '10px' } }, o ? JSON.stringify(o, null, 2) : j.outputText ?? '(none)')),
      h('details', { class: 'disclosure' }, h('summary', {}, 'Provider response'), h('pre', {}, JSON.stringify(j.rawResponse, null, 2))),
      h('ul', { class: 'bullets muted small', style: { marginTop: '16px' } }, (j.notes ?? []).map((n) => h('li', {}, n))),
    );
    return;
  }

  if (!o) {
    body.append(h('div', { class: 'notice' }, j.error ?? 'No valid output.'));
    return;
  }
  add(body, ...judgmentPanels(o, { validation: j.validation, reasoningSummary: j.reasoningSummary, request, showTrace: true }));
}

// The judgment display, shared by judge outputs and human ratings (same output shape).
function judgmentPanels(o, { validation, reasoningSummary, request, showTrace }) {
  const evidence = request?.evidence ?? (request ? parseUserText(request.userText).evidence : null);
  const ctx = { images: request?.images ?? [] };
  const index = request?.evidenceIndex ?? {};
  const decisive = new Set(o.overall.decisive_finding_ids ?? []);
  const issues = validation?.refIssues ?? [];
  let openChip = null;

  const showEvidence = (ref, chip) => {
    openChip?.classList.remove('is-open');
    openChip = chip;
    chip.classList.add('is-open');
    const onClose = () => chip.classList.remove('is-open');
    if (!index[ref]) return openDrawer(ref, h('div', { class: 'notice' }, "This ID does not exist in the judge's input."), onClose);
    const img = ctx.images.find((i) => i.id === ref);
    if (img) {
      const entry = evidence?.screenshots?.find((s) => s.id === ref) ?? { id: ref, shows: img.caption };
      return openDrawer(ref, screenshotView(entry, img), onClose);
    }
    const found = evidence ? findEvidence(evidence, ref) : null;
    if (!found) return openDrawer(ref, h('p', { class: 'muted' }, 'Not found in the evaluation material.'), onClose);
    if (found.item) {
      const r = found.result;
      return openDrawer(
        ref,
        h('div', {}, h('p', { class: 'small muted', style: { marginBottom: '10px' } }, `Item in ${r.check ?? r.observation} · ${r.state} (`, h('code', {}, r.id), ')'), itemView(found.item, r, ctx)),
        onClose,
      );
    }
    return openDrawer(ref, resultView(found.result, ctx), onClose);
  };

  const chipFor = (ref, bad) => {
    const chip = h('button', { class: `chip ${bad ? 'bad' : ''}`, onclick: () => showEvidence(ref, chip) }, ref);
    return chip;
  };

  const errors = issues.filter((i) => i.severity === 'error');
  const reviews = issues.filter((i) => i.severity === 'review');
  const s = validation?.stats;

  return [
    h(
      'div',
      { class: 'panel panel--pad' },
      h('div', { class: 'score-head' }, h('div', { class: 'score' }, o.overall.score), h('div', {}, h('div', { class: 'score-label' }, o.overall.anchor), h('div', { class: 'small muted' }, 'Holistic Layout score (1–5)'))),
      h('p', { class: 'reasoning' }, o.overall.reasoning),
      // The model's own summary of its reasoning, as returned by the provider.
      showTrace
        ? h(
            'details',
            { class: 'disclosure', open: !!reasoningSummary },
            h('summary', {}, 'Reasoning trace (the model’s summary of its reasoning)'),
            reasoningSummary ? h('pre', { style: { whiteSpace: 'pre-wrap' } }, reasoningSummary) : h('p', { class: 'small muted' }, 'None returned for this judgment (mock provider, or a model that returns no reasoning summary).'),
          )
        : null,
      o.overall.decisive_finding_ids
        ? h(
            'div',
            { class: 'row small', style: { marginTop: '14px' } },
            h('span', { class: 'muted' }, 'Decisive findings'),
            o.overall.decisive_finding_ids.map((id) => h('button', { class: 'chip', onclick: () => document.getElementById(`f-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, id)),
          )
        : null,
      h(
        'div',
        { style: { marginTop: '16px' } },
        s
          ? h('p', { class: `check-line ${errors.length ? '' : 'ok'}` }, `${errors.length ? '⚠' : '✓'} ${s.findings} findings (${s.strengths} strengths, ${s.weaknesses} weaknesses, ${s.missedOpportunities} missed opportunities) · ${s.validRefs} of ${s.refs} evidence references exist in the judge's input`)
          : null,
        [...errors, ...reviews].map((i) => h('p', { class: 'issue' }, `${i.findingId}: ${i.problem.replace(/_/g, ' ')}${i.ref ? ` (${i.ref})` : ''}`)),
        (validation?.otherIssues ?? []).map((m) => h('p', { class: 'issue' }, m)),
      ),
    ),
    h(
      'div',
      { class: 'panel', style: { marginTop: '20px' } },
      META.criteria.map((c) => {
        const cr = o.criteria[c.id];
        return h(
          'div',
          { class: 'criterion' },
          h('h2', {}, `${c.id} · ${c.name}`),
          cr.summary.trim() ? h('p', { class: 'criterion__summary' }, cr.summary) : h('p', { class: 'muted' }, 'No notes.'),
          cr.findings.map((f) => {
            const bad = new Set(issues.filter((i) => i.findingId === f.id && i.severity === 'error').map((i) => i.ref));
            return h(
              'div',
              { class: `finding ${f.polarity} ${decisive.has(f.id) ? 'decisive' : ''}`, id: `f-${f.id}` },
              h(
                'div',
                { class: 'finding__head' },
                h('strong', {}, f.id),
                pill(f.polarity),
                pill(f.materiality),
                h('span', { class: 'muted' }, c.points.find((p) => p.key === f.evaluation_point)?.name ?? f.evaluation_point),
                decisive.has(f.id) ? h('span', { class: 'muted' }, '· decisive') : null,
                f.states.length ? h('span', { class: 'faint' }, `· ${f.states.join(', ')}`) : null,
              ),
              h('p', { class: 'finding__obs' }, f.observation),
              h('p', { class: 'finding__why' }, f.why_it_matters),
              h('div', { class: 'chips' }, f.evidence_refs.map((r) => chipFor(r, bad.has(r)))),
            );
          }),
          // People rating with one note per criterion leave every point untouched.
          !c.points.some((p) => cr.evaluation_points[p.key]?.assessment?.trim() || cr.evaluation_points[p.key]?.applicable === false)
            ? null
            : h(
            'details',
            { class: 'disclosure' },
            h('summary', {}, `Evaluation points (${c.points.length})`),
            h(
              'table',
              { style: { marginTop: '8px' } },
              h('tbody', {}, c.points.map((p) => h('tr', {}, h('td', { style: { width: '200px' } }, p.name), h('td', { style: { width: '90px' } }, cr.evaluation_points[p.key]?.applicable ? pill('outline', 'applicable') : pill('na', 'n/a')), h('td', { class: 'small' }, cr.evaluation_points[p.key]?.assessment ?? '')))),
            ),
          ),
        );
      }),
    ),
    o.missing_evidence.length || o.untrusted_content_notes.length
      ? h(
          'div',
          { class: 'panel panel--pad', style: { marginTop: '20px' } },
          o.missing_evidence.length ? [h('h3', {}, 'Missing evidence noted by the judge'), h('ul', { class: 'bullets' }, o.missing_evidence.map((m) => h('li', {}, h('code', {}, m.evidence), ` (${m.affected_criteria.join(', ')}): ${m.effect_on_assessment}`)))] : null,
          o.untrusted_content_notes.length ? [h('h3', { style: { marginTop: '16px' } }, 'Untrusted content notes'), h('ul', { class: 'bullets' }, o.untrusted_content_notes.map((n) => h('li', {}, n)))] : null,
        )
      : null,
  ];
}

// ---------- Human ratings ----------
// A person rates in steps: instructions, one page per criterion, then the final judgement. They
// use the live interface (at each screen size and content state) and see screenshots only where
// automated checks failed. Their answers fill the judge's output schema, so a human rating has
// the judge's shape: each criterion's note is its summary, and the evaluation points are prompts
// rather than separate fields. Raters don't add findings; only the score is required.

const RATER_KEY = 'dj-rater';
const draftKey = (caseId, bundleId, v) => `dj-rate:${caseId}:${bundleId}:${v}`;
const humanize = (key) => key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
const joinAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

function emptyFromSchema(node) {
  if (node.type === 'object') return Object.fromEntries(Object.entries(node.properties).map(([k, v]) => [k, emptyFromSchema(v)]));
  if (node.type === 'array') return [];
  if (node.type === 'boolean') return true;
  if (node.type === 'integer' || node.enum) return null;
  return '';
}

// A saved draft in the current schema's shape (fields added or removed since are reconciled).
function mergeDraft(node, value) {
  if (node.type === 'object') {
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(Object.entries(node.properties).map(([k, sub]) => [k, k in v ? mergeDraft(sub, v[k]) : emptyFromSchema(sub)]));
  }
  if (node.type === 'array') return Array.isArray(value) ? value.map((x) => (node.items.type === 'object' ? mergeDraft(node.items, x) : x)) : [];
  return value === undefined ? emptyFromSchema(node) : value;
}

// What the draft still needs, with the step to fix it on. The server validates again on submit.
function draftProblems(draft) {
  return draft.overall?.score === null ? [{ step: 'final', text: 'Choose a score.' }] : [];
}

// Drafts started when the form had call-outs may hold unfinished ones, which no longer have
// fields to finish them in.
function withoutUnfinishedCallouts(draft) {
  const done = (f) => f.evaluation_point && f.polarity && f.materiality && f.observation?.trim();
  return { ...draft, criteria: Object.fromEntries(Object.entries(draft.criteria).map(([cid, c]) => [cid, { ...c, findings: c.findings.filter(done) }])) };
}

// The scoring section of the judge's instructions for this prompt version, split into its
// guidance and its anchors.
function scoringSection(instructions) {
  const text = instructions.match(/# How to score\n([\s\S]*?)(?=\n# |$)/)?.[1].trim() ?? '';
  const anchors = [];
  const intro = [];
  for (const line of text.split('\n')) {
    const a = line.match(/^- (\d) · ([^:]+): (.*)$/);
    if (a) anchors.push({ score: Number(a[1]), label: a[2], text: a[3] });
    else intro.push(line);
  }
  return { intro: intro.join('\n').trim(), anchors };
}

// Whether a page box falls on a screenshot of its state, as the judge's "Screenshots" lines work it out.
function boxOnShot(box, img) {
  if (box.fixed && img.kind === 'full') return false;
  const top = box.fixed || img.kind === 'full' ? 0 : img.scrollY ?? 0;
  const w = Math.min(img.width, box.rect.x + box.rect.w) - Math.max(0, box.rect.x);
  const ht = Math.min(img.height, box.rect.y - top + box.rect.h) - Math.max(0, box.rect.y - top);
  return w >= 2 && ht >= 2;
}
const shotsShowing = (line, images) => images.filter((img) => (line.boxes ?? []).some((b) => b.stateId === img.stateId && boxOnShot(b, img))).map((img) => img.id);

function openShot(img) {
  openModal(h('div', {}, h('p', { class: 'small muted', style: { marginBottom: '10px' } }, h('code', {}, img.id), ` — ${img.caption}`), h('img', { src: imgSrc(img.path), style: { maxWidth: `${displayWidth(img)}px` } })));
}

function shotGallery(images, open, title = 'Screenshots') {
  return h(
    'details',
    { class: 'gallery-wrap', open },
    h('summary', {}, h('h2', {}, title), h('span', { class: 'count' }, images.length), h('span', { class: 'small muted' }, 'Click one to see it full size.')),
    h(
      'div',
      { class: 'gallery' },
      images.map((img) =>
        h(
          'button',
          { type: 'button', class: 'gallery__item', onclick: () => openShot(img) },
          h('div', { class: 'gallery__thumb' }, h('img', { src: imgSrc(img.path), loading: 'lazy', alt: img.id })),
          h('code', {}, img.id),
          h('span', { class: 'gallery__caption' }, img.caption),
        ),
      ),
    ),
  );
}

// One criterion's evidence as the judge receives it, with each check issue and each measured
// value laid out the same way: what, where, and which screenshots show it.
function criterionEvidence(ev, images) {
  const imgById = new Map(images.map((i) => [i.id, i]));
  const chips = (ids) =>
    ids.length
      ? h('span', { class: 'chips chips--inline' }, ids.map((id) => (imgById.has(id) ? h('button', { type: 'button', class: 'chip', onclick: () => openShot(imgById.get(id)) }, id) : h('code', {}, id))))
      : h('span', { class: 'faint' }, 'none show it');
  const entry = (badge, l, shots) =>
    h(
      'div',
      { class: 'ev-entry' },
      h('div', { class: 'ev-entry__head' }, badge, h('code', { class: 'faint' }, l.ids[0])),
      h('p', {}, l.text),
      h('p', { class: 'small muted' }, `Where: ${l.where}.`),
      h('div', { class: 'small muted ev-entry__shots' }, 'Screenshots:', shots),
    );
  return [
    h(
      'div',
      { class: 'panel panel--pad ev-group' },
      h('h3', {}, 'Automated checks that failed'),
      h('p', { class: 'help' }, 'Objective problems found by code. Each issue’s number matches its red outline on the screenshots.'),
      ev.checks.length
        ? ev.checks.map((b) =>
            h(
              'div',
              { class: 'ev-block' },
              h('p', {}, h('strong', {}, b.check), h('span', { class: 'muted' }, ` looks for ${b.detects}.`)),
              b.issues.map((l) => entry(h('span', { class: 'marker' }, `Issue ${l.marker ?? '?'}`), l, chips(l.marked_in ?? []))),
              b.not_counted.map((n) => h('p', { class: 'small faint' }, `Not counted (the check deliberately excludes these): ${n}`)),
              b.more_issues ? h('p', { class: 'small faint' }, `${b.more_issues} further issue${b.more_issues > 1 ? 's' : ''} of this check are not listed.`) : null,
            ),
          )
        : h('p', { class: 'muted' }, 'None failed for this criterion.'),
    ),
    h(
      'details',
      { class: 'panel panel--pad ev-group disclosure' },
      h('summary', {}, `Measurements to weigh (${ev.observations.reduce((n, b) => n + b.lines.length, 0)})`),
      h('p', { class: 'help' }, 'Values outside or near the rubric’s reference. They are not failures; weigh them in context.'),
      ev.observations.length
        ? ev.observations.map((b) =>
            h(
              'div',
              { class: 'ev-block' },
              h('p', {}, h('strong', {}, b.observation), h('span', { class: 'muted' }, ` measures ${b.measures}.`)),
              h('p', { class: 'small muted' }, `Rubric reference: ${b.reference}`),
              b.lines.map((l) => entry(h('span', { class: 'marker marker--value' }, 'Value'), l, chips(shotsShowing(l, images)))),
            ),
          )
        : h('p', { class: 'muted' }, 'All within the reference for this criterion.'),
    ),
  ];
}

// Each evaluation point as a question for the rater. Points not listed fall back to the rubric's
// definition.
const POINT_PROMPTS = {
  primary_focus: 'Is the main task, and the main action, obvious straight away?',
  task_aligned_order: 'Does content come in order of importance, with the main task first?',
  grouping: 'Are related things grouped together, and separate groups clearly apart?',
  alignment: 'Do things line up on shared edges, with consistent spacing?',
  structural_restraint: 'Does it rely on spacing and alignment, rather than extra boxes, cards and dividers?',
  focused_composition: 'Is everything on the page needed for the task?',
  appropriate_density: 'Is the amount of information right for the task: not too sparse, not too crowded?',
  efficient_use_of_space: 'Is space used well, without oversized areas, repetition or needless scrolling?',
  clutter_control: 'Is secondary information tucked away or simplified where it would get in the way?',
  content_fit: 'Do labels, values, tables and lists have room to stay readable? Try “Longer text” and “Lots of content”.',
  usable_sizing: 'Does each main area and component get enough space to do its job?',
  functional_proportion: 'Do widths, heights and shapes suit what each component holds?',
  compositional_balance: 'Do the main and supporting areas feel balanced, with nothing accidentally huge, tiny or empty?',
  peer_consistency: 'Are similar components the same size and shape?',
  structural_integrity: 'Does anything overlap, get cut off, collapse or crowd the edges?',
  adaptive_behavior: 'On a smaller screen, do things stack, resize or simplify sensibly? Try Tablet and Phone.',
  growth_resilience: 'Does the layout hold up with lots of data or longer text?',
  priority_preservation: 'Do the important things stay prominent on smaller screens and with more content?',
  reachability: 'Can you still reach the key content and actions on a phone, or when the page is full?',
  scroll_behavior: 'Is any extra scrolling or hiding on small screens deliberate and easy to find?',
};

// Dictation into a text box, using the browser's speech recognition. Only one runs at a time.
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let activeVoice = null;
const MIC =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v5"/></svg>';

function voiceButton(textarea, onText) {
  if (!SpeechRec) return h('span', { class: 'small faint' }, 'Voice input isn’t available in this browser. Try Chrome, Edge or Safari.');
  const label = h('span', {}, 'Speak');
  const interim = h('span', { class: 'voice__interim' });
  const note = h('span', { class: 'small faint' });
  const btn = h('button', { type: 'button', class: 'voice-btn', 'aria-pressed': 'false', title: 'Talk instead of typing. Your browser turns speech into text; nothing is recorded.', onclick: () => (on ? stop() : start()) }, icon(MIC), label);
  let rec = null;
  let on = false;
  const ui = () => {
    btn.classList.toggle('voice-btn--on', on);
    btn.setAttribute('aria-pressed', String(on));
    label.textContent = on ? 'Listening… click to stop' : 'Speak';
    if (!on) interim.textContent = '';
  };
  const append = (text) => {
    const t = text.trim();
    if (!t) return;
    const cur = textarea.value;
    const newSentence = !cur.trim() || /[.!?]\s*$/.test(cur);
    textarea.value = cur + (cur && !/\s$/.test(cur) ? ' ' : '') + (newSentence ? t.charAt(0).toUpperCase() + t.slice(1) : t);
    onText(textarea.value);
  };
  const stop = () => {
    on = false;
    rec?.stop();
    rec = null;
    if (activeVoice?.stop === stop) activeVoice = null;
    ui();
  };
  const start = () => {
    activeVoice?.stop();
    activeVoice = { stop };
    note.textContent = '';
    rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-GB';
    rec.onresult = (e) => {
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) append(e.results[i][0].transcript);
        else pending += e.results[i][0].transcript;
      }
      interim.textContent = pending;
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') note.textContent = 'Microphone access is blocked. Allow it in your browser’s address bar, then try again.';
      if (e.error !== 'no-speech' && e.error !== 'aborted') stop();
    };
    // Browsers end recognition after a pause; carry on until the person stops it.
    rec.onend = () => {
      if (!on || !rec) return;
      try {
        rec.start();
      } catch {
        stop();
      }
    };
    rec.start();
    on = true;
    ui();
  };
  return h('div', { class: 'voice' }, btn, interim, note);
}

// The interface itself, in a sandboxed frame at a chosen screen size and content state. Built
// once per rating so it keeps its state while the person moves between steps.
const VIEW_SIZES = [
  { label: 'Desktop', width: 1440, height: 900 },
  { label: 'Tablet', width: 768, height: 1024 },
  { label: 'Phone', width: 360, height: 800 },
];
const FIXTURE_LABELS = { typical: 'Typical content', empty: 'Empty', dense: 'Lots of content', expanded: 'Longer text', stress: 'Stress test' };

function liveViewer(caseId, fixtures) {
  const state = { size: VIEW_SIZES[0], fixture: 'typical', full: false };
  const src = () => `/site/${caseId}/${state.fixture === 'typical' ? '' : `?fixture=${state.fixture}`}`;
  const frame = h('iframe', { class: 'live__frame', title: 'The interface being rated', sandbox: 'allow-scripts allow-forms allow-popups allow-modals', src: src() });
  const scaler = h('div', { class: 'live__scaler' }, frame);
  const stage = h('div', { class: 'live__stage' }, scaler);
  const sizeNote = h('span', { class: 'small muted' });
  const fit = () => {
    const avail = stage.clientWidth;
    if (!avail) return;
    const { width: w, height: ht } = state.size;
    const scale = Math.min(1, avail / w, state.full ? (window.innerHeight - 110) / ht : 1);
    Object.assign(frame.style, { width: `${w}px`, height: `${ht}px`, transform: `scale(${scale})` });
    Object.assign(scaler.style, { width: `${Math.floor(w * scale)}px`, height: `${Math.floor(ht * scale)}px` });
    sizeNote.textContent = `${w} × ${ht}${scale < 0.995 ? ` · shown at ${Math.round(scale * 100)}%` : ''}`;
  };
  const sizeButtons = VIEW_SIZES.map((s) => h('button', { type: 'button', onclick: () => ((state.size = s), draw()) }, s.label));
  const draw = () => {
    sizeButtons.forEach((b, i) => b.classList.toggle('active', VIEW_SIZES[i] === state.size));
    fit();
  };
  const contentPicker = fixtures.length
    ? h(
        'label',
        { class: 'small live__content' },
        'Content ',
        h('select', { onchange: (e) => ((state.fixture = e.target.value), (frame.src = src())) }, ['typical', ...fixtures.filter((f) => f !== 'typical')].map((f) => h('option', { value: f }, FIXTURE_LABELS[f] ?? f))),
      )
    : null;
  const onKey = (e) => e.key === 'Escape' && state.full && toggleFull();
  const fullButton = h('button', { type: 'button', class: 'link-btn small', onclick: () => toggleFull() }, 'Full screen');
  const toggleFull = () => {
    state.full = !state.full;
    root.classList.toggle('live--full', state.full);
    fullButton.textContent = state.full ? 'Exit full screen (Esc)' : 'Full screen';
    document[state.full ? 'addEventListener' : 'removeEventListener']('keydown', onKey);
    requestAnimationFrame(fit);
  };
  const root = h(
    'div',
    { class: 'live panel' },
    h(
      'div',
      { class: 'live__bar' },
      h('div', { class: 'seg' }, sizeButtons),
      contentPicker,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'link-btn small', onclick: () => (frame.src = src()) }, 'Reload'),
      fullButton,
      h('a', { class: 'small', href: src(), target: '_blank', rel: 'noopener' }, 'New tab ↗'),
    ),
    stage,
    h('div', { class: 'live__foot' }, sizeNote),
  );
  new ResizeObserver(fit).observe(stage);
  window.addEventListener('resize', fit);
  draw();
  return root;
}

// Screenshots with a failed check outlined, for one criterion (or all criteria).
function failureShots(input, cid) {
  const ids = new Set(
    input.evidence.criteria
      .filter((c) => !cid || c.criterion === cid)
      .flatMap((c) => c.checks.flatMap((b) => b.issues.flatMap((l) => l.marked_in ?? []))),
  );
  return input.images.filter((img) => ids.has(img.id));
}

// Form controls bound to the draft. `changed(structural)` saves; structural changes redraw the form.
function formKit(input, draft, changed) {
  const stateIds = [...new Set([...Object.values(input.evidenceIndex ?? {}).map((e) => e.stateId).filter(Boolean), 'desktop', 'tablet', 'mobile', 'stress-desktop'])].sort();
  const help = (text) => (text ? h('p', { class: 'help' }, text) : null);
  const field = (label, helpText, control) => h('div', { class: 'field' }, label ? h('div', { class: 'field__label' }, label) : null, help(helpText), control);
  const textArea = (obj, key, rows = 3, placeholder = '') => h('textarea', { rows, placeholder, oninput: (e) => ((obj[key] = e.target.value), changed(false)) }, obj[key] ?? '');
  const voiceText = (obj, key, rows, placeholder) => {
    const box = textArea(obj, key, rows, placeholder);
    return h('div', { class: 'voice-field' }, box, voiceButton(box, (v) => ((obj[key] = v), changed(false))));
  };
  const seg = (obj, key, options, onPick) =>
    h('div', { class: 'seg' }, options.map(([value, text]) => h('button', { type: 'button', class: obj[key] === value ? 'active' : '', onclick: () => ((obj[key] = value), onPick?.(value), changed(true)) }, text)));
  const checkList = (arr, options) =>
    h(
      'div',
      { class: 'checks' },
      options.map(([value, text]) =>
        h('label', {}, h('input', { type: 'checkbox', checked: arr.includes(value), onchange: (e) => (e.target.checked ? arr.push(value) : arr.splice(arr.indexOf(value), 1), changed(false)) }), ' ', text),
      ),
    );
  const stringList = (arr) =>
    h(
      'div',
      { class: 'stack' },
      arr.map((v, i) => h('div', { class: 'row' }, h('input', { type: 'text', value: v, style: { flex: 1 }, oninput: (e) => ((arr[i] = e.target.value), changed(false)) }), h('button', { type: 'button', class: 'link-btn', onclick: () => (arr.splice(i, 1), changed(true)) }, 'Remove'))),
      h('button', { type: 'button', class: 'link-btn', onclick: () => (arr.push(''), changed(true)) }, '+ Add'),
    );
  // Generic control from the schema, for the less common fields.
  const control = (key, node, obj) => {
    if (node.enum && node.type === 'string') return seg(obj, key, node.enum.map((v) => [v, v.replace(/_/g, ' ')]));
    if (node.type === 'array' && node.items.enum) return checkList(obj[key], node.items.enum.map((v) => [v, v]));
    if (node.type === 'array' && node.items.type === 'string') return stringList(obj[key]);
    if (node.type === 'array' && node.items.type === 'object')
      return h(
        'div',
        { class: 'stack' },
        obj[key].map((item, i) =>
          h(
            'div',
            { class: 'form-card' },
            h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'link-btn', onclick: () => (obj[key].splice(i, 1), changed(true)) }, 'Remove')),
            Object.entries(node.items.properties).map(([k, sub]) => field(humanize(k), sub.description, control(k, sub, item))),
          ),
        ),
        h('button', { type: 'button', class: 'btn-secondary', onclick: () => (obj[key].push(emptyFromSchema(node.items)), changed(true)) }, '+ Add'),
      );
    return textArea(obj, key);
  };
  return { stateIds, field, textArea, voiceText, seg, checkList, control };
}

function criterionForm(kit, input, draft, cid, changed) {
  const criterion = META.criteria.find((c) => c.id === cid);
  const c = draft.criteria[cid];
  return [
    h(
      'div',
      { class: 'form-section' },
      h('h3', {}, 'Your notes'),
      h('ul', { class: 'prompts' }, criterion.points.map((p) => h('li', { title: `${p.name}: ${p.definition}` }, POINT_PROMPTS[p.key] ?? `${p.name}: ${p.definition}`))),
      kit.voiceText(c, 'summary', 9, 'What works, what doesn’t, and where you saw it.'),
    ),
  ];
}

// What the rater wrote on the criterion pages, for the final judgement.
function wroteSummary(draft, go) {
  return META.criteria.map((criterion) => {
    const c = draft.criteria[criterion.id];
    // Per-point notes only exist in drafts started before the form took one note per criterion.
    const notes = criterion.points.filter((p) => c.evaluation_points[p.key].assessment.trim());
    const empty = !notes.length && !c.findings.length && !c.summary.trim();
    return h(
      'div',
      { class: 'panel panel--pad wrote' },
      h('div', { class: 'row' }, h('h3', {}, `${criterion.id} · ${criterion.name}`), h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'link-btn', onclick: () => go(criterion.id) }, 'Edit')),
      c.summary.trim() ? h('p', { class: 'wrote__summary' }, c.summary) : null,
      notes.length ? h('dl', { class: 'wrote__points' }, notes.map((p) => [h('dt', {}, p.name), h('dd', {}, c.evaluation_points[p.key].assessment)])) : null,
      c.findings.length
        ? h(
            'div',
            { class: 'stack' },
            c.findings.map((f) =>
              h(
                'div',
                { class: `form-card ${f.polarity ?? ''}` },
                h('div', { class: 'row' }, h('strong', { class: 'mono' }, f.id), f.polarity ? pill(f.polarity) : null, f.materiality ? pill(f.materiality) : null, h('span', { class: 'small muted' }, criterion.points.find((p) => p.key === f.evaluation_point)?.name ?? '')),
                h('p', {}, f.observation || h('span', { class: 'faint' }, 'No description')),
              ),
            ),
          )
        : null,
      empty ? h('p', { class: 'muted' }, 'No notes.') : null,
    );
  });
}

async function renderRate(interfaceId, version) {
  const cases = await api('cases');
  const target = cases.find((c) => c.latest?.interfaceId === interfaceId);
  if (!target) throw new Error(`No interface ${interfaceId} in the latest evidence.`);
  const caseId = target.caseId;
  const bundleId = target.latest.bundleId;
  const versions = META.ratingVersions;
  const v = version && versions.includes(version) ? version : versions.at(-1);
  const input = await api(`prompt/${caseId}/${bundleId}?version=${v}`);
  const key = draftKey(caseId, bundleId, v);
  const saved = JSON.parse(localStorage.getItem(key) || 'null');
  const state = {
    draft: mergeDraft(input.schema, saved?.draft),
    startedAt: saved?.startedAt ?? new Date().toISOString(),
    step: saved?.step ?? 'intro',
    agreed: saved?.agreed ?? false,
  };
  const persist = () => localStorage.setItem(key, JSON.stringify(state));
  const cids = Object.keys(input.schema.properties.criteria.properties);
  const steps = ['intro', ...cids, 'final'];
  const criterionOf = (cid) => META.criteria.find((c) => c.id === cid);
  const stepName = (s) => (s === 'intro' ? 'Instructions' : s === 'final' ? 'Final judgement' : `${s} · ${criterionOf(s).name}`);
  const touched = (cid) => {
    const c = state.draft.criteria[cid];
    return !!(c.summary.trim() || c.findings.length || Object.values(c.evaluation_points).some((p) => p.assessment.trim()));
  };
  const scoring = scoringSection(input.instructions);
  let rater = localStorage.getItem(RATER_KEY) ?? '';

  // The page is built once; each step swaps the instructions, the evidence under the live
  // interface, and the form. The live interface stays put so it keeps its state.
  const stepperSlot = h('div');
  const introSlot = h('div');
  const viewerSlot = h('div');
  const evidenceSlot = h('div');
  const formPanel = h('div', { class: 'rate-form panel' });
  const layout = h('div', { class: 'rate-layout' }, h('div', { class: 'rate-evidence' }, viewerSlot, evidenceSlot), formPanel);

  const go = (s) => {
    state.step = s;
    persist();
    draw();
    window.scrollTo(0, 0);
    formPanel.scrollTop = 0;
  };
  const stepper = () =>
    h(
      'nav',
      { class: 'stepper' },
      steps.map((s, i) =>
        h(
          'button',
          {
            type: 'button',
            class: `stepper__step ${s === state.step ? 'active' : ''} ${(s === 'intro' ? state.agreed : cids.includes(s) && touched(s)) ? 'done' : ''}`,
            disabled: !state.agreed && s !== 'intro',
            onclick: () => go(s),
          },
          h('span', { class: 'stepper__n' }, i + 1),
          stepName(s),
        ),
      ),
    );
  const nav = (status) => {
    const i = steps.indexOf(state.step);
    const prev = steps[i - 1];
    const next = steps[i + 1];
    return h(
      'div',
      { class: 'rate-form__foot' },
      status ?? null,
      h(
        'div',
        { class: 'row' },
        prev ? h('button', { type: 'button', class: 'btn-ghost', onclick: () => go(prev) }, '← Back') : null,
        h('span', { class: 'spacer' }),
        next ? h('button', { type: 'button', class: 'btn-primary', onclick: () => go(next) }, `Next: ${stepName(next)} →`) : null,
      ),
    );
  };

  const introStep = () => {
    const nameInput = h('input', { type: 'text', placeholder: 'Your name', value: rater, oninput: (e) => ((rater = e.target.value), localStorage.setItem(RATER_KEY, rater), (start.disabled = !rater.trim())) });
    const start = h('button', { type: 'button', class: 'btn-primary', disabled: !rater.trim(), onclick: () => ((state.agreed = true), go(cids[0])) }, state.agreed ? 'Continue' : 'Start →');
    const fixtures = (target.fixtures ?? []).filter((f) => f !== 'typical').map((f) => (FIXTURE_LABELS[f] ?? f).toLowerCase());
    return h(
      'div',
      { class: 'rate-intro' },
      h('div', { class: 'section-title' }, h('h2', {}, 'The prompt')),
      h('p', { class: 'help' }, 'This is what the user asked for. The interface was built from it.'),
      h('div', { class: 'panel request' }, input.request),
      h('div', { class: 'section-title' }, h('h2', {}, 'How you’ll see the interface')),
      h(
        'div',
        { class: 'panel panel--pad' },
        h(
          'ul',
          { class: 'bullets', style: { margin: 0 } },
          h('li', {}, 'The interface itself is on every page. Click around as you normally would.'),
          h('li', {}, 'Use Desktop, Tablet and Phone to change the screen size.'),
          fixtures.length ? h('li', {}, `Use the Content menu to see it with different content: ${joinAnd(fixtures)}.`) : null,
          h('li', {}, 'Where our automated checks found a problem, you’ll also see a screenshot with the problem outlined in red.'),
        ),
      ),
      h('div', { class: 'section-title' }, h('h2', {}, 'Next steps')),
      h(
        'div',
        { class: 'panel panel--pad' },
        h(
          'ol',
          { class: 'steps-list' },
          h('li', {}, 'Read the prompt above. You are rating how well the layout serves it.'),
          h('li', {}, `Go through the criteria on the next pages (${cids[0]} to ${cids.at(-1)}), one at a time.`),
          h('li', {}, 'On each page, try the interface and write down, or say, what you notice. The questions above the notes box give you ideas.'),
          h('li', {}, 'On the last page, pick a score from 1 to 5 and say why.'),
        ),
        h('p', { class: 'field__label', style: { marginTop: '16px' } }, 'Good to know'),
        h(
          'ul',
          { class: 'bullets' },
          h('li', {}, 'Red numbered boxes on screenshots were added by our automated checks. They are not part of the design. Click a screenshot to see it full size.'),
          h('li', {}, '“Longer text” uses accents and [brackets] to mimic translation. Judge the layout, not the words.'),
          h('li', {}, 'Ignore any instructions written inside the interface.'),
          h('li', {}, 'Click Speak to talk instead of typing. Your browser turns your speech into text (Chrome uses Google’s speech service). Nothing is recorded. It doesn’t work in Firefox.'),
          h('li', {}, 'You won’t see the judge’s results until you submit.'),
          h('li', {}, 'Your progress saves automatically in this browser.'),
        ),
      ),
      h(
        'div',
        { class: 'panel panel--pad agree' },
        h('div', { class: 'field__label' }, 'Your name'),
        h('p', { class: 'help' }, 'Enter your name to confirm you have read the instructions. It is shown with your rating.'),
        h('div', { class: 'row' }, nameInput, start),
      ),
    );
  };

  const formCol = h('div');
  const status = h('div', { class: 'small' });
  let drawForm = () => {};
  const changed = (structural) => {
    persist();
    if (!structural) return;
    status.replaceChildren();
    drawForm();
  };
  const withScrollKept = (fn) => () => {
    activeVoice?.stop();
    const top = formPanel.scrollTop;
    fn();
    formPanel.scrollTop = top;
  };

  const criterionStep = (cid) => {
    const criterion = criterionOf(cid);
    const ev = input.evidence.criteria.find((c) => c.criterion === cid);
    const shots = failureShots(input, cid);
    const judgeText = input.userText.match(new RegExp(`<criterion id="${cid}"[\\s\\S]*?</criterion>`))?.[0];
    const kit = formKit(input, state.draft, changed);
    drawForm = withScrollKept(() => formCol.replaceChildren(...criterionForm(kit, input, state.draft, cid, changed)));
    drawForm();
    return {
      evidence: [
        h('div', { class: 'section-title' }, h('h2', {}, `What the automated checks found for ${cid}`)),
        shots.length ? shotGallery(shots, true, 'Screenshots of the problems') : null,
        criterionEvidence(ev, shots),
        judgeText ? h('details', { class: 'disclosure' }, h('summary', {}, 'Exactly what the judge reads for this criterion'), h('div', { class: 'panel panel--pad' }, messageText(judgeText))) : null,
      ],
      form: [h('div', { class: 'rate-form__head rate-form__head--stack' }, h('h2', {}, `${cid} · ${criterion.name}`), h('p', { class: 'help' }, criterion.statement)), formCol, nav()],
    };
  };

  const finalStep = () => {
    const kit = formKit(input, state.draft, changed);
    const overall = state.draft.overall;
    const anchorNode = input.schema.properties.overall.properties.anchor;
    const scoreNode = input.schema.properties.overall.properties.score;
    const anchorFor = (score) => anchorNode.enum[scoreNode.enum.indexOf(score)];
    const anchors = scoring.anchors.length ? scoring.anchors : scoreNode.enum.map((s) => ({ score: s, label: anchorFor(s), text: '' }));
    const extras = Object.entries(input.schema.properties).filter(([k]) => k !== 'criteria' && k !== 'overall');
    const shots = failureShots(input);
    drawForm = withScrollKept(() =>
      formCol.replaceChildren(
        h(
          'div',
          { class: 'form-section' },
          h('h3', {}, 'Score'),
          scoring.intro ? h('details', { class: 'disclosure', style: { marginTop: '4px' } }, h('summary', {}, 'How to score'), messageText(scoring.intro)) : null,
          h(
            'div',
            { class: 'score-cards' },
            anchors.map((a) =>
              h(
                'button',
                { type: 'button', class: `score-card ${overall.score === a.score ? 'active' : ''}`, onclick: () => ((overall.score = a.score), (overall.anchor = anchorFor(a.score)), changed(true)) },
                h('span', { class: 'score-card__n' }, a.score),
                h('span', {}, h('strong', {}, a.label), a.text ? h('span', { class: 'score-card__text' }, a.text) : null),
              ),
            ),
          ),
        ),
        h('div', { class: 'form-section' }, kit.field('Why this score', 'Which of your notes led to it.', kit.voiceText(overall, 'reasoning', 5))),
        h(
          'details',
          { class: 'form-section' },
          h('summary', {}, 'Anything else', h('span', { class: 'faint small' }, ' · optional')),
          extras.map(([k, node]) => kit.field(humanize(k), node.description, kit.control(k, node, state.draft))),
        ),
      ),
    );
    drawForm();
    const submit = async () => {
      const problems = draftProblems(state.draft);
      if (!rater.trim()) problems.unshift({ step: 'intro', text: 'Enter your name on the Instructions page.' });
      if (problems.length)
        return status.replaceChildren(
          h('div', { class: 'issue-list' }, problems.map((p) => h('p', { class: 'issue' }, p.text, p.step !== 'final' ? [' ', h('button', { type: 'button', class: 'link-btn', onclick: () => go(p.step) }, 'Go there')] : null))),
        );
      activeVoice?.stop();
      status.replaceChildren(h('p', { class: 'muted' }, 'Saving…'));
      const res = await fetch(`/api/human/${caseId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bundleId, promptVersion: v, rater, output: withoutUnfinishedCallouts(state.draft), startedAt: state.startedAt, view: 'live' }),
      });
      const data = await res.json();
      if (!res.ok) return status.replaceChildren(h('div', { class: 'issue-list' }, (data.errors ?? [data.error]).map((p) => h('p', { class: 'issue' }, p))));
      localStorage.removeItem(key);
      location.hash = `#/human/${caseId}/${data.rating.ratingId}`;
    };
    const foot = nav(status);
    foot.querySelector('.row').append(h('button', { type: 'button', class: 'btn-primary', onclick: submit }, 'Submit rating'));
    return {
      evidence: [h('div', { class: 'section-title' }, h('h2', {}, 'What you wrote')), wroteSummary(state.draft, go), shots.length ? shotGallery(shots, false, 'Screenshots of the problems') : null],
      form: [h('div', { class: 'rate-form__head rate-form__head--stack' }, h('h2', {}, 'Final judgement'), h('p', { class: 'help' }, 'Look back over your notes, then pick one score for the whole layout.')), formCol, foot],
    };
  };

  const discard = () => {
    if (!confirm('Discard this draft and start again?')) return;
    localStorage.removeItem(key);
    location.reload();
  };

  function draw() {
    if (!state.agreed) state.step = 'intro';
    activeVoice?.stop();
    status.replaceChildren();
    stepperSlot.replaceChildren(stepper());
    const intro = state.step === 'intro';
    introSlot.hidden = !intro;
    layout.hidden = intro;
    if (intro) return introSlot.replaceChildren(introStep());
    if (!viewerSlot.firstChild) viewerSlot.append(liveViewer(caseId, target.fixtures ?? []));
    const { evidence, form } = state.step === 'final' ? finalStep() : criterionStep(state.step);
    mount(evidenceSlot, evidence);
    mount(formPanel, form);
  }

  mount(
    $app,
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), ' / ', `Rate ${interfaceId}`),
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'row' },
        h('h1', {}, `Rate interface ${interfaceId}`),
        h('span', { class: 'spacer' }),
        versions.length > 1 ? [h('span', { class: 'small muted' }, 'Prompt version'), h('div', { class: 'repeats' }, versions.map((pv) => h('a', { href: `#/rate/${interfaceId}?v=${pv}`, class: pv === v ? 'active' : '', style: { width: 'auto', padding: '0 10px' } }, pv)))] : null,
        h('button', { type: 'button', class: 'link-btn small', onclick: discard }, 'Discard draft'),
      ),
      stepperSlot,
    ),
    introSlot,
    layout,
  );
  $app.classList.add('wide');
  draw();
}

const meanOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmtScores = (xs) => xs.map((x) => x ?? '×').join(' ');

function humanRatingsTab(caseId, data, interfaceId) {
  data = { ...data, judge: data.judge.filter((r) => r.scores.some((x) => x !== null)) };
  const humanScores = data.ratings.map((r) => r.score);
  const hm = meanOf(humanScores);
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'section-title' },
      h('h2', {}, 'Human ratings'),
      h('span', { class: 'count' }, data.ratings.length),
      hm !== null ? h('span', { class: 'small muted' }, `mean ${hm.toFixed(2)}`) : null,
      data.ratings.length
        ? [
            h('span', { class: 'spacer' }),
            h('span', { class: 'small muted' }, 'Download:'),
            h('a', { class: 'small', href: '/files/human/ratings.csv' }, 'ratings.csv'),
            h('a', { class: 'small', href: '/files/human/findings.csv' }, 'findings.csv'),
            h('a', { class: 'small', href: '/files/human/points.csv' }, 'points.csv'),
          ]
        : null,
    ),
    data.error
      ? h('div', { class: 'notice' }, `Could not load ratings: ${data.error}`)
      : data.ratings.length
      ? h(
          'div',
          { class: 'panel' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, ['Date', 'Rater', 'Prompt', 'Evidence', 'Time', 'Score'].map((t) => h('th', {}, t)))),
            h(
              'tbody',
              {},
              data.ratings.map((r) =>
                h(
                  'tr',
                  { class: 'link-row', onclick: () => (location.hash = `#/human/${caseId}/${r.ratingId}`) },
                  h('td', {}, fmtDate(r.createdAt)),
                  h('td', {}, r.rater),
                  h('td', {}, r.promptVersion),
                  h('td', { class: 'small' }, r.bundleId === data.latestBundleId ? 'latest' : h('span', { class: 'faint' }, 'older')),
                  h('td', { class: 'small' }, r.durationMs ? `${Math.round(r.durationMs / 60000)} min` : '—'),
                  h('td', {}, h('strong', {}, r.score), h('span', { class: 'muted' }, ` ${r.anchor}`)),
                ),
              ),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'No human ratings yet. Use “Rate interface” at the top right to add one.'),
    judgeScoresSection(caseId, data, interfaceId),
  );
}

const EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 4.2A10.6 10.6 0 0 1 12 4c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a10.4 10.4 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M2 2l20 20"/></svg>';
const icon = (svg) => {
  const span = h('span', { class: 'icon' });
  span.innerHTML = svg;
  return span;
};

// Judge scores stay blurred until the current rater has rated this interface's latest evidence,
// so their rating is not anchored on the judge's. The eye button shows or hides them anyway.
function judgeScoresSection(caseId, data, interfaceId) {
  const revealKey = `dj-reveal:${caseId}`;
  const me = localStorage.getItem(RATER_KEY) ?? '';
  const rated = !!me && data.ratings.some((r) => r.rater === me && r.bundleId === data.latestBundleId);
  const wrap = h('div', { style: { marginTop: '40px' } });
  const draw = () => {
    const stored = localStorage.getItem(revealKey);
    const shown = stored === null ? rated : stored === 'shown';
    const set = (v) => (localStorage.setItem(revealKey, v ? 'shown' : 'hidden'), draw());
    wrap.replaceChildren(
      h(
        'div',
        { class: 'section-title' },
        h('h2', {}, 'Judge scores for this interface'),
        h('span', { class: 'count' }, data.judge.length),
        data.judge.length
          ? h('button', { type: 'button', class: 'icon-btn', title: shown ? 'Hide judge scores' : 'Show judge scores', 'aria-label': shown ? 'Hide judge scores' : 'Show judge scores', onclick: () => set(!shown) }, icon(shown ? EYE : EYE_OFF))
          : null,
      ),
      !data.judge.length
        ? h('p', { class: 'muted' }, 'No judge runs for this interface.')
        : h(
            'div',
            { class: `reveal ${shown ? '' : 'reveal--hidden'}` },
            h('div', { class: 'reveal__content', 'aria-hidden': shown ? null : 'true' }, judgeScoresTable(caseId, data)),
            shown
              ? null
              : h(
                  'div',
                  { class: 'reveal__cover' },
                  h('p', {}, h('strong', {}, 'Rate this interface to see the judge’s results.')),
                  h('p', { class: 'small muted' }, 'Seeing them first can sway your own rating.'),
                  h(
                    'div',
                    { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } },
                    interfaceId ? h('a', { class: 'btn-primary', href: `#/rate/${interfaceId}` }, 'Rate this interface') : null,
                    h('button', { type: 'button', class: 'link-btn', onclick: () => set(true) }, 'Skip and show results'),
                  ),
                ),
          ),
    );
  };
  draw();
  return wrap;
}

function judgeScoresTable(caseId, data) {
  return h(
          'div',
          { class: 'panel' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, ['Date', 'Model', 'Prompt', 'Evidence', 'Scores', 'Mean', 'Label'].map((t) => h('th', {}, t)))),
            h(
              'tbody',
              {},
              [...data.judge].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map((r) => {
                const m = meanOf(r.scores.filter((x) => x !== null));
                return h(
                  'tr',
                  { class: 'link-row', onclick: () => (location.hash = `#/judgment/${r.runId}/${caseId}/1`) },
                  h('td', {}, fmtDate(r.createdAt)),
                  h('td', {}, r.model),
                  h('td', {}, r.promptVersion),
                  h('td', { class: 'small' }, r.bundleId === data.latestBundleId ? 'latest' : h('span', { class: 'faint' }, 'older')),
                  h('td', { class: 'mono' }, fmtScores(r.scores)),
                  h('td', {}, m === null ? '—' : m.toFixed(1)),
                  h('td', { class: 'muted small' }, r.label),
                );
              }),
            ),
          ),
        );
}

async function renderHumanRating(caseId, ratingId) {
  const [{ rating: r, request }, list] = await Promise.all([api(`human/${caseId}/${ratingId}`), api(`human/${caseId}`)]);
  const sameEvidence = list.judge.filter((x) => x.bundleId === r.bundleId && x.promptVersion === r.promptVersion);
  const judgeScores = sameEvidence.flatMap((x) => x.scores).filter((x) => x !== null);
  const del = async () => {
    if (!confirm('Delete this rating?')) return;
    await fetch(`/api/human/${caseId}/${ratingId}`, { method: 'DELETE' });
    location.hash = `#/case/${caseId}?tab=human`;
  };
  mount($app,
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Test Interfaces'), ' / ', h('a', { href: `#/case/${caseId}?tab=human` }, caseId), ' / ', `rating by ${r.rater}`),
    h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'row' }, h('h1', {}, `${r.rater}’s rating`), h('span', { class: 'spacer' }), HOSTED ? null : h('button', { type: 'button', class: 'link-btn', onclick: del }, 'Delete rating')),
      h('p', { class: 'meta' }, `${fmtDate(r.createdAt)} · ${r.view === 'live' ? 'rated using the live interface' : 'rated from screenshots'} · prompt ${r.promptVersion} · evidence ${r.bundleId}${r.durationMs ? ` · ${Math.round(r.durationMs / 60000)} min` : ''}`),
      h(
        'p',
        { class: 'meta' },
        judgeScores.length
          ? `The judge scored the same evidence with prompt ${r.promptVersion} as ${fmtScores(judgeScores)} (mean ${meanOf(judgeScores).toFixed(1)}), across ${sameEvidence.length} run${sameEvidence.length === 1 ? '' : 's'}.`
          : `No judge run has scored this evidence with prompt ${r.promptVersion} yet.`,
      ),
    ),
    judgmentPanels(r.output, { validation: r.validation, request, showTrace: false }),
  );
}

// ---------- Router ----------

async function router() {
  activeVoice?.stop();
  closeDrawer();
  $modal.hidden = true;
  const [pathPart, query] = (location.hash.replace(/^#\/?/, '') || '').split('?');
  const params = new URLSearchParams(query ?? '');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  $app.classList.remove('wide');
  $app.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (!META) META = await api('meta');
    if (parts[0] === 'case') await renderCase(parts[1], params.get('tab') ?? 'human', params.get('v'));
    else if (parts[0] === 'run') await renderRun(parts[1]);
    else if (parts[0] === 'rate') await renderRate(parts[1], params.get('v'));
    else if (parts[0] === 'human') await renderHumanRating(parts[1], parts[2]);
    else if (parts[0] === 'judgment') await renderJudgment(parts[1], parts[2], parts[3], params.get('tab') ?? 'judgment');
    else await renderHome();
    window.scrollTo(0, 0);
  } catch (err) {
    $app.replaceChildren(h('div', { class: 'notice' }, `Error: ${err.message}`));
  }
}

window.addEventListener('hashchange', router);
router();
