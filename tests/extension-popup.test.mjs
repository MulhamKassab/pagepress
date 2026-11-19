import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reportUrl } from '../extension/lib/report.js';

const read = (path) => JSON.parse(fs.readFileSync(new URL(`../extension/${path}`, import.meta.url), 'utf8'));

test('report link carries version, browser and last error only', () => {
  const url = new URL(reportUrl('1.2.0', 'TestAgent/1', 'Capture failed'));
  assert.equal(url.origin + url.pathname, 'https://github.com/MulhamKassab/pagepress/issues/new');
  const body = url.searchParams.get('body');
  assert.match(body, /webTopdf version: 1\.2\.0/);
  assert.match(body, /Browser: TestAgent\/1/);
  assert.match(body, /Last error shown: Capture failed/);
  assert.match(new URL(reportUrl('1.2.0', 'UA', '')).searchParams.get('body'), /Last error shown: none/);
});

test('popup locale files have the same keys, and every message is non-empty', () => {
  const en = read('_locales/en/messages.json'), ar = read('_locales/ar/messages.json');
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const [key, value] of Object.entries({ ...en, ...ar })) assert.ok(value.message.trim(), key);
  for (const key of Object.keys(en)) {
    const placeholders = (text) => (text.match(/\$\d/g) || []).sort().join();
    assert.equal(placeholders(ar[key].message), placeholders(en[key].message), key);
  }
});
