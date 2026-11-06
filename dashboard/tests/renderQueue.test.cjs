const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { JSDOM } = require('jsdom');
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5175' });
global.window = dom.window;
global.document = dom.window.document;
dom.window.HTMLMediaElement.prototype.load = () => {};
global.IS_REACT_ACT_ENVIRONMENT = true;
let RenderQueue;
let RenderQueueSlot;
let ResultCard;
let bundleDirectory;
let container;
let root;
let browserListener;
let browserUnsubscribed;

before(async () => {
  const cache = path.join(__dirname, '../node_modules/.cache');
  fs.mkdirSync(cache, { recursive: true });
  bundleDirectory = fs.mkdtempSync(path.join(cache, 'queue-test-'));
  const outfile = path.join(bundleDirectory, 'component.cjs');
  await build({
    entryPoints: [path.join(__dirname, '../src/components/RenderQueue.jsx')],
    outfile, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react-dom'],
    plugins: [{ name: 'queue-test-adapters', setup(builder) {
      builder.onLoad({ filter: /\/lib\/api\.js$/ }, () => ({ contents:
        'export const apiFetch = (...args) => globalThis.queueTestFetch(...args);' }));
      builder.onLoad({ filter: /\/lib\/browserRenderQueue\.js$/ }, () => ({ contents:
        'export const cancelBrowserRender = id => globalThis.queueTestCancel?.(id); export const subscribeBrowserRenders = listener => globalThis.queueTestSubscribe(listener);' }));
    } }],
  });
  RenderQueue = require(outfile).default;
  RenderQueueSlot = require(outfile).RenderQueueSlot;
  const cardfile = path.join(bundleDirectory, 'card.cjs');
  await build({
    entryPoints: [path.join(__dirname, '../src/components/ResultCard.jsx')],
    outfile: cardfile, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react-dom'],
    plugins: [{ name: 'card-test-adapters', setup(builder) {
      builder.onLoad({ filter: /\/lib\/api\.js$/ }, () => ({ contents:
        'export const apiFetch = (...args) => globalThis.queueTestFetch(...args);' }));
      builder.onLoad({ filter: /\/lib\/analytics\.js$/ }, () => ({ contents: 'export const track = () => {};' }));
      builder.onLoad({ filter: /\/lib\/renderInBrowser\.js$/ }, () => ({ contents:
        'export const renderInBrowser = params => globalThis.queueTestRender(params);' }));
      builder.onLoad({ filter: /\/lib\/browserRenderQueue\.js$/ }, () => ({ contents:
        'export const isBrowserClipRendering = () => false;' }));
      builder.onLoad({ filter: /\/config\.js$/ }, () => ({ contents: 'export const getApiUrl = url => url;' }));
      builder.onLoad({ filter: /\/contexts\/AuthContext\.jsx$/ }, () => ({ contents:
        'export const useAuth = () => ({plan: "free"});' }));
      builder.onLoad({ filter: /\/components\/.+\.jsx$/ }, args => {
        if (path.basename(args.path) === 'ResultCard.jsx') return;
        return { contents: `
        export const watermarkNoticeDismissed = () => true;
        export default function Stub(props) {
          globalThis.queueTestProps[${JSON.stringify(path.basename(args.path))}] = props;
          return null;
        }` };
      });
    } }],
  });
  ResultCard = require(cardfile).default;
});

after(() => { fs.rmSync(bundleDirectory, { recursive: true, force: true }); dom.window.close(); });
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  browserUnsubscribed = false;
  global.queueTestProps = {};
  global.queueTestFetch = async () => ({ ok: true, json: async () => ({ renders: [] }) });
  global.queueTestSubscribe = listener => {
    browserListener = listener;
    listener([]);
    return () => { browserUnsubscribed = true; };
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete global.queueTestFetch;
  delete global.queueTestSubscribe;
  delete global.queueTestProps;
  delete global.queueTestRender;
});

function row(id = 'server-1', state = 'running') {
  return { id, state, operation: 'Re-render clip', job_id: 'job', clip_index: 2,
    created_at: Date.now() / 1000, started_at: Date.now() / 1000 };
}
// The queue shows inside a top-bar slot (RenderQueueSlot), as in App.jsx.
async function mount(enabled = true) {
  await act(async () => { root.render(React.createElement(React.Fragment, null,
    React.createElement('header', { id: 'app-bar' }, React.createElement(RenderQueueSlot)),
    React.createElement(RenderQueue, { enabled }))); });
}
async function tick(context, milliseconds) {
  await act(async () => { context.mock.timers.tick(milliseconds); });
}

test('poll failure marks stale server state and reconnect restores live status', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100000 });
  let unavailable = false;
  const render = row();
  global.queueTestFetch = async () => {
    if (unavailable) throw new Error('offline');
    return { ok: true, json: async () => ({ renders: [render] }) };
  };
  await mount();
  await act(async () => container.querySelector("button").click());
  assert.match(container.textContent, /1 running/);
  unavailable = true;
  await tick(context, 2000);
  assert.match(container.textContent, /Server unavailable/);
  assert.match(container.textContent, /Last seen running/);
  assert.doesNotMatch(container.textContent, /Rendering…/);
  unavailable = false;
  render.state = 'completed'; render.finished_at = 103;
  await tick(context, 2000);
  assert.doesNotMatch(container.textContent, /Server unavailable/);
  assert.match(container.textContent, /Completed/);
});

