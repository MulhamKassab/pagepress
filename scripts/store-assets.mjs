import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
const { chromium } = await import('playwright').catch(() => import(pathToFileURL(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href));
const root = resolve('.');
const output = join(root, 'store');
const qa = join(root, '.artifacts/store-assets');
await mkdir(output, { recursive: true });
await mkdir(qa, { recursive: true });
const runtime = join(root, '.artifacts/browser-smoke/official-runtime/chromium-1234/chrome-win64/chrome.exe');
const executablePath = process.env.PAGEPRESS_CHROMIUM_PATH || (await access(runtime).then(() => runtime).catch(() => chromium.executablePath()));
const extensionPath = join(root, 'extension');
const context = await chromium.launchPersistentContext(join(qa, `profile-${Date.now()}`), {
  executablePath, headless: true, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
try {
  // Capture the shipping extension's real interface in a fresh test profile.
  // No permission changes, user browser data, external requests, or mocked UI.
  await context.route('https://**/*', route => route.abort());
  await context.route('http://**/*', route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#pageTitle').waitFor();
  await popup.waitForFunction(() => {
    const hint = document.querySelector('#shortcutHint').textContent;
    return hint.includes('chrome://extensions/shortcuts') || hint.includes('to save with these settings.');
  });
  await popup.locator('body').screenshot({ path: join(qa, 'popup-current.png') });
  const popupBytes = await readFile(join(qa, 'popup-current.png'));
  const popupImage = `data:image/png;base64,${popupBytes.toString('base64')}`;
  const iconBytes = await readFile(join(extensionPath, 'icons/icon128.png'));
  const iconImage = `data:image/png;base64,${iconBytes.toString('base64')}`;
  const styles = `<style>*{box-sizing:border-box}body{margin:0;background:#f6f3eb;color:#17283f;font-family:Arial,Helvetica,sans-serif}.capture{width:1280px;height:800px;padding:72px 82px;position:relative;overflow:hidden}.label{color:#365fff;font-weight:700;font-size:14px;letter-spacing:2px}.capture h1{font-size:66px;letter-spacing:-3px;margin:25px 0 8px}.by{font-size:18px;color:#697484}.capture h2{font-size:38px;line-height:1.13;letter-spacing:-1px;width:550px;margin:48px 0 24px}.features{font-size:20px;line-height:1.8;padding:0;list-style:none}.features li:before{content:'✓';color:#365fff;margin-right:13px;font-weight:700}.note{font-size:14px;line-height:1.6;color:#697484;width:490px;margin-top:26px}.domain{position:absolute;left:82px;bottom:49px;font-weight:700;font-size:18px}.popup{position:absolute;right:84px;top:48px;width:386px;box-shadow:0 20px 55px #17283f26;border-radius:12px;overflow:hidden;border:1px solid #dfe0df}.popup img{display:block;width:386px}.accent{position:absolute;width:460px;height:460px;border-radius:50%;background:#e7eaff;right:-90px;bottom:-180px;z-index:-1}.small{width:440px;height:280px;padding:27px 31px;position:relative;overflow:hidden}.small .top{display:flex;align-items:center;gap:12px}.small img{width:46px;height:46px}.small h1{font-size:37px;letter-spacing:-1.6px;margin:0}.small .by{font-size:12px;margin:5px 0 0}.small h2{font-size:24px;line-height:1.2;letter-spacing:-.5px;margin:28px 0 10px}.small p{font-size:13px;color:#697484;margin:0}.small .bottom{position:absolute;bottom:25px;font-size:13px;font-weight:700;color:#365fff}.small:after{content:'';position:absolute;width:145px;height:145px;border:28px solid #e7eaff;border-radius:50%;bottom:-67px;right:-42px;z-index:-1}</style>`;
  const screenshotHtml = `<!doctype html><meta charset="utf-8">${styles}<main class="capture"><div class="label">WEBPAGE → PDF</div><h1>webTopdf</h1><div class="by">by Mulham Kassab</div><h2>Keep the page.<br>Make it a PDF.</h2><ul class="features"><li>Full page or current view</li><li>Hide distractions before saving</li><li>PDF processing on your device</li></ul><p class="note">Visual PDFs capture the page as an image.<br>Use browser print when you need selectable text.</p><div class="domain">mulhamkassab.dev</div><div class="popup"><img alt="Actual webTopdf extension interface" src="${popupImage}"></div><div class="accent"></div></main>`;
  const promoHtml = `<!doctype html><meta charset="utf-8">${styles}<main class="small"><div class="top"><img src="${iconImage}" alt=""><div><h1>webTopdf</h1><div class="by">by Mulham Kassab</div></div></div><h2>Save the page.<br>Keep it as a PDF.</h2><p>Full-page capture. Local processing.</p><div class="bottom">mulhamkassab.dev</div></main>`;
  const marqueeHtml = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#17283f;color:#f6f3eb;font-family:Arial,Helvetica,sans-serif}.marquee{position:relative;width:1400px;height:560px;padding:56px 76px;overflow:hidden}.wordmark{display:flex;align-items:center;gap:18px}.wordmark img{width:68px;height:68px}.wordmark h1{font-size:52px;letter-spacing:-2px;margin:0}.by{font-size:16px;color:#bdc7d5;margin:7px 0 0}.marquee h2{font-size:55px;line-height:1.13;letter-spacing:-2px;margin:41px 0 25px}.marquee h2 em{font-family:Georgia,serif;font-weight:400;color:#adbfff}.features{font-size:17px;color:#c7d2e2;letter-spacing:.3px}.domain{position:absolute;left:76px;bottom:46px;font-size:18px;font-weight:700}.halo{position:absolute;width:630px;height:630px;border-radius:50%;right:-28px;top:-35px;background:#243d6b}.sheet{position:absolute;top:87px;right:172px;width:254px;height:345px;background:#fffdfa;border-radius:8px;box-shadow:0 18px 40px #0003;color:#17283f;transform:rotate(7deg);padding:29px}.sheet-back{top:78px;right:229px;transform:rotate(-9deg);background:#365fff}.sheet img{width:53px;height:53px}.sheet strong{display:block;margin:21px 0 12px;font-size:21px;letter-spacing:-.4px}.sheet .rule{height:6px;border-radius:2px;background:#dde1e7;margin:10px 0}.sheet .rule.short{width:67%}.sheet small{display:block;border-top:1px solid #d9dde2;margin-top:25px;padding-top:14px;font-size:11px;color:#697484}.pdf-badge{position:absolute;right:112px;bottom:75px;background:#365fff;border:1px solid #6a88ff;color:white;box-shadow:0 8px 25px #0002;border-radius:9px;padding:17px 23px;font-size:20px;font-weight:700;letter-spacing:1px}</style><main class="marquee"><div class="halo"></div><div class="wordmark"><img src="${iconImage}" alt=""><div><h1>webTopdf</h1><p class="by">by Mulham Kassab</p></div></div><h2>The page you need.<br>A <em>PDF</em> you can keep.</h2><p class="features">Full page · Current view · Local processing</p><div class="domain">mulhamkassab.dev</div><div class="sheet sheet-back"></div><div class="sheet"><img src="${iconImage}" alt=""><strong>Saved webpage</strong><div class="rule"></div><div class="rule short"></div><div class="rule"></div><div class="rule short"></div><small>A page worth keeping.</small></div><div class="pdf-badge">PDF ↓</div></main>`;
  const canvas = await context.newPage();
  await canvas.setContent(screenshotHtml);
  await canvas.screenshot({ path: join(output, 'screenshot-capture.png'), clip: { x: 0, y: 0, width: 1280, height: 800 } });
  await canvas.setViewportSize({ width: 440, height: 280 });
  await canvas.setContent(promoHtml);
  await canvas.screenshot({ path: join(output, 'promo-small.png'), clip: { x: 0, y: 0, width: 440, height: 280 } });
  await canvas.setViewportSize({ width: 1400, height: 560 });
  await canvas.setContent(marqueeHtml);
  await canvas.screenshot({ path: join(output, 'promo-marquee.png'), clip: { x: 0, y: 0, width: 1400, height: 560 } });
  await copyFile(join(extensionPath, 'icons/icon128.png'), join(output, 'icon128.png'));
  await writeFile(join(qa, 'screenshot-source.html'), screenshotHtml);
  await writeFile(join(qa, 'promo-source.html'), promoHtml);
  await writeFile(join(qa, 'marquee-source.html'), marqueeHtml);
  const expected = [['screenshot-capture.png', 1280, 800], ['promo-small.png', 440, 280], ['promo-marquee.png', 1400, 560], ['icon128.png', 128, 128]];
  for (const [name, width, height] of expected) {
    const png = await readFile(join(output, name));
    if (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) throw new Error(`Incorrect dimensions: ${name}`);
    if (name !== 'icon128.png' && (png[24] !== 8 || png[25] !== 2)) throw new Error(`Store screenshot/promo must be a 24-bit RGB PNG without alpha: ${name}`);
    console.log(`${name}: ${width} × ${height}`);
  }
} finally {
  await context.close();
}
