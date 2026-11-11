/**
 * Local emulator of the Vercel deployment.
 *
 * Mirrors frontend/vercel.json exactly:
 *   - serves the static files from frontend/
 *   - applies the vercel.json security headers (including the CSP)
 *   - proxies /api, /uploads and /socket.io to the API server
 *
 * Run the API first (npm start), then:
 *   node scripts/vercel-emulator.js   ->  http://localhost:5173
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const API = { host: '127.0.0.1', port: 5000 };
const PORT = 5173;

const vercel = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'vercel.json'), 'utf8'));
const HEADERS = (vercel.headers || []).flatMap((h) => h.headers || []);

const PROXY_PREFIXES = ['/api/', '/uploads/', '/socket.io/'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // ── Proxy to the API ────────────────────────────────────────────────
  if (PROXY_PREFIXES.some((p) => url.startsWith(p))) {
    const proxyReq = http.request(
      { host: API.host, port: API.port, path: req.url, method: req.method, headers: req.headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'API unreachable' }));
    });
    req.pipe(proxyReq);
    return;
  }

  // ── Static files ───────────────────────────────────────────────────
  let filePath = path.join(FRONTEND, decodeURIComponent(url));
  if (!filePath.startsWith(FRONTEND)) filePath = FRONTEND;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(FRONTEND, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    // Anything we do not recognise is still an HTML document in this app.
    'Content-Type': MIME[ext] || 'text/html; charset=utf-8',
  };
  HEADERS.forEach((h) => { headers[h.key] = h.value; });

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Vercel emulator running on http://localhost:${PORT}`);
  console.log(`  static root : ${FRONTEND}`);
  console.log(`  api proxy   : http://${API.host}:${API.port}`);
  console.log(`  headers     : ${HEADERS.map((h) => h.key).join(', ')}`);
});