test('browser elapsed time advances when the server is unavailable and collapse stays closed', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100000 });
  global.queueTestFetch = async () => { throw new Error('offline'); };
  await mount();
  await act(async () => container.querySelector("button").click());
  const browser = { ...row('browser-1'), progress: 20 };
  await act(async () => browserListener([browser]));
  assert.match(container.textContent, /0m 0s/);
  await tick(context, 3000);
  assert.match(container.textContent, /0m 3s/);
  const toggle = container.querySelector('button');
  await act(async () => toggle.click());
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  await act(async () => browserListener([{ ...browser, progress: 40 }]));
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('stalled poll times out, retries and aborts pending requests on unmount', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100000 });
  const signals = [];
  global.queueTestFetch = (url, { signal }) => {
    signals.push(signal);
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  };
  await mount();
  await act(async () => container.querySelector("button").click());
  await tick(context, 10000);
  assert.equal(signals[0].aborted, true);
  assert.match(container.textContent, /Server unavailable/);
  await tick(context, 2000);
  assert.equal(signals.length, 2);
  await act(async () => root.unmount());
  assert.equal(signals[1].aborted, true);
  assert.equal(browserUnsubscribed, true);
  root = createRoot(container);
});

test('disabled panel makes no server requests', async () => {
  let calls = 0;
  global.queueTestFetch = async () => { calls += 1; };
  await mount(false);
  assert.equal(calls, 0);
  assert.equal(container.textContent, '');
});


test('queued positions, clip numbers and storage warnings are visible', async () => {
  global.queueTestFetch = async () => ({ ok: true, json: async () => ({
    renders: [{ ...row('server-queued', 'queued'), position: 2 }],
    warning: 'Render history could not be saved.',
  }) });
  await mount();
  await act(async () => container.querySelector("button").click());
  assert.match(container.textContent, /clip 3/);
  assert.match(container.textContent, /Queued · position 2/);
  assert.match(container.textContent, /Render history could not be saved/);
  assert.ok(container.querySelector('[aria-label="Queue warning"]'));
});


test('overlapping card edits cannot mutate layers while an export is pending', async () => {
  const requests = [];
  let release;
  global.queueTestRender = params => {
    requests.push(params);
    return new Promise(resolve => { release = resolve; });
  };
  await act(async () => root.render(React.createElement(ResultCard, {
    jobId: 'job', index: 0, clip: {start: 0, end: 2, video_url: '/videos/job/clip.mp4'},
  })));
  let caption;
  await act(async () => {
    caption = global.queueTestProps['SubtitleModal.jsx'].onGenerate({ style: 'classic', remotion: { captions: [] } });
  });
  assert.equal(requests.length, 1);
  await act(async () => global.queueTestProps['HookModal.jsx'].onGenerate({ remotion: { text: 'new hook' } }));
  assert.equal(requests.length, 1);
  assert.match(container.textContent, /already rendering/);
  await act(async () => { release('blob:caption'); await caption; });
  assert.doesNotMatch(container.textContent, /already rendering/);
  let hook;
  await act(async () => { hook = global.queueTestProps['HookModal.jsx'].onGenerate({ remotion: { text: 'new hook' } }); });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].subtitles, { captions: [] });
  await act(async () => { release('blob:hook'); await hook; });
});

test('new renders never expand the collapsed queue', async () => {
  await mount();
  const toggle = container.querySelector('button');
  await act(async () => browserListener([row('browser-new')]));
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  await act(async () => toggle.click());
  let cancelled;
  global.queueTestCancel = id => { cancelled=id; };
  await act(async () => [...container.querySelectorAll('button')].find(b=>b.textContent==='Cancel render').click());
  assert.equal(cancelled,'browser-new');
  delete global.queueTestCancel;
});

test('the queue sits inside the top bar, covers nothing until opened, and moves to the editor bar', async () => {
  globalThis.queueTestFetch = async () => ({ ok: true, json: async () => ({ renders: [] }) });
  function Page({ editor }) {
    return React.createElement(React.Fragment, null,
      React.createElement('header', { id: 'app-bar' }, React.createElement(RenderQueueSlot)),
      editor && React.createElement('div', { id: 'editor-bar' }, React.createElement(RenderQueueSlot)),
      React.createElement(RenderQueue, { enabled: true }));
  }
  await act(async () => { root.render(React.createElement(Page, { editor: false })); });
  const queue = () => container.querySelector('[aria-label="Render queue"]');
  assert.equal(queue().closest('header').id, 'app-bar');
  assert.ok(!queue().outerHTML.includes('fixed'));          // no floating overlay
  assert.equal(queue().querySelectorAll('p').length, 0);    // collapsed: just the button
  await act(async () => { root.render(React.createElement(Page, { editor: true })); });
  assert.ok(queue().closest('#editor-bar'));
  await act(async () => { root.render(React.createElement(Page, { editor: false })); });
  assert.equal(queue().closest('header').id, 'app-bar');
  // Opening drops the list below the button; an outside click closes it.
  await act(async () => { queue().querySelector('button').click(); });
  assert.ok(queue().querySelector('.absolute'));
  await act(async () => { document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })); });
  assert.equal(queue().querySelector('.absolute'), null);
});
