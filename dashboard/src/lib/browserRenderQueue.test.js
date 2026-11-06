import test from 'node:test';
import assert from 'node:assert/strict';
import { runBrowserRender, subscribeBrowserRenders } from './browserRenderQueue.js';

test('browser exports queue, report progress and continue after a failure', async () => {
  let snapshot;
  const unsubscribe = subscribeBrowserRenders(records => { snapshot = records; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = runBrowserRender({ jobId: 'job', clipIndex: 2 }, async progress => {
    progress(.5);
    await gate;
    return 'blob:first';
  });
  const second = runBrowserRender({ jobId: 'job', clipIndex: 3 }, async () => { throw new Error('Encoder failed'); });
  const rejected = assert.rejects(second, /Encoder failed/);
  await Promise.resolve();
  assert.equal(snapshot[0].state, 'running');
  assert.equal(snapshot[0].progress, 50);
  assert.equal(snapshot[1].state, 'queued');
  release();
  assert.equal(await first, 'blob:first');
  await rejected;
  const third = runBrowserRender({ jobId: 'job', clipIndex: 4 }, async () => 'blob:third');
  assert.equal(await third, 'blob:third');
  assert.deepEqual(snapshot.map(record => record.state), ['completed', 'failed', 'completed']);
  unsubscribe();
});

test('status listener exceptions cannot fail an export', async () => {
  let broken = false;
  const unsubscribe = subscribeBrowserRenders(() => { if (broken) throw new Error('UI listener failed'); });
  broken = true;
  try {
    assert.equal(await runBrowserRender({ jobId: 'listener', clipIndex: 0 }, async progress => {
      progress(.5);
      return 'blob:ok';
    }), 'blob:ok');
  } finally { broken = false; unsubscribe(); }
});

test('non-finite and backwards progress never corrupt displayed progress', async () => {
  const progressValues = [];
  const unsubscribe = subscribeBrowserRenders(rows => {
    const item = rows.find(row => row.job_id === 'progress');
    if (item) progressValues.push(item.progress);
  });
  try {
    await runBrowserRender({ jobId: 'progress', clipIndex: 0 }, async progress => {
      progress(.7); progress(.2); progress(NaN); progress(Infinity);
    });
    assert.ok(progressValues.every(Number.isFinite));
    assert.ok(progressValues.every((value, index) => index === 0 || value >= progressValues[index - 1]));
  } finally { unsubscribe(); }
});

test('same-clip overlaps are rejected while different clips can queue', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const params = { jobId: 'overlap', clipIndex: 0 };
  const first = runBrowserRender(params, () => gate);
  try {
    const overlap = runBrowserRender(params, async () => 'stale');
    const rejected = assert.rejects(overlap, /already.*render/i);
    release('first');
    await rejected;
    const other = runBrowserRender({ ...params, clipIndex: 1 }, async () => 'other');
    release('first');
    assert.equal(await first, 'first');
    assert.equal(await other, 'other');
    assert.equal(await runBrowserRender(params, async () => 'retry'), 'retry');
  } finally { release(); await first; }
});

test('completed backlogs are bounded even without another submission', async () => {
  let rows;
  const unsubscribe = subscribeBrowserRenders(value => { rows = value; });
  try {
    await Promise.all(Array.from({ length: 15 }, (_, clipIndex) =>
      runBrowserRender({ jobId: 'backlog', clipIndex }, async () => 'done')));
    assert.ok(rows.length <= 8);
    assert.ok(rows.every(row => row.state === 'completed'));
  } finally { unsubscribe(); }
});

test('each subscriber receives an isolated snapshot', async () => {
  let observed;
  const first = subscribeBrowserRenders(rows => { rows.forEach(row => { row.state = 'corrupted'; }); });
  const second = subscribeBrowserRenders(rows => { observed = rows; });
  try {
    await runBrowserRender({ jobId: 'isolated', clipIndex: 0 }, async () => 'done');
    assert.equal(observed.find(row => row.job_id === 'isolated').state, 'completed');
  } finally { first(); second(); }
});

test('queued aborted exports do not invoke encoding and the next export still runs', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = runBrowserRender({ jobId: 'abort', clipIndex: 0 }, () => gate);
  const controller = new AbortController();
  let encoded = false;
  const cancelled = runBrowserRender({ jobId: 'abort', clipIndex: 1, signal: controller.signal }, async () => { encoded = true; });
  const rejected = assert.rejects(cancelled, { name: 'AbortError' });
  controller.abort();
  release('first');
  await first;
  await rejected;
  assert.equal(encoded, false);
  assert.equal(await runBrowserRender({ jobId: 'abort', clipIndex: 2 }, async () => 'next'), 'next');
});

test('cancel button signal stops a running browser export and the next still runs', async () => {
  const {cancelBrowserRender} = await import('./browserRenderQueue.js');
  let snapshot=[];
  const unsubscribe=subscribeBrowserRenders(rows=>{snapshot=rows;});
  const running=runBrowserRender({jobId:'cancel-job',clipIndex:0},(_progress,signal)=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});
  }));
  await Promise.resolve();
  cancelBrowserRender(snapshot.find(r=>r.job_id==='cancel-job').id);
  await assert.rejects(running,/cancelled/);
  assert.equal(snapshot.find(r=>r.job_id==='cancel-job').state,'cancelled');
  assert.equal(await runBrowserRender({jobId:'next-job',clipIndex:0},async()=> 'next'),'next');
  unsubscribe();
});
