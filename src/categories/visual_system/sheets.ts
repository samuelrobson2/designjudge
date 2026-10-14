// Visual System's visual aids: a palette sheet (the colours the interface renders, grouped by use,
// with their counts) drawn as SVG, and device-resolution captures redrawn at one image pixel per
// CSS pixel so they cost no more than a screenshot.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { sha256 } from '../../util.ts';
import type { Packet, PacketImage, PaletteImage } from '../types.ts';

const PAD = 14;
const SW = 44;
const CELL = 92;
const PER_ROW = 9;
const TITLE_H = 22;
const LABEL_H = 30;
const MAX_SWATCHES = 27;

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

export interface PaletteInput {
  use: string;
  colours: { colour: string; elements: number; flagged?: boolean }[];
}

// The sheet's layout, or null when there are no colours.
export function buildPalette(id: string, stateId: string, groups: PaletteInput[], header: string): PacketImage | null {
  const shown = groups.filter((g) => g.colours.length);
  if (!shown.length) return null;
  const composed: PaletteImage = {
    kind: 'palette',
    header,
    groups: shown.map((g) => ({
      title: `${g.use.charAt(0).toUpperCase()}${g.use.slice(1)} colours (${g.colours.length})${g.colours.length > MAX_SWATCHES ? `, the ${MAX_SWATCHES} most used shown` : ''}`,
      swatches: g.colours.slice(0, MAX_SWATCHES).map((c) => ({ colour: c.colour, label: `${c.elements}`, ...(c.flagged ? { flagged: true } : {}) })),
    })),
  };
  const width = PAD * 2 + PER_ROW * CELL;
  let height = PAD + TITLE_H;
  for (const g of composed.groups) height += TITLE_H + Math.ceil(g.swatches.length / PER_ROW) * (SW + LABEL_H + 8) + 6;
  return {
    id,
    stateId,
    kind: 'full',
    path: path.join('visual_system', `${id}-${sha256(JSON.stringify(composed)).slice(0, 10)}.png`),
    detail: 'original',
    caption: '',
    width,
    height: height + PAD,
    scale: 1,
    scrollY: 0,
    estimatedTokens: 0,
    composed,
  };
}

function paletteSvg(img: PacketImage, c: PaletteImage): string {
  const parts: string[] = [`<rect width="${img.width}" height="${img.height}" fill="#ffffff"/>`];
  const text = (x: number, y: number, s: string, size = 12, weight = 400, fill = '#111827') =>
    `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(s)}</text>`;
  let y = PAD;
  parts.push(text(PAD, y + 14, c.header, 13, 700));
  y += TITLE_H;
  for (const g of c.groups) {
    parts.push(text(PAD, y + 15, g.title, 13, 700, '#374151'));
    y += TITLE_H;
    g.swatches.forEach((s, i) => {
      const x = PAD + (i % PER_ROW) * CELL;
      const top = y + Math.floor(i / PER_ROW) * (SW + LABEL_H + 8);
      const [hexPart, alpha] = s.colour.split(' at ');
      const opacity = alpha ? Number(alpha.replace('%', '')) / 100 : 1;
      parts.push(`<rect x="${x}" y="${top}" width="${SW}" height="${SW}" rx="4" fill="#ffffff" stroke="#d1d5db"/>`);
      parts.push(`<rect x="${x}" y="${top}" width="${SW}" height="${SW}" rx="4" fill="${hexPart}" fill-opacity="${opacity}" stroke="${s.flagged ? '#E11D48' : '#d1d5db'}" stroke-width="${s.flagged ? 3 : 1}"/>`);
      parts.push(text(x, top + SW + 13, s.colour.replace(' at ', ' '), 11, s.flagged ? 700 : 400, s.flagged ? '#B42318' : '#111827'));
      parts.push(text(x, top + SW + 26, `${s.label} element${s.label === '1' ? '' : 's'}`, 11, 400, '#4B5563'));
    });
    y += Math.ceil(g.swatches.length / PER_ROW) * (SW + LABEL_H + 8) + 6;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}">${parts.join('')}</svg>`;
}

// Draws the palette sheets and resized captures that do not exist yet.
export async function ensureVisualSystemImages(packet: Packet, bundleDir: string): Promise<void> {
  for (const img of packet.images) {
    const c = img.composed;
    if (!c || (c.kind !== 'palette' && c.kind !== 'scaled')) continue;
    const out = path.join(bundleDir, img.path);
    if (fs.existsSync(out)) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (c.kind === 'palette') await sharp(Buffer.from(paletteSvg(img, c))).png().toFile(out);
    else await sharp(path.join(bundleDir, c.source)).resize({ width: img.width, height: img.height, fit: 'fill' }).png().toFile(out);
  }
}
