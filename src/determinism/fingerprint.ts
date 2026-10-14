// What two collections of the same interface must agree on: the states discovery picked and the
// judges see, every check result, the text and images of every category's judge request, and
// the probe outcomes behind them. Images may differ by a few anti-aliased pixels.

import fs from 'node:fs';
import { buildPacket, buildRequest, CATEGORIES, ensurePacketImages, packetUnavailable } from '../categories/index.ts';
import { listPromptVersions } from '../categories/layout/prompt.ts';
import { hasEffect, loadFunctionalProbe, loadHoverProbe, loadVisualProbe, probedStateIds } from '../collect/probeStore.ts';
import { shownInteractiveStates } from '../collect/shown.ts';
import { changedPixels } from '../collect/visual.ts';
import { runDiagnostics } from '../diagnostics/run.ts';
import { bundleDir } from '../store.ts';
import type { Bundle } from '../types.ts';

// Changed pixels (per-channel difference above 8) an image may have and still count as the same.
export const IMAGE_TOLERANCE_PX = 16;

export interface PacketImageFp {
  id: string;
  caption: string;
  sha256: string;
  path: string;
}

export interface Fingerprint {
  label: string;
  bundleId: string;
  collectMs?: number;
  sections: Record<string, string[]>;
  packets: Record<string, { lines: string[]; images: PacketImageFp[] }>;
  settle: { states: number; unsettled: number; wallMs: number[]; pageMs: number[] };
}

export interface FingerprintOptions {
  label?: string;
  // Draw packet images that are not on disk yet (off for bundles that must not gain files).
  drawImages?: boolean;
  // Run-specific text to replace, such as the address of a server on a random port.
  replace?: [string, string][];
}

export async function fingerprint(bundle: Bundle, opts: FingerprintOptions = {}): Promise<Fingerprint> {
  const dir = bundleDir(bundle.caseId, bundle.bundleId);
  const swaps: [string, string][] = [[bundle.bundleId, '<bundle>'], [bundle.caseId, '<case>'], [bundle.interfaceId, '<interface>'], ...(opts.replace ?? [])];
  // Local servers listen on a random port.
  const norm = (s: string) => swaps.reduce((t, [a, b]) => t.replaceAll(a, b), s).replace(/http:\/\/(127\.0\.0\.1|localhost):\d+/g, '<origin>');
  const diags = runDiagnostics(bundle);
  const sections: Record<string, string[]> = {};

  type Pick = { label: string; description: string };
  type Log = {
    viewport: string;
    chosen?: Pick | null;
    alsoKept?: Pick[];
    combinations?: { kept?: { kind: string; steps: string[]; description: string }[] };
    attempts: { label?: string; role: string; outcome: string }[];
    error?: string;
  };
  for (const l of (bundle.interactiveDiscovery as Log[] | undefined) ?? []) {
    sections[`discovery ${l.viewport} picks`] = [l.chosen, ...(l.alsoKept ?? [])].filter((p) => !!p).map((p) => `${p!.label} [${p!.description}]`);
    sections[`discovery ${l.viewport} combinations`] = (l.combinations?.kept ?? []).map((c) => `${c.kind}: ${c.steps.join(' > ')} [${c.description}]`);
    sections[`discovery ${l.viewport} attempts`] = l.attempts.map((a) => `${a.label || a.role}: ${a.outcome}`);
    if (l.error) sections[`discovery ${l.viewport} attempts`].push(`error: ${l.error}`);
  }
  sections['shown states'] = shownInteractiveStates(bundle).map((s) => `${s.id} ${JSON.stringify(s.steps?.map((x) => x.step))}`);
  sections['states'] = bundle.states.map(
    (s) => `${s.id} ${s.status}${s.error ? ` (${norm(s.error)})` : ''}${(s.steps ?? []).map((st) => ` [${st.ok ? st.via : `failed: ${st.error}`}]`).join('')}`,
  );
  sections['coverage'] = bundle.coverage.map((c) => `${c.stateId} ${c.status}${c.reason ? ` (${norm(c.reason)})` : ''}`);
  sections['checks'] = diags.results.map((r) => `${r.diagId}:${r.stateId ?? 'all'} ${r.status} — ${norm(r.summary)}${r.items.map((i) => `\n    ${norm(i.summary)}`).join('')}`);

  for (const vp of ['desktop', 'mobile'] as const) {
    const p = loadFunctionalProbe(dir, vp);
    if (!p) continue;
    const name = new Map(p.controls.map((c) => [c.key, `${c.from}/${c.name ?? c.selector}`]));
    sections[`functionality probe ${vp}`] = [
      ...p.operability.map((o) => `operable ${name.get(o.key)}${o.member ? ` (${o.member.name ?? o.member.selector})` : ''}: ${o.ok ? 'yes' : `no, ${o.reason}`}`),
      ...p.actions.map((a) => `action ${name.get(a.key)}: ${a.effect ? (hasEffect(a.effect) ? 'effect' : 'no effect') : `error ${a.error}`}`),
      ...p.fields.map((f) => `field ${name.get(f.key)}: "${f.attempted}" → ${JSON.stringify(f.result)} ${f.ok ? 'ok' : `(${f.note})`}`),
      ...p.toggles.map((t) => `toggle ${name.get(t.key)}: ${t.before} → ${t.after}, ${t.ok ? 'ok' : `(${t.note ?? t.error})`}, rendered change ${t.renderedChange}`),
      ...p.links.map((l) => `link ${name.get(l.key)}: ${l.ok ? 'ok' : 'fails'}, ${l.detail}${l.error ? ` (${l.error})` : ''}`),
      ...p.forms.map((f) => `form ${f.name}: empty → ${f.emptyOutcome}; filled → ${f.outcome}${f.lost.length ? `; lost ${f.lost.join(', ')}` : ''}`),
      ...p.toggles.filter((t) => t.choice).map((t) => `choice ${name.get(t.key)} in "${t.choice!.name}" (${t.choice!.role}, ${t.choice!.size}${t.choice!.filter ? ', filter' : ''}${t.choice!.form ? ', form' : ''}${t.choice!.apply ? `, applied by "${t.choice!.apply}"` : ''}): ${t.outside === undefined ? 'not tried' : t.outside ? 'changes the page' : 'changes only itself'}`),
      ...(p.dialogs ?? []).map(
        (d) =>
          `dialog from ${name.get(d.key)} ${d.selector} (${d.kind}${d.modal ? ', modal' : ''}): escape ${d.escape}, close ${d.close ? `"${d.close.name}" ${d.close.closed}` : 'none'}${d.openerCloses !== undefined ? `, opener closes ${d.openerCloses}` : ''}${d.modal ? `, tab ${d.tabEscape ? `leaves to ${d.tabEscape.selector} after ${d.tabEscape.after}` : 'stays'}, background scrolls ${d.backgroundScrolls}${d.movesWithPage !== undefined ? `, moves with page ${d.movesWithPage}` : ''}` : ''}${d.error ? ` (${d.error})` : ''}`,
      ),
      ...(p.flows ?? []).map((f) => `flow ${name.get(f.key)}: ${f.selected} selected → "${f.control.name}" (${f.before} before): ${f.effect ? (hasEffect(f.effect) ? 'effect' : 'no effect') : `error ${f.error}`}`),
      ...(p.persistence ?? []).map((r) => `saved ${name.get(r.key)}: ${r.claim ? `${r.claim} "${r.claimText}", after reload ${JSON.stringify(r.reloaded)} (${r.persisted === null ? 'not checkable' : r.persisted ? 'kept' : 'lost'})` : r.error ? `error ${r.error}` : 'no claim'}`),
      ...p.errors.map((e) => `error while ${e.during}: ${e.message}`),
    ];
  }
  for (const id of probedStateIds(dir)) {
    const v = loadVisualProbe(dir, id);
    if (!v) continue;
    const sel = new Map((v.snapshot?.elements ?? []).map((e) => [e.id, e.selector]));
    sections[`visual probe ${id}`] = [
      ...(v.focus?.stops ?? []).map((s) => `focus ${s.n} ${s.selector}: ${s.visible ? 'visible' : 'not visible'} ${s.changes.join('; ')}`),
      ...(v.motion ? [`motion: ${v.motion.animations.filter((a) => a.infinite).length} running, ${(v.motion.reduced ?? []).filter((a) => a.infinite).length} under reduced motion`] : []),
      ...v.styles.filter((s) => s.deco?.includes('line-through') || s.borderStyle || s.cursor).map((s) => `cue ${sel.get(s.id) ?? s.id}: ${[s.deco, s.borderStyle, s.cursor, s.state ? 'selected' : ''].filter(Boolean).join(', ')}`),
      ...(v.replayed && !v.replayed.ok ? [`replay failed: ${v.replayed.error}`] : []),
      ...(v.error ? [`error: ${v.error}`] : []),
    ];
  }
  const hover = loadHoverProbe(dir);
  if (hover) {
    sections['hover probe'] = [
      `tried ${hover.tried} of ${hover.found}`,
      ...hover.reveals.map((r) => `hover ${r.host.selector} shows ${r.revealed.selector} "${r.revealed.text}": focus ${r.focus}, touch ${r.touch}${r.repeatsName ? ', repeats its name' : ''}`),
      ...(hover.error ? [`error: ${hover.error}`] : []),
    ];
  }

  const packets: Fingerprint['packets'] = {};
  for (const category of Object.keys(CATEGORIES)) {
    if (packetUnavailable(category, bundle)) continue;
    const latest = listPromptVersions(category).at(-1)!;
    const gated = listPromptVersions(category, { all: true }).at(-1)!;
    for (const version of new Set([latest, gated])) {
      const packet = buildPacket(category, bundle, diags, version);
      if (opts.drawImages) await ensurePacketImages(packet, dir);
      const req = buildRequest(packet, dir, version);
      packets[version === latest ? category : `${category} ${version}`] = {
        lines: norm(req.userText).split('\n'),
        images: req.images.map((i) => ({ id: i.id, caption: norm(i.caption), sha256: i.sha256, path: i.path })),
      };
    }
  }
  const settles = bundle.states.filter((s) => s.settle).map((s) => s.settle!);
  return {
    label: opts.label ?? bundle.caseId,
    bundleId: bundle.bundleId,
    sections,
    packets,
    settle: { states: settles.length, unsettled: settles.filter((s) => !s.settled).length, wallMs: settles.map((s) => s.elapsedMs), pageMs: settles.map((s) => s.pageMs ?? 0) },
  };
}

