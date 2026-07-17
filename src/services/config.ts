// Application config (currently: list of Qwen models to pick from).
//
// Loaded from /config.json (Vite serves it from public/, prod-server serves
// it from dist/). Fetched once on first use and cached.

export interface ModelInfo {
  id: string;
  label: string;
  default?: boolean;
}

export interface AppConfig {
  models: ModelInfo[];
}

const DEFAULT_MODELS: ModelInfo[] = [
  { id: 'qwen2.5-coder:7b', label: 'Qwen 2.5 Coder 7B', default: true },
  { id: 'qwen-max', label: 'Qwen Max' },
];

let cached: AppConfig | null = null;
let inflight: Promise<AppConfig> | null = null;

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/config.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`config.json HTTP ${res.status}`);
      const cfg = (await res.json()) as AppConfig;
      if (!cfg.models || !cfg.models.length) throw new Error('config.json: empty models');
      cached = cfg;
      return cfg;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[config] failed to load /config.json, using defaults:', err);
      cached = { models: DEFAULT_MODELS };
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function defaultModel(cfg: AppConfig): ModelInfo {
  return cfg.models.find((m) => m.default) ?? cfg.models[0];
}
