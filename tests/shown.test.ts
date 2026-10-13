import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPacket, CATEGORIES } from '../src/categories/index.ts';
import { FUNCTIONAL_DIR } from '../src/collect/probeStore.ts';
import { bundleDir } from '../src/store.ts';
import { listPromptVersions } from '../src/categories/layout/prompt.ts';
import { MAX_SHOWN_PER_VIEWPORT, shownInteractiveStates } from '../src/collect/shown.ts';
import type { Diagnostics, StateRecord } from '../src/types.ts';
import { state, syntheticBundle } from './bundles.ts';

const click = (n = 1): Partial<StateRecord> => ({
  interactiveStateId: 'auto',
  interactiveDescription: 'After clicking button "Open": a dialog or overlay appeared',
  steps: Array.from({ length: n }, (_, i) => ({ step: { action: 'click', selector: `#c${i}` }, ok: true })),
});

describe('Interactive states the judges see', () => {
  // As collected before every one-click state was shown: the first at desktop and phone shown,
  // the others supporting.
  const bundle = syntheticBundle([
    state('desktop', 'baseline', 'desktop'),
    state('tablet', 'baseline', 'tablet'),
    state('mobile', 'baseline', 'mobile'),
    state('interactive-auto-desktop', 'interactive', 'desktop', click()),
    state('interactive-auto-desktop-2', 'interactive', 'desktop', { ...click(), supporting: true }),
    state('interactive-steps-desktop-1', 'interactive', 'desktop', { ...click(2), supporting: true }),
    state('interactive-choices-desktop', 'interactive', 'desktop', { ...click(5), supporting: true }),
    state('interactive-auto-tablet', 'interactive', 'tablet', { ...click(), supporting: true }),
    state('interactive-auto-mobile', 'interactive', 'mobile', { ...click(), status: 'error', error: 'timeout' }),
    state('interactive-auto-mobile-2', 'interactive', 'mobile', { ...click(), supporting: true }),
  ]);

  it('shows every collected one-click state at desktop and phone, and no tablet, two-step or choices state', () => {
    expect(shownInteractiveStates(bundle).map((s) => s.id)).toEqual(['interactive-auto-desktop', 'interactive-auto-desktop-2', 'interactive-auto-mobile-2']);
  });

  it(`shows at most ${MAX_SHOWN_PER_VIEWPORT} per viewport, in the order discovery ranked them`, () => {
    const many = syntheticBundle([1, 2, 3, 4].map((n) => state(n === 1 ? 'interactive-auto-desktop' : `interactive-auto-desktop-${n}`, 'interactive', 'desktop', click())));
    expect(shownInteractiveStates(many).map((s) => s.id)).toEqual(['interactive-auto-desktop', 'interactive-auto-desktop-2', 'interactive-auto-desktop-3']);
  });

  describe('in every category', () => {
    const probed = { ...bundle, caseId: '_test-shown', bundleId: 'b' };
    const dir = path.join(bundleDir(probed.caseId, probed.bundleId), FUNCTIONAL_DIR);
    beforeAll(() => {
      fs.mkdirSync(dir, { recursive: true });
      for (const vp of ['desktop', 'mobile']) fs.writeFileSync(path.join(dir, `${vp}.json`), JSON.stringify({ version: 1, viewport: vp, controls: [], operability: [], actions: [], fields: [], toggles: [], links: [], forms: [], errors: [], limits: { controls: 0, probed: 0 } }));
    });
    afterAll(() => fs.rmSync(path.dirname(bundleDir(probed.caseId, probed.bundleId)), { recursive: true, force: true }));

    it('sends the same interactive screenshots to every category', () => {
      const bundle = probed;
      const diags: Diagnostics = { schemaVersion: 1, diagnosticsVersion: '', bundleId: 'b', computedAt: '', results: [], transitions: [] };
      const shown = shownInteractiveStates(bundle).map((s) => s.id);
      for (const category of Object.keys(CATEGORIES)) {
        const packet = buildPacket(category, bundle, diags, listPromptVersions(category).at(-1)!);
        const interactive = [...new Set(packet.images.map((i) => i.stateId).filter((id) => id.startsWith('interactive-auto-')))];
        expect(interactive, category).toEqual(shown);
      }
    });
  });
});
