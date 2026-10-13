// Colour arithmetic for the Visual System diagnostics: compositing, WCAG 2 contrast ratio,
// APCA lightness contrast (APCA-W3 0.0.98G-4g) and OKLab distance.

import type { Rgba } from '../../collect/probeTypes.ts';

export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3] + bottom[3] * (1 - top[3]);
  if (a <= 0) return [0, 0, 0, 0];
  const ch = (i: number) => Math.round((top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a);
  return [ch(0), ch(1), ch(2), Math.round(a * 100) / 100];
}

export function hex(c: Rgba): string {
  const h = `#${[c[0], c[1], c[2]].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  return c[3] < 0.995 ? `${h} at ${Math.round(c[3] * 100)}%` : h;
}

function linear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(c: Rgba): number {
  return 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
}

// WCAG 2 contrast ratio of an opaque foreground on an opaque background.
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// APCA Lc, unsigned (about 106 for black on white).
export function apcaLc(fg: Rgba, bg: Rgba): number {
  const y = (c: Rgba) => (c[0] / 255) ** 2.4 * 0.2126729 + (c[1] / 255) ** 2.4 * 0.7151522 + (c[2] / 255) ** 2.4 * 0.072175;
  const clamp = (v: number) => (v >= 0.022 ? v : v + (0.022 - v) ** 1.414);
  const txt = clamp(y(fg));
  const back = clamp(y(bg));
  if (Math.abs(back - txt) < 0.0005) return 0;
  if (back > txt) {
    const sapc = (back ** 0.56 - txt ** 0.57) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  const sapc = (back ** 0.65 - txt ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : -(sapc + 0.027) * 100;
}

export function oklab(c: Rgba): [number, number, number] {
  const r = linear(c[0]);
  const g = linear(c[1]);
  const b = linear(c[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function oklabDistance(a: Rgba, b: Rgba): number {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// OKLCh chroma: how colourful (as opposed to grey) a colour is.
export function chroma(c: Rgba): number {
  const [, a, b] = oklab(c);
  return Math.hypot(a, b);
}

// WCAG large text: at least 24 px, or at least 18.66 px (14 pt) in bold.
export function isLargeText(size: number, weight: number): boolean {
  return size >= 24 || (size >= 18.66 && weight >= 700);
}
