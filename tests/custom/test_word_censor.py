import asyncio
import json
import subprocess
import sys
import threading
from types import SimpleNamespace
import pytest
import recut
import word_censor as censor
from render_queue import RenderQueue
from render_cancel import run_in_executor

TRANSCRIPT = {'segments': [{'start':0,'end':3,'words':[
    {'word':' hello','start':0,'end':1},
    {'word':' Shit!','start':1,'end':1.5},
    {'word':' ship','start':2,'end':3}]}]}

def test_cut_removes_word_and_retimes_remaining_captions():
    segments = censor.cut_segments([{'start':0,'end':3}], censor.matches(TRANSCRIPT,['shit']))
    assert segments == [{'start':0,'end':1},{'start':1.5,'end':3}]
    words = recut.transcript_words(recut.virtual_transcript(TRANSCRIPT,segments))
    assert [w['w'] for w in words] == ['hello','ship']
    assert words[1]['s'] == 1.5
    assert recut.total_duration(segments) == 2.5

def test_bleep_masks_only_exact_words_without_mutating_source():
    result = censor.censor_transcript(TRANSCRIPT, {'mode':'bleep','words':['shit']})
    assert [w['w'] for w in recut.transcript_words(result)] == ['hello','[bleep]','ship']
    assert recut.transcript_words(TRANSCRIPT)[1]['w'] == 'Shit!'
    assert censor.censor_transcript(TRANSCRIPT, {'mode':'off'}) is TRANSCRIPT

def test_cut_all_words_rejected_and_repeated_segments_preserved():
    with pytest.raises(ValueError):
        censor.cut_segments([{'start':1,'end':1.5}], censor.matches(TRANSCRIPT,['shit']))
    assert len(censor.cut_segments([{'start':0,'end':3}]*2,censor.matches(TRANSCRIPT,['shit']))) == 4

def test_running_cancel_kills_only_owned_process_and_never_commits(tmp_path):
    queue=RenderQueue(tmp_path/'queue.json')
    entered=threading.Event()
    committed=[]
    async def exercise():
        @queue.track('render')
        async def render(req):
            def worker():
                entered.set()
                subprocess.run([sys.executable,'-c','import time; time.sleep(30)'],check=True)
            await run_in_executor(asyncio.get_running_loop(),None,worker)
            committed.append(True)
        task=asyncio.create_task(render(SimpleNamespace(job_id='j',clip_index=0)))
        while not entered.is_set():
            await asyncio.sleep(.01)
        queue.cancel(queue.snapshot()[0]['id'])
        with pytest.raises(Exception, match='Render cancelled'):
            await asyncio.wait_for(task,3)
        assert not committed
        assert queue.snapshot()[0]['state']=='cancelled'
        assert subprocess.run([sys.executable,'-c','pass']).returncode==0
    asyncio.run(exercise())

def test_queued_cancel_skips_worker_and_queue_continues(tmp_path):
    queue=RenderQueue(tmp_path/'queue.json')
    async def exercise():
        release=asyncio.Event(); calls=[]
        @queue.track('render')
        async def render(req):
            calls.append(req.clip_index)
            if req.clip_index==0: await release.wait()
        first=asyncio.create_task(render(SimpleNamespace(job_id='j',clip_index=0)))
        second=asyncio.create_task(render(SimpleNamespace(job_id='j',clip_index=1)))
        await asyncio.sleep(.01)
        queue.cancel(queue.snapshot()[1]['id']);release.set()
        await first
        with pytest.raises(Exception): await second
        await render(SimpleNamespace(job_id='j',clip_index=2))
        assert calls==[0,2]
    asyncio.run(exercise())


def test_real_bleep_removes_original_frequency_and_keeps_duration(tmp_path):
    import shutil
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")
    np = pytest.importorskip("numpy")
    path=str(tmp_path/'audio.mp4')
    subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=s=160x240:d=3',
        '-f','lavfi','-i','sine=frequency=440:duration=3','-c:v','libx264','-c:a','aac','-shortest',path],check=True)
    censor.bleep(path,[[1.0,1.5]])
    raw=subprocess.check_output(['ffmpeg','-v','error','-i',path,'-f','f32le','-ac','1','-ar','48000','-'])
    samples=np.frombuffer(raw,dtype=np.float32)
    assert abs(len(samples)/48000-3)<.1
    def energy(start,end,hz):
        chunk=samples[int(start*48000):int(end*48000)]
        time=np.arange(len(chunk))/48000
        return abs(np.sum(chunk*np.exp(-2j*np.pi*hz*time))) / len(chunk)
    assert energy(1.1,1.4,1000)>energy(1.1,1.4,440)*20
    assert energy(.2,.8,440)>energy(.2,.8,1000)*20


def _settings(**kw):
    return censor.normalize_settings(kw.pop('mode', 'cut'), kw.pop('words', ['shit']), **kw)


def test_sections_start_before_the_transcript_timing_by_default():
    sections = censor.sections(TRANSCRIPT, _settings(), [{'start': 0, 'end': 3}])
    # Whisper starts words late: the default lead covers the onset.
    assert [(s['key'], s['start'], s['end']) for s in sections] == [('1.000', 0.85, 1.55)]
    segments = censor.cut_segments([{'start': 0, 'end': 3}], sections)
    assert segments == [{'start': 0, 'end': 0.85}, {'start': 1.55, 'end': 3}]


