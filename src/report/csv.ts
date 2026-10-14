// The two main CSVs. summary.csv has one row per judgment (or per interface when no judge has
// run): check counts, then the judge's result and reasoning, then the screenshots it saw.
// checks.csv has one row per check or observation result per captured state, keyed by case_id
// and bundle_id so each summary row drills down into its checks.

import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACTS_DIR } from '../config.ts';
import { categoryOf, loadOrBuildPacket } from '../categories/index.ts';
import { DIAGNOSTIC_HOME } from '../categories/layout/homes.ts';
import { LAYOUT_PACKET_VERSION_FINDINGS } from '../categories/layout/packet.ts';
import type { Packet } from '../categories/types.ts';
import { DIAG_NAMES, FUNCTIONALITY_DIAGNOSTICS, VISUAL_SYSTEM_DIAGNOSTICS } from '../diagnostics/run.ts';
import type { JudgmentRecord } from '../judge/record.ts';
import { loadBundle, loadDiagnostics } from '../store.ts';
import type { Bundle, DiagnosticResult, Diagnostics } from '../types.ts';
import { ensureDir } from '../util.ts';

type Cell = string | number | null | undefined;

export function csv(rows: Cell[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = v === null || v === undefined ? '' : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}

const STATUS: Record<string, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  observed: 'OBSERVED',
  not_collected: 'NOT COLLECTED',
  unavailable: 'UNAVAILABLE',
  error: 'ERROR',
};
const MISSING = ['not_collected', 'unavailable', 'error'];

export const evidenceId = (r: DiagnosticResult) => `${r.kind === 'deterministic' ? 'C' : 'O'}-${r.diagId}${r.stateId ? `-${r.stateId}` : ''}`;

// The criterion each Visual System and Functionality diagnostic is listed under in its packet.
const PROBE_HOMES: Record<string, string> = {
  required_contrast: 'visual_system A',
  contrast_profile: 'visual_system A',
  style_vocabulary: 'visual_system A/B/C',
  peer_consistency: 'visual_system B',
  accessibility_violations: 'visual_system C',
  focus_visibility: 'visual_system C',
  target_size: 'visual_system C',
  no_effect_controls: 'functionality A',
  form_submission: 'functionality A',
  navigation_integrity: 'functionality A',
  control_operability: 'functionality B',
  editable_response: 'functionality B',
  toggle_state: 'functionality B',
  invalid_submission: 'functionality D',
  runtime_errors: 'functionality D',
};

export function criterionOf(diagId: string): string {
  return DIAGNOSTIC_HOME[diagId] ?? PROBE_HOMES[diagId] ?? '';
}

// The results a category's summary counts: its own for the probe categories; for the others, every
// result except the probe categories' (as before they existed).
function ownResults(category: string, results: DiagnosticResult[]): DiagnosticResult[] {
  const sets: Record<string, Set<string>> = { visual_system: VISUAL_SYSTEM_DIAGNOSTICS, functionality: FUNCTIONALITY_DIAGNOSTICS };
  const own = sets[category];
  return results.filter((r) => (own ? own.has(r.diagId) : !VISUAL_SYSTEM_DIAGNOSTICS.has(r.diagId) && !FUNCTIONALITY_DIAGNOSTICS.has(r.diagId)));
}

