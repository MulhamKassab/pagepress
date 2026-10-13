import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
const { chromium } = await import('playwright').catch(() => import(pathToFileURL(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href));

const root = resolve('.'), website = join(root, 'website'), artifact = join(root, '.artifacts/qa');
const officialRuntime = join(root, '.artifacts/browser-smoke/official-runtime/chromium-1234/chrome-win64/chrome.exe');
const executablePath = process.env.PAGEPRESS_CHROMIUM_PATH || (await access(officialRuntime).then(() => officialRuntime).catch(() => chromium.executablePath()));
await mkdir(artifact, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.zip': 'application/zip', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') pathname = '/index.html';
    else if (!extname(pathname)) pathname += '.html';
    const target = resolve(website, '.' + pathname);
    if (!target.startsWith(website + sep)) throw new Error('Invalid path');
    const bytes = await readFile(target);
    response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream' }); response.end(bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const storeUrl = 'https://chromewebstore.google.com/detail/webtopdf/mjaclamnjdmipobljileifmgkppiaeeb';
const report = { origin: url, tests: [], browserErrors: [] };
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', error => report.browserErrors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) report.browserErrors.push(`${response.status()} ${response.url()}`); });
  await page.goto(url);
  if (await page.locator('h1').count() !== 1 || await page.locator('.installation-card > ol > li').count() !== 3) throw new Error('Installation page is missing its heading or store installation steps.');
  for (const path of ['', 'install']) {
    await page.goto(url + path);
    const storeLink = page.getByTestId('chrome-store-link');
    if (!(await storeLink.isVisible()) || await storeLink.getAttribute('href') !== storeUrl || await storeLink.getAttribute('target') !== '_blank') throw new Error(`Chrome Web Store link is missing or incorrect on ${path || 'home'}.`);
    if ((await page.locator('body').textContent()).includes('not yet on the Chrome Web Store')) throw new Error('Outdated store availability notice remains.');
    if (await page.getByTestId('download-extension').isVisible()) throw new Error('Manual download should be inside the optional installation disclosure.');
    report.tests.push({ test: `Chrome Web Store installation on ${path || 'home'}`, href: storeUrl });
  }
  await page.goto(url);
  await page.locator('.manual-install > summary').click();
  await page.getByTestId('copy-extensions').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  if (copied !== 'chrome://extensions') throw new Error('Extensions address was not copied.');
  report.tests.push({ test: 'Chrome extensions address copied', value: copied });
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-extension').click();
  const download = await downloadPromise;
  if (await download.failure()) throw new Error(await download.failure());
  const downloadedPath = join(artifact, 'site-downloaded-extension.zip');
  await download.saveAs(downloadedPath);
  const zip = unzipSync(await readFile(downloadedPath));
  const manifest = JSON.parse(new TextDecoder().decode(zip['manifest.json']));
  const sourceManifest = JSON.parse(await readFile(join(root, 'extension/manifest.json'), 'utf8'));
  if (manifest.version !== sourceManifest.version || manifest.host_permissions?.length) throw new Error('Extension download version or permissions mismatch.');
  report.tests.push({ test: 'Extension ZIP download contains the production manifest', version: manifest.version, files: Object.keys(zip).length });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const path of ['', 'install', 'privacy']) {
      await page.goto(url + path);
      const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, scrollHeight: document.documentElement.scrollHeight }));
      if (dimensions.scrollWidth > dimensions.innerWidth) throw new Error(`Horizontal overflow at ${width}px on ${path || 'home'}.`);
      report.tests.push({ test: `${path || 'home'} at ${width}px`, ...dimensions });
      await page.screenshot({ path: join(artifact, `simple-${width}-${path || 'home'}.png`), fullPage: true });
    }
  }
  await page.goto(url);
  await page.locator('.manual-install > summary').click();
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new DOMException('Clipboard unavailable', 'NotAllowedError'); } }); });
  await page.getByTestId('copy-extensions').click();
  const fallback = await page.getByTestId('copy-status').textContent();
  if (!fallback?.includes('chrome://extensions')) throw new Error('Manual copy fallback is missing.');
  report.tests.push({ test: 'Clipboard failure offers manual address', feedback: fallback });
  const noJsContext = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const noJsPage = await noJsContext.newPage();
  await noJsPage.goto(url);
  if (!(await noJsPage.getByTestId('chrome-store-link').isVisible()) || await noJsPage.getByTestId('chrome-store-link').getAttribute('href') !== storeUrl) throw new Error('Store installation must work without JavaScript.');
  await noJsPage.locator('.manual-install > summary').click();
  if (!(await noJsPage.getByTestId('download-extension').isVisible()) || !(await noJsPage.locator('body').textContent()).includes('chrome://extensions')) throw new Error('Manual instructions and download must work without JavaScript.');
  report.tests.push({ test: 'Store and manual installation available without JavaScript' });
  if (report.browserErrors.length) throw new Error('Browser page errors or HTTP failures.');
  report.passed = true;
} catch (error) { report.error = error.stack; report.passed = false; }
finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); await writeFile(join(artifact, 'site-smoke.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
process.exitCode = report.passed ? 0 : 1;
