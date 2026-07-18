// Read/write the `.agent-graph/layout.json` file inside a picked project
// folder. Atomic via tmp-file-then-rename, mirroring `stateIO.ts`.
//
// The layout cache stores the result of `layoutWithDagre(...)` for the
// *full* graph (all entities, all relations, all compounds expanded). The
// UI then applies filters / collapse on top of the cached positions —
// since filtering does not change topology, the cached positions stay
// valid for whatever subset of entities remains visible.
//
// Invalidation: every cache entry is keyed by `projectFingerprint`. If the
// fingerprint on disk doesn't match the current project, the cache is
// treated as missing and re-computed on the next scan.

import type { ProjectDirectory } from '../fileSystem';
import {
  STATE_DIR_NAME,
} from './types';

export const LAYOUT_FILE_NAME = 'layout.json';

/**
 * Bump when the on-disk shape or the position-coordinate convention
 * changes in a way that would make older caches render incorrectly.
 * v1 used dagre compound mode + absolute coordinates — incompatible with
 * ReactFlow's `parentNode + extent:'parent'` (it expects *local* coords
 * for children), so v1 caches pile every method on top of its container.
 * v2 runs dagre without compound mode and stores children as local
 * coordinates relative to their parent.
 */
export const LAYOUT_CACHE_VERSION = 2;

export interface LayoutPosition {
  x: number;
  y: number;
}

export interface LayoutCache {
  version: typeof LAYOUT_CACHE_VERSION;
  projectFingerprint: string;
  computedAt: string;
  /** entity id → top-left position in ReactFlow's coordinate space. */
  positions: Record<string, LayoutPosition>;
}

interface RawLayoutCacheCurrent extends Omit<LayoutCache, 'version'> {
  version: typeof LAYOUT_CACHE_VERSION;
}

function isRawLayoutCache(value: unknown): value is RawLayoutCacheCurrent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === LAYOUT_CACHE_VERSION &&
    typeof v.projectFingerprint === 'string' &&
    typeof v.computedAt === 'string' &&
    typeof v.positions === 'object' &&
    v.positions !== null
  );
}

async function readStateDir(dir: ProjectDirectory): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await dir.handle.getDirectoryHandle(STATE_DIR_NAME, {});
  } catch {
    return null;
  }
}

/**
 * Load the cached layout for a project. Returns `null` when:
 *  - the cache file does not exist,
 *  - the cache file is corrupt,
 *  - the cache's `projectFingerprint` doesn't match the current project.
 */
export async function loadLayout(
  dir: ProjectDirectory,
  projectFingerprint: string,
): Promise<LayoutCache | null> {
  const root = await readStateDir(dir);
  if (!root) return null;
  try {
    const file = await root.getFileHandle(LAYOUT_FILE_NAME, {});
    const blob = await file.getFile();
    const text = await blob.text();
    const parsed: unknown = JSON.parse(text);
    if (!isRawLayoutCache(parsed)) return null;
    if (parsed.projectFingerprint !== projectFingerprint) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Atomic write: writes to `<file>.tmp`, then copies its content into the
 * final file (FS Access API doesn't expose rename; copy + remove is the
 * equivalent for our <1 MB layout payloads). Mirrors `saveAgentState` in
 * `stateIO.ts`.
 */
export async function saveLayout(dir: ProjectDirectory, cache: LayoutCache): Promise<void> {
  const root = await dir.handle.getDirectoryHandle(STATE_DIR_NAME, { create: true });

  const tmpName = `${LAYOUT_FILE_NAME}.tmp`;
  const tmpHandle = await root.getFileHandle(tmpName, { create: true });
  const tmpWritable = await (tmpHandle as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
  await tmpWritable.write(JSON.stringify(cache));
  await tmpWritable.close();

  const finalHandle = await root.getFileHandle(LAYOUT_FILE_NAME, { create: true });
  const finalWritable = await (finalHandle as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
  const tmpBlob = await tmpHandle.getFile();
  const content = await tmpBlob.text();
  await finalWritable.write(content);
  await finalWritable.close();

  try {
    await (tmpHandle as unknown as { remove?: () => Promise<void> }).remove?.();
  } catch {
    // ignore
  }
}

export async function clearLayout(dir: ProjectDirectory): Promise<void> {
  const root = await readStateDir(dir);
  if (!root) return;
  try {
    const handle = await root.getFileHandle(LAYOUT_FILE_NAME, { create: false });
    await (handle as unknown as { remove?: () => Promise<void> }).remove?.();
  } catch {
    // nothing to do
  }
}
