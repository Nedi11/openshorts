// Browser exports have their own FIFO because WebCodecs runs in this tab.
let tail = Promise.resolve();
let sequence = 0;
let records = [];
const listeners = new Set();

export function subscribeBrowserRenders(listener) {
  listeners.add(listener);
  listener(records.map(record => ({ ...record })));
  return () => listeners.delete(listener);
}

function notify() {
  const snapshot = records.map(record => ({ ...record }));
  listeners.forEach(listener => listener(snapshot));
}

export function runBrowserRender(params, render) {
  const record = {
    id: `browser-${++sequence}`, operation: 'Browser video export',
    job_id: params.jobId || '', clip_index: params.clipIndex ?? null,
    state: 'queued', created_at: Date.now() / 1000, progress: 0,
  };
  records = [...records.filter(item => ['queued', 'running'].includes(item.state)),
    ...records.filter(item => !['queued', 'running'].includes(item.state)).slice(-8), record];
  notify();
  const task = tail.then(async () => {
    record.state = 'running'; record.started_at = Date.now() / 1000; notify();
    try {
      const result = await render(progress => {
        const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
        if (percent !== record.progress) { record.progress = percent; notify(); }
      });
      record.state = 'completed'; record.progress = 100;
      return result;
    } catch (error) {
      record.state = 'failed'; record.error = error.message || 'Browser render failed';
      throw error;
    } finally {
      record.finished_at = Date.now() / 1000; notify();
    }
  });
  tail = task.catch(() => {});
  return task;
}
