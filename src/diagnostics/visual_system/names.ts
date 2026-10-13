// Visual System checks read by Visual System v2 and later: Label in Name (WCAG 2.5.3), from the
// probe's snapshot, and Reduced Motion Support (WCAG 2.2.2 and 2.3.3), from the probe's second
// load that asks for reduced motion.

import type { VisualProbeState } from '../../collect/probeTypes.ts';
import type { DiagnosticItem, ElementRecord } from '../../types.ts';
import { truncate, type Doc } from '../doc.ts';
import type { CheckOutput } from '../layout/deterministic.ts';

// More than this share of the words a control shows missing from its accessible name fails.
export const LABEL_IN_NAME_MISSING_SHARE = 0.5;

const ACTION_TAGS = new Set(['button', 'a']);
const ACTION_ROLES = new Set(['button', 'link', 'tab', 'menuitem']);
const FIELD_TAGS = new Set(['input', 'select', 'textarea']);

// Lower-case words; letters and digits run together ("2doors") are split.
export function words(text: string | null | undefined): string[] {
  return (text ?? '')
    .toLowerCase()
    .replace(/(\p{L})(\p{N})|(\p{N})(\p{L})/gu, '$1$3 $2$4')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function descendants(doc: Doc, el: ElementRecord): ElementRecord[] {
  const out: ElementRecord[] = [];
  const stack = [...doc.children(el)];
  while (stack.length) {
    const c = stack.pop()!;
    out.push(c);
    stack.push(...doc.children(c));
  }
  return out;
}

function shownText(doc: Doc, el: ElementRecord, except?: ElementRecord): string {
  const parts = [el.ownText ? el.text : null, ...descendants(doc, el).filter((d) => d.visible && d.ownText && !d.visuallyHidden && d.id !== except?.id).map((d) => d.text)];
  return parts.filter((p): p is string => !!p).join(' ');
}

const noun = (el: ElementRecord) => (FIELD_TAGS.has(el.tag) ? 'field' : el.role === 'tab' ? 'tab' : el.role === 'menuitem' ? 'menu item' : el.tag === 'a' || el.role === 'link' ? 'link' : 'button');

// The words a control shows should be among the words assistive technology announces for it;
// order and extra words in the name are allowed (speech users say what they see).
export function labelInName(doc: Doc): CheckOutput {
  const items: DiagnosticItem[] = [];
  let evaluated = 0;
  for (const e of doc.els) {
    if (!e.interactive || !e.visible || !e.name) continue;
    let shown: string | null = null;
    if (ACTION_TAGS.has(e.tag) || ACTION_ROLES.has(e.role ?? '')) shown = shownText(doc, e);
    else if (FIELD_TAGS.has(e.tag)) {
      const label = doc.els.find((l) => l.tag === 'label' && l.labelFor === e.id && l.visible);
      if (label) shown = shownText(doc, label, e);
    }
    const seen = [...new Set(words(shown))].filter((w) => !/^\d+$/.test(w));
    if (!seen.length || words(shown).join(' ').length < 2) continue;
    evaluated++;
    const named = new Set(words(e.name));
    const missing = seen.filter((w) => !named.has(w));
    if (missing.length / seen.length <= LABEL_IN_NAME_MISSING_SHARE) continue;
    items.push({
      n: items.length + 1,
      summary: `A ${noun(e)} shows "${truncate(shown!.replace(/\s+/g, ' ').trim(), 40)}" but is announced as "${truncate(e.name, 60)}"`,
      elements: [doc.ref(e)],
      data: { shown: shown!.replace(/\s+/g, ' ').trim(), name: e.name, missing },
    });
  }
  return {
    status: items.length ? 'fail' : 'pass',
    evaluated,
    summary: items.length ? `${items.length} of ${evaluated} labelled controls are announced without the words they show.` : `All ${evaluated} labelled controls are announced with the words they show.`,
    items,
    secondary: [],
  };
}

// An animation that loops forever at load and still loops when the page is loaded asking for
// reduced motion. Whether a looping animation is essential (a progress spinner) is the judge's
// call; the check reports every one.
export function reducedMotion(probe: VisualProbeState, doc: Doc): CheckOutput {
  const running = probe.motion!.animations.filter((a) => a.infinite);
  const still = (probe.motion!.reduced ?? []).filter((a) => a.infinite);
  const groups = new Map<string, typeof still>();
  for (const a of still) {
    const k = `${a.name}|${a.selector}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const items: DiagnosticItem[] = [...groups.values()].map((xs, i) => {
    const el = doc.get(xs[0].id);
    const what = el ? (el.name ?? el.text ?? xs[0].selector.split(' > ').pop()) : xs[0].selector.split(' > ').pop();
    return {
      n: i + 1,
      summary: `The ${xs[0].name ? `"${xs[0].name}" ` : ''}animation on ${truncate(what ?? 'an element', 48)}${xs.length > 1 ? ` (×${xs.length})` : ''} keeps looping when reduced motion is requested`,
      elements: el ? [doc.ref(el)] : [],
      data: { animation: xs[0].name, selector: xs[0].selector, count: xs.length, durationMs: xs[0].durationMs },
    };
  });
  return {
    status: items.length ? 'fail' : 'pass',
    evaluated: running.length,
    summary: items.length
      ? `${still.length} of ${running.length} looping animations keep running when reduced motion is requested.`
      : `No looping animation keeps running when reduced motion is requested (${running.length} at a normal load).`,
    items,
    secondary: [],
  };
}
