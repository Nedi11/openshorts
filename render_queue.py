"""Observable FIFO for self-host edit renders, independent of an open browser."""
import asyncio
import functools
import inspect
from pathlib import Path
import time
import uuid
import weakref

from fastapi import HTTPException
from jsonfile import write_json_atomic
import json


class RenderQueue:
    def __init__(self, path, enabled=lambda: True):
        self.path = Path(path)
        self.enabled = enabled
        self.semaphores = weakref.WeakKeyDictionary()
        self.tasks = set()
        try:
            self.records = json.loads(self.path.read_text())
        except (OSError, ValueError):
            self.records = []
        for record in self.records:
            if record['state'] in ('queued', 'running'):
                record.update(state='failed', error='Backend restarted before this render completed', finished_at=time.time())

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_json_atomic(str(self.path), self.records, indent=2)

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
                # Keep all active tasks and the last 50 results.
                completed = [r for r in self.records if r['state'] not in ('queued', 'running')]
                self.records = [r for r in self.records if r['state'] in ('queued', 'running')] + completed[-50:] + [record]
                self.save()
                loop = asyncio.get_running_loop()
                semaphore = self.semaphores.setdefault(loop, asyncio.Semaphore(1))

                async def execute():
                    try:
                        async with semaphore:
                            record.update(state='running', started_at=time.time())
                            self.save()
                            result = await function(*args, **kwargs)
                            record.update(state='completed', finished_at=time.time())
                            self.save()
                            return result
                    except BaseException as error:
                        detail = error.detail if isinstance(error, HTTPException) else 'Render failed. See backend logs.'
                        record.update(state='failed', error=str(detail), finished_at=time.time())
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
