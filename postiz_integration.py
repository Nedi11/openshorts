"""Personal self-host Postiz adapter. No credentials or arbitrary file URLs from clients."""
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Literal

UTC = timezone.utc
PROVIDERS = {'instagram', 'instagram-standalone'}


def iso(value):
    return value.astimezone(UTC).isoformat().replace('+00:00', 'Z')


def parse_date(value):
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.tzinfo is None:
            raise ValueError()
        return result.astimezone(UTC)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(422, 'A date with a timezone is required')


class ScheduleRequest(BaseModel):
    job_id: str = Field(min_length=1, max_length=100)
    filename: str = Field(min_length=1, max_length=255)
    integration_id: str = Field(min_length=1, max_length=200)
    caption: str = Field(max_length=2200)
    mode: Literal['now', 'time', 'queue', 'after_latest'] = 'queue'
    date: str | None = None
    delay_minutes: int = Field(default=180, ge=1, le=525600)


class PostizClient:
    def __init__(self, base, key):
        self.base = base.rstrip('/')
        parsed = urlsplit(self.base)
        if parsed.scheme not in ('https', 'http') or not parsed.netloc or parsed.username or parsed.query or parsed.fragment:
            raise HTTPException(503, 'Invalid POSTIZ_API_URL')
        self.key = key

    def request(self, method, path, **kwargs):
        # Never follow redirects with a secret header, or echo remote errors/credentials.
        try:
            with httpx.Client(timeout=httpx.Timeout(300, connect=15), follow_redirects=False) as client:
                response = client.request(method, self.base + path,
                                          headers={'Authorization': self.key}, **kwargs)
            if not 200 <= response.status_code < 300:
                raise HTTPException(502, f'Postiz returned HTTP {response.status_code}; check its connection and logs')
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise HTTPException(502, 'Postiz connection failed or returned invalid JSON')

    def accounts(self):
        data = self.request('GET', '/integrations')
        if not isinstance(data, list):
            raise HTTPException(502, 'Unexpected Postiz integrations response')
        return [{'id': x['id'], 'name': x.get('name', x['id']),
                 'provider': x.get('identifier'), 'disabled': bool(x.get('disabled'))}
                for x in data if x.get('identifier') in PROVIDERS]

    def posts(self):
        data = self.request('GET', '/posts', params={
            'startDate': '1970-01-01T00:00:00.000Z', 'endDate': '9999-12-31T23:59:59.000Z'})
        if not isinstance(data, dict) or not isinstance(data.get('posts'), list):
            raise HTTPException(502, 'Unexpected Postiz posts response')
        return data['posts']


def choose_date(req, posts, now, slot=None):
    if req.mode == 'now':
        return now
    if req.mode == 'time':
        date = parse_date(req.date)
    elif req.mode == 'queue':
        date = parse_date(slot)
    else:
        dates = [parse_date(p['publishDate']) for p in posts
                 if (p.get('integration') or {}).get('id') == req.integration_id
                 and p.get('state') == 'QUEUE']
        date = max([now, *dates]) + timedelta(minutes=req.delay_minutes)
    if date <= now:
        raise HTTPException(422, 'Choose a future time (or update the Postiz queue slots)')
    return date


