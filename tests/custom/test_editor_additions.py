import asyncio
import json
import shutil
import subprocess
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from centered_fit import height_fit_filter
from render_queue import RenderQueue
from subtitles import CAPTION_PRESETS, generate_ass


def test_queue_orders_renders_and_records_failures(tmp_path):
    queue = RenderQueue(tmp_path / 'queue.json')
    async def exercise():
        started, release = asyncio.Event(), asyncio.Event()
        @queue.track('Edit')
        async def render(req):
            if req.clip_index == 0:
                started.set()
                await release.wait()
            else:
                raise HTTPException(400, 'Invalid edit')
            return 'ok'
        first = asyncio.create_task(render(SimpleNamespace(job_id='j', clip_index=0)))
        await started.wait()
        second = asyncio.create_task(render(SimpleNamespace(job_id='j', clip_index=1)))
        await asyncio.sleep(0)
        rows = queue.snapshot()
        assert [row['state'] for row in rows] == ['running', 'queued']
        assert rows[1]['position'] == 1
        release.set()
        assert await first == 'ok'
        with pytest.raises(HTTPException): await second
        assert [row['state'] for row in queue.snapshot()] == ['completed', 'failed']
        assert queue.snapshot()[1]['error'] == 'Invalid edit'
    asyncio.run(exercise())
    restored = RenderQueue(tmp_path / 'queue.json')
    assert restored.snapshot()[0]['state'] == 'completed'


def test_disconnect_does_not_release_running_render(tmp_path):
    queue = RenderQueue(tmp_path / 'queue.json')
    async def exercise():
        started, release = asyncio.Event(), asyncio.Event()
        @queue.track('Render')
        async def render(req):
            started.set()
            await release.wait()
        caller = asyncio.create_task(render(SimpleNamespace(job_id='j', clip_index=0)))
        await started.wait()
        caller.cancel()
        with pytest.raises(asyncio.CancelledError): await caller
        assert queue.snapshot()[0]['state'] == 'running'
        release.set()
        await asyncio.gather(*queue.tasks)
        assert queue.snapshot()[0]['state'] == 'completed'
    asyncio.run(exercise())


def test_restart_marks_incomplete_renders(tmp_path):
    path = tmp_path / 'queue.json'
    path.write_text(json.dumps([
        {'id': '1', 'state': 'running', 'operation': 'Render', 'job_id': 'j', 'clip_index': 0, 'created_at': 10},
        {'id': '2', 'state': 'queued', 'operation': 'Render', 'job_id': 'j', 'clip_index': 1, 'created_at': 11}]))
    assert all(row['state'] == 'failed' for row in RenderQueue(path).snapshot())


def test_native_caption_has_no_outline_and_existing_presets_remain(tmp_path):
    assert {'default','hormozi','pill','lime','oneword','clean'} <= CAPTION_PRESETS.keys()
    native = CAPTION_PRESETS['native']
    assert native['font_size'] < CAPTION_PRESETS['default']['font_size']
    assert native['border_width'] == 0 and native['shadow'] == 1
    assert native['effect'] == 'none' and not native['uppercase']
    output = tmp_path / 'native.ass'
    transcript = {'segments': [{'start': 0, 'end': 1, 'text': 'Hello world', 'words': [
        {'start': 0, 'end': .5, 'word': 'Hello'}, {'start': .5, 'end': 1, 'word': 'world'}]}]}
    generate_ass(transcript, 0, 1, str(output), fontsize=native['font_size'],
                 font_name=native['font_name'], border_width=0, shadow=1)
    lines = output.read_text().splitlines()
    names = next(line for line in lines if line.startswith('Format: Name, Fontname')).removeprefix('Format: ').split(', ')
    values = next(line for line in lines if line.startswith('Style: Default')).removeprefix('Style: ').split(',')
    style = dict(zip(names, values))
    assert style['Fontname'] == 'Arial'
    assert style['Outline'] == '0' and style['Shadow'] == '0'
    assert any(line.startswith('Dialogue: 0,') and '\\xshad1\\yshad1' in line for line in lines)


@pytest.mark.parametrize('source,width,height', [('320x180',1080,1920), ('90x320',1080,1920), ('320x180',1080,1080)])
def test_center_height_fit_preserves_top_and_bottom(source,width,height):
    if not shutil.which('ffmpeg'): pytest.skip('ffmpeg unavailable')
    # Top and bottom markers survive even when a wide source loses both sides.
    video = f'color=green:s={source}:d=0.1,drawbox=x=0:y=0:w=iw:h=ih/8:color=red:t=fill,drawbox=x=0:y=ih*7/8:w=iw:h=ih/8:color=blue:t=fill'
    result = subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i',video,
        '-vf',height_fit_filter('square' if height == 1080 else 'auto'),
        '-frames:v','1','-threads','1','-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,check=True)
    assert len(result.stdout) == width*height*3
    def pixel(x,y): return result.stdout[(y*width+x)*3:(y*width+x)*3+3]
    top, bottom = pixel(width//2,5), pixel(width//2,height-6)
    assert top[0] > 200 and top[2] < 30
    assert bottom[2] > 200 and bottom[2] > bottom[0] + 150


def test_caption_padding_small_size_and_stroke_without_shadow(tmp_path):
    from subtitles import subtitles_filter
    transcript = {'segments': [{'start': 0, 'end': 1, 'text': 'Hello world', 'words': [
        {'word': 'Hello', 'start': 0, 'end': .5}, {'word': 'world', 'start': .5, 'end': 1}]}]}
    path = tmp_path / 'caption.ass'
    assert generate_ass(transcript, 0, 1, str(path), fontsize=8,
                        horizontal_padding=20, border_width=2, shadow=2)
    style = next(line for line in path.read_text().splitlines() if line.startswith('Style: Default')).split(',')
    assert style[2] == '6'
    assert style[17] == '0'  # no separate shadow behind an outlined glyph
    assert 'xshad' not in path.read_text()
    assert style[19:21] == ['32', '32']
    classic = subtitles_filter('caption.srt', horizontal_padding=20, fontsize=8)
    # 20% of a 162-unit (9:16) grid: the same 20% of the frame as before.
    assert 'PlayResX=162,' in classic and 'MarginL=32,MarginR=32' in classic
    assert 'Fontsize=6,' in classic


def test_caption_highlight_can_be_disabled_and_regular_weight_selected(tmp_path):
    transcript={'segments':[{'start':0,'end':1,'words':[{'word':'Hello','start':0,'end':1}]}]}
    path=tmp_path/'regular.ass'
    generate_ass(transcript,0,1,str(path),highlight_enabled=False,bold=False,
                 effect='highlight',highlight_color='#FF0000')
    content=path.read_text()
    style=next(l for l in content.splitlines() if l.startswith('Style: Default')).split(',')
    assert style[7]=='0'
    assert 'Style: Active' not in content
    assert '&H0000FF&' not in content
