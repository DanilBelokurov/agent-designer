// Local bridge server for Agent Designer.
//
// Exposes POST /generate which spawns the local Qwen CLI (`qwen -p "..."`)
// and returns its stdout. Binds to 127.0.0.1 by default so the service
// cannot be reached from other hosts.
//
// Run with:  npm run server
//            node server/server.js
//
// Environment:
//   PORT              listening port (default 3001)
//   HOST              bind host  (default 127.0.0.1)
//   QWEN_COMMAND      binary to invoke (default "qwen")
//   QWEN_TIMEOUT_MS   per-request timeout (default 120_000)
//   CORS_ORIGIN       allowed browser origin (default http://localhost:5173)

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const QWEN_COMMAND = process.env.QWEN_COMMAND || 'qwen';
const QWEN_TIMEOUT_MS = Number(process.env.QWEN_TIMEOUT_MS) || 120_000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const MAX_PROMPT_BYTES = 256 * 1024;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonResponse(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(),
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_PROMPT_BYTES) {
        reject(new Error(`payload too large (>${MAX_PROMPT_BYTES} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function runQwen(prompt) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    let child;
    try {
      child = spawn(QWEN_COMMAND, ['-p', prompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        env: process.env,
      });
    } catch (err) {
      finish({ code: null, stdout: '', stderr: '', spawnError: err });
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on('data', (d) => stdoutChunks.push(d));
    child.stderr.on('data', (d) => stderrChunks.push(d));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({
        code: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: 'qwen timeout',
        timedOut: true,
      });
    }, QWEN_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      finish({
        code: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: err.message,
        spawnError: err,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      finish({
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        timedOut: false,
      });
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    jsonResponse(res, 200, { ok: true, qwen: QWEN_COMMAND, timeoutMs: QWEN_TIMEOUT_MS });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/generate') {
    jsonResponse(res, 404, { error: 'not found' });
    return;
  }

  let prompt;
  try {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw);
    prompt = parsed && typeof parsed.prompt === 'string' ? parsed.prompt : null;
  } catch (err) {
    jsonResponse(res, 400, { error: `bad request: ${err.message ?? String(err)}` });
    return;
  }

  if (!prompt || !prompt.trim()) {
    jsonResponse(res, 400, { error: 'prompt is required' });
    return;
  }

  const result = await runQwen(prompt);

  if (result.spawnError) {
    jsonResponse(res, 502, {
      result: '',
      error: `could not spawn ${QWEN_COMMAND}: ${result.spawnError.message ?? String(result.spawnError)}. Is Qwen installed and on PATH? Set QWEN_COMMAND to override.`,
    });
    return;
  }

  if (result.timedOut) {
    jsonResponse(res, 504, { result: '', error: `qwen timed out after ${QWEN_TIMEOUT_MS}ms` });
    return;
  }

  if (result.code !== 0) {
    jsonResponse(res, 502, {
      result: result.stdout,
      error: `qwen exited with code ${result.code}: ${result.stderr.trim()}`,
    });
    return;
  }

  jsonResponse(res, 200, { result: result.stdout, error: null });
});

server.on('error', (err) => {
  console.error(`server error: ${err.message}`);
});

server.listen(PORT, HOST, () => {
  console.log(`qwen bridge listening on http://${HOST}:${PORT}`);
  console.log(`  command: ${QWEN_COMMAND}`);
  console.log(`  timeout: ${QWEN_TIMEOUT_MS}ms`);
  console.log(`  CORS:    ${CORS_ORIGIN}`);
});

const shutdown = () => {
  console.log('\nshutting down…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
