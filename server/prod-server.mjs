// Single-port production server.
//
//   GET /health                  → bridge health probe
//   POST /generate               → spawn qwen -p <prompt>
//   GET /<asset>                 → serve dist/<asset>
//   GET /<unknown>               → SPA fallback to dist/index.html
//
// Environment:
//   PORT              listening port    (default 3001)
//   HOST              bind host         (default 127.0.0.1)
//   QWEN_COMMAND      binary            (default "qwen")
//   QWEN_TIMEOUT_MS   per-request ms    (default 120_000)
//
// Run with:  node server/prod-server.mjs
//            npm run server        (after `npm run build`)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchBridge } from './qwenHandler.mjs';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(urlPath, res) {
  if (urlPath === '/') urlPath = '/index.html';

  const decoded = decodeURIComponent(urlPath);
  const filePath = path.normalize(path.join(DIST, decoded));
  // Path traversal guard.
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }

  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': urlPath.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0',
    });
    res.end(data);
  } catch {
    // SPA fallback.
    try {
      const html = await readFile(path.join(DIST, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  }
}

const server = createServer(async (req, res) => {
  try {
    const rawUrl = req.url ?? '/';
    const urlPath = rawUrl.split('?')[0];

    const handled = await dispatchBridge(req, res, urlPath);
    if (handled) return;

    await serveStatic(urlPath, res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`server error: ${(err instanceof Error ? err.message : String(err))}`);
    }
  }
});

server.on('error', (err) => {
  console.error(`server error: ${err.message}`);
});

server.listen(PORT, HOST, () => {
  const cmd = process.env.QWEN_COMMAND || 'qwen';
  console.log(`agent designer (UI + qwen bridge) running on http://${HOST}:${PORT}`);
  console.log(`  dist root:    ${DIST}`);
  console.log(`  qwen command: ${cmd}`);
  console.log(`  qwen timeout: ${Number(process.env.QWEN_TIMEOUT_MS) || 120_000}ms`);
});

const shutdown = () => {
  console.log('\nshutting down…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
