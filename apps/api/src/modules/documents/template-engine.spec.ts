import { escapeHtml, parseTemplate, renderHtml } from './template-engine';
import { DEFAULT_TEMPLATES } from './default-templates';

describe('template engine', () => {
  it('substitutes values and ESCAPES them (customer names can contain markup)', () => {
    const out = renderHtml('<p>{{name}}</p>', { name: '<img src=x onerror=alert(1)>"&\'`' });
    expect(out).toBe('<p>&lt;img src=x onerror=alert(1)&gt;&quot;&amp;&#39;&#96;</p>');
    expect(out).not.toContain('<img');
  });
  it('reads nested paths and renders missing values as empty', () => {
    expect(renderHtml('{{a.b.c}}|{{a.x}}|{{nope}}', { a: { b: { c: 7 } } })).toBe('7||');
  });
  it('#each repeats, exposes @index, and falls back to document-level values', () => {
    expect(renderHtml('{{#each items}}[{{@index}}:{{n}}/{{cur}}]{{/each}}', { cur: 'MAD', items: [{ n: 'a' }, { n: 'b' }] })).toBe('[0:a/MAD][1:b/MAD]');
  });
  it('#if / else treat empty list, 0, "", null as false', () => {
    const t = '{{#if x}}yes{{else}}no{{/if}}';
    for (const falsy of [0, '', null, undefined, [], '0']) expect(renderHtml(t, { x: falsy })).toBe('no');
    for (const truthy of [1, 'a', [1], { a: 1 }]) expect(renderHtml(t, { x: truthy })).toBe('yes');
  });
  it('blocks nest', () => {
    expect(renderHtml('{{#each a}}{{#if show}}{{v}}{{/if}}{{/each}}', { a: [{ show: 1, v: 'x' }, { show: 0, v: 'y' }, { show: 1, v: 'z' }] })).toBe('xz');
  });
  it('cannot reach prototypes or run code', () => {
    expect(() => parseTemplate('{{__proto__.polluted}}')).toThrow();
    expect(() => parseTemplate('{{constructor.constructor}}')).toThrow();
    expect(() => parseTemplate('{{a.b()}}')).toThrow();
    expect(renderHtml('{{{raw}}}', { raw: '<b>x</b>' })).toBe('{&lt;b&gt;x&lt;/b&gt;}'); // triple braces are NOT a raw escape hatch: still escaped
    expect(() => parseTemplate('{{&raw}}')).toThrow();
    expect(renderHtml('{{toString}}{{hasOwnProperty}}', {})).toBe(''); // inherited members are invisible
  });
  it('rejects malformed templates', () => {
    for (const bad of ['{{#each a}}x', '{{/if}}', '{{else}}', '{{#if a}}{{/each}}']) expect(() => parseTemplate(bad)).toThrow();
  });
  it('escapeHtml handles numbers, null and undefined', () => expect([escapeHtml(5), escapeHtml(null), escapeHtml(undefined)]).toEqual(['5', '', '']));
  it('all built-in templates parse', () => {
    for (const t of Object.values(DEFAULT_TEMPLATES)) expect(() => parseTemplate(t.html)).not.toThrow();
  });
  it('a rendered built-in invoice never contains an unescaped customer-controlled tag', () => {
    const html = renderHtml(DEFAULT_TEMPLATES.INVOICE.html, { lang: 'fr', dir: 'ltr', labels: {}, doc: { number: 'F-1' }, store: { name: '<b>S</b>' }, customer: { name: '<script>alert(1)</script>' }, lines: [{ description: '<svg onload=x>' }], payments: [], totals: {}, legal: {} });
    expect(html).not.toMatch(/<script>alert|<svg onload|<b>S<\/b>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
