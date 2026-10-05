// Designer critiques of UI screens from UICrit, as one row per screen: the prompt, the image and
// the designers' feedback.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ARTIFACTS_DIR } from '../config.ts';
import { csv } from '../report/csv.ts';
import { ensureDir, log, writeJson } from '../util.ts';

export const CALIBRATION_DIR = path.join(ARTIFACTS_DIR, 'calibration');

const UICRIT_CSV = 'https://raw.githubusercontent.com/google-research-datasets/uicrit/main/uicrit_public.csv';
const RICO_ARCHIVE = 'https://storage.googleapis.com/crowdstf-rico-uiuc-4540/rico_dataset_v0.1/unique_uis.tar.gz';

export const SOURCE = {
  name: 'UICrit: Enhancing Automated Design Evaluation with a UI Critique Dataset',
  publisher: 'Google Research',
  paper: 'https://arxiv.org/abs/2407.08850',
  homepage: 'https://github.com/google-research-datasets/uicrit',
  license: 'CC BY 4.0 (critiques)',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  citation:
    'Peitong Duan, Chin-Yi Chen, Gang Li, Bjoern Hartmann, Yang Li. 2024. UICrit: Enhancing Automated Design Evaluation with a UI Critique Dataset. UIST 2024.',
  raters: 'Experienced designers; each screen was critiqued by three of them (a few by one, two or four).',
  feedback:
    'Only comments the designers wrote themselves. UICrit also includes Gemini-written comments that a designer marked as valid; those are left out. Each comment\'s bounding box is left out too.',
  prompt: 'Each designer described the screen\'s main task in their own words; the prompt lists every distinct description.',
  ratings:
    'Each designer rated design quality, aesthetics and usability from 1 to 10, and learnability and efficiency from 1 to 5. Each rating column is the mean of the screen\'s designers, to one decimal place.',
  images: {
    name: 'Rico',
    homepage: 'https://www.interactionmining.org/archive/rico',
    download: RICO_ARCHIVE,
    description: 'Screenshots of real Android apps, collected around 2017.',
    terms:
      'https://www.interactionmining.org/legal/copyright — the screenshots may contain copyrighted work; whoever downloads them takes responsibility for their use and indemnifies the Rico team and the University of Illinois, and an employer is bound too.',
  },
};

// RFC 4180: quoted fields may contain commas, doubled quotes and newlines.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' };

// The `comments` column holds a Python list of strings, written as Python prints it.
export function parsePythonStrings(literal: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < literal.length; i++) {
    const q = literal[i];
    if (q !== "'" && q !== '"') continue;
    let s = '';
    for (i++; i < literal.length && literal[i] !== q; i++) {
      if (literal[i] !== '\\') {
        s += literal[i];
        continue;
      }
      const e = literal[++i];
      if (e === 'x') {
        s += String.fromCharCode(parseInt(literal.slice(i + 1, i + 3), 16));
        i += 2;
      } else if (e === 'u') {
        s += String.fromCharCode(parseInt(literal.slice(i + 1, i + 5), 16));
        i += 4;
      } else s += ESCAPES[e] ?? `\\${e}`;
    }
    out.push(s);
  }
  return out;
}

