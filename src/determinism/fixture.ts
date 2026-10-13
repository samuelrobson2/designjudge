// The synthetic timing page: content that appears after timers, a slow request, transitions and a
// debounced field. /slow?ms=N answers after N ms of real time.

import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { ROOT } from '../config.ts';
import type { CaseManifest } from '../types.ts';

export const FIXTURE_FILE = path.join(ROOT, 'tests/fixtures/timing/index.html');
export const FIXTURE_ID = 'timing-fixture';

export interface FixtureServer {
  url: string;
  origin: string;
  close(): Promise<void>;
}

export async function serveTimingFixture(): Promise<FixtureServer> {
  const html = fs.readFileSync(FIXTURE_FILE);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://fixture');
    if (u.pathname === '/slow') {
      const ms = Math.min(Number(u.searchParams.get('ms') ?? 400) || 0, 5000);
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
        res.end('Loaded from the slow server');
      }, ms);
      return;
    }
    if (u.pathname === '/' || u.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: `${origin}/`,
    origin,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function fixtureManifest(url: string): CaseManifest {
  return {
    id: FIXTURE_ID,
    title: 'Timing fixture',
    request: 'A test page whose content, styles and field values change after delays.',
    source: { type: 'url', url },
  };
}
