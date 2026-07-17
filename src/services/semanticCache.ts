// Per-project semantic cache for Qwen-derived {role, description} entries.
//
// Persistence target: `.agent-graph/state.json` *inside the picked project
// folder*. This keeps cache state scoped to the project it describes and
// lets the user carry it between machines via the folder itself — no
// IndexedDB, no localStorage, no browser-only stores.
//
// In-memory map stays as a singleton for O(1) sync reads from the
// context collector; persistence is debounced because state.json is the
// canonical full-state file and we don't want to rewrite it once per
// entity on a 10-entity enrichment batch.
//
// Lifecycle:
//   GraphCanvas subscribes to `useFileSystemStore.directory` and calls
//   `setDirectory(dir)` whenever the user picks/switches/clears the
//   folder. Then `loadFromDB()` hydrates the in-memory map from
//   `state.semantic`. Writes via `set()` go to memory immediately and
//   schedule a coalesced flush to state.json (debounced ~400ms).
//   `flush()` forces an immediate write; `clear()` wipes memory and the
//   `state.semantic` field on disk.

import type { ProjectDirectory } from './fileSystem';
import {
  loadAgentState,
  saveAgentState,
} from './codeIntel/stateIO';
import {
  AGENT_STATE_VERSION,
  type AgentState,
} from './codeIntel/types';

export interface SemanticInfo {
  entityId: string;
  role: string;
  description: string;
  timestamp: number;
}

const FLUSH_DEBOUNCE_MS = 400;

const memory = new Map<string, SemanticInfo>();
let currentDir: ProjectDirectory | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let flushWaiters: Array<() => void> = [];

function buildMinimalState(dir: ProjectDirectory): AgentState {
  return {
    version: AGENT_STATE_VERSION,
    projectFingerprint: dir.name,
    rootPath: dir.name,
    lastScannedAt: new Date(0).toISOString(),
    totalFilesScanned: 0,
    entities: [],
    relations: [],
    archetypes: {
      projectFingerprint: dir.name,
      rulesByPackage: {},
      fileAssignment: {},
    },
    conventions: {},
    semantic: {},
    stats: {
      totalEntities: 0,
      byKind: {} as AgentState['stats']['byKind'],
      byLanguage: {},
      archetypeCounts: {},
    },
  };
}

async function loadOrBootstrap(dir: ProjectDirectory): Promise<AgentState> {
  const existing = await loadAgentState(dir);
  if (existing) return existing;
  return buildMinimalState(dir);
}

function notifyFlushWaiters(): void {
  const w = flushWaiters;
  flushWaiters = [];
  for (const fn of w) fn();
}

async function doFlush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    if (!currentDir) return;
    const snapshot = Object.fromEntries(memory);
    const state = await loadOrBootstrap(currentDir);
    state.semantic = snapshot;
    await saveAgentState(currentDir, state);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[semanticCache] flush failed:', err);
  } finally {
    flushing = false;
    notifyFlushWaiters();
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  if (!currentDir) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void doFlush();
  }, FLUSH_DEBOUNCE_MS);
}

export const semanticCache = {
  /** Switch the persistence target. Call when the user picks a folder. */
  setDirectory(dir: ProjectDirectory | null): void {
    if (currentDir === dir) return;
    currentDir = dir;
    // In-memory cache is *not* cleared on directory switch: each entry is
    // keyed by entityId, which is path-derived, so reloading from the new
    // folder's state.json overwrites entries one-by-one. Until the new
    // folder's state.json is loaded (via loadFromDB), in-memory hits from
    // a previous folder would be wrong — loadFromDB will overwrite them.
    scheduleFlush();
  },

  /** Currently-bound directory (null = persistence disabled). */
  getDirectory(): ProjectDirectory | null {
    return currentDir;
  },

  /** Synchronous in-memory read. */
  getSync(entityId: string): SemanticInfo | undefined {
    return memory.get(entityId);
  },

  /** Synchronous in-memory write (does not persist). */
  setSync(info: SemanticInfo): void {
    memory.set(info.entityId, info);
  },

  /** Hydrate the in-memory map from `.agent-graph/state.json`. */
  async loadFromDB(): Promise<number> {
    if (!currentDir) return 0;
    try {
      const state = await loadAgentState(currentDir);
      if (!state?.semantic) return 0;
      let loaded = 0;
      for (const [id, info] of Object.entries(state.semantic)) {
        if (info && typeof info === 'object' && 'entityId' in info) {
          memory.set(id, info as SemanticInfo);
          loaded += 1;
        }
      }
      return loaded;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[semanticCache] loadFromDB failed:', err);
      return 0;
    }
  },

  /** Read-through (in-memory only — loadFromDB has already populated it). */
  async get(entityId: string): Promise<SemanticInfo | undefined> {
    return memory.get(entityId);
  },

  /** Write-through: memory + debounced disk flush. */
  async set(info: SemanticInfo): Promise<void> {
    memory.set(info.entityId, info);
    scheduleFlush();
  },

  /** Force an immediate disk write. Awaits any in-flight flush. */
  async flush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!currentDir || memory.size === 0) return;
    if (flushing) {
      await new Promise<void>((resolve) => flushWaiters.push(resolve));
      return;
    }
    await doFlush();
  },

  /** Wipe memory and the on-disk `state.semantic` field. */
  async clear(): Promise<void> {
    memory.clear();
    if (!currentDir) return;
    try {
      const state = await loadOrBootstrap(currentDir);
      state.semantic = {};
      await saveAgentState(currentDir, state);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[semanticCache] clear failed:', err);
    }
  },

  /** Diagnostic — count of entries in the in-memory layer. */
  size(): number {
    return memory.size;
  },
};

// On page hide, flush whatever is pending so a tab close mid-batch
// doesn't lose the user's last enrichments.
if (typeof window !== 'undefined') {
  const onHide = () => {
    void semanticCache.flush();
  };
  window.addEventListener('pagehide', onHide);
  window.addEventListener('beforeunload', onHide);
}

// Re-exported for tests / dev-tools (kept for source compatibility with
// the previous idb-keyval-based implementation).
export const SEMANTIC_CACHE_STORE = 'state.semantic';
