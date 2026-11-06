import asyncio
import json
import subprocess
import hooks
from pathlib import Path

import httpx
import pytest
import app as api

JOB = 'hook-caption-regression'


def request(method, route, data=None):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app), base_url='http://testserver') as client:
            return await client.request(method, route, json=data)
    return asyncio.run(run())


@pytest.fixture
def clip(tmp_path, monkeypatch):
    root = tmp_path / JOB
    root.mkdir()
    (root/'base_clip_1.mp4').write_bytes(b'base')
    original = {'start':10,'end':12,'video_url':f'/videos/{JOB}/base_clip_1.mp4'}
    metadata = {'shorts':[original], 'transcript':{'language':'en','segments':[
        {'start':10,'end':12,'words':[{'word':'Original','start':10,'end':11}]}]}}
    path = root/'base_metadata.json'
    path.write_text(json.dumps(metadata))
    monkeypatch.setattr(api, 'OUTPUT_DIR', str(tmp_path))
    monkeypatch.setitem(api.jobs, JOB, {'status':'completed','result':{'clips':[dict(original)]}})
    burns = []
    def burn(video, out, sub, transcript, start, end, style, split_ranges=None):
        burns.append({'words':transcript['segments'][0]['words'], 'style':dict(style)})
        Path(out).write_bytes(b'captioned')
        return True
    def hook(video,text,out,**kwargs):
        Path(out).write_bytes(b'hooked')
        if kwargs.get('also'):
            Path(kwargs['also'][1]).write_bytes(b'combined')
    monkeypatch.setattr(api, '_burn_caption_style', burn)
    monkeypatch.setattr(api, 'add_hook_to_video', hook)
    return path, burns


def test_saved_caption_style_and_words_survive_hook_update_remove_and_restyle(clip):
    path,burns = clip
    response = request('POST','/api/subtitle',{'job_id':JOB,'clip_index':0,'preset':'native',
        'font_color':'#AABBCC','words':[{'text':'Corrected','startMs':0,'endMs':900}]})
    assert response.status_code == 200, response.text
    expected = json.loads(path.read_text())['shorts'][0]
    for body in [{'text':'First hook'}, {'text':'Updated hook'}, {'remove':True}]:
        response = request('POST','/api/hook',{'job_id':JOB,'clip_index':0,**body})
        assert response.status_code == 200, response.text
        assert burns[-1]['style'] == expected['caption_style']
        assert burns[-1]['words'] == expected['caption_words']
    response = request('GET',f'/api/clip/{JOB}/0/transcript')
    assert response.status_code == 200
    assert response.json()['captionStyle'] == expected['caption_style']
    assert response.json()['captions'] == [{'text':'Corrected','startMs':0,'endMs':900}]
    # A font-only apply sends no word edits, preserving the previously corrected text.
    response = request('POST','/api/subtitle',{'job_id':JOB,'clip_index':0,'preset':'native'})
    assert response.status_code == 200, response.text
    assert burns[-1]['words'] == expected['caption_words']
    assert json.loads(path.read_text())['shorts'][0]['caption_words'] == expected['caption_words']


def test_explicit_empty_words_resets_to_original_transcript(clip):
    path,burns=clip
    metadata=json.loads(path.read_text())
    metadata['shorts'][0]['caption_words']=[{'word':'Corrected','start':0,'end':.9}]
    path.write_text(json.dumps(metadata))
    response=request('POST','/api/subtitle',{'job_id':JOB,'clip_index':0,'preset':'native','words':[]})
    assert response.status_code == 200
    assert burns[-1]['words'][0]['word'] == 'Original'
    assert 'caption_words' not in json.loads(path.read_text())['shorts'][0]


@pytest.mark.parametrize('preset', ['native', 'classic', 'default', 'legacy'])
def test_hook_and_captions_use_one_encode_and_keep_lazy_hook_recipe(clip, monkeypatch, preset):
    path, _ = clip
    metadata = json.loads(path.read_text())
    captioned = path.parent/'subtitled_1_base_clip_1.mp4'
    captioned.write_bytes(b'captioned')
    metadata['shorts'][0].update(video_url=f'/videos/{JOB}/{captioned.name}',
        caption_style={**api.CAPTION_PRESETS.get(preset, {'style':'classic','font_name':'Arial','font_size':20}), 'position':'bottom'},
        caption_words=[{'word':' Corrected','start':0,'end':.9}],
        layout_ranges=[{'start':0,'end':2,'layout':'split'}])
    if preset == 'legacy':
        metadata['shorts'][0].pop('caption_style')
    path.write_text(json.dumps(metadata))
    commands=[]
    def encode(command, video, outputs):
        commands.append(command)
        assert len(outputs) == 1
        for output in outputs: Path(output).write_bytes(b'combined')
        return subprocess.CompletedProcess(command, 0, b'', b'')
    monkeypatch.setattr(api, 'add_hook_to_video', hooks.add_hook_to_video)
    monkeypatch.setattr(hooks, 'LAZY', True)
    monkeypatch.setattr(hooks, '_run_encode', encode)
    monkeypatch.setattr(hooks.subprocess, 'check_output', lambda *args,**kwargs: b'1080x1920\n')
    monkeypatch.setattr(api, '_reapply_captions', lambda *args: pytest.fail('second caption pass'))
    filenames = []
    for text in ('First hook','Updated hook'):
        response=request('POST','/api/hook',{'job_id':JOB,'clip_index':0,'text':text,'position':'top'})
        assert response.status_code == 200, response.text
        filename=response.json()['new_video_url'].split('/')[-1]
        filenames.append(filename)
        assert filename.startswith('subtitled_') and (path.parent/filename).exists()
        hook_name=filename.split('_',2)[2]
        assert not (path.parent/hook_name).exists()
        assert hooks.has_recipe(str(path.parent),hook_name)
        command=commands[-1]
        graph=command[command.index('-filter_complex')+1]
        assert 'overlay=' in graph
        assert ('ass=filename=' if preset != 'classic' else 'subtitles=filename=') in graph
        assert '[h]' not in graph
        assert command.count('-c:v') == 1
        assert api.layout_ranges.read(str(path.parent/filename))[0]['layout']=='split'
    assert len(commands)==2
    assert len(set(filenames))==2
    subfile=next(path.parent.glob('subs_hook_*.'+('srt' if preset=='classic' else 'ass')))
    assert 'corrected' in subfile.read_text().lower()
    if preset=='native':
        assert 'Style: Default,Arial,13,' in subfile.read_text()


