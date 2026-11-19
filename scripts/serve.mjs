import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve('website');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.zip': 'application/zip', '.json': 'application/json', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };

// Mirrors the parts of vercel.json that the site relies on: headers, cleanUrls and redirects.
export async function createSiteServer() {
  const config = JSON.parse(await readFile(resolve('vercel.json'), 'utf8'));
  const headerRules = (config.headers || []).map(rule => ({ pattern: new RegExp(`^${rule.source}$`), headers: rule.headers }));
  const redirects = (config.redirects || []).map(rule => ({ source: rule.source, destination: rule.destination, status: rule.statusCode || (rule.permanent ? 308 : 307) }));
  const cleanUrls = config.cleanUrls === true;

  return createServer(async (req, res) => {
    let pathname = '/';
    const send = async (status, file) => {
      const body = await readFile(file);
      const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
      for (const rule of headerRules) if (rule.pattern.test(pathname)) for (const { key, value } of rule.headers) headers[key] = value;
      res.writeHead(status, headers);
      res.end(body);
    };
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const redirect = redirects.find(rule => rule.source === pathname);
      if (redirect) { res.writeHead(redirect.status, { Location: redirect.destination }); res.end(); return; }
      if (cleanUrls && pathname.length > 1 && /\.html$/.test(pathname)) {
        res.writeHead(308, { Location: pathname.replace(/(\/index)?\.html$/, '') || '/' });
        res.end();
        return;
      }
      let target = pathname === '/' ? '/index.html' : pathname;
      if (cleanUrls && !extname(target)) target += '.html';
      const file = resolve(root, '.' + target);
      if (!file.startsWith(root + sep)) throw new Error('Invalid path');
      if (!(await stat(file)).isFile()) throw new Error('Not a file');
      await send(200, file);
    } catch {
      try { await send(404, resolve(root, '404.html')); } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.env.PORT || 4387);
  const server = await createSiteServer();
  server.listen(port, '127.0.0.1', () => console.log(`webTopdf preview: http://127.0.0.1:${port}`));
  process.on('SIGINT', () => server.close());
  process.on('SIGTERM', () => server.close());
}
