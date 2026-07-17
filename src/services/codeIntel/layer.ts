// Unified entry point for the code-intel pipeline. Walks the picked project
// folder, runs the universal extractors (no per-language WASMs), runs the
// archetype learner, the convention sniffer, and aggregates everything into
// an `AgentState` ready to persist to `.agent-graph/state.json`.

import type { ProjectDirectory } from '../fileSystem';
import type {
  AgentState,
  CodeEntity,
  CodeRelation,
  ProjectArchetypeIndex,
} from './types';
import { languageForExtension } from './types';
import { extractBraceLanguage } from './extractors/braceLanguage';
import { extractIndentLanguage } from './extractors/indentLanguage';
import { staticArchetypeForFile } from './architecture';
import { groupFilesByPackage, learnArchetypes, MANIFEST_NAMES, projectFingerprintFor } from './archetypeLearner';
import { detectConventions, type ConventionsInput } from './conventions';
import { loadAgentState, saveAgentState } from './stateIO';
import { logger } from '../logger';

export interface AnalyzeProgress {
  phase: 'reading' | 'extracting' | 'archetyping' | 'conventions' | 'saving' | 'done';
  current: number;
  total: number;
  detail?: string;
}

export interface AnalyzeOptions {
  /** Re-run archetype learning (forces Qwen calls). */
  relearnArchetypes?: boolean;
  skipArchetypes?: boolean;
  skipConventions?: boolean;
  /** Qwen model id to use for archetype learning. */
  model?: string;
  onProgress?: (p: AnalyzeProgress) => void;
  abort?: AbortSignal;
}

export interface AnalyzeResult {
  state: AgentState;
  usedFallback: boolean;
  cacheHit: boolean;
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '.cache', '.vercel', '.turbo', '__pycache__', '.venv', 'venv',
  'target', '.idea', '.vscode', 'coverage', '.gradle', '.terraform',
  '.agent-graph',  // our own state folder — don't recursively scan
  '.git', '.svn', '.hg',
]);

const MAX_FILE_BYTES = 1024 * 1024; // 1 MiB
const CHUNK_SIZE = 25;

interface ScanStats {
  scanned: number;
  matched: number;
  errors: number;
}

function readDirEntries(
  handle: FileSystemDirectoryHandle,
): AsyncIterable<[string, FileSystemHandle]> {
  return handle.entries() as unknown as AsyncIterable<[string, FileSystemHandle]>;
}

async function* walk(handle: FileSystemDirectoryHandle, prefix: string): AsyncGenerator<string, void> {
  const entries = readDirEntries(handle);
  for await (const [name, child] of entries) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (child.kind === 'directory') {
      if (IGNORED_DIRS.has(name) || name.startsWith('.') && name !== '.editorconfig') continue;
      yield* walk(child as FileSystemDirectoryHandle, rel);
    } else if (child.kind === 'file') {
      yield rel;
    }
  }
}

async function readFileContent(
  dir: ProjectDirectory,
  relPath: string,
): Promise<string | null> {
  try {
    const parts = relPath.split('/');
    const fileName = parts.pop();
    if (!fileName) return null;
    let folder: FileSystemDirectoryHandle = dir.handle;
    for (const part of parts) {
      folder = await folder.getDirectoryHandle(part, {});
    }
    const fh = await folder.getFileHandle(fileName, {});
    const file = await fh.getFile();
    if (file.size > MAX_FILE_BYTES) return null;
    return await file.text();
  } catch {
    return null;
  }
}

function extractEntitiesForFile(
  filePath: string,
  source: string,
): { entities: CodeEntity[]; relations: CodeRelation[] } | null {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = filePath.slice(dot);
  const lang = languageForExtension(ext);
  if (!lang) return null;
  switch (lang.desc.langClass) {
    case 'brace':
      return extractBraceLanguage(filePath, source, lang.key);
    case 'indent':
      return extractIndentLanguage(filePath, source, lang.key);
    case 'markup':
      return null; // skip files we don't extract entities from
  }
}

