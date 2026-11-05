from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import threading
import time

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from postiz_integration import Scheduler, ScheduleRequest, choose_date, create_router, PostizClient

NOW = datetime(2026, 11, 5, 12, tzinfo=timezone.utc)

def req(**kw):
    return ScheduleRequest(job_id='job-1', filename='clip.mp4', integration_id='ig', caption='Caption', **kw)

class Fake:
    base = 'https://postiz.example/api/public/v1'
    def __init__(self):
        self.calls = []
        self.remote = []
        self.uncertain = False
    def accounts(self):
        return [{'id': 'ig', 'provider': 'instagram-standalone', 'disabled': False}]
    def posts(self):
        return self.remote
    def request(self, method, path, **kw):
        self.calls.append((path, kw))
        if path == '/upload':
            assert kw['files']['file'][1].read() == b'video'
            return {'id': 'media', 'path': 'https://postiz.example/uploads/clip.mp4'}
        if path == '/posts':
            time.sleep(.02)
            if self.uncertain:
                raise HTTPException(502, 'timeout')
            return [{'postId': 'post-1', 'integration': 'ig'}]
        return {'date': '2030-01-01T12:00:00Z'}

@pytest.fixture
def scheduler(tmp_path):
    (tmp_path/'job-1').mkdir()
    (tmp_path/'job-1'/'clip.mp4').write_bytes(b'video')
    return Scheduler(tmp_path, Fake())

def test_modes_timezone_and_latest():
    assert choose_date(req(mode='now'), [], NOW) == NOW
    assert choose_date(req(mode='time', date='2026-11-05T15:00:00+02:00'), [], NOW) == NOW+timedelta(hours=1)
    posts = [{'integration': {'id': 'ig'}, 'state': 'QUEUE', 'publishDate': '2026-11-06T12:00:00Z'},
             {'integration': {'id': 'other'}, 'state': 'QUEUE', 'publishDate': '2030-01-01T12:00:00Z'},
             {'integration': {'id': 'ig'}, 'state': 'DRAFT', 'publishDate': '2030-01-01T12:00:00Z'}]
    assert choose_date(req(mode='after_latest', delay_minutes=60), posts, NOW) == NOW+timedelta(days=1,hours=1)
    assert choose_date(req(mode='after_latest'), [], NOW) == NOW+timedelta(hours=3)
    assert choose_date(req(mode='queue'), [], NOW, '2026-11-06T12:00:00Z') == NOW+timedelta(days=1)

@pytest.mark.parametrize('date', ['2026-11-05T10:00:00Z', '2026-11-06T10:00:00', 'bad', None])
def test_bad_or_past_time(date):
    with pytest.raises(HTTPException):
        choose_date(req(mode='time', date=date), [], NOW)

def test_upload_precedes_create_and_retries_persist(scheduler):
    first = scheduler.schedule(req(mode='now'))
    again = Scheduler(scheduler.root, scheduler.client).schedule(req(mode='now'))
    assert first == again and first['post_id'] == 'post-1'
    assert [p for p,_ in scheduler.client.calls] == ['/upload','/posts']
    payload = scheduler.client.calls[1][1]['json']
    assert payload['posts'][0]['settings']['__type'] == 'instagram-standalone'
    assert payload['posts'][0]['value'][0]['image'][0]['id'] == 'media'
    assert payload['type'] == 'now'

def test_concurrent_duplicate_only_creates_once(scheduler):
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: scheduler.schedule(req(mode='now')), range(2)))
    assert results[0] == results[1]
    assert sum(p == '/posts' for p,_ in scheduler.client.calls) == 1

def test_ambiguous_create_never_retried(scheduler):
    scheduler.client.uncertain = True
    assert scheduler.schedule(req(mode='now'))['state'] == 'UNKNOWN'
    assert scheduler.schedule(req(mode='now'))['state'] == 'UNKNOWN'
    assert sum(p == '/posts' for p,_ in scheduler.client.calls) == 1

@pytest.mark.parametrize('job,name', [('../escape','clip.mp4'),('job-1','../secret.mp4'),('job-1','/etc/passwd'),('job-1','secret.txt')])
def test_paths_rejected(scheduler, job, name):
    with pytest.raises(HTTPException): scheduler.path(job, name)

def test_symlink_rejected(scheduler, tmp_path):
    target = tmp_path.parent/'outside.mp4'; target.write_bytes(b'outside')
    (tmp_path/'job-1'/'link.mp4').symlink_to(target)
    with pytest.raises(HTTPException): scheduler.path('job-1', 'link.mp4')

