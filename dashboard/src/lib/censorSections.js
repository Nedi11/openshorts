// Mirrors word_censor.py (normalize / occurrence_key / sections) so the editor
// lists exactly the sections the render will bleep or cut.
export const PAD_BEFORE = 0.15;
export const PAD_AFTER = 0.05;
// Per-word adjustments are effectively unlimited: sections already clamp to the
// segment holding the word. This only bounds nonsense input (word_censor.MAX_NUDGE).
export const MAX_NUDGE = 600;
const MIN_SECTION = 0.01;   // word_censor.MIN_SECTION
// The editor never lets a nudge shrink a section below this.
export const MIN_EDIT_LENGTH = 0.01;
// Click sizes the editor offers for moving an edge.
// Times are kept to the millisecond everywhere (word_censor, recut), so 0.001 s
// is the finest meaningful step.
export const STEPS = [0.001, 0.005, 0.01, 0.05, 0.25];

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
        // Presets place an edge until it is set by hand; a hand-set edge is an
        // absolute source time the presets no longer move (word_censor.sections).
        const presetStart = w.s - clamp(padBefore, 0, 1) - clamp(adj.before, -MAX_NUDGE, MAX_NUDGE);
        const presetEnd = w.e + clamp(padAfter, 0, 1) + clamp(adj.after, -MAX_NUDGE, MAX_NUDGE);
        const manualStart = adj.start !== undefined && adj.start !== null;
        const manualEnd = adj.end !== undefined && adj.end !== null;
        const rawStart = manualStart ? Number(adj.start) : presetStart;
        const rawEnd = manualEnd ? Number(adj.end) : presetEnd;
        const start = Math.max(home.start, rawStart);
        const end = Math.min(home.end, rawEnd);
        out.push({
            key, word: w.w, s: w.s, e: w.e, start: r3(start), end: r3(end),
            rawStart: r3(rawStart), rawEnd: r3(rawEnd), manualStart, manualEnd,
            clipStart: r3(offsets[idx] + start - home.start),
            clipEnd: r3(offsets[idx] + end - home.start),
            // crossed: the edges are the wrong way round (the server refuses
            // it); tooShort: only the segment edge leaves too little.
            skip: !!adj.skip, crossed: rawEnd - rawStart < MIN_SECTION,
            tooShort: rawEnd - rawStart >= MIN_SECTION && end - start < MIN_SECTION,
            length: r3(rawEnd - rawStart),
        });
    }
    return out.sort((a, b) => a.clipStart - b.clipStart);
}

// Adjustment map with one word's entry replaced; an empty entry is dropped.
function withEntry(adjustments, key, entry) {
    const next = { ...adjustments };
    const clean = Object.fromEntries(Object.entries(entry).filter(([k, v]) =>
        v !== undefined && v !== null && !(k === 'skip' && !v) && !((k === 'before' || k === 'after') && !v)));
    if (Object.keys(clean).length) next[key] = clean;
    else delete next[key];
    return next;
}

export function setSkip(adjustments, key, skip) {
    return withEntry(adjustments, key, { ...(adjustments[key] || {}), skip });
}

// Edge moves for one section. 'start'/'end' move that edge by delta seconds
// (negative = earlier); 'move' shifts both. The moved edge becomes hand-set:
// an absolute time the start-earlier / end-later presets no longer change.
// Only SHRINKING below MIN_EDIT_LENGTH is refused (null); widening a
// too-short section is always allowed, so a crossed section can be reopened.
export function moveEdge(adjustments, sec, edge, delta) {
    const start = edge === 'end' ? sec.rawStart : r3(sec.rawStart + delta);
    const end = edge === 'start' ? sec.rawEnd : r3(sec.rawEnd + delta);
    const length = end - start;
    if (edge !== 'move' && length < sec.length && length < MIN_EDIT_LENGTH - 1e-9) return null;
    if (start < 0) return null;
    const entry = { ...(adjustments[sec.key] || {}) };
    if (edge !== 'end') { entry.start = start; delete entry.before; }
    if (edge !== 'start') { entry.end = end; delete entry.after; }
    return withEntry(adjustments, sec.key, entry);
}

// Back to the presets for this word (keeps a skip).
export function resetWord(adjustments, key) {
    return withEntry(adjustments, key, { skip: !!(adjustments[key] || {}).skip });
}
