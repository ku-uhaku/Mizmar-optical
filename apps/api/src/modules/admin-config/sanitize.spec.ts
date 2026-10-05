import { cleanTranslations, plainText, richText, SAFE_URL } from './sanitize';

describe('content sanitising', () => {
  it('keeps formatting but removes scripts, handlers and dangerous links', () => {
    const out = richText('<h2 onclick="x()">Title</h2><p>Hi <b>there</b><script>alert(1)</script></p><a href="javascript:alert(1)">bad</a><a href="https://ok.example" target="_blank">ok</a><img src="javascript:x" onerror="y()"><iframe src="https://evil"></iframe>');
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<b>there</b>');
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|iframe/i);
    expect(out).toContain('rel="noopener noreferrer"');
  });
  it('plain text strips every tag', () => { expect(plainText('<b>Hi</b> <i>you</i><script>x</script>')).toBe('Hi you'); });
  it('translations: only known shapes, content is rich, the rest plain', () => {
    const t = cleanTranslations({ ar: { title: '<b>عنوان</b>', content: '<p>نص</p><script>x</script>' }, 'bad locale!': { title: 'x' }, en: { title: 5 } });
    expect(t).toEqual({ ar: { title: 'عنوان', content: '<p>نص</p>' }, en: {} });
    expect(cleanTranslations('nope')).toBeNull();
  });
  it('safe urls', () => {
    for (const u of ['/catalogue', 'https://a.example/x?y=1', 'http://localhost:3000/z']) expect(SAFE_URL.test(u)).toBe(true);
    for (const u of ['javascript:alert(1)', '//evil.example', 'data:text/html,x', 'ftp://x', '/a b', '']) expect(SAFE_URL.test(u)).toBe(false);
  });
});
