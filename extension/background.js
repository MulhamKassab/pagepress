import { normalizeOptions, planTiles, pdfLayout, safeFilename } from './lib/geometry.js';

let job = null, starting = false, creatingOffscreen = null, downloadUpdates = Promise.resolve();
// Chrome's capture quota applies to the extension, including consecutive exports.
const CAPTURE_INTERVAL_MS = 550;
let lastCaptureAt = 0;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const activePhases = ['preparing', 'capturing', 'assembling', 'saving'];

async function publish(patch) {
  const previous = (await chrome.storage.session.get('exportStatus')).exportStatus || {};
  const status = { ...previous, ...patch, updatedAt: Date.now() };
  await chrome.storage.session.set({ exportStatus: status });
  const active = activePhases.includes(status.phase);
  await chrome.action.setBadgeBackgroundColor({ color: status.phase === 'error' ? '#b34243' : '#476fdf' });
  await chrome.action.setBadgeText({ text: active ? `${status.progress || 0}%` : status.phase === 'error' ? '!' : '' });
  return status;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || '') && !/^file:\/\//i.test(tab.url || '')) throw new Error('Open a normal webpage first. Chrome pages, the Web Store, and the built-in PDF viewer cannot be exported.');
  return tab;
}
async function ensureActive(currentJob) {
  if (currentJob.cancelled) throw new Error('Export canceled.');
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id !== currentJob.tab.id || tab?.windowId !== currentJob.tab.windowId || (tab.url && tab.url !== currentJob.tab.url)) throw new Error('Export stopped because you switched tabs, windows, or navigated. Return to the page and export again.');
}
async function inject(tabId) {
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); }
  catch (error) { throw new Error(/^file:/.test((await chrome.tabs.get(tabId)).url || '') ? 'Enable “Allow access to file URLs” in webTopdf extension details to export local files.' : 'Chrome does not allow webTopdf to run on this page. Try a normal webpage.'); }
}
async function content(tabId, type, values = {}) {
  const result = await chrome.tabs.sendMessage(tabId, { target: 'content', type, ...values });
  if (!result?.ok) throw new Error(result?.error || 'The page did not respond. Reload it and try again.');
  return result.data;
}
async function offscreen(type, data = {}) {
  const result = await chrome.runtime.sendMessage({ target: 'offscreen', type, ...data });
  if (!result?.ok) throw new Error(result?.error || 'PDF processing did not respond. Please try again.');
  return result.data;
}
async function ensureOffscreen() {
  const documentUrl = chrome.runtime.getURL('offscreen.html');
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [documentUrl] });
  if (contexts.length) return;
  if (!creatingOffscreen) creatingOffscreen = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Assemble page screenshots into a PDF locally and create a Blob URL for the download.' }).finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}
function updateDownloads(change) {
  const update = downloadUpdates.then(async () => {
    const pending = (await chrome.storage.session.get('pendingDownloads')).pendingDownloads || {};
    change(pending);
    await chrome.storage.session.set({ pendingDownloads: pending });
    return Object.keys(pending).length;
  });
  downloadUpdates = update.catch(() => {});
  return update;
}
const rememberDownload = (id, url) => updateDownloads((pending) => { pending[id] = url; });
const forgetDownload = (id) => updateDownloads((pending) => { delete pending[id]; });
async function closeOffscreenIfIdle() {
  await downloadUpdates;
  const pending = (await chrome.storage.session.get('pendingDownloads')).pendingDownloads || {};
  if (!job && !starting && !Object.keys(pending).length) await chrome.offscreen.closeDocument().catch(() => {});
}