def test_per_word_nudges_skip_and_clamping_to_the_segment():
    nudged = _settings(pad_before=0.1, pad_after=0,
                       adjustments={'1': {'before': 0.2, 'after': -0.1}})
    # Legacy relative offsets (saved before hand-set edges) are still read.
    assert nudged['adjustments'] == {'1.000': {'before': 0.2, 'after': -0.1}}
    [section] = censor.sections(TRANSCRIPT, nudged, [{'start': 0, 'end': 3}])
    assert (section['start'], section['end']) == (0.7, 1.4)
    # A section never reaches outside the segment holding the word.
    [clamped] = censor.sections(TRANSCRIPT, _settings(pad_before=1), [{'start': 0.9, 'end': 3}])
    assert clamped['start'] == 0.9
    skipped = _settings(adjustments={'1.000': {'skip': True}})
    assert censor.sections(TRANSCRIPT, skipped, [{'start': 0, 'end': 3}]) == []
    with pytest.raises(ValueError):
        _settings(mode='mute')


def test_bleep_sections_map_to_clip_time_and_skipped_words_keep_their_caption():
    two = {'segments': [{'start': 0, 'end': 6, 'words': [
        {'word': ' shit', 'start': 1, 'end': 1.5}, {'word': ' shit', 'start': 5, 'end': 5.5}]}]}
    settings = _settings(mode='bleep', pad_before=0, pad_after=0,
                         adjustments={'5.000': {'skip': True}})
    segments = [{'start': 4, 'end': 6}, {'start': 0, 'end': 2}]
    sections = censor.sections(two, settings, segments)
    assert [s['key'] for s in sections] == ['1.000']
    settings['clip_sections'] = censor.to_clip_time(sections, segments)
    assert settings['clip_sections'] == [[3.0, 3.5]]   # 2 s into the second segment
    captions = censor.censor_transcript(recut.virtual_transcript(two, segments), settings)
    assert [w['w'] for w in recut.transcript_words(captions)] == ['shit', '[bleep]']
    assert censor.clip_sections_for(two, settings, segments) == [[3.0, 3.5]]


def test_crossed_nudges_are_refused_instead_of_leaving_the_word_in():
    # The real case: start 1.0 s later and end 0.85 s earlier on a 0.12 s word.
    crossed = _settings(pad_before=0.5, adjustments={'1': {'before': -1.0, 'after': -0.85}})
    with pytest.raises(ValueError, match="ends before it starts"):
        censor.sections(TRANSCRIPT, crossed, [{'start': 0, 'end': 3}])
    # A word that only grazes the segment edge is still just left out.
    assert censor.sections(TRANSCRIPT, _settings(pad_before=0, pad_after=0),
                           [{'start': 1.495, 'end': 3}]) == []


def test_per_word_adjustments_are_not_limited_to_one_second():
    settings = _settings(pad_before=0, pad_after=0, adjustments={'1': {'start': -0.5 + 0.5, 'end': 2.75}})
    assert settings['adjustments']['1.000'] == {'start': 0, 'end': 2.75}
    [section] = censor.sections(TRANSCRIPT, settings, [{'start': 0, 'end': 3}])
    # 1 s before the word and 1.25 s after it: only the segment bounds a section.
    assert (section['start'], section['end']) == (0, 2.75)


def test_sections_down_to_a_hundredth_of_a_second_are_applied():
    # A 0.02 s piece of a word is cut, not dropped.
    tiny = _settings(pad_before=0, pad_after=0, adjustments={'1': {'before': -0.2, 'after': -0.28}})
    [section] = censor.sections(TRANSCRIPT, tiny, [{'start': 0, 'end': 3}])
    assert (section['start'], section['end']) == (1.2, 1.22)
    assert censor.cut_segments([{'start': 0, 'end': 3}], [section]) == [
        {'start': 0, 'end': 1.2}, {'start': 1.22, 'end': 3}]
    settings = dict(tiny, mode='bleep')
    assert censor.to_clip_time([section], [{'start': 0, 'end': 3}]) == [[1.2, 1.22]]


def test_presets_only_place_edges_that_were_not_set_by_hand():
    hand = {'1': {'start': 0.75}}                      # start set by hand, end on preset
    for pad_before, pad_after, end in ((0.15, 0.05, 1.55), (0.5, 0.3, 1.8), (0, 0, 1.5)):
        [section] = censor.sections(TRANSCRIPT, _settings(pad_before=pad_before, pad_after=pad_after,
                                                          adjustments=hand), [{'start': 0, 'end': 3}])
        assert (section['start'], section['end']) == (0.75, end)
    both = _settings(pad_before=0.9, pad_after=0.9, adjustments={'1': {'start': 1.1, 'end': 1.3}})
    [section] = censor.sections(TRANSCRIPT, both, [{'start': 0, 'end': 3}])
    assert (section['start'], section['end']) == (1.1, 1.3)
    with pytest.raises(ValueError):
        _settings(adjustments={'1': {'start': 'soon'}})
