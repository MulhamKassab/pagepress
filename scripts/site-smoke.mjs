import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { unzipSync } from 'fflate';
import { createSiteServer } from './serve.mjs';

// Set PAGEPRESS_CHROMIUM_PATH to use a specific Chrome/Edge; otherwise Playwright's own Chromium is used.
const { chromium } = await import('playwright');
const root = resolve('.'), artifact = join(root, '.artifacts/qa');
const executablePath = process.env.PAGEPRESS_CHROMIUM_PATH || undefined;
await mkdir(artifact, { recursive: true });
const server = await createSiteServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const storeUrl = 'https://chromewebstore.google.com/detail/webtopdf/mjaclamnjdmipobljileifmgkppiaeeb';
const pages = ['', 'install', 'privacy', 'does-not-exist'];
const report = { origin: url, tests: [], browserErrors: [] };
const logStep = name => { if (process.env.SMOKE_VERBOSE) console.error('ok:', name); };
const origPush = report.tests.push.bind(report.tests); report.tests.push = entry => { logStep(entry.test); return origPush(entry); };
const fail = message => { throw new Error(message); };
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const watch = target => {
    target.on('pageerror', error => report.browserErrors.push(`pageerror: ${error.message}`));
    target.on('console', message => { if (['error', 'warning'].includes(message.type()) && /Content Security Policy|Refused to|violat/i.test(message.text())) report.browserErrors.push(`CSP: ${message.text()}`); });
    target.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/does-not-exist')) report.browserErrors.push(`${response.status()} ${response.url()}`); });
  };
  watch(page);

  // Headers, redirects, static files
  const headers = (await context.request.get(url)).headers();
  if (!/frame-ancestors 'none'/.test(headers['content-security-policy'] || '') || !/default-src 'self'/.test(headers['content-security-policy'])) fail('Content-Security-Policy header is missing or incomplete.');
  if (headers['x-frame-options'] !== 'DENY') fail('X-Frame-Options header is missing.');
  report.tests.push({ test: 'Security headers present (CSP, frame-ancestors, X-Frame-Options)' });
  const missing = await context.request.get(url + 'does-not-exist');
  if (missing.status() !== 404 || !(await missing.text()).includes('Page not')) fail('Custom 404 page is not served with status 404.');
  report.tests.push({ test: 'Custom 404 page with 404 status' });
  for (const file of ['robots.txt', 'sitemap.xml']) {
    const response = await context.request.get(url + file);
    if (response.status() !== 200) fail(`${file} is missing.`);
  }
  const sitemap = await (await context.request.get(url + 'sitemap.xml')).text();
  for (const path of ['', 'install', 'privacy']) if (!sitemap.includes(`https://webtopdf.mulhamkassab.dev/${path}</loc>`)) fail(`sitemap.xml does not list /${path}.`);
  report.tests.push({ test: 'robots.txt and sitemap.xml served' });
  const og = Buffer.from(await (await context.request.get(url + 'brand/og.png')).body());
  if (og.readUInt32BE(16) !== 1200 || og.readUInt32BE(20) !== 630) fail('og.png must be 1200x630.');
  report.tests.push({ test: 'Share image is 1200x630' });
  const oldZip = await context.request.get(url + 'downloads/pagepress-extension.zip', { maxRedirects: 0 });
  if (oldZip.status() !== 308 || !oldZip.headers().location?.endsWith('/downloads/webtopdf-extension.zip')) fail('Old pagepress-extension.zip is not redirected to webtopdf-extension.zip.');
  report.tests.push({ test: 'Old ZIP name redirects to the new one' });
  const clean = await context.request.get(url + 'install.html', { maxRedirects: 0 });
  if (clean.status() !== 308) fail('cleanUrls redirect for /install.html is not applied.');

  // Content and metadata of each page
  for (const path of pages.slice(0, 3)) {
    await page.goto(url + path);
    if (await page.locator('h1').count() !== 1) fail(`/${path} must have exactly one h1.`);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    if (canonical !== `https://webtopdf.mulhamkassab.dev/${path}`) fail(`Canonical link is wrong on /${path}: ${canonical}`);
    for (const selector of ['meta[property="og:title"]', 'meta[property="og:image"]', 'meta[name="twitter:card"]', 'meta[name="description"]']) if (!(await page.locator(selector).count())) fail(`/${path} is missing ${selector}.`);
    report.tests.push({ test: `Metadata on /${path}`, title: await page.title() });
  }
  await page.goto(url);
  if (await page.locator('.installation-card > ol > li').count() !== 3) fail('Home page is missing the 3 store installation steps.');
  for (const path of ['', 'install']) {
    await page.goto(url + path);
    const storeLink = page.getByTestId('chrome-store-link');
    if (!(await storeLink.isVisible()) || await storeLink.getAttribute('href') !== storeUrl || await storeLink.getAttribute('target') !== '_blank') fail(`Chrome Web Store link is missing or incorrect on ${path || 'home'}.`);
    if (await page.getByTestId('download-extension').isVisible().catch(() => false)) fail('Manual download must stay inside the developer disclosure.');
    if (await page.getByTestId('mobile-note').isVisible()) fail('Mobile note must not show on desktop.');
  }
  report.tests.push({ test: 'Store link on home and Help page; no mobile note on desktop' });
  await page.goto(url + 'install');
  const faq = await page.locator('main').textContent();
  for (const topic of ['Why can’t I save some pages', 'Searchable print', 'infinite', 'inside a panel', 'Arabic', 'developer email']) if (!faq.includes(topic)) fail(`Help & FAQ page is missing the topic "${topic}".`);
  report.tests.push({ test: 'Help & FAQ covers the required topics' });
  await page.goto(url + 'privacy');
  const privacy = await page.locator('main').textContent();
  for (const phrase of ['Mulham Kassab', 'Website content', 'Web history', 'User activity', 'Children', 'November 19, 2026', 'Chrome Web Store listing']) if (!privacy.includes(phrase)) fail(`Privacy policy is missing "${phrase}".`);
  if (/@[a-z0-9-]+\.[a-z]{2,}/i.test(privacy)) fail('Privacy policy must not contain an email address.');
  report.tests.push({ test: 'Privacy policy content' });

  // Manual ZIP (developers) and copy button
  await page.goto(url);
  await page.locator('.manual-install > summary').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="zip-version"]')?.textContent.trim().match(/^\d+\.\d+\.\d+$/));
  await page.getByTestId('copy-extensions').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  if (copied !== 'chrome://extensions') fail('Extensions address was not copied.');
  report.tests.push({ test: 'Chrome extensions address copied', value: copied });
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-extension').click();
  const download = await downloadPromise;
  if (await download.failure()) fail(await download.failure());
  const downloadedPath = join(artifact, 'site-downloaded-extension.zip');
  await download.saveAs(downloadedPath);
  const zip = unzipSync(await readFile(downloadedPath));
  const manifest = JSON.parse(new TextDecoder().decode(zip['manifest.json']));
  const sourceManifest = JSON.parse(await readFile(join(root, 'extension/manifest.json'), 'utf8'));
  if (manifest.version !== sourceManifest.version || manifest.host_permissions?.length) fail('Extension download version or permissions mismatch.');
  const shownVersion = (await page.getByTestId('zip-version').textContent()).trim();
  if (shownVersion !== sourceManifest.version) fail(`ZIP version notice (${shownVersion}) does not match the manifest (${sourceManifest.version}).`);
  report.tests.push({ test: 'Developer ZIP contains the production manifest and shows its version', version: manifest.version, files: Object.keys(zip).length });

  // Layout at three widths on every page, including the 404
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const path of pages) {
      await page.goto(url + path);
      const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, scrollHeight: document.documentElement.scrollHeight }));
      if (dimensions.scrollWidth > dimensions.innerWidth) fail(`Horizontal overflow at ${width}px on ${path || 'home'}.`);
      report.tests.push({ test: `${path || 'home'} at ${width}px`, ...dimensions });
      await page.screenshot({ path: join(artifact, `simple-${width}-${path || 'home'}.png`), fullPage: true });
    }
  }

  // Clipboard failure fallback
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await page.locator('.manual-install > summary').click();
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new DOMException('Clipboard unavailable', 'NotAllowedError'); } }); });
  await page.getByTestId('copy-extensions').click();
  const fallback = await page.getByTestId('copy-status').textContent();
  if (!fallback?.includes('chrome://extensions')) fail('Manual copy fallback is missing.');
  report.tests.push({ test: 'Clipboard failure offers manual address', feedback: fallback });

  // Mobile visitors get the desktop-only note
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
  const mobilePage = await mobileContext.newPage();
  watch(mobilePage);
  for (const path of ['', 'install']) {
    await mobilePage.goto(url + path);
    await mobilePage.getByTestId('mobile-note').waitFor({ state: 'visible', timeout: 5000 });
    if (!(await mobilePage.getByTestId('mobile-note').textContent()).includes('Desktop Chrome or Edge only')) fail('Mobile note text is wrong.');
  }
  report.tests.push({ test: 'Mobile user agent sees the desktop-only note' });

  // Without JavaScript the store link must still work
  const noJsContext = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const noJsPage = await noJsContext.newPage();
  await noJsPage.goto(url);
  if (!(await noJsPage.getByTestId('chrome-store-link').isVisible()) || await noJsPage.getByTestId('chrome-store-link').getAttribute('href') !== storeUrl) fail('Store installation must work without JavaScript.');
  await noJsPage.locator('.manual-install > summary').click();
  if (!(await noJsPage.getByTestId('download-extension').isVisible()) || !(await noJsPage.locator('body').textContent()).includes('chrome://extensions')) fail('Developer ZIP instructions must work without JavaScript.');
  report.tests.push({ test: 'Store link and developer ZIP available without JavaScript' });

  if (report.browserErrors.length) fail('Browser page errors, CSP violations or HTTP failures.');
  report.passed = true;
} catch (error) { report.error = error.stack; report.passed = false; }
finally { if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 8000))]); /* Edge can be slow to exit */ server.closeAllConnections(); await new Promise(r => server.close(r)); await writeFile(join(artifact, 'site-smoke.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
process.exit(report.passed ? 0 : 1);
