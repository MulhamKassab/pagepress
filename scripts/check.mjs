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
for (const dir of ['extension', 'website', 'scripts', 'tests']) {
  for (const file of await walk(dir)) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || `Syntax failed: ${file}`);
    count++;
  }
}
console.log(`Checked ${count} JavaScript files and all JSON manifests.`);
