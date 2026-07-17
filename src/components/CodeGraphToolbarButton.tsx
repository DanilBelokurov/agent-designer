// Floating panel anchored to the canvas. Surfaces the code-intel state and
// offers a quick "scan now" action. Uses the existing FileSystem-directory
// handle from `useFileSystemStore` so the user doesn't have to re-pick a folder.

import { useState } from 'react';
import { Code2, Play, Loader2, RotateCcw, FileSearch, X } from 'lucide-react';

import { useFileSystemStore } from '../store/useFileSystemStore';
import { useCodeGraphStore, describeGraph, findMatchingEntities } from '../store/useCodeGraphStore';
import { analyzeProject, type AnalyzeProgress } from '../services/codeIntel/layer';
import { pickProjectDirectory } from '../services/fileSystem';
import { semanticCache } from '../services/semanticCache';

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

export default function CodeGraphToolbarButton() {
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

  const [open, setOpen] = useState(false);
  const [scanSearch, setScanSearch] = useState('');

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

  const matches = scanSearch.trim()
    ? findMatchingEntities(state, scanSearch.trim()).slice(0, 8)
    : [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Code graph"
        aria-label="Toggle code-graph panel"
        className={`fixed bottom-4 left-4 z-40 flex items-center gap-2 px-3 py-2 rounded-xl
                    bg-slate-900/90 backdrop-blur border border-slate-700/60
                    text-slate-300 hover:text-white text-sm shadow-xl
                    ${stats.totalEntities > 0 ? 'ring-1 ring-emerald-500/40' : ''}`}
      >
        <Code2 className="w-4 h-4 text-emerald-400" />
        <span>Code graph</span>
        {stats.totalEntities > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
            {stats.totalEntities}
          </span>
        )}
        {phase === 'scanning' && (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
        )}
      </button>

      {open && (
        <div className="fixed bottom-16 left-4 z-40 w-[420px] max-w-[92vw] max-h-[70vh] flex flex-col bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-slate-700/60 rounded-2xl shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between p-4 border-b border-slate-700/60">
            <div className="flex items-center gap-2 text-sm">
              <Code2 className="w-4 h-4 text-emerald-400" />
              <span className="font-semibold text-white">Code graph</span>
              {parser && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700/60 text-slate-300">
                  {parser}
                </span>
              )}
              {cacheHit != null && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    cacheHit
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-sky-500/20 text-sky-300'
                  }`}
                >
                  {cacheHit ? 'cached' : 'fresh'}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg hover:bg-slate-800/60 text-slate-400 hover:text-white"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-3 overflow-y-auto">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 text-center">
              {Object.entries(stats.byKind)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([kind, n]) => (
                  <div key={kind} className="p-2 rounded-lg bg-slate-800/40 border border-slate-700/40">
                    <div className="text-base font-bold text-white">{n}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">{kind}</div>
                  </div>
                ))}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={beginScan}
                disabled={phase === 'scanning'}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-sm transition-colors disabled:opacity-50"
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
                className="px-3 py-2 rounded-xl border border-slate-700/50 bg-slate-800/40 text-slate-300 hover:text-white text-sm disabled:opacity-40"
              >
                Clear
              </button>
            </div>

            {phase === 'scanning' && (
              <div className="text-[11px] text-slate-400">
                <div className="flex justify-between">
                  <span>
                    {progress.phase} · {progress.current}/{progress.total}
                  </span>
                  <span className="truncate max-w-[60%] text-emerald-300">
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
              <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-xs">
                <span className="break-words">{error}</span>
              </div>
            )}

            {/* Search */}
            <div className="space-y-1">
              <div className="relative">
                <FileSearch className="absolute left-2 top-2.5 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  value={scanSearch}
                  onChange={(e) => setScanSearch(e.target.value)}
                  placeholder="Search symbol names…"
                  className="w-full pl-7 pr-3 py-2 text-sm bg-slate-800/40 border border-slate-700/50 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                />
              </div>
              {matches.length > 0 && (
                <div className="space-y-1">
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

            {stats.totalEntities === 0 && phase !== 'scanning' && (
              <div className="text-[11px] text-slate-500 italic">
                Pick a project folder first via the instruction dialog, then run a scan. The universal
                code-intel extractor picks up classes, functions, methods, interfaces, and imports
                across the supported languages — no per-language runtime needed.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}