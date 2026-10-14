// Functionality checks on what the page says about its own data (State and Data Integrity), read
// from each state's accessibility outline: a count against the items listed, a total against its
// line items, a sort order against the values shown, a period against the dates or labels shown,
// the detail opened against the item clicked, and values a template left unfilled. One measurement
// (Feedback and Recovery): validation messages that name neither the field nor the fix.

import { loadFunctionalProbe } from '../../collect/probeStore.ts';
import { bundleDir } from '../../store.ts';
import type { Bundle, DiagnosticItem, ElementRecord, StateRecord } from '../../types.ts';
import type { Doc } from '../doc.ts';
import type { CheckOutput } from '../layout/deterministic.ts';
import type { ObservationOutput } from '../layout/observations.ts';
import { ancestors, loadOutline, nodeLabel, nodeText, walk, type OutlineNode } from '../outline.ts';

type PerState = Map<string, CheckOutput>;
interface Finding {
  summary: string;
  data: Record<string, unknown>;
  // The page text the finding is about, found again in the state's snapshot to outline it.
  at?: string;
}

const num = (s: string) => parseFloat(s.replace(/,/g, ''));
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const checked = (n: OutlineNode) => n.attrs.checked === true || n.attrs.checked === 'true';

// States whose words come from the interface: baselines, interactive states and the empty and
// dense fixtures. The expanded and stress fixtures carry harness-made strings.
export function ownTextStates(bundle: Bundle): StateRecord[] {
  return bundle.states.filter((s) => s.status === 'collected' && s.kind !== 'sweep' && s.kind !== 'stress' && !(s.kind === 'fixture' && ['expanded', 'stress'].includes(s.fixture ?? '')));
}

// One result per state: a failure lists each distinct finding once.
function perState(bundle: Bundle, check: (o: OutlineNode, s: StateRecord) => { evaluated: number; found: Finding[] }, text: { pass: (n: number) => string; fail: (n: number) => string }): PerState {
  const out: PerState = new Map();
  for (const s of ownTextStates(bundle)) {
    const o = loadOutline(bundle, s);
    if (!o) continue;
    const { evaluated, found } = check(o, s);
    const unique = [...new Map(found.map((f) => [f.summary, f])).values()];
    const items: DiagnosticItem[] = unique.map((f, i) => ({ n: i + 1, summary: f.summary, elements: [], data: f.at ? { ...f.data, at: f.at } : f.data }));
    out.set(s.id, { status: items.length ? 'fail' : 'pass', evaluated, summary: items.length ? text.fail(items.length) : text.pass(evaluated), items, secondary: [] });
  }
  return out;
}

// Outlines each finding on the screenshots: the smallest visible element whose words (its own
// text, its descendants' and, for a control without text, its name) include every word of the
// text the finding is about. A finding whose text is not found keeps no element.
const wordsOf = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export function locateFindings(items: DiagnosticItem[], doc: Doc): void {
  const memo = new Map<number, string[]>();
  const bag = (el: ElementRecord): string[] => {
    const hit = memo.get(el.id);
    if (hit) return hit;
    const own = wordsOf(el.ownText ? el.text ?? '' : '');
    const w = [...own, ...doc.children(el).flatMap(bag)];
    const out = w.length ? w : wordsOf(el.name ?? '');
    memo.set(el.id, out);
    return out;
  };
  const contains = (have: string[], want: string[]) => {
    const n = new Map<string, number>();
    for (const x of have) n.set(x, (n.get(x) ?? 0) + 1);
    return want.every((x) => {
      const k = n.get(x) ?? 0;
      n.set(x, k - 1);
      return k > 0;
    });
  };
  for (const it of items) {
    const want = wordsOf(String(it.data?.at ?? ''));
    if (!want.length) continue;
    const hit = doc.els
      .filter((e) => e.visible && e.rect.w > 0 && e.rect.h > 0 && contains(bag(e), want))
      .sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
    if (hit) it.elements = [doc.ref(hit)];
  }
}

// ---------- Collections ----------

const ITEM_ROLES = ['article', 'listitem', 'row'];
const SEPARATE = ['region', 'dialog', 'alertdialog', 'complementary', 'form', 'navigation'];
const ITEM_NOUN: Record<string, string> = { article: 'cards', listitem: 'list items', row: 'table rows' };

interface Collection {
  role: string;
  items: OutlineNode[];
  container: OutlineNode;
}

