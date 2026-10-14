// Shared by the Visual System and Functionality packets: the page screenshots chosen as
// Typography's packet chooses them, and findings lines merged across states with their IDs,
// element boxes and the screenshots that show them, in the shape Layout's renderer writes.

import type { Bundle, DiagnosticItem, DiagnosticResult, Diagnostics, StateRecord } from '../types.ts';
import { DIAG_NAMES } from '../diagnostics/run.ts';
import type { EvidenceIndexEntry, PacketImage } from './types.ts';
import { placeWords, stateName, type CheckBlock, type FindingLine, type ObservationBlock } from './layout/findings.ts';
import { estimateImageTokens } from './layout/packet.ts';
import type { ParsedRubric } from './layout/rubric.ts';

const MAX_ORIGINAL_PATCHES = 30_000;

export function detailFor(kind: PacketImage['kind'], width: number, height: number): 'high' | 'original' {
  return kind === 'full' && Math.ceil(width / 32) * Math.ceil(height / 32) <= MAX_ORIGINAL_PATCHES ? 'original' : 'high';
}

export class EvidenceSet {
  readonly images: PacketImage[] = [];
  readonly index: Record<string, EvidenceIndexEntry> = {};
  readonly results: DiagnosticResult[];
  private readonly where: (ids: (string | null)[]) => string;

  constructor(
    private bundle: Bundle,
    diags: Diagnostics,
    private rubric: ParsedRubric,
  ) {
    const collected = new Set(bundle.states.filter((s) => s.status === 'collected').map((s) => s.id));
    this.results = diags.results.filter((r) => r.stateId === null || collected.has(r.stateId));
    this.where = placeWords(bundle).where;
  }

  addImage(img: Omit<PacketImage, 'detail' | 'estimatedTokens'> & { detail?: PacketImage['detail'] }): void {
    const detail = img.detail ?? detailFor(img.kind, img.width, img.height);
    this.images.push({ ...img, detail, estimatedTokens: estimateImageTokens(img.width, img.height, detail) });
    this.index[img.id] = { type: 'screenshot', stateId: img.stateId };
  }

  private addShot(s: StateRecord, kind: 'viewport' | 'full', caption: string) {
    const shot = s.screenshots.find((x) => x.kind === kind);
    if (!shot) return;
    this.addImage({ id: shot.id, stateId: s.id, kind, path: shot.path, caption, width: shot.width, height: shot.height, scale: shot.scale, scrollY: shot.scrollY });
  }

  // The same screenshots and captions as Layout's essential set and Typography's packet.
  pageShot(s: StateRecord): void {
    const full = s.screenshots.find((x) => x.kind === 'full');
    const vp = s.screenshots.find((x) => x.kind === 'viewport');
    if (!vp) return;
    const docH = Math.round((full?.docHeight ?? vp.docHeight) || 0);
    const tall = !!full && s.kind !== 'interactive' && docH > s.viewport.height * 1.05;
    const n = full?.hiddenFixedElements ?? 0;
    if (!tall || n) {
      const scrolled = vp.scrollY > 0 ? `, scrolled ${Math.round(vp.scrollY)} px down the page` : '';
      this.addShot(s, 'viewport', s.kind === 'interactive' ? `${stateName(s)} — the screen after the interaction${scrolled}` : `${stateName(s)} — first screen at load; the page is ${docH} px tall`);
    }
    if (tall) {
      const fixedNote = n ? ` ${n} fixed-position element${n > 1 ? 's are' : ' is'} hidden here; the first-screen screenshot shows ${n > 1 ? 'them' : 'it'} in place.` : '';
      this.addShot(s, 'full', `${stateName(s)} — full page; the top ${s.viewport.height} px is the first screen.${fixedNote}`);
    }
  }

  find(diagId: string, stateId: string | null): DiagnosticResult | undefined {
    return this.results.find((r) => r.diagId === diagId && r.stateId === stateId);
  }

  private resultId(r: DiagnosticResult): string {
    return `${r.kind === 'deterministic' ? 'C' : 'O'}-${r.diagId}${r.stateId ? `-${r.stateId}` : ''}`;
  }

  private itemId(r: DiagnosticResult, it: DiagnosticItem): string {
    return r.kind === 'deterministic' ? `F-${r.diagId}${r.stateId ? `-${r.stateId}` : ''}-${it.n}` : `${this.resultId(r)}-${it.n}`;
  }

