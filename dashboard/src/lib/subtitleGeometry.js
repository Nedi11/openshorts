// libass uses PlayResY=288 and the font OS/2 Windows ascent + descent.
// Ratios come from the exact bundled fonts, rather than a single Anton scale.
export const ASS_SCALE = 1920 / 288;
const RATIOS = {Anton: 2048/3550, Impact: 2048/3550,
  'Montserrat ExtraBold': 1000/1562, Georgia: 2048/2268,
  'Courier New': 2048/2320};
export function subtitleFontPixels(size, font) {
  const assSize = Math.trunc(Math.min(200, Math.max(6, size)) * .85);
  return assSize * ASS_SCALE * (RATIOS[font] ?? 2048/2288);
}

// CSS stroke is centered on the glyph edge, so twice the ASS radius is needed.
// Paint the fill last to keep thick outlines from swallowing the letters.
export function subtitleOutline(radius, color) {
  return {WebkitTextStroke: `${Math.max(0, radius) * 2}px ${color}`, paintOrder: 'stroke fill'};
}

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

// Mirrors subtitles.shadow_layer_tags: depth is per-axis units at 45 degrees
// (depth * sqrt 2 along the angle). libass \blur is a Gaussian whose radius
// reads as about twice the value, the CSS blur radius scale.
export function subtitleShadowCss({shadow, shadowAngle = 45, shadowBlur = 0, shadowColor = '#000000', shadowOpacity = 0.55} = {}) {
  const depth = clamp(shadow, 0, 10, 0);
  const blur = clamp(shadowBlur, 0, 10, 0);
  if (depth <= 0 && blur <= 0) return '';
  const rad = clamp(shadowAngle, -360, 360, 45) * Math.PI / 180;
  const dx = depth * Math.SQRT2 * Math.cos(rad) * ASS_SCALE;
  const dy = depth * Math.SQRT2 * Math.sin(rad) * ASS_SCALE;
  const hex = /^#?([0-9a-f]{6})$/i.exec(shadowColor || '')?.[1] ?? '000000';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = clamp(shadowOpacity, 0, 1, 0.55);
  return `${dx.toFixed(1)}px ${dy.toFixed(1)}px ${(blur * 2 * ASS_SCALE).toFixed(1)}px rgba(${r},${g},${b},${a})`;
}

// Mirrors subtitles.custom_margin_v: bottom edge, % of the height above the bottom.
export function customCaptionBottom(positionY) {
  return Math.round(288 * clamp(positionY, 0, 90, 43 / 288 * 100) / 100) / 288 * 100;
}

// Percent offsets of each preset, to seed the custom sliders from the preset in use.
export const CAPTION_PRESET_Y = {top: 75, middle: 45, bottom: 43 / 288 * 100};
// Hook custom Y is % of the free travel, so these only approximate the presets.
export const HOOK_PRESET_Y = {auto: 22, top: 22, center: 50, bottom: 78};