class Scheduler:
    def __init__(self, root, client):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.client = client
        self.db = self.root / '.postiz.sqlite3'
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS schedules (key TEXT PRIMARY KEY, record TEXT NOT NULL)')

    def connect(self):
        return sqlite3.connect(self.db, timeout=310)

    def path(self, job, filename):
        if not re.fullmatch(r'[A-Za-z0-9_-]+', job) or '/' in filename or '\\' in filename or not filename.lower().endswith('.mp4'):
            raise HTTPException(422, 'Invalid clip path')
        path = (self.root / job / filename).resolve()
        if not path.is_relative_to(self.root / job) or not path.is_file():
            raise HTTPException(404, 'Clip file is missing or expired')
        return path

    def key(self, req):
        # One submission per clip variant/account/server, even across retries/restarts.
        raw = [self.client.base, req.job_id, req.filename, req.integration_id]
        return hashlib.sha256(json.dumps(raw).encode()).hexdigest()

    def records(self, job, filename):
        with self.connect() as db:
            records = [json.loads(x[0]) for x in db.execute('SELECT record FROM schedules')]
        return [r for r in records if r['job_id'] == job and r['filename'] == filename]

    def save(self, db, key, record):
        db.execute('INSERT OR REPLACE INTO schedules VALUES (?, ?)', (key, json.dumps(record)))
        db.commit()

    def schedule(self, req):
        # OS file lock serializes date selection + creation across processes/restarts.
        # A durable submitting marker blocks retries after an ambiguous create timeout.
        import fcntl
        with (self.root / '.postiz.lock').open('a') as lock, self.connect() as db:
            fcntl.flock(lock, fcntl.LOCK_EX)
            key = self.key(req)
            old = db.execute('SELECT record FROM schedules WHERE key=?', (key,)).fetchone()
            if old:
                return json.loads(old[0])
            path = self.path(req.job_id, req.filename)
            account = next((x for x in self.client.accounts() if x['id'] == req.integration_id and not x['disabled']), None)
            if not account:
                raise HTTPException(422, 'Select a connected Instagram account')
            local = [json.loads(row[0]) for row in db.execute('SELECT record FROM schedules')]
            pending = [r for r in local if r['integration_id'] == req.integration_id and r['state'] in ('SUBMITTED', 'UNKNOWN')]
            if any(r['state'] == 'UNKNOWN' for r in pending) and req.mode in ('after_latest', 'queue'):
                raise HTTPException(409, 'An earlier submission is uncertain; reconcile it in Postiz before adding to this queue')
            posts = self.client.posts() if req.mode == 'after_latest' else []
            posts += [{'integration': {'id': r['integration_id']}, 'state': 'QUEUE', 'publishDate': r['date']} for r in pending]
            slot = self.client.request('GET', '/find-slot/' + quote(req.integration_id, safe='')).get('date') if req.mode == 'queue' else None
            date = choose_date(req, posts, datetime.now(UTC), slot)
            if req.mode == 'queue' and any(parse_date(r['date']) == date for r in pending):
                raise HTTPException(409, 'Postiz returned a recently reserved slot; refresh Postiz or choose a specific time')
            with path.open('rb') as video:
                media = self.client.request('POST', '/upload', files={'file': (path.name, video, 'video/mp4')}, data={'adjust': 'false'})
            if not isinstance(media, dict) or not media.get('id') or not media.get('path') or media.get('status', 'ready') != 'ready':
                raise HTTPException(502, 'Postiz upload is not ready; no post was submitted')
            if req.mode == 'now':
                date = datetime.now(UTC)
            elif date <= datetime.now(UTC):
                raise HTTPException(422, 'Upload finished after the chosen time; choose a later time')
            record = {'job_id': req.job_id, 'filename': req.filename, 'integration_id': req.integration_id,
                      'date': iso(date), 'state': 'UNKNOWN', 'post_id': None,
                      'message': 'Submission uncertain. Check Postiz before retrying; automatic resubmission is blocked.'}
            self.save(db, key, record)
            payload = {'type': 'now' if req.mode == 'now' else 'schedule', 'date': iso(date),
                       'shortLink': False, 'tags': [], 'posts': [{
                           'integration': {'id': req.integration_id},
                           'value': [{'content': req.caption, 'image': [{'id': media['id'], 'path': media['path']}]}],
                           'settings': {'__type': account['provider'], 'post_type': 'post', 'is_trial_reel': False, 'collaborators': []}}]}
            # Do not retry this call: a timeout can happen after Postiz accepted it.
            try:
                result = self.client.request('POST', '/posts', json=payload)
                entries = result if isinstance(result, list) else [result]
                post_id = entries[0].get('postId') if entries and isinstance(entries[0], dict) else None
                if not post_id:
                    return record
            except HTTPException:
                return record
            record.update(post_id=post_id, state='SUBMITTED', message='Accepted by Postiz; refresh to check publishing status.')
            self.save(db, key, record)
            return record

    def status(self, job, filename):
        records = self.records(job, filename)
        if not records:
            return []
        remote = {p['id']: p for p in self.client.posts()}
        for record in records:
            post = remote.get(record['post_id'])
            if post:
                record.update(state=post.get('state', 'UNKNOWN'), release_url=post.get('releaseURL'),
                              message=post.get('error') or '')
        return records


def create_router(output_dir='output'):
    router = APIRouter(prefix='/api/postiz', tags=['Postiz'])

    def guard(request: Request):
        if os.getenv('BILLING_ENABLED', '').lower() in ('1', 'true', 'yes'):
            raise HTTPException(404, 'Self-host integration only')
        allowed = os.getenv('POSTIZ_ALLOWED_ORIGINS', 'http://localhost:5175,http://127.0.0.1:5175,http://localhost:5173,http://127.0.0.1:5173').split(',')
        origin = request.headers.get('origin')
        if origin and origin not in [x.strip() for x in allowed]:
            raise HTTPException(403, 'Origin not allowed for Postiz')
        if request.headers.get('sec-fetch-site') == 'cross-site':
            raise HTTPException(403, 'Cross-site Postiz requests are blocked')

    def client():
        base, key = os.getenv('POSTIZ_API_URL', ''), os.getenv('POSTIZ_API_KEY', '')
        if not base or not key:
            raise HTTPException(503, 'Set POSTIZ_API_URL and POSTIZ_API_KEY in the backend .env, then recreate the backend')
        return PostizClient(base, key)

    @router.get('/config', dependencies=[Depends(guard)])
    def config():
        return {'configured': bool(os.getenv('POSTIZ_API_URL') and os.getenv('POSTIZ_API_KEY'))}

    @router.get('/accounts', dependencies=[Depends(guard)])
    def accounts():
        api = client()
        dashboard = os.getenv('POSTIZ_DASHBOARD_URL') or api.base.split('/api/')[0]
        return {'accounts': api.accounts(), 'dashboard_url': dashboard}

    @router.post('/schedule', dependencies=[Depends(guard)])
    def schedule(req: ScheduleRequest):
        return Scheduler(output_dir, client()).schedule(req)

    @router.get('/status', dependencies=[Depends(guard)])
    def status(job_id: str, filename: str):
        return {'records': Scheduler(output_dir, client()).status(job_id, filename)}

    return router
