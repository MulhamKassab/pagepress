import test, { after } from 'node:test';
import assert from 'node:assert/strict';

const originalChrome = globalThis.chrome;
let caseNumber = 0;
const runtimeID = 'pagepress-worker-test';
const page = { id: 1, windowId: 1, url: 'https://example.com/article', title: 'Two views test' };
const metrics = {
  width: 800, height: 1000, viewportWidth: 800, viewportHeight: 600,
  innerWidth: 800, innerHeight: 600, title: page.title, url: page.url,
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function until(condition, description) {
  const deadline = Date.now() + 4000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${description}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function harness(config = {}) {
  const state = {
    activeTab: { ...page }, session: {}, local: {}, events: [], content: [], offscreen: [],
    downloads: [], captures: [], statusHistory: [], queryCount: 0, closed: 0,
    scrollX: 0, scrollY: 0,
  };
  let listener;
  function store(name) {
    return {
      async get(key) { return { [key]: state[name][key] }; },
      async set(patch) {
        Object.assign(state[name], patch);
        if (patch.exportStatus) state.statusHistory.push({ ...patch.exportStatus });
      },
      async remove(key) { delete state[name][key]; },
    };
  }
  globalThis.chrome = {
    storage: { session: store('session'), local: store('local') },
    action: { async setBadgeBackgroundColor() {}, async setBadgeText() {} },
    scripting: { async executeScript() { state.events.push('inject'); } },
    tabs: {
      async query() {
        state.queryCount += 1;
        if (config.queryGate) await config.queryGate.promise;
        return [{ ...state.activeTab }];
      },
      async get() { return { ...state.activeTab }; },
      async sendMessage(tabId, message) {
        assert.equal(tabId, page.id);
        assert.equal(message.target, 'content');
        state.content.push(message);
        state.events.push(`content:${message.type}`);
        if (message.type === 'PREPARE') {
          if (config.prepareGate) await config.prepareGate.promise;
          return { ok: true, data: { ...metrics } };
        }
        if (message.type === 'MOVE') {
          state.scrollX = message.x;
          state.scrollY = message.y;
          if (config.switchDuringMove) state.activeTab = { ...page, id: 2 };
          return { ok: true, data: { ...metrics, x: message.x, y: message.y } };
        }
        if (message.type === 'METRICS') {
          return { ok: true, data: {
            ...metrics, scrollX: state.scrollX,
            scrollY: state.scrollY + (config.manualScroll ? 15 : 0),
          } };
        }
        if (message.type === 'RESTORE') return { ok: true, data: {} };
        throw new Error(`Unexpected content command ${message.type}`);
      },
      async captureVisibleTab(windowId, captureOptions) {
        state.captures.push({ windowId, options: captureOptions });
        state.events.push('capture');
        return 'data:image/png;base64,test-screenshot';
      },
    },
    runtime: {
      id: runtimeID,
      getURL: path => `chrome-extension://${runtimeID}/${path}`,
      async getContexts() { return []; },
      onMessage: { addListener(value) { listener = value; } },
      async sendMessage(message) {
        assert.equal(message.target, 'offscreen');
        state.offscreen.push(message);
        state.events.push(`offscreen:${message.type}`);
        if (message.type === 'TILE' && config.failTile) return { ok: false, error: 'Injected PDF assembly failure' };
        if (message.type === 'FINISH') return { ok: true, data: { url: 'blob:pagepress-test/export', bytes: 5000 } };
        return { ok: true, data: {} };
      },
    },
    offscreen: {
      async createDocument() { state.events.push('offscreen:create'); },
      async closeDocument() { state.closed += 1; state.events.push('offscreen:close'); },
    },
    downloads: {
      onChanged: { addListener() {} },
      async download(download) { state.downloads.push(download); state.events.push('download'); return 42; },
      async search({ id }) { assert.equal(id, 42); return [{ id, state: 'complete' }]; },
      async show() {},
    },
    commands: { onCommand: { addListener() {} } },
  };
  await import(`../extension/background.js?case=${++caseNumber}`);
  assert.equal(typeof listener, 'function');
  const send = message => new Promise(resolve => {
    assert.equal(listener({ target: 'background', ...message }, { id: runtimeID }, resolve), true);
  });
  const settled = () => until(() => state.closed > 0, 'export cleanup');
  return { state, send, settled };
}

after(() => {
  if (originalChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = originalChrome;
});

test('successful export restores the page, downloads the PDF, and releases its Blob', async () => {
  const { state, send, settled } = await harness();
  const started = await send({ type: 'EXPORT', options: {} });
  assert.equal(started.ok, true, started.error);
  assert.equal(started.data.started, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'done');
  assert.equal(state.session.exportStatus.progress, 100);
  assert.equal(state.captures.length, 2);
  assert.deepEqual(state.captures, [
    { windowId: 1, options: { format: 'png' } },
    { windowId: 1, options: { format: 'png' } },
  ]);
  assert.deepEqual(state.downloads, [{
    url: 'blob:pagepress-test/export', filename: 'Two views test.pdf',
    saveAs: false, conflictAction: 'uniquify',
  }]);
  const restoreIndex = state.events.indexOf('content:RESTORE');
  assert.ok(restoreIndex >= 0);
  assert.ok(restoreIndex < state.events.indexOf('offscreen:FINISH'), 'Page restoration precedes PDF assembly');
  assert.ok(restoreIndex < state.events.indexOf('download'), 'The page is restored before downloading');
  assert.equal(state.content.filter(message => message.type === 'RESTORE').length, 1);
  assert.equal(state.content.find(message => message.type === 'RESTORE').reset, true);
  assert.deepEqual(state.offscreen.filter(message => message.type === 'RELEASE'), [{
    target: 'offscreen', type: 'RELEASE', url: 'blob:pagepress-test/export',
  }]);
  assert.equal(state.session.pendingDownload, undefined);
  assert.equal(state.closed, 1);
});

test('PDF tile failure restores the selected page and never starts a download', async () => {
  const { state, send, settled } = await harness({ failTile: true });
  const started = await send({ type: 'EXPORT', options: {} });
  assert.equal(started.ok, true, started.error);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'error');
  assert.match(state.session.exportStatus.message, /Injected PDF assembly failure/);
  assert.equal(state.captures.length, 1);
  assert.equal(state.downloads.length, 0);
  assert.equal(state.offscreen.filter(message => message.type === 'ABORT').length, 1);
  assert.deepEqual(state.content.filter(message => message.type === 'RESTORE'), [{
    target: 'content', type: 'RESTORE', reset: true,
  }]);
  assert.ok(!state.offscreen.some(message => message.type === 'FINISH'));
});

test('switching the active tab after movement stops before taking a screenshot', async () => {
  const { state, send, settled } = await harness({ switchDuringMove: true });
  assert.equal((await send({ type: 'EXPORT', options: {} })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'error');
  assert.match(state.session.exportStatus.message, /switched tabs/i);
  assert.equal(state.captures.length, 0, 'Another tab is never captured');
  assert.equal(state.downloads.length, 0);
  assert.equal(state.content.filter(message => message.type === 'RESTORE').length, 1);
  assert.ok(state.offscreen.some(message => message.type === 'ABORT'));
});

test('cancel while preparation is pending restores again after preparation and skips capture', async () => {
  const prepareGate = deferred();
  const { state, send, settled } = await harness({ prepareGate });
  assert.equal((await send({ type: 'EXPORT', options: {} })).ok, true);
  await until(() => state.content.some(message => message.type === 'PREPARE'), 'pending page preparation');
  const canceled = await send({ type: 'CANCEL' });
  assert.equal(canceled.ok, true, canceled.error);
  assert.equal(canceled.data.canceled, true);
  assert.ok(state.content.some(message => message.type === 'RESTORE'), 'Cancellation restores the page immediately');
  prepareGate.resolve();
  await settled();
  assert.equal(state.session.exportStatus.phase, 'canceled');
  assert.equal(state.session.exportStatus.message, 'Export canceled.');
  assert.equal(state.session.exportStatus.error, null);
  assert.equal(state.captures.length, 0);
  assert.equal(state.downloads.length, 0);
  assert.ok(state.content.some(message => message.type === 'RESTORE' && message.reset),
    'Finally restores state if preparation completes after cancellation');
  assert.ok(!state.offscreen.some(message => message.type === 'BEGIN'));
});

test('a second export is rejected while the first is still resolving its active tab', async () => {
  const queryGate = deferred();
  const prepareGate = deferred();
  const { state, send, settled } = await harness({ queryGate, prepareGate });
  const first = send({ type: 'EXPORT', options: {} });
  await until(() => state.queryCount === 1, 'the initial active-tab lookup');
  const second = await send({ type: 'EXPORT', options: {} });
  assert.equal(second.ok, false);
  assert.match(second.error, /already running/i);
  assert.equal(state.queryCount, 1, 'The rejected export never queries or changes another tab');
  queryGate.resolve();
  assert.equal((await first).ok, true);
  await until(() => state.content.some(message => message.type === 'PREPARE'), 'first export preparation');
  assert.equal((await send({ type: 'CANCEL' })).ok, true);
  prepareGate.resolve();
  await settled();
  assert.equal(state.session.exportStatus.phase, 'canceled');
  assert.equal(state.captures.length, 0);
  assert.equal(state.downloads.length, 0);
});

test('manual scrolling before capture stops rather than exporting mismatched pixels', async () => {
  const { state, send, settled } = await harness({ manualScroll: true });
  assert.equal((await send({ type: 'EXPORT', options: {} })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'error');
  assert.match(state.session.exportStatus.message, /scrolled during capture/i);
  assert.equal(state.captures.length, 0);
  assert.equal(state.downloads.length, 0);
  assert.equal(state.content.filter(message => message.type === 'RESTORE').length, 1);
});