// The repeated items in a scope: the largest run of same-role children (cards, list items, table
// rows other than header rows) of the scope or of anything under it, without crossing into
// another region, dialog, form or navigation.
export function collectionIn(scope: OutlineNode): Collection | null {
  let best: Collection | null = null;
  const visit = (n: OutlineNode, top: boolean) => {
    if (!top && SEPARATE.includes(n.role)) return;
    const byRole = new Map<string, OutlineNode[]>();
    for (const c of n.children) if (ITEM_ROLES.includes(c.role)) byRole.set(c.role, [...(byRole.get(c.role) ?? []), c]);
    for (const [role, items] of byRole) {
      const real = role === 'row' ? items.filter((r) => !r.children.some((c) => c.role === 'columnheader')) : items;
      if (!best || real.length > best.items.length) best = { role, items: real, container: n };
    }
    for (const c of n.children) if (!ITEM_ROLES.includes(c.role) || c.role === 'listitem') visit(c, false);
  };
  visit(scope, true);
  return best;
}

function scopeOf(node: OutlineNode): OutlineNode {
  for (const a of ancestors(node)) if (['region', 'main', 'dialog', 'alertdialog', 'complementary', 'form', 'article', 'tabpanel'].includes(a.role)) return a;
  let r = node;
  while (r.parent) r = r.parent;
  return r;
}

const inItem = (n: OutlineNode) => ancestors(n).some((a) => ['article', 'listitem', 'row', 'cell', 'option'].includes(a.role));

function describe(n: OutlineNode, text: string): string {
  return `${n.role === 'heading' ? 'The heading' : n.role === 'status' ? 'The status line' : 'The text'} "${short(text)}"`;
}

// ---------- Money ----------

