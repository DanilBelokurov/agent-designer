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
//
// Layout positions are persisted to `.agent-graph/layout.json` (see
// `codeIntel/layoutCache`) and rehydrated alongside state. The canvas
// reads them directly instead of running dagre on every render — that's
// the difference between "open the graph tab in 50ms" and "freeze the
// browser for 3s while dagre recomputes 10k nodes".

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
import {
  clearLayout,
  loadLayout,
  type LayoutPosition,
} from '../services/codeIntel/layoutCache';
import {
  clearManualPositions as clearManualPositionsFile,
  loadManualPositions,
  saveManualPositions,
  type ManualPositionsCache,
} from '../services/codeIntel/manualPositions';
import { logger } from '../services/logger';

export type ScanPhase = 'idle' | 'scanning' | 'done' | 'error' | 'cancelled';

export interface ScanProgressSnapshot {
  phase: 'reading' | 'extracting' | 'archetyping' | 'conventions' | 'enriching' | 'saving' | 'done';
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
  /**
   * Cached dagre positions keyed by entity id. Loaded from
   * `.agent-graph/layout.json` after every successful `setDirectory` /
   * `replaceState`. `null` when the cache is missing or stale — the
   * canvas then falls back to running dagre at render time (slow path).
   */
  layoutPositions: Map<string, LayoutPosition> | null;
  /** ISO timestamp from the layout cache file. */
  layoutComputedAt: string | null;
  /**
   * User-dragged node positions, keyed by entity id. Loaded from
   * `.agent-graph/manual-positions.json`. Wins over `layoutPositions`
   * whenever both exist for the same entity. `null` when the user
   * hasn't dragged anything yet (or after `clearManualPositions`).
   */
  manualPositions: Map<string, LayoutPosition> | null;
  /** ISO timestamp from the manual-positions file. */
  manualPositionsUpdatedAt: string | null;

