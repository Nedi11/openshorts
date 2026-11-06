// The caption editor's options (SubtitleModal styleOptions) as /api/subtitle
// style fields (app.CAPTION_STYLE_FIELDS). One mapping for a single clip, the
// apply-to-all loop and the saved default (STYLE-001).
export function captionFields(options) {
    return {
        position: options.position,
        font_size: options.fontSize,
        bold: options.bold ?? true,
        highlight_enabled: options.highlightEnabled ?? true,
        horizontal_padding: options.horizontalPadding ?? 6.17,
        font_name: options.fontName,
        font_color: options.fontColor,
        border_color: options.borderColor,
        border_width: options.borderWidth,
        bg_color: options.bgColor,
        bg_opacity: options.bgOpacity,
        style: options.style || 'classic',
        highlight_color: options.highlightColor || '#FFD700',
        effect: options.effect || 'none',
        base_opacity: options.baseOpacity ?? 1.0,
        uppercase: options.uppercase || false,
        reveal: options.reveal || false,
        shadow: options.shadow || 0,
        shadow_angle: options.shadowAngle ?? 45,
        shadow_blur: options.shadowBlur ?? 0,
        shadow_color: options.shadowColor || '#000000',
        shadow_opacity: options.shadowOpacity ?? 0.55,
        position_y: options.position === 'custom' ? options.positionY : null,
        max_chars: options.maxChars ?? null,
        max_duration: options.maxDuration ?? null,
    };
}
