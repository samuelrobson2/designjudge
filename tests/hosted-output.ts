import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

interface Route {
  src?: string;
  dest?: string;
  status?: number;
  headers?: Record<string, string>;
  continue?: boolean;
  handle?: string;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.csv': 'text/csv; charset=utf-8',
};

export const LOGIN_COOKIE = '_vercel_jwt';

// Serves a hosted build (.vercel/output) the way Vercel applies its config.json routes, without
// the ratings function. `protect` stands in for Vercel Authentication on deployment URLs: every
// request without the SameSite=Lax login cookie is sent to a login page.
export async function serveBuildOutput(out: string, opts: { protect?: boolean } = {}): Promise<{ base: string; close: () => void }> {
  const routes: Route[] = JSON.parse(fs.readFileSync(path.join(out, 'config.json'), 'utf8')).routes;
  const root = path.join(out, 'static');
  const fileAt = (p: string) => {
    const file = path.join(root, decodeURIComponent(p), p.endsWith('/') ? 'index.html' : '');
    return file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (opts.protect && !(req.headers.cookie ?? '').includes(`${LOGIN_COOKIE}=`)) {
      res.writeHead(302, { location: `/login?next=${encodeURIComponent(url.pathname)}` }).end();
      return;
    }
    const headers: Record<string, string> = {};
    const send = (file: string | null) => {
      if (!file) return void res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      res.writeHead(200, { ...headers, 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
    };
    for (const r of routes) {
      if (r.handle === 'filesystem') {
        const file = fileAt(url.pathname);
        if (file) return send(file);
        continue;
      }
      const m = url.pathname.match(new RegExp(r.src!));
      if (!m) continue;
      const fill = (s: string) => s.replace(/\$(\d+)/g, (_, i) => m[Number(i)] ?? '');
      if (r.status && r.status >= 300 && r.status < 400) {
        res.writeHead(r.status, { location: fill(r.headers?.Location ?? r.headers?.location ?? '/') }).end();
        return;
      }
      if (r.headers) Object.assign(headers, r.headers);
      if (r.dest) {
        const dest = fill(r.dest).split('?')[0];
        if (dest.startsWith('/api/')) return void res.writeHead(r.status ?? 501, { 'content-type': 'application/json' }).end('{"error":"Not served in tests"}');
        return send(fileAt(dest));
      }
      if (!r.continue) break;
    }
    send(null);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}
