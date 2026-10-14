import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectFunctional } from '../src/collect/functional.ts';
import { collectHover } from '../src/collect/hover.ts';
import type { FunctionalProbe, HoverProbe } from '../src/collect/probeTypes.ts';
import { serveTimingFixture, type FixtureServer } from '../src/determinism/fixture.ts';
import { choiceEffect, dependentActions, dialogBehaviour, savedPersistence } from '../src/diagnostics/functionality/checks.ts';
import { hoverOnly } from '../src/diagnostics/visual_system/availability.ts';
import { closeBrowser, getBrowser } from './helpers.ts';

// tests/fixtures/behaviour/index.html holds a case that each behaviour check should report and
// one it should not.
let server: FixtureServer;
let dir: string;
let probe: FunctionalProbe;
let hover: HoverProbe;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-behaviour-'));
  server = await serveTimingFixture('behaviour');
  const browser = await getBrowser();
  probe = await collectFunctional(browser, server.url, new URL(server.url).origin, 'desktop', null, [], path.join(dir, 'bundle'));
  hover = await collectHover(browser, server.url, null, path.join(dir, 'bundle'));
}, 240_000);

afterAll(async () => {
  await server?.close();
  await closeBrowser();
  fs.rmSync(dir, { recursive: true, force: true });
});

const items = (m: Map<string, { items: { summary: string }[] }>) => [...m.values()].flatMap((r) => r.items.map((i) => i.summary));

describe('Behaviour trials on the behaviour fixture', () => {
  it('reports the filter that does nothing, not the one that filters later or options waiting to be applied', () => {
    expect(probe.error).toBeUndefined();
    const found = items(choiceEffect(probe));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('in the "Size" group changes nothing beyond the option itself');
  });

  it('reports the action two selections make available that does nothing, not the one that responds', () => {
    const found = items(dependentActions(probe));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('"Merge batches" button appears');
    expect(probe.flows!.map((f) => f.control.name)).toContain('Compare');
  });

  it('reports the saved count a reload loses, not the stored one or a control that reports nothing', () => {
    const found = items(savedPersistence(probe));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('"Bookmarks 0"');
    expect(probe.persistence!.find((p) => p.claim === 'count' && /Saved/.test(p.claimText ?? ''))?.persisted).toBe(true);
  });

  it('reports the modal that cannot be closed, lets Tab out and scrolls away, and passes the others', () => {
    const found = items(dialogBehaviour(probe));
    expect(found).toEqual([expect.stringContaining('The modal dialog "Help"')]);
    expect(found[0]).toContain('neither Escape nor any close control inside it closes it');
    expect(found[0]).toContain('Tab moves focus out of it');
    expect(found[0]).toContain('carries the dialog out of place');
    const byName = new Map(probe.dialogs!.map((d) => [d.name, d]));
    expect(byName.get('Settings')).toMatchObject({ modal: true, escape: true, tabEscape: null, backgroundScrolls: false });
    expect(byName.get('About')).toMatchObject({ kind: 'native', modal: true, backgroundScrolls: true, movesWithPage: false });
    expect(byName.get('Notes')).toMatchObject({ modal: false, openerCloses: true });
  });

  it('reports content only a pointer shows, not content focus also shows or a tooltip repeating its label', () => {
    const found = items(new Map([['desktop', hoverOnly(hover, null)]]));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('"Tile one"');
    expect(hover.reveals.find((r) => r.revealed.text === 'Share')?.repeatsName).toBe(true);
  });
});
