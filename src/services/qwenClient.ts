// Client wrapper around the qwen bridge.
// The bridge is mounted into Vite (dev) and prod-server.mjs (prod), so it
// always answers on the same origin as the app under /generate. The
// `serverUrl` option is still accepted in case you want to point at a
// standalone bridge running elsewhere.

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

  let res: Response;
  try {
    res = await fetch(bridgeUrl('/generate', serverUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: options.signal,
    });
  } catch {
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
    throw new QwenUnavailableError(
      data.error || `qwen bridge returned HTTP ${res.status}`,
      res.status,
    );
  }

  return (data.result ?? '').trim();
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
