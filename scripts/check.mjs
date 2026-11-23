import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (/\.(m?js)$/.test(entry.name)) result.push(path);
    else if (entry.name.endsWith('.json')) JSON.parse(await readFile(path, 'utf8'));
  }
  return result;
}
let count = 0;
for (const dir of ['api', 'extension', 'website', 'scripts', 'tests']) {
  for (const file of await walk(dir)) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || `Syntax failed: ${file}`);
    count++;
  }
}
console.log(`Checked ${count} JavaScript files and all JSON manifests.`);

// ---- i18n consistency: code, HTML and manifest vs extension/_locales ----
const problems = [];
const locales = {};
for (const lang of ['en', 'ar']) {
  try {
    const data = JSON.parse(await readFile(`extension/_locales/${lang}/messages.json`, 'utf8'));
    for (const [key, entry] of Object.entries(data)) {
      if (!/^[A-Za-z0-9]+$/.test(key)) problems.push(`${lang}: invalid key name "${key}" (use letters and digits only)`);
      if (typeof entry?.message !== 'string' || !entry.message) problems.push(`${lang}: key "${key}" has no message`);
    }
    locales[lang] = data;
  } catch (error) {
    problems.push(`${lang}: cannot read extension/_locales/${lang}/messages.json (${error.message})`);
    locales[lang] = {};
  }
}
const { en, ar } = locales;
const manifestText = await readFile('extension/manifest.json', 'utf8');
const manifest = JSON.parse(manifestText);
if (manifest.default_locale !== 'en') problems.push('manifest: default_locale must be "en"');

function unescapeLiteral(quote, body) {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, c) => {
    if (c[0] === 'u') return String.fromCodePoint(parseInt(c.replace(/^u\{?|\}$/g, ''), 16));
    if (c[0] === 'x' && c.length === 3) return String.fromCharCode(parseInt(c.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[c] ?? c;
  });
}
// t('key', 'English text' ...) with string-literal arguments (also used by content.js's local t).
const callPattern = /(?<![\w.$])t\(\s*(['"`])([A-Za-z0-9]+)\1\s*,\s*(['"`])((?:\\[\s\S]|(?!\3)[^\\])*)\3(\s*[+,)])/g;
let calls = 0;
for (const file of (await walk('extension')).filter(name => name.endsWith('.js'))) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(callPattern)) {
    const [, , key, quote, body, after] = match;
    const line = source.slice(0, match.index).split('\n').length;
    const where = `${file.replaceAll('\\', '/')}:${line}`;
    const lineText = source.split('\n')[line - 1].trimStart();
    if (lineText.startsWith('//') || lineText.startsWith('*') || lineText.startsWith('/*')) continue; // documentation examples
    calls++;
    if (after.trim() === '+') { problems.push(`${where}: t('${key}') English text is concatenated; use one string literal`); continue; }
    if (quote === '`' && body.includes('${')) { problems.push(`${where}: t('${key}') English text must not use \${} interpolation; use $1 placeholders`); continue; }
    const english = unescapeLiteral(quote, body);
    if (!en[key]) problems.push(`${where}: key "${key}" is missing in _locales/en`);
    else if (en[key].message !== english) problems.push(`${where}: key "${key}" English text differs from _locales/en (code: ${JSON.stringify(english)}; locale: ${JSON.stringify(en[key].message)})`);
    if (!ar[key]) problems.push(`${where}: key "${key}" is missing in _locales/ar`);
  }
}
const used = new Map(); // key -> where, for HTML attributes and manifest
for (const name of (await readdir('extension')).filter(file => file.endsWith('.html'))) {
  const html = await readFile(join('extension', name), 'utf8');
  for (const match of html.matchAll(/\bdata-i18n(?:-[a-z-]+)?\s*=\s*"([^"]+)"/g)) used.set(match[1], `extension/${name}`);
}
for (const match of manifestText.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) used.set(match[1], 'extension/manifest.json');
for (const [key, where] of used) {
  if (!en[key]) problems.push(`${where}: key "${key}" is missing in _locales/en`);
  if (!ar[key]) problems.push(`${where}: key "${key}" is missing in _locales/ar`);
}
for (const key of Object.keys(en)) if (!ar[key]) problems.push(`_locales/ar: key "${key}" exists in en but is missing in ar`);
for (const key of Object.keys(ar)) if (!en[key]) problems.push(`_locales/en: key "${key}" exists in ar but is missing in en`);
if (problems.length) {
  console.error(`\ni18n check failed with ${problems.length} problem(s):`);
  for (const problem of [...new Set(problems)]) console.error(` - ${problem}`);
  process.exit(1);
}
console.log(`i18n check passed: ${calls} t() calls, ${used.size} HTML/manifest keys, ${Object.keys(en).length} en and ${Object.keys(ar).length} ar messages.`);
