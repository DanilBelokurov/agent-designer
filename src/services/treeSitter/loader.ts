// Tree-sitter WASM runtime + grammar loader.
//
// Loads the `web-tree-sitter` WASM runtime once on first use, then lazy-loads
// grammar WASM files from /grammars/*. Each grammar is cached by URL in an
// IndexedDB store (when available) so subsequent scans are instant.
//
// Grammars are intentionally not bundled with the app — they live in
// public/grammars/ and can be (re)generated via `node scripts/fetch-grammars.cjs`.

import type { Language } from 'web-tree-sitter';

const WASM_RUNTIME_URL = '/grammars/web-tree-sitter.wasm';

export type SupportedLanguage = 'typescript' | 'tsx' | 'javascript' | 'python';

interface GrammarAsset {
  language: SupportedLanguage;
  /** Public path of the wasm file (relative to the dev server root). */
  url: string;
  /** File extensions this language handles. */
  extensions: string[];
  /** Map of tree-sitter node-type names to a normalised kind. Empty means the parser is reserved but not yet wired. */
  nodeKinds: Record<string, string>;
}

export const GRAMMARS: Record<SupportedLanguage, GrammarAsset> = {
  typescript: {
    language: 'typescript',
    url: '/grammars/tree-sitter-typescript.wasm',
    extensions: ['.ts'],
    // The TypeScript wasm handles both TS and TSX; node types come from tree-sitter-typescript.
    // Stub mapping — filled in by the extractor.
    nodeKinds: {},
  },
  tsx: {
    language: 'tsx',
    url: '/grammars/tree-sitter-typescript.wasm',
    extensions: ['.tsx'],
    nodeKinds: {},
  },
  javascript: {
    language: 'javascript',
    url: '/grammars/tree-sitter-javascript.wasm',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    nodeKinds: {},
  },
  python: {
    language: 'python',
    url: '/grammars/tree-sitter-python.wasm',
    extensions: ['.py'],
    nodeKinds: {},
  },
};

export interface LanguageResolution {
  language: SupportedLanguage;
  asset: GrammarAsset;
}

export function languageForExtension(ext: string): LanguageResolution | null {
  const e = ext.toLowerCase();
  for (const key of Object.keys(GRAMMARS) as SupportedLanguage[]) {
    const asset = GRAMMARS[key];
    if (asset.extensions.includes(e)) return { language: key, asset };
  }
  return null;
}

let initPromise: Promise<void> | null = null;
const loadedLanguages = new Map<string, Promise<Language>>();

interface WebTreeSitterModule {
  Parser: {
    init: (opts?: Record<string, unknown>) => Promise<void>;
    Language: { load: (input: string | Uint8Array) => Promise<Language> };
  };
}

async function loadModule(): Promise<WebTreeSitterModule> {
  // web-tree-sitter is published as ESM with a default export.
  const mod = (await import('web-tree-sitter')) as unknown as { default?: WebTreeSitterModule } & WebTreeSitterModule;
  return (mod.default ?? mod) as WebTreeSitterModule;
}

async function ensureInitialised(mod: WebTreeSitterModule): Promise<void> {
  if (!initPromise) {
    initPromise = mod.Parser.init({
      locateFile: (name: string) => {
        if (name.endsWith('.wasm')) return WASM_RUNTIME_URL;
        return name;
      },
    });
  }
  return initPromise;
}

const DB_NAME = 'agent-designer-grammar-cache';
const DB_VERSION = 1;
const STORE = 'grammars';

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(url: string): Promise<ArrayBuffer | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openIDB();
    return await new Promise<ArrayBuffer | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(url);
      req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(url: string, bytes: ArrayBuffer): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bytes, url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

async function fetchGrammarBytes(url: string): Promise<ArrayBuffer> {
  const cached = await idbGet(url);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch grammar ${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  await idbSet(url, buf);
  return buf;
}

async function loadLanguage(asset: GrammarAsset): Promise<Language> {
  const mod = await loadModule();
  await ensureInitialised(mod);
  const bytes = await fetchGrammarBytes(asset.url);
  return mod.Parser.Language.load(new Uint8Array(bytes));
}

export function getLanguage(language: SupportedLanguage): Promise<Language> {
  let p = loadedLanguages.get(language);
  if (!p) {
    const asset = GRAMMARS[language];
    p = loadLanguage(asset).catch((err) => {
      // Drop the failed promise so the user can retry by calling again.
      loadedLanguages.delete(language);
      throw err;
    });
    loadedLanguages.set(language, p);
  }
  return p;
}

/**
 * Report which grammars currently resolve to a wasm file on the dev server.
 * Used by the UI to indicate "real tree-sitter available" vs "regex fallback".
 */
export async function detectAvailableGrammars(): Promise<SupportedLanguage[]> {
  const out: SupportedLanguage[] = [];
  await Promise.all(
    (Object.keys(GRAMMARS) as SupportedLanguage[]).map(async (k) => {
      try {
        const res = await fetch(GRAMMARS[k].url, { method: 'HEAD' });
        if (res.ok) out.push(k);
      } catch {
        /* ignore */
      }
    }),
  );
  return out;
}
