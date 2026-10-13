import type { Bundle, StateRecord } from '../src/types.ts';

export function state(id: string, kind: StateRecord['kind'], viewportId: StateRecord['viewportId'], extra: Partial<StateRecord> = {}): StateRecord {
  const viewport = viewportId === 'mobile' ? { width: 390, height: 844, dpr: 1, isMobile: true } : { width: 1440, height: 900, dpr: 1, isMobile: false };
  return {
    id,
    kind,
    label: id,
    viewportId,
    viewport,
    fixture: null,
    status: 'collected',
    files: {},
    screenshots: [
      { id: `S-${id}-viewport`, kind: 'viewport', path: `states/${id}/viewport.png`, width: viewport.width, height: viewport.height, scale: 1, scrollY: 0, docHeight: viewport.height * 2 },
      { id: `S-${id}-full`, kind: 'full', path: `states/${id}/full.png`, width: viewport.width, height: viewport.height * 2, scale: 1, scrollY: 0, docHeight: viewport.height * 2 },
    ],
    consoleErrors: [],
    network: { external: [], failed: [] },
    ...extra,
  };
}

export function syntheticBundle(states: StateRecord[]): Bundle {
  return {
    schemaVersion: 1,
    bundleId: 'b',
    caseId: 'c',
    interfaceId: 'iface-test',
    createdAt: '',
    collectorVersion: '',
    browser: { name: 'chromium', version: '' },
    request: 'A booking page for a dental clinic.',
    inputsHash: '',
    config: { viewports: {}, sweepWidths: [], sweepHeight: 0, settle: {}, fixedTime: '' },
    fixtures: { supported: ['empty'] },
    coverage: [],
    states,
    sweep: null,
  } as Bundle;
}
