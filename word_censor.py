"""Word-timed opt-in censorship. Matching is exact, case/punctuation insensitive.

Each matched word becomes a SECTION of source time: the word's transcript
timing widened by ``pad_before`` / ``pad_after`` (Whisper tends to start a word
slightly after its sound does, so the default lead is the larger), then by the
user's per-word nudges (``adjustments``, keyed by ``occurrence_key``), which
can also skip a word. The editor shows the same sections (ClipEditor.jsx
censorSections mirrors ``sections``) and the render uses exactly those.
"""
import copy
import re
import os
import subprocess
import uuid
import recut

DEFAULT_WORDS = ['fuck', 'fucking', 'fucked', 'shit', 'bullshit', 'bitch', 'asshole', 'motherfucker']
# Seconds added before/after each word by default (AUDIO-001 padding).
PAD_BEFORE = 0.15
PAD_AFTER = 0.05
MAX_PAD = 1.0          # global padding, each side
MAX_NUDGE = 1.0        # per-word adjustment, each side, either direction
MIN_SECTION = 0.04


def normalize(word):
    return re.sub(r"[^\w']", '', word.casefold()).strip("'")


def matches(transcript, terms):
    terms = {normalize(w) for w in terms if normalize(w)}
    return [w for w in recut.transcript_words(transcript) if normalize(w['w']) in terms and w['e'] > w['s']]


def occurrence_key(word):
    """Stable id of one spoken occurrence: its source start time."""
    return f"{float(word['s']):.3f}"


def _number(value, lo, hi, default):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, value))


def normalize_settings(mode, words, pad_before=PAD_BEFORE, pad_after=PAD_AFTER, adjustments=None):
    """Validated settings dict (raises ValueError on bad input)."""
    if mode not in ('off', 'bleep', 'cut'):
        raise ValueError('Choose off, bleep, or cut for word censorship')
    if any(len(w) > 80 or len(w.split()) != 1 for w in words):
        raise ValueError('Enter individual words, separated by commas')
    clean = {}
    for key, adj in (adjustments or {}).items():
        if len(clean) >= 500:
            raise ValueError('Too many word adjustments (maximum 500)')
        try:
            key = f"{float(key):.3f}"
        except (TypeError, ValueError):
            raise ValueError('Word adjustments are keyed by the word start time')
        adj = adj or {}
        entry = {'before': round(_number(adj.get('before'), -MAX_NUDGE, MAX_NUDGE, 0.0), 3),
                 'after': round(_number(adj.get('after'), -MAX_NUDGE, MAX_NUDGE, 0.0), 3),
                 'skip': bool(adj.get('skip'))}
        if entry['before'] or entry['after'] or entry['skip']:
            clean[key] = entry
    return {'mode': mode, 'words': list(words),
            'pad_before': round(_number(pad_before, 0, MAX_PAD, PAD_BEFORE), 3),
            'pad_after': round(_number(pad_after, 0, MAX_PAD, PAD_AFTER), 3),
            'adjustments': clean}


def sections(transcript, settings, segments):
    """Source-time sections to censor inside ``segments``, in time order.

    [{'key', 'word', 's', 'e', 'start', 'end'}]: s/e are the transcript timing,
    start/end the padded and nudged section, clamped to the segment holding
    the word. Skipped words and words outside every segment are left out.
    """
    if not settings or settings.get('mode') not in ('bleep', 'cut'):
        return []
    pad_before = _number(settings.get('pad_before'), 0, MAX_PAD, PAD_BEFORE)
    pad_after = _number(settings.get('pad_after'), 0, MAX_PAD, PAD_AFTER)
    adjustments = settings.get('adjustments') or {}
    out = []
    for word in matches(transcript, settings.get('words', [])):
        key = occurrence_key(word)
        adj = adjustments.get(key) or {}
        if adj.get('skip'):
            continue
        home = next((s for s in segments if s['start'] < word['e'] and word['s'] < s['end']), None)
        if home is None:
            continue
        start = word['s'] - pad_before - _number(adj.get('before'), -MAX_NUDGE, MAX_NUDGE, 0)
        end = word['e'] + pad_after + _number(adj.get('after'), -MAX_NUDGE, MAX_NUDGE, 0)
        start, end = max(start, home['start']), min(end, home['end'])
        if end - start < MIN_SECTION:
            continue
        out.append({'key': key, 'word': word['w'], 's': word['s'], 'e': word['e'],
                    'start': round(start, 3), 'end': round(end, 3)})
    return out


