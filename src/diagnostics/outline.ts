// The accessibility outline of a state (states/<id>/aria.yml, Playwright's aria snapshot) as a
// tree: each node's role, accessible name, attributes ([checked], [level=2]) and own text.

import fs from 'node:fs';
import path from 'node:path';
import { bundleDir } from '../store.ts';
import type { Bundle, StateRecord } from '../types.ts';

export interface OutlineNode {
  role: string;
  name: string | null;
  attrs: Record<string, string | true>;
  text: string | null;
  children: OutlineNode[];
  parent: OutlineNode | null;
  depth: number;
}

function unquote(v: string): string {
  const t = v.trim();
  if (/^".*"$/.test(t)) return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

export function parseOutline(raw: string): OutlineNode {
  const root: OutlineNode = { role: 'root', name: null, attrs: {}, text: null, children: [], parent: null, depth: -1 };
  const stack = [root];
  for (const line of raw.split('\n')) {
    const body0 = line.trim();
    if (!body0.startsWith('- ')) continue;
    const indent = line.length - line.trimStart().length;
    const body = body0.slice(2);
    let key = body;
    let value: string | null = null;
    if (body.startsWith("'")) {
      // A single-quoted key ('' escapes a quote).
      let i = 1;
      for (; i < body.length; i++) {
        if (body[i] === "'" && body[i + 1] === "'") i++;
        else if (body[i] === "'") break;
      }
      key = body.slice(1, i).replace(/''/g, "'");
      const rest = body.slice(i + 1);
      if (rest.startsWith(':')) value = rest.slice(1).trim() || null;
    } else {
      // The key ends at the first ': ' outside double quotes.
      let inQuote = false;
      for (let i = 0; i < body.length; i++) {
        if (body[i] === '\\') {
          i++;
          continue;
        }
        if (body[i] === '"') inQuote = !inQuote;
        else if (body[i] === ':' && !inQuote && (i === body.length - 1 || body[i + 1] === ' ')) {
          key = body.slice(0, i);
          value = body.slice(i + 1).trim() || null;
          break;
        }
      }
    }
    const m = key.match(/^([\w/-]+)(?:\s+"((?:[^"\\]|\\.)*)")?((?:\s*\[[^\]]*\])*)\s*$/);
    const attrs: Record<string, string | true> = {};
    if (m?.[3]) for (const a of m[3].matchAll(/\[([^\]=]+)(?:=([^\]]*))?\]/g)) attrs[a[1].trim()] = a[2] ?? true;
    const node: OutlineNode = {
      role: m ? m[1] : key,
      name: m && m[2] !== undefined ? m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : null,
      attrs,
      text: value !== null ? unquote(value) : null,
      children: [],
      parent: null,
      depth: indent / 2,
    };
    while (stack.length > 1 && stack[stack.length - 1].depth >= node.depth) stack.pop();
    node.parent = stack[stack.length - 1];
    node.parent.children.push(node);
    stack.push(node);
  }
  return root;
}

export function loadOutline(bundle: Bundle, state: StateRecord): OutlineNode | null {
  if (!state.files.aria) return null;
  const file = path.join(bundleDir(bundle.caseId, bundle.bundleId), state.files.aria);
  return fs.existsSync(file) ? parseOutline(fs.readFileSync(file, 'utf8')) : null;
}

export function* walk(node: OutlineNode): Generator<OutlineNode> {
  for (const c of node.children) {
    yield c;
    yield* walk(c);
  }
}

export function ancestors(node: OutlineNode): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (let p = node.parent; p && p.role !== 'root'; p = p.parent) out.push(p);
  return out;
}

// The words a node shows: its own text, or its name when nothing below spells it out, and its
// descendants' words. Link targets and placeholders are not shown words.
export function nodeText(node: OutlineNode): string {
  const parts: string[] = [];
  const add = (n: OutlineNode) => {
    if (n.role === '/url' || n.role === '/placeholder') return;
    if (n.text) parts.push(n.text);
    else if (n.name && !n.children.length) parts.push(n.name);
    for (const c of n.children) add(c);
  };
  add(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// A node's label: its name, else its own text, else the words below it.
export function nodeLabel(node: OutlineNode): string {
  return (node.name ?? node.text ?? nodeText(node)).replace(/\s+/g, ' ').trim();
}

export const isOn = (v: string | true | undefined) => v !== undefined && v !== 'false';
