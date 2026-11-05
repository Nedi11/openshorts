import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { subscribeBrowserRenders } from '../lib/browserRenderQueue';

const ACTIVE = new Set(['queued', 'running']);
function elapsed(record, now) {
  const start = record.started_at || record.created_at;
  const seconds = Math.max(0, Math.floor((record.finished_at || now) - start));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function RenderQueue({ enabled }) {
  const [serverRenders, setRenders] = useState([]);
  const [browserRenders, setBrowserRenders] = useState([]);
  const renders = [...serverRenders, ...browserRenders];
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
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
    async function poll() {
      try {
        const response = await apiFetch('/api/render-queue');
        if (!response.ok) throw new Error('Could not refresh render status');
        const data = await response.json();
        if (cancelled) return;
        if (data.renders.some(r => ACTIVE.has(r.state) && !seen.current.has(r.id))) setOpen(true);
        seen.current = new Set(data.renders.map(r => r.id));
        setRenders(data.renders); setError(''); setNow(Date.now() / 1000);
      } catch (e) { if (!cancelled) setError(e.message); }
      if (!cancelled) timer = setTimeout(poll, 2000);
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled]);
  if (!enabled) return null;
  const running = renders.filter(r => r.state === 'running').length;
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
      <span className="text-xs text-muted">{running} running · {queued} queued</span>
      <ChevronDown size={14} />
    </button>
    {open && <div className="border-t border-rule p-3 space-y-3 max-h-[55vh] overflow-y-auto text-xs">
      {error && <p role="alert" className="text-danger">{error}</p>}
      {!renders.length && <p className="text-muted">No edit renders yet. Clip edits, reframing, captions and hooks appear here.</p>}
      {[...active, ...recent].map(render => <div key={render.id} className="border-b border-rule pb-2 space-y-1">
        <p className="font-medium">{render.operation} · clip {render.clip_index == null ? '—' : render.clip_index + 1}</p>
        <p className="text-muted">{render.id.startsWith('browser-') ? 'Browser' : 'Server'} · job {render.job_id.slice(0, 12)} · {elapsed(render, now)}</p>
        <p role="status" className={render.state === 'failed' ? 'text-danger' : 'text-ink2'}>
          {render.state === 'queued' ? `Queued · position ${render.position}` : render.state === 'running' ? `Rendering…${render.progress == null ? '' : ` ${render.progress}%`}` : render.state === 'completed' ? 'Completed' : 'Failed'}
        </p>
        {render.error && <p className="text-danger break-words">{render.error}</p>}
      </div>)}
    </div>}
  </aside>;
}
