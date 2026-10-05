/** Turn dashboard branding into CSS variables. Values are strictly validated: they come from an editable setting. */
const HEX = /^#[0-9a-f]{3,8}$/i;
const FONT = /^[\w\s-]{1,40}$/;
const MAP: Record<string, string> = { primary: '--primary', secondary: '--ring', accent: '--accent', background: '--background', foreground: '--foreground' };

const vars = (c?: Record<string, string>) => Object.entries(c ?? {}).filter(([k, v]) => MAP[k] && HEX.test(v)).map(([k, v]) => `${MAP[k]}:${v}`).join(';');

export function brandingCss(colors: { light?: Record<string, string>; dark?: Record<string, string> }) {
  return `:root{${vars(colors.light)}}.dark{${vars(colors.dark)}}`;
}

export const safeFont = (f?: string) => (f && FONT.test(f) ? f : undefined);
export const fontsHref = (fonts: { heading?: string; body?: string }) => {
  const fams = [...new Set([safeFont(fonts.heading), safeFont(fonts.body)].filter(Boolean))] as string[];
  return fams.length ? `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`).join('&')}&display=swap` : null;
};
