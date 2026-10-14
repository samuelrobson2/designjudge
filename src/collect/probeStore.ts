// Where probe results live in a bundle, and the effect rules diagnostics share with the probe.
// Kept free of browser imports so diagnostics can load it.

import fs from 'node:fs';
import path from 'node:path';
import type { Bundle, StateRecord } from '../types.ts';
import { readJson } from '../util.ts';
import type { Effect, FunctionalProbe, HoverProbe, VisualProbeState } from './probeTypes.ts';

export const PROBES_DIR = 'probes';
export const VISUAL_PROBE_DIR = path.join(PROBES_DIR, 'visual');
export const FUNCTIONAL_DIR = path.join(PROBES_DIR, 'functional');
export const PROBES_VERSION = 'probes-v1';

// A scroll of at least this many px counts as an effect (a button that scrolls to a section).
const SCROLL_EFFECT_PX = 50;

// The states the Visual System probe covers: the three baselines and the interactive states the judge sees.
export function visualProbeStates(bundle: Bundle): StateRecord[] {
  return bundle.states.filter(
    (s) => s.status === 'collected' && ((s.kind === 'baseline' && ['desktop', 'tablet', 'mobile'].includes(s.id)) || (s.kind === 'interactive' && !s.supporting && s.viewportId !== 'tablet')),
  );
}

export function hasProbes(bundleDir: string): boolean {
  return fs.existsSync(path.join(bundleDir, PROBES_DIR, 'probes.json'));
}

// The Functionality probe runs only when asked for (collect --functional), so evidence can lack it.
export function hasFunctionalProbes(bundleDir: string): boolean {
  return (['desktop', 'mobile'] as const).every((vp) => fs.existsSync(path.join(bundleDir, FUNCTIONAL_DIR, `${vp}.json`)));
}

export function noFunctionalProbes(caseId: string): string {
  return caseId.startsWith('_mutations/')
    ? `This planted-defect evidence was collected without the Functionality probes. Collect it with them: npm run mutate -- <caseId ...> --dir mutations-functionality (or add --functional).`
    : `This evidence for ${caseId} was collected without the Functionality probes. Collect it with them: npm run collect -- ${caseId} --functional, or add them to this evidence: npm run probe -- ${caseId} --functional`;
}

export function probedStateIds(bundleDir: string): string[] {
  const dir = path.join(bundleDir, VISUAL_PROBE_DIR);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
}

export function loadVisualProbe(bundleDir: string, stateId: string): VisualProbeState | null {
  const file = path.join(bundleDir, VISUAL_PROBE_DIR, `${stateId}.json`);
  return fs.existsSync(file) ? readJson<VisualProbeState>(file) : null;
}

export function loadFunctionalProbe(bundleDir: string, viewport: 'desktop' | 'mobile'): FunctionalProbe | null {
  const file = path.join(bundleDir, FUNCTIONAL_DIR, `${viewport}.json`);
  return fs.existsSync(file) ? readJson<FunctionalProbe>(file) : null;
}

export const HOVER_FILE = path.join(PROBES_DIR, 'hover.json');

export function loadHoverProbe(bundleDir: string): HoverProbe | null {
  const file = path.join(bundleDir, HOVER_FILE);
  return fs.existsSync(file) ? readJson<HoverProbe>(file) : null;
}

export function hasEffect(e: Effect, opts: { placeholder?: boolean } = {}): boolean {
  if (opts.placeholder) return e.mutations > 0 || e.requests > 0 || e.dialogs > 0 || e.invalid > 0 || e.calls.some((c) => !c.startsWith('history.'));
  return e.url || e.mutations > 0 || e.requests > 0 || e.dialogs > 0 || e.invalid > 0 || e.calls.length > 0 || Math.abs(e.scrolled) >= SCROLL_EFFECT_PX;
}

// What a user would see as a response to a submission: new or changed text, a validation message
// or an alert, a field marked invalid, or another page. A redraw that changes nothing visible is not one.
export function visibleResponse(e: Effect): boolean {
  return e.url || e.textChanged || e.invalid > 0 || e.newAlerts.length > 0 || e.dialogs > 0;
}

// A submission's effect: a visible response, or something sent or stored.
export function submissionEffect(e: Effect): boolean {
  return visibleResponse(e) || e.requests > 0 || e.calls.some((c) => !c.startsWith('history.replaceState'));
}
