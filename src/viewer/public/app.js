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

async function api(path) {
  const res = await fetch('/api/' + path);
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
    h('div', { class: 'section-title' }, h('h1', {}, 'Interfaces'), h('span', { class: 'count' }, cases.length)),
    h(
      'div',
      { class: 'cards' },
      cases.map((c) =>
        h(
          'div',
          { class: 'card' },
          h('h3', {}, h('a', { href: `#/case/${c.caseId}` }, c.title)),
          h('code', { class: 'faint' }, c.caseId),
          h('p', { class: 'card__request' }, c.request),
          h(
            'div',
            { class: 'card__foot' },
            c.latest
              ? c.latest.failing.length
                ? pill('fail', `${c.latest.failing.length} failing checks`)
                : pill('pass', 'no failing checks')
              : pill('na', 'not collected'),
            h('a', { href: `#/case/${c.caseId}` }, 'Evidence'),
            h('a', { href: `/site/${c.caseId}/`, target: '_blank' }, 'Open ↗'),
          ),
        ),
      ),
    ),
    h('div', { class: 'section-title' }, h('h1', {}, 'Judge runs'), h('span', { class: 'count' }, runs.length)),
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
  const data = await api(`case/${caseId}`);
  const { summary, bundle } = data;
  const tabs = [
    ['evidence', 'What the judge sees'],
    ['states', 'All captured states'],
    ['code', 'Code'],
  ];
  const body = h('div');
  mount($app,
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Interfaces'), ' / ', caseId),
    h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'row' }, h('h1', {}, summary.title), h('span', { class: 'spacer' }), h('a', { href: `/site/${caseId}/`, target: '_blank' }, 'Open interface ↗')),
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
  const evidence = request?.evidence ?? (request ? parseUserText(request.userText).evidence : null);
  const ctx = { images: request?.images ?? [] };
  const index = request?.evidenceIndex ?? {};
  const decisive = new Set(o.overall.decisive_finding_ids);
  const issues = j.validation?.refIssues ?? [];
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
  const s = j.validation?.stats;

  add(body,
    h(
      'div',
      { class: 'panel panel--pad' },
      h('div', { class: 'score-head' }, h('div', { class: 'score' }, o.overall.score), h('div', {}, h('div', { class: 'score-label' }, o.overall.anchor), h('div', { class: 'small muted' }, 'Holistic Layout score (1–5)'))),
      h('p', { class: 'reasoning' }, o.overall.reasoning),
      // The model's own summary of its reasoning, as returned by the provider.
      h(
        'details',
        { class: 'disclosure', open: !!j.reasoningSummary },
        h('summary', {}, 'Reasoning trace (the model’s summary of its reasoning)'),
        j.reasoningSummary ? h('pre', { style: { whiteSpace: 'pre-wrap' } }, j.reasoningSummary) : h('p', { class: 'small muted' }, 'None returned for this judgment (mock provider, or a model that returns no reasoning summary).'),
      ),
      h(
        'div',
        { class: 'row small', style: { marginTop: '14px' } },
        h('span', { class: 'muted' }, 'Decisive findings'),
        o.overall.decisive_finding_ids.map((id) => h('button', { class: 'chip', onclick: () => document.getElementById(`f-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, id)),
      ),
      h(
        'div',
        { style: { marginTop: '16px' } },
        s
          ? h('p', { class: `check-line ${errors.length ? '' : 'ok'}` }, `${errors.length ? '⚠' : '✓'} ${s.findings} findings (${s.strengths} strengths, ${s.weaknesses} weaknesses, ${s.missedOpportunities} missed opportunities) · ${s.validRefs} of ${s.refs} evidence references exist in the judge's input`)
          : null,
        [...errors, ...reviews].map((i) => h('p', { class: 'issue' }, `${i.findingId}: ${i.problem.replace(/_/g, ' ')}${i.ref ? ` (${i.ref})` : ''}`)),
        (j.validation?.otherIssues ?? []).map((m) => h('p', { class: 'issue' }, m)),
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
          h('p', { class: 'criterion__summary' }, cr.summary),
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
          h(
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
  );
}

// ---------- Router ----------

async function router() {
  closeDrawer();
  $modal.hidden = true;
  const [pathPart, query] = (location.hash.replace(/^#\/?/, '') || '').split('?');
  const params = new URLSearchParams(query ?? '');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  $app.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (!META) META = await api('meta');
    if (parts[0] === 'case') await renderCase(parts[1], params.get('tab') ?? 'evidence', params.get('v'));
    else if (parts[0] === 'run') await renderRun(parts[1]);
    else if (parts[0] === 'judgment') await renderJudgment(parts[1], parts[2], parts[3], params.get('tab') ?? 'judgment');
    else await renderHome();
    window.scrollTo(0, 0);
  } catch (err) {
    $app.replaceChildren(h('div', { class: 'notice' }, `Error: ${err.message}`));
  }
}

window.addEventListener('hashchange', router);
router();
