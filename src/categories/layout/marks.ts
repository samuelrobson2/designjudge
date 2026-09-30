// Marks check findings on the screenshots the judge receives: each issue is numbered (1, 2, …)
// and outlined in red. Observation measurements are not marked. The clean screenshots stay on
// disk; the judge gets marked copies.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Bundle, Diagnostics, Rect } from '../../types.ts';
import { sha256 } from '../../util.ts';
import type { Packet, PacketImage, ImageMark } from '../types.ts';
import type { FindingsCriterion, FindingLine } from './findings.ts';

const RED = '#E11D48';
const LABEL_H = 20;

// Labels every finding line, places its element boxes on the images of the same state, and
// records on each line which images show it. Image paths are switched to marked copies, named
// by a hash of their marks so a changed set of marks gets a new file.
export function assignMarks(criteria: FindingsCriterion[], images: PacketImage[]): void {
  let n = 0;
  const labelled: { line: FindingLine; kind: ImageMark['kind'] }[] = [];
  for (const c of criteria) {
    for (const b of c.checks) for (const l of b.issues) labelled.push({ line: Object.assign(l, { marker: String(++n) }), kind: 'fail' });
  }
  for (const img of images) {
    const marks: ImageMark[] = [];
    for (const { line, kind } of labelled) {
      let shown = false;
      for (const box of line.boxes ?? []) {
        if (box.stateId !== img.stateId) continue;
        const r = boxOnImage(box.rect, img, box.fixed);
        if (!r) continue;
        marks.push({ label: line.marker!, kind, rect: r });
        shown = true;
      }
      if (shown) line.marked_in = [...(line.marked_in ?? []), img.id];
    }
    if (!marks.length) continue;
    img.sourcePath = img.sourcePath ?? img.path;
    img.marks = marks;
    const dir = path.dirname(img.sourcePath);
    const base = path.basename(img.sourcePath, '.png');
    img.path = path.join(dir, `${base}.marked-${sha256(img.sourcePath + JSON.stringify(marks)).slice(0, 10)}.png`);
  }
}

// Where a page box falls on an image of its state (null when it is outside the image).
// Fixed-layer boxes are in screen coordinates and are hidden in full-page captures.
export function boxOnImage(rect: Rect, img: Pick<PacketImage, 'kind' | 'scrollY' | 'width' | 'height'>, fixed = false): Rect | null {
  if (fixed && img.kind === 'full') return null;
  const top = fixed || img.kind === 'full' ? 0 : img.scrollY;
  return clip({ x: rect.x, y: rect.y - top, w: rect.w, h: rect.h }, img.width, img.height);
}

// Whether any of a finding's boxes falls on an image of the same state.
export function lineVisibleIn(line: FindingLine, img: PacketImage): boolean {
  return (line.boxes ?? []).some((b) => b.stateId === img.stateId && !!boxOnImage(b.rect, img, b.fixed));
}

