import { normalizeOptions } from './lib/geometry.js';

const form = document.querySelector('#settings');
const $ = (selector) => document.querySelector(selector);
let mode = 'visual', currentTabId = null, busy = false;
const running = ['preparing', 'capturing', 'assembling', 'saving'];
async function send(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ target: 'background', type, ...data });
  if (!response?.ok) throw new Error(response?.error || 'webTopdf did not respond. Please try again.');
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
function status(data) {
  busy = running.includes(data.phase);
  $('#statusPanel').hidden = !data.message;
  $('#statusPanel').className = data.phase === 'error' ? 'error' : data.phase === 'done' ? 'done' : '';
  $('#statusMessage').textContent = data.message || '';
  $('#progressBar').style.width = `${Math.max(0, Math.min(100, data.progress || 0))}%`;
  $('#progressTrack').hidden = !busy;
  $('#cancelExport').hidden = !busy;
  $('#openDownload').hidden = data.phase !== 'done' || !data.downloadId;
  $('#exportButton').disabled = busy;
  $('#exportLabel').textContent = busy ? 'Saving your page…' : mode === 'visual' ? 'Save as PDF' : 'Open print dialog';
  for (const field of form.querySelectorAll('input, select, button')) field.disabled = busy;
  for (const selector of ['#visualMode', '#printMode', '#selectElements']) $(selector).disabled = busy;
  if (busy) { $('#undoSelection').disabled = true; $('#resetSelection').disabled = true; }
}
function error(error) { status({ phase: 'error', message: error.message || String(error) }); }
function selection(data) {
  const count = data?.tabId === currentTabId ? data.count || 0 : 0;
  $('#selectionCount').textContent = count ? `${count} ${count === 1 ? 'element' : 'elements'} hidden. Restored after export.` : 'Hide distractions before saving.';
  $('#undoSelection').disabled = busy || count === 0; $('#resetSelection').disabled = busy || count === 0;
}
function setMode(value) {
  mode = value;
  const visual = mode === 'visual';
  $('#visualMode').classList.toggle('active', visual); $('#visualMode').setAttribute('aria-pressed', String(visual));
  $('#printMode').classList.toggle('active', !visual); $('#printMode').setAttribute('aria-pressed', String(!visual));
  $('#modeDescription').textContent = visual ? 'The page as you see it, captured into a PDF. Keep this tab active during capture.' : 'Use Chrome’s print layout for selectable text. Choose Save as PDF in the print dialog; results depend on the site.';
  for (const selector of ['.scope-switch', '#qualityLabel', '#stickyToggle', '#imagesToggle', '#footerToggle', '#shortcutHint']) $(selector).hidden = !visual;
  $('#printToggle').hidden = visual;
  if (!busy) $('#exportLabel').textContent = visual ? 'Save as PDF' : 'Open print dialog';
}
$('#visualMode').addEventListener('click', () => setMode('visual'));
$('#printMode').addEventListener('click', () => setMode('print'));
form.addEventListener('change', () => { chrome.storage.local.set({ options: options() }); });
form.addEventListener('submit', (event) => event.preventDefault());
$('#exportButton').addEventListener('click', async () => {
  try {
    const values = options(); await chrome.storage.local.set({ options: values });
    if (mode === 'visual') { status({ phase: 'preparing', progress: 0, message: 'Starting the export…' }); await send('EXPORT', { options: values }); }
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
  $('#savePreset').textContent = 'Saved ✓'; setTimeout(() => { $('#savePreset').textContent = 'Save preset'; }, 1600);
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
  $('#pageTitle').textContent = tab?.title || 'Your current page'; $('#pageTitle').title = tab?.title || '';
  try { $('#pageHost').textContent = new URL(tab.url).hostname || 'Local file'; } catch { $('#pageHost').textContent = 'Open a webpage to begin.'; }
  const stored = await chrome.storage.local.get(['options', 'savedPreset']); applyOptions(stored.options);
  if (stored.savedPreset) $('#preset option[value="mine"]').disabled = false;
  status(await send('GET_STATUS'));
  selection((await chrome.storage.session.get('selection')).selection);
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((command) => command.name === 'export-page')?.shortcut;
  if (!shortcut) $('#shortcutHint').textContent = 'Set a quick-save shortcut at chrome://extensions/shortcuts.';
  else $('#shortcutHint').textContent = `Next time: ${shortcut} to save with these settings.`;
}
initialize().catch(error);
