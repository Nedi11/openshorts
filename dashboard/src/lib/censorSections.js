// Mirrors word_censor.py (normalize / occurrence_key / sections) so the editor
// lists exactly the sections the render will bleep or cut.
export const PAD_BEFORE = 0.15;
export const PAD_AFTER = 0.05;
export const MAX_NUDGE = 1;
const MIN_SECTION = 0.04;

export function normalizeWord(word) {
    return String(word).toLowerCase().replace(/[^\p{L}\p{N}_']/gu, '').replace(/^'+|'+$/g, '');
}

export const occurrenceKey = (word) => Number(word.s).toFixed(3);

export const parseWords = (text) => String(text).split(',').map((w) => w.trim()).filter(Boolean);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
const r3 = (v) => Math.round(v * 1000) / 1000;

// Every matched occurrence inside the segments, skipped ones included (flagged),
// each with its source-time section and its position on the clip timeline.
export function censorSections(words, terms, segments, padBefore, padAfter, adjustments = {}) {
    const wanted = new Set(terms.map(normalizeWord).filter(Boolean));
    if (!wanted.size) return [];
    const offsets = [];
    let offset = 0;
    for (const seg of segments) { offsets.push(offset); offset += seg.end - seg.start; }
    const out = [];
    for (const w of words) {
        if (!(w.e > w.s) || !wanted.has(normalizeWord(w.w))) continue;
        const idx = segments.findIndex((s) => s.start < w.e && w.s < s.end);
        if (idx < 0) continue;
        const home = segments[idx];
        const key = occurrenceKey(w);
        const adj = adjustments[key] || {};
        const start = Math.max(home.start, w.s - clamp(padBefore, 0, 1) - clamp(adj.before, -MAX_NUDGE, MAX_NUDGE));
        const end = Math.min(home.end, w.e + clamp(padAfter, 0, 1) + clamp(adj.after, -MAX_NUDGE, MAX_NUDGE));
        out.push({
            key, word: w.w, s: w.s, e: w.e, start: r3(start), end: r3(end),
            clipStart: r3(offsets[idx] + start - home.start),
            skip: !!adj.skip, tooShort: end - start < MIN_SECTION,
            before: clamp(adj.before, -MAX_NUDGE, MAX_NUDGE), after: clamp(adj.after, -MAX_NUDGE, MAX_NUDGE),
        });
    }
    return out.sort((a, b) => a.clipStart - b.clipStart);
}

// Adjustment map with one field changed; entries back at zero are dropped.
export function adjust(adjustments, key, field, value) {
    const entry = { before: 0, after: 0, skip: false, ...(adjustments[key] || {}), [field]: value };
    if (field !== 'skip') entry[field] = r3(clamp(value, -MAX_NUDGE, MAX_NUDGE));
    const next = { ...adjustments };
    if (!entry.before && !entry.after && !entry.skip) delete next[key];
    else next[key] = entry;
    return next;
}