@pytest.mark.parametrize('transcript', [None, {'segments': []}])
def test_missing_caption_transcript_fails_before_encoding(clip,monkeypatch,transcript):
    path,_=clip
    metadata=json.loads(path.read_text())
    captioned=path.parent/'subtitled_1_base_clip_1.mp4';captioned.write_bytes(b'captioned')
    metadata['shorts'][0]['video_url']=f'/videos/{JOB}/{captioned.name}'
    metadata['transcript']=transcript
    path.write_text(json.dumps(metadata))
    monkeypatch.setattr(api,'add_hook_to_video',lambda *args,**kwargs:pytest.fail('must not encode'))
    before=path.read_text()
    response=request('POST','/api/hook',{'job_id':JOB,'clip_index':0,'text':'Hook'})
    assert response.status_code==500
    assert 'Cannot preserve captions' in response.json()['detail']
    assert path.read_text()==before


def test_failed_combined_encode_keeps_the_previous_clip(clip, monkeypatch):
    path, _ = clip
    response = request('POST', '/api/subtitle', {'job_id': JOB, 'clip_index': 0, 'preset': 'native'})
    assert response.status_code == 200
    before = path.read_text()
    previous_url = api.jobs[JOB]['result']['clips'][0]['video_url']
    def fail(*args, **kwargs):
        raise RuntimeError('Encoder failed')
    monkeypatch.setattr(api, 'add_hook_to_video', fail)
    monkeypatch.setattr(api, '_reapply_captions', lambda *args: pytest.fail('must not encode a fallback'))
    response = request('POST', '/api/hook', {'job_id': JOB, 'clip_index': 0, 'text': 'New hook'})
    assert response.status_code == 500
    assert path.read_text() == before
    assert api.jobs[JOB]['result']['clips'][0]['video_url'] == previous_url


# CAPTION-006 / HOOK-001: fine shadow and custom placement persist and reapply.
def test_new_caption_and_hook_settings_are_saved_and_reused(clip, monkeypatch):
    path, burns = clip
    style = {'shadow': 2.5, 'shadow_angle': 135, 'shadow_blur': 3, 'shadow_color': '#112233',
             'shadow_opacity': .8, 'position': 'custom', 'position_y': 33}
    response = request('POST', '/api/subtitle', {'job_id': JOB, 'clip_index': 0, 'style': 'karaoke', **style})
    assert response.status_code == 200, response.text
    saved = json.loads(path.read_text())['shorts'][0]['caption_style']
    assert {k: saved[k] for k in style} == style
    seen = []
    def hook(video, text, out, **kw):
        seen.append(kw)
        Path(out).write_bytes(b'h')
        if kw.get('also'):
            Path(kw['also'][1]).write_bytes(b'c')
    monkeypatch.setattr(api, 'add_hook_to_video', hook)
    response = request('POST', '/api/hook', {'job_id': JOB, 'clip_index': 0, 'text': 'Hi',
                                             'position': 'custom', 'position_x': 12, 'position_y': 80})
    assert response.status_code == 200, response.text
    assert (seen[-1]['position_x'], seen[-1]['position_y']) == (12, 80)
    clip_meta = json.loads(path.read_text())['shorts'][0]
    assert (clip_meta['auto_hook']['position_x'], clip_meta['auto_hook']['position_y']) == (12, 80)
    # Rerenders (recut / reframe) put the hook back at the same custom spot.
    api._recut_hook(clip_meta)(str(path.parent / 'base_clip_1.mp4'))
    assert seen[-1]['position'] == 'custom' and (seen[-1]['position_x'], seen[-1]['position_y']) == (12, 80)
    assert request('POST', '/api/subtitle', {'job_id': JOB, 'clip_index': 0, 'shadow_blur': 11}).status_code == 422
