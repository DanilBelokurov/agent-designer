// Client wrapper around the local qwen bridge server.

const DEFAULT_SERVER_URL = 'http://localhost:3001';

export class QwenUnavailableError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'QwenUnavailableError';
    this.status = status;
  }
}

export interface QwenClientOptions {
  serverUrl?: string;
  signal?: AbortSignal;
}

export async function generateViaQwen(
  prompt: string,
  options: QwenClientOptions = {},
): Promise<string> {
  const serverUrl = options.serverUrl ?? DEFAULT_SERVER_URL;

  let res: Response;
  try {
    res = await fetch(`${serverUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: options.signal,
    });
  } catch (err) {
    throw new QwenUnavailableError(
      `Cannot reach qwen bridge at ${serverUrl}. ` +
        `Make sure the server is running (npm run server) and Qwen CLI is installed.`,
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
    const res = await fetch(`${serverUrl}/health`, { method: 'GET' });
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
