// Evidence for categories that have no automated checks or measurements (Task Fit, Content
// Quality): the request, the captured states, their screenshots and the criteria. Their prompts
// do not mention checks at all. Screenshots are chosen and captioned as in Typography's packet.

import { shownInteractiveStates } from '../../collect/shown.ts';
import type { Bundle, StateRecord } from '../../types.ts';
import type { EvidenceIndexEntry, Packet, PacketImage } from '../types.ts';
import { placeWords, stateLine, stateName, type FindingsState } from '../layout/findings.ts';
import { estimateImageTokens } from '../layout/packet.ts';
import type { ParsedRubric } from '../layout/rubric.ts';

const MAX_ORIGINAL_PATCHES = 30_000;

export interface NoChecksCriterion {
  criterion: string;
  name: string;
}

// One state's words (Content Quality). A block without an ID repeats another block's changes or
// has none, and is not citable.
export interface PageTextBlock {
  id?: string;
  state: string;
  heading: string;
  lines: string[];
  // Lines left out at the length limit.
  more?: number;
}

export interface NoChecksEvidence {
  format: 'no-checks';
  interface_id: string;
  states: FindingsState[];
  screenshots: { id: string; state: string; shows: string }[];
  page_text?: PageTextBlock[];
  criteria: NoChecksCriterion[];
  selection_notes: string[];
}

export interface NoChecksOptions {
  category: string;
  packetVersion: string;
  rubric: ParsedRubric;
  // Baseline viewports sent; the shown interactive states (collect/shown.ts) are always sent.
  baselines: StateRecord['viewportId'][];
  // Also the empty-content fixture at desktop.
  emptyContent?: boolean;
}

// The states the judge sees, in the order "Where" lines use.
export function chooseStates(bundle: Bundle, opts: Pick<NoChecksOptions, 'baselines' | 'emptyContent'>): StateRecord[] {
  const { rank } = placeWords(bundle);
  const shown = shownInteractiveStates(bundle);
  return bundle.states
    .filter(
      (s) =>
        shown.includes(s) ||
        (s.status === 'collected' &&
          ((s.kind === 'baseline' && opts.baselines.includes(s.viewportId)) ||
            (!!opts.emptyContent && s.kind === 'fixture' && s.fixture === 'empty' && s.viewportId === 'desktop'))),
    )
    .sort((a, b) => rank(a.id) - rank(b.id));
}

export function buildNoChecksPacket(bundle: Bundle, opts: NoChecksOptions): Packet {
  const index: Record<string, EvidenceIndexEntry> = {};
  const images: PacketImage[] = [];
  const notes: string[] = [];

  const addShot = (s: StateRecord, kind: 'viewport' | 'full', caption: string) => {
    const shot = s.screenshots.find((x) => x.kind === kind);
    if (!shot) return;
    const detail = kind === 'full' && Math.ceil(shot.width / 32) * Math.ceil(shot.height / 32) <= MAX_ORIGINAL_PATCHES ? 'original' : 'high';
    images.push({ id: shot.id, stateId: s.id, kind, path: shot.path, detail, caption, width: shot.width, height: shot.height, scale: shot.scale, scrollY: shot.scrollY, estimatedTokens: estimateImageTokens(shot.width, shot.height, detail) });
    index[shot.id] = { type: 'screenshot', stateId: s.id };
  };
  const pageShot = (s: StateRecord) => {
    const full = s.screenshots.find((x) => x.kind === 'full');
    const vp = s.screenshots.find((x) => x.kind === 'viewport');
    if (!vp) return;
    const docH = Math.round((full?.docHeight ?? vp.docHeight) || 0);
    const tall = !!full && s.kind !== 'interactive' && docH > s.viewport.height * 1.05;
    const n = full?.hiddenFixedElements ?? 0;
    if (!tall || n) {
      const scrolled = vp.scrollY > 0 ? `, scrolled ${Math.round(vp.scrollY)} px down the page` : '';
      addShot(s, 'viewport', s.kind === 'interactive' ? `${stateName(s)} — the screen after the interaction${scrolled}` : `${stateName(s)} — first screen at load; the page is ${docH} px tall`);
    }
    if (tall) {
      const fixedNote = n ? ` ${n} fixed-position element${n > 1 ? 's are' : ' is'} hidden here; the first-screen screenshot shows ${n > 1 ? 'them' : 'it'} in place.` : '';
      addShot(s, 'full', `${stateName(s)} — full page; the top ${s.viewport.height} px is the first screen.${fixedNote}`);
    }
  };

  const chosen = chooseStates(bundle, opts);
  for (const s of chosen) pageShot(s);

  for (const vp of opts.baselines) {
    const s = bundle.states.find((x) => x.kind === 'baseline' && x.viewportId === vp);
    if (s?.status !== 'collected') notes.push(`The ${vp === 'mobile' ? 'phone' : vp} state was not captured${s?.error ? `: ${s.error}` : ''}.`);
  }
  if (!chosen.some((s) => s.kind === 'interactive')) notes.push('No interactive state was captured.');
  if (opts.emptyContent && !chosen.some((s) => s.kind === 'fixture')) {
    notes.push(bundle.fixtures ? 'The empty-content state was not captured.' : 'No empty-content state was captured, because the interface cannot be loaded with other content.');
  }

  const shotStates = new Set(images.map((i) => i.stateId));
  const evidence: NoChecksEvidence = {
    format: 'no-checks',
    interface_id: bundle.interfaceId,
    states: chosen.filter((s) => shotStates.has(s.id)).map(stateLine),
    screenshots: images.map((i) => ({ id: i.id, state: i.stateId, shows: i.caption })),
    criteria: opts.rubric.criteria.map((c) => ({ criterion: c.id, name: c.name })),
    selection_notes: notes,
  };
  return {
    packetVersion: opts.packetVersion,
    category: opts.category,
    bundleId: bundle.bundleId,
    caseId: bundle.caseId,
    interfaceId: bundle.interfaceId,
    request: bundle.request,
    evidence: evidence as unknown as Record<string, unknown>,
    images,
    index,
    selectionNotes: notes,
    builtAt: new Date().toISOString(),
  };
}
