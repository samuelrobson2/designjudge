// The Visual System judge's evidence: the page screenshots of the probed baselines and of the
// interactive states every judge sees (evidence collected earlier probed only the first), the controls
// sheets (each kind of control in each state), a palette sheet and a colour-vision view, then under
// each criterion what the checks found and the measurements outside or near the rubric reference.
// Same findings shape as Layout's and Typography's packets, so the same renderer writes the prompt.

import fs from 'node:fs';
import path from 'node:path';
import { VISUAL_SYSTEM_RUBRIC_PATH } from '../../config.ts';
import { visualProbeStates } from '../../collect/probeStore.ts';
import { shownInteractiveStates } from '../../collect/shown.ts';
import type { VisualCapture } from '../../collect/visual.ts';
import { bundleDir } from '../../store.ts';
import type { Bundle, DiagnosticItem, Diagnostics, StateRecord } from '../../types.ts';
import { readJson, sha256 } from '../../util.ts';
import { stateLine, stateName, type FindingsCriterion, type ObservationBlock } from '../layout/findings.ts';
import { assignMarks } from '../layout/marks.ts';
import { parseRubric, type ParsedRubric } from '../layout/rubric.ts';
import { EvidenceSet } from '../probe-evidence.ts';
import type { Packet, PacketImage } from '../types.ts';
import { readRubric } from '../versions.ts';
import { buildPalette } from './sheets.ts';

export const VISUAL_SYSTEM_PACKET_VERSION = 'visual-system-packet-v2';

const PROFILE_STATES = ['desktop', 'mobile'];
const MAX_ISSUES = 8;
const MAX_LINES = 10;
const SHEETS_FILE = path.join('visual', 'visual.json');

export function parseVisualSystemRubric(raw = readRubric(VISUAL_SYSTEM_RUBRIC_PATH)): ParsedRubric {
  return parseRubric(raw, 'Visual System', 'visual_system_rubric.md');
}

const kindIs = (...kinds: string[]) => (it: DiagnosticItem) => kinds.includes(String(it.data.kind));

