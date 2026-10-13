// Static interfaces as self-contained pages for the hosted site. The rating page shows them in a
// sandboxed frame, whose own requests carry no cookies (and need CORS), so behind a login such as
// Vercel Authentication anything the page fetched separately would fail. Stylesheets, scripts and
// other local files are inlined, so the frame's one request is the page itself.

import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const DATA_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

// A reference to a file next to the page; external, in-page and data references are left alone.
const isLocal = (ref: string) => ref.trim() !== '' && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref.trim());

function localFile(ref: string, dir: string, root: string): string {
  const clean = decodeURIComponent(ref.trim().split(/[?#]/)[0]);
  const file = clean.startsWith('/') ? path.join(root, clean) : path.resolve(dir, clean);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) throw new Error(`${ref} (from ${path.relative(root, dir) || '.'}) is not a file in the site`);
  return file;
}

function dataUri(file: string): string {
  const type = DATA_TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`Cannot inline ${path.basename(file)}: unknown file type`);
  return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

function inlineCss(file: string, root: string): string {
  const css = fs.readFileSync(file, 'utf8');
  if (/@import\b/i.test(css)) throw new Error(`${path.relative(root, file)}: @import cannot be inlined`);
  const out = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _q, ref: string) =>
    isLocal(ref) ? `url("${dataUri(localFile(ref, path.dirname(file), root))}")` : whole,
  );
  if (/<\/style/i.test(out)) throw new Error(`${path.relative(root, file)} contains </style`);
  return out;
}

async function inlineScript(file: string, module: boolean, root: string): Promise<string> {
  let code: string;
  if (module) {
    const result = await build({
      entryPoints: [file],
      absWorkingDir: root,
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'esnext',
      charset: 'utf8',
      logLevel: 'silent',
      loader: Object.fromEntries(Object.keys(DATA_TYPES).map((ext) => [ext, 'dataurl' as const])),
    });
    code = result.outputFiles[0].text;
  } else {
    code = fs.readFileSync(file, 'utf8');
  }
  if (/<\/script/i.test(code)) throw new Error(`${path.relative(root, file)} contains </script`);
  return code;
}

async function inlinePage(file: string, root: string): Promise<string> {
  const dir = path.dirname(file);
  let html = fs.readFileSync(file, 'utf8');
  if (/\ssrcset\s*=/i.test(html)) throw new Error(`${path.relative(root, file)}: srcset cannot be inlined`);

  // Images, video posters and the like; links to other pages stay requests of their own.
  html = html.replace(/<(?!(?:a|link|script)\b)([a-z][\w-]*)\b[^>]*>/gi, (tag) =>
    tag.replace(/(\s(?:src|poster|href)\s*=\s*)(["'])([^"']*)\2/gi, (whole, pre: string, q: string, ref: string) =>
      isLocal(ref) ? `${pre}${q}${dataUri(localFile(ref, dir, root))}${q}` : whole,
    ),
  );

  const styles = new Map<string, string>();
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const href = attr(tag, 'href');
    if (!href || !isLocal(href)) continue;
    if ((attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) {
      const media = attr(tag, 'media');
      styles.set(tag, `<style${media ? ` media="${media}"` : ''}>\n${inlineCss(localFile(href, dir, root), root)}</style>`);
    } else {
      styles.set(tag, tag.replace(href, dataUri(localFile(href, dir, root))));
    }
  }
  html = html.replace(/<link\b[^>]*>/gi, (tag) => styles.get(tag) ?? tag);

  const scripts = new Map<string, string>();
  for (const [tag, attrs] of html.matchAll(/<script\b([^>]*)>\s*<\/script>/gi)) {
    const src = attr(tag, 'src');
    if (!src || !isLocal(src) || scripts.has(tag)) continue;
    const module = (attr(tag, 'type') ?? '').toLowerCase() === 'module';
    const kept = attrs.replace(/\s(src|defer|async|crossorigin|integrity)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
    scripts.set(tag, `<script${kept}>\n${await inlineScript(localFile(src, dir, root), module, root)}</script>`);
  }
  return html.replace(/<script\b[^>]*>\s*<\/script>/gi, (tag) => scripts.get(tag) ?? tag);
}

// Writes each HTML page of the site at `src` to `dest`, self-contained. Other files are not copied.
export async function writeInlinedSite(src: string, dest: string): Promise<string[]> {
  const root = path.resolve(src);
  const pages = (fs.readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.html'));
  if (!pages.includes('index.html')) throw new Error(`${src} has no index.html`);
  for (const page of pages) {
    const out = path.join(dest, page);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, await inlinePage(path.join(root, page), root));
  }
  return pages;
}