function mergeEntities(
  acc: CodeEntity[],
  rels: CodeRelation[],
  additional: { entities: CodeEntity[]; relations: CodeRelation[] },
): void {
  acc.push(...additional.entities);
  rels.push(...additional.relations);
}

function applyArchetypes(
  entities: CodeEntity[],
  index: ProjectArchetypeIndex,
): { entities: CodeEntity[]; archetypeCounts: Record<string, number> } {
  const counts: Record<string, number> = {};
  const out: CodeEntity[] = [];
  for (const e of entities) {
    let archetype = e.archetype;
    let confidence: 'high' | 'medium' | 'low' | undefined;
    if (!archetype && e.filePath) {
      const rule = index.fileAssignment[e.filePath];
      const heuristic = staticArchetypeForFile(e.filePath);
      if (rule) {
        archetype = rule.archetype;
        confidence = rule.confidence;
      } else if (heuristic) {
        archetype = heuristic.archetype;
        confidence = heuristic.confidence;
      }
    }
    if (archetype) counts[archetype] = (counts[archetype] ?? 0) + 1;
    out.push({ ...e, archetype: archetype ?? undefined, archetypeConfidence: confidence });
  }
  return { entities: out, archetypeCounts: counts };
}

export async function analyzeProject(
  dir: ProjectDirectory,
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  // Try to load existing state first.
  const existing = await loadAgentState(dir);
  const fingerprints: string[] = [];
  let manifestRoot = dir.handle;
  for (const m of MANIFEST_NAMES) {
    try {
      await manifestRoot.getFileHandle(m, {});
      fingerprints.push(m);
    } catch {
      /* missing */
    }
  }
  const fp = projectFingerprintFor(dir.name, fingerprints);
  const cacheHit = existing?.projectFingerprint === fp;
  const onProgress = options.onProgress;

  let entities: CodeEntity[] = existing?.entities ? [...existing.entities] : [];
  let relations: CodeRelation[] = existing?.relations ? [...existing.relations] : [];
  let archetypes: ProjectArchetypeIndex = existing?.archetypes
    ? { ...existing.archetypes, projectFingerprint: fp }
    : { projectFingerprint: fp, rulesByPackage: {}, fileAssignment: {} };

  logger.info('analyze.start', {
    directory: dir.name,
    fingerprint: fp,
    cacheHit,
    manifests: fingerprints,
  });

  onProgress?.({ phase: 'reading', current: 0, total: 1 });

  // Walk files, parse new/changed ones
  const stats: ScanStats = { scanned: 0, matched: 0, errors: 0 };
  const filesToParse: string[] = [];
  for await (const filePath of walk(dir.handle, '')) {
    if (options.abort?.aborted) break;
    stats.scanned += 1;
    const dot = filePath.lastIndexOf('.');
    if (dot < 0) continue;
    if (!languageForExtension(filePath.slice(dot))) continue;
    filesToParse.push(filePath);
    stats.matched += 1;
  }
  onProgress?.({ phase: 'reading', current: stats.scanned, total: stats.scanned, detail: `found ${stats.matched} candidate files` });

  // Process in chunks.
  let processed = 0;
  const total = filesToParse.length;
  for (let i = 0; i < filesToParse.length; i += CHUNK_SIZE) {
    if (options.abort?.aborted) break;
    const chunk = filesToParse.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (filePath) => {
        const source = await readFileContent(dir, filePath);
        if (source === null) {
          stats.errors += 1;
          return;
        }
        try {
          const out = extractEntitiesForFile(filePath, source);
          if (out) mergeEntities(entities, relations, out);
        } catch (err) {
          stats.errors += 1;
          // eslint-disable-next-line no-console
          console.warn(`[code-intel] ${filePath}:`, err);
        }
      }),
    );
    processed += chunk.length;
    onProgress?.({ phase: 'extracting', current: processed, total });
    await new Promise((r) => setTimeout(r, 0));
  }

  // Apply archetype labels (used cached when not force-relearning).
  if (!options.skipArchetypes) {
    const groups = groupFilesByPackage(entities);
    const cacheMap = new Map<string, typeof archetypes.rulesByPackage[string]>();
    if (cacheHit && !options.relearnArchetypes) {
      for (const [pkg, rules] of Object.entries(existing!.archetypes.rulesByPackage ?? {})) {
        cacheMap.set(`${fp}|${pkg}`, rules);
      }
    }
    onProgress?.({ phase: 'archetyping', current: 0, total: groups.length, detail: 'learning packages' });
    await learnArchetypes({
      groups,
      index: archetypes,
      cache: cacheMap,
      model: options.model,
      onProgress: (current, total, pkg) => {
        onProgress?.({ phase: 'archetyping', current, total, detail: pkg });
      },
    });
    onProgress?.({ phase: 'archetyping', current: groups.length, total: groups.length });
  }

  // Convention sniff
  let conventions: AgentState['conventions'] = existing?.conventions ?? {};
  if (!options.skipConventions) {
    const byLanguage: ConventionsInput['byLanguage'] = {};
    for (let i = 0; i < filesToParse.length; i += 1) {
      if (options.abort?.aborted) break;
      const filePath = filesToParse[i];
      const lang = languageForExtension(filePath.slice(filePath.lastIndexOf('.')));
      if (!lang) continue;
      const source = await readFileContent(dir, filePath);
      if (source === null) continue;
      const ents = entities.filter((e) => e.filePath === filePath);
      (byLanguage[lang.desc.tag] = byLanguage[lang.desc.tag] ?? []).push({ path: filePath, content: source, entities: ents });
    }
    onProgress?.({ phase: 'conventions', current: 0, total: 1, detail: 'sniffing' });
    conventions = detectConventions({ byLanguage });
  }

  // Apply archetypes to entities, gather counts
  const withArchetypes = applyArchetypes(entities, archetypes);

  // Compute stats
  const byKind: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};
  for (const e of withArchetypes.entities) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    if (e.language) byLanguage[e.language] = (byLanguage[e.language] ?? 0) + 1;
  }
  const archetypeCounts: Record<string, number> = {};
  for (const [arch, n] of Object.entries(withArchetypes.archetypeCounts)) {
    archetypeCounts[arch] = n;
  }

  const state: AgentState = {
    version: 1,
    projectFingerprint: fp,
    rootPath: dir.name,
    lastScannedAt: new Date().toISOString(),
    totalFilesScanned: stats.scanned,
    entities: withArchetypes.entities,
    relations,
    archetypes,
    conventions: conventions ?? existing?.conventions ?? {},
    semantic: existing?.semantic ?? {},
    stats: {
      totalEntities: entities.length,
      byKind: byKind as AgentState['stats']['byKind'],
      byLanguage,
      archetypeCounts,
    },
  };

  onProgress?.({ phase: 'saving', current: 0, total: 1, detail: 'persisting state.json' });
  await saveAgentState(dir, state);
  logger.info('analyze.done', {
    entities: state.entities.length,
    relations: state.relations.length,
    scanned: stats.scanned,
    matched: stats.matched,
    errors: stats.errors,
  });
  onProgress?.({ phase: 'done', current: 1, total: 1 });

  return { state, usedFallback: false, cacheHit };
}

/**
 * Light wrapper for callers that only want to load — never scans. Returns
 * null when there is no saved state.
 */
export async function loadOnly(dir: ProjectDirectory): Promise<AgentState | null> {
  return loadAgentState(dir);
}

/** Re-export for consumers. */
export {
  staticArchetypeForFile,
  staticArchetypeFromAnnotations,
} from './architecture';
export { searchIndex, SearchIndex } from './searchIndex';
export type {
  AgentState,
  Archetype,
  CodeEntity,
  CodeRelation,
  ConventionReport,
  ProjectArchetypeIndex,
  SemanticInfo,
  PackageArchetypeRule,
} from './types';
export { statePath, gitignorePath, loadAgentState, saveAgentState, clearAgentState } from './stateIO';
export type { SearchHit, SearchQuery } from './searchIndex';
