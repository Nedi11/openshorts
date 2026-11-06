import React, { useEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronDown, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { subscribeBrowserRenders, cancelBrowserRender } from '../lib/browserRenderQueue';

const ACTIVE = new Set(['queued', 'running', 'cancelling']);
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
  if (record.state === 'cancelled') return 'Cancelled';
  if (record.state === 'cancelling') return 'Cancelling…';
  return record.state === 'completed' ? 'Completed' : 'Failed';
}

// The queue lives INSIDE a top bar instead of floating over the page, which
// covered the header's own controls and dropdowns. Each top bar renders a
// RenderQueueSlot; the queue shows in the most recently mounted one (the clip
// editor's header while it is open, else the app header). One queue instance,
// so polling and cancel state are shared.
const slots = [];
const slotListeners = new Set();
const notifySlots = () => slotListeners.forEach((listener) => listener());

export function RenderQueueSlot() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    slots.push(el);
    notifySlots();
    return () => { slots.splice(slots.indexOf(el), 1); notifySlots(); };
  }, []);
  return <div ref={ref} className="relative shrink-0" data-render-queue-slot="" />;
}

function useTopSlot() {
  const [, rerender] = useReducer((x) => x + 1, 0);
  useEffect(() => { slotListeners.add(rerender); rerender(); return () => { slotListeners.delete(rerender); }; }, []);
  return slots[slots.length - 1] || null;
}

export default function RenderQueue({ enabled }) {
  const slot = useTopSlot();
  const panelRef = useRef(null);
  const [serverRenders, setRenders] = useState([]);
  const [browserRenders, setBrowserRenders] = useState([]);
  const renders = [...serverRenders, ...browserRenders];
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [serverObservedAt, setServerObservedAt] = useState(Date.now() / 1000);
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => subscribeBrowserRenders(records => {
    setBrowserRenders(records);
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
  async function cancelRender(record) {
    try {
      if (record.id.startsWith('browser-')) cancelBrowserRender(record.id);
      else {
        const response = await apiFetch(`/api/render-queue/${record.id}/cancel`, {method:'POST'});
        if (!response.ok) throw new Error('Could not cancel render');
        const data = await response.json();
        setRenders(records => records.map(r => r.id === record.id ? data.render : r));
      }
    } catch (e) { setError(e.message); }
  }
  // Close the dropdown on an outside click or Escape, like the header's menus.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const hasActive = renders.some(record => ACTIVE.has(record.state));
  useEffect(() => {
    if (!enabled || !hasActive) return undefined;
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, [enabled, hasActive]);
  if (!enabled || !slot) return null;
  const running = renders.filter(r => r.state === 'running' && (!error || r.id.startsWith('browser-'))).length;
  const queued = renders.filter(r => r.state === 'queued').length;
  let browserPosition = 0;
  const active = renders.filter(r => ACTIVE.has(r.state)).map(record => {
    if (record.id.startsWith('browser-') && record.state === 'queued') return { ...record, position: ++browserPosition };
    return record;
  });
  const recent = renders.filter(r => !ACTIVE.has(r.state)).sort((a, b) => b.finished_at - a.finished_at).slice(0, 8);
  return createPortal(<aside ref={panelRef} aria-label="Render queue">
    <button type="button" className="flex items-center gap-1.5 rounded-input border border-rule2 px-2.5 py-1.5 text-xs text-ink2 hover:bg-paper3 transition-colors" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      {running > 0 && <Loader2 size={13} className="animate-spin" />}
      <span>Render queue</span>
      <span className="text-muted hidden sm:inline">{error ? '· Server unavailable' : `· ${running} running · ${queued} queued`}</span>
      {!error && running + queued > 0 && <span className="text-muted sm:hidden">· {running + queued}</span>}
      {(error || warning) && <AlertTriangle size={13} className="text-warn" aria-label="Queue warning" />}
      <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
    </button>
    {open && <div className="absolute right-0 top-full mt-2 z-[130] w-80 max-w-[calc(100vw-24px)] rounded-card border border-rule bg-paper shadow-lg p-3 space-y-3 max-h-[55vh] overflow-y-auto text-xs">
      {error && <p role="alert" className="text-danger">{error}</p>}
      {warning && <p role="alert" className="text-warn">{warning}</p>}
      {!renders.length && <p className="text-muted">No edit renders yet. Clip edits, reframing, captions and hooks appear here.</p>}
      {[...active, ...recent].map(render => <div key={render.id} className="border-b border-rule pb-2 space-y-1">
        <p className="font-medium">{render.operation} · clip {render.clip_index == null ? '—' : render.clip_index + 1}</p>
        <p className="text-muted">{render.id.startsWith('browser-') ? 'Browser' : 'Server'} · job {render.job_id.slice(0, 12)} · {elapsed(render, error && !render.id.startsWith('browser-') ? serverObservedAt : now)}</p>
        <p role="status" className={render.state === 'failed' ? 'text-danger' : 'text-ink2'}>
          {renderStatus(render, !!error)}
        </p>
        {['queued', 'running'].includes(render.state) && <button type="button" className="btn-ghost" onClick={() => cancelRender(render)}>Cancel render</button>}
        {render.error && <p className="text-danger break-words">{render.error}</p>}
      </div>)}
    </div>}
  </aside>, slot);
}
