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
    censor.bleep(path,TRANSCRIPT,['shit'])
    raw=subprocess.check_output(['ffmpeg','-v','error','-i',path,'-f','f32le','-ac','1','-ar','48000','-'])
    samples=np.frombuffer(raw,dtype=np.float32)
    assert abs(len(samples)/48000-3)<.1
    def energy(start,end,hz):
        chunk=samples[int(start*48000):int(end*48000)]
        time=np.arange(len(chunk))/48000
        return abs(np.sum(chunk*np.exp(-2j*np.pi*hz*time))) / len(chunk)
    assert energy(1.1,1.4,1000)>energy(1.1,1.4,440)*20
    assert energy(.2,.8,440)>energy(.2,.8,1000)*20
