import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';

// Tests only our local fixtures in a fresh, disposable Chromium profile.
// No user browser, persistent extension install, or external pages.
//
// Notes for maintainers:
// - Playwright comes from node_modules (devDependency). Set PAGEPRESS_CHROMIUM_PATH to
//   a Chromium-based browser (Edge works; branded Chrome 137+ ignores --load-extension).
// - Playwright cannot press the toolbar button, so the extension runs from a TEST COPY
//   whose manifest grants <all_urls> (needed for the capture API). The production
//   manifest is hashed before and after to prove it is untouched. The earlier attempt to
//   trigger the production Alt+Shift+P shortcut first is gone: it cannot work under
//   automation (no activeTab user gesture), and on Edge it cost a context relaunch.
// - On Edge, browserContext.close() can hang forever, so every close is raced against a
//   timeout and then the browser processes of our throwaway profile are killed. Every
//   step also has its own timeout so one stuck step cannot block the run.
const { chromium } = await import('playwright');
const root = resolve('.');
const artifact = join(root, '.artifacts/browser-smoke');
const executablePath = process.env.PAGEPRESS_CHROMIUM_PATH || chromium.executablePath();
const headless = process.env.PAGEPRESS_HEADED !== '1';
await mkdir(artifact, { recursive: true });
const productionManifestPath = join(root, 'extension/manifest.json');
const manifestBytes = await readFile(productionManifestPath);
const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
if ((JSON.parse(manifestBytes).host_permissions || []).length) throw new Error('Production extension must not have host permissions.');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (promise, ms, label) => Promise.race([promise, sleep(ms).then(() => { throw new Error(`Timed out after ${ms} ms: ${label}`); })]);
const step = (label, fn, ms = 90000) => withTimeout(Promise.resolve().then(fn), ms, label);
const killProfile = (token) => new Promise((done) => {
  if (process.platform === 'win32') execFile('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'msedge|chrome|chromium' -and $_.CommandLine -like '*${token}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], () => done());
  else execFile('pkill', ['-f', token], () => done());
});
async function closeContext(context, token) {
  const closed = await Promise.race([context.close().then(() => true, () => true), sleep(8000).then(() => false)]);
  if (!closed) await killProfile(token);
}

