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
    downloads: [], captures: [], captureTimestamps: [], statusHistory: [], queryCount: 0, closed: 0,
    scrollX: 0, scrollY: 0, titles: [], injected: [], alive: !config.aliveFails,
  };
  const m = { ...metrics, ...(config.metrics || {}) };
  let listener, commandListener;
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
    action: { async setBadgeBackgroundColor() {}, async setBadgeText() {}, async setTitle(details) { state.titles.push(details.title); } },
    scripting: { async executeScript(details) { state.events.push('inject'); state.injected.push(details); if (config.injectFails) throw new Error('Cannot access contents of the page.'); state.alive = true; } },
    tabs: {
      onUpdated: { addListener(value) { state.onUpdated = value; } },
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
          return { ok: true, data: { ...m } };
        }
        if (message.type === 'MOVE') {
          state.scrollX = message.x;
          state.scrollY = message.y;
          if (config.switchDuringMove) state.activeTab = { ...page, id: 2 };
          if (config.sameDocumentUrlChange) {
            state.activeTab = { ...page, url: `${page.url}?s=${message.y}#section` };
            state.onUpdated(page.id, config.sameDocumentUrlChange === 'loading' ? { url: state.activeTab.url, status: 'loading' } : { url: state.activeTab.url });
          }
          if (config.navigateDuringMove) state.onUpdated(page.id, { status: 'loading' });
          if (config.moveRejects) throw new Error(config.moveRejects);
          const height = config.heightAfterMove ? config.heightAfterMove(message, state) : m.height;
          return { ok: true, data: { ...m, height, x: message.x, y: message.y, anchorShift: config.anchorShift ? config.anchorShift(message) : undefined } };
        }
        if (message.type === 'METRICS') {
          return { ok: true, data: {
            ...m, scrollX: state.scrollX,
            scrollY: state.scrollY + (config.manualScroll ? 15 : 0),
          } };
        }
        if (message.type === 'RESTORE') return { ok: true, data: {} };
        if (message.type === 'ALIVE') {
          if (!state.alive) throw new Error('Could not establish connection. Receiving end does not exist.');
          return { ok: true, data: { capturing: !config.navigateDuringMove } };
        }
        throw new Error(`Unexpected content command ${message.type}`);
      },
      async captureVisibleTab(windowId, captureOptions) {
        state.captureTimestamps.push(Date.now());
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
      async search({ id }) { assert.equal(id, 42); return [{ id, state: config.downloadPending && !state.downloadDone ? 'in_progress' : 'complete' }]; },
      async show() {},
    },
    commands: { onCommand: { addListener(value) { commandListener = value; } } },
  };
  await import(`../extension/background.js?case=${++caseNumber}`);
  assert.equal(typeof listener, 'function');
  const send = message => new Promise(resolve => {
    assert.equal(listener({ target: 'background', ...message }, { id: runtimeID }, resolve), true);
  });
  const settled = () => until(() => state.closed > 0, 'export cleanup');
  return { state, send, settled, shortcut: () => commandListener("export-page") };
}

