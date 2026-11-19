import { normalizeOptions } from './lib/geometry.js';
import { t, isRtl } from './lib/i18n.js';
import { classifyUrl } from './lib/pages.js';
import { reportUrl } from './lib/report.js';

const form = document.querySelector('#settings');
const $ = (selector) => document.querySelector(selector);
// blocked: false | true (unsupported page) | 'pdf' (warning only, Save stays on)
let mode = 'visual', currentTabId = null, busy = false, blocked = false, hiddenCount = 0, lastError = '';
const running = ['preparing', 'capturing', 'assembling', 'saving'];
async function send(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ target: 'background', type, ...data });
  if (!response?.ok) throw new Error(response?.error || t('noResponse', 'webTopdf did not respond. Please try again.'));
  return response.data;
}
function options() {
  const values = Object.fromEntries(new FormData(form));
  for (const key of ['footer', 'hideSticky', 'loadImages', 'cleanPrint']) values[key] = form.elements[key].checked;
  return normalizeOptions(values);
}
function applyOptions(values) {
  const normalized = normalizeOptions(values);
  for (const [key, value] of Object.entries(normalized)) {
    const field = form.elements[key];
    if (!field) continue;
    if (typeof value === 'boolean') field.checked = value; else field.value = String(value);
  }
}
// Translate every [data-i18n*] element once at startup. The English text in the
// HTML is the fallback, so it always equals the en message.
function applyLanguage() {
  if (isRtl()) { document.documentElement.dir = 'rtl'; document.documentElement.lang = 'ar'; }
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n, el.textContent);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle, el.title);
  for (const el of document.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel, el.getAttribute('aria-label') || ''));
}
function updateReportLink() {
  let version = 'unknown';
  try { version = chrome.runtime.getManifest().version; } catch { /* keep unknown */ }
  $('#reportLink').href = reportUrl(version, navigator.userAgent, lastError);
}
function renderShortcut(shortcut) {
  const marker = '\u0001', parts = t('shortcutNext', 'Next time: $1 to save with these settings.', [marker]).split(marker);
  const hint = $('#shortcutHint'); hint.textContent = parts[0] || '';
  shortcut.split(/\s*\+\s*/).forEach((key, index) => {
    if (index) hint.append(' + ');
    const kbd = document.createElement('kbd'); kbd.textContent = key; hint.append(kbd);
  });
  hint.append(parts[1] || '');
}
function applyBlocked() {
  $('#exportButton').disabled = busy || blocked === true;
  $('#selectElements').disabled = busy || blocked === true;
  $('#undoSelection').disabled = busy || blocked === true || hiddenCount === 0;
  $('#resetSelection').disabled = busy || blocked === true || hiddenCount === 0;
}
function exportLabel() { return mode === 'visual' ? t('saveAsPdf', 'Save as PDF') : t('openPrintDialog', 'Open print dialog'); }
function status(data) {
  busy = running.includes(data.phase);
  $('#statusPanel').hidden = !data.message;
  $('#statusPanel').className = data.phase === 'error' ? 'error' : data.phase === 'done' ? 'done' : '';
  $('#statusMessage').textContent = data.message || '';
  if (data.phase === 'error' && data.message) { lastError = data.message; updateReportLink(); }
  const progress = Math.round(Math.max(0, Math.min(100, data.progress || 0)));
  $('#progressBar').style.width = `${progress}%`;
  $('#progressTrack').setAttribute('aria-valuenow', String(progress));
  if (data.message) $('#progressTrack').setAttribute('aria-valuetext', data.message);
  $('#progressTrack').hidden = !busy;
  $('#cancelExport').hidden = !busy;
  $('#openDownload').hidden = data.phase !== 'done' || !data.downloadId;
  $('#exportLabel').textContent = busy ? t('savingYourPage', 'Saving your page…') : exportLabel();
  for (const field of form.querySelectorAll('input, select, button')) field.disabled = busy;
  for (const selector of ['#visualMode', '#printMode', '#selectElements']) $(selector).disabled = busy;
  applyBlocked();
}
function error(error) { status({ phase: 'error', message: error.message || String(error) }); }
function selection(data) {
  const count = data?.tabId === currentTabId ? data.count || 0 : 0;
  hiddenCount = count;
  $('#selectionCount').textContent = count ? (count === 1 ? t('selectionOne', '1 element hidden. Restored after export.') : t('selectionMany', '$1 elements hidden. Restored after export.', [count])) : t('hideDistractions', 'Hide distractions before saving.');
  applyBlocked();
}
function setMode(value) {
  mode = value;
  const visual = mode === 'visual';
  $('#visualMode').classList.toggle('active', visual); $('#visualMode').setAttribute('aria-pressed', String(visual));
  $('#printMode').classList.toggle('active', !visual); $('#printMode').setAttribute('aria-pressed', String(!visual));
  $('#modeDescription').textContent = visual ? t('modeVisualDesc', 'The page as you see it, captured into a PDF. Keep this tab active during capture.') : t('modePrintDesc', 'Use Chrome’s print layout for selectable text. Choose Save as PDF in the print dialog; results depend on the site.');
  for (const selector of ['.scope-switch', '#qualityLabel', '#stickyToggle', '#imagesToggle', '#footerToggle', '#shortcutHint']) $(selector).hidden = !visual;
  $('#printToggle').hidden = visual;
  if (!busy) $('#exportLabel').textContent = exportLabel();
}
$('#visualMode').addEventListener('click', () => setMode('visual'));
$('#printMode').addEventListener('click', () => setMode('print'));
form.addEventListener('change', () => { chrome.storage.local.set({ options: options() }); });
form.addEventListener('submit', (event) => event.preventDefault());
$('#exportButton').addEventListener('click', async () => {
  try {
    const values = options(); await chrome.storage.local.set({ options: values });
    if (mode === 'visual') { status({ phase: 'preparing', progress: 0, message: t('startingExport', 'Starting the export…') }); await send('EXPORT', { options: values }); }
    else { await send('PRINT', { options: values }); window.close(); }
  } catch (caught) { error(caught); }
});
$('#cancelExport').addEventListener('click', () => send('CANCEL').catch(error));
$('#openDownload').addEventListener('click', () => send('OPEN_DOWNLOAD').catch(error));
$('#selectElements').addEventListener('click', async () => { try { await send('SELECT'); window.close(); } catch (caught) { error(caught); } });
$('#undoSelection').addEventListener('click', () => send('UNDO').catch(error));
$('#resetSelection').addEventListener('click', () => send('RESET').catch(error));
$('#savePreset').addEventListener('click', async () => {
  await chrome.storage.local.set({ savedPreset: options() });
  $('#preset option[value="mine"]').disabled = false; $('#preset').value = 'mine';
  $('#savePreset').textContent = t('presetSaved', 'Saved ✓'); setTimeout(() => { $('#savePreset').textContent = t('savePreset', 'Save preset'); }, 1600);
});
$('#preset').addEventListener('change', async (event) => {
  const name = event.target.value;
  const profiles = { everyday: {}, wide: { orientation: 'landscape', margin: 8, quality: 'high' }, compact: { quality: 'compact', margin: 8, footer: false } };
  const values = name === 'mine' ? (await chrome.storage.local.get('savedPreset')).savedPreset : profiles[name];
  applyOptions(values); await chrome.storage.local.set({ options: options() });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if (changes.exportStatus) status(changes.exportStatus.newValue);
  if (changes.selection) selection(changes.selection.newValue);
});
async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  applyLanguage(); updateReportLink();
  $('#pageTitle').textContent = tab?.title || t('yourCurrentPage', 'Your current page'); $('#pageTitle').title = tab?.title || '';
  try { $('#pageHost').textContent = new URL(tab.url).hostname || t('localFile', 'Local file'); } catch { $('#pageHost').textContent = t('openWebpageToBegin', 'Open a webpage to begin.'); }
  const page = classifyUrl(tab?.url);
  if (page.message) {
    const notice = $('#pageNotice'); notice.textContent = page.message; notice.hidden = false; notice.classList.toggle('warn', page.ok);
  }
  if (!page.ok) {
    blocked = true;
    $('#exportButton').title = $('#selectElements').title = $('#undoSelection').title = $('#resetSelection').title = page.message;
  } else if (page.kind === 'pdf') blocked = 'pdf';
  const stored = await chrome.storage.local.get(['options', 'savedPreset']); applyOptions(stored.options);
  if (stored.savedPreset) $('#preset option[value="mine"]').disabled = false;
  status(await send('GET_STATUS'));
  selection((await chrome.storage.session.get('selection')).selection);
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((command) => command.name === 'export-page')?.shortcut;
  if (!shortcut) $('#shortcutHint').textContent = t('shortcutSet', 'Set a quick-save shortcut at chrome://extensions/shortcuts.');
  else renderShortcut(shortcut);
  applyBlocked();
}
initialize().catch(error);
