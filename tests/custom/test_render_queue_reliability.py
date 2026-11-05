import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from render_queue import RenderQueue


def record(identifier='1', state='completed'):
    return {'id': identifier, 'state': state, 'job_id': 'job', 'clip_index': 0,
            'operation': 'Edit', 'created_at': 10, 'started_at': 11, 'finished_at': 12}


@pytest.mark.parametrize('history', [{}, [None], [{'id': 'broken'}], [record(), {'state': 'running'}]])
def test_bad_history_does_not_break_startup(tmp_path, history):
    path = tmp_path / 'queue.json'
    path.write_text(json.dumps(history))
    queue = RenderQueue(path)
    assert all(row.get('id') == '1' for row in queue.snapshot())


def test_restart_recovery_is_persisted(tmp_path):
    path = tmp_path / 'queue.json'
    path.write_text(json.dumps([record(state='running')]))
    queue = RenderQueue(path)
    recovered = queue.snapshot()[0]
    assert recovered['state'] == 'failed'
    assert json.loads(path.read_text())[0]['state'] == 'failed'
    assert RenderQueue(path).snapshot()[0]['finished_at'] == recovered['finished_at']


def test_history_write_failure_does_not_fail_actual_render(tmp_path, monkeypatch):
    queue = RenderQueue(tmp_path / 'queue.json')
    def unavailable(*args, **kwargs):
        raise OSError('Disk full')
    monkeypatch.setattr('render_queue.write_json_atomic', unavailable)
    @queue.track('Edit')
    async def render(req):
        return 'rendered successfully'
    assert asyncio.run(render(SimpleNamespace(job_id='job', clip_index=0))) == 'rendered successfully'
    assert queue.snapshot()[0]['state'] == 'completed'


def test_history_write_failure_preserves_original_render_error(tmp_path, monkeypatch):
    queue = RenderQueue(tmp_path / 'queue.json')
    def unavailable(*args, **kwargs):
        raise OSError('Disk full')
    monkeypatch.setattr('render_queue.write_json_atomic', unavailable)
    @queue.track('Edit')
    async def render(req):
        raise HTTPException(409, 'Source expired')
    with pytest.raises(HTTPException) as exc:
        asyncio.run(render(SimpleNamespace(job_id='job', clip_index=0)))
    assert exc.value.status_code == 409
    assert queue.snapshot()[0]['error'] == 'Source expired'


def test_finished_backlog_is_bounded(tmp_path):
    queue = RenderQueue(tmp_path / 'queue.json')
    async def exercise():
        @queue.track('Edit')
        async def render(req):
            await asyncio.sleep(0)
        await asyncio.gather(*(render(SimpleNamespace(job_id='job', clip_index=i)) for i in range(65)))
    asyncio.run(exercise())
    assert len(queue.snapshot()) <= 50


def test_second_same_clip_edit_rejects_a_stale_revision(tmp_path):
    revision = ['original']
    queue = RenderQueue(tmp_path / 'queue.json', revision=lambda req: revision[0])
    async def exercise():
        started, release = asyncio.Event(), asyncio.Event()
        @queue.track('Edit')
        async def render(req):
            started.set()
            await release.wait()
            revision[0] = 'edited'
            return 'first'
        request = SimpleNamespace(job_id='job', clip_index=0)
        first = asyncio.create_task(render(request))
        await started.wait()
        second = asyncio.create_task(render(request))
        await asyncio.sleep(0)
        release.set()
        assert await first == 'first'
        with pytest.raises(HTTPException) as exc:
            await second
        assert exc.value.status_code == 409
        assert queue.snapshot()[1]['state'] == 'failed'
    asyncio.run(exercise())


def test_valid_history_is_salvaged_and_duplicate_ids_are_removed(tmp_path):
    path = tmp_path / 'queue.json'
    bad_date = {**record('bad'), 'created_at': 'yesterday'}
    path.write_text(json.dumps([None, record(), record(), bad_date]))
    assert [row['id'] for row in RenderQueue(path).snapshot()] == ['1']


def test_queue_can_recover_after_storage_becomes_writable(tmp_path, monkeypatch):
    queue = RenderQueue(tmp_path / 'queue.json')
    original = __import__('render_queue').write_json_atomic
    blocked = [True]
    def sometimes_unavailable(*args, **kwargs):
        if blocked[0]: raise PermissionError('Read only')
        return original(*args, **kwargs)
    monkeypatch.setattr('render_queue.write_json_atomic', sometimes_unavailable)
    @queue.track('Edit')
    async def render(req):
        return 'done'
    asyncio.run(render(SimpleNamespace(job_id='job', clip_index=0)))
    assert queue.persistence_error
    blocked[0] = False
    asyncio.run(render(SimpleNamespace(job_id='job', clip_index=1)))
    assert queue.persistence_error is None
    assert len(json.loads(queue.path.read_text())) == 2


def test_cancelling_waiting_http_request_keeps_accepted_edit_queued(tmp_path):
    queue = RenderQueue(tmp_path / 'queue.json')
    async def exercise():
        started, release = asyncio.Event(), asyncio.Event()
        completed = []
        @queue.track('Edit')
        async def render(req):
            if req.clip_index == 0:
                started.set()
                await release.wait()
            completed.append(req.clip_index)
        first = asyncio.create_task(render(SimpleNamespace(job_id='job', clip_index=0)))
        await started.wait()
        second = asyncio.create_task(render(SimpleNamespace(job_id='job', clip_index=1)))
        await asyncio.sleep(0)
        second.cancel()
        with pytest.raises(asyncio.CancelledError): await second
        release.set()
        await first
        await asyncio.gather(*list(queue.tasks))
        assert completed == [0, 1]
        assert all(row['state'] == 'completed' for row in queue.snapshot())
    asyncio.run(exercise())


def test_nullable_timestamps_and_unknown_fields_cannot_break_status(tmp_path):
    path = tmp_path / 'queue.json'
    history = [record(), {**record('2'), 'started_at': None, 'finished_at': None, 'extra': float('inf')},
               {**record('huge'), 'created_at': 10 ** 400}]
    path.write_text(json.dumps(history))
    queue = RenderQueue(path)
    rows = queue.snapshot()
    assert [row['id'] for row in rows] == ['2', '1']
    assert rows[0]['finished_at'] == 10
    json.dumps(rows, allow_nan=False)
