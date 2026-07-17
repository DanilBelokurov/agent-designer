// Left-panel body for the "Graph" tab. Owns scan controls, parser/cache
// indicators, search, and per-kind stats. Lives inside NodePalette —
// switched in by `useUiStore.leftTab`.

import { useState, useMemo } from 'react';
import { Loader2, Play, RotateCcw, FileSearch, Trash2, Filter } from 'lucide-react';
import { useFileSystemStore } from '../../store/useFileSystemStore';
import {
  useCodeGraphStore,
  describeGraph,
  findMatchingEntities,
} from '../../store/useCodeGraphStore';
import {
  useUiStore,
  ALL_KINDS,
  ALL_RELATIONS,
  ALL_ARCHETYPES,
} from '../../store/useUiStore';
import { analyzeProject, type AnalyzeProgress } from '../../services/codeIntel/layer';
import { pickProjectDirectory } from '../../services/fileSystem';
import { semanticCache } from '../../services/semanticCache';

function toProgressSnapshot(p: AnalyzeProgress) {
  return {
    phase: p.phase,
    current: p.current,
    total: p.total,
    detail: p.detail,
    scanned: p.current,
    matched: p.current,
    errors: 0,
    currentFile: p.detail,
  };
}

export default function CodeGraphViewPanel() {
  const directory = useFileSystemStore((s) => s.directory);
  const setDirectory = useFileSystemStore((s) => s.setDirectory);

  const state = useCodeGraphStore((s) => s.state);
  const phase = useCodeGraphStore((s) => s.phase);
  const error = useCodeGraphStore((s) => s.error);
  const progress = useCodeGraphStore((s) => s.progress);
  const parser = useCodeGraphStore((s) => s.parser);
  const cacheHit = useCodeGraphStore((s) => s.cacheHit);

  const setProgress = useCodeGraphStore((s) => s.setProgress);
  const setPhase = useCodeGraphStore((s) => s.setPhase);
  const setParser = useCodeGraphStore((s) => s.setParser);
  const setCacheHit = useCodeGraphStore((s) => s.setCacheHit);
  const replaceState = useCodeGraphStore((s) => s.replaceState);
  const reset = useCodeGraphStore((s) => s.reset);

  const [search, setSearch] = useState('');
  const stats = describeGraph(state);

  const beginScan = async () => {
    let dir = directory;
    if (!dir) {
      try {
        dir = await pickProjectDirectory();
        const ok = await dir.verifyWritable();
        if (!ok) throw new Error('folder not writable');
        setDirectory(dir);
      } catch (e) {
        setPhase('error', e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setPhase('scanning');
    setProgress({ phase: 'reading', current: 0, total: 0, scanned: 0, matched: 0, errors: 0 });
    try {
      const result = await analyzeProject(dir, {
        onProgress: (p) => setProgress(toProgressSnapshot(p)),
      });
      await replaceState(result.state);
      setParser('code-intel');
      setCacheHit(result.cacheHit);
      setPhase('done');
    } catch (e) {
      setPhase('error', e instanceof Error ? e.message : String(e));
    }
  };

  const matches = search.trim()
    ? findMatchingEntities(state, search.trim()).slice(0, 8)
    : [];

  return (
    <div className="p-4 space-y-4">
      {/* Status pills */}
      <div className="flex flex-wrap gap-1.5">
        {parser && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300 uppercase tracking-wider">
            {parser}
          </span>
        )}
        {cacheHit != null && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider ${
              cacheHit
                ? 'bg-amber-500/20 text-amber-300'
                : 'bg-sky-500/20 text-sky-300'
            }`}
          >
            {cacheHit ? 'cached' : 'fresh'}
          </span>
        )}
      </div>

      {/* Stats */}
      <div>
        <h3 className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 font-semibold">
          Stats · {stats.totalEntities} entities
        </h3>
        <div className="grid grid-cols-3 gap-1.5">
          {Object.entries(stats.byKind)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 9)
            .map(([kind, n]) => (
              <div
                key={kind}
                className="p-1.5 rounded-lg bg-slate-800/40 border border-slate-700/40 text-center"
              >
                <div className="text-sm font-bold text-white">{n}</div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider truncate">
                  {kind}
                </div>
              </div>
            ))}
          {stats.totalEntities === 0 && (
            <div className="col-span-3 text-[11px] text-slate-500 italic">
              No entities yet. Pick a project folder and run a scan.
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={beginScan}
          disabled={phase === 'scanning'}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-sm transition-colors disabled:opacity-50"
        >
          {phase === 'scanning' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Scanning…
            </>
          ) : stats.totalEntities > 0 ? (
            <>
              <RotateCcw className="w-4 h-4" />
              Re-scan
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Scan now
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              await semanticCache.flush();
              await semanticCache.clear();
              await reset();
            })();
          }}
          disabled={stats.totalEntities === 0}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-700/50 bg-slate-800/40 text-slate-300 hover:text-white text-sm disabled:opacity-40"
        >
          <Trash2 className="w-4 h-4" />
          Clear state
        </button>
      </div>

      {/* Progress */}
      {phase === 'scanning' && (
        <div className="text-[11px] text-slate-400">
          <div className="flex justify-between gap-2">
            <span className="whitespace-nowrap">
              {progress.phase} · {progress.current}/{progress.total}
            </span>
            <span className="truncate text-emerald-300">
              {progress.detail ?? progress.currentFile ?? ''}
            </span>
          </div>
          <div className="mt-1 h-1 bg-slate-800 rounded overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{
                width: progress.total > 0
                  ? `${Math.min(100, (progress.current / progress.total) * 100)}%`
                  : '0%',
              }}
            />
          </div>
        </div>
      )}

      {phase === 'error' && error && (
        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-xs break-words">
          {error}
        </div>
      )}

      {/* Search */}
      <div>
        <h3 className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 font-semibold">
          Search
        </h3>
        <div className="relative">
          <FileSearch className="absolute left-2 top-2.5 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Symbol name…"
            className="w-full pl-7 pr-3 py-2 text-sm bg-slate-800/40 border border-slate-700/50 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
          />
        </div>
        {matches.length > 0 && (
          <div className="mt-2 space-y-1">
            {matches.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 p-2 bg-slate-800/40 border border-slate-700/40 rounded-lg text-xs"
              >
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] uppercase">
                  {e.kind}
                </span>
                {e.archetype && (
                  <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px] uppercase">
                    {e.archetype}
                  </span>
                )}
                <span className="text-white font-mono truncate flex-1">{e.name}</span>
                <span className="text-[10px] text-slate-500 truncate max-w-[40%]">
                  {e.filePath}:{e.startLine + 1}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <FiltersPanel state={state} />
    </div>
  );
}

function FiltersPanel({ state }: { state: import('../../services/codeIntel/types').AgentState | null }) {
  const filters = useUiStore((s) => s.graphFilters);
  const toggleKind = useUiStore((s) => s.toggleFilterKind);
  const toggleRelation = useUiStore((s) => s.toggleFilterRelation);
  const toggleLanguage = useUiStore((s) => s.toggleFilterLanguage);
  const toggleArchetype = useUiStore((s) => s.toggleFilterArchetype);
  const reset = useUiStore((s) => s.resetFilters);

  const availableLanguages = useMemo(() => {
    const s = new Set<string>();
    if (!state) return [];
    for (const e of state.entities) if (e.language) s.add(e.language);
    return [...s].sort();
  }, [state]);

  const availableArchetypes = useMemo(() => {
    const s = new Set<string>();
    if (!state) return [];
    for (const e of state.entities) if (e.archetype) s.add(e.archetype);
    return [...s].sort();
  }, [state]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold flex items-center gap-1">
          <Filter className="w-3 h-3" />
          Filters
        </h3>
        <button
          type="button"
          onClick={reset}
          className="text-[10px] text-slate-500 hover:text-slate-300 underline"
        >
          reset
        </button>
      </div>

      <FilterRow label="Kinds" total={ALL_KINDS.length} active={filters.kinds.size}>
        {ALL_KINDS.map((kind) => (
          <FilterChip
            key={kind}
            label={kind}
            active={filters.kinds.has(kind)}
            onClick={() => toggleKind(kind)}
          />
        ))}
      </FilterRow>

      <FilterRow label="Relations" total={ALL_RELATIONS.length} active={filters.relations.size}>
        {ALL_RELATIONS.map((rel) => (
          <FilterChip
            key={rel}
            label={rel}
            active={filters.relations.has(rel)}
            onClick={() => toggleRelation(rel)}
          />
        ))}
      </FilterRow>

      {availableLanguages.length > 0 && (
        <FilterRow label="Languages" total={availableLanguages.length} active={filters.languages.size === 0 ? availableLanguages.length : filters.languages.size}>
          {availableLanguages.map((lang) => {
            const active = filters.languages.size === 0 || filters.languages.has(lang);
            return (
              <FilterChip
                key={lang}
                label={lang}
                active={active}
                onClick={() => toggleLanguage(lang)}
              />
            );
          })}
        </FilterRow>
      )}

      {availableArchetypes.length > 0 && (
        <FilterRow label="Archetypes" total={ALL_ARCHETYPES.length} active={filters.archetypes.size === 0 ? availableArchetypes.length : filters.archetypes.size}>
          {availableArchetypes.map((arch) => {
            const active = filters.archetypes.size === 0 || filters.archetypes.has(arch);
            return (
              <FilterChip
                key={arch}
                label={arch}
                active={active}
                onClick={() => toggleArchetype(arch)}
              />
            );
          })}
        </FilterRow>
      )}
    </div>
  );
}

function FilterRow({
  label,
  total,
  active,
  children,
}: {
  label: string;
  total: number;
  active: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-slate-600">{active}/{total}</span>
      </div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider transition-colors border
        ${active
          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
          : 'bg-slate-800/40 text-slate-500 border-slate-700/40 hover:text-slate-300'}`}
    >
      {label}
    </button>
  );
}