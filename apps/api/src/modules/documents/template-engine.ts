/**
 * A tiny, SAFE template engine for printable documents (receipt, invoice, quote). Staff can edit the templates, so it is
 * deliberately not a general-purpose language:
 *   {{path}}                     value, ALWAYS HTML-escaped (there is no raw/triple-brace form)
 *   {{#each list}} … {{/each}}   repeat for each item; inside, {{field}} reads the item first, then the document; {{@index}}
 *   {{#if path}} … {{else}} … {{/if}}
 * No expressions, no function calls, no property access beyond plain data: a template cannot run code or reach internals.
 */
type Node = { t: 'text'; v: string } | { t: 'var'; path: string } | { t: 'each'; path: string; body: Node[] } | { t: 'if'; path: string; yes: Node[]; no: Node[] };

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);

const SAFE_PATH = /^(@index|[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*)$/;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

export function parseTemplate(src: string): Node[] {
  const tokens = src.split(/(\{\{[^{}]*\}\})/g);
  const root: Node[] = [];
  const stack: { node: Node & { t: 'each' | 'if' }; target: Node[]; inElse: boolean }[] = [];
  let cur = root;
  for (const tok of tokens) {
    const m = /^\{\{\s*([^{}]*?)\s*\}\}$/.exec(tok);
    if (!m) { if (tok) cur.push({ t: 'text', v: tok }); continue; }
    const body = m[1];
    if (body.startsWith('#each ')) { const node: Node = { t: 'each', path: body.slice(6).trim(), body: [] }; check(node.path); cur.push(node); stack.push({ node, target: cur, inElse: false }); cur = node.body; }
    else if (body.startsWith('#if ')) { const node: Node = { t: 'if', path: body.slice(4).trim(), yes: [], no: [] }; check(node.path); cur.push(node); stack.push({ node, target: cur, inElse: false }); cur = node.yes; }
    else if (body === 'else') { const top = stack[stack.length - 1]; if (!top || top.node.t !== 'if' || top.inElse) throw new Error('{{else}} without matching {{#if}}'); top.inElse = true; cur = top.node.no; }
    else if (body === '/each' || body === '/if') { const top = stack.pop(); if (!top || top.node.t !== (body === '/each' ? 'each' : 'if')) throw new Error(`Unexpected {{${body}}}`); cur = top.target; }
    else if (body.startsWith('{') || body.startsWith('&')) throw new Error('Raw output is not supported');
    else { check(body); cur.push({ t: 'var', path: body }); }
  }
  if (stack.length) throw new Error('Unclosed block in template');
  return root;
}
function check(path: string) {
  if (!SAFE_PATH.test(path) || path.split('.').some((p) => FORBIDDEN.has(p))) throw new Error(`Invalid template path: ${path}`);
}

type Scope = { data: unknown; index?: number; parent?: Scope };
function lookup(path: string, scope: Scope): unknown {
  if (path === '@index') return scope.index;
  const [head, ...rest] = path.split('.');
  for (let s: Scope | undefined = scope; s; s = s.parent) {
    const d = s.data;
    if (d && typeof d === 'object' && Object.prototype.hasOwnProperty.call(d, head)) return rest.reduce<unknown>((o, k) => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined), (d as Record<string, unknown>)[head]);
  }
  return undefined;
}
const truthy = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v && v !== '0');

function run(nodes: Node[], scope: Scope): string {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') out += n.v;
    else if (n.t === 'var') out += escapeHtml(lookup(n.path, scope));
    else if (n.t === 'if') out += run(truthy(lookup(n.path, scope)) ? n.yes : n.no, scope);
    else { const list = lookup(n.path, scope); if (Array.isArray(list)) list.slice(0, 1000).forEach((item, i) => (out += run(n.body, { data: item, index: i, parent: scope }))); }
  }
  return out;
}

export const renderHtml = (template: string, data: Record<string, unknown>) => run(parseTemplate(template), { data });