// ---- Fixtures. Every band / column has its own solid colour so pixels prove order. ----
const palette = Array.from({ length: 18 }, (_, i) => `hsl(${Math.round(i * 360 / 18)} ${i % 2 ? 85 : 65}% ${i % 3 === 0 ? 38 : i % 3 === 1 ? 52 : 64}%)`);
const toRgb = (hsl) => { const [h, s, l] = hsl.match(/[\d.]+/g).map(Number); const a = s / 100 * Math.min(l / 100, 1 - l / 100); const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return [f(0), f(8), f(4)]; };
const paletteRgb = palette.map(toRgb);
const white = [255, 255, 255];
const bands = (count, height, first = 0) => Array.from({ length: count }, (_, i) => `<div style="height:${height}px;background:${palette[first + i]}"></div>`).join('');
const doc = (head, body, attrs = '') => `<!doctype html><html${attrs}><head><meta charset="utf-8"><title>webTopdf smoke fixture</title><style>html,body{margin:0}${head}</style></head><body>${body}</body></html>`;
const stripes = (n, h, first = 0, y0 = 0) => (width) => Array.from({ length: n }, (_, i) => ({ x: 0, y: y0 + i * h, w: width, h, c: first + i }));
const fixtures = [
  {
    name: 'rtl-wide', path: '/rtl', width: 1800, title: 'RTL wide page: columns appear in visual left-to-right order',
    html: doc('body{width:1800px}.g{display:grid;grid-template-columns:repeat(3,600px)}.c{height:500px}', `<div class="g">${Array.from({ length: 9 }, (_, i) => `<div class="c" style="background:${palette[i]}"></div>`).join('')}</div>`, ' dir="rtl"'),
    // Grid cells run right-to-left, so DOM column dc sits at visual column 2 - dc.
    layout: () => ({ height: 1500, cells: Array.from({ length: 9 }, (_, i) => ({ x: (2 - i % 3) * 600, y: Math.floor(i / 3) * 500, w: 600, h: 500, c: i })) }),
  },
  {
    name: 'url-on-scroll', path: '/urlscroll', title: 'URL changes (hash, replaceState, pushState) while scrolling',
    html: doc('', `${bands(8, 400)}<script>let n=0;addEventListener('scroll',()=>{n++;const k=n%3;if(k===0)history.replaceState(null,'','?s='+Math.round(scrollY)+'#pos'+n);else if(k===1)location.hash='h'+Math.round(scrollY);else history.pushState(null,'','/urlscroll/section-'+n)})</script>`),
    layout: (width) => ({ height: 3200, cells: stripes(8, 400)(width) }),
  },
  {
    name: 'inner-scroller', path: '/inner', title: 'Content scrolls inside a panel: the whole panel is captured',
    html: doc('html,body{height:100%;overflow:hidden}.top{position:absolute;left:0;top:0;right:0;height:60px;background:#111}.side{position:absolute;left:0;top:60px;bottom:0;width:200px;background:#999}.main{position:absolute;left:200px;top:60px;right:20px;bottom:20px;overflow-y:auto}', `<div class="top"></div><div class="side"></div><div class="main" id="main">${bands(8, 500, 2)}</div>`),
    measure: () => document.querySelector('#main').clientWidth,
    layout: (width) => ({ height: 4000, cells: stripes(8, 500, 2)(width) }),
    expectMessage: /panel/i,
  },
  {
    name: 'js-fixed-header', path: '/jsfixed', title: 'A header that turns position:fixed on scroll appears once',
    html: doc('#h{height:80px;background:' + palette[0] + '}#h.fixed{position:fixed;top:0;left:0;right:0}', `<div id="h"></div>${bands(8, 300, 1)}<script>addEventListener('scroll',()=>document.querySelector('#h').classList.toggle('fixed',scrollY>100))</script>`),
    layout: (width) => ({ height: 2480, cells: [{ x: 0, y: 0, w: width, h: 80, c: 0 }, ...stripes(8, 300, 1, 80)(width)] }),
  },
  {
    name: 'two-columns', path: '/twocol', width: 1800, title: 'Wide LTR page: two columns, three rows',
    html: doc('body{width:1800px}.g{display:grid;grid-template-columns:repeat(2,900px)}.c{height:600px}', `<div class="g">${Array.from({ length: 6 }, (_, i) => `<div class="c" style="background:${palette[i + 6]}"></div>`).join('')}</div>`),
    layout: () => ({ height: 1800, cells: Array.from({ length: 6 }, (_, i) => ({ x: (i % 2) * 900, y: Math.floor(i / 2) * 600, w: 900, h: 600, c: i + 6 })) }),
  },
];