const MONEY = /([£$€])\s?(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)(k|m)?\b/gi;
interface Amount {
  value: number;
  raw: string;
  index: number;
}
export function amounts(text: string): Amount[] {
  return [...text.matchAll(MONEY)].map((m) => {
    const scale = m[3]?.toLowerCase() === 'k' ? 1000 : m[3]?.toLowerCase() === 'm' ? 1e6 : 1;
    return { value: num(m[2]) * scale, raw: m[0], index: m.index! };
  });
}
const fmtMoney = (v: number, symbol = '£') => `${symbol}${v.toLocaleString('en-GB', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

// ---------- Count claims ----------

// Nouns after a number that are units or attributes, not things listed ("12 miles", "5 doors").
const UNITS =
  /^(miles?|mi|km|kms|kilometres?|metres?|meters?|mins?|minutes?|hours?|hrs?|days?|weeks?|months?|years?|yrs?|seconds?|secs?|pts|points|px|kg|g|lbs?|doors?|seats?|stars?|reviews?|ratings?|sold|left|percent|mph|cc|bhp|hp|kw|mpg|p)$/i;
const COUNT = /(?:^|[\s(])(\d{1,3}(?:,\d{3})+|\d+)\s+([a-z][a-z-]{2,})(?:\b|$)|\(n\s*=\s*(\d+)\)|\bshowing\s+(\d+)\s*(?:–|-|to)\s*(\d+)\s+of\s+(\d[\d,]*)/gi;
// A control that shows more than is listed: the claim may count more than the page shows.
export const CONTINUATION = /\b(load|show|see|view)\b.{0,24}\b(more|all|next|remaining|rest)\b|\bnext( page)?\b|\bpage \d+|\bmore results\b|^›$|^»$/i;
const EMPTY_STATE = /\b(no|nothing|none|0) (\w+ )?(found|yet|to show|available|match|results?|orders?|items?|cars?)\b|\bis empty\b/i;

interface Claim {
  n: number;
  noun: string;
  showing?: [number, number];
}

export function countsIn(text: string): Claim[] {
  const out: Claim[] = [];
  for (const m of text.matchAll(COUNT)) {
    if (m[3]) out.push({ n: num(m[3]), noun: 'items' });
    else if (m[6]) out.push({ n: num(m[6]), noun: 'items', showing: [num(m[4]), num(m[5])] });
    else {
      const noun = m[2];
      if (UNITS.test(noun)) continue;
      // "12 cars" or "1 car": a plural noun unless the count is 1; a year is not a count.
      if (!/s$/i.test(noun) && num(m[1]) !== 1) continue;
      if (/^(19|20)\d\d$/.test(m[1])) continue;
      out.push({ n: num(m[1]), noun });
    }
  }
  return out;
}

// Where a claim's items are: under its parent, or in a region, list or table after it.
function claimedCollection(n: OutlineNode): { scope: OutlineNode; coll: Collection | null } {
  let scope = n.parent!;
  let coll = collectionIn(scope);
  for (let up: OutlineNode = n; !coll && up.parent; up = up.parent) {
    const sibs = up.parent.children;
    for (const sib of sibs.slice(sibs.indexOf(up) + 1)) {
      if (!['region', 'list', 'table', 'feed', 'grid'].includes(sib.role)) continue;
      coll = collectionIn(sib);
      if (coll) {
        scope = sib;
        break;
      }
    }
    if (['region', 'main', 'dialog'].includes(up.parent.role)) break;
  }
  return { scope, coll };
}

export function countClaims(bundle: Bundle): PerState {
  return perState(
    bundle,
    (o, s) => {
      const found: Finding[] = [];
      let evaluated = 0;
      for (const n of walk(o)) {
        // Claims sit in headings, status lines and short paragraphs about a collection, not in
        // the items themselves.
        const isHeading = n.role === 'heading' && !inItem(n);
        const isDesc =
          ['paragraph', 'text', 'status'].includes(n.role) &&
          !!n.parent &&
          !['listitem', 'article', 'row', 'cell', 'option', 'definition', 'term', 'checkbox', 'radio', 'button', 'link', 'label'].includes(n.parent.role) &&
          !ancestors(n).some((a) => ITEM_ROLES.includes(a.role));
        if (!isHeading && !isDesc) continue;
        const text = nodeLabel(n);
        if (amounts(text).length) continue;
        for (const c of countsIn(text)) {
          const { scope, coll } = claimedCollection(n);
          const listed = coll?.items.length ?? 0;
          const empty = listed === 0 && EMPTY_STATE.test(nodeText(scope));
          if (!coll && !empty) continue;
          if (coll && listed < 2 && !empty && c.n !== 1) continue;
          evaluated++;
          const more = [...walk(scope)].some((x) => ['button', 'link'].includes(x.role) && CONTINUATION.test(x.name ?? ''));
          const what = coll ? `${listed} ${ITEM_NOUN[coll.role]}` : '';
          if (c.showing) {
            const shown = c.showing[1] - c.showing[0] + 1;
            if (shown === listed || listed === 0) continue;
            found.push({ summary: `${describe(n, text)} says ${shown} are shown, but ${what} are listed.`, data: { claimed: shown, listed }, at: text });
            continue;
          }
          if (c.n === listed || (c.n > listed && more)) continue;
          found.push({
            summary: empty
              ? `${describe(n, text)} counts ${c.n} ${c.noun}, but the section says it is empty.`
              : `${describe(n, text)} counts ${c.n} ${c.noun}, but ${what} are listed${c.n > listed ? ' and no control shows more' : ''}.`,
            data: { claimed: c.n, listed, empty },
            at: text,
          });
        }
      }
      // A single selected filter option carrying its own count ("Audi, 1 car", "Petrol (6)"),
      // against the results listed with it applied.
      if (s.kind === 'interactive') {
        const active: { g: OutlineNode; counted: { c: OutlineNode; n: number }[] }[] = [];
        for (const g of walk(o)) {
          if (!['group', 'radiogroup'].includes(g.role)) continue;
          const counted = g.children
            .filter((c) => ['checkbox', 'radio'].includes(c.role) && checked(c))
            .map((c) => ({ c, m: (c.name ?? '').match(/(?:,\s*|\(\s*)(\d[\d,]*)(?:\s+[a-z]+)?\)?\s*$/i) }))
            .filter((x): x is { c: OutlineNode; m: RegExpMatchArray } => !!x.m)
            .map((x) => ({ c: x.c, n: num(x.m[1]) }));
          if (counted.length) active.push({ g, counted });
        }
        if (active.length === 1) {
          const { g, counted } = active[0];
          const n = counted.reduce((a, x) => a + x.n, 0);
          let best: Collection | null = null;
          for (const sc of walk(o)) {
            if (!['region', 'main'].includes(sc.role)) continue;
            if (ancestors(g).includes(sc) && sc.role !== 'main') continue;
            const coll = collectionIn(sc);
            const inFilters = (x: OutlineNode) => [x, ...ancestors(x)].some((a) => a === g || (a.role === 'complementary' && ancestors(g).includes(a)));
            if (coll && !inFilters(coll.container) && (!best || coll.items.length > best.items.length)) best = coll;
          }
          if (best) {
            evaluated++;
            const results: Collection = best;
            if (results.items.length !== n) {
              const names = counted.map((x) => `"${x.c.name}"`).join(', ');
              found.push({ summary: `With ${names} selected in "${g.name ?? 'a filter group'}", ${results.items.length} ${ITEM_NOUN[results.role]} are listed, but the option counts ${n}.`, data: { claimed: n, listed: results.items.length }, at: counted[0].c.name ?? undefined });
            }
          }
        }
      }
      return { evaluated, found };
    },
    { pass: (n) => `${plural(n, 'count')} on the page match${n === 1 ? 'es' : ''} the items listed.`, fail: (n) => `${plural(n, 'count')} on the page ${n === 1 ? 'does' : 'do'} not match the items listed.` },
  );
}

// ---------- Totals against their line items ----------

// Lines that make a total differ from the sum of the items, so the sum cannot be checked.
const ADJUST = /\b(delivery|shipping|postage|p&p|tax|vat|discount|promo|voucher|coupon|fee|service|tip|refund(ed)?|deposit|credit|gift card|saving|off)\b/i;

export function totalClaims(bundle: Bundle): PerState {
  return perState(
    bundle,
    (o) => {
      const found: Finding[] = [];
      let evaluated = 0;
      for (const n of walk(o)) {
        const label = nodeLabel(n);
        const tm = label.match(/^(?:order |grand |basket |booking )?total(?: due| to pay| price| paid| cost)?\b[:\s]*(.*)$/i);
        if (!tm) continue;
        let totals = amounts(tm[1]);
        if (!totals.length && n.parent) {
          const next = n.parent.children[n.parent.children.indexOf(n) + 1];
          if (next) totals = amounts(nodeLabel(next));
        }
        if (totals.length !== 1) continue;
        const total = totals[0].value;
        const scope = scopeOf(n);
        // Line items: the item nodes before the total in its scope, each counted by its last
        // amount ("2 × £10.00 … £20.00") or quantity × unit price.
        const lines: number[] = [];
        let adjusted = false;
        let subtotal: number | null = null;
        for (const x of walk(scope)) {
          if (x === n) break;
          if (!['listitem', 'row', 'text', 'paragraph', 'term', 'definition', 'cell'].includes(x.role)) continue;
          if (x.role !== 'listitem' && x.role !== 'row' && ancestors(x).some((a) => ['listitem', 'row'].includes(a.role) && !ancestors(n).includes(a))) continue;
          const t = nodeLabel(x);
          const ms = amounts(t);
          if (!ms.length) continue;
          if (/^sub-?total\b/i.test(t)) {
            subtotal = ms[ms.length - 1].value;
            continue;
          }
          if (ADJUST.test(t)) {
            adjusted = true;
            continue;
          }
          if (!['listitem', 'row'].includes(x.role)) continue;
          const q = t.match(/(\d+)\s*[×x]\s*[£$€]/);
          lines.push(ms.length >= 2 ? ms[ms.length - 1].value : q ? num(q[1]) * ms[0].value : ms[0].value);
        }
        if (adjusted || lines.length < 2) continue;
        evaluated++;
        const sum = Math.round(lines.reduce((a, v) => a + v, 0) * 100) / 100;
        const expected = subtotal ?? sum;
        if (Math.abs(expected - total) <= 0.01) continue;
        const symbol = totals[0].raw.match(/[£$€]/)?.[0] ?? '£';
        const where = scope.role === 'root' ? 'On the page' : `In the ${scope.role === 'dialog' ? 'dialog' : scope.role} "${short(scope.name ?? '', 40)}"`;
        found.push({
          summary: `${where}, ${lines.length} line amounts add up to ${fmtMoney(sum, symbol)} (${lines.map((v) => fmtMoney(v, symbol)).join(' + ')}), but "${short(label, 40)}" says ${fmtMoney(total, symbol)}; no delivery, discount, tax or other adjustment is listed.`,
          data: { total, sum, lines },
          at: label,
        });
      }
      return { evaluated, found };
    },
    { pass: (n) => `${plural(n, 'total')} match${n === 1 ? 'es' : ''} its line items.`, fail: (n) => `${plural(n, 'total')} ${n === 1 ? 'does' : 'do'} not add up from its line items.` },
  );
}

// ---------- Sort and rank claims ----------

type Unit = 'money' | 'sold' | 'distance' | 'mileage' | 'year' | 'rating';
const KEYS: { re: RegExp; unit: Unit }[] = [
  { re: /\b(revenue|sales|takings|price|cost|amount|value|total|spend|£|cheapest|most expensive)\b/i, unit: 'money' },
  { re: /\b(units?|sold|quantity|qty|popular|best[- ]selling|bestsellers?)\b/i, unit: 'sold' },
  { re: /\b(nearest|closest|distance)\b/i, unit: 'distance' },
  { re: /\b(mileage)\b/i, unit: 'mileage' },
  { re: /\b(newest|oldest|latest|most recent|year)\b/i, unit: 'year' },
  { re: /\b(rating|rated|stars|score)\b/i, unit: 'rating' },
];
// The value of each kind in an item's words. A price followed by "above", "off" or similar is a
// threshold, not the item's price; a distance needs "away" or "from" ("9,400 miles" is mileage).
const EXTRACT: Record<Unit, (t: string) => number | undefined> = {
  money: (t) => amounts(t).filter((m) => !/^\s*(above|below|under|over|less|more|off|save)\b/i.test(t.slice(m.index + m.raw.length, m.index + m.raw.length + 14)))[0]?.value,
  sold: (t) => {
    const m = t.match(/(\d[\d,]*)\s*(sold|units|orders|sales)\b/i);
    return m ? num(m[1]) : undefined;
  },
  distance: (t) => {
    const m = t.match(/(?<![\d,.])(\d+(?:\.\d+)?)\s*(miles?|mi|km)\s+(away|from)\b/i);
    return m ? num(m[1]) : undefined;
  },
  mileage: (t) => {
    const m = t.match(/(\d[\d,]*)\s*(miles|mi)\b(?!\s*away)/i);
    return m ? num(m[1]) : undefined;
  },
  year: (t) => {
    const m = t.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
    return m ? num(m[1]) : undefined;
  },
  rating: (t) => {
    const m = t.match(/(\d(?:\.\d)?)\s*(?:\/\s*5|stars?|★)/i);
    return m ? num(m[1]) : undefined;
  },
};
const UNIT_WORD: Record<Unit, string> = { money: 'amount', sold: 'number sold', distance: 'distance', mileage: 'mileage', year: 'year', rating: 'rating' };

export function sortClaimIn(text: string): { unit: Unit; dir: 'asc' | 'desc' } | null {
  const t = text.toLowerCase();
  let subject = t.match(/\b(?:ranked|sorted|ordered|sort(?:ed)?|listed)\s+by\s+([a-z ]{2,30})/)?.[1] ?? null;
  if (!subject) {
    const m = t.match(/\b(nearest|closest|newest|oldest|latest|cheapest|lowest|highest|most|least|best[- ]selling|biggest|largest|smallest)\b(?:\s+([a-z ]{0,20}))?(?:\s+first)?/);
    if (!m || !/first|lowest|highest|cheapest|nearest|newest|oldest|most|least|best/.test(t)) return null;
    subject = `${m[1]} ${m[2] ?? ''}`;
  }
  const dir = /\bnewest\b/.test(t) ? 'desc' : /\b(lowest|cheapest|least|nearest|closest|oldest|smallest|low to high|ascending)\b/.test(t) ? 'asc' : 'desc';
  const key = KEYS.find((k) => k.re.test(subject!) || k.re.test(t));
  return key ? { unit: key.unit, dir } : null;
}

export function sortClaims(bundle: Bundle): PerState {
  return perState(
    bundle,
    (o) => {
      const found: Finding[] = [];
      let evaluated = 0;
      for (const n of walk(o)) {
        let claimText: string | null = null;
        let scope: OutlineNode | null = null;
        if (['paragraph', 'text', 'heading', 'status', 'caption'].includes(n.role) && !inItem(n)) {
          claimText = nodeLabel(n);
          scope = n.parent;
        } else if (n.role === 'combobox' && /sort|order/i.test(n.name ?? '')) {
          const sel = n.children.find((c) => c.role === 'option' && c.attrs.selected);
          if (sel?.name) {
            claimText = sel.name;
            scope = scopeOf(n);
          }
        }
        if (!claimText || !scope || claimText.length > 120) continue;
        const claim = sortClaimIn(claimText);
        if (!claim) continue;
        const coll = collectionIn(scope);
        if (!coll || coll.items.length < 3) continue;
        const seq = coll.items.map((it) => ({ it, v: EXTRACT[claim.unit](nodeText(it)) })).filter((x): x is { it: OutlineNode; v: number } => x.v !== undefined);
        if (seq.length < 3) continue;
        evaluated++;
        const bad: [typeof seq[0], typeof seq[0]][] = [];
        for (let i = 1; i < seq.length; i++) if (claim.dir === 'asc' ? seq[i].v < seq[i - 1].v : seq[i].v > seq[i - 1].v) bad.push([seq[i - 1], seq[i]]);
        if (!bad.length) continue;
        const [a, b] = bad[0];
        const name = (x: { it: OutlineNode }) => short(x.it.name ?? nodeText(x.it), 32);
        found.push({
          summary: `"${short(claimText)}" orders the ${coll.items.length} ${ITEM_NOUN[coll.role]} by ${UNIT_WORD[claim.unit]}, ${claim.dir === 'asc' ? 'lowest' : 'highest'} first, but ${bad.length} of ${seq.length - 1} neighbouring pairs are the other way round, for example "${name(a)}" (${a.v}) before "${name(b)}" (${b.v}).`,
          data: { unit: claim.unit, dir: claim.dir, values: seq.map((x) => x.v), inversions: bad.length },
          at: claimText,
        });
      }
      return { evaluated, found };
    },
    { pass: (n) => `${plural(n, 'stated sort order')} match${n === 1 ? 'es' : ''} the order shown.`, fail: (n) => `${plural(n, 'stated sort order')} ${n === 1 ? 'does' : 'do'} not match the order shown.` },
  );
}

// ---------- Period claims ----------

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function datesIn(text: string, year: number): { d: Date; hasTime: boolean; raw: string }[] {
  const re = /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?,?\s*(?:(\d{4})\s*,?\s*)?(?:(\d{1,2}):(\d{2}))?/gi;
  return [...text.matchAll(re)].map((m) => ({
    d: new Date(Date.UTC(m[3] ? num(m[3]) : year, MONTHS[m[2].slice(0, 3).toLowerCase()], num(m[1]), m[4] ? num(m[4]) : 12, m[5] ? num(m[5]) : 0)),
    hasTime: !!m[4],
    raw: m[0].trim(),
  }));
}
const WINDOWS: [RegExp, number | null, string][] = [
  [/\blast hour\b|\bpast hour\b/i, 3600e3, 'hour'],
  [/\blast 24 hours\b/i, 24 * 3600e3, '24h'],
  [/\btoday\b/i, null, 'today'],
  [/\b(last|past) 7 days\b|\blast week\b/i, 7 * 86400e3, '7d'],
  [/\b(last|past) 30 days\b/i, 30 * 86400e3, '30d'],
  [/\bthis month\b/i, null, 'month'],
];
// Period words in a metric label. A bare "N days" is not one ("Try Pro free for 14 days").
const PERIOD_WORDS = /\b(today|yesterday|this (?:week|month|year|quarter)|last (?:hour|\d+ (?:hours|days|weeks|months)|week|month|year|quarter)|past (?:hour|\d+ days)|all[- ]time|year to date|month to date|since launch|lifetime)\b/i;

// The page's clock in its own time zone, as UTC fields.
function pageNow(fixed: string): Date {
  const off = /([+-])(\d\d):?(\d\d)$/.exec(fixed);
  const offMs = off ? (off[1] === '-' ? -1 : 1) * (num(off[2]) * 60 + num(off[3])) * 60e3 : 0;
  return new Date(new Date(fixed).getTime() + offMs);
}

export function periodClaims(bundle: Bundle): PerState {
  const fixedTime = bundle.config?.fixedTime;
  const now = pageNow(fixedTime ?? '');
  return perState(
    bundle,
    (o, s) => {
      const found: Finding[] = [];
      let evaluated = 0;
      if (!fixedTime || s.kind === 'fixture') return { evaluated, found };
      // A section that says its items are from a window, against the dates of those items.
      for (const n of walk(o)) {
        if (!['paragraph', 'text', 'heading', 'caption'].includes(n.role) || ancestors(n).some((a) => ITEM_ROLES.includes(a.role))) continue;
        const t = nodeLabel(n);
        if (t.length > 100) continue;
        const w = WINDOWS.find(([re]) => re.test(t));
        if (!w || !n.parent) continue;
        const coll = collectionIn(n.parent);
        if (!coll || coll.items.length < 2) continue;
        const dates = coll.items.flatMap((it) => datesIn(nodeText(it), now.getUTCFullYear()));
        if (dates.length < 2) continue;
        evaluated++;
        const inWindow = (d: { d: Date; hasTime: boolean }) => {
          if (w[2] === 'today') return d.d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
          if (w[2] === 'month') return d.d.getUTCMonth() === now.getUTCMonth() && d.d.getUTCFullYear() === now.getUTCFullYear();
          const ms = now.getTime() - d.d.getTime();
          return ms >= -60e3 && ms <= w[1]! + (d.hasTime ? 0 : 86400e3);
        };
        const outside = dates.filter((d) => !inWindow(d));
        if (!outside.length) continue;
        found.push({
          summary: `"${short(t)}", but ${outside.length} of the ${dates.length} dates listed fall outside that period at the page's date (${now.toISOString().slice(0, 16).replace('T', ' ')}), for example "${outside[0].raw}".`,
          data: { window: w[2], outside: outside.length, dates: dates.length },
          at: t,
        });
      }
      // Metric labels that name a period other than the one selected.
      const range = [...walk(o)].find((g) => ['radiogroup', 'tablist', 'group'].includes(g.role) && /range|period|time|date/i.test(g.name ?? '') && g.children.some((c) => c.attrs.checked || c.attrs.selected || c.attrs.pressed));
      if (range) {
        const selected = range.children.find((c) => c.attrs.checked || c.attrs.selected || c.attrs.pressed)?.name ?? '';
        const norm = (p: string) => p.toLowerCase().replace(/^past /, 'last ').replace(/^(\d+) days$/, 'last $1 days');
        const sel = norm(selected.match(PERIOD_WORDS)?.[0] ?? selected);
        const labels: string[] = [];
        const full: string[] = [];
        for (const n of walk(o)) {
          if (!['heading', 'term', 'region', 'columnheader', 'caption', 'img'].includes(n.role) || ancestors(n).includes(range)) continue;
          const t = n.name ?? n.text ?? '';
          const m = t.match(PERIOD_WORDS);
          if (!m) continue;
          if (/\b(compared? (with|to)|vs\.?|versus|than)\b/i.test(t.slice(0, m.index))) continue;
          evaluated++;
          const p = norm(m[0]);
          if (p === sel || (sel === 'this month' && p === 'month to date')) continue;
          labels.push(short(t, 40));
          full.push(t);
        }
        const unique = [...new Set(labels)];
        if (unique.length) {
          found.push({
            summary: `"${selected}" is selected in "${range.name}", but ${unique.length === 1 ? 'a label names' : `${unique.length} labels name`} another period: ${unique.slice(0, 4).map((l) => `"${l}"`).join(', ')}.`,
            data: { selected, labels: unique },
            at: full[0],
          });
        }
      }
      return { evaluated, found };
    },
    { pass: (n) => `${plural(n, 'stated period')} match${n === 1 ? 'es' : ''} what is shown.`, fail: (n) => `${plural(n, 'stated period')} ${n === 1 ? 'does' : 'do'} not match what is shown.` },
  );
}