function clip(r: Rect, w: number, h: number): Rect | null {
  const x1 = Math.max(0, r.x);
  const y1 = Math.max(0, r.y);
  const x2 = Math.min(w, r.x + r.w);
  const y2 = Math.min(h, r.y + r.h);
  if (x2 - x1 < 2 || y2 - y1 < 2) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function overlaySvg(img: PacketImage): string {
  const labelledOnce = new Set<string>();
  const shapes: string[] = [];
  const tags: string[] = [];
  for (const m of img.marks ?? []) {
    const colour = RED;
    shapes.push(`<rect x="${m.rect.x + 1}" y="${m.rect.y + 1}" width="${Math.max(1, m.rect.w - 2)}" height="${Math.max(1, m.rect.h - 2)}" fill="none" stroke="${colour}" stroke-width="3"/>`);
    // One tag per finding per image, at the top-left of its first box (inside when there is no room above).
    if (labelledOnce.has(m.label)) continue;
    labelledOnce.add(m.label);
    const tagW = 12 + 9 * m.label.length;
    const tx = Math.min(Math.max(0, m.rect.x), Math.max(0, img.width - tagW));
    const ty = m.rect.y >= LABEL_H ? m.rect.y - LABEL_H : m.rect.y;
    tags.push(
      `<rect x="${tx}" y="${ty}" width="${tagW}" height="${LABEL_H}" rx="3" fill="${colour}"/>` +
        `<text x="${tx + tagW / 2}" y="${ty + 15}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="#fff">${m.label}</text>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}">${shapes.join('')}${tags.join('')}</svg>`;
}

export interface StateMarks {
  // `crop` is a close-up of the marked area, so the tags are legible as a thumbnail.
  shots: { kind: 'viewport' | 'full' | 'scrolled'; path: string; marked: boolean; crop?: string }[];
  legend: { n: number; check: string; summary: string; shown: boolean }[];
}

// For inspecting the checks: every captured state's screenshots with its own failing check
// items outlined in red and numbered (observations are not marked). Marked copies are cached
// next to the screenshots; `names` maps check IDs to display names.
export async function markStateScreenshots(bundle: Bundle, diags: Diagnostics, bundleDir: string, names: Record<string, string>): Promise<Record<string, StateMarks>> {
  const out: Record<string, StateMarks> = {};
  for (const s of bundle.states) {
    const failing = diags.results.filter((r) => r.stateId === s.id && r.kind === 'deterministic' && r.status === 'fail');
    const items = failing.flatMap((r) => r.items.map((it) => ({ r, it })));
    const legend: StateMarks['legend'] = items.map(({ r, it }, i) => ({ n: i + 1, check: names[r.diagId] ?? r.diagId, summary: it.summary, shown: false }));
    const shots: StateMarks['shots'] = [];
    for (const shot of s.screenshots) {
      const img = { id: shot.id, stateId: s.id, kind: shot.kind, path: shot.path, detail: 'high', caption: '', width: shot.width, height: shot.height, scale: shot.scale, scrollY: shot.scrollY, estimatedTokens: 0 } as PacketImage;
      const marks: ImageMark[] = [];
      items.forEach(({ it }, i) => {
        for (const el of it.elements.slice(0, 3)) {
          if (!(el.rect?.w > 0) || !(el.rect?.h > 0)) continue;
          const r = boxOnImage(el.rect, shot, el.fixed);
          if (!r) continue;
          marks.push({ label: String(i + 1), kind: 'fail', rect: r });
          legend[i].shown = true;
        }
      });
      if (!marks.length) {
        shots.push({ kind: shot.kind, path: shot.path, marked: false });
        continue;
      }
      img.marks = marks;
      const file = path.join(path.dirname(shot.path), `${path.basename(shot.path, '.png')}.checks-${sha256(JSON.stringify(marks)).slice(0, 10)}.png`);
      const abs = path.join(bundleDir, file);
      if (!fs.existsSync(abs)) {
        await sharp(path.join(bundleDir, shot.path)).composite([{ input: Buffer.from(overlaySvg(img)), top: 0, left: 0 }]).png().toFile(abs);
      }
      // All marks with room for their tags; the first mark alone when together they span too much.
      const around = (list: ImageMark[]) => {
        const x1 = Math.max(0, Math.min(...list.map((m) => m.rect.x)) - 24);
        const y1 = Math.max(0, Math.min(...list.map((m) => m.rect.y)) - 24 - LABEL_H);
        const x2 = Math.min(shot.width, Math.max(...list.map((m) => m.rect.x + m.rect.w)) + 24);
        const y2 = Math.min(shot.height, Math.max(...list.map((m) => m.rect.y + m.rect.h)) + 24);
        return { left: Math.round(x1), top: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) };
      };
      let region = around(marks);
      if (region.height > 1200 || region.width > 1400) region = around(marks.filter((m) => m.label === marks[0].label));
      const crop = file.replace(/\.png$/, '.crop.png');
      if (!fs.existsSync(path.join(bundleDir, crop)) && region.width > 0 && region.height > 0) {
        await sharp(abs).extract(region).png().toFile(path.join(bundleDir, crop));
      }
      shots.push({ kind: shot.kind, path: file, marked: true, crop });
    }
    out[s.id] = { shots, legend };
  }
  return out;
}

// Draws the marked copies that do not exist yet. `bundleDir` is the evidence bundle's folder.
export async function ensureMarkedScreenshots(packet: Packet, bundleDir: string): Promise<void> {
  for (const img of packet.images) {
    if (!img.marks?.length || !img.sourcePath) continue;
    const out = path.join(bundleDir, img.path);
    if (fs.existsSync(out)) continue;
    await sharp(path.join(bundleDir, img.sourcePath))
      .composite([{ input: Buffer.from(overlaySvg(img)), top: 0, left: 0 }])
      .png()
      .toFile(out);
  }
}
