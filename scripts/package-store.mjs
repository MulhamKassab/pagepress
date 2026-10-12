import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { zipSync, unzipSync } from 'fflate';

const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
const extensionName = `webtopdf-extension-v${manifest.version}.zip`;
const extension = await readFile(`.artifacts/${extensionName}`);
const packaged = JSON.parse(new TextDecoder().decode(unzipSync(extension)['manifest.json']));
if (packaged.name !== 'webTopdf' || packaged.version !== manifest.version || packaged.homepage_url !== 'https://mulhamkassab.dev/') throw new Error('Store package metadata does not match the requested name and homepage.');
if (packaged.host_permissions?.length) throw new Error('Store package must retain temporary active-tab access.');

const entries = { [extensionName]: new Uint8Array(extension) };
for (const name of ['listing.txt', 'fields.txt', 'submission-guide.md', 'privacy-and-permissions.txt', 'screenshot-capture.png', 'promo-small.png', 'promo-marquee.png', 'icon128.png']) {
  entries[name] = new Uint8Array(await readFile(`store/${name}`));
}
entries['README.txt'] = new TextEncoder().encode(`webTopdf by Mulham Kassab\nhttps://mulhamkassab.dev/\n\nExtract this kit first. Upload ONLY ${extensionName} to the Chrome Web Store, not this outer kit. Add the included PNG graphics and use listing.txt and privacy-and-permissions.txt to fill the dashboard. Read submission-guide.md for the steps.\n\nStore submission and approval are still pending.\n`);
await mkdir('.artifacts', { recursive: true });
const output = `.artifacts/webtopdf-store-kit-v${manifest.version}.zip`;
await writeFile(output, zipSync(entries, { level: 6 }));
console.log(`${output}: ${Object.keys(entries).length} submission files; extension metadata verified.`);
