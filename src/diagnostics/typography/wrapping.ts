// Squeezed Text Wrapping (read by Typography v2 and later): text pressed into a column so narrow
// that it breaks into many very short lines, as values squeezed into a narrow table column or a
// sidebar that has not been given room.

import type { DiagnosticItem } from '../../types.ts';
import { truncate, type Doc } from '../doc.ts';
import type { ObservationOutput } from '../layout/observations.ts';
import { roleKey, roleLabel, textElements } from './text.ts';

export const WRAPPING_REFERENCE = {
  minLines: 3,
  // At most this many characters per line on average...
  maxCharsPerLine: 14,
  // ...in a column narrower than this many times the font size (about 24 characters).
  narrowerThanEm: 12,
};

const MAX_ITEMS = 5;

export function squeezedWrapping(doc: Doc): ObservationOutput {
  const R = WRAPPING_REFERENCE;
  const texts = textElements(doc).items.filter((x) => !x.role.inline && !x.t.field && x.t.lineCount > 0);
  const squeezed = texts
    .filter((x) => x.t.lineCount >= R.minLines && x.t.chars / x.t.lineCount <= R.maxCharsPerLine && x.t.avail < R.narrowerThanEm * x.t.size)
    .sort((a, b) => b.t.lineCount - a.t.lineCount);
  const items: DiagnosticItem[] = squeezed.slice(0, MAX_ITEMS).map((x, i) => {
    const perLine = Math.round(x.t.chars / x.t.lineCount);
    const text = x.el.text ? `"${truncate(x.el.text.replace(/\s+/g, ' '), 40)}"` : 'Text';
    return {
      n: i + 1,
      summary: `${text} (${roleLabel(roleKey(x.role))}) wraps to ${x.t.lineCount} lines of about ${perLine} characters each in a ${Math.round(x.t.avail)} px wide column`,
      elements: [doc.ref(x.el)],
      data: { kind: 'squeezed', role: roleKey(x.role), lines: x.t.lineCount, charsPerLine: perLine, availPx: Math.round(x.t.avail), sizePx: x.t.size },
    };
  });
  if (squeezed.length > MAX_ITEMS) {
    items.push({ n: items.length + 1, summary: `${squeezed.length - MAX_ITEMS} more text elements wrap the same way`, elements: squeezed.slice(MAX_ITEMS, MAX_ITEMS + 3).map((x) => doc.ref(x.el)), data: { kind: 'squeezed', more: squeezed.length - MAX_ITEMS } });
  }
  return {
    status: 'observed',
    evaluated: texts.length,
    summary: `${squeezed.length} of ${texts.length} text elements wrap into ${R.minLines}+ lines of ${R.maxCharsPerLine} characters or fewer in a narrow column.`,
    items,
  };
}
