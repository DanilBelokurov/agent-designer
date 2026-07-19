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
  SemanticInfo,
} from './types';
import { languageForExtension } from './types';
import { extractBraceLanguage } from './extractors/braceLanguage';
import { extractIndentLanguage } from './extractors/indentLanguage';
import { staticArchetypeForFile } from './architecture';
import { groupFilesByPackage, learnArchetypes, MANIFEST_NAMES, projectFingerprintFor } from './archetypeLearner';
import { detectConventions, type ConventionsInput } from './conventions';
import { loadAgentState, saveAgentState } from './stateIO';
import { computeLayoutPositionsAsRecord } from './layoutEngine';
import {
  saveLayout,
  LAYOUT_CACHE_VERSION,
  type LayoutCache,
} from './layoutCache';
import { semanticCache } from '../semanticCache';
import { enrichDescriptions } from '../semanticEnricher';
import { logger } from '../logger';

export interface AnalyzeProgress {
  phase: 'reading' | 'extracting' | 'archetyping' | 'conventions' | 'enriching' | 'saving' | 'done';
  current: number;
  total: number;
  detail?: string;
}

export interface AnalyzeOptions {
  /** Re-run archetype learning (forces Qwen calls). */
  relearnArchetypes?: boolean;
  skipArchetypes?: boolean;
  skipConventions?: boolean;
  /** Skip Qwen-based description generation. Useful for fast rescans. */
  skipDescriptions?: boolean;
  /** Parallel Qwen calls during description generation (default 4). */
  descriptionConcurrency?: number;
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
  let out: { entities: CodeEntity[]; relations: CodeRelation[] } | null = null;
  switch (lang.desc.langClass) {
    case 'brace':
      out = extractBraceLanguage(filePath, source, lang.key);
      break;
    case 'indent':
      out = extractIndentLanguage(filePath, source, lang.key);
      break;
    case 'markup':
      return null; // skip files we don't extract entities from
  }
  // Guard against upstream duplicate-id emission. graphology and Sigma
  // both throw on `addNode` with an existing id — much friendlier to
  // crash here with the file path + offending id + duplicate count so
  // we can pinpoint which extractor is misbehaving. Sigma's later
  // `UsageGraphError` is harder to trace back to a source file.
  if (out && out.entities.length > 1) {
    const seen = new Map<string, number>();
    for (const e of out.entities) {
      seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    }
    const dupes: Array<[string, number]> = [];
    for (const [id, n] of seen) if (n > 1) dupes.push([id, n]);
    if (dupes.length > 0) {
      const preview = dupes
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, n]) => `  ${id}  ×${n}`)
        .join('\n');
      throw new Error(
        `[code-intel] Duplicate entity ids emitted by extractor for ${filePath} ` +
          `(lang=${lang.key}, parser=${lang.desc.langClass}). ` +
          `${dupes.length} duplicate id(s); top offenders:\n${preview}\n` +
          `This is a bug in the extractor (startLine-based id collision). ` +
          `The Sigma renderer would otherwise crash later with a generic graphology error.`,
      );
    }
  }
  return out;
}

