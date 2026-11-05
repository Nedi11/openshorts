import asyncio
import json
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
