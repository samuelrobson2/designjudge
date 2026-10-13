// Type specimen sheets: one row per distinct text style in a state, a crop of real text in that
// style from the state's screenshot beside its measured values. The judge sees how each style
// renders next to what it is, without hunting for it in a full page.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Rect, ScreenshotRecord, StateRecord } from '../../types.ts';
import { sha256 } from '../../util.ts';
import type { Doc } from '../../diagnostics/doc.ts';
import { roleKey, roleLabel, roundSize, styleKey, type TextEl } from '../../diagnostics/typography/text.ts';
import type { ComposedImage, Packet, PacketImage } from '../types.ts';

const LABEL_W = 330;
const PAD = 12;
const GAP = 10;
const LINE = 17;
const MAX_ROWS = 20;
// Crops show at most three lines and this much width, so one long paragraph does not dominate.
const MAX_CROP_W = { wide: 900, narrow: 340 };

export interface Specimen {
  image: PacketImage;
  styles: number;
  shown: number;
}

function insideShot(r: Rect, shot: ScreenshotRecord): boolean {
  return r.w > 2 && r.h > 2 && r.x >= 0 && r.y >= 0 && r.x + r.w <= shot.width + 1 && r.y + r.h <= shot.height + 1;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

// The specimen for one state, or null when the state has no usable screenshot or text.
export function buildSpecimen(state: StateRecord, doc: Doc, texts: TextEl[], id: string): Specimen | null {
  const full = state.screenshots.find((s) => s.kind === 'full');
  const vp = state.screenshots.find((s) => s.kind === 'viewport');
  if (!full && !vp) return null;
  const maxW = state.viewport.width >= 1024 ? MAX_CROP_W.wide : MAX_CROP_W.narrow;
  const styles = new Map<string, TextEl[]>();
  for (const x of texts) {
    if (x.t.field || x.family.icon || !(x.t.size > 0)) continue;
    styles.set(styleKey(x), [...(styles.get(styleKey(x)) ?? []), x]);
  }
  const ordered = [...styles.values()].sort((a, b) => b[0].t.size - a[0].t.size || b[0].t.weight - a[0].t.weight);
  // One family throughout is named once at the top instead of on every row.
  const families = new Set(ordered.map((xs) => xs[0].family.rendered));
  const header = families.size === 1 ? `All styles use ${[...families][0]}.` : undefined;

  const rows: ComposedImage['rows'] = [];
  let top = PAD + (header ? LINE + GAP : 0);
  let widest = 0;
  for (const xs of ordered) {
    if (rows.length >= MAX_ROWS) break;
    // An example on the full page (fixed elements are hidden there, so they come from the first screen).
    const pick = [...xs]
      .sort((a, b) => Number(!!a.role.inline) - Number(!!b.role.inline) || Math.min(b.t.chars, 80) - Math.min(a.t.chars, 80))
      .map((x) => {
        const r = x.el.textRect;
        if (!r) return null;
        const fixed = doc.ref(x.el).fixed;
        const shot = fixed ? vp : full ?? vp;
        if (!shot) return null;
        const rect = fixed ? r : { ...r, y: r.y - (shot.kind === 'full' ? 0 : shot.scrollY) };
        return insideShot(rect, shot) ? { x, rect, shot } : null;
      })
      .find((p) => p !== null);
    if (!pick) continue;
    const t = pick.x.t;
    const lh = t.lineHeight ?? t.size * 1.25;
    const crop = {
      x: Math.max(0, Math.floor(pick.rect.x - 4)),
      y: Math.max(0, Math.floor(pick.rect.y - 3)),
      w: 0,
      h: 0,
    };
    crop.w = Math.min(Math.ceil(pick.rect.w + 8), maxW, pick.shot.width - crop.x);
    crop.h = Math.min(Math.ceil(pick.rect.h + 6), Math.ceil(lh * 3 + 6), pick.shot.height - crop.y);
    if (crop.w < 4 || crop.h < 4) continue;
    const roles: Record<string, number> = {};
    for (const x of xs) roles[roleKey(x.role)] = (roles[roleKey(x.role)] ?? 0) + 1;
    const roleText = Object.entries(roles)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([k, n]) => `${roleLabel(k)} ${n}`)
      .join(', ');
    const ratio = t.lineHeight === null ? 'normal' : String(Math.round((t.lineHeight / t.size) * 100) / 100);
    const label = [
      `T${rows.length + 1}  ${roundSize(t.size)} px · weight ${t.weight}${t.style === 'italic' ? ' · italic' : ''}${t.transform === 'uppercase' ? ' · uppercase' : ''}`,
      ...(header ? [] : [pick.x.family.rendered]),
      `line-height ${ratio} · ${xs.length} element${xs.length > 1 ? 's' : ''}`,
      roleText,
    ];
    const height = Math.max(crop.h, label.length * LINE + 4);
    rows.push({ label, source: pick.shot.path, crop, top, height });
    top += height + GAP;
    widest = Math.max(widest, crop.w);
  }
  if (!rows.length) return null;
  const footer = ordered.length > rows.length ? `${ordered.length - rows.length} further style${ordered.length - rows.length > 1 ? 's' : ''} not shown (smaller sizes, or no example on the screenshot).` : undefined;
  const width = PAD + LABEL_W + PAD + widest + PAD;
  const height = top - GAP + PAD + (footer ? LINE + PAD : 0);
  const composed: ComposedImage = { kind: 'type-specimen', rows, labelWidth: LABEL_W, ...(header ? { header } : {}), ...(footer ? { footer } : {}) };
  const file = path.join('typography', `${id}-${sha256(JSON.stringify(composed)).slice(0, 10)}.png`);
  return {
    styles: ordered.length,
    shown: rows.length,
    image: {
      id,
      stateId: state.id,
      kind: 'full',
      path: file,
      detail: 'original',
      caption: '',
      width,
      height,
      scale: 1,
      scrollY: 0,
      estimatedTokens: 0,
      composed,
    },
  };
}

