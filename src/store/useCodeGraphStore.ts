// UI store for the code-intel feature. Holds an `AgentState` (entities +
// relations + archetypes + conventions + semantic + stats), scan status, and
// last-known cache-hit flag.
//
// Persistence: `.agent-graph/state.json` inside the picked project folder,
// written atomically via `codeIntel/stateIO`. The store binds to a
// directory through `setDirectory(dir)`: when the user picks / switches /
// clears the folder, the in-memory state is rehydrated from disk (or
// wiped). Writes go through `replaceState`, which persists synchronously
// after each scan completes.

import { create } from 'zustand';
import type { ProjectDirectory } from '../services/fileSystem';
import type {
  AgentState,
  CodeEntity,
  CodeRelation,
  EntityKind,
} from '../services/codeIntel/types';
import {
  clearAgentState,
  loadAgentState,
  saveAgentState,
} from '../services/codeIntel/stateIO';

export type ScanPhase = 'idle' | 'scanning' | 'done' | 'error' | 'cancelled';

export interface ScanProgressSnapshot {
  phase: 'reading' | 'extracting' | 'archetyping' | 'conventions' | 'saving' | 'done';
  current: number;
  total: number;
  detail?: string;
  /** Convenience counter — files seen so far. */
  scanned: number;
  /** Convenience counter — files actually parsed. */
  matched: number;
  errors: number;
  /** Best-effort current file path. */
  currentFile?: string;
}

interface CodeGraphUIState {
  state: AgentState | null;
  phase: ScanPhase;
  error: string | null;
  progress: ScanProgressSnapshot;
  /** Always `code-intel` once a scan has produced a result. */
  parser: 'code-intel' | null;
  /** True if the last load/analyze reused a previously persisted AgentState. */
  cacheHit: boolean | null;

  setProgress: (p: ScanProgressSnapshot) => void;
  setPhase: (p: ScanPhase, error?: string | null) => void;
  setParser: (k: CodeGraphUIState['parser']) => void;
  setCacheHit: (v: boolean | null) => void;

  /** Replace the state and persist atomically to state.json. */
  replaceState: (next: AgentState) => Promise<void>;
  /** Wipe in-memory state and the on-disk `.agent-graph/state.json`. */
  reset: () => Promise<void>;
  /**
   * Bind the store to a directory. Reads state.json if present. Pass null
   * to clear the binding (without wiping on disk).
   */
  setDirectory: (dir: ProjectDirectory | null) => Promise<void>;
}

const EMPTY_PROGRESS: ScanProgressSnapshot = {
  phase: 'reading',
  current: 0,
  total: 0,
  scanned: 0,
  matched: 0,
  errors: 0,
};

export const useCodeGraphStore = create<CodeGraphUIState>((set) => ({
  state: null,
  phase: 'idle',
  error: null,
  progress: EMPTY_PROGRESS,
  parser: null,
  cacheHit: null,

  setProgress: (p) => set({ progress: p }),
  setPhase: (p, error = null) => set({ phase: p, error }),
  setParser: (k) => set({ parser: k }),
  setCacheHit: (v) => set({ cacheHit: v }),

  replaceState: async (next) => {
    set({ state: next });
    const dir = currentDir();
    if (dir) {
      try {
        await saveAgentState(dir, next);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[useCodeGraphStore] saveAgentState failed:', err);
      }
    }
  },

  reset: async () => {
    set({
      state: null,
      phase: 'idle',
      error: null,
      progress: EMPTY_PROGRESS,
      parser: null,
      cacheHit: null,
    });
    const dir = currentDir();
    if (dir) {
      try {
        await clearAgentState(dir);
      } catch {
        // ignore — directory may already be cleared
      }
    }
  },

  setDirectory: async (dir) => {
    set({
      state: null,
      phase: 'idle',
      error: null,
      progress: EMPTY_PROGRESS,
      parser: null,
      cacheHit: null,
    });
    setCurrentDir(dir);
    if (!dir) return;
    try {
      const loaded = await loadAgentState(dir);
      if (loaded) {
        set({ state: loaded, cacheHit: true });
      } else {
        set({ cacheHit: false });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[useCodeGraphStore] loadAgentState failed:', err);
      set({ cacheHit: false });
    }
  },
}));

// --- directory binding (module-scoped) -------------------------------------
//
// `setDirectory` mutates this binding; `replaceState` and `reset` read it.
// Keeping it outside the store means the store stays serialisable.

let _currentDir: ProjectDirectory | null = null;

function currentDir(): ProjectDirectory | null {
  return _currentDir;
}

function setCurrentDir(dir: ProjectDirectory | null): void {
  _currentDir = dir;
}

/** Hydrate the store on app start. Returns true when state was loaded. */
export async function hydrateCodeGraphStore(): Promise<boolean> {
  // The actual hydration is driven by `setDirectory(dir)` once the user
  // picks a folder (or via the dialog flow that calls setDirectory). We
  // keep this hook for source compatibility with previous call sites that
  // imported it from the IDB-based version — but it's a no-op now.
  return false;
}

// --- selectors ------------------------------------------------------------

export interface GraphSummary {
  totalEntities: number;
  byKind: Partial<Record<EntityKind, number>>;
  byLanguage: Record<string, number>;
  archetypeCounts: Record<string, number>;
}

export function describeGraph(state: AgentState | null): GraphSummary {
  if (!state) {
    return { totalEntities: 0, byKind: {}, byLanguage: {}, archetypeCounts: {} };
  }
  return {
    totalEntities: state.stats.totalEntities,
    byKind: state.stats.byKind,
    byLanguage: state.stats.byLanguage,
    archetypeCounts: state.stats.archetypeCounts,
  };
}

export interface MatchOptions {
  kind?: EntityKind;
  language?: string;
  archetype?: string;
}

export function findMatchingEntities(
  state: AgentState | null,
  query: string,
  options?: MatchOptions,
): CodeEntity[] {
  if (!state || !query) return [];
  const q = query.toLowerCase();
  const out: CodeEntity[] = [];
  for (const e of state.entities) {
    if (e.kind === 'file' || e.kind === 'unknown') continue;
    if (options?.kind && e.kind !== options.kind) continue;
    if (options?.language && e.language !== options.language) continue;
    if (options?.archetype && e.archetype !== options.archetype) continue;
    const name = e.name.toLowerCase();
    if (name.includes(q) || name === q.replace(/\s+/g, '_')) {
      out.push(e);
      if (out.length >= 30) break;
    }
  }
  return out;
}

/** Convenience: all relations as a flat array. */
export function listRelations(state: AgentState | null): CodeRelation[] {
  return state?.relations ?? [];
}