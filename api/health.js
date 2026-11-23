// GET /api/health: liveness probe for the Vercel deployment. Returns only {"status":"ok"}, never cached.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end();
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(req.method === 'HEAD' ? undefined : '{"status":"ok"}');
}
