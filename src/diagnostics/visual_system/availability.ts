// Visual System checks read by Visual System v2 and later. Looks Unavailable but Operable: an
// option or card styled the way its look-alike siblings would be if they could not be used
// (struck through, a dashed border, faded, a not-allowed cursor, a grey fill or muted text) while
// it can still be used. Hover-Only Content: content the page shows when a pointer rests on an
// element, that neither keyboard focus nor a tap shows (WCAG 2.1.1 Keyboard, 1.4.13 Content on
// Hover or Focus).

import type { HoverProbe, Rgba, StyleRecord, VisualProbeState } from '../../collect/probeTypes.ts';
import type { DiagnosticItem, ElementRecord, ElementRef } from '../../types.ts';
import type { Doc } from '../doc.ts';
import type { CheckOutput } from '../layout/deterministic.ts';
import { describe } from './checks.ts';
import { chroma, hex, oklab, oklabDistance } from './color.ts';

// At most this share of the enabled siblings may carry a cue for it to set a member apart.
const CUE_MINORITY = 0.5;
const MIN_PEERS = 3;
const MIN_CUES = 2;
const FADED_OPACITY = 0.6;
// A fill this grey (OKLCh chroma) and this far (OKLab) from the siblings' usual fill.
const GREY_CHROMA = 0.02;
const FILL_APART = 0.02;
// Text this much lighter (OKLab L) than the siblings' usual text colour, and nearly grey.
const MUTED_LIGHTER = 0.12;
const MUTED_CHROMA = 0.04;

