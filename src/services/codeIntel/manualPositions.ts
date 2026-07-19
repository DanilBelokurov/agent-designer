// Read/write the `.agent-graph/manual-positions.json` file inside a picked
// project folder. Mirrors `layoutCache.ts` — same atomic write pattern,
// same fingerprint-keyed invalidation — but for the *user-dragged*
// node positions, kept separate from the dagre-computed layout so:
//
//   - `Auto layout` can wipe manual positions without touching the dagre
//     cache (and vice versa);
//   - the dagre cache stays a pure function of `(entities, relations,
//     fingerprint)` and can be regenerated deterministically;
//   - merging logic stays trivial: positions from manual override win
//     over positions from the dagre layout, no priority flags needed.
//
// Schema is identical to `layoutCache.positions` — a flat id → `{x,y}`
// map — so canvas code can use either source the same way.

import type { ProjectDirectory } from '../fileSystem';
import type { LayoutPosition } from './layoutCache';
import { STATE_DIR_NAME } from './types';

export const MANUAL_POSITIONS_FILE_NAME = 'manual-positions.json';

export interface ManualPositionsCache {
  version: 1;
  projectFingerprint: string;
  updatedAt: string;
  /** entity id → top-left position in ReactFlow's coordinate space. */
  positions: Record<string, LayoutPosition>;
}

interface RawManualPositionsV1 extends Omit<ManualPositionsCache, 'version'> {
  version: 1;
}

function isRawManualPositions(value: unknown): value is RawManualPositionsV1 {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.projectFingerprint === 'string' &&
    typeof v.updatedAt === 'string' &&
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
 * Load the user's manually-dragged node positions. Returns `null` when:
 *  - the file doesn't exist (user hasn't dragged anything yet);
 *  - the file is corrupt;
 *  - the cached `projectFingerprint` doesn't match the current project
 *    (the file belongs to a different folder, or the project was rescanned
 *    and the entities no longer match).
 */
export async function loadManualPositions(
  dir: ProjectDirectory,
  projectFingerprint: string,
): Promise<ManualPositionsCache | null> {
  const root = await readStateDir(dir);
  if (!root) return null;
  try {
    const file = await root.getFileHandle(MANUAL_POSITIONS_FILE_NAME, {});
    const blob = await file.getFile();
    const text = await blob.text();
    const parsed: unknown = JSON.parse(text);
    if (!isRawManualPositions(parsed)) return null;
    if (parsed.projectFingerprint !== projectFingerprint) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Atomic write: same tmp+copy pattern as `stateIO` and `layoutCache`.
 * Empty `positions` is allowed — callers may want to write a no-op file
 * for diagnostics. To fully remove the file use `clearManualPositions`.
 */
export async function saveManualPositions(
  dir: ProjectDirectory,
  cache: ManualPositionsCache,
): Promise<void> {
  const root = await dir.handle.getDirectoryHandle(STATE_DIR_NAME, { create: true });

  const tmpName = `${MANUAL_POSITIONS_FILE_NAME}.tmp`;
  const tmpHandle = await root.getFileHandle(tmpName, { create: true });
  const tmpWritable = await (tmpHandle as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
  await tmpWritable.write(JSON.stringify(cache));
  await tmpWritable.close();

  const finalHandle = await root.getFileHandle(MANUAL_POSITIONS_FILE_NAME, { create: true });
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

export async function clearManualPositions(dir: ProjectDirectory): Promise<void> {
  const root = await readStateDir(dir);
  if (!root) return;
  try {
    const handle = await root.getFileHandle(MANUAL_POSITIONS_FILE_NAME, { create: false });
    await (handle as unknown as { remove?: () => Promise<void> }).remove?.();
  } catch {
    // nothing to do
  }
}
