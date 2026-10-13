import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeInlinedSite } from '../src/hosted/inline.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function site(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-inline-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, 'src', name)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', name), text);
  }
  return { src: path.join(dir, 'src'), out: path.join(dir, 'out') };
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

describe('Self-contained hosted interfaces', () => {
  it('inlines stylesheets, module and classic scripts, and local images, and leaves other references alone', async () => {
    const s = site({
      'index.html': `<!doctype html><link rel="stylesheet" href="css/styles.css" /><link rel="icon" href="logo.svg" />
<a href="#main">Skip</a><a href="other.html">Other</a><a href="tel:123">Call</a><img src="logo.svg" alt="" /><img src="https://example.com/x.png" alt="" />
<script src="classic.js"></script><script type="module" src="app.js"></script>`,
      'css/styles.css': 'body { background: url("../logo.svg") } .x { background: url(#paint) }',
      'app.js': "import { n } from './data.js';\ndocument.body.dataset.n = String(n);",
      'data.js': 'export const n = 2;',
      'classic.js': 'var shared = 1;',
      'logo.svg': SVG,
      'other.html': '<!doctype html><p>Other</p>',
    });
    expect((await writeInlinedSite(s.src, s.out)).sort()).toEqual(['index.html', 'other.html']);
    expect(fs.readdirSync(s.out).sort()).toEqual(['index.html', 'other.html']);
    const html = fs.readFileSync(path.join(s.out, 'index.html'), 'utf8');
    const uri = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`;
    expect(html).toContain(`<style>\nbody { background: url("${uri}") } .x { background: url(#paint) }</style>`);
    expect(html).toContain(`<link rel="icon" href="${uri}" />`);
    expect(html).toContain(`<img src="${uri}" alt="" />`);
    expect(html).toContain('<img src="https://example.com/x.png" alt="" />');
    expect(html).toContain('<a href="other.html">Other</a>');
    expect(html).toContain('<script>\nvar shared = 1;</script>');
    expect(html).toMatch(/<script type="module">\n\/\/ data\.js\n(?:var|const) n = 2;\n\n\/\/ app\.js\ndocument\.body\.dataset\.n = String\(n\);\n<\/script>/);
    expect(html).not.toMatch(/\ssrc="(?:app|classic|data)\.js"|href="css\//);
  });

  it('refuses what it cannot inline, rather than leaving a request that fails behind a login', async () => {
    await expect(writeInlinedSite(site({ 'index.html': '<img src="missing.png" />' }).src, path.join(os.tmpdir(), 'unused'))).rejects.toThrow(/missing\.png/);
    await expect(writeInlinedSite(site({ 'index.html': '<link rel="stylesheet" href="a.css">', 'a.css': '@import "b.css";' }).src, path.join(os.tmpdir(), 'unused'))).rejects.toThrow(/@import/);
    await expect(writeInlinedSite(site({ 'index.html': '<img srcset="a.png 2x" />' }).src, path.join(os.tmpdir(), 'unused'))).rejects.toThrow(/srcset/);
  });
});