// How many judgments cite each result, directly (C-/O- IDs) or through one of its items.
export function citations(judgments: JudgmentRecord[], diags: Diagnostics): Map<string, number> {
  const ids = diags.results.map(evidenceId).sort((a, b) => b.length - a.length);
  const out = new Map<string, number>();
  for (const j of judgments) {
    if (!j.output) continue;
    const cited = new Set<string>();
    for (const c of categoryOf(j.category ?? 'layout').criteria) {
      for (const f of j.output.criteria[c.id].findings) {
        for (const ref of f.evidence_refs) {
          const asResult = ref.replace(/^F-/, 'C-');
          const id = ids.find((x) => asResult === x || asResult.startsWith(`${x}-`));
          if (id) cited.add(id);
        }
      }
    }
    for (const id of cited) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

// Up to v3, passing checks reach the judge as one-line pass lists and failing fixture and sweep
// results as rows of the Content-Growth and Responsive matrices. Findings packets send only
// results with a listed issue or measurement, all of which are in the index.
function sentToJudge(packet: Packet, id: string, stateKind: string | undefined, status: string): string {
  if (packet.index[id]) return 'yes';
  if (!id.startsWith('C-') || packet.packetVersion === LAYOUT_PACKET_VERSION_FINDINGS) return 'no';
  if (status === 'pass') return 'pass line';
  const matrix = stateKind === 'fixture' ? 'C-content_growth_failures' : stateKind === 'sweep' ? 'C-responsive_layout_failures' : null;
  return matrix && packet.index[matrix] ? 'via matrix' : 'no';
}

export const CHECK_HEADER = [
  'run_id', 'case_id', 'bundle_id', 'evidence_id', 'check', 'check_id', 'type', 'criterion', 'state_id', 'state', 'state_kind', 'viewport', 'fixture',
  'result', 'evaluated', 'items', 'summary', 'first_item', 'first_item_elements', 'sent_to_judge', 'cited_by_judgments', 'human_verdict', 'human_notes',
];

export function checkRows(
  bundle: Bundle,
  diags: Diagnostics,
  ctx: { runId?: string; packet?: Packet | null; cited?: Map<string, number>; judgments?: number } = {},
): Cell[][] {
  const states = new Map(bundle.states.map((s) => [s.id, s]));
  return diags.results.map((r) => {
    const s = r.stateId ? states.get(r.stateId) : undefined;
    const id = evidenceId(r);
    const first = r.items[0];
    return [
      ctx.runId ?? '', bundle.caseId, bundle.bundleId, id, DIAG_NAMES[r.diagId] ?? r.diagId, r.diagId,
      r.kind === 'deterministic' ? 'check' : 'observation', criterionOf(r.diagId),
      r.stateId ?? 'all', s?.label ?? (r.stateId ? r.stateId : 'All states'), s?.kind ?? (r.stateId ? '' : 'matrix'),
      s ? `${s.viewport.width}×${s.viewport.height}` : '', s?.fixture ?? '',
      STATUS[r.status] ?? r.status, r.evaluated ?? '', r.items.length, r.summary, first?.summary ?? '',
      first?.elements.map((e) => e.selector).join(' | ') ?? '',
      ctx.packet ? sentToJudge(ctx.packet, id, s?.kind, r.status) : '',
      ctx.judgments ? `${ctx.cited?.get(id) ?? 0}/${ctx.judgments}` : '',
      '', '',
    ];
  });
}

export const SUMMARY_HEADER = [
  'run_id', 'case_id', 'bundle_id', 'interface_id', 'role', 'repeat', 'model', 'effort', 'prompt_version', 'status',
  'checks_run', 'checks_passed', 'checks_failed', 'checks_missing', 'failing_checks', 'observations', 'check_results_sent_to_judge',
  'score', 'anchor', 'strengths', 'weaknesses', 'material_weaknesses', 'decisive_findings', 'reasoning',
  'criterion_A_summary', 'criterion_B_summary', 'criterion_C_summary', 'criterion_D_summary', 'missing_evidence', 'untrusted_content_notes', 'reasoning_trace',
  'screenshots_sent', 'screenshot_ids', 'image_tokens_est',
  'refs', 'valid_refs', 'ref_errors', 'input_tokens', 'output_tokens', 'cost_usd', 'latency_ms',
  'human_score', 'human_rater', 'human_notes',
];

// Both CSVs for the latest evidence, before any judge run: judgment columns stay blank, and
// sent_to_judge reflects the given prompt version's packet.
export function writeEvidenceReport(caseIds: string[], promptVersion: string): string {
  const dir = ensureDir(path.join(ARTIFACTS_DIR, 'reports', 'latest'));
  const summary: Cell[][] = [SUMMARY_HEADER];
  const checks: Cell[][] = [CHECK_HEADER];
  for (const caseId of caseIds) {
    const bundle = loadBundle(caseId);
    const diags = loadDiagnostics(bundle);
    if (!diags) continue;
    const packet = loadOrBuildPacket(bundle, promptVersion);
    summary.push(summaryRow(bundle, diags, { packet, run: { model: '', effort: '', promptVersion } }));
    checks.push(...checkRows(bundle, diags, { packet }));
  }
  fs.writeFileSync(path.join(dir, 'summary.csv'), csv(summary));
  fs.writeFileSync(path.join(dir, 'checks.csv'), csv(checks));
  return dir;
}

// "Container Overflow: mobile, stress-desktop, sweep ×9" — sweep widths are counted, not listed.
function failingChecks(bundle: Bundle, diags: Diagnostics): string {
  const byCheck = new Map<string, string[]>();
  for (const r of diags.results) {
    if (r.kind !== 'deterministic' || r.status !== 'fail' || !r.stateId) continue;
    byCheck.set(r.diagId, [...(byCheck.get(r.diagId) ?? []), r.stateId]);
  }
  return [...byCheck.entries()]
    .map(([diagId, stateIds]) => {
      const sweep = stateIds.filter((id) => id.startsWith('sweep-')).length;
      const other = stateIds.filter((id) => !id.startsWith('sweep-'));
      return `${DIAG_NAMES[diagId] ?? diagId}: ${[...other, ...(sweep ? [`sweep ×${sweep}`] : [])].join(', ')}`;
    })
    .join('; ');
}

export function summaryRow(
  bundle: Bundle,
  diags: Diagnostics,
  ctx: { runId?: string; role?: string; packet?: Packet | null; judgment?: JudgmentRecord; run?: { model: string; effort: string; promptVersion: string } } = {},
): Cell[] {
  const j = ctx.judgment;
  const category = j?.category ?? ctx.packet?.category ?? 'layout';
  const own = ownResults(category, diags.results);
  const checks = own.filter((r) => r.kind === 'deterministic');
  const criteria = categoryOf(category).criteria;
  const findings = j?.output ? criteria.flatMap((c) => j.output!.criteria[c.id].findings) : [];
  const images = ctx.packet?.images ?? [];
  const sentChecks = ctx.packet ? checks.filter((r) => ctx.packet!.index[evidenceId(r)]).length : null;
  return [
    ctx.runId ?? '', bundle.caseId, bundle.bundleId, bundle.interfaceId, ctx.role ?? '', j?.repeat ?? '',
    ctx.run?.model ?? '', ctx.run?.effort ?? '', ctx.run?.promptVersion ?? '', j?.status ?? (ctx.runId ? '' : 'checks only'),
    checks.filter((r) => !MISSING.includes(r.status)).length,
    checks.filter((r) => r.status === 'pass').length,
    checks.filter((r) => r.status === 'fail').length,
    checks.filter((r) => MISSING.includes(r.status)).length,
    failingChecks(bundle, { ...diags, results: checks }),
    own.filter((r) => r.kind === 'observation' && r.status === 'observed').length,
    sentChecks,
    j?.output?.overall.score ?? null, j?.output?.overall.anchor ?? null,
    j ? findings.filter((f) => f.polarity === 'strength').length : null,
    j ? findings.filter((f) => f.polarity !== 'strength').length : null,
    j ? findings.filter((f) => f.polarity !== 'strength' && f.materiality === 'material').length : null,
    j?.output?.overall.decisive_finding_ids?.join(' ') ?? '', j?.output?.overall.reasoning ?? '',
    // One column per header criterion, so categories with fewer criteria keep the columns aligned.
    ...['A', 'B', 'C', 'D'].map((id) => j?.output?.criteria[id]?.summary ?? ''),
    j?.output?.missing_evidence.map((m) => `${m.evidence} (${m.affected_criteria.join(', ')}): ${m.effect_on_assessment}`).join(' | ') ?? '',
    j?.output?.untrusted_content_notes.join(' | ') ?? '',
    j?.reasoningSummary ?? '',
    ctx.packet ? images.length : null, images.map((i) => i.id).join(' '), ctx.packet ? images.reduce((s, i) => s + i.estimatedTokens, 0) : null,
    j?.validation?.stats.refs ?? null, j?.validation?.stats.validRefs ?? null,
    j?.validation ? j.validation.refIssues.filter((i) => i.severity === 'error').length : null,
    j?.usage?.inputTokens ?? null, j?.usage?.outputTokens ?? null, j?.costUsd ?? null, j?.latencyMs ?? null,
    '', '', '',
  ];
}
