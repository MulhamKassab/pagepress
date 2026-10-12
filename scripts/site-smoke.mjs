import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
const { chromium } = await import('playwright').catch(() => import(pathToFileURL(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href));

const root = resolve('.'), website = join(root, 'website'), artifact = join(root, '.artifacts/qa');
const officialRuntime = join(root, '.artifacts/browser-smoke/official-runtime/chromium-1234/chrome-win64/chrome.exe');
const executablePath = process.env.PAGEPRESS_CHROMIUM_PATH || (await access(officialRuntime).then(() => officialRuntime).catch(() => chromium.executablePath()));
await mkdir(artifact, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.zip': 'application/zip', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = resolve(website, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(website + sep)) throw new Error('Invalid path');
    const bytes = await readFile(target);
    response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream' }); response.end(bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const report = { origin: url, tests: [], browserErrors: [] };
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => report.browserErrors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) report.browserErrors.push(`${response.status()} ${response.url()}`); });
  await page.goto(url); await page.waitForFunction(() => !!window.jspdf && document.querySelector('#demo-canvas').width === 720);
  await page.screenshot({ path: join(artifact, 'desktop.png'), fullPage: true });
  await page.locator('#demo').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifact, 'desktop-demo.png') });
  const exportSample = async (filename, sample, values) => {
    await page.locator(`[data-sample="${sample}"]`).click();
    for (const [name, value] of Object.entries(values)) {
      if (name === 'capture') {
        const input = page.locator(`input[name="${name}"][value="${value}"]`);
        if (!(await input.isChecked())) await page.locator(`label:has(input[name="${name}"][value="${value}"])`).click();
      }
      else if (typeof value === 'boolean') {
        const input = page.locator(`input[name="${name}"]`);
        if ((await input.isChecked()) !== value) await page.locator(`label:has(input[name="${name}"])`).click();
      }
      else await page.locator(`select[name="${name}"]`).selectOption(String(value));
    }
    const expected = await page.locator('#preview-count-label').textContent();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download-demo').click();
    const download = await downloadPromise;
    if (await download.failure()) throw new Error(await download.failure());
    await download.saveAs(join(artifact, filename));
    const status = await page.locator('#demo-status').textContent();
    const bytes = await readFile(join(artifact, filename));
    if (bytes.subarray(0, 5).toString() !== '%PDF-' || !status.includes('Saved your')) throw new Error(`Invalid demo PDF: ${filename}`);
    report.tests.push({ test: filename, sample, values, expected, status, bytes: bytes.length, path: join(artifact, filename) });
  };
  await exportSample('article-a4-portrait.pdf', 'article', { capture: 'full', paper: 'a4', orientation: 'portrait', margin: '12', scale: '1', hideNav: true, images: true, source: true });
  await exportSample('menu-letter-landscape.pdf', 'menu', { capture: 'full', paper: 'letter', orientation: 'landscape', margin: '6', scale: '1.12', hideNav: false, images: true, source: true });
  await exportSample('article-visible-noimages.pdf', 'article', { capture: 'viewport', paper: 'a4', orientation: 'portrait', margin: '0', scale: '0.88', hideNav: true, images: false, source: false });
  const packageDownloadPromise = page.waitForEvent('download');
  await page.locator('.hero-actions a[href$=".zip"]').click();
  const packageDownload = await packageDownloadPromise;
  await packageDownload.saveAs(join(artifact, 'site-downloaded-extension.zip'));
  const packageBytes = await readFile(join(artifact, 'site-downloaded-extension.zip'));
  if (packageBytes.readUInt16LE(0) !== 0x4b50) throw new Error('Downloaded extension ZIP invalid.');
  report.tests.push({ test: 'extension ZIP download', bytes: packageBytes.length });
  for (const path of ['install.html', 'privacy.html']) { await page.goto(url + path); await page.screenshot({ path: join(artifact, `desktop-${path}.png`), fullPage: true }); }
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2, hasTouch: true });
  const phone = await mobile.newPage(); await phone.goto(url);
  await phone.waitForFunction(() => !!window.jspdf && document.querySelector('#demo-canvas').width === 720);
  const mobileOverflow = await phone.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, scrollHeight: document.documentElement.scrollHeight }));
  report.tests.push({ test: 'mobile width 390 no horizontal overflow', ...mobileOverflow });
  if (mobileOverflow.scrollWidth > mobileOverflow.innerWidth) throw new Error('Mobile horizontal overflow.');
  await phone.screenshot({ path: join(artifact, 'mobile.png'), fullPage: true });
  await phone.locator('#demo').scrollIntoViewIfNeeded(); await phone.screenshot({ path: join(artifact, 'mobile-demo.png') });
  for (const path of ['install.html', 'privacy.html']) { await phone.goto(url + path); await phone.screenshot({ path: join(artifact, `mobile-${path}.png`), fullPage: true }); }
  if (report.browserErrors.length) throw new Error('Browser page errors or HTTP failures.');
  report.passed = true;
} catch (error) { report.error = error.stack; report.passed = false; }
finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); await writeFile(join(artifact, 'site-smoke.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
process.exitCode = report.passed ? 0 : 1;