  setProgress: (p: ScanProgressSnapshot) => void;
  setPhase: (p: ScanPhase, error?: string | null) => void;
  setParser: (k: CodeGraphUIState['parser']) => void;
  setCacheHit: (v: boolean | null) => void;
  /** Update the in-memory layout cache (e.g. after `computeAndCacheLayout`). */
  setLayout: (positions: Map<string, LayoutPosition>, computedAt: string) => void;
  /**
   * Replace the in-memory manual positions and persist to
   * `.agent-graph/manual-positions.json`. Pass an empty Map to clear
   * the file on disk.
   */
  setManualPositions: (positions: Map<string, LayoutPosition>, updatedAt: string) => Promise<void>;
  /** Forget manual positions both in memory and on disk. */
  clearManualPositions: () => Promise<void>;

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

export const useCodeGraphStore = create<CodeGraphUIState>((set, get) => {
  // Helper: load the layout cache for a directory and update state. The
  // canvas reads `layoutPositions` directly, so this is the single
  // source of truth for the cache.
  async function rehydrateLayout(dir: ProjectDirectory, fingerprint: string) {
    try {
      const cache = await loadLayout(dir, fingerprint);
      if (cache) {
        const map = new Map<string, LayoutPosition>();
        for (const [id, pos] of Object.entries(cache.positions)) {
          map.set(id, pos);
        }
        set({ layoutPositions: map, layoutComputedAt: cache.computedAt });
        logger.info('layout.loaded', {
          fingerprint,
          positions: map.size,
          computedAt: cache.computedAt,
        });
      } else {
        set({ layoutPositions: null, layoutComputedAt: null });
      }
    } catch (err) {
      logger.warn('layout.loadFailed', {
        message: err instanceof Error ? err.message : String(err),
      });
      set({ layoutPositions: null, layoutComputedAt: null });
    }
  }

  // Helper: load the user-dragged positions cache. Mirrors rehydrateLayout
  // — same fingerprint key, same try/catch, just a different file.
  async function rehydrateManualPositions(dir: ProjectDirectory, fingerprint: string) {
    try {
      const cache = await loadManualPositions(dir, fingerprint);
      if (cache) {
        const map = new Map<string, LayoutPosition>();
        for (const [id, pos] of Object.entries(cache.positions)) {
          map.set(id, pos);
        }
        set({ manualPositions: map, manualPositionsUpdatedAt: cache.updatedAt });
        logger.info('manualPositions.loaded', {
          fingerprint,
          positions: map.size,
          updatedAt: cache.updatedAt,
        });
      } else {
        set({ manualPositions: null, manualPositionsUpdatedAt: null });
      }
    } catch (err) {
      logger.warn('manualPositions.loadFailed', {
        message: err instanceof Error ? err.message : String(err),
      });
      set({ manualPositions: null, manualPositionsUpdatedAt: null });
    }
  }

  return {
    state: null,
    phase: 'idle',
    error: null,
    progress: EMPTY_PROGRESS,
    parser: null,
    cacheHit: null,
    layoutPositions: null,
    layoutComputedAt: null,
    manualPositions: null,
    manualPositionsUpdatedAt: null,

    setProgress: (p) => set({ progress: p }),
    setPhase: (p, error = null) => set({ phase: p, error }),
    setParser: (k) => set({ parser: k }),
    setCacheHit: (v) => set({ cacheHit: v }),

    setLayout: (positions, computedAt) => {
      set({ layoutPositions: positions, layoutComputedAt: computedAt });
    },

    setManualPositions: async (positions, updatedAt) => {
      set({ manualPositions: positions, manualPositionsUpdatedAt: updatedAt });
      const dir = currentDir();
      const fingerprint = get().state?.projectFingerprint;
      if (!dir || !fingerprint) return;
      try {
        const cache: ManualPositionsCache = {
          version: 1,
          projectFingerprint: fingerprint,
          updatedAt,
          positions: Object.fromEntries(positions),
        };
        await saveManualPositions(dir, cache);
      } catch (err) {
        logger.warn('manualPositions.saveFailed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    clearManualPositions: async () => {
      set({ manualPositions: null, manualPositionsUpdatedAt: null });
      const dir = currentDir();
      if (!dir) return;
      try {
        await clearManualPositionsFile(dir);
      } catch (err) {
        logger.warn('manualPositions.clearFailed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    replaceState: async (next) => {
      const prev = get().state;
      // If the fingerprint changed, the cached layout AND the manual
      // positions no longer match the entity set — drop both. The caller
      // (`analyzeProject`) will recompute the dagre cache before
      // returning; manual positions are the user's, so we just forget
      // them rather than try to migrate stale ones.
      if (prev && prev.projectFingerprint !== next.projectFingerprint) {
        set({
          layoutPositions: null,
          layoutComputedAt: null,
          manualPositions: null,
          manualPositionsUpdatedAt: null,
        });
      }
      set({ state: next });
      const dir = currentDir();
      if (dir) {
        try {
          await saveAgentState(dir, next);
          // Re-read layout.json in case the caller just wrote it (the
          // standard scan path: saveAgentState → computeAndCacheLayout →
          // replaceState).
          await rehydrateLayout(dir, next.projectFingerprint);
          await rehydrateManualPositions(dir, next.projectFingerprint);
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
        layoutPositions: null,
        layoutComputedAt: null,
        manualPositions: null,
        manualPositionsUpdatedAt: null,
      });
      const dir = currentDir();
      if (dir) {
        try {
          await clearAgentState(dir);
        } catch {
          // ignore — directory may already be cleared
        }
        try {
          await clearLayout(dir);
        } catch {
          // ignore
        }
        try {
          await clearManualPositionsFile(dir);
        } catch {
          // ignore
        }
      }
    },

    setDirectory: async (dir) => {
      logger.info('directory.set', { name: dir?.name ?? null, handle: !!dir });
      set({
        state: null,
        phase: 'idle',
        error: null,
        progress: EMPTY_PROGRESS,
        parser: null,
        cacheHit: null,
        layoutPositions: null,
        layoutComputedAt: null,
        manualPositions: null,
        manualPositionsUpdatedAt: null,
      });
      setCurrentDir(dir);
      if (!dir) return;
      try {
        const loaded = await loadAgentState(dir);
        if (loaded) {
          logger.info('directory.stateLoaded', {
            entities: loaded.entities.length,
            relations: loaded.relations.length,
            fingerprint: loaded.projectFingerprint,
            rootPath: loaded.rootPath,
          });
          set({ state: loaded, cacheHit: true });
          await rehydrateLayout(dir, loaded.projectFingerprint);
          await rehydrateManualPositions(dir, loaded.projectFingerprint);
        } else {
          logger.info('directory.noState', { name: dir.name });
          set({ cacheHit: false });
        }
      } catch (err) {
        logger.warn('directory.loadFailed', {
          name: dir.name,
          message: err instanceof Error ? err.message : String(err),
        });
        set({ cacheHit: false });
      }
    },
  };
});

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