"""Word-timed opt-in censorship. Matching is exact, case/punctuation insensitive."""
import copy
import re
import os
import subprocess
import uuid
import recut

DEFAULT_WORDS = ['fuck', 'fucking', 'fucked', 'shit', 'bullshit', 'bitch', 'asshole', 'motherfucker']

def normalize(word):
    return re.sub(r"[^\w']", '', word.casefold()).strip("'")

def matches(transcript, terms):
    terms = {normalize(w) for w in terms if normalize(w)}
    return [w for w in recut.transcript_words(transcript) if normalize(w['w']) in terms and w['e'] > w['s']]

def cut_segments(segments, words):
    out = []
    for segment in segments:
        pieces = [(segment['start'], segment['end'])]
        for word in words:
            a, b = word['s'], word['e']
            pieces = [(x, y) for start, end in pieces for x, y in
                      ([(start, end)] if b <= start or a >= end else [(start, min(a, end)), (max(b, start), end)]) if y-x >= .04]
        out.extend({'start': round(a, 3), 'end': round(b, 3)} for a, b in pieces)
    if not out:
        raise ValueError('The selected words remove the entire clip. Choose fewer words or use bleep.')
    if len(out) > 250:
        raise ValueError('Too many word cuts in one clip (maximum 250).')
    return out

def censor_transcript(transcript, settings):
    if not settings or settings.get('mode') != 'bleep':
        return transcript
    result = copy.deepcopy(transcript)
    terms = {normalize(w) for w in settings.get('words', [])}
    for segment in result.get('segments', []):
        for word in segment.get('words', []):
            if normalize(word.get('word', '')) in terms:
                word['word'] = ' [bleep]'
        segment['text'] = ''.join(w['word'] for w in segment.get('words', []))
    return result

def bleep(path, transcript, terms):
    words = matches(transcript, terms)
    if not words:
        return
    expression = '+'.join(f'between(t,{w["s"]:.3f},{w["e"]:.3f})' for w in words)
    duration = max(s['end'] for s in transcript['segments'])
    # Mute the original audio inside each interval before mixing the tone.
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
