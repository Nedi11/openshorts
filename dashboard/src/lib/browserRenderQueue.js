// Browser exports have their own FIFO because WebCodecs runs in this tab.
let tail = Promise.resolve();
let sequence = 0;
let records = [];
const listeners = new Set();
const ACTIVE = new Set(['queued', 'running']);

function notifyListener(listener) {
  try {
    listener(records.map(record => ({ ...record })));
  } catch (error) {
    // A status consumer must never interrupt encoding or poison the FIFO.
    console.error('Render queue subscriber failed', error);
  }
}

export function subscribeBrowserRenders(listener) {
  listeners.add(listener);
  notifyListener(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach(notifyListener);
}

function pruneHistory() {
  const active = records.filter(record => ACTIVE.has(record.state));
  const completed = records.filter(record => !ACTIVE.has(record.state))
    .sort((left, right) => left.sequence - right.sequence);
  records = [...active, ...completed.slice(-8)];
}

export function isBrowserClipRendering(jobId, clipIndex) {
  return !!jobId && clipIndex != null && records.some(record =>
    ACTIVE.has(record.state) && record.job_id === jobId && record.clip_index === clipIndex);
}

export function runBrowserRender(params, render) {
  if (isBrowserClipRendering(params.jobId, params.clipIndex)) {
    return Promise.reject(new Error('This clip already has a browser render. Wait for it to finish before applying another edit.'));
  }
  const record = {
    id: `browser-${++sequence}`, sequence, operation: 'Browser video export',
    job_id: params.jobId || '', clip_index: params.clipIndex ?? null,
    state: 'queued', created_at: Date.now() / 1000, progress: 0,
  };
  records.push(record);
  pruneHistory();
  notify();
  const task = tail.then(async () => {
    try {
      params.signal?.throwIfAborted();
      record.state = 'running';
      record.started_at = Date.now() / 1000;
      notify();
      const result = await render(progress => {
        if (record.state !== 'running' || !Number.isFinite(progress)) return;
        const percent = Math.max(record.progress, Math.min(100, Math.round(progress * 100)));
        if (percent !== record.progress) {
          record.progress = percent;
          notify();
        }
      });
      record.state = 'completed';
      record.progress = 100;
      return result;
    } catch (error) {
      record.state = 'failed';
      record.error = error?.message || String(error ?? 'Browser render failed');
      throw error;
    } finally {
      record.finished_at = Date.now() / 1000;
      pruneHistory();
      notify();
    }
  });
  tail = task.catch(() => {});
  return task;
}