const colors = ['#e55959', '#e8a846', '#e5d854', '#92c750', '#40bb8f', '#3db8c5', '#5597df', '#747bd8', '#a175cd', '#d576af', '#a78c69', '#839b90'];
const html = `<!doctype html><html><head><meta charset="utf-8"><title>PagePress browser smoke fixture</title><style>
html { scroll-behavior: auto; } body { margin: 0; width: 1800px; font: 28px sans-serif; }
.band { height: 300px; box-sizing: border-box; padding: 85px 40px 0; border-right: 150px solid #382569; }
.sticky { position: sticky; top: 0; height: 70px; width: 600px; background: #ff00bd; font-size: 28px; }
.fixed { position: fixed; top: 0; left: 0; width: 980px; height: 48px; background: #192432; color: white; z-index: 10; }
</style></head><body><div class="fixed" id="fixed" style="visibility: visible !important">Fixed header marker</div>${colors.map((color, i) => `<section class="band" id="band${i}" style="background:${color}"><span>BAND ${i + 1} LEFT — independent color marker</span>${i === 4 ? '<div class="sticky" id="sticky" style="left: 12px !important">DEEP STICKY MARKER — must appear once</div>' : ''}<span style="position:absolute;left:1350px">RIGHT ${i + 1}</span></section>`).join('')}</body></html>`;
await writeFile(join(artifact, 'fixture.html'), html);
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://x').pathname;
  const fixture = fixtures.find((f) => path === f.path || path.startsWith(`${f.path}/`));
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(fixture ? fixture.html : html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

// ---- PDF pixel checks: pull the page JPEGs out of the PDF and sample colours. ----
function extractJpegs(bytes) {
  const text = bytes.toString('latin1'), images = [];
  for (let from = 0; ;) {
    const filter = text.indexOf('/DCTDecode', from);
    if (filter < 0) break;
    const stream = text.indexOf('stream', filter);
    let start = stream + 6;
    if (text[start] === '\r') start++;
    if (text[start] === '\n') start++;
    let end = text.indexOf('endstream', start);
    while (text[end - 1] === '\n' || text[end - 1] === '\r') end--;
    images.push(bytes.subarray(start, end));
    from = end;
  }
  for (const image of images) if (image[0] !== 0xff || image[1] !== 0xd8 || image.at(-2) !== 0xff || image.at(-1) !== 0xd9) throw new Error('Could not extract a valid JPEG from the PDF.');
  return images;
}
const nearest = (rgb, choices) => choices.map((c, i) => [i, Math.hypot(rgb[0] - c[0], rgb[1] - c[1], rgb[2] - c[2])]).sort((a, b) => a[1] - b[1])[0];
async function pixelCheck(decoder, pdfPath, docWidth, layout) {
  const jpegs = extractJpegs(await readFile(pdfPath));
  const dims = await decoder.evaluate(async (list) => {
    window.__bitmaps = [];
    for (const b64 of list) window.__bitmaps.push(await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob()));
    return window.__bitmaps.map((b) => [b.width, b.height]);
  }, jpegs.map((j) => j.toString('base64')));
  const [imgW, imgH] = dims[0], scale = imgW / docWidth;
  const expectedPages = Math.ceil(layout.height * scale / imgH - 1e-6);
  if (jpegs.length !== expectedPages) throw new Error(`PDF has ${jpegs.length} page images, expected ${expectedPages}.`);
  const points = jpegs.map(() => []);
  for (const cell of layout.cells) {
    for (let y = cell.y + 14; y <= cell.y + cell.h - 14; y += 53) {
      const scaledY = y * scale, pageIndex = Math.floor(scaledY / imgH), offset = scaledY - pageIndex * imgH;
      if (offset < 4 || offset > imgH - 4 || pageIndex >= jpegs.length) continue;
      for (const x of [cell.x + 14, cell.x + cell.w / 2, cell.x + cell.w - 14]) points[pageIndex].push({ x: Math.round(x * scale), y: Math.round(offset), cell: cell.c, docX: Math.round(x), docY: y });
    }
  }
  const sampled = await decoder.evaluate((request) => request.map((pts, index) => {
    const canvas = new OffscreenCanvas(window.__bitmaps[index].width, window.__bitmaps[index].height), context = canvas.getContext('2d');
    context.drawImage(window.__bitmaps[index], 0, 0);
    return pts.map((p) => { const d = context.getImageData(p.x - 1, p.y - 1, 3, 3).data; let r = 0, g = 0, b = 0; for (let i = 0; i < 36; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } return [r / 9, g / 9, b / 9]; });
  }), points.map((pts) => pts.map(({ x, y }) => ({ x, y }))));
  const choices = [...paletteRgb, white], mismatches = [];
  let count = 0;
  points.forEach((pts, pageIndex) => pts.forEach((p, i) => {
    count++;
    const [index, distance] = nearest(sampled[pageIndex][i], choices);
    if (index !== p.cell || distance > 40) mismatches.push({ page: pageIndex + 1, docX: p.docX, docY: p.docY, expected: p.cell, got: index === choices.length - 1 ? 'white' : index, rgb: sampled[pageIndex][i].map(Math.round) });
  }));
  if (!count) throw new Error('Pixel check sampled nothing.');
  if (mismatches.length) throw new Error(`${mismatches.length} of ${count} sampled pixels have the wrong colour, e.g. ${JSON.stringify(mismatches.slice(0, 4))}`);
  return { pages: jpegs.length, imageSize: [imgW, imgH], samples: count };
}

