// Recursive file-system walker for the picked project directory.
//
// Reads each candidate file via the File System Access API, hands the source
// to the parser selector, and merges the result into the in-memory graph
// store. Runs in chunks so progress can be observed by the UI.

import type { ProjectDirectory } from '../fileSystem';
import { isFileSystemAccessSupported, readInstructionFromDisk, writeInstructionToDisk } from '../fileSystem';
import type { CodeGraphSnapshot } from './codeGraphStore';
import { mergeParseResult } from './codeGraphStore';
import { languageForExtension } from './loader';
import { runParserForFile } from './codeParserSelector';

const MAX_FILE_BYTES = 1024 * 1024; // 1 MiB - skip huge generated files
const CHUNK_SIZE = 25;

export interface ScanProgress {
  scanned: number;
  matched: number;
  skipped: number;
  errors: number;
  currentFile?: string;
  done: boolean;
}

export interface ScanOptions {
  /** Stop after processing this many matched files. */
  maxFiles?: number;
  /** When set, progress callback fires after each chunk. */
  onProgress?: (p: ScanProgress) => void;
  /** Abort signal so the user can cancel a long scan. */
  signal?: AbortSignal;
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '.cache', '.vercel', '.turbo', '__pycache__', '.venv', 'venv',
  'target', '.idea', '.vscode', 'coverage', '.gradle', '.terraform',
]);

function readDirEntries(handle: FileSystemDirectoryHandle): AsyncIterable<[string, FileSystemHandle]> {
  return handle.entries() as unknown as AsyncIterable<[string, FileSystemHandle]>;
}

async function* walk(
  handle: FileSystemDirectoryHandle,
  prefix: string,
): AsyncGenerator<string> {
  for await (const entry of readDirEntries(handle) as AsyncIterableIterator<[string, FileSystemHandle]>) {
    const [name, child] = entry;
    const relPath = prefix ? `${prefix}/${name}` : name;
    if (child.kind === 'directory') {
      if (IGNORED_DIRS.has(name) || name.startsWith('.')) continue;
      yield* walk(child as FileSystemDirectoryHandle, relPath);
    } else if (child.kind === 'file') {
      yield relPath;
    }
  }
}

export async function scanProjectDirectory(
  dir: ProjectDirectory,
  graph: CodeGraphSnapshot,
  options: ScanOptions = {},
): Promise<{ scanned: number; matched: number; errors: number }> {
  if (!isFileSystemAccessSupported()) {
    throw new Error(
      'scanProjectDirectory requires a real FileSystemDirectoryHandle. ' +
        'Use isFileSystemAccessSupported() first.',
    );
  }

  const progress: ScanProgress = {
    scanned: 0,
    matched: 0,
    skipped: 0,
    errors: 0,
    done: false,
  };

  const matches: string[] = [];

  for await (const filePath of walk(dir.handle, '')) {
    if (options.signal?.aborted) {
      progress.done = true;
      return { scanned: progress.scanned, matched: progress.matched, errors: progress.errors };
    }
    progress.scanned += 1;
    const ext = '.' + (filePath.split('.').pop() ?? '');
    if (!languageForExtension(ext)) {
      progress.skipped += 1;
      continue;
    }
    matches.push(filePath);
    if (options.maxFiles && matches.length >= options.maxFiles) break;
  }

  progress.matched = matches.length;
  options.onProgress?.({ ...progress });

  // Process matched files in chunks.
  for (let i = 0; i < matches.length; i += CHUNK_SIZE) {
    if (options.signal?.aborted) break;
    const chunk = matches.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (filePath) => {
        progress.currentFile = filePath;
        try {
          const parts = filePath.split('/');
          const fileName = parts.pop()!;
          let folder: FileSystemDirectoryHandle = dir.handle;
          for (const part of parts) {
            folder = await folder.getDirectoryHandle(part, {});
          }
          const fileHandle = await folder.getFileHandle(fileName, {});
          const file = await fileHandle.getFile();
          if (file.size > MAX_FILE_BYTES) {
            progress.skipped += 1;
            return;
          }
          // Optional optimisation: skip parse if file is identical to cached one.
          const source = await file.text();
          const run = await runParserForFile(filePath, source);
          if (!run) {
            progress.skipped += 1;
            return;
          }
          mergeParseResult(graph, {
            filePath,
            entities: run.result.entities,
            relations: run.result.relations,
          });
        } catch (err) {
          progress.errors += 1;
          // eslint-disable-next-line no-console
          console.warn(`[code-graph] ${filePath}:`, err);
        }
      }),
    );
    options.onProgress?.({ ...progress });
    // Yield to the UI thread between chunks.
    await new Promise((r) => setTimeout(r, 0));
  }

  progress.done = true;
  progress.currentFile = undefined;
  options.onProgress?.({ ...progress });
  return { scanned: progress.scanned, matched: progress.matched, errors: progress.errors };
}

// Re-export the helpers for callers that only need single-file reads.
export { readInstructionFromDisk, writeInstructionToDisk };
