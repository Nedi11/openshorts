import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { subscribeBrowserRenders } from '../lib/browserRenderQueue';

const ACTIVE = new Set(['queued', 'running']);
function elapsed(record, now) {
  const start = record.started_at || record.created_at;
  const seconds = Math.max(0, Math.floor((record.finished_at || now) - start));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function renderStatus(record, serverUnavailable) {
  if (serverUnavailable && !record.id.startsWith('browser-') && ACTIVE.has(record.state)) {
    return `Last seen ${record.state}`;
  }
  if (record.state === 'queued') return `Queued · position ${record.position}`;
  if (record.state === 'running') {
    return record.progress == null ? 'Rendering…' : `Rendering… ${record.progress}%`;
  }
  return record.state === 'completed' ? 'Completed' : 'Failed';
}

export default function RenderQueue({ enabled }) {
  const [serverRenders, setRenders] = useState([]);
  const [browserRenders, setBrowserRenders] = useState([]);
  const renders = [...serverRenders, ...browserRenders];
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [serverObservedAt, setServerObservedAt] = useState(Date.now() / 1000);
  const [now, setNow] = useState(Date.now() / 1000);
  const seen = useRef(new Set());
  const browserSeen = useRef(new Set());
  useEffect(() => subscribeBrowserRenders(records => {
    setBrowserRenders(records);
    if (records.some(record => ACTIVE.has(record.state) && !browserSeen.current.has(record.id))) setOpen(true);
    browserSeen.current = new Set(records.map(record => record.id));
  }), []);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer;
    let controller;
    async function poll() {
      controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await apiFetch('/api/render-queue', { signal: controller.signal });
        if (!response.ok) throw new Error('Could not refresh render status');
        const data = await response.json();
        if (cancelled) return;
        if (!Array.isArray(data.renders)) throw new Error('Invalid render status response');
        if (data.renders.some(r => ACTIVE.has(r.state) && !seen.current.has(r.id))) setOpen(true);
        seen.current = new Set(data.renders.map(r => r.id));
        setRenders(data.renders);
        setWarning(data.warning || '');
        setError('');
        setServerObservedAt(Date.now() / 1000);
        setNow(Date.now() / 1000);
      } catch {
        if (!cancelled) setError('Server status unavailable. Last known server states are shown.');
      } finally {
        clearTimeout(deadline);
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); controller?.abort(); };
  }, [enabled]);
  const hasActive = renders.some(record => ACTIVE.has(record.state));
  useEffect(() => {
    if (!enabled || !hasActive) return undefined;
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, [enabled, hasActive]);
  if (!enabled) return null;
  const running = renders.filter(r => r.state === 'running' && (!error || r.id.startsWith('browser-'))).length;
  const queued = renders.filter(r => r.state === 'queued').length;
  let browserPosition = 0;
  const active = renders.filter(r => ACTIVE.has(r.state)).map(record => {
    if (record.id.startsWith('browser-') && record.state === 'queued') return { ...record, position: ++browserPosition };
    return record;
  });
  const recent = renders.filter(r => !ACTIVE.has(r.state)).sort((a, b) => b.finished_at - a.finished_at).slice(0, 8);
  return <aside className="fixed top-16 right-3 z-[130] w-72 max-w-[calc(100vw-24px)] rounded-card border border-rule bg-paper shadow-lg" aria-label="Render queue">
    <button type="button" className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      <span className="flex items-center gap-2">{running > 0 && <Loader2 size={14} className="animate-spin" />}Render queue</span>
      <span className="text-xs text-muted">{error ? 'Server unavailable' : `${running} running · ${queued} queued`}</span>
      {(error || warning) && <AlertTriangle size={14} className="text-warn" aria-label="Queue warning" />}
      <ChevronDown size={14} />
    </button>
    {open && <div className="border-t border-rule p-3 space-y-3 max-h-[55vh] overflow-y-auto text-xs">
      {error && <p role="alert" className="text-danger">{error}</p>}
      {warning && <p role="alert" className="text-warn">{warning}</p>}
      {!renders.length && <p className="text-muted">No edit renders yet. Clip edits, reframing, captions and hooks appear here.</p>}
      {[...active, ...recent].map(render => <div key={render.id} className="border-b border-rule pb-2 space-y-1">
        <p className="font-medium">{render.operation} · clip {render.clip_index == null ? '—' : render.clip_index + 1}</p>
        <p className="text-muted">{render.id.startsWith('browser-') ? 'Browser' : 'Server'} · job {render.job_id.slice(0, 12)} · {elapsed(render, error && !render.id.startsWith('browser-') ? serverObservedAt : now)}</p>
        <p role="status" className={render.state === 'failed' ? 'text-danger' : 'text-ink2'}>
          {renderStatus(render, !!error)}
        </p>
        {render.error && <p className="text-danger break-words">{render.error}</p>}
      </div>)}
    </div>}
  </aside>;
}
