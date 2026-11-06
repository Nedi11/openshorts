import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import RemotionPreview from './RemotionPreview';
import Modal from './ui/Modal';
import { ASS_SCALE, subtitleFontPixels, subtitleOutline, CAPTION_PRESET_Y, customCaptionBottom } from '../lib/subtitleGeometry';
import SegmentedControl from './ui/SegmentedControl';

const FONT_OPTIONS = [
    { value: 'Anton', label: 'Anton' },
    { value: 'Montserrat ExtraBold', label: 'Montserrat' },
    { value: 'Verdana', label: 'Verdana' },
    { value: 'Arial', label: 'Arial' },
    { value: 'Impact', label: 'Impact' },
    { value: 'Helvetica', label: 'Helvetica' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Courier New', label: 'Courier New' },
];

const COLOR_PRESETS = [
    { color: '#FFFFFF', label: 'White' },
    { color: '#FFFF00', label: 'Yellow' },
    { color: '#00FFFF', label: 'Cyan' },
    { color: '#00FF00', label: 'Green' },
    { color: '#FF0000', label: 'Red' },
    { color: '#FF69B4', label: 'Pink' },
];

const HIGHLIGHT_PRESETS = [
    { color: '#FFE500', label: 'Yellow' },
    { color: '#FFDD00', label: 'Gold' },
    { color: '#A3FF12', label: 'Lime' },
    { color: '#7C3AED', label: 'Purple' },
    { color: '#FF4444', label: 'Red' },
    { color: '#00FF88', label: 'Green' },
    { color: '#00BBFF', label: 'Blue' },
    { color: '#FF69B4', label: 'Pink' },
];

const ANIMATION_OPTIONS = [
    { value: 'pop', label: 'Pop' },
    { value: 'word-highlight', label: 'Glow' },
    { value: 'karaoke', label: 'Box' },
    { value: 'none', label: 'None' },
];

// Preview animation -> the effect burned server-side, so what the modal
// plays is what the clip gets. 'karaoke' in the preview is a box behind the
// active word, which is the 'highlight' effect.
const ANIMATION_TO_EFFECT = { pop: 'pop', 'word-highlight': 'glow', karaoke: 'highlight', none: 'none' };
const EFFECT_TO_ANIMATION = { pop: 'pop', glow: 'word-highlight', highlight: 'karaoke', box: 'karaoke', none: 'none' };

// Font size in the units /api/subtitle takes. M is what every clip ships
// with (subtitles.AUTO_CAPTION_STYLE font_size 44), so opening the modal and
// applying never shrinks the captions.
const SIZE_OPTIONS = [
    { value: 16, label: 'Native' },
    { value: 34, label: 'S' },
    { value: 44, label: 'M' },
    { value: 56, label: 'L' },
    { value: 70, label: 'XL' },
];

// Characters per line at size M, per font: Anton is condensed, Montserrat
// wide. Bigger text gets proportionally fewer, so a line still fits the 9:16
// frame instead of wrapping into a wall of text.
const LINE_CHARS = { Anton: 16, 'Montserrat ExtraBold': 9, Impact: 16 };
const lineBudget = (fontName, fontSize, oneWord) =>
    oneWord ? 1 : Math.max(6, Math.round((LINE_CHARS[fontName] || 14) * 44 / fontSize));

const POSITION_OPTIONS = [
    { value: 'top', label: 'top' },
    { value: 'middle', label: 'middle' },
    { value: 'bottom', label: 'bottom' },
    { value: 'custom', label: 'custom' },
];

// Ready-made caption looks burned server-side as karaoke ASS (word highlight):
// dimmed base text + strong active word, optional glow/pop/box effect.
const CAPTION_PRESETS = [
    { id: 'native', label: 'Native clean', style: 'karaoke', effect: 'none', highlightColor: '#FFFFFF', baseOpacity: 1.0, uppercase: false, fontName: 'Arial', borderWidth: 0, shadow: 1, fontSize: 16 },
    // What every clip ships with (subtitles.AUTO_CAPTION_STYLE).
    { id: 'default', label: 'Default',  style: 'karaoke', effect: 'pop',       highlightColor: '#FFE500', baseOpacity: 1.0, uppercase: true,  fontName: 'Anton', borderWidth: 4, fontSize: 44 },
    // Trending short-form looks (2026): word-by-word build-up, a box behind
    // the active word, one big word at a time, and the clean shadow-only look.
    { id: 'hormozi', label: 'Hormozi',  style: 'karaoke', effect: 'pop',       highlightColor: '#FFE500', baseOpacity: 1.0, uppercase: true,  fontName: 'Montserrat ExtraBold', borderWidth: 4, shadow: 2, reveal: true, fontSize: 44 },
    { id: 'pill',    label: 'Pill',     style: 'karaoke', effect: 'highlight', highlightColor: '#7C3AED', baseOpacity: 1.0, uppercase: true,  fontName: 'Montserrat ExtraBold', borderWidth: 3, fontSize: 44 },
    { id: 'oneword', label: 'One word', style: 'karaoke', effect: 'pop',       highlightColor: '#FFFFFF', baseOpacity: 1.0, uppercase: true,  fontName: 'Anton', borderWidth: 5, oneWord: true, fontSize: 70 },
    { id: 'clean',   label: 'Clean',    style: 'karaoke', effect: 'none',      highlightColor: '#FFFFFF', baseOpacity: 0.7, uppercase: false, fontName: 'Montserrat ExtraBold', borderWidth: 0, shadow: 2, fontSize: 34 },
    { id: 'lime',    label: 'Lime box', style: 'karaoke', effect: 'highlight', highlightColor: '#A3FF12', baseOpacity: 1.0, uppercase: true,  fontName: 'Montserrat ExtraBold', borderWidth: 3, fontSize: 44 },
    { id: 'tiktok',  label: 'TikTok',     style: 'karaoke', effect: 'none', highlightColor: '#FE2C55', baseOpacity: 0.75, uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'reels',   label: 'Reels',      style: 'karaoke', effect: 'none', highlightColor: '#E1306C', baseOpacity: 0.7,  uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'shorts',  label: 'Shorts Pop', style: 'karaoke', effect: 'pop',  highlightColor: '#FF0000', baseOpacity: 0.7,  uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'gold',    label: 'Gold Glow',  style: 'karaoke', effect: 'glow', highlightColor: '#FFD700', baseOpacity: 0.6,  uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'neon',    label: 'Neon',       style: 'karaoke', effect: 'glow', highlightColor: '#00FF88', baseOpacity: 0.55, uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'cyber',   label: 'Cyber',      style: 'karaoke', effect: 'glow', highlightColor: '#00FFFF', baseOpacity: 0.5,  uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'karaoke', label: 'Karaoke',    style: 'karaoke', effect: 'none', highlightColor: '#FF6B6B', baseOpacity: 0.6,  uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'minimal', label: 'Minimal',    style: 'karaoke', effect: 'none', highlightColor: '#FFFFFF', baseOpacity: 0.65, uppercase: false, fontName: 'Verdana', borderWidth: 1 },
    { id: 'beast',   label: 'Beast',      style: 'karaoke', effect: 'pop',  highlightColor: '#FFD700', baseOpacity: 1.0,  uppercase: true,  fontName: 'Impact',  borderWidth: 3 },
    { id: 'boxed',   label: 'Boxed',      style: 'karaoke', effect: 'box',  highlightColor: '#7C3AED', baseOpacity: 0.85, uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'classic', label: 'Classic',    style: 'classic', effect: 'none', highlightColor: '#FFD700', baseOpacity: 1.0,  uppercase: false, fontName: 'Verdana', borderWidth: 2 },
];

// Mirrors subtitles._luminance (Rec. 601).
const luminance = (hex) => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
    if (!m) return 1;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

const swatchClass = (selected) =>
    `w-6 h-6 rounded-full transition-all ${selected
        ? 'ring-2 ring-[color:var(--color-accent)] ring-offset-2 ring-offset-[color:var(--color-paper-2)]'
        : 'ring-1 ring-[color:var(--color-rule-2)] hover:ring-[color:var(--color-accent)]'}`;

export default function SubtitleModal({ isOpen, onClose, onGenerate, onApplyAll, onRemove, isProcessing, videoUrl, jobId, clipIndex, existingHook, bulkCount = 0, bulkProgress }) {
    // The defaults cover new clips; saved style and words load when opened.
    const [position, setPosition] = useState('bottom');
    const [fontSize, setFontSize] = useState(44);
    const [fontName, setFontName] = useState('Anton');
    const [fontColor, setFontColor] = useState('#FFFFFF');
    const [highlightColor, setHighlightColor] = useState('#FFE500');
    const [borderColor, setBorderColor] = useState('#000000');
    const [borderWidth, setBorderWidth] = useState(4);
    const [bgColor, setBgColor] = useState('#000000');
    const [bgOpacity, setBgOpacity] = useState(0.0);
    const [animation, setAnimationState] = useState('pop');
    const [showTextEditor, setShowTextEditor] = useState(false);

    // Karaoke (server-side ASS burn) state
    const [style, setStyle] = useState('karaoke'); // classic | karaoke
    const [effect, setEffect] = useState('pop'); // none | glow | pop | box | highlight
    const [baseOpacity, setBaseOpacity] = useState(1.0);
    const [uppercase, setUppercase] = useState(true);
    const [reveal, setReveal] = useState(false);
    const [bold, setBold] = useState(true);
    const [highlightEnabled, setHighlightEnabled] = useState(true);
    const [shadow, setShadow] = useState(0);
    const [shadowAngle, setShadowAngle] = useState(45);
    const [shadowBlur, setShadowBlur] = useState(0);
    const [shadowColor, setShadowColor] = useState('#000000');
    const [shadowOpacity, setShadowOpacity] = useState(0.55);
    // position 'custom': caption bottom edge, % of the height above the bottom.
    const [positionY, setPositionY] = useState(CAPTION_PRESET_Y.bottom);
    const choosePosition = (value) => {
        // Start the custom slider where the preset in use already sits.
        if (value === 'custom' && position !== 'custom') {
            setPositionY(Math.round(CAPTION_PRESET_Y[position] ?? CAPTION_PRESET_Y.bottom));
        }
        setPosition(value);
    };
    const [horizontalPadding, setHorizontalPadding] = useState(6.17);
    const [oneWord, setOneWord] = useState(false);
    const [activePreset, setActivePreset] = useState('default');

    const setAnimation = (value) => {
        setAnimationState(value);
        if (style === 'karaoke') setEffect(ANIMATION_TO_EFFECT[value] || 'none');
    };

    const applyPreset = (p) => {
        setActivePreset(p.id);
        setSavedLineBudget(null);
        setMaxDuration(1.4);
        setStyle(p.style);
        setEffect(p.effect);
        setHighlightColor(p.highlightColor);
        setBaseOpacity(p.baseOpacity);
        setUppercase(p.uppercase);
        setFontName(p.fontName);
        setBorderWidth(p.borderWidth);
        setFontColor('#FFFFFF');
        setBgOpacity(0);
        setReveal(!!p.reveal);
        setShadow(p.shadow || 0);
        setShadowAngle(45);
        setShadowBlur(0);
        setShadowColor('#000000');
        setShadowOpacity(0.55);
        setHighlightEnabled(true);
        setBold(true);
        setOneWord(!!p.oneWord);
        if (p.fontSize) setFontSize(p.fontSize);
        setAnimationState(p.style === 'karaoke' ? (EFFECT_TO_ANIMATION[p.effect] || 'none') : 'none');
    };

    const [savedLineBudget, setSavedLineBudget] = useState(null);
    const maxChars = savedLineBudget ?? Math.max(1, Math.round(lineBudget(fontName, fontSize, oneWord) * (100 - 2 * horizontalPadding) / 87.66));
    // Same block duration as the auto captions (AUTO_CAPTION_STYLE).
    const [maxDuration, setMaxDuration] = useState(1.4);

    // Remotion preview state
    const [captions, setCaptions] = useState([]);
    const [originalCaptions, setOriginalCaptions] = useState([]);
    const [editableText, setEditableText] = useState('');
    const [durationSec, setDurationSec] = useState(30);
    const [captionsLoading, setCaptionsLoading] = useState(false);
    const [captionLoadError, setCaptionLoadError] = useState('');
    const [useRemotionPreview, setUseRemotionPreview] = useState(false);

    // Fetch word-level captions when modal opens
    useEffect(() => {
        if (!isOpen || !jobId || clipIndex === undefined) return;

        let cancelled = false;
        const controller = new AbortController();
        setCaptionsLoading(true);
        setCaptionLoadError('');
        apiFetch(`/api/clip/${jobId}/${clipIndex}/transcript`, { signal: controller.signal })
            .then((res) => {
                if (!res.ok) throw new Error('Could not load saved captions. Reopen the caption editor to retry.');
                return res.json();
            })
            .then((data) => {
                if (cancelled) return;
                const saved = data?.captionStyle;
                if (saved) {
                    setPosition(saved.position || 'bottom');
                    setFontSize(saved.font_size ?? 44);
                    setFontName(saved.font_name || 'Anton');
                    setFontColor(saved.font_color || '#FFFFFF');
                    setBorderColor(saved.border_color || '#000000');
                    setBorderWidth(saved.border_width ?? 4);
                    setBgColor(saved.bg_color || '#000000');
                    setBgOpacity(saved.bg_opacity ?? 0);
                    setStyle(saved.style || 'karaoke');
                    setEffect(saved.effect || 'none');
                    setHighlightColor(saved.highlight_color || '#FFE500');
                    setBaseOpacity(saved.base_opacity ?? 1);
                    setUppercase(saved.uppercase ?? true);
                    setReveal(!!saved.reveal);
                    setShadow(saved.shadow ?? 0);
                    setShadowAngle(saved.shadow_angle ?? 45);
                    setShadowBlur(saved.shadow_blur ?? 0);
                    setShadowColor(saved.shadow_color || '#000000');
                    setShadowOpacity(saved.shadow_opacity ?? 0.55);
                    if (saved.position_y != null) setPositionY(saved.position_y);
                    setBold(saved.bold ?? true);
                    setHighlightEnabled(saved.highlight_enabled ?? true);
                    setHorizontalPadding(saved.horizontal_padding ?? 6.17);
                    setOneWord(saved.max_chars === 1);
                    setSavedLineBudget(saved.max_chars ?? 20);
                    setMaxDuration(saved.max_duration ?? 2.0);
                    setAnimationState(EFFECT_TO_ANIMATION[saved.effect] || 'none');
                    setActivePreset('custom');
                }
                if (data && data.captions && data.captions.length > 0) {
                    setCaptions(data.captions);
                    setOriginalCaptions(data.captions);
                    setEditableText(data.captions.map(c => c.text).join(' '));
                    setDurationSec(data.durationSec || 30);
                    setUseRemotionPreview(true);
                } else {
                    setUseRemotionPreview(false);
                }
            })
            .catch(() => { if (!cancelled) { setUseRemotionPreview(false); setCaptionLoadError('Could not load saved captions. Reopen the caption editor to retry.'); } })
            .finally(() => { if (!cancelled) setCaptionsLoading(false); });
        return () => { cancelled = true; controller.abort(); };
    }, [isOpen, jobId, clipIndex]);

    // When user edits text, redistribute words across original timestamps
    const handleTextEdit = (newText) => {
        setEditableText(newText);
        const newWords = newText.split(/\s+/).filter(w => w.length > 0);
        if (newWords.length === 0 || originalCaptions.length === 0) {
            setCaptions([]);
            return;
        }

        // Distribute new words across the time span of original captions
        const totalDurationMs = originalCaptions[originalCaptions.length - 1].endMs - originalCaptions[0].startMs;
        const startMs = originalCaptions[0].startMs;
        const wordDurationMs = totalDurationMs / newWords.length;

        const newCaptions = newWords.map((word, i) => ({
            text: word,
            startMs: Math.round(startMs + i * wordDurationMs),
            endMs: Math.round(startMs + (i + 1) * wordDurationMs),
        }));
        setCaptions(newCaptions);
    };

    if (!isOpen) return null;

    // Build subtitle config for Remotion
    const subtitleConfig = {
        captions,
        position,
        positionY,
        maxChars,
        horizontalPadding,
        maxDurationMs: maxDuration * 1000,
        style: {
            bold,
            fontFamily: fontName,
            fontSize: subtitleFontPixels(fontSize, fontName),
            fontColor,
            highlightColor: style === 'karaoke' && highlightEnabled ? highlightColor : fontColor,
            borderColor,
            borderWidth: Math.trunc(borderWidth) * ASS_SCALE,
            bgColor,
            bgOpacity,
            animation: style === 'karaoke' && highlightEnabled ? animation : 'none',
            // Karaoke look reflected live in the playable preview.
            baseOpacity: style === 'karaoke' && highlightEnabled ? baseOpacity : 1,
            uppercase: style === 'karaoke' ? uppercase : false,
            reveal: style === 'karaoke' && reveal,
            shadow: style === 'karaoke' ? shadow : 0,
            shadowAngle,
            shadowBlur: style === 'karaoke' ? shadowBlur : 0,
            shadowColor,
            shadowOpacity,
            // Text on the active-word box: black on a light box, as burned.
            highlightTextColor: luminance(highlightColor) > 0.6 ? '#000000' : fontColor,
        },
    };

    // Fallback: static CSS preview (same as original)
    const bw = Math.max(borderWidth, 0);
    const bc = borderColor;

    const fallbackPreviewStyle = {
        fontFamily: fontName,
        color: fontColor,
        fontSize: '20px',
        fontWeight: bold ? 'bold' : 'normal',
        maxWidth: `${100 - horizontalPadding * 2}%`,
        padding: '6px 12px',
        borderRadius: '4px',
        textAlign: 'center',
        lineHeight: '1.3',
        ...(bgOpacity > 0
            ? {
                backgroundColor: `${bgColor}${Math.round(bgOpacity * 255).toString(16).padStart(2, '0')}`,
                textShadow: 'none',
            }
            : { ...subtitleOutline(bw, bc), textShadow: 'none' }
        ),
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="xl" eyebrow="EDITOR · SUBTITLES" title="subtitles">
            <div className="flex flex-col md:flex-row gap-6">
                {/* Left: Preview */}
                {/* Sticky on desktop: the controls scroll past a preview that stays in view. */}
                <div className="w-full max-w-[338px] mx-auto md:mx-0 md:w-[338px] shrink-0 self-start md:sticky md:top-0 z-10 flex flex-col items-center justify-center bg-black rounded-card border border-rule overflow-hidden relative aspect-[9/16]">
                    {captionsLoading ? (
                        <div className="flex items-center gap-2 text-muted">
                            <Loader2 size={16} className="animate-spin" />
                            <span className="text-sm lowercase">Loading preview...</span>
                        </div>
                    ) : useRemotionPreview ? (
                        <RemotionPreview
                            videoUrl={videoUrl}
                            durationInSeconds={durationSec}
                            subtitles={subtitleConfig}
                            hook={existingHook || null}
                        />
                    ) : (
                        <>
                            <video src={videoUrl} className="w-full h-full object-contain opacity-50" muted playsInline />
                            <div className={`absolute w-full px-8 text-center transition-all duration-300 pointer-events-none flex flex-col items-center justify-center
                                ${position === 'top' ? 'top-20' : ''}
                                ${position === 'middle' ? 'top-0 bottom-0' : ''}
                                ${position === 'bottom' ? 'bottom-20' : ''}
                            `} style={position === 'custom' ? { bottom: `${customCaptionBottom(positionY)}%` } : undefined}>
                                <span style={fallbackPreviewStyle}>
                                    This is how your subtitles<br/>will appear on the video
                                </span>
                            </div>
                        </>
                    )}
                </div>

                {/* Right: Controls */}
                <div className="w-full md:flex-1 md:min-w-0 flex flex-col">
                    <div className="space-y-5 flex-1 pr-1">
                        {/* Caption presets (server-side karaoke burn) */}
                        <div>
                            <p className="eyebrow mb-2">Preset</p>
                            <div className="grid grid-cols-3 gap-1.5">
                                {CAPTION_PRESETS.map((p) => (
                                    <button
                                        key={p.id}
                                        onClick={() => applyPreset(p)}
                                        className={`px-2 py-1.5 rounded-input border text-xs transition-colors flex items-center gap-1.5 justify-center
                                            ${activePreset === p.id
                                                ? 'border-[color:var(--color-accent)] text-ink'
                                                : 'border-rule2 text-muted hover:border-[color:var(--color-accent)]'}`}
                                        title={p.label}
                                    >
                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.highlightColor }} />
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                            {style === 'karaoke' && (
                                <div className="mt-3 space-y-3 animate-fade">
                                    <div className="flex items-center justify-between">
                                        <span className="readout">UPPERCASE</span>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} className="sr-only peer" />
                                            <div className="w-8 h-4 rounded-full bg-paper3 peer-checked:bg-brass transition-colors after:content-[''] after:absolute after:top-0 after:left-0 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition-all peer-checked:after:translate-x-full"></div>
                                        </label>
                                    </div>
                                    <div>
                                        <div className="flex justify-between mb-1">
                                            <span className="readout">Dim inactive words</span>
                                            <span className="readout">{Math.round(baseOpacity * 100)}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="30"
                                            max="100"
                                            value={Math.round(baseOpacity * 100)}
                                            onChange={(e) => setBaseOpacity(parseInt(e.target.value) / 100)}
                                            className="w-full accent-[var(--color-accent)]"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Position Selector */}
                        <div>
                            <p className="eyebrow mb-2">Position</p>
                            <SegmentedControl
                                options={POSITION_OPTIONS}
                                value={position}
                                onChange={choosePosition}
                                size="sm"
                            />
                            {position === 'custom' && (
                                <label className="block readout mt-2">Height above bottom: {positionY}%
                                    <input aria-label="Caption height above bottom" className="w-full accent-[var(--color-accent)]" type="range" min="0" max="90" step="0.5" value={positionY} onChange={e => setPositionY(Number(e.target.value))} />
                                </label>
                            )}
                        </div>

                        <label className="block readout">Horizontal padding: {Math.round(horizontalPadding)}% per side
                            <input aria-label="Horizontal padding" className="w-full" type="range" min="0" max="35" step="1" value={horizontalPadding} onChange={e => { setHorizontalPadding(Number(e.target.value)); setSavedLineBudget(null); }} />
                        </label>
                        {/* Shadow: its own layer under the text, so blur never softens the letters. */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <p className="eyebrow">Shadow</p>
                                <label className="relative w-6 h-6 rounded-input border border-rule2 cursor-pointer overflow-hidden shrink-0" title="Shadow color">
                                    <div className="w-full h-full" style={{ backgroundColor: shadowColor }} />
                                    <input aria-label="Shadow color" type="color" value={shadowColor} onChange={(e) => setShadowColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                </label>
                            </div>
                            {borderWidth > 0 && (
                                <p className="text-[11px] text-muted leading-relaxed">Set Border to none to show the shadow.</p>
                            )}
                            {style !== 'karaoke' && (
                                <p className="text-[11px] text-muted leading-relaxed">Shadow applies to the karaoke presets.</p>
                            )}
                            <label className="block readout">Distance: {shadow}
                                <input aria-label="Caption shadow" className="w-full accent-[var(--color-accent)]" type="range" min="0" max="10" step="0.5" value={shadow} onChange={e => setShadow(Number(e.target.value))} />
                            </label>
                            <label className="block readout">Direction: {shadowAngle}° <span aria-hidden="true" className="inline-block" style={{ transform: `rotate(${shadowAngle}deg)` }}>→</span>
                                <input aria-label="Shadow direction" className="w-full accent-[var(--color-accent)]" type="range" min="0" max="360" step="5" value={shadowAngle} onChange={e => setShadowAngle(Number(e.target.value))} />
                            </label>
                            <label className="block readout">Blur: {shadowBlur}
                                <input aria-label="Shadow blur" className="w-full accent-[var(--color-accent)]" type="range" min="0" max="10" step="0.5" value={shadowBlur} onChange={e => setShadowBlur(Number(e.target.value))} />
                            </label>
                            <label className="block readout">Opacity: {Math.round(shadowOpacity * 100)}%
                                <input aria-label="Shadow opacity" className="w-full accent-[var(--color-accent)]" type="range" min="0" max="100" step="5" value={Math.round(shadowOpacity * 100)} onChange={e => setShadowOpacity(Number(e.target.value) / 100)} />
                            </label>
                        </div>
                        {/* Size */}
                        <div>
                            <p className="eyebrow mb-2">Size: {fontSize}</p>
                            <input aria-label="Caption size" className="w-full" type="range" min="6" max="70" step="1" value={fontSize} onChange={e => { setFontSize(Number(e.target.value)); setSavedLineBudget(null); }} />
                            <SegmentedControl
                                options={SIZE_OPTIONS}
                                value={fontSize}
                                onChange={(value) => { setFontSize(value); setSavedLineBudget(null); }}
                                size="sm"
                            />
                        </div>

                        {style === 'karaoke' && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="readout">One word at a time</span>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" checked={oneWord} onChange={(e) => { setOneWord(e.target.checked); setSavedLineBudget(null); }} className="sr-only peer" />
                                        <div className="w-8 h-4 rounded-full bg-paper3 peer-checked:bg-brass transition-colors after:content-[''] after:absolute after:top-0 after:left-0 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition-all peer-checked:after:translate-x-full"></div>
                                    </label>
                                </div>
                                {!oneWord && (
                                    <div className="flex items-center justify-between">
                                        <span className="readout">Reveal word by word</span>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} className="sr-only peer" />
                                            <div className="w-8 h-4 rounded-full bg-paper3 peer-checked:bg-brass transition-colors after:content-[''] after:absolute after:top-0 after:left-0 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition-all peer-checked:after:translate-x-full"></div>
                                        </label>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Animation Style (new) */}
                        <div>
                            <p className="eyebrow mb-2">Animation</p>
                            <SegmentedControl
                                options={ANIMATION_OPTIONS}
                                value={animation}
                                onChange={setAnimation}
                                columns={2}
                                size="sm"
                            />
                        </div>

                        {/* Editable Transcript (collapsible) */}
                        {useRemotionPreview && (
                            <div>
                                <button
                                    type="button"
                                    onClick={() => setShowTextEditor(!showTextEditor)}
                                    className="w-full flex items-center justify-between mb-2"
                                >
                                    <span className="eyebrow">Edit text ({captions.length} words)</span>
                                    <span className={`text-muted transition-transform ${showTextEditor ? 'rotate-180' : ''}`}>▾</span>
                                </button>
                                {showTextEditor && (
                                    <textarea
                                        value={editableText}
                                        onChange={(e) => handleTextEdit(e.target.value)}
                                        rows={5}
                                        dir="auto"
                                        className="input-field resize-none leading-relaxed animate-fade"
                                        placeholder="Edit subtitle text..."
                                    />
                                )}
                            </div>
                        )}

                        {/* Font Family */}
                        <div>
                            <p className="eyebrow mb-2">Font</p>
                            <select
                                value={fontName}
                                onChange={(e) => { setFontName(e.target.value); setSavedLineBudget(null); }}
                                className="input-field"
                            >
                                {FONT_OPTIONS.map((f) => (
                                    <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
                                ))}
                            </select>
                        </div>

                        <label className="readout flex gap-2"><input type="checkbox" checked={bold} onChange={e => setBold(e.target.checked)} />Bold text</label>
                        <p className="text-xs text-muted">Anton and Montserrat ExtraBold have a fixed heavy weight.</p>
                        {/* Text Color */}
                        <div>
                            <p className="eyebrow mb-2">Text color</p>
                            <div className="flex flex-wrap items-center gap-2.5">
                                {COLOR_PRESETS.map((c) => (
                                    <button
                                        key={c.color}
                                        onClick={() => setFontColor(c.color)}
                                        className={swatchClass(fontColor === c.color)}
                                        style={{ backgroundColor: c.color }}
                                        title={c.label}
                                    />
                                ))}
                                <label className="w-6 h-6 rounded-full border border-dashed border-rule2 cursor-pointer flex items-center justify-center hover:border-brass transition-colors overflow-hidden relative" title="Custom color">
                                    <span className="text-xs text-muted leading-none">+</span>
                                    <input type="color" value={fontColor} onChange={(e) => setFontColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                </label>
                            </div>
                        </div>

                        {/* Highlight Color (new) */}
                        <div>
                            <p className="eyebrow mb-2">Highlight</p>
                            <button type="button" className="btn-ghost" aria-pressed={!highlightEnabled} onClick={() => setHighlightEnabled(false)}>No highlight</button>
                            <div className="flex flex-wrap items-center gap-2.5">
                                {HIGHLIGHT_PRESETS.map((c) => (
                                    <button
                                        key={c.color}
                                        onClick={() => { setHighlightColor(c.color); setHighlightEnabled(true); }}
                                        className={swatchClass(highlightEnabled && highlightColor === c.color)}
                                        style={{ backgroundColor: c.color }}
                                        title={c.label}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Border / Outline */}
                        <div>
                            <p className="eyebrow mb-2">Border</p>
                            <div className="flex items-center gap-3">
                                <label className="relative w-8 h-8 rounded-input border border-rule2 cursor-pointer overflow-hidden shrink-0" title="Border color">
                                    <div className="w-full h-full" style={{ backgroundColor: borderColor }} />
                                    <input type="color" value={borderColor} onChange={(e) => setBorderColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                </label>
                                <div className="flex-1">
                                    <input
                                        type="range"
                                        min="0"
                                        max="5"
                                        value={borderWidth}
                                        onChange={(e) => setBorderWidth(parseInt(e.target.value))}
                                        className="w-full accent-[var(--color-accent)]"
                                    />
                                    <div className="flex justify-between">
                                        <span className="readout">None</span>
                                        <span className="readout">Thick</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Background Box */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <p className="eyebrow">Background</p>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" checked={bgOpacity > 0} onChange={(e) => setBgOpacity(e.target.checked ? 0.5 : 0)} className="sr-only peer" />
                                    <div className="w-8 h-4 rounded-full bg-paper3 peer-checked:bg-brass transition-colors after:content-[''] after:absolute after:top-0 after:left-0 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition-all peer-checked:after:translate-x-full"></div>
                                </label>
                            </div>
                            {bgOpacity > 0 && (
                                <div className="space-y-3 animate-fade">
                                    <div className="flex items-center gap-3">
                                        <label className="relative w-8 h-8 rounded-input border border-rule2 cursor-pointer overflow-hidden shrink-0" title="Background color">
                                            <div className="w-full h-full" style={{ backgroundColor: bgColor }} />
                                            <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                        </label>
                                        <div className="flex-1">
                                            <input
                                                type="range"
                                                min="10"
                                                max="100"
                                                value={Math.round(bgOpacity * 100)}
                                                onChange={(e) => setBgOpacity(parseInt(e.target.value) / 100)}
                                                className="w-full accent-[var(--color-accent)]"
                                            />
                                            <div className="flex justify-between">
                                                <span className="readout">Transparent</span>
                                                <span className="readout">{Math.round(bgOpacity * 100)}%</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="mt-5 shrink-0 space-y-2">
                        {captionLoadError && <p role="alert" className="text-danger text-sm">{captionLoadError}</p>}
                        {(() => {
                            // Text edits must survive the server render path too
                            // (issue #69): send the edited words whenever the text
                            // differs from what the transcript produced.
                            const textEdited = originalCaptions.length > 0
                                && editableText.trim() !== originalCaptions.map((c) => c.text).join(' ').trim();
                            const styleOptions = {
                                position, fontSize, fontName, fontColor, borderColor, borderWidth, bgColor, bgOpacity,
                                // Karaoke burn (server-side ASS render)
                                style, effect, baseOpacity, uppercase, highlightColor, bold, highlightEnabled,
                                reveal: !oneWord && reveal, shadow, horizontalPadding, maxChars, maxDuration,
                                shadowAngle, shadowBlur, shadowColor, shadowOpacity, positionY,
                                // Remotion data
                                remotion: useRemotionPreview ? subtitleConfig : null,
                                captions: textEdited ? captions : null,
                            };
                            const bulkRunning = bulkProgress?.running;
                            return (
                                <>
                                    <div className="flex gap-2">
                                        <button onClick={onClose} className="btn-ghost">
                                            cancel
                                        </button>
                                        <button
                                            onClick={() => onGenerate(styleOptions)}
                                            disabled={isProcessing || captionsLoading || !!captionLoadError}
                                            className="btn-primary flex-1"
                                        >
                                            {(isProcessing && !bulkRunning) && <Loader2 size={16} className="animate-spin text-brassink" />}
                                            {(isProcessing && !bulkRunning) ? 'generating...' : 'apply to this clip'}
                                        </button>
                                    </div>
                                    {onApplyAll && bulkCount > 1 && (
                                        <button
                                            onClick={() => onApplyAll({ ...styleOptions, captions: null })}
                                            disabled={isProcessing || captionsLoading || !!captionLoadError}
                                            className="btn-ghost w-full flex items-center justify-center gap-2"
                                        >
                                            {bulkRunning
                                                ? <><Loader2 size={16} className="animate-spin" />applying to all… {bulkProgress.current}/{bulkProgress.total}</>
                                                : `apply this style to all ${bulkCount} clips`}
                                        </button>
                                    )}
                                    {/* Clips ship captioned by default, so the way
                                        out has to be here — otherwise a user who
                                        doesn't want captions is stuck with them. */}
                                    {onRemove && (
                                        <button
                                            onClick={onRemove}
                                            disabled={isProcessing || captionsLoading || !!captionLoadError}
                                            className="text-xs text-muted underline underline-offset-2 lowercase hover:text-ink2 disabled:opacity-50"
                                        >
                                            remove captions from this clip
                                        </button>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