// Designers' own comments are headed "Comment N"; validated Gemini comments are headed "LLM Comment N".
export function designerComments(literal: string): string[] {
  return parsePythonStrings(literal)
    .filter((c) => /^Comment \d+/.test(c))
    .map((c) =>
      c
        .replace(/^Comment \d+\s*/, '')
        .replace(/\s*Bounding Box:\s*\[[^\]]*\]\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

// Each designer rated the screen; the column names are UICrit's, including its "efficency".
export const RATINGS = [
  { id: 'design_quality', column: 'design_quality_rating', scale: 10 },
  { id: 'aesthetics', column: 'aesthetics_rating', scale: 10 },
  { id: 'usability', column: 'usability_rating', scale: 10 },
  { id: 'learnability', column: 'learnability', scale: 5 },
  { id: 'efficiency', column: 'efficency', scale: 5 },
] as const;

export type RatingId = (typeof RATINGS)[number]['id'];

export interface Critique {
  screenId: string;
  prompt: string;
  // Mean of the designers' ratings, to one decimal place.
  ratings: Record<RatingId, number | null>;
  feedback: string[];
}

export function critiquesByScreen(rows: string[][]): Critique[] {
  const [header, ...data] = rows;
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`UICrit CSV has no "${name}" column`);
    return i;
  };
  const [idCol, taskCol, commentsCol] = [col('rico_id'), col('task'), col('comments')];
  const ratingCols = RATINGS.map((r) => col(r.column));
  const byScreen = new Map<string, { tasks: string[]; ratings: number[][]; feedback: string[] }>();
  for (const r of data) {
    if (r.length < header.length) continue;
    const screen = byScreen.get(r[idCol]) ?? { tasks: [], ratings: RATINGS.map(() => []), feedback: [] };
    const task = r[taskCol].replace(/\s+/g, ' ').trim();
    if (task && !screen.tasks.includes(task)) screen.tasks.push(task);
    ratingCols.forEach((c, i) => {
      if (r[c].trim()) screen.ratings[i].push(Number(r[c]));
    });
    screen.feedback.push(...designerComments(r[commentsCol]));
    byScreen.set(r[idCol], screen);
  }
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  return [...byScreen.entries()].map(([screenId, s]) => ({
    screenId,
    prompt: s.tasks.join('\n'),
    ratings: Object.fromEntries(RATINGS.map((r, i) => [r.id, mean(s.ratings[i])])) as Critique['ratings'],
    feedback: s.feedback,
  }));
}

// Streams the 6 GB Rico archive and keeps only the screenshots UICrit uses.
function extractRicoScreenshots(ids: string[], imagesDir: string) {
  const missing = ids.filter((id) => !fs.existsSync(path.join(imagesDir, `${id}.jpg`)));
  if (!missing.length) return;
  log(`[calibration] extracting ${missing.length} screenshots from the Rico archive (streams about 6 GB)`);
  const list = path.join(imagesDir, '.wanted.txt');
  fs.writeFileSync(list, missing.map((id) => `combined/${id}.jpg`).join('\n') + '\n');
  try {
    execFileSync('sh', ['-c', 'curl -sfL "$1" | tar -xzf - -C "$2" --strip-components 1 -T "$3"', 'sh', RICO_ARCHIVE, imagesDir, list], { stdio: ['ignore', 'inherit', 'pipe'] });
  } catch (err) {
    const stillMissing = missing.filter((id) => !fs.existsSync(path.join(imagesDir, `${id}.jpg`)));
    if (stillMissing.length) throw new Error(`${stillMissing.length} screenshots could not be extracted (e.g. ${stillMissing.slice(0, 3).join(', ')}): ${(err as Error).message}`);
  } finally {
    fs.rmSync(list, { force: true });
  }
}

export async function buildCalibrationDataset(): Promise<string> {
  ensureDir(CALIBRATION_DIR);
  const res = await fetch(UICRIT_CSV);
  if (!res.ok) throw new Error(`Could not download UICrit (${res.status}): ${UICRIT_CSV}`);
  const critiques = critiquesByScreen(parseCsv(await res.text())).filter((c) => c.feedback.length);

  const imagesDir = ensureDir(path.join(CALIBRATION_DIR, 'images'));
  extractRicoScreenshots(critiques.map((c) => c.screenId), imagesDir);

  const rows: (string | number | null)[][] = [['prompt', 'image', 'image_size', ...RATINGS.map((r) => `${r.id} (1-${r.scale})`), 'feedback']];
  for (const c of critiques) {
    const { width, height } = await sharp(path.join(imagesDir, `${c.screenId}.jpg`)).metadata();
    rows.push([c.prompt, `images/${c.screenId}.jpg`, `${width}×${height}`, ...RATINGS.map((r) => c.ratings[r.id]), c.feedback.map((f) => `- ${f}`).join('\n')]);
  }
  fs.writeFileSync(path.join(CALIBRATION_DIR, 'critiques.csv'), csv(rows));
  writeJson(path.join(CALIBRATION_DIR, 'source.json'), SOURCE);
  const comments = critiques.reduce((n, c) => n + c.feedback.length, 0);
  log(`[calibration] ${critiques.length} screens with ${comments} designer comments written to ${path.relative(process.cwd(), CALIBRATION_DIR)}/critiques.csv`);
  return CALIBRATION_DIR;
}
