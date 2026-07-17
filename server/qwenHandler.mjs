// Shared qwen-bridge handler. Used both by the Vite middleware (dev) and by
// the production server in server/prod-server.mjs.
//
// Exposes two handlers that consume Node http `IncomingMessage` +
// `ServerResponse`:
//   - `handleGenerate(req, res)` answers POST /generate
//   - `handleHealth(req, res)`   answers GET  /health
// Both return `true` when they handled the request, `false` to defer.

import { spawn } from 'node:child_process';

const MAX_PROMPT_BYTES = 256 * 1024;
const DEFAULT_QWEN_COMMAND = 'qwen';
const DEFAULT_TIMEOUT_MS = 120_000;

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

function runQwen(prompt, model) {
  const command = process.env.QWEN_COMMAND || DEFAULT_QWEN_COMMAND;
  const timeoutMs = Number(process.env.QWEN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const args = ['-p', prompt];
  if (model && typeof model === 'string' && model.trim()) {
    args.push('-m', model.trim());
  }
  const startedAt = Date.now();
  console.log(`[qwen] spawn ${command} model=${model ?? '(default)'} promptBytes=${Buffer.byteLength(prompt, 'utf8')}`);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      const ms = Date.now() - startedAt;
      console.log(
        `[qwen] exit code=${payload.code ?? 'null'} ` +
        `timedOut=${!!payload.timedOut} ` +
        `stdoutBytes=${Buffer.byteLength(payload.stdout || '', 'utf8')} ` +
        `stderr=${(payload.stderr || '').slice(0, 200).replace(/\n/g, ' ')} ` +
        `elapsed=${ms}ms`,
      );
      resolve(payload);
    };

    let child;
    try {
      child = spawn(command, args, {
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
    }, timeoutMs);

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

function jsonResponse(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    // Permissive CORS so the handler can also be reached standalone if the
    // operator wants to expose it on a separate origin.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  });
  res.end(payload === '' ? '' : JSON.stringify(payload));
}

export async function handleGenerate(req, res) {
  if (req.method === 'OPTIONS') {
    jsonResponse(res, 204, '');
    return true;
  }
  if (req.method !== 'POST') return false;

  let prompt;
  let model;
  try {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw);
    prompt = parsed && typeof parsed.prompt === 'string' ? parsed.prompt : null;
    model = parsed && typeof parsed.model === 'string' ? parsed.model : null;
  } catch (err) {
    jsonResponse(res, 400, { error: `bad request: ${err.message ?? String(err)}` });
    return true;
  }

  if (!prompt || !prompt.trim()) {
    jsonResponse(res, 400, { error: 'prompt is required' });
    return true;
  }

  const result = await runQwen(prompt, model);

  if (result.spawnError) {
    jsonResponse(res, 502, {
      result: '',
      error:
        `could not spawn ${process.env.QWEN_COMMAND || DEFAULT_QWEN_COMMAND}: ` +
        `${result.spawnError.message ?? String(result.spawnError)}. ` +
        'Is Qwen installed and on PATH? Set QWEN_COMMAND to override.',
    });
    return true;
  }
  if (result.timedOut) {
    jsonResponse(res, 504, {
      result: '',
      error: `qwen timed out after ${Number(process.env.QWEN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS}ms`,
    });
    return true;
  }
  if (result.code !== 0) {
    jsonResponse(res, 502, {
      result: result.stdout,
      error: `qwen exited with code ${result.code}: ${result.stderr.trim()}`,
    });
    return true;
  }

  jsonResponse(res, 200, { result: result.stdout, error: null });
  return true;
}

export function handleHealth(req, res) {
  if (req.method === 'OPTIONS') {
    jsonResponse(res, 204, '');
    return true;
  }
  if (req.method !== 'GET') return false;
  jsonResponse(res, 200, {
    ok: true,
    qwen: process.env.QWEN_COMMAND || DEFAULT_QWEN_COMMAND,
    timeoutMs: Number(process.env.QWEN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  });
  return true;
}

/**
 * Single-dispatch middleware usable with Vite's `server.middlewares.use` and
 * with `http.createServer`.
 *
 * Pass `req.url` (already split off `?query`) to skip the query. Returns
 * `true` when the request was consumed.
 */
export async function dispatchBridge(req, res, urlPath) {
  if (urlPath === '/generate') return handleGenerate(req, res);
  if (urlPath === '/health') return handleHealth(req, res);
  return false;
}