async function exportPage(currentJob) {
  let initialized = false, blobUrl = null;
  try {
    const { options, tab } = currentJob;
    await publish({ phase: 'preparing', progress: 0, message: 'Preparing the page…', tabId: tab.id, title: tab.title, downloadId: null, error: null });
    await inject(tab.id); initialized = true;
    await ensureActive(currentJob);
    const metrics = await content(tab.id, 'PREPARE', { options });
    await ensureActive(currentJob);
    const tiles = planTiles(metrics, options), layout = pdfLayout(metrics, options);
    await ensureOffscreen();
    await offscreen('BEGIN', { layout, options, meta: { title: metrics.title || tab.title, url: metrics.url || tab.url, date: new Date().toISOString() } });
    for (let index = 0; index < tiles.length; index++) {
      await ensureActive(currentJob);
      const tile = tiles[index];
      const moved = await content(tab.id, 'MOVE', { x: tile.scrollX, y: tile.scrollY, scope: options.scope, hideSticky: options.hideSticky && index > 0 });
      if (moved.viewportWidth !== metrics.viewportWidth || moved.viewportHeight !== metrics.viewportHeight) throw new Error('The browser window changed size during capture. Keep its size steady and try again.');
      const cropX = options.scope === 'viewport' ? 0 : tile.x - moved.x;
      const cropY = options.scope === 'viewport' ? 0 : tile.y - moved.y;
      if (cropX < -1 || cropY < -1 || cropX + tile.width > metrics.viewportWidth + 1 || cropY + tile.height > metrics.viewportHeight + 1) throw new Error('This page prevented scrolling to the next section. Try Print mode or Current view.');
      while (Date.now() - lastCaptureAt < CAPTURE_INTERVAL_MS) {
        await pause(CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt));
      }
      await ensureActive(currentJob);
      const beforeCapture = await content(tab.id, 'METRICS');
      if (beforeCapture.scrollX !== moved.x || beforeCapture.scrollY !== moved.y) throw new Error('The page was scrolled during capture. Keep the page still and export again.');
      if (beforeCapture.innerWidth !== moved.innerWidth || beforeCapture.innerHeight !== moved.innerHeight) throw new Error('The browser window changed size during capture. Keep its size steady and try again.');
      lastCaptureAt = Date.now();
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      await ensureActive(currentJob);
      const afterCapture = await content(tab.id, 'METRICS');
      if (afterCapture.scrollX !== moved.x || afterCapture.scrollY !== moved.y) throw new Error('The page was scrolled during capture. Keep the page still and export again.');
      if (afterCapture.innerWidth !== moved.innerWidth || afterCapture.innerHeight !== moved.innerHeight) throw new Error('The browser window changed size during capture. Keep its size steady and try again.');
      await offscreen('TILE', { image, tile: { ...tile, cropX: Math.max(0, cropX), cropY: Math.max(0, cropY) }, innerWidth: moved.innerWidth, innerHeight: moved.innerHeight });
      await publish({ phase: 'capturing', progress: Math.round((index + 1) / tiles.length * 88), message: `Capturing ${index + 1} of ${tiles.length} views…`, totalTiles: tiles.length, capturedTiles: index + 1, pages: layout.totalPages });
    }
    await ensureActive(currentJob);
    await content(tab.id, 'RESTORE', { reset: true }); initialized = false;
    await publish({ phase: 'assembling', progress: 92, message: 'Finishing your PDF…' });
    const result = await offscreen('FINISH'); blobUrl = result.url;
    if (currentJob.cancelled) throw new Error('Export canceled.');
    await publish({ phase: 'saving', progress: 98, message: 'Saving to your Downloads folder…' });
    const downloadId = await chrome.downloads.download({ url: blobUrl, filename: safeFilename(metrics.title || tab.title), saveAs: false, conflictAction: 'uniquify' });
    currentJob.downloadId = downloadId;
    await rememberDownload(downloadId, blobUrl);
    await publish({ phase: 'done', progress: 100, message: `${layout.totalPages} PDF ${layout.totalPages === 1 ? 'page' : 'pages'} sent to Downloads.`, downloadId, filename: safeFilename(metrics.title || tab.title) });
    // Keep the Blob alive until Chrome has consumed it, even if the popup closes.
    let complete = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const [download] = await chrome.downloads.search({ id: downloadId });
      if (!download || ['complete', 'interrupted'].includes(download.state)) {
        complete = true;
        if (download?.state === 'interrupted') await publish({ phase: 'error', message: 'Chrome could not finish the download. Export again or check your Downloads panel.', error: download.error });
        break;
      }
      await pause(500);
    }
    if (complete) { await offscreen('RELEASE', { url: blobUrl }).catch(() => {}); await forgetDownload(downloadId); blobUrl = null; }
  } catch (error) {
    const message = currentJob.cancelled ? 'Export canceled.' : error.message || 'Could not export this page.';
    await publish({ phase: currentJob.cancelled ? 'canceled' : 'error', progress: 0, message, error: currentJob.cancelled ? null : error.message });
    if (blobUrl) await offscreen('RELEASE', { url: blobUrl }).catch(() => {});
    await offscreen('ABORT').catch(() => {});
  } finally {
    if (initialized) await content(currentJob.tab.id, 'RESTORE', { reset: true }).catch(() => {});
    if (job === currentJob) job = null;
    if (!blobUrl) await closeOffscreenIfIdle();
  }
}