// ---------- The detail opened is the one clicked ----------

const ID_TOKEN = /#\s?\d{2,}|\b[A-Z]{1,4}-\d{2,}\b|\b(?:order|booking|invoice|ticket|ref(?:erence)?|no\.?)\s*#?\s*\d{3,}\b/gi;
const idsIn = (t: string) => (t.match(ID_TOKEN) ?? []).map((x) => x.replace(/\D/g, ''));

export function openedDetail(bundle: Bundle): PerState {
  return perState(
    bundle,
    (o, s) => {
      const found: Finding[] = [];
      let evaluated = 0;
      if (s.kind !== 'interactive') return { evaluated, found };
      const clicks = [...(s.interactiveDescription ?? '').matchAll(/(?:clicking|then) [\w-]+ "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
      const last = clicks[clicks.length - 1];
      const clicked = last ? idsIn(last) : [];
      if (!clicked.length) return { evaluated, found };
      for (const d of walk(o)) {
        if (!['dialog', 'alertdialog'].includes(d.role) && !(d.role === 'complementary' && /detail|order|item/i.test(d.name ?? ''))) continue;
        const head = [d.name ?? '', ...d.children.filter((c) => c.role === 'heading').map((c) => c.name ?? c.text ?? '')].filter(Boolean);
        const shown = idsIn(head.join(' '));
        if (!shown.length) continue;
        evaluated++;
        if (shown.some((x) => clicked.includes(x))) continue;
        found.push({
          summary: `After clicking "${short(last, 50)}", the ${d.role === 'complementary' ? 'panel' : 'dialog'} that opens is headed "${short([...new Set(head)].join(' '), 50)}", a different identifier from the one clicked.`,
          data: { clicked, shown },
          at: head[head.length - 1],
        });
      }
      return { evaluated, found };
    },
    { pass: (n) => `${plural(n, 'opened detail')} name${n === 1 ? 's' : ''} the item clicked.`, fail: (n) => `${plural(n, 'opened detail')} name${n === 1 ? 's' : ''} a different item from the one clicked.` },
  );
}

// ---------- Values a template left unfilled ----------

const TEMPLATE: [RegExp, string][] = [
  [/\{\{[^}]{0,40}\}\}|\$\{[^}]{0,40}\}|<%=?[^%]{0,40}%>|\[\[[^\]]{0,40}\]\]/, 'an unfilled template placeholder'],
  [/(?<![\w.])(undefined|NaN|\[object Object\])(?![\w.])/, 'a programming value shown as text'],
  // "null" and "Infinity" are ordinary words too; only as a value (alone, or beside a number,
  // currency sign, colon or percent sign).
  [/^(null|Infinity)$|[£$€:#%\d]\s?(null|Infinity)\b|\b(null|Infinity)\s?[£$€%\d]/, 'a programming value shown as text'],
  [/(?<![@\w./])[a-z]{2,}(?:[._][a-z]{2,}){2,}(?![@\w/])/, 'a message key shown instead of its text'],
];
const NOT_KEY = /\.(com|co|uk|org|net|io|dev|app|jpg|jpeg|png|svg|webp|gif|html?|js|css|pdf)\b/i;

export function templateText(bundle: Bundle): PerState {
  return perState(
    bundle,
    (o) => {
      const found: Finding[] = [];
      let evaluated = 0;
      for (const n of walk(o)) {
        if (n.role === '/url' || n.role === 'option') continue;
        for (const field of [n.name, n.text]) {
          if (!field) continue;
          evaluated++;
          for (const [re, what] of TEMPLATE) {
            const m = field.match(re);
            if (!m || (what.startsWith('a message key') && NOT_KEY.test(m[0]))) continue;
            found.push({ summary: `The ${n.role === 'text' ? 'text' : n.role} "${short(field)}" shows ${what}: "${m[0].trim()}".`, data: { token: m[0].trim(), kind: what }, at: field });
          }
        }
      }
      return { evaluated, found };
    },
    { pass: () => 'No unfilled template values in the page text.', fail: (n) => `${plural(n, 'unfilled template value')} in the page text.` },
  );
}

// ---------- Validation messages that name neither the field nor the fix ----------

const GENERIC_MESSAGE =
  /^(error!?|errors?:?|invalid\.?|invalid (input|value|selection|entry|data|field|format)\.?|required\.?|field required\.?|this field is required\.?|validation (failed|error)\.?|error: .{0,30}failed\.?|something went wrong\.?|please fix the errors?( below)?\.?|incorrect( value)?\.?|not valid\.?|wrong( value)?\.?|error \d+|oops!?.{0,20})$/i;

export function validationWording(bundle: Bundle): Map<string, ObservationOutput> {
  const out = new Map<string, ObservationOutput>();
  const items = (msgs: string[], all: number, when: string): ObservationOutput => {
    const generic = [...new Set(msgs.filter((t) => GENERIC_MESSAGE.test(t)))].sort();
    const list: DiagnosticItem[] = generic.length
      ? [{ n: 1, summary: `${generic.length} of the ${plural(all, 'message')} that appeared ${when} name neither the field nor the fix: ${generic.slice(0, 5).map((g) => `"${g}"`).join(', ')}.`, elements: [], data: { kind: 'generic', flagged: true, generic, messages: all } }]
      : [];
    return { status: 'observed', evaluated: all, summary: list[0]?.summary ?? `${plural(all, 'message')} appeared ${when}; each names its field or fix.`, items: list };
  };
  // Messages that appeared in an interactive state, against the page at load.
  const base = new Map<string, Set<string>>();
  for (const s of bundle.states.filter((x) => x.kind === 'baseline' && x.status === 'collected')) {
    const o = loadOutline(bundle, s);
    if (o) base.set(s.viewportId, new Set([...walk(o)].map(nodeLabel)));
  }
  for (const s of ownTextStates(bundle).filter((x) => x.kind === 'interactive')) {
    const o = loadOutline(bundle, s);
    const b = base.get(s.viewportId);
    if (!o || !b) continue;
    const msgs: string[] = [];
    for (const n of walk(o)) {
      if (!['text', 'paragraph', 'listitem', 'link', 'alert', 'status', 'heading', 'strong'].includes(n.role)) continue;
      const t = nodeLabel(n);
      if (!t || t.length > 140 || b.has(t)) continue;
      const inAlert = ['alert', 'status'].includes(n.role) || ancestors(n).some((a) => ['alert', 'status'].includes(a.role));
      const nearInvalid = !!n.parent?.children.some((c) => c.attrs.invalid);
      if (inAlert || nearInvalid || GENERIC_MESSAGE.test(t)) msgs.push(t);
    }
    if (!msgs.length) continue;
    const click = (s.interactiveDescription ?? '').split(':')[0].replace(/^After /, 'after ');
    out.set(s.id, items(msgs, new Set(msgs).size, click || 'in this state'));
  }
  // Messages shown when each form was submitted empty.
  const dir = bundleDir(bundle.caseId, bundle.bundleId);
  for (const vp of ['desktop', 'mobile'] as const) {
    const probe = loadFunctionalProbe(dir, vp);
    const covered = [...out.keys()].some((id) => bundle.states.find((s) => s.id === id)?.viewportId === vp);
    if (!probe || probe.error || covered) continue;
    const msgs = probe.forms.flatMap((f) => (f.empty?.newAlerts ?? []).filter((a) => !a.startsWith('invalid:')).map((a) => a.replace(/\s+/g, ' ').trim()));
    if (msgs.length) out.set(vp, items(msgs, new Set(msgs).size, 'when a form was submitted empty'));
  }
  return out;
}
