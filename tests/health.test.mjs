import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import handler from '../api/health.js';

async function withServer(run) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/api/health`); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('GET /api/health returns only {"status":"ok"} and is never cached', async () => {
  await withServer(async url => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-type'), /^application\/json/);
    assert.equal(await response.text(), '{"status":"ok"}');
  });
});

test('/api/health refuses anything but GET and HEAD, and HEAD has no body', async () => {
  await withServer(async url => {
    const post = await fetch(url, { method: 'POST', body: 'x' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
    assert.equal(post.headers.get('cache-control'), 'no-store');
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
});
