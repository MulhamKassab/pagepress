import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, copyFile, cp, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
const { chromium } = await import('playwright').catch(() => import(pathToFileURL(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href));

// Tests only our local fixture in a fresh, disposable Chromium profile.
// No user browser, persistent extension install, or external pages.
// The ephemeral CI test copy can grant capture permission to isolate the engine
// from Chrome's toolbar user gesture, which Playwright cannot automate.
const root = resolve('.');
const artifact = join(root, '.artifacts/browser-smoke');
const officialRuntime = join(artifact, 'official-runtime/chromium-1234/chrome-win64/chrome.exe');
const executablePath = process.env.PAGEPRESS_CHROMIUM_PATH || (await access(officialRuntime).then(() => officialRuntime).catch(() => chromium.executablePath()));
const headless = process.env.PAGEPRESS_HEADED !== '1';
await mkdir(artifact, { recursive: true });
const productionManifestPath = join(root, 'extension/manifest.json');
const manifestBytes = await readFile(productionManifestPath);
const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
if ((JSON.parse(manifestBytes).host_permissions || []).length) throw new Error('Production extension must not have host permissions.');
const colors = ['#e55959', '#e8a846', '#e5d854', '#92c750', '#40bb8f', '#3db8c5', '#5597df', '#747bd8', '#a175cd', '#d576af', '#a78c69', '#839b90'];
const html = `<!doctype html><html><head><meta charset="utf-8"><title>PagePress browser smoke fixture</title><style>
html { scroll-behavior: auto; } body { margin: 0; width: 1800px; font: 28px sans-serif; }
.band { height: 300px; box-sizing: border-box; padding: 85px 40px 0; border-right: 150px solid #382569; }
.sticky { position: sticky; top: 0; height: 70px; width: 600px; background: #ff00bd; font-size: 28px; }
.fixed { position: fixed; top: 0; left: 0; width: 980px; height: 48px; background: #192432; color: white; z-index: 10; }
</style></head><body><div class="fixed" id="fixed" style="visibility: visible !important">Fixed header marker</div>${colors.map((color, i) => `<section class="band" id="band${i}" style="background:${color}"><span>BAND ${i + 1} LEFT — independent color marker</span>${i === 4 ? '<div class="sticky" id="sticky" style="left: 12px !important">DEEP STICKY MARKER — must appear once</div>' : ''}<span style="position:absolute;left:1350px">RIGHT ${i + 1}</span></section>`).join('')}</body></html>`;
await writeFile(join(artifact, 'fixture.html'), html);
const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
let context;
const report = { fixtureUrl: url, executablePath, productionManifestHash: manifestHash, permissionMode: 'production manifest', tests: [], errors: [] };
const terminal = new Set(['done', 'error', 'canceled']);
try {
  const extensionPath = join(root, 'extension');
  context = await chromium.launchPersistentContext(join(artifact, `profile-${Date.now()}`), {
    executablePath,
    headless, viewport: { width: 1000, height: 720 }, acceptDownloads: true,
    downloadsPath: join(artifact, 'downloads'),
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, ...(headless ? [] : ['--window-position=-10000,-10000'])],
  });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
  let extensionId = new URL(worker.url()).hostname;
  report.extensionId = extensionId;
  let page = await context.newPage();
  let popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.goto(url);
  await page.evaluate(() => scrollTo(230, 570));
  const state = () => page.evaluate(() => ({ x: scrollX, y: scrollY, fixed: { value: document.querySelector('#fixed').style.getPropertyValue('visibility'), priority: document.querySelector('#fixed').style.getPropertyPriority('visibility') }, sticky: ['position', 'top', 'right', 'bottom', 'left'].map(property => [property, document.querySelector('#sticky').style.getPropertyValue(property), document.querySelector('#sticky').style.getPropertyPriority(property)]), captureStyle: !!document.querySelector('[data-pagepress="capture"]') }));
  const original = await state();
  report.original = original;
  const options = { scope: 'viewport', loadImages: false, footer: false, margin: 0, quality: 'high' };
  await worker.evaluate(async options => { await chrome.storage.local.set({ options }); await chrome.storage.session.clear(); }, options);
  await page.bringToFront();
  await page.keyboard.press('Alt+Shift+P');
  const poll = async (timeout = 60000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const status = await worker.evaluate(async () => (await chrome.storage.session.get('exportStatus')).exportStatus);
      if (status && terminal.has(status.phase)) return status;
      await new Promise(r => setTimeout(r, 200));
    }
    return null;
  };
  let status = await poll(12000);
  report.shortcutStatus = status;
  if (!status) {
    // Explicit CI-only harness grant. This fresh profile holds only local fixtures.
    // Route all external HTTP requests away; production manifest remains activeTab.
    await context.close(); context = null;
    const copy = join(artifact, 'extension-test-copy');
    await cp(extensionPath, copy, { recursive: true });
    const manifest = JSON.parse(await readFile(join(copy, 'manifest.json'), 'utf8'));
    manifest.host_permissions = ['<all_urls>'];
    await writeFile(join(copy, 'manifest.json'), JSON.stringify(manifest, null, 2));
    report.permissionMode = 'ephemeral CI test copy: <all_urls> for capture API, isolated profile, external HTTP blocked';
    report.permissionLimitation = 'The Chrome toolbar/shortcut activeTab user gesture was not automated. Real capture/offscreen/download logic runs with a CI-only copy permission. Production remains activeTab-only.';
    context = await chromium.launchPersistentContext(join(artifact, `fallback-profile-${Date.now()}`), {
      executablePath,
      headless, viewport: { width: 1000, height: 720 }, acceptDownloads: true,
      downloadsPath: join(artifact, 'downloads'),
      args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`, ...(headless ? [] : ['--window-position=-10000,-10000'])],
    });
    await context.route(/^https?:/, route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === new URL(url).origin) return route.continue();
      return route.abort('blockedbyclient');
    });
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
    extensionId = new URL(worker.url()).hostname;
    page = await context.newPage();
    await page.goto(url);
    await page.evaluate(() => scrollTo(230, 570));
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('body').screenshot({ path: join(artifact, 'popup.png') });
    await page.bringToFront();
    const result = await popup.evaluate(async options => chrome.runtime.sendMessage({ target: 'background', type: 'EXPORT', options }), options);
    report.fallbackExportResult = result;
    const start = Date.now();
    while (Date.now() - start < 60000) {
      status = await worker.evaluate(async () => (await chrome.storage.session.get('exportStatus')).exportStatus);
      if (status && terminal.has(status.phase)) break;
      await new Promise(r => setTimeout(r, 200));
    }
    report.fallbackStatus = status;
    const downloads = await worker.evaluate(async () => chrome.downloads.search({}));
    report.fallbackDownloads = downloads;
    if (status?.phase !== 'done') throw new Error(status?.message || 'Production shortcut did not invoke the extension; restricted fallback unavailable.');
  }
  if (status.phase !== 'done') throw new Error(`Production shortcut: ${status.message}`);
  const download = async (status, name) => {
    let item;
    for (let attempt = 0; attempt < 100; attempt++) {
      [item] = await worker.evaluate(async id => chrome.downloads.search({ id }), status.downloadId);
      if (item?.state === 'complete') break;
      if (item?.state === 'interrupted') throw new Error(`Chrome download interrupted: ${item.error}`);
      await new Promise(r => setTimeout(r, 100));
    }
    if (item?.state !== 'complete') throw new Error('Chrome download did not complete.');
    const target = join(artifact, name);
    await copyFile(item.filename, target);
    const bytes = await readFile(target);
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Chrome download did not produce PDF bytes.');
    return { name, path: target, bytes: bytes.length, status, download: { state: item.state, filename: item.filename } };
  };
  report.tests.push({ test: 'viewport export via actual capture, offscreen, download', ...(await download(status, 'viewport.pdf')), restored: await state() });
  await new Promise(r => setTimeout(r, 700));
  const startExport = async options => {
    await worker.evaluate(async options => { await chrome.storage.local.set({ options }); await chrome.storage.session.remove('exportStatus'); }, options);
    await page.bringToFront();
    if (report.permissionMode === 'production manifest') await page.keyboard.press('Alt+Shift+P');
    else {
      const response = await popup.evaluate(async options => chrome.runtime.sendMessage({ target: 'background', type: 'EXPORT', options }), options);
      if (!response.ok) throw new Error(response.error);
    }
  };
  const exportViaShortcut = async options => {
    await startExport(options);
    const result = await poll();
    if (result?.phase !== 'done') throw new Error(`Export failed: ${result?.message || 'timeout'}`);
    return result;
  };
  const fullStatus = await exportViaShortcut({ scope: 'full', loadImages: false, footer: false, margin: 0, quality: 'high', hideSticky: true });
  report.tests.push({ test: 'full export: horizontal overflow, deep sticky, nonzero initial scroll', ...(await download(fullStatus, 'full.pdf')), restored: await state() });
  await new Promise(r => setTimeout(r, 700));
  await startExport({ scope: 'full', loadImages: false, hideSticky: true });
  await new Promise(r => setTimeout(r, 350));
  report.cancelResponse = await popup.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'CANCEL' }));
  report.tests.push({ test: 'cancellation restores scroll and inline styles', status: await poll(), restored: await state() });
  await startExport({ scope: 'full', loadImages: false, hideSticky: true });
  await new Promise(r => setTimeout(r, 350));
  const other = await context.newPage();
  await other.goto(url + '?other');
  await other.bringToFront();
  report.tests.push({ test: 'switching tabs aborts export and restores original page', status: await poll(), restored: await state() });
  await other.goto('chrome://version');
  await worker.evaluate(async () => { await chrome.storage.session.remove('exportStatus'); });
  report.protectedResponse = await popup.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'EXPORT' }));
  report.tests.push({ test: 'Chrome internal page is rejected', response: report.protectedResponse });
  for (const test of report.tests.filter(t => t.restored)) {
    if (JSON.stringify(test.restored) !== JSON.stringify(original)) throw new Error(`Page state not restored: ${test.test}`);
  }
  if (report.tests.find(t => t.test.startsWith('cancellation')).status?.phase !== 'canceled') throw new Error('Cancellation was not reported.');
  const cancellation = report.tests.find(t => t.test.startsWith('cancellation')).status;
  if (cancellation.message !== 'Export canceled.' || cancellation.error !== null) throw new Error('Cancellation did not report a clear cancellation message.');
  if (!report.tests.find(t => t.test.startsWith('switching')).status?.message.includes('switched tabs')) throw new Error('Tab switch was not rejected.');
  if (report.protectedResponse.ok || !report.protectedResponse.error.includes('normal webpage')) throw new Error('Protected page rejection did not behave as expected.');
  report.passed = true;
} catch (error) { report.errors.push(error.stack); report.passed = false; }
finally {
  if (context) await context.close();
  await new Promise(r => server.close(r));
  const testManifestPath = join(artifact, 'extension-test-copy/manifest.json');
  const testManifest = await readFile(testManifestPath, 'utf8').then(JSON.parse).catch(() => null);
  if (testManifest) { delete testManifest.host_permissions; await writeFile(testManifestPath, JSON.stringify(testManifest, null, 2)); }
  report.testCopyExtraPermissionRemoved = true;
  report.productionManifestUnchanged = createHash('sha256').update(await readFile(productionManifestPath)).digest('hex') === manifestHash;
  if (!report.productionManifestUnchanged || (JSON.parse(await readFile(productionManifestPath)).host_permissions || []).length) { report.errors.push('Production manifest changed or acquired host permissions.'); report.passed = false; }
  await writeFile(join(artifact, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
process.exitCode = report.passed ? 0 : 1;
