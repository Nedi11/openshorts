// libass uses PlayResY=288 and the font OS/2 Windows ascent + descent.
// Ratios come from the exact bundled fonts, rather than a single Anton scale.
export const ASS_SCALE = 1920 / 288;
const RATIOS = {Anton: 2048/3550, Impact: 2048/3550,
  'Montserrat ExtraBold': 1000/1562, Georgia: 2048/2268,
  'Courier New': 2048/2320};
export function subtitleFontPixels(size, font) {
  const assSize = Math.max(10, Math.trunc(Math.min(200, Math.max(10, size)) * .85));
  return assSize * ASS_SCALE * (RATIOS[font] ?? 2048/2288);
}

// CSS stroke is centered on the glyph edge, so twice the ASS radius is needed.
// Paint the fill last to keep thick outlines from swallowing the letters.
export function subtitleOutline(radius, color) {
  return {WebkitTextStroke: `${Math.max(0, radius) * 2}px ${color}`, paintOrder: 'stroke fill'};
}