function sheetSvg(img: PacketImage, c: ComposedImage): string {
  const parts: string[] = [];
  if (c.header) parts.push(`<text x="${PAD}" y="${PAD + 13}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#111827">${escapeXml(c.header)}</text>`);
  c.rows.forEach((r, i) => {
    if (i > 0) parts.push(`<line x1="${PAD}" x2="${img.width - PAD}" y1="${r.top - GAP / 2}" y2="${r.top - GAP / 2}" stroke="#E5E7EB" stroke-width="1"/>`);
    r.label.forEach((line, j) => {
      parts.push(
        `<text x="${PAD}" y="${r.top + 13 + j * LINE}" font-family="Helvetica, Arial, sans-serif" font-size="${j === 0 ? 13 : 12}" font-weight="${j === 0 ? 700 : 400}" fill="${j === 0 ? '#111827' : '#4B5563'}">${escapeXml(line)}</text>`,
      );
    });
  });
  if (c.footer) {
    parts.push(`<text x="${PAD}" y="${img.height - PAD - 3}" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#6B7280">${escapeXml(c.footer)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}">${parts.join('')}</svg>`;
}

// Draws composed images that do not exist yet. `bundleDir` is the evidence bundle's folder.
export async function ensureComposedImages(packet: Packet, bundleDir: string): Promise<void> {
  for (const img of packet.images) {
    const c = img.composed;
    if (!c || c.kind !== 'type-specimen') continue;
    const out = path.join(bundleDir, img.path);
    if (fs.existsSync(out)) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const layers: sharp.OverlayOptions[] = [];
    for (const r of c.rows) {
      const crop = await sharp(path.join(bundleDir, r.source)).extract({ left: r.crop.x, top: r.crop.y, width: r.crop.w, height: r.crop.h }).png().toBuffer();
      layers.push({ input: crop, left: PAD + c.labelWidth + PAD, top: r.top });
    }
    layers.push({ input: Buffer.from(sheetSvg(img, c)), left: 0, top: 0 });
    await sharp({ create: { width: img.width, height: img.height, channels: 3, background: '#ffffff' } })
      .composite(layers)
      .png()
      .toFile(out);
  }
}
