import { cp, readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { zipSync } from 'fflate';

const root = resolve('.');
for (const target of ['extension/vendor']) {
  await mkdir(target, { recursive: true });
  await cp('node_modules/jspdf/dist/jspdf.umd.min.js', `${target}/jspdf.umd.min.js`);
  await cp('node_modules/jspdf/LICENSE', `${target}/jspdf-LICENSE.txt`);
}
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Manifest V3 is required');
if ((manifest.host_permissions || []).length) throw new Error('webTopdf must not request persistent all-site access');
const required = ['manifest.json', 'background.js', 'popup.html', 'icons/icon128.png', 'vendor/jspdf.umd.min.js'];
for (const file of required) await stat(join(root, 'extension', file));
await cp('LICENSE', 'extension/LICENSE');
if (await stat('website/brand/logo.svg').catch(() => null)) await cp('website/brand/logo.svg', 'extension/icons/logo.svg');
const entries = {};
async function add(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await add(path);
    else {
      const key = relative(join(root, 'extension'), path).replaceAll('\\', '/');
      if (key.endsWith('.map') || key.startsWith('.')) continue;
      entries[key] = new Uint8Array(await readFile(path));
    }
  }
}
await add(join(root, 'extension'));
const archive = zipSync(entries, { level: 6 });
await mkdir('website/downloads', { recursive: true });
await mkdir('.artifacts', { recursive: true });
await writeFile('website/downloads/webtopdf-extension.zip', archive);
await writeFile('website/downloads/pagepress-extension.zip', archive); // Keep existing download links working.
await writeFile(`.artifacts/webtopdf-extension-v${manifest.version}.zip`, archive);
await writeFile('website/downloads/release.json', JSON.stringify({ version: manifest.version, minimumChromeVersion: manifest.minimum_chrome_version, archive: '/downloads/webtopdf-extension.zip', source: 'https://github.com/MulhamKassab/pagepress', bytes: archive.byteLength }, null, 2) + '\n');
console.log(`webTopdf ${manifest.version}: packaged ${Object.keys(entries).length} extension files (${Math.round(archive.byteLength / 1024)} KB). Website ready in website/.`);
