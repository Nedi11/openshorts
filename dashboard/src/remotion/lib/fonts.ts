import { staticFile } from "remotion";

/**
 * CSS @font-face declaration for NotoSerif-Bold (bundled locally).
 * Use in components via: <style>{notoSerifFontFace}</style>
 */
export const NOTO_SERIF_FONT_FAMILY = "NotoSerif-Bold";

export const notoSerifFontFace = `
@font-face {
  font-family: '${NOTO_SERIF_FONT_FAMILY}';
  src: url('${staticFile("fonts/NotoSerif-Bold.ttf")}') format('truetype');
  font-weight: 700;
  font-style: normal;
}
`;

/** Montserrat ExtraBold (bundled, SIL OFL): the "pill" hook style's sans. */
export const MONTSERRAT_FONT_FAMILY = "Montserrat-ExtraBold";

export const montserratFontFace = `
@font-face {
  font-family: '${MONTSERRAT_FONT_FAMILY}';
  src: url('${staticFile("fonts/Montserrat-ExtraBold.ttf")}') format('truetype');
  font-weight: 800;
  font-style: normal;
}
`;

/** Anton (bundled, SIL OFL): the condensed hook typeface. */
export const ANTON_FONT_FAMILY = "Anton-Regular";

export const antonFontFace = `
@font-face {
  font-family: '${ANTON_FONT_FAMILY}';
  src: url('${staticFile("fonts/Anton-Regular.ttf")}') format('truetype');
  font-weight: 400;
  font-style: normal;
}
`;

/**
 * TikTok Sans (bundled, SIL OFL, fonts/TikTokSans-OFL.txt): static Regular and
 * Bold instances (opsz 36) of TikTok's variable font, the same files libass
 * and the hook renderer use on the server.
 */
export const TIKTOK_SANS_FONT_FAMILY = "TikTokSans-Static";

export const tiktokSansFontFace = `
@font-face {font-family: '${TIKTOK_SANS_FONT_FAMILY}'; src: url('${staticFile("fonts/TikTokSans-Regular.ttf")}') format('truetype'); font-weight: 400; font-style: normal;}
@font-face {font-family: '${TIKTOK_SANS_FONT_FAMILY}'; src: url('${staticFile("fonts/TikTokSans-Bold.ttf")}') format('truetype'); font-weight: 700; font-style: normal;}
`;

/**
 * Hook typefaces: CSS family + share of the 90% box width used as font size.
 * Must mirror hooks.py HOOK_FONTS.
 */
export const HOOK_FONTS: Record<string, { family: string; weight: number; factor: number }> = {
  montserrat: { family: `'${MONTSERRAT_FONT_FAMILY}', 'Montserrat', sans-serif`, weight: 800, factor: 0.064 },
  anton: { family: `'${ANTON_FONT_FAMILY}', Impact, sans-serif`, weight: 400, factor: 0.08 },
  serif: { family: `'${NOTO_SERIF_FONT_FAMILY}', 'Noto Serif', Georgia, serif`, weight: 700, factor: 0.05 },
  tiktok: { family: `'${TIKTOK_SANS_FONT_FAMILY}', 'TikTok Sans', sans-serif`, weight: 700, factor: 0.07 },
};

/**
 * Map of subtitle font families to their CSS-safe names.
 * These match the options available in SubtitleModal.jsx.
 */
export const SUBTITLE_FONTS: Record<string, string> = {
  Verdana: "Subtitle-Sans, sans-serif",
  Arial: "Subtitle-Sans, sans-serif",
  Impact: `'${ANTON_FONT_FAMILY}', sans-serif`,
  Helvetica: "Subtitle-Sans, sans-serif",
  Georgia: "Subtitle-Serif, serif",
  "Courier New": "Subtitle-Mono, monospace",
  Anton: `'${ANTON_FONT_FAMILY}', Impact, sans-serif`,
  "Montserrat ExtraBold": `'${MONTSERRAT_FONT_FAMILY}', 'Montserrat', sans-serif`,
  "TikTok Sans": `'${TIKTOK_SANS_FONT_FAMILY}', sans-serif`,
};

export function getFontStack(fontFamily: string): string {
  return SUBTITLE_FONTS[fontFamily] ?? fontFamily;
}

// Match the server's fontconfig aliases on every browser/OS.
export const liberationFontFaces = ['Sans', 'Serif', 'Mono'].map(name => `
@font-face {font-family: 'Subtitle-${name}'; src: url('${staticFile(`fonts/Liberation${name}-Regular.ttf`)}') format('truetype'); font-weight: 400; font-style: normal;}
@font-face {font-family: 'Subtitle-${name}'; src: url('${staticFile(`fonts/Liberation${name}-Bold.ttf`)}') format('truetype'); font-weight: 700; font-style: normal;}
`).join('');
