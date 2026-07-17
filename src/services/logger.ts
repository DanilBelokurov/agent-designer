// Client-side logger. Every action, command, button click, and Qwen call
// flows through this module:
//
//   1. Echoed to console with the standard level.
//   2. Appended to an in-memory ring buffer (max 1000 entries) for the
//      LogsViewPanel to render in real time.
//   3. POSTed to /log on the server, which appends to logs/app.log.
//
// Best-effort everywhere — if the network fails or the buffer is full,
// we never throw from the logger.

import { create } from 'zustand';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  action: string;
  details?: Record<string, unknown>;
}

const MAX_BUFFER = 1000;

interface LogStoreState {
  entries: LogEntry[];
  clear: () => void;
  push: (entry: LogEntry) => void;
}

export const useLogStore = create<LogStoreState>((set) => ({
  entries: [],
  clear: () => set({ entries: [] }),
  push: (entry) =>
    set((s) => {
      const next = s.entries.length >= MAX_BUFFER
        ? [...s.entries.slice(s.entries.length - MAX_BUFFER + 1), entry]
        : [...s.entries, entry];
      return { entries: next };
    }),
}));

function emit(entry: LogEntry): void {
  // 1. Console
  const prefix = `[${entry.action}]`;
  const payload = entry.details ?? {};
  switch (entry.level) {
    case 'error': console.error(prefix, payload); break;
    case 'warn': console.warn(prefix, payload); break;
    case 'info': console.info(prefix, payload); break;
    default: console.debug(prefix, payload);
  }
  // 2. UI buffer
  useLogStore.getState().push(entry);
  // 3. Server (fire-and-forget)
  try {
    if (typeof fetch !== 'undefined') {
      void fetch('/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

function make(level: LogLevel) {
  return (action: string, details?: Record<string, unknown>) =>
    emit({ ts: Date.now(), level, action, details });
}

export const logger = {
  debug: make('debug'),
  info: make('info'),
  warn: make('warn'),
  error: make('error'),
  /** Get the current in-memory buffer (read-only copy). */
  snapshot(): LogEntry[] {
    return [...useLogStore.getState().entries];
  },
  /** Clear the in-memory buffer (does not touch on-disk log). */
  clear(): void {
    useLogStore.getState().clear();
  },
};

export function formatLogDetails(entry: LogEntry): string {
  if (!entry.details) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(entry.details)) {
    if (v === undefined || v === null) continue;
    let s: string;
    try {
      s = typeof v === 'string' ? v : JSON.stringify(v);
    } catch {
      s = String(v);
    }
    if (s.length > 200) s = s.slice(0, 200) + '…';
    parts.push(`${k}=${s}`);
  }
  return parts.join(' ');
}

export function formatLogTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}