  private registerItem(r: DiagnosticResult, it: DiagnosticItem): string {
    this.index[this.resultId(r)] = { type: r.kind === 'deterministic' ? 'check' : 'observation', stateId: r.stateId, resultKey: r.key, status: r.status };
    const id = this.itemId(r, it);
    this.index[id] = { type: r.kind === 'deterministic' ? 'check_item' : 'observation_item', stateId: r.stateId, resultKey: r.key, itemN: it.n };
    return id;
  }

  // Lines with the same text in several states are one line listing those states.
  lines(entries: { r: DiagnosticResult; it: DiagnosticItem }[], max: number): { lines: FindingLine[]; more: number } {
    const groups = new Map<string, { r: DiagnosticResult; it: DiagnosticItem }[]>();
    for (const e of entries) groups.set(e.it.summary, [...(groups.get(e.it.summary) ?? []), e]);
    const all = [...groups.values()];
    const lines = all.slice(0, max).map((g) => {
      const boxes = g.flatMap((e) =>
        e.r.stateId
          ? e.it.elements
              .slice(0, 2)
              .filter((el) => el.rect?.w > 0 && el.rect?.h > 0)
              .map((el) => ({ stateId: e.r.stateId!, rect: el.rect, ...(el.fixed ? { fixed: true } : {}) }))
          : [],
      );
      const stateIds = new Set(g.map((e) => e.r.stateId).filter((id): id is string => id !== null));
      const wholeState = g.some((e) => !e.it.elements.length);
      const shots = wholeState ? this.images.filter((img) => stateIds.has(img.stateId) && !img.composed).map((img) => img.id) : [];
      return {
        ids: g.map((e) => this.registerItem(e.r, e.it)),
        text: sentence(e0(g).it.summary),
        where: this.where(g.map((e) => e.r.stateId)),
        ...(boxes.length ? { boxes } : {}),
        ...(shots.length ? { shots } : {}),
        located: g.some((e) => e.r.stateId !== null),
      };
    });
    return { lines, more: all.length - lines.length };
  }

  failing(diagId: string, keep: (it: DiagnosticItem) => boolean = () => true) {
    return this.results.filter((r) => r.diagId === diagId && r.status === 'fail').flatMap((r) => r.items.filter(keep).map((it) => ({ r, it })));
  }

  observed(diagId: string, keep: (it: DiagnosticItem) => boolean) {
    return this.results.filter((r) => r.diagId === diagId && r.status === 'observed').flatMap((r) => r.items.filter(keep).map((it) => ({ r, it })));
  }

  checkBlock(diagId: string, max: number, keep?: (it: DiagnosticItem) => boolean): CheckBlock | null {
    const entries = this.failing(diagId, keep);
    if (!entries.length) return null;
    const { lines, more } = this.lines(entries, max);
    const notCounted = new Map<string, { label: string; examples: string[]; count: number; states: (string | null)[] }>();
    for (const r of this.results.filter((x) => x.diagId === diagId && (x.status === 'fail' || x.status === 'pass'))) {
      for (const sec of r.secondary) {
        if (!sec.items.length) continue;
        const e = notCounted.get(sec.kind) ?? { label: sec.label, examples: [], count: 0, states: [] };
        e.count = Math.max(e.count, sec.items.length);
        e.states.push(r.stateId);
        for (const it of sec.items) if (e.examples.length < 2 && !e.examples.includes(it.summary)) e.examples.push(it.summary);
        notCounted.set(sec.kind, e);
      }
    }
    return {
      check: DIAG_NAMES[diagId],
      detects: this.rubric.diagnostics.find((d) => d.diagId === diagId)?.measures ?? '',
      issues: lines,
      ...(more ? { more_issues: more } : {}),
      not_counted: [...notCounted.values()].map((e) => `${capital(e.label)}: ${e.count} item${e.count > 1 ? 's' : ''}, for example ${e.examples.join('; ')} (${this.where(e.states)}).`),
    };
  }

  observationBlock(diagId: string, entries: { r: DiagnosticResult; it: DiagnosticItem }[], max: number): ObservationBlock | null {
    if (!entries.length) return null;
    const def = this.rubric.diagnostics.find((d) => d.diagId === diagId);
    return { observation: DIAG_NAMES[diagId], measures: def?.measures ?? '', reference: def?.reference ?? '', lines: this.lines(entries, max).lines };
  }
}

const e0 = <T>(g: T[]) => g[0];

export function sentence(s: string): string {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
