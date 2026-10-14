import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { withoutDurations } from '../src/collect/steps.ts';
import { describeDiff, diffFingerprints, IMAGE_TOLERANCE_PX, type Fingerprint } from '../src/determinism/fingerprint.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-determinism-test-'));

async function png(name: string, dots: number): Promise<string> {
  const px = Buffer.alloc(40 * 40 * 3, 255);
  for (let i = 0; i < dots; i++) px.fill(0, i * 3, i * 3 + 3);
  const file = path.join(dir, name);
  await sharp(px, { raw: { width: 40, height: 40, channels: 3 } }).png().toFile(file);
  return file;
}

function fp(label: string, over: Partial<Fingerprint> = {}): Fingerprint {
  return {
    label,
    bundleId: label,
    sections: { checks: ['a pass', 'b fail'], states: ['desktop collected'] },
    packets: {},
    settle: { states: 1, unsettled: 0, wallMs: [1], pageMs: [5000] },
    ...over,
  };
}

describe('determinism fingerprints', () => {
  it('reports no difference for the same evidence, whatever the timings', async () => {
    const d = await diffFingerprints(fp('a'), fp('b', { settle: { states: 1, unsettled: 0, wallMs: [900], pageMs: [5000] } }));
    expect(d.differences).toEqual([]);
    expect(describeDiff(d)).toBe('a vs b: identical');
  });

  it('names the lines only one side has, and counts a repeated line', async () => {
    const d = await diffFingerprints(fp('a'), fp('b', { sections: { checks: ['a pass', 'b pass', 'b pass'], states: ['desktop collected'] } }));
    expect(d.differences).toEqual([{ section: 'checks', onlyA: ['b fail'], onlyB: ['b pass'] }]);
  });

  it('notices the same lines in another order', async () => {
    const d = await diffFingerprints(fp('a'), fp('b', { sections: { checks: ['b fail', 'a pass'], states: ['desktop collected'] } }));
    expect(d.differences[0].onlyA).toEqual(['(same lines in another order)']);
  });

  it('lets packet images differ by a few pixels, and no more', async () => {
    const base = await png('base.png', 0);
    const near = await png('near.png', IMAGE_TOLERANCE_PX);
    const far = await png('far.png', IMAGE_TOLERANCE_PX + 1);
    const packet = (file: string, sha: string) => ({ layout: { lines: ['x'], images: [{ id: 'S-desktop', caption: 'Desktop', sha256: sha, path: file }] } });
    const within = await diffFingerprints(fp('a', { packets: packet(base, '1') }), fp('b', { packets: packet(near, '2') }));
    expect(within.differences).toEqual([]);
    expect(within.imagesWithinTolerance).toEqual([['layout S-desktop', IMAGE_TOLERANCE_PX]]);
    const beyond = await diffFingerprints(fp('a', { packets: packet(base, '1') }), fp('b', { packets: packet(far, '3') }));
    expect(beyond.differences.map((x) => x.section)).toEqual(['layout packet images']);
  });

  it('keeps durations out of error text', () => {
    expect(withoutDurations('locator.click: Timeout 10000ms exceeded.')).toBe('locator.click: Timeout exceeded.');
    expect(withoutDurations('Shown after 700 ms')).toBe('Shown after 700 ms');
  });
});
