// Tracks the user's project-directory handle (when File System Access API is
// available) or null when we're in download/fallback mode. Holds labels and
// last-error info for UI surfacing. Directory handles themselves are not
// serializable, so they live only in this in-memory store.

import { create } from 'zustand';
import type { ProjectDirectory } from '../services/fileSystem';

interface FileSystemState {
  directory: ProjectDirectory | null;
  /** When the FS API is available, even if the user has not picked a folder yet. */
  isSupported: boolean;
  lastError: string | null;

  setDirectory: (dir: ProjectDirectory | null) => void;
  clearDirectory: () => void;
  setError: (msg: string | null) => void;
}

const detected = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

export const useFileSystemStore = create<FileSystemState>((set) => ({
  directory: null,
  isSupported: detected,
  lastError: null,

  setDirectory: (dir) => set({ directory: dir, lastError: null }),
  clearDirectory: () => set({ directory: null }),
  setError: (msg) => set({ lastError: msg }),
}));