def test_status(scheduler):
    scheduler.schedule(req(mode='now'))
    scheduler.client.remote = [{'id': 'post-1', 'state': 'PUBLISHED', 'releaseURL': 'https://instagram.com/reel/1'}]
    assert scheduler.status('job-1','clip.mp4')[0]['state'] == 'PUBLISHED'
    scheduler.client.remote[0].update(state='ERROR', error='Disconnected')
    assert scheduler.status('job-1','clip.mp4')[0]['message'] == 'Disconnected'

def test_guard_config_and_secret(monkeypatch,tmp_path):
    monkeypatch.delenv('BILLING_ENABLED', raising=False)
    monkeypatch.setenv('POSTIZ_API_KEY', 'do-not-expose')
    monkeypatch.setenv('POSTIZ_API_URL', 'https://postiz.example/api/public/v1')
    app=FastAPI();app.include_router(create_router(tmp_path));c=TestClient(app)
    assert c.get('/api/postiz/config').json() == {'configured': True}
    assert c.get('/api/postiz/config', headers={'Origin':'https://evil.example'}).status_code == 403
    monkeypatch.setenv('BILLING_ENABLED','true')
    assert c.get('/api/postiz/config').status_code == 404
    monkeypatch.delenv('BILLING_ENABLED');monkeypatch.delenv('POSTIZ_API_KEY')
    assert c.get('/api/postiz/accounts').status_code == 503

def test_schedule_endpoint_and_local_origin(monkeypatch,tmp_path):
    monkeypatch.delenv('BILLING_ENABLED', raising=False)
    monkeypatch.setenv('POSTIZ_API_KEY','private-key')
    monkeypatch.setenv('POSTIZ_API_URL',Fake.base)
    fake=Fake()
    monkeypatch.setattr('postiz_integration.PostizClient',lambda base,key:fake)
    (tmp_path/'job-1').mkdir();(tmp_path/'job-1'/'clip.mp4').write_bytes(b'video')
    app=FastAPI();app.include_router(create_router(tmp_path));c=TestClient(app)
    body=req(mode='now').model_dump()
    assert c.post('/api/postiz/schedule',json=body,headers={'Origin':'https://evil.example'}).status_code == 403
    assert not fake.calls
    response=c.post('/api/postiz/schedule',json=body,headers={'Origin':'http://localhost:5175'})
    assert response.status_code == 200 and response.json()['post_id'] == 'post-1'
    assert 'private-key' not in response.text
    assert c.post('/api/postiz/schedule',json={**body,'mode':'invalid'}).status_code == 422


def test_after_latest_uses_accepted_local_posts(scheduler):
    first=scheduler.schedule(req(mode='time',date='2030-01-01T12:00:00Z'))
    (scheduler.root/'job-1'/'second.mp4').write_bytes(b'video')
    second=req(mode='after_latest',delay_minutes=60).model_copy(update={'filename':'second.mp4'})
    result=scheduler.schedule(second)
    assert result['date'] == '2030-01-01T13:00:00Z'


def test_queue_collision_detected(scheduler):
    scheduler.schedule(req(mode='queue'))
    (scheduler.root/'job-1'/'second.mp4').write_bytes(b'video')
    with pytest.raises(HTTPException) as exc:
        scheduler.schedule(req(mode='queue').model_copy(update={'filename':'second.mp4'}))
    assert exc.value.status_code == 409


def test_upload_failure_never_creates_post(scheduler):
    original=scheduler.client.request
    def failed(method,path,**kw):
        if path == '/upload': raise HTTPException(502,'Upload failed')
        return original(method,path,**kw)
    scheduler.client.request=failed
    with pytest.raises(HTTPException): scheduler.schedule(req(mode='now'))
    assert not scheduler.records('job-1','clip.mp4')
    assert all(p != '/posts' for p,_ in scheduler.client.calls)


def test_client_auth_and_error_redaction(monkeypatch):
    def handle(request):
        assert request.headers['Authorization'] == 'private-key'
        assert str(request.url) == 'https://postiz.example/api/public/v1/integrations'
        return httpx.Response(401,text='private-key must never leak')
    real=httpx.Client
    monkeypatch.setattr('postiz_integration.httpx.Client', lambda **kw: real(transport=httpx.MockTransport(handle),**kw))
    with pytest.raises(HTTPException) as exc:
        PostizClient(Fake.base,'private-key').accounts()
    assert 'private-key' not in exc.value.detail