def to_clip_time(source_sections, segments):
    """Map source-time sections onto the rendered clip's timeline ([[a, b]])."""
    out, offset = [], 0.0
    for seg in segments:
        for sec in source_sections:
            a, b = max(sec['start'], seg['start']), min(sec['end'], seg['end'])
            if b - a >= MIN_SECTION / 2:
                out.append([round(offset + a - seg['start'], 3), round(offset + b - seg['start'], 3)])
        offset += seg['end'] - seg['start']
    return sorted(out)


def clip_sections_for(transcript, settings, segments):
    """Clip-time bleep sections for a re-render of the SAME segments: the ones
    recorded at the last render, else recomputed (settings saved before them)."""
    if not settings or settings.get('mode') != 'bleep':
        return []
    if settings.get('clip_sections') is not None:
        return settings['clip_sections']
    return to_clip_time(sections(transcript, settings, segments), segments)


def cut_segments(segments, words):
    """Remove each section (``start``/``end``, else the word's ``s``/``e``)."""
    out = []
    for segment in segments:
        pieces = [(segment['start'], segment['end'])]
        for word in words:
            a, b = word.get('start', word['s']), word.get('end', word['e'])
            pieces = [(x, y) for start, end in pieces for x, y in
                      ([(start, end)] if b <= start or a >= end else [(start, min(a, end)), (max(b, start), end)]) if y-x >= .04]
        out.extend({'start': round(a, 3), 'end': round(b, 3)} for a, b in pieces)
    if not out:
        raise ValueError('The selected words remove the entire clip. Choose fewer words or use bleep.')
    if len(out) > 250:
        raise ValueError('Too many word cuts in one clip (maximum 250).')
    return out


def censor_transcript(transcript, settings):
    """Caption text with bleeped words shown as [bleep].

    With the rendered clip-time sections recorded (``clip_sections``) a word is
    replaced when its middle falls in one, so skipped words keep their text;
    older settings without them fall back to matching every listed word.
    """
    if not settings or settings.get('mode') != 'bleep':
        return transcript
    result = copy.deepcopy(transcript)
    terms = {normalize(w) for w in settings.get('words', [])}
    clip_sections = settings.get('clip_sections')
    for segment in result.get('segments', []):
        for word in segment.get('words', []):
            if normalize(word.get('word', '')) not in terms:
                continue
            if clip_sections is not None:
                mid = (float(word['start']) + float(word['end'])) / 2
                if not any(a <= mid <= b for a, b in clip_sections):
                    continue
            word['word'] = ' [bleep]'
        segment['text'] = ''.join(w['word'] for w in segment.get('words', []))
    return result


def bleep(path, clip_sections):
    """Mute the original audio inside each clip-time section and add a tone."""
    if not clip_sections:
        return
    expression = '+'.join(f'between(t,{a:.3f},{b:.3f})' for a, b in clip_sections)
    duration = max(b for _, b in clip_sections) + 1
    graph = (f"[0:a]aeval=exprs='if(gt({expression},0),0,val(ch))':c=same[muted];"
             f"sine=frequency=1000:sample_rate=48000:duration={duration},"
             f"aeval=exprs='if(gt({expression},0),val(ch)*0.5,0)'[tone];"
             '[muted][tone]amix=inputs=2:duration=first:normalize=0,aformat=channel_layouts=stereo[a]')
    output = path + f'.{uuid.uuid4().hex}.mp4'
    try:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, '-filter_complex', graph,
                        '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac',
                        '-movflags', '+faststart', output], check=True, timeout=1800)
        os.replace(output, path)
    finally:
        if os.path.exists(output):
            os.remove(output)
