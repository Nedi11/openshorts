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