const profileToken = `profile-${Date.now()}`;
let context;
const report = { fixtureUrl: url, executablePath, productionManifestHash: manifestHash, permissionMode: 'ephemeral test copy: <all_urls> for the capture API, isolated profile, external HTTP blocked', permissionLimitation: 'The Chrome toolbar/shortcut activeTab user gesture cannot be automated, so the production shortcut is not exercised. Real capture, offscreen and download logic runs with a test-copy permission. Production remains activeTab-only (its manifest hash is verified below).', tests: [], errors: [] };
const terminal = new Set(['done', 'error', 'canceled']);
try {
  const extensionPath = join(root, 'extension');
  const copy = join(artifact, 'extension-test-copy');
  await cp(extensionPath, copy, { recursive: true });
  const manifest = JSON.parse(await readFile(join(copy, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  await writeFile(join(copy, 'manifest.json'), JSON.stringify(manifest, null, 2));
  context = await step('launch browser', () => chromium.launchPersistentContext(join(artifact, profileToken), {
    executablePath,
    headless, viewport: { width: 1000, height: 720 }, acceptDownloads: true,
    downloadsPath: join(artifact, 'downloads'),
    args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`, ...(headless ? [] : ['--window-position=-10000,-10000'])],
  }), 60000);
  await context.route(/^https?:/, (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === new URL(url).origin) return route.continue();
    return route.abort('blockedbyclient');
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = new URL(worker.url()).hostname;
  report.extensionId = extensionId;
  const page = await context.newPage();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const decoder = await context.newPage();
  await decoder.goto('about:blank');
  await page.goto(url);
  await page.evaluate(() => scrollTo(230, 570));
  await popup.locator('body').screenshot({ path: join(artifact, 'popup.png') });
  const state = () => page.evaluate(() => ({ x: scrollX, y: scrollY, fixed: { value: document.querySelector('#fixed').style.getPropertyValue('visibility'), priority: document.querySelector('#fixed').style.getPropertyPriority('visibility') }, sticky: ['position', 'top', 'right', 'bottom', 'left'].map(property => [property, document.querySelector('#sticky').style.getPropertyValue(property), document.querySelector('#sticky').style.getPropertyPriority(property)]), captureStyle: !!document.querySelector('[data-pagepress="capture"]') }));
  const original = await state();
  report.original = original;
  const poll = async (timeout = 60000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const status = await worker.evaluate(async () => (await chrome.storage.session.get('exportStatus')).exportStatus);
      if (status && terminal.has(status.phase)) return status;
      await sleep(200);
    }
    return null;
  };
  const download = async (status, name) => {
    let item;
    for (let attempt = 0; attempt < 100; attempt++) {
      [item] = await worker.evaluate(async id => chrome.downloads.search({ id }), status.downloadId);
      if (item?.state === 'complete') break;
      if (item?.state === 'interrupted') throw new Error(`Chrome download interrupted: ${item.error}`);
      await sleep(100);
    }
    if (item?.state !== 'complete') throw new Error('Chrome download did not complete.');
    const target = join(artifact, name);
    await copyFile(item.filename, target);
    const bytes = await readFile(target);
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Chrome download did not produce PDF bytes.');
    return { name, path: target, bytes: bytes.length, status, download: { state: item.state, filename: item.filename } };
  };
  const startExport = async options => {
    await worker.evaluate(async options => { await chrome.storage.local.set({ options }); await chrome.storage.session.remove('exportStatus'); }, options);
    await page.bringToFront();
    const response = await popup.evaluate(async options => chrome.runtime.sendMessage({ target: 'background', type: 'EXPORT', options }), options);
    if (!response.ok) throw new Error(response.error);
  };
  const exportAndWait = async options => {
    await startExport(options);
    const result = await poll();
    if (result?.phase !== 'done') throw new Error(`Export failed: ${result?.message || 'timeout'}`);
    return result;
  };

  // ---- Original fixture checks (wide page, deep sticky, fixed header, restore, cancel, tab switch). ----
  const viewportStatus = await step('viewport export', () => exportAndWait({ scope: 'viewport', loadImages: false, footer: false, margin: 0, quality: 'high' }));
  report.tests.push({ test: 'viewport export via actual capture, offscreen, download', ...(await download(viewportStatus, 'viewport.pdf')), restored: await state() });
  await sleep(700);
  const fullStatus = await step('full export', () => exportAndWait({ scope: 'full', loadImages: false, footer: false, margin: 0, quality: 'high', hideSticky: true }));
  report.tests.push({ test: 'full export: horizontal overflow, deep sticky, nonzero initial scroll', ...(await download(fullStatus, 'full.pdf')), restored: await state() });
  await sleep(700);
  await step('cancel', async () => {
    await startExport({ scope: 'full', loadImages: false, hideSticky: true });
    await sleep(350);
    report.cancelResponse = await popup.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'CANCEL' }));
    report.tests.push({ test: 'cancellation restores scroll and inline styles', status: await poll(), restored: await state() });
  });
  await step('tab switch', async () => {
    await startExport({ scope: 'full', loadImages: false, hideSticky: true });
    await sleep(350);
    const other = await context.newPage();
    await other.goto(url + '?other');
    await other.bringToFront();
    report.tests.push({ test: 'switching tabs aborts export and restores original page', status: await poll(), restored: await state() });
    await other.goto('chrome://version');
    await worker.evaluate(async () => { await chrome.storage.session.remove('exportStatus'); });
    report.protectedResponse = await popup.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'EXPORT' }));
    report.tests.push({ test: 'Chrome internal page is rejected', response: report.protectedResponse });
    await other.close();
  });
  for (const test of report.tests.filter(t => t.restored)) {
    if (JSON.stringify(test.restored) !== JSON.stringify(original)) throw new Error(`Page state not restored: ${test.test}`);
  }
  if (report.tests.find(t => t.test.startsWith('cancellation')).status?.phase !== 'canceled') throw new Error('Cancellation was not reported.');
  const cancellation = report.tests.find(t => t.test.startsWith('cancellation')).status;
  if (cancellation.message !== 'Export canceled.' || cancellation.error !== null) throw new Error('Cancellation did not report a clear cancellation message.');
  if (!report.tests.find(t => t.test.startsWith('switching')).status?.message.includes('switched tabs')) throw new Error('Tab switch was not rejected.');
  if (report.protectedResponse.ok || !report.protectedResponse.error.includes('normal webpage')) throw new Error('Protected page rejection did not behave as expected.');

  // ---- New fixtures: each must finish and put the right colours in the right places. ----
  for (const fixture of fixtures) {
    const entry = { test: fixture.title, fixture: fixture.name };
    report.tests.push(entry);
    try {
      await step(fixture.name, async () => {
        await worker.evaluate(async () => { await chrome.storage.session.remove('exportStatus'); });
        await page.goto(url.replace(/\/$/, '') + fixture.path);
        await page.bringToFront();
        await sleep(300);
        const docWidth = fixture.width ?? await page.evaluate(fixture.measure || (() => document.documentElement.clientWidth));
        const layout = fixture.layout(docWidth);
        const status = await exportAndWait({ scope: 'full', loadImages: false, footer: false, margin: 0, quality: 'high', hideSticky: true });
        Object.assign(entry, await download(status, `${fixture.name}.pdf`));
        if (fixture.expectMessage && !fixture.expectMessage.test(status.message)) throw new Error(`Done message does not mention the scrolling panel: ${status.message}`);
        entry.pixels = await pixelCheck(decoder, entry.path, docWidth, layout);
        entry.passed = true;
      }, 120000);
    } catch (error) { entry.passed = false; entry.error = error.message; report.errors.push(`${fixture.name}: ${error.message}`); }
    await sleep(700);
  }
  report.passed = !report.errors.length;
} catch (error) { report.errors.push(error.stack); report.passed = false; }
finally {
  if (context) await closeContext(context, profileToken);
  await new Promise(r => server.close(r));
  const testManifestPath = join(artifact, 'extension-test-copy/manifest.json');
  const testManifest = await readFile(testManifestPath, 'utf8').then(JSON.parse).catch(() => null);
  if (testManifest) { delete testManifest.host_permissions; await writeFile(testManifestPath, JSON.stringify(testManifest, null, 2)); }
  report.testCopyExtraPermissionRemoved = true;
  report.productionManifestUnchanged = createHash('sha256').update(await readFile(productionManifestPath)).digest('hex') === manifestHash;
  if (!report.productionManifestUnchanged || (JSON.parse(await readFile(productionManifestPath)).host_permissions || []).length) { report.errors.push('Production manifest changed or acquired host permissions.'); report.passed = false; }
  await writeFile(join(artifact, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.tests.map((t) => ({ test: t.test, passed: t.passed, error: t.error, pixels: t.pixels, message: t.status?.message })), null, 2));
  console.log(report.passed ? 'SMOKE PASSED' : `SMOKE FAILED: ${report.errors.join(' | ').slice(0, 1500)}`);
}
process.exit(report.passed ? 0 : 1);