type Cue = 'struck through' | 'dashed border' | 'faded' | 'not-allowed cursor' | 'grey fill' | 'muted text';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function list(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

function mode<T>(xs: T[], key: (x: T) => string): T | null {
  const counts = new Map<string, { x: T; n: number }>();
  for (const x of xs) {
    const k = key(x);
    counts.set(k, { x, n: (counts.get(k)?.n ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.x ?? null;
}

// The element can be used: it is an enabled control, or it holds one that is visible.
function operable(doc: Doc, el: ElementRecord): ElementRecord | null {
  if (el.interactive && !el.disabled) return el;
  const stack = [...doc.children(el)];
  while (stack.length) {
    const c = stack.shift()!;
    if (c.interactive && !c.disabled && c.visible) return c;
    stack.push(...doc.children(c));
  }
  return null;
}

export function looksUnavailable(probe: VisualProbeState, doc: Doc): CheckOutput {
  const groups = new Map<string, { s: StyleRecord; el: ElementRecord }[]>();
  for (const s of probe.styles) {
    if (!s.peer) continue;
    const el = doc.get(s.id);
    if (!el || !el.visible || el.rect.w < 4 || el.rect.h < 4) continue;
    groups.set(s.peer, [...(groups.get(s.peer) ?? []), { s, el }]);
  }
  const items: DiagnosticItem[] = [];
  let evaluated = 0;
  for (const members of groups.values()) {
    // Selected and disabled siblings may look different; the rest are compared with each other.
    const enabled = members.filter((m) => !m.el.disabled && !m.s.state);
    if (enabled.length < MIN_PEERS) continue;
    const fill = mode(enabled, (m) => (m.s.bg ? hex(m.s.bg) : 'none'))?.s.bg ?? null;
    const ink = mode(
      enabled.filter((m) => m.s.color),
      (m) => hex(m.s.color!),
    )?.s.color ?? null;
    const raw = (s: StyleRecord): Cue[] => {
      const cues: Cue[] = [];
      if (s.deco?.includes('line-through')) cues.push('struck through');
      if (s.borderStyle === 'dashed' || s.borderStyle === 'dotted') cues.push('dashed border');
      if (s.opacity <= FADED_OPACITY) cues.push('faded');
      if (s.cursor === 'not-allowed') cues.push('not-allowed cursor');
      const bg: Rgba = s.bg ?? [255, 255, 255, 0];
      const usual: Rgba = fill ?? [255, 255, 255, 0];
      if (s.bg && s.bg[3] > 0.5 && chroma(s.bg) < GREY_CHROMA && hex(bg) !== hex(usual) && oklabDistance(bg, usual[3] > 0 ? usual : [255, 255, 255, 1]) >= FILL_APART) cues.push('grey fill');
      if (s.color && ink && chroma(s.color) < MUTED_CHROMA && oklab(s.color)[0] - oklab(ink)[0] >= MUTED_LIGHTER) cues.push('muted text');
      return cues;
    };
    const cuesOf = new Map(enabled.map((m) => [m, raw(m.s)]));
    const common = new Set<Cue>();
    for (const cue of new Set([...cuesOf.values()].flat())) {
      if ([...cuesOf.values()].filter((c) => c.includes(cue)).length > enabled.length * CUE_MINORITY) common.add(cue);
    }
    evaluated += enabled.length;
    const flagged = enabled
      .map((m) => ({ m, cues: cuesOf.get(m)!.filter((c) => !common.has(c)), control: operable(doc, m.el) }))
      .filter((x) => x.cues.length >= MIN_CUES && x.control);
    if (!flagged.length || flagged.length > enabled.length * CUE_MINORITY) continue;
    const cues = [...new Set(flagged.flatMap((f) => f.cues))];
    const first = flagged[0];
    const what = first.control === first.m.el ? describe(first.m.el) : `${describe(first.m.el)} (holding ${describe(first.control!)})`;
    const others = flagged.length > 1 ? ` and ${plural(flagged.length - 1, 'other')} like it` : '';
    const disabledPeers = members.filter((m) => m.el.disabled).length;
    items.push({
      n: items.length + 1,
      summary: `${what.charAt(0).toUpperCase()}${what.slice(1)}${others} ${flagged.length > 1 ? 'are' : 'is'} styled as unavailable (${list(cues)}), unlike ${plural(enabled.length - flagged.length, 'look-alike sibling')}, but ${flagged.length > 1 ? 'they are' : 'it is'} enabled and can be used${disabledPeers ? `; ${plural(disabledPeers, 'sibling')} that really ${disabledPeers === 1 ? 'is' : 'are'} disabled ${disabledPeers === 1 ? 'looks' : 'look'} like this` : ''}`,
      elements: flagged.slice(0, 3).map((f) => doc.ref(f.m.el)),
      data: { cues, flagged: flagged.length, peers: enabled.length, disabledPeers, names: flagged.slice(0, 4).map((f) => (f.m.el.name ?? f.m.el.text ?? '').slice(0, 40)) },
    });
  }
  return {
    status: items.length ? 'fail' : 'pass',
    evaluated,
    summary: items.length
      ? `${plural(items.length, 'group')} of look-alike options or cards ${items.length === 1 ? 'has' : 'have'} enabled members styled as unavailable.`
      : `None of the ${plural(evaluated, 'enabled option')} in groups of look-alike siblings is styled as unavailable.`,
    items,
    secondary: [],
  };
}

export function hoverOnly(hover: HoverProbe, doc: Doc | null): CheckOutput {
  const tried = hover.reveals.filter((r) => !r.repeatsName);
  const ref = (x: { selector: string; name: string | null; rect: ElementRef['rect'] }): ElementRef => {
    const el = doc?.els.find((e) => e.selector === x.selector && e.visible);
    return el ? doc!.ref(el) : { id: 0, selector: x.selector, tag: x.selector.split(' > ').pop()!.split(/[.#:[]/)[0] || 'div', name: x.name, componentId: null, rect: x.rect };
  };
  const items: DiagnosticItem[] = tried
    .filter((r) => !r.focus && r.touch !== 'shown' && r.touch !== 'tap')
    .map((r, i) => {
      const content = r.revealed.controls.length ? `${r.revealed.controls.length === 1 ? 'the control' : 'the controls'} ${list(r.revealed.controls.map((c) => `"${c}"`))}` : `"${r.revealed.text.length > 60 ? `${r.revealed.text.slice(0, 59)}…` : r.revealed.text}"`;
      const host = r.host.name ? `"${r.host.name.length > 40 ? `${r.host.name.slice(0, 39)}…` : r.host.name}"` : r.host.selector.split(' > ').pop();
      const touch = r.touch === null ? 'the phone layout does not have it' : 'a tap on the phone layout does not show it';
      return {
        n: i + 1,
        summary: `Pointing at ${host}${r.members > 1 ? ` (and ${plural(r.members - 1, 'other')} like it)` : ''} shows ${content}, but keyboard focus does not show it and ${touch}`,
        elements: [ref(r.host)],
        data: { revealed: r.revealed.text, controls: r.revealed.controls, members: r.members, focus: r.focus, touch: r.touch },
      };
    });
  return {
    status: items.length ? 'fail' : 'pass',
    evaluated: tried.length,
    summary: items.length
      ? `${items.length} of ${plural(tried.length, 'piece')} of content shown on hover cannot be reached by keyboard focus or a tap.`
      : tried.length
        ? `All ${plural(tried.length, 'piece')} of content shown on hover also show on keyboard focus or a tap.`
        : 'No content is shown only when hovering.',
    items,
    secondary: [],
  };
}