export interface Difference {
  section: string;
  onlyA: string[];
  onlyB: string[];
}

export interface FingerprintDiff {
  a: string;
  b: string;
  differences: Difference[];
  // Packet images that differ within the tolerance: [id, changed pixels].
  imagesWithinTolerance: [string, number][];
}

function listDiff(section: string, x: string[], y: string[]): Difference | null {
  const count = (l: string[]) => l.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>());
  const cx = count(x);
  const cy = count(y);
  const onlyA = x.filter((v) => (cy.get(v) ?? 0) < (cx.get(v) ?? 0));
  const onlyB = y.filter((v) => (cx.get(v) ?? 0) < (cy.get(v) ?? 0));
  const reordered = !onlyA.length && !onlyB.length && x.join('\n') !== y.join('\n');
  if (!onlyA.length && !onlyB.length && !reordered) return null;
  return { section, onlyA: reordered ? ['(same lines in another order)'] : [...new Set(onlyA)], onlyB: [...new Set(onlyB)] };
}

async function sameImage(a: PacketImageFp, b: PacketImageFp): Promise<number | null> {
  if (a.sha256 === b.sha256) return 0;
  if (!fs.existsSync(a.path) || !fs.existsSync(b.path)) return null;
  return changedPixels(fs.readFileSync(a.path), fs.readFileSync(b.path));
}

export async function diffFingerprints(A: Fingerprint, B: Fingerprint): Promise<FingerprintDiff> {
  const differences: Difference[] = [];
  const imagesWithinTolerance: [string, number][] = [];
  for (const key of new Set([...Object.keys(A.sections), ...Object.keys(B.sections)])) {
    const d = listDiff(key, A.sections[key] ?? [], B.sections[key] ?? []);
    if (d) differences.push(d);
  }
  for (const cat of new Set([...Object.keys(A.packets), ...Object.keys(B.packets)])) {
    const x = A.packets[cat];
    const y = B.packets[cat];
    if (!x || !y) {
      differences.push({ section: `${cat} packet`, onlyA: x ? ['built'] : [], onlyB: y ? ['built'] : [] });
      continue;
    }
    const lines = listDiff(`${cat} packet text`, x.lines, y.lines);
    if (lines) differences.push(lines);
    const onlyA: string[] = [];
    const onlyB: string[] = [];
    const byId = new Map(y.images.map((i) => [i.id, i]));
    for (const i of x.images) {
      const j = byId.get(i.id);
      byId.delete(i.id);
      if (!j) {
        onlyA.push(`${i.id} ${i.caption}`);
        continue;
      }
      if (i.caption !== j.caption) {
        onlyA.push(`${i.id} ${i.caption}`);
        onlyB.push(`${j.id} ${j.caption}`);
        continue;
      }
      const px = await sameImage(i, j);
      if (px === 0) continue;
      if (px !== null && px <= IMAGE_TOLERANCE_PX) imagesWithinTolerance.push([`${cat} ${i.id}`, px]);
      else {
        onlyA.push(`${i.id} pixels differ (${px === null ? 'different size' : `${px} px`})`);
        onlyB.push(`${j.id} pixels differ`);
      }
    }
    for (const j of byId.values()) onlyB.push(`${j.id} ${j.caption}`);
    if (onlyA.length || onlyB.length) differences.push({ section: `${cat} packet images`, onlyA, onlyB });
  }
  return { a: A.label, b: B.label, differences, imagesWithinTolerance };
}

export function describeDiff(d: FingerprintDiff, max = 6): string {
  const out = [`${d.a} vs ${d.b}: ${d.differences.length ? `${d.differences.length} sections differ` : 'identical'}${d.imagesWithinTolerance.length ? ` (${d.imagesWithinTolerance.length} images within ${IMAGE_TOLERANCE_PX} px)` : ''}`];
  for (const x of d.differences) {
    out.push(`  ${x.section}: ${x.onlyA.length} only in ${d.a}, ${x.onlyB.length} only in ${d.b}`);
    for (const v of x.onlyA.slice(0, max)) out.push(`    - ${v.replace(/\n/g, '\n      ').slice(0, 400)}`);
    for (const v of x.onlyB.slice(0, max)) out.push(`    + ${v.replace(/\n/g, '\n      ').slice(0, 400)}`);
  }
  return out.join('\n');
}