function mergeEntities(
  acc: CodeEntity[],
  rels: CodeRelation[],
  additional: { entities: CodeEntity[]; relations: CodeRelation[] },
): void {
  // Type / module entities are emitted by every extractor call that
  // references the same name — `type:python:str`, `mod:python:0`,
  // etc. Each Python file containing `str` produces a fresh
  // `type:python:str` and a reference relation to it. Without dedupe
  // these multiply (140+ duplicates in real projects). The relations
  // still work fine when they target an existing id — graphology treats
  // them as pointers, not duplicate declarations — so we just skip the
  // entity insert when we already have one.
  const existing = new Set<string>();
  for (const e of acc) {
    if (e.kind === 'type' || e.kind === 'module') existing.add(e.id);
  }
  for (const e of additional.entities) {
    if ((e.kind === 'type' || e.kind === 'module') && existing.has(e.id)) {
      continue;
    }
    if (e.kind === 'type' || e.kind === 'module') existing.add(e.id);
    acc.push(e);
  }
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
  const seenPaths = new Set<string>();
  const filesToParse: string[] = [];
  for await (const filePath of walk(dir.handle, '')) {
    if (options.abort?.aborted) break;
    stats.scanned += 1;
    const dot = filePath.lastIndexOf('.');
    if (dot < 0) continue;
    if (!languageForExtension(filePath.slice(dot))) continue;
    // `walk` is supposed to yield each path exactly once, but in
    // practice (deeply nested directories, symlink cycles, or
    // browser FS API quirks) we've seen the same path emitted 2–3
    // times. De-dupe here — one extractor call per file is all we
    // want, otherwise `extractBraceLanguage` / `extractIndentLanguage`
    // each emit a fresh `file:<path>` entity and triple the size of
    // `entities` for no benefit.
    if (seenPaths.has(filePath)) continue;
    seenPaths.add(filePath);
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

  // After the full pass, check for duplicate ids ACROSS files. Per-file
  // dedupe inside the extractor is not enough — `src/config/settings.py`
  // and `src/utils/settings.py` both legitimately emit `settings.py::class::Settings::6`,
  // and only the merge step can catch that. We log a warning (not throw)
  // because the rest of the pipeline still works with the survivor
  // entity — Sigma/ReactFlow tolerate duplicates silently (ReactFlow
  // dedupes by React key, Sigma via `if (graph.hasNode) continue;`),
  // and throwing would block the whole scan.
  if (entities.length > 0) {
    const seen = new Map<string, { count: number; paths: Set<string> }>();
    for (const e of entities) {
      // type/module entities are intentionally cross-file — multiple
      // files reference the same `str`, and only the FIRST file's
      // entity survives (mergeEntities dedupes them). Their
      // `filePath` is empty by extractor design, so counting them
      // here would generate noise. Skip.
      if (e.kind === 'type' || e.kind === 'module') continue;
      const prev = seen.get(e.id);
      if (prev) {
        prev.count += 1;
        prev.paths.add(e.filePath);
      } else {
        seen.set(e.id, { count: 1, paths: new Set([e.filePath]) });
      }
    }
    const dupes: Array<{ id: string; count: number; paths: string[] }> = [];
    for (const [id, info] of seen) {
      if (info.count > 1) dupes.push({ id, count: info.count, paths: Array.from(info.paths) });
    }
    if (dupes.length > 0) {
      dupes.sort((a, b) => b.count - a.count);
      const top = dupes.slice(0, 5);
      const preview = top
        .map((d) => `  ${d.id}  ×${d.count}  [${d.paths.join(', ')}]`)
        .join('\n');
      logger.warn('analyze.crossFileDuplicateIds', {
        duplicateCount: dupes.length,
        totalEntities: entities.length,
        top,
      });
      logger.warn(
        `Cross-file duplicate entity ids: ${dupes.length} id(s) collide.\n${preview}\n` +
          `Root cause: id schema = \${filePath}::\${kind}::\${name}::\${startLine} is not unique when two files share the same basename.\n` +
          `Fix: prefix filePath with the project-relative directory (e.g. src/config/settings.py vs src/utils/settings.py).`,
      );
    }
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

  // Description enrichment — runs Qwen over every container and top-level
  // function so each gets a brief "what this does / what it's for" line
  // based on its body. Method/field/parameter/variable descriptions are
  // intentionally skipped (too granular, don't help find a class).
  let enrichedEntities: CodeEntity[] = withArchetypes.entities;
  let newSemantic: Record<string, SemanticInfo> = { ...(existing?.semantic ?? {}) };
  if (!options.skipDescriptions) {
    // Make sure the semantic cache is bound to this directory — otherwise
    // its debounced flush is a no-op and the description we generate here
    // would never reach state.json on subsequent loads.
    semanticCache.setDirectory(dir);
    await semanticCache.loadFromDB();
    const baseState: AgentState = existing ?? {
      version: 1,
      projectFingerprint: fp,
      rootPath: dir.name,
      lastScannedAt: '',
      totalFilesScanned: stats.scanned,
      entities: withArchetypes.entities,
      relations,
      archetypes,
      conventions: conventions ?? {},
      semantic: {},
      stats: { totalEntities: 0, byKind: {} as AgentState['stats']['byKind'], byLanguage: {}, archetypeCounts: {} },
    };
    const partialState: AgentState = {
      ...baseState,
      entities: withArchetypes.entities,
      relations,
      projectFingerprint: fp,
    };
    onProgress?.({ phase: 'enriching', current: 0, total: 1, detail: 'qwen → descriptions' });
    const infos = await enrichDescriptions(partialState, {
      concurrency: options.descriptionConcurrency,
      model: options.model,
      abort: options.abort,
      onProgress: (current, total, name) => {
        onProgress?.({ phase: 'enriching', current, total, detail: name });
      },
    });
    const now = new Date().toISOString();
    const byEntityId = new Map<string, SemanticInfo>();
    for (const info of infos) byEntityId.set(info.entityId, info);
    enrichedEntities = withArchetypes.entities.map((e) => {
      const info = byEntityId.get(e.id);
      if (!info) return e;
      newSemantic[info.entityId] = info;
      return {
        ...e,
        description: info.description,
        descriptionGeneratedAt: now,
        semanticRole: info.role,
        semanticDescription: info.description,
      };
    });
    // Flush the semantic cache immediately so descriptions survive a
    // mid-scan crash. Without this, the debounced flush races with
    // saveAgentState below and may overwrite our new semantic map.
    try {
      await semanticCache.flush();
      // Re-read after flush so we have the up-to-date snapshot.
      const rehydrated = new Map<string, SemanticInfo>();
      for (const id of byEntityId.keys()) {
        const v = semanticCache.getSync(id);
        if (v) rehydrated.set(id, v);
      }
      newSemantic = { ...newSemantic, ...Object.fromEntries(rehydrated) };
    } catch (err) {
      logger.warn('analyze.semanticFlushFailed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
    logger.info('analyze.descriptions', { generated: byEntityId.size, total: withArchetypes.entities.length });
  }

  // Compute stats
  const byKind: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};
  for (const e of enrichedEntities) {
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
    entities: enrichedEntities,
    relations,
    archetypes,
    conventions: conventions ?? existing?.conventions ?? {},
    semantic: newSemantic,
    stats: {
      totalEntities: enrichedEntities.length,
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
    descriptions: state.entities.filter((e) => e.description).length,
    scanned: stats.scanned,
    matched: stats.matched,
    errors: stats.errors,
  });
  onProgress?.({ phase: 'done', current: 1, total: 1 });

  // Compute dagre layout as part of the scan pipeline so the canvas can
  // open instantly next time — it just reads the cached positions from
  // `.agent-graph/layout.json` instead of running dagre on every render.
  // On cacheHit we still re-run: cheap and keeps the cache consistent
  // with any schema migration / entity edits.
  try {
    await computeAndCacheLayout(dir, state.entities, state.relations, state.projectFingerprint);
  } catch (err) {
    logger.warn('analyze.layoutCacheFailed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return { state, usedFallback: false, cacheHit };
}

/**
 * Compute dagre positions for the full graph (no filters, all compounds
 * expanded) and persist them to `.agent-graph/layout.json`. Idempotent —
 * safe to call on every scan and on demand from the "Auto layout" button.
 */
export async function computeAndCacheLayout(
  dir: ProjectDirectory,
  entities: CodeEntity[],
  relations: CodeRelation[],
  projectFingerprint: string,
): Promise<LayoutCache> {
  const t0 = performance.now();
  const positions = computeLayoutPositionsAsRecord(entities, relations);
  const cache: LayoutCache = {
    version: LAYOUT_CACHE_VERSION,
    projectFingerprint,
    computedAt: new Date().toISOString(),
    positions,
  };
  await saveLayout(dir, cache);
  logger.info('layout.cached', {
    entities: entities.length,
    positions: Object.keys(positions).length,
    ms: Math.round(performance.now() - t0),
  });
  return cache;
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
export {
  loadLayout,
  saveLayout,
  clearLayout,
  LAYOUT_FILE_NAME,
  LAYOUT_CACHE_VERSION,
} from './layoutCache';
export type { LayoutCache, LayoutPosition } from './layoutCache';
export {
  loadManualPositions,
  saveManualPositions,
  clearManualPositions,
  MANUAL_POSITIONS_FILE_NAME,
} from './manualPositions';
export type { ManualPositionsCache } from './manualPositions';
