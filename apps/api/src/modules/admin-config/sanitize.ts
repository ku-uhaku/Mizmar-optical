import sanitizeHtml from 'sanitize-html';

/** Rich text written in the dashboard (pages, posts, emails) is cleaned on the way IN, so the website can render it as-is. */
const RICH: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'figure', 'figcaption', 'code', 'pre'],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height', 'loading'], '*': ['class'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  transformTags: { a: (tag, attribs) => ({ tagName: 'a', attribs: { ...attribs, ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}) } }) },
};

export const richText = (html: unknown): string => sanitizeHtml(String(html ?? ''), RICH);
export const plainText = (s: unknown): string => sanitizeHtml(String(s ?? ''), { allowedTags: [], allowedAttributes: {} }).trim();

/** `translations[locale][field]`: strings only; fields named `content` keep rich text, everything else becomes plain text. */
export function cleanTranslations(t: unknown): Record<string, Record<string, string>> | null {
  if (!t || typeof t !== 'object') return null;
  const out: Record<string, Record<string, string>> = {};
  for (const [locale, fields] of Object.entries(t as Record<string, unknown>)) {
    if (!/^[a-z]{2,3}$/.test(locale) || !fields || typeof fields !== 'object') continue;
    out[locale] = {};
    for (const [k, v] of Object.entries(fields as Record<string, unknown>)) if (typeof v === 'string' && v.length <= 50_000 && /^\w{1,40}$/.test(k)) out[locale][k] = k === 'content' ? richText(v) : plainText(v);
  }
  return out;
}

/** Same-site path or http(s) URL: never javascript: or data:. */
export const SAFE_URL = /^(\/(?!\/)|https?:\/\/)[^\s<>"'`]*$/;
