// Two-tier cache for semantic info (Qwen-derived role + description per code entity).
//
// - sync (in-memory Map) for fast reads when assembling context
// - async (IndexedDB via idb-keyval) for persistence across reloads
//
// Top-level singleton: the cache lives for the whole tab. Call `loadFromDB`
// once at app start to warm the in-memory layer from disk.

import { get, keys, set as kvSet, clear as kvClear } from 'idb-keyval';

export interface SemanticInfo {
  entityId: string;
  role: string;
  description: string;
  timestamp: number;
}

const STORE_NAME = 'agent-designer-semantic-cache';

const memory = new Map<string, SemanticInfo>();

export const semanticCache = {
  /** Synchronous in-memory read. */
  getSync(entityId: string): SemanticInfo | undefined {
    return memory.get(entityId);
  },

  /** Synchronous in-memory write (does not persist). */
  setSync(info: SemanticInfo): void {
    memory.set(info.entityId, info);
  },

  /** Hydrate the in-memory map from IndexedDB. Call once at app start. */
  async loadFromDB(): Promise<number> {
    let loaded = 0;
    try {
      const allKeys = await keys();
      for (const k of allKeys) {
        if (typeof k !== 'string') continue;
        const value = await get<SemanticInfo>(k);
        if (value && value.entityId) {
          memory.set(value.entityId, value);
          loaded += 1;
        }
      }
    } catch (err) {
      // IndexedDB unavailable (SSR, private mode, etc.) — degrade silently.
      // eslint-disable-next-line no-console
      console.warn('[semanticCache] loadFromDB failed:', err);
    }
    return loaded;
  },

  /** Persist a single record to IDB (memory must already hold it). */
  async persistToDB(entityId: string): Promise<void> {
    const info = memory.get(entityId);
    if (!info) return;
    try {
      await kvSet(entityId, info);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[semanticCache] persist failed for ${entityId}:`, err);
    }
  },

  /** Read-through: in-memory first, then IDB. Updates memory on hit. */
  async get(entityId: string): Promise<SemanticInfo | undefined> {
    const hit = memory.get(entityId);
    if (hit) return hit;
    try {
      const value = await get<SemanticInfo>(entityId);
      if (value) memory.set(entityId, value);
      return value;
    } catch {
      return undefined;
    }
  },

  /** Write-through: memory + IDB. */
  async set(info: SemanticInfo): Promise<void> {
    memory.set(info.entityId, info);
    try {
      await kvSet(info.entityId, info);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[semanticCache] set failed for ${info.entityId}:`, err);
    }
  },

  /** Wipe everything (memory + IDB). Call on `code-graph reset` to avoid stale data. */
  async clear(): Promise<void> {
    memory.clear();
    try {
      await kvClear();
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

// Re-export the store name so tests / dev-tools can verify it.
export const SEMANTIC_CACHE_STORE = STORE_NAME;
