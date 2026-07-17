// Body for the "Logs" tab in the left panel — shows the in-memory log
// buffer (last 1000 entries from `useLogStore`). Auto-scrolls to the
// bottom on new entries; user can freeze the scroll, filter by level,
// and clear the buffer.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLogStore, formatLogDetails, formatLogTime, type LogEntry, type LogLevel } from '../../services/logger';
import { Trash2, Pause, Play, Filter } from 'lucide-react';

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: 'text-slate-400',
  info: 'text-emerald-300',
  warn: 'text-amber-300',
  error: 'text-red-300',
};

export default function LogsViewPanel() {
  const entries = useLogStore((s) => s.entries);
  const clear = useLogStore((s) => s.clear);
  const [paused, setPaused] = useState(false);
  const [enabled, setEnabled] = useState<Record<LogLevel, boolean>>({
    debug: false, info: true, warn: true, error: true,
  });
  const [search, setSearch] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (!enabled[e.level]) return false;
      if (!q) return true;
      return e.action.toLowerCase().includes(q) ||
        (e.details ? formatLogDetails(e).toLowerCase().includes(q) : false);
    });
  }, [entries, enabled, search]);

  useEffect(() => {
    if (paused || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filtered.length, paused]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Controls */}
      <div className="p-3 border-b border-slate-700/50 space-y-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaused((v) => !v)}
            title={paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
            className="px-2 py-1 rounded bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 text-xs flex items-center gap-1"
          >
            {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            {paused ? 'Resume' : 'Auto'}
          </button>
          <button
            type="button"
            onClick={() => clear()}
            title="Clear in-memory buffer"
            className="px-2 py-1 rounded bg-slate-800/60 hover:bg-red-500/20 hover:text-red-300 text-slate-300 text-xs flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
          <span className="ml-auto text-[10px] text-slate-500 tabular-nums">
            {filtered.length} / {entries.length}
          </span>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by action or details…"
          className="w-full px-2 py-1.5 text-xs bg-slate-800/40 border border-slate-700/50 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
        />

        <div className="flex items-center gap-1">
          <Filter className="w-3 h-3 text-slate-500" />
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setEnabled((s) => ({ ...s, [lvl]: !s[lvl] }))}
              className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider transition-colors border
                ${enabled[lvl]
                  ? `bg-slate-800/60 ${LEVEL_STYLES[lvl]} border-slate-700/50`
                  : 'bg-slate-900/40 text-slate-600 border-slate-800/40'}`}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      {/* Stream */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto p-2 font-mono text-[10.5px] leading-relaxed"
      >
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-slate-500 italic">
            No log entries yet. Trigger an action (scan, filter, generate) to see logs.
          </div>
        ) : (
          filtered.map((e) => <LogRow key={e.ts + ':' + e.action} entry={e} />)
        )}
      </div>
    </div>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <div className="px-2 py-1 hover:bg-slate-800/40 rounded break-words">
      <span className="text-slate-500 mr-2">{formatLogTime(entry.ts)}</span>
      <span className={`uppercase text-[9px] mr-2 font-semibold ${LEVEL_STYLES[entry.level]}`}>
        {entry.level}
      </span>
      <span className="text-slate-200 mr-2">{entry.action}</span>
      {entry.details && (
        <span className="text-slate-400">{formatLogDetails(entry)}</span>
      )}
    </div>
  );
}