async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id) throw new Error('Untrusted sender.');
  if (message.type === 'GET_STATUS') {
    const status = (await chrome.storage.session.get('exportStatus')).exportStatus || { phase: 'idle', progress: 0 };
    if (!job && activePhases.includes(status.phase)) {
      if (status.tabId) await content(status.tabId, 'RESTORE').catch(() => {});
      return publish({ phase: 'error', progress: 0, message: 'The previous export was interrupted. The page has been restored; please try again.' });
    }
    return status;
  }
  if (message.type === 'SELECTION_CHANGED') {
    await chrome.storage.session.set({ selection: { count: message.count, selecting: message.selecting, tabId: sender.tab?.id } });
    return {};
  }
  if (message.type === 'CANCEL') {
    if (job) { job.cancelled = true; await content(job.tab.id, 'RESTORE').catch(() => {}); }
    return { canceled: true };
  }
  if (message.type === 'OPEN_DOWNLOAD') {
    const status = (await chrome.storage.session.get('exportStatus')).exportStatus;
    if (status?.downloadId) await chrome.downloads.show(status.downloadId);
    return {};
  }
  if (message.type === 'EXPORT') {
    if (job || starting) throw new Error('An export is already running.');
    starting = true;
    try {
      const tab = await activeTab(), options = normalizeOptions(message.options);
      await chrome.storage.local.set({ options });
      job = { tab, options, cancelled: false };
      void exportPage(job);
      return { started: true };
    } finally { starting = false; }
  }
  if (['PRINT', 'SELECT', 'UNDO', 'RESET'].includes(message.type)) {
    if (job || starting) throw new Error('Wait for the current export to finish.');
    const tab = await activeTab();
    await inject(tab.id);
    return content(tab.id, message.type, { options: normalizeOptions(message.options) });
  }
  throw new Error('Unknown webTopdf command.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'background') return;
  handle(message, sender).then((data) => respond({ ok: true, data }), (error) => respond({ ok: false, error: error.message }));
  return true;
});
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'export-page' || job || starting) return;
  starting = true;
  try {
    const tab = await activeTab();
    const options = normalizeOptions((await chrome.storage.local.get('options')).options);
    job = { tab, options, cancelled: false };
    void exportPage(job);
  } catch (error) { await publish({ phase: 'error', progress: 0, message: error.message }); }
  finally { starting = false; }
});
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!['complete', 'interrupted'].includes(delta.state?.current)) return;
  await downloadUpdates;
  const pending = (await chrome.storage.session.get('pendingDownloads')).pendingDownloads || {};
  if (!pending[delta.id]) return;
  await offscreen('RELEASE', { url: pending[delta.id] }).catch(() => {});
  await forgetDownload(delta.id);
  await closeOffscreenIfIdle();
});
