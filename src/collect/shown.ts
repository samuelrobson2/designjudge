// Which interactive states the judges see as screenshots. Kept free of browser imports so
// packets and diagnostics can load it.

import type { Bundle, StateRecord } from '../types.ts';

// States one click from the page at load shown per viewport, at desktop and phone.
export const MAX_SHOWN_PER_VIEWPORT = 3;

const oneClick = (s: StateRecord) => s.interactiveStateId === 'auto' && s.steps?.length === 1;

// The states one click from the page at load at desktop and phone, in the order discovery ranked
// them, at most MAX_SHOWN_PER_VIEWPORT per viewport. Evidence collected when only the first was
// shown marks the others as supporting; they are shown too. Tablet states, and states reached by
// two clicks or by applying several choices, are checked but not shown.
export function shownInteractiveStates(bundle: Bundle): StateRecord[] {
  const shown = (['desktop', 'mobile'] as const).flatMap((vp) =>
    bundle.states
      .filter((s) => s.kind === 'interactive' && s.status === 'collected' && s.viewportId === vp && (!s.supporting || oneClick(s)))
      .slice(0, MAX_SHOWN_PER_VIEWPORT),
  );
  return bundle.states.filter((s) => shown.includes(s));
}
