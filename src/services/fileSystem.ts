// Thin wrapper around the File System Access API with a download-based fallback.
//
// When the browser supports `showDirectoryPicker`, we hold on to a
// `FileSystemDirectoryHandle` and write/read MD files directly. Otherwise
// we trigger a browser download and keep a small in-memory cache so the
// preview in the generator dialog can read what was just written.

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
      startIn?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

export interface ProjectDirectory {
  handle: FileSystemDirectoryHandle;
  name: string;
  verifyWritable(): Promise<boolean>;
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickProjectDirectory(): Promise<ProjectDirectory> {
  if (!isFileSystemAccessSupported()) {
    throw new Error(
      'File System Access API is not available in this browser. ' +
        'Use a Chromium-based browser (Chrome/Edge/Brave) for direct file writes. ' +
        'Otherwise, saved instructions will be downloaded as files.',
    );
  }
  const handle = await window.showDirectoryPicker!({ mode: 'readwrite' });
  return {
    handle,
    name: handle.name,
    async verifyWritable() {
      try {
        const probe = await handle.getFileHandle('.qwen-write-probe', { create: true });
        if (typeof (probe as unknown as { remove?: () => Promise<void> }).remove === 'function') {
          await (probe as unknown as { remove: () => Promise<void> }).remove();
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function ensureDir(
  root: FileSystemDirectoryHandle,
  parts: string[],
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const part of parts) {
    if (!part) continue;
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

export async function writeInstructionToDisk(
  dir: ProjectDirectory,
  relativePath: string,
  content: string,
): Promise<void> {
  const parts = relativePath.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error('writeInstructionToDisk: empty path');

  const folder = await ensureDir(dir.handle, parts);
  const fileHandle = await folder.getFileHandle(fileName, { create: true });
  const writable = await (fileHandle as any).createWritable();
  await writable.write(content);
  await writable.close();
}

export async function readInstructionFromDisk(
  dir: ProjectDirectory,
  relativePath: string,
): Promise<string | null> {
  const parts = relativePath.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return null;

  let current: FileSystemDirectoryHandle = dir.handle;
  for (const part of parts) {
    try {
      current = await current.getDirectoryHandle(part, {});
    } catch {
      return null;
    }
  }
  try {
    const fileHandle = await current.getFileHandle(fileName, {});
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

// ---- In-memory + download fallback ------------------------------------------------

const inMemoryByPath = new Map<string, string>();

export function rememberInMemory(relativePath: string, content: string): void {
  inMemoryByPath.set(relativePath, content);
}

export function getFromMemory(relativePath: string): string | undefined {
  return inMemoryByPath.get(relativePath);
}

export function downloadAsFile(relativePath: string, content: string): void {
  const fileName = relativePath.split('/').pop() || 'instruction.md';
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
