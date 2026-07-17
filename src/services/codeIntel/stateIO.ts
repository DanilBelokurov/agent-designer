// Read/write the `.agent-graph/state.json` file inside a picked project
// folder. Atomic via tmp-file-then-rename. Falls back to writing a single
// direct file when rename isn't an option (FS Access API has no native
// rename; we copy-then-delete).
//
// Companion routines also write `.agent-graph/.gitignore` so the file is
// not committed by default — the user can override per project.

import type { ProjectDirectory } from '../fileSystem';
import {
  AGENT_STATE_VERSION,
  STATE_DIR_NAME,
  STATE_FILE_NAME,
  STATE_GITIGNORE_NAME,
  type AgentState,
} from './types';

const GITIGNORE_CONTENT = `*\n!.gitignore\n`;

export function statePath(): { dir: string; file: string } {
  return { dir: STATE_DIR_NAME, file: `${STATE_DIR_NAME}/${STATE_FILE_NAME}` };
}

export function gitignorePath(): string {
  return `${STATE_DIR_NAME}/${STATE_GITIGNORE_NAME}`;
}

export async function loadAgentState(dir: ProjectDirectory): Promise<AgentState | null> {
  try {
    const root = await dir.handle.getDirectoryHandle(STATE_DIR_NAME, {});
    const file = await root.getFileHandle(STATE_FILE_NAME, {});
    const blob = await file.getFile();
    const text = await blob.text();
    const parsed = JSON.parse(text) as AgentState;
    if (parsed.version !== AGENT_STATE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Atomic write: writes to `<file>.tmp`, then "promotes" by reading the tmp
 * content back and overwriting the final file (FS Access API doesn't expose
 * rename). For our <1 MB state this is fast enough.
 */
export async function saveAgentState(dir: ProjectDirectory, state: AgentState): Promise<void> {
  const root = await dir.handle.getDirectoryHandle(STATE_DIR_NAME, { create: true });

  // ensure .gitignore
  try {
    await root.getFileHandle(STATE_GITIGNORE_NAME, { create: true });
    const gi = await root.getFileHandle(STATE_GITIGNORE_NAME, { create: false });
    const giWritable = await (gi as any).createWritable();
    await giWritable.write(GITIGNORE_CONTENT);
    await giWritable.close();
  } catch {
    // permission denied or quota — skip silently
  }

  const tmpName = `${STATE_FILE_NAME}.tmp`;
  const tmpHandle = await root.getFileHandle(tmpName, { create: true });
  const tmpWritable = await (tmpHandle as any).createWritable();
  await tmpWritable.write(JSON.stringify(state, null, 2));
  await tmpWritable.close();

  // Promote: copy tmp content into final, then delete tmp.
  const finalHandle = await root.getFileHandle(STATE_FILE_NAME, { create: true });
  const finalWritable = await (finalHandle as any).createWritable();
  const tmpBlob = await tmpHandle.getFile();
  const content = await tmpBlob.text();
  await finalWritable.write(content);
  await finalWritable.close();

  try {
    await (tmpHandle as any).remove?.();
  } catch {
    // ignore
  }
}

export async function clearAgentState(dir: ProjectDirectory): Promise<void> {
  try {
    const root = await dir.handle.getDirectoryHandle(STATE_DIR_NAME, { create: false });
    await (root as any).remove?.({ recursive: true });
  } catch {
    // nothing to do
  }
}