// With the added checks (Visual System v2 and later), Label in Name and Reduced Motion Support are
// checks under C; the second replaces the reduced-motion item of Rendered Style Vocabulary.
export function buildVisualSystemPacket(bundle: Bundle, diags: Diagnostics, opts: { addedChecks?: boolean } = {}): Packet {
  const added = !!opts.addedChecks;
  const rubric = parseVisualSystemRubric(readRubric(VISUAL_SYSTEM_RUBRIC_PATH, added));
  const ev = new EvidenceSet(bundle, diags, rubric);
  const notes: string[] = [];
  const dir = bundleDir(bundle.caseId, bundle.bundleId);
  const probed = visualProbeStates(bundle);
  const shown = [...probed.filter((s) => s.kind === 'baseline'), ...shownInteractiveStates(bundle)];

  // ----- Screenshots -----
  for (const s of shown) ev.pageShot(s);
  const sheetsFile = path.join(dir, SHEETS_FILE);
  const sheets = fs.existsSync(sheetsFile) ? readJson<VisualCapture>(sheetsFile) : null;
  for (const v of sheets?.viewports ?? []) {
    if (!v.sheet) continue;
    const w = Math.round(v.sheet.width / v.sheet.scale);
    const h = Math.round(v.sheet.height / v.sheet.scale);
    const more = v.omittedGroups ? ` ${v.omittedGroups} further kind${v.omittedGroups > 1 ? 's are' : ' is'} not shown.` : '';
    const caption = `Controls in each state, ${v.viewport === 'desktop' ? 'desktop' : 'phone (touch, so there is no hover)'}: one example of each kind of control cut from the page, in its default, hover, keyboard-focus, pressed and selected states, with the computed style changes under each. The sheet's own red outlines mark a state that looks no different from the default.${more}`;
    const id = `S-controls-${v.viewport}`;
    if (v.sheet.scale === 1) ev.addImage({ id, stateId: v.viewport, kind: 'full', path: v.sheet.path, caption, width: w, height: h, scale: 1, scrollY: 0 });
    else
      ev.addImage({
        id,
        stateId: v.viewport,
        kind: 'full',
        path: path.join('visual_system', `${id}-${sha256(v.sheet.path + w).slice(0, 10)}.png`),
        caption,
        width: w,
        height: h,
        scale: 1,
        scrollY: 0,
        composed: { kind: 'scaled', source: v.sheet.path },
      });
  }
  const vocab = ev.find('style_vocabulary', 'desktop');
  if (vocab?.status === 'observed') {
    const flagged = new Set(vocab.items.filter((it) => it.data.kind === 'near_colour').map((it) => String(it.data.colour)));
    const groups = vocab.items
      .filter((it) => it.data.kind === 'colours')
      .map((it) => ({ use: String(it.data.use), colours: (it.data.colours as { colour: string; elements: number }[]).map((c) => ({ ...c, flagged: flagged.has(c.colour) })) }));
    const palette = buildPalette('S-palette-desktop', 'desktop', groups, 'Colours rendered at desktop, by use; under each swatch, how many elements use it.');
    if (palette) {
      const s = probed.find((x) => x.id === 'desktop')!;
      palette.caption = `Palette, ${stateName(s)}: every colour the page renders for text, backgrounds, borders and icons, most used first, with the number of elements using it.${flagged.size ? ' A red ring marks a colour reported below as a near-duplicate of a more common one.' : ''}`;
      ev.addImage(palette);
    }
  }
  const vision = sheets?.viewports.find((v) => v.viewport === 'desktop')?.screenViews.deuteranopia;
  if (vision) {
    ev.addImage({
      id: 'S-vision-desktop',
      stateId: 'desktop',
      kind: 'viewport',
      path: vision.path,
      caption: 'Desktop first screen as seen with red-green colour blindness (deuteranopia), simulated by the browser. Compare it with the first screen in full colour.',
      width: Math.round(vision.width / vision.scale),
      height: Math.round(vision.height / vision.scale),
      scale: 1,
      scrollY: 0,
    });
  }
  if (!sheets) notes.push('The controls sheets and the colour-vision view were not captured for this evidence.');

  // ----- Evidence under each criterion -----
  const push = (list: ObservationBlock[], b: ObservationBlock | null) => b && list.push(b);
  const A: ObservationBlock[] = [];
  const B: ObservationBlock[] = [];
  const C: ObservationBlock[] = [];
  push(A, ev.observationBlock('contrast_profile', ev.observed('contrast_profile', kindIs('below')), MAX_LINES));
  push(A, ev.observationBlock('style_vocabulary', ev.observed('style_vocabulary', kindIs('near_colour')).filter((e) => PROFILE_STATES.includes(e.r.stateId!)), MAX_LINES));
  push(B, ev.observationBlock('style_vocabulary', ev.observed('style_vocabulary', kindIs('near_radius', 'nested_radius', 'shadow_count', 'icon_kinds', 'near_icon_size', 'stroke_widths')), MAX_LINES));
  push(B, ev.observationBlock('peer_consistency', ev.observed('peer_consistency', kindIs('deviation')), MAX_LINES));
  if (!added) push(C, ev.observationBlock('style_vocabulary', ev.observed('style_vocabulary', kindIs('motion_reduced')), MAX_LINES));
  const checks = (ids: string[]) => ids.map((id) => ev.checkBlock(id, MAX_ISSUES)).filter((b): b is NonNullable<typeof b> => b !== null);
  const blocks: Record<string, { checks: ReturnType<typeof checks>; observations: ObservationBlock[] }> = {
    A: { checks: checks(['required_contrast']), observations: A },
    B: { checks: [], observations: B },
    C: { checks: checks(['accessibility_violations', 'focus_visibility', 'target_size', ...(added ? ['label_in_name', 'reduced_motion'] : [])]), observations: C },
  };
  const criteria: FindingsCriterion[] = rubric.criteria.map((c) => ({ criterion: c.id, name: c.name, ...(blocks[c.id] ?? { checks: [], observations: [] }) }));

  // Red outlines for failed checks go on page screenshots only.
  const pages = ev.images.filter((i) => !i.composed && !i.id.startsWith('S-controls') && !i.id.startsWith('S-vision'));
  assignMarks(criteria, pages);
  for (const img of pages) {
    const labels = [...new Set((img.marks ?? []).map((m) => m.label))];
    if (labels.length) img.caption = `${img.caption.replace(/\.?$/, '.')} Red outlines mark where automated checks failed: issue${labels.length > 1 ? 's' : ''} ${labels.join(', ')}.`;
  }

  const missing = probed.filter((s) => ['unavailable', 'error'].includes(ev.find('required_contrast', s.id)?.status ?? 'unavailable'));
  if (missing.length) notes.push(`Visual System measurements are missing for ${missing.map((s) => stateName(s)).join(', ')}: ${ev.find('required_contrast', missing[0].id)?.reason ?? 'not collected'}`);
  notes.push(
    'Colours are sRGB hex values after any transparency is composited over what is behind. Contrast ratios are WCAG 2; Lc values are APCA lightness contrast, where higher is more distinct (about 106 for black on white).',
    'Screenshots and sheets are at 1 image pixel per CSS pixel; phones draw at two or three times this sharpness.',
  );

  const shotStates = new Set(ev.images.map((i) => i.stateId));
  const states = bundle.states.filter((s: StateRecord) => s.status === 'collected' && shown.includes(s) && shotStates.has(s.id)).map(stateLine);
  const evidence = {
    format: 'findings',
    interface_id: bundle.interfaceId,
    states,
    screenshots: ev.images.map((i: PacketImage) => ({ id: i.id, state: i.stateId, shows: i.caption })),
    criteria,
    selection_notes: notes,
  };
  return {
    packetVersion: VISUAL_SYSTEM_PACKET_VERSION + (added ? '+added-checks' : ''),
    category: 'visual_system',
    bundleId: bundle.bundleId,
    caseId: bundle.caseId,
    interfaceId: bundle.interfaceId,
    request: bundle.request,
    evidence,
    images: ev.images,
    index: ev.index,
    selectionNotes: notes,
    builtAt: new Date().toISOString(),
  };
}