after(() => {
  if (originalChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = originalChrome;
});

test('successful export restores the page, downloads the PDF, and releases its Blob', async () => {
  const { state, send, settled } = await harness();
  const started = await send({ type: 'EXPORT', options: { quality: 'high' } });
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

test('rapid consecutive viewport exports share Chrome capture throttling across jobs', async () => {
  const { state, send } = await harness();
  for (let exportNumber = 1; exportNumber <= 3; exportNumber++) {
    const response = await send({ type: 'EXPORT', options: { scope: 'viewport' } });
    assert.equal(response.ok, true, response.error);
    await until(() => state.closed === exportNumber, `viewport export ${exportNumber} cleanup`);
    assert.equal(state.session.exportStatus.phase, 'done');
  }
  assert.equal(state.captures.length, 3, 'Each viewport export captures exactly once');
  assert.equal(state.downloads.length, 3);
  for (let index = 1; index < state.captureTimestamps.length; index++) {
    const interval = state.captureTimestamps[index] - state.captureTimestamps[index - 1];
    assert.ok(interval >= 550, `Separate export jobs captured only ${interval} ms apart`);
  }
});

test('a header leaving the flow shortens the page: later tiles are retargeted instead of failing', async () => {
  // Tile 0 sees 1000 px; once scrolled, an 80 px header leaves the flow and the page is 920 px.
  const { state, send, settled } = await harness({ heightAfterMove: (message) => (message.y > 0 ? 920 : 1000) });
  assert.equal((await send({ type: 'EXPORT', options: { hideSticky: true } })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'done', state.session.exportStatus.message);
  const moves = state.content.filter((message) => message.type === 'MOVE').map((message) => message.y);
  assert.deepEqual(moves, [0, 400, 320], 'second tile first lands at 400, sees the shorter page, then re-targets to 320');
  const tiles = state.offscreen.filter((message) => message.type === 'TILE').map((message) => message.tile);
  assert.deepEqual(tiles.map((tile) => [tile.y, tile.cropY]), [[0, 0], [600, 200]]);
  assert.equal(state.captures.length, 2);
  assert.doesNotMatch(state.session.exportStatus.message, /grew/);
});

test('a page that grows while capturing keeps the planned length and says so', async () => {
  const { state, send, settled } = await harness({ heightAfterMove: (message) => (message.y > 0 ? 1300 : 1000) });
  assert.equal((await send({ type: 'EXPORT', options: {} })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'done', state.session.exportStatus.message);
  assert.match(state.session.exportStatus.message, /grew while it was being captured/);
  assert.equal(state.offscreen.find((message) => message.type === 'BEGIN').layout.height, 1000);
});

test('a layout that never settles stops with a clear message', async () => {
  let toggle = 0;
  const { state, send, settled } = await harness({ heightAfterMove: (message) => (message.y > 0 ? (toggle++ % 2 ? 1000 : 900) : 1000) });
  assert.equal((await send({ type: 'EXPORT', options: {} })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'error');
  assert.match(state.session.exportStatus.message, /keeps changing its layout/);
});

test('hash and history changes while scrolling do not stop the export', async () => {
  const { state, send, settled } = await harness({ sameDocumentUrlChange: true });
  assert.equal((await send({ type: 'EXPORT', options: {} })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'done', state.session.exportStatus.message);
  assert.equal(state.captures.length, 2);
});

test('a real navigation (the tab starts loading) stops the export before another screenshot', async () => {
  const { state, send, settled } = await harness({ navigateDuringMove: true });
  assert.equal((await send({ type: 'EXPORT', options: {} })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'error');
  assert.match(state.session.exportStatus.message, /switched tabs, windows, or navigated/);
  assert.equal(state.captures.length, 0);
});

test('moving to another site stops the export even without a loading event', async () => {
  const { state, send, settled } = await harness();
  state.activeTab = { ...page };
  const original = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (tabId, message) => { if (message.type === 'MOVE') state.activeTab = { ...page, url: 'https://evil.example/' }; return original(tabId, message); };
  assert.equal((await send({ type: 'EXPORT', options: {} })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'error');
  assert.equal(state.captures.length, 0);
});

test('a browser that reports "loading" for a hash change still exports while the page script is alive', async () => {
  const { state, send, settled } = await harness({ sameDocumentUrlChange: 'loading' });
  assert.equal((await send({ type: 'EXPORT', options: {} })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'done', state.session.exportStatus.message);
  assert.ok(state.content.some((message) => message.type === 'ALIVE'));
});

test('balanced and compact quality capture JPEG screenshots; only High uses PNG', async () => {
  for (const [quality, expected] of [['balanced', { format: 'jpeg', quality: 92 }], ['compact', { format: 'jpeg', quality: 80 }], ['high', { format: 'png' }]]) {
    const { state, send, settled } = await harness();
    assert.equal((await send({ type: 'EXPORT', options: { quality } })).ok, true);
    await settled();
    assert.equal(state.session.exportStatus.phase, 'done');
    assert.ok(state.captures.every((capture) => JSON.stringify(capture.options) === JSON.stringify(expected)), quality);
  }
});

test('unsupported pages are refused with the shared explanation before anything is injected', async () => {
  for (const [url, pattern] of [['chrome://version', /Settings, Extensions/], ['https://chromewebstore.google.com/detail/x', /web store/i], ['ftp://example.com/', /normal webpages/]]) {
    const { state, send } = await harness();
    state.activeTab = { ...page, url };
    const response = await send({ type: 'EXPORT', options: {} });
    assert.equal(response.ok, false);
    assert.match(response.error, pattern);
    assert.equal(state.injected.length, 0);
  }
});

test('a page whose script is dead after an extension update gets a fresh injection; a live one does not', async () => {
  const dead = await harness({ aliveFails: true });
  assert.equal((await dead.send({ type: 'EXPORT', options: {} })).ok, true);
  await dead.settled();
  assert.equal(dead.state.session.exportStatus.phase, 'done', dead.state.session.exportStatus.message);
  assert.equal(dead.state.injected.length, 2, 'clear the stale guard, then inject content.js');
  assert.deepEqual(dead.state.injected[1].files, ['content.js']);
  const live = await harness();
  assert.equal((await live.send({ type: 'EXPORT', options: {} })).ok, true);
  await live.settled();
  assert.equal(live.state.injected.length, 0);
});

test('a PDF address whose viewer refuses injection explains that it is already a PDF', async () => {
  const { state, send, settled } = await harness({ aliveFails: true, injectFails: true });
  state.activeTab = { ...page, url: 'https://example.com/report.pdf' };
  assert.equal((await send({ type: 'EXPORT', options: {} })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'error');
  assert.match(state.session.exportStatus.message, /PDF/);
  assert.match(state.session.exportStatus.message, /download button/);
});

test('raw browser errors become plain messages with a next step', async () => {
  const { state, send, settled } = await harness({ moveRejects: 'Could not establish connection. Receiving end does not exist.' });
  assert.equal((await send({ type: 'EXPORT', options: {} })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'error');
  assert.match(state.session.exportStatus.message, /lost contact with the page/);
  assert.doesNotMatch(state.session.exportStatus.message, /Receiving end/);
  assert.equal(state.session.exportStatus.error, 'Receiving end does not exist.'.length ? state.session.exportStatus.error : '', 'the raw text is kept in the error field for the problem report');
});

test('a failed keyboard-shortcut export puts the reason in the toolbar tooltip', async () => {
  const { state, shortcut } = await harness();
  state.activeTab = { ...page, url: 'chrome://extensions' };
  await shortcut();
  await until(() => state.session.exportStatus?.phase === 'error', 'the shortcut failure');
  assert.match(state.titles.at(-1), /^webTopdf: Browser pages like Settings/);
});

test('the next export can start as soon as the download was handed to Chrome', async () => {
  const { state, send } = await harness({ downloadPending: true });
  assert.equal((await send({ type: 'EXPORT', options: { scope: 'viewport' } })).ok, true);
  await until(() => state.session.exportStatus?.phase === 'done', 'the first export');
  const second = await send({ type: 'EXPORT', options: { scope: 'viewport' } });
  assert.equal(second.ok, true, second.error);
  await until(() => state.downloads.length === 2, 'the second download');
  state.downloadDone = true;
  await until(() => Object.keys(state.session.pendingDownloads || {}).length === 0 && state.closed > 0, 'both downloads released');
  await new Promise((resolve) => setTimeout(resolve, 300)); // let both background loops finish before the next test swaps the chrome mock
});

test('fixed elements stay visible on the whole first row of a wide page', async () => {
  const { state, send, settled } = await harness({ metrics: { width: 1800, height: 1000, viewportWidth: 800, viewportHeight: 600, innerWidth: 800, innerHeight: 600 } });
  assert.equal((await send({ type: 'EXPORT', options: { hideSticky: true } })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'done', state.session.exportStatus.message);
  const flags = state.content.filter((message) => message.type === 'MOVE').map((message) => message.hideSticky);
  assert.deepEqual(flags, [false, false, false, true, true, true], 'three columns in row 0, three in row 1');
});

test('an absurdly large job is refused before any capture with a clear message', async () => {
  const { state, send, settled } = await harness({ metrics: { width: 1200, height: 100000, viewportWidth: 1200, viewportHeight: 1300, innerWidth: 1200, innerHeight: 1300, devicePixelRatio: 2 } });
  assert.equal((await send({ type: 'EXPORT', options: { quality: 'high' } })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'error');
  assert.match(state.session.exportStatus.message, /too large to turn into a PDF/);
  assert.equal(state.captures.length, 0);
});

test('content inserted above the current position retargets later tiles and warns', async () => {
  const { state, send, settled } = await harness({ anchorShift: (message) => (message.y > 0 ? 120 : 0) });
  assert.equal((await send({ type: 'EXPORT', options: {} })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'done', state.session.exportStatus.message);
  assert.deepEqual(state.content.filter((message) => message.type === 'MOVE').map((message) => message.y), [0, 400, 520]);
  assert.match(state.session.exportStatus.message, /added above your position/);
});

test('a PDF processing process that never answers explains the likely cause', async () => {
  const { state, send, settled } = await harness();
  const original = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = async (message) => (message.type === 'TILE' ? undefined : original(message));
  assert.equal((await send({ type: 'EXPORT', options: {} })).ok, true);
  await settled();
  assert.equal(state.session.exportStatus.phase, 'error');
  assert.match(state.session.exportStatus.message, /did not respond.*Compact quality/);
});
