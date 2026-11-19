import { normalizeOptions, planTiles, pdfLayout, safeFilename, observedShift, layoutGrowth, shiftedScrollY, tileCrop, estimatePdfBytes, MAX_ESTIMATED_BYTES, MIN_READABLE_SCALE } from './lib/geometry.js';
import { t } from './lib/i18n.js';
import { classifyUrl } from './lib/pages.js';

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
  // A failed shortcut export has no popup to explain it, so the tooltip carries the reason.
  await chrome.action.setTitle?.({ title: status.phase === 'error' && status.message ? `webTopdf: ${status.message}` : t('actionTitle', 'webTopdf — Save page as PDF') });
  return status;
}

// Raw browser errors mean nothing to users; say what happened and what to do next.
function friendlyError(message = '') {
  const text = String(message);
  if (/Receiving end does not exist|Could not establish connection|message channel closed|message port closed|back\/forward cache|Extension context invalidated/i.test(text)) return t('errorLostPage', 'webTopdf lost contact with the page. Reload the tab and try again, or use Print mode.');
  if (/(<all_urls>|activeTab).*permission|Cannot access contents|Missing host permission|cannot be scripted/i.test(text)) return t('errorNoAccess', 'The browser did not allow webTopdf to use this page. Click the webTopdf button on the page again, reload it, or use Print mode.');
  if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|capture.*quota|too many calls/i.test(text)) return t('errorQuota', 'The browser is limiting screenshots right now. Wait a few seconds and export again.');
  if (/No tab with id|tab was closed|No window with id/i.test(text)) return t('errorTabGone', 'The tab or window was closed during the export. Open the page and export again.');
  return text;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const page = classifyUrl(tab?.url);
  if (!tab?.id || !page.ok) throw new Error(page.message || t('pageOther', 'webTopdf works on normal webpages (http or https). Open one first.'));
  return { ...tab, kind: page.kind, kindMessage: page.message };
}
// Pages change the hash or call history.pushState/replaceState while you scroll; that is
// the same document. Only a real navigation (tabs.onUpdated status "loading") or a move
// to another site ends the export.
const siteOf = (url) => { try { const parsed = new URL(url); return `${parsed.protocol}//${parsed.host}`; } catch { return String(url || ''); } };
async function ensureActive(currentJob) {
  if (currentJob.cancelled) throw new Error(t('statusCanceled', 'Export canceled.'));
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (currentJob.loading) {
    // The tab reported "loading". Same-document changes (hash, pushState) may do that too, so
    // ask our script in the page: a real navigation or reload destroyed it and its capture session.
    const alive = await content(currentJob.tab.id, 'ALIVE').then((state) => state.capturing, () => false);
    if (!alive) currentJob.navigated = true;
    currentJob.loading = false;
  }
  if (currentJob.navigated || tab?.id !== currentJob.tab.id || tab?.windowId !== currentJob.tab.windowId || (tab.url && siteOf(tab.url) !== siteOf(currentJob.tab.url))) throw new Error(t('errorTabChanged', 'Export stopped because you switched tabs, windows, or navigated. Return to the page and export again.'));
}
async function inject(tabId, tab = {}) {
  // After an extension update or reload an old copy of the script can still be marked as
  // installed while its listener is dead. Only a live answer to a ping counts.
  const alive = await chrome.tabs.sendMessage(tabId, { target: 'content', type: 'ALIVE' }).then((result) => result?.ok === true, () => false);
  if (alive) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => { delete globalThis.__PAGEPRESS_CONTENT__; } });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (error) {
    if (tab.kind === 'pdf') throw new Error(tab.kindMessage || t('errorIsPdf', 'This page is a PDF file. Use the PDF viewer’s download button to save it.'));
    throw new Error(/^file:/.test((await chrome.tabs.get(tabId)).url || '') ? t('errorFileAccess', 'Enable “Allow access to file URLs” in webTopdf extension details to export local files.') : t('errorNoRun', 'Chrome does not allow webTopdf to run on this page. Try a normal webpage.'));
  }
}
async function content(tabId, type, values = {}) {
  let result;
  try { result = await chrome.tabs.sendMessage(tabId, { target: 'content', type, ...values }); }
  catch (error) { throw new Error(friendlyError(error.message)); }
  if (!result?.ok) throw new Error(friendlyError(result?.error) || t('errorNoResponse', 'The page did not respond. Reload it and try again.'));
  return result.data;
}
async function offscreen(type, data = {}) {
  const result = await chrome.runtime.sendMessage({ target: 'offscreen', type, ...data });
  // Offscreen documents have no chrome.i18n, so they send a key and we translate here.
  if (!result?.ok) throw new Error(result?.errorKey ? t(result.errorKey, result.error, result.substitutions) : result?.error || t('errorPdfNoResponse', 'PDF processing did not respond. The page may be too large for this quality; try Compact quality, Current view or Print mode.'));
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
    await publish({ phase: 'preparing', progress: 0, message: t('statusPreparing', 'Preparing the page…'), tabId: tab.id, title: tab.title, downloadId: null, error: null });
    await inject(tab.id, tab); initialized = true;
    await ensureActive(currentJob);
    const metrics = await content(tab.id, 'PREPARE', { options });
    await ensureActive(currentJob);
    const tiles = planTiles(metrics, options), layout = pdfLayout(metrics, options);
    if (estimatePdfBytes(layout, options) > MAX_ESTIMATED_BYTES) throw new Error(t('errorTooLarge', 'This page is too large to turn into a PDF at this quality. Choose Compact quality, Current view or Print mode.'));
    await ensureOffscreen();
    await offscreen('BEGIN', { layout, options, meta: { title: metrics.title || tab.title, url: metrics.url || tab.url, date: new Date().toISOString() } });
    // The page can change height while it is scrolled (a header turning fixed). `shift`
    // is how far the content moved up compared with the plan; later tiles are retargeted.
    let shift = 0, grewBy = 0, shiftedDown = false;
    for (let index = 0; index < tiles.length; index++) {
      await ensureActive(currentJob);
      const tile = tiles[index];
      let moved;
      for (let attempt = 0; ; attempt++) {
        moved = await content(tab.id, 'MOVE', { x: tile.scrollX, y: shiftedScrollY(tile, shift), scope: options.scope, hideSticky: options.hideSticky && tile.row > 0 });
        if (moved.viewportWidth !== metrics.viewportWidth || moved.viewportHeight !== metrics.viewportHeight) throw new Error(t('errorResized', 'The browser window changed size during capture. Keep its size steady and try again.'));
        if (options.scope === 'viewport') break;
        grewBy = Math.max(grewBy, layoutGrowth(metrics.height, moved.height));
        const observed = observedShift(metrics.height, moved);
        if (observed > 0) shiftedDown = true;
        if (observed === shift) break;
        shift = observed;
        if (attempt >= 3) throw new Error(t('errorLayoutUnstable', 'This page keeps changing its layout while it is scrolled. Try Print mode or Current view.'));
      }
      const { cropX: tileCropX, cropY: tileCropY, ok } = tileCrop(tile, shift, moved, metrics.viewportWidth, metrics.viewportHeight);
      const cropX = options.scope === 'viewport' ? 0 : tileCropX;
      const cropY = options.scope === 'viewport' ? 0 : tileCropY;
      let drawn = tile;
      if (options.scope !== 'viewport' && !ok) {
        // The page ended earlier than planned (content removed at the bottom): keep the part that exists.
        const room = metrics.viewportHeight - cropY;
        if (cropX >= -1 && cropX + tile.width <= metrics.viewportWidth + 1 && cropY >= -1 && room >= 8 && room < tile.height) drawn = { ...tile, height: room };
        else throw new Error(t('errorNoScroll', 'This page prevented scrolling to the next section. Try Print mode or Current view.'));
      }
      // Where the capture area (page or inner panel) sits inside the screenshot.
      const originX = moved.originX || 0, originY = moved.originY || 0;
      while (Date.now() - lastCaptureAt < CAPTURE_INTERVAL_MS) {
        await pause(CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt));
      }
      await ensureActive(currentJob);
      const beforeCapture = await content(tab.id, 'METRICS');
      if (beforeCapture.scrollX !== moved.x || beforeCapture.scrollY !== moved.y) throw new Error(t('errorScrolled', 'The page was scrolled during capture. Keep the page still and export again.'));
      if (beforeCapture.innerWidth !== moved.innerWidth || beforeCapture.innerHeight !== moved.innerHeight) throw new Error(t('errorResized', 'The browser window changed size during capture. Keep its size steady and try again.'));
      lastCaptureAt = Date.now();
      // PNG only for High quality; JPEG screenshots are much smaller to pass around and decode.
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, options.quality === 'high' ? { format: 'png' } : { format: 'jpeg', quality: options.quality === 'compact' ? 80 : 92 });
      await ensureActive(currentJob);
      const afterCapture = await content(tab.id, 'METRICS');
      if (afterCapture.scrollX !== moved.x || afterCapture.scrollY !== moved.y) throw new Error(t('errorScrolled', 'The page was scrolled during capture. Keep the page still and export again.'));
      if (afterCapture.innerWidth !== moved.innerWidth || afterCapture.innerHeight !== moved.innerHeight) throw new Error(t('errorResized', 'The browser window changed size during capture. Keep its size steady and try again.'));
      await offscreen('TILE', { image, tile: { ...drawn, cropX: Math.max(0, cropX) + originX, cropY: Math.max(0, cropY) + originY }, innerWidth: moved.innerWidth, innerHeight: moved.innerHeight });
      await publish({ phase: 'capturing', progress: Math.round((index + 1) / tiles.length * 88), message: t('statusCapturing', 'Capturing $1 of $2 views…', [index + 1, tiles.length]), totalTiles: tiles.length, capturedTiles: index + 1, pages: layout.totalPages });
    }
    await ensureActive(currentJob);
    await content(tab.id, 'RESTORE', { reset: true }); initialized = false;
    await publish({ phase: 'assembling', progress: 92, message: t('statusAssembling', 'Finishing your PDF…') });
    const result = await offscreen('FINISH'); blobUrl = result.url;
    if (currentJob.cancelled) throw new Error(t('statusCanceled', 'Export canceled.'));
    await publish({ phase: 'saving', progress: 98, message: t('statusSaving', 'Saving to your Downloads folder…') });
    const downloadId = await chrome.downloads.download({ url: blobUrl, filename: safeFilename(metrics.title || tab.title), saveAs: false, conflictAction: 'uniquify' });
    currentJob.downloadId = downloadId;
    await rememberDownload(downloadId, blobUrl);
    const notes = [];
    if (metrics.scroller) notes.push(t('doneScrollPanel', 'This page scrolls inside a panel, so the PDF shows that panel’s full content.'));
    if (grewBy) notes.push(t('doneGrew', 'The page grew while it was being captured, so the PDF stops at the length it had when the export started.'));
    if (shiftedDown) notes.push(t('doneShifted', 'Content was added above your position while the page was captured. Check the PDF for repeated or missing parts.'));
    if (layout.pixelScale < MIN_READABLE_SCALE) notes.push(t('doneWide', 'This page is very wide, so the PDF shows it small. Landscape orientation or Current view may read better.'));
    const base = layout.totalPages === 1 ? t('doneOnePage', '1 PDF page sent to Downloads.') : t('doneManyPages', '$1 PDF pages sent to Downloads.', layout.totalPages);
    await publish({ phase: 'done', progress: 100, message: [base, ...notes].join(' '), downloadId, filename: safeFilename(metrics.title || tab.title) });
    // The export itself is finished: do not block the next one while Chrome (or an antivirus
    // scan) still holds the download. The Blob is released below or by downloads.onChanged.
    if (job === currentJob) job = null;
    // Keep the Blob alive until Chrome has consumed it, even if the popup closes.
    // A newer export may already be running, so failures here must never reach the
    // catch below (which would abort that export's offscreen session and status).
    try {
      let complete = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const [download] = await chrome.downloads.search({ id: downloadId });
        if (!download || ['complete', 'interrupted'].includes(download.state)) {
          complete = true;
          if (download?.state === 'interrupted' && !job) await publish({ phase: 'error', message: t('errorDownload', 'Chrome could not finish the download. Export again or check your Downloads panel.'), error: download.error });
          break;
        }
        await pause(500);
      }
      if (complete) { await offscreen('RELEASE', { url: blobUrl }).catch(() => {}); await forgetDownload(downloadId); blobUrl = null; }
    } catch { /* downloads.onChanged releases the Blob when Chrome finishes. */ }
  } catch (error) {
    const message = currentJob.cancelled ? t('statusCanceled', 'Export canceled.') : friendlyError(error.message) || t('errorGeneric', 'Could not export this page.');
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
      return publish({ phase: 'error', progress: 0, message: t('errorInterrupted', 'The previous export was interrupted. The page has been restored; please try again.') });
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
    if (job || starting) throw new Error(t('errorBusy', 'An export is already running.'));
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
    if (job || starting) throw new Error(t('errorWait', 'Wait for the current export to finish.'));
    const tab = await activeTab();
    await inject(tab.id, tab);
    return content(tab.id, message.type, { options: normalizeOptions(message.options) });
  }
  throw new Error('Unknown webTopdf command.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'background') return;
  handle(message, sender).then((data) => respond({ ok: true, data }), (error) => respond({ ok: false, error: friendlyError(error.message) }));
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
  } catch (error) { await publish({ phase: 'error', progress: 0, message: friendlyError(error.message), error: error.message }); }
  finally { starting = false; }
});
chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
  if (job && tabId === job.tab.id && changeInfo.status === 'loading') job.loading = true;
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
