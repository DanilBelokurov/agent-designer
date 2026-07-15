// UI store for the code-graph feature. Holds a snapshot of the graph
// (entities + relations), scan status, and cached metadata. Persists the
// snapshot to IndexedDB so reloads after a scan don't pay the cost twice.

import { create } from 'zustand';
import type { CodeEntity } from '../services/treeSitter/codeGraph';
import type { CodeGraphSnapshot } from '../services/treeSitter/codeGraphStore';
import {
  clearGraph as resetGraph,
  entitiesByKind,
  entitiesByLanguage,
  makeEmptyGraph,
} from '../services/treeSitter/codeGraphStore';

const DB_NAME = 'agent-designer-code-graph';
const DB_VERSION = 1;
const STORE = 'snapshots';
const SNAPSHOT_KEY = 'latest';

async function loadSnapshot(): Promise<CodeGraphSnapshot | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return await new Promise<CodeGraphSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(SNAPSHOT_KEY);
      req.onsuccess = () => resolve((req.result as CodeGraphSnapshot) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function saveSnapshot(s: CodeGraphSnapshot): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(s, SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export type ScanPhase = 'idle' | 'scanning' | 'done' | 'error' | 'cancelled';

interface CodeGraphUIState {
  graph: CodeGraphSnapshot;
  phase: ScanPhase;
  error: string | null;
  progress: { scanned: number; matched: number; skipped: number; errors: number; currentFile?: string };
  parserUsed: 'tree-sitter' | 'regex-fallback' | 'mixed' | null;

  setProgress: (p: CodeGraphUIState['progress']) => void;
  setPhase: (p: ScanPhase, error?: string | null) => void;
  setParserUsed: (k: CodeGraphUIState['parserUsed']) => void;
  replaceGraph: (next: CodeGraphSnapshot) => Promise<void>;
  reset: () => Promise<void>;
}

export const useCodeGraphStore = create<CodeGraphUIState>((set) => ({
  graph: makeEmptyGraph(),
  phase: 'idle',
  error: null,
  progress: { scanned: 0, matched: 0, skipped: 0, errors: 0 },
  parserUsed: null,

  setProgress: (p) => set({ progress: p }),
  setPhase: (p, error = null) => set({ phase: p, error }),
  setParserUsed: (k) => set({ parserUsed: k }),

  replaceGraph: async (next) => {
    set({ graph: next });
    await saveSnapshot(next);
  },

  reset: async () => {
    const empty = makeEmptyGraph();
    resetGraph(empty);
    set({
      graph: empty,
      phase: 'idle',
      error: null,
      progress: { scanned: 0, matched: 0, skipped: 0, errors: 0 },
      parserUsed: null,
    });
  },
}));

/** Hydrate the store from IndexedDB on app start. Call once on mount. */
export async function hydrateCodeGraphStore(): Promise<void> {
  const snap = await loadSnapshot();
  if (snap) {
    useCodeGraphStore.setState({ graph: snap });
  }
}

/** Computed selectors. */
export function describeGraph(graph: CodeGraphSnapshot): {
  totalEntities: number;
  byKind: Record<string, number>;
  byLanguage: Record<string, number>;
} {
  return {
    totalEntities: Object.keys(graph.entitiesById).length,
    byKind: entitiesByKind(graph),
    byLanguage: entitiesByLanguage(graph),
  };
}

/** Filter entities matching a given name with optional kind and language constraints. */
export function findMatchingEntities(
  graph: CodeGraphSnapshot,
  query: string,
  options?: { kind?: string; language?: string },
): CodeEntity[] {
  const q = query.toLowerCase();
  return Object.values(graph.entitiesById).filter((e) => {
    if (options?.kind && e.kind !== options.kind) return false;
    if (options?.language && e.language !== options.language) return false;
    return e.name.toLowerCase().includes(q) || e.name.toLowerCase() === q.replace(/\s+/g, '_');
  });
}
