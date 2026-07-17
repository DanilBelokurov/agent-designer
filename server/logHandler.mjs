// HTTP handler for client-side logs. Each POST /log appends a single line
// to logs/app.log (NDJSON). GET /logs returns the last N lines.
//
// Log files live under <project-root>/logs/ (gitignored by convention).
// The path is computed relative to this file: server/logHandler.mjs → ../logs.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..');
const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

const MAX_BODY_BYTES = 64 * 1024;

async function ensureLogDir() {
  if (!existsSync(LOG_DIR)) await mkdir(LOG_DIR, { recursive: true });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        aborted = true;
        req.destroy();
        reject(new Error('payload too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

/**
 * Handle POST /log.
 *   Body: JSON LogEntry { ts, level, action, details? }
 *   Response: 204 No Content on success.
 */
export async function handleLogPost(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return send(res, 413, String(err.message));
  }

  let entry;
  try {
    entry = JSON.parse(body);
  } catch {
    return send(res, 400, 'invalid JSON');
  }
  if (!entry || typeof entry.action !== 'string' || typeof entry.ts !== 'number') {
    return send(res, 400, 'missing required fields: ts, action');
  }

  const line = JSON.stringify(entry) + '\n';
  try {
    await ensureLogDir();
    await appendFile(LOG_FILE, line, 'utf8');
  } catch (err) {
    return send(res, 500, `append failed: ${err.message}`);
  }
  return send(res, 204, '');
}

/**
 * Handle GET /logs?tail=N (default 200). Returns the last N lines as
 * NDJSON text/plain (one entry per line). Use ?format=json for a JSON
 * array.
 */
export async function handleLogGet(req, res, url) {
  const params = new URLSearchParams(url.split('?')[1] ?? '');
  const tail = Math.min(Math.max(parseInt(params.get('tail') ?? '200', 10) || 200, 1), 5000);
  const format = params.get('format') ?? 'ndjson';

  let raw;
  try {
    raw = existsSync(LOG_FILE) ? await readFile(LOG_FILE, 'utf8') : '';
  } catch (err) {
    return send(res, 500, `read failed: ${err.message}`);
  }

  const lines = raw.length ? raw.split('\n').filter(Boolean) : [];
  const sliced = lines.slice(-tail);

  if (format === 'json') {
    let arr;
    try {
      arr = sliced.map((l) => JSON.parse(l));
    } catch {
      return send(res, 500, 'corrupt log file');
    }
    return send(res, 200, JSON.stringify(arr), 'application/json; charset=utf-8');
  }
  return send(res, 200, sliced.join('\n'), 'text/plain; charset=utf-8');
}

/**
 * Wire up /log and /logs to the bridge dispatcher. Returns true when the
 * request was handled.
 */
export async function dispatchLog(req, res, urlPath) {
  if (urlPath === '/log' && req.method === 'POST') {
    await handleLogPost(req, res);
    return true;
  }
  if (urlPath === '/logs' && req.method === 'GET') {
    await handleLogGet(req, res, req.url ?? urlPath);
    return true;
  }
  return false;
}

export const LOG_PATHS = { LOG_DIR, LOG_FILE };
