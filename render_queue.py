"""Observable FIFO for self-host edit renders, independent of an open browser."""
import asyncio
import functools
import inspect
import logging
import math
from pathlib import Path
import time
import uuid
import weakref

from fastapi import HTTPException
from jsonfile import write_json_atomic
import json


class RenderQueue:
    def __init__(self, path, enabled=lambda: True, revision=None):
        self.path = Path(path)
        self.enabled = enabled
        self.revision = revision
        self.semaphores = weakref.WeakKeyDictionary()
        self.tasks = set()
        self.persistence_error = None
        self.records = self.load_history()
        recovered = False
        for record in self.records:
            if record['state'] in ('queued', 'running'):
                record.update(state='failed', error='Backend restarted before this render completed', finished_at=time.time())
                recovered = True
        self.prune_history()
        if recovered and self.enabled():
            self.save()

    def load_history(self):
        try:
            history = json.loads(self.path.read_text())
        except (OSError, ValueError):
            return []
        if not isinstance(history, list):
            return []
        records = []
        identifiers = set()
        for record in history:
            if not isinstance(record, dict):
                continue
            identifier = record.get('id')
            created = record.get('created_at')
            if (not isinstance(identifier, str) or not identifier or identifier in identifiers
                    or record.get('state') not in ('queued', 'running', 'completed', 'failed')
                    or type(created) not in (int, float) or abs(created) > 1e12 or not math.isfinite(created)):
                continue
            if not isinstance(record.get('job_id'), str) or not isinstance(record.get('operation'), str):
                continue
            clip_index = record.get('clip_index')
            if clip_index is not None and (type(clip_index) is not int or clip_index < 0):
                continue
            for field in ('started_at', 'finished_at'):
                value = record.get(field)
                if field in record and (type(value) not in (int, float) or abs(value) > 1e12 or not math.isfinite(value)):
                    record.pop(field)
            if record['state'] in ('completed', 'failed'):
                record.setdefault('finished_at', record.get('started_at', created))
            record['error'] = str(record.get('error') or '')
            identifiers.add(identifier)
            allowed = {'id', 'state', 'operation', 'job_id', 'clip_index',
                       'created_at', 'started_at', 'finished_at', 'error'}
            records.append({key: value for key, value in record.items() if key in allowed})
        return records

    def prune_history(self):
        active = [record for record in self.records if record['state'] in ('queued', 'running')]
        completed = sorted(
            (record for record in self.records if record['state'] not in ('queued', 'running')),
            key=lambda record: record.get('finished_at', record['created_at']))
        self.records = active + completed[-50:]

    def save(self):
        # Queue diagnostics must never turn a successful edit into a failed request.
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            write_json_atomic(str(self.path), self.records, indent=2)
            self.persistence_error = None
        except OSError:
            self.persistence_error = 'Render history could not be saved. Recent status may be lost on restart.'
            logging.getLogger(__name__).exception('Could not persist render queue history')

    def snapshot(self):
        queued = 0
        result = []
        for record in self.records:
            item = dict(record)
            if item['state'] == 'queued':
                queued += 1
                item['position'] = queued
            result.append(item)
        return result

    def track(self, label):
        def decorate(function):
            signature = inspect.signature(function)

            @functools.wraps(function)
            async def wrapped(*args, **kwargs):
                if not self.enabled():
                    return await function(*args, **kwargs)
                arguments = signature.bind(*args, **kwargs).arguments
                request = arguments.get('req')
                record = {
                    'id': uuid.uuid4().hex, 'operation': label,
                    'job_id': getattr(request, 'job_id', ''),
                    'clip_index': getattr(request, 'clip_index', None),
                    'state': 'queued', 'created_at': time.time(),
                }
                expected_revision = self.revision(request) if self.revision else None
                self.records.append(record)
                self.prune_history()
                self.save()
                loop = asyncio.get_running_loop()
                semaphore = self.semaphores.setdefault(loop, asyncio.Semaphore(1))

                async def execute():
                    try:
                        async with semaphore:
                            if expected_revision is not None and self.revision(request) != expected_revision:
                                raise HTTPException(409, 'This clip changed while the edit was queued. Reopen it before applying this edit.')
                            record.update(state='running', started_at=time.time())
                            self.save()
                            result = await function(*args, **kwargs)
                            record.update(state='completed', finished_at=time.time())
                            self.prune_history()
                            self.save()
                            return result
                    except BaseException as error:
                        detail = error.detail if isinstance(error, HTTPException) else 'Render failed. See backend logs.'
                        record.update(state='failed', error=str(detail), finished_at=time.time())
                        self.prune_history()
                        self.save()
                        raise

                task = asyncio.create_task(execute())
                self.tasks.add(task)

                def finished(done):
                    self.tasks.discard(done)
                    if not done.cancelled():
                        done.exception()  # consume failures even if the browser disconnected

                task.add_done_callback(finished)
                return await asyncio.shield(task)

            return wrapped
        return decorate
