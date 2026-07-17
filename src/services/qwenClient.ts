// Client wrapper around the qwen bridge.
// The bridge is mounted into Vite (dev) and prod-server.mjs (prod), so it
// always answers on the same origin as the app under /generate. The
// `serverUrl` option is still accepted in case you want to point at a
// standalone bridge running elsewhere.

import { logger } from './logger';

const DEFAULT_SERVER_URL = '';

export class QwenUnavailableError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'QwenUnavailableError';
    this.status = status;
  }
}

export interface QwenClientOptions {
  /** Override the target. Empty string (default) means same-origin. */
  serverUrl?: string;
  signal?: AbortSignal;
  /** Qwen model id (e.g. 'qwen2.5-coder:32b'). Forwarded as `-m` to the CLI. */
  model?: string;
}

function bridgeUrl(path: string, serverUrl: string): string {
  const base = serverUrl === '' ? '' : serverUrl.replace(/\/+$/, '');
  return `${base}${path}`;
}

export async function generateViaQwen(
  prompt: string,
  options: QwenClientOptions = {},
): Promise<string> {
  const serverUrl = options.serverUrl ?? DEFAULT_SERVER_URL;
  const promptBytes = new Blob([prompt]).size;
  logger.info('qwen.call', {
    model: options.model ?? '(default)',
    promptBytes,
    promptPreview: prompt.slice(0, 120),
  });

  let res: Response;
  try {
    res = await fetch(bridgeUrl('/generate', serverUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model: options.model }),
      signal: options.signal,
    });
  } catch (err) {
    logger.error('qwen.network', { message: err instanceof Error ? err.message : String(err) });
    throw new QwenUnavailableError(
      `Cannot reach the qwen bridge. ` +
        `Make sure the dev server or prod server is running and Qwen CLI is installed.`,
    );
  }

  let data: { result?: string; error?: string | null } = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }

  if (!res.ok || data.error) {
    logger.warn('qwen.failed', {
      status: res.status,
      error: data.error || `HTTP ${res.status}`,
    });
    throw new QwenUnavailableError(
      data.error || `qwen bridge returned HTTP ${res.status}`,
      res.status,
    );
  }

  const result = (data.result ?? '').trim();
  logger.debug('qwen.response', {
    bytes: new Blob([result]).size,
    preview: result.slice(0, 120),
  });
  return result;
}

export async function checkHealth(
  serverUrl: string = DEFAULT_SERVER_URL,
): Promise<{ ok: boolean; qwen?: string; error?: string }> {
  try {
    const res = await fetch(bridgeUrl('/health', serverUrl), { method: 'GET' });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, qwen: data.qwen };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
