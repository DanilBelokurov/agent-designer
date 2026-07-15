// Pure data model for the in-memory code graph. State lives here, while
// mutations come from the scanner and the Zustand UI store observes it.

import type { CodeEntity, CodeRelation } from './codeGraph';

export interface CodeGraphSnapshot {
  rootPath: string | null;
  parsedAt: string | null;
  entitiesById: Record<string, CodeEntity>;
  entitiesByFile: Record<string, string[]>; // filePath → entity ids
  relations: CodeRelation[];
}

export function makeEmptyGraph(): CodeGraphSnapshot {
  return {
    rootPath: null,
    parsedAt: null,
    entitiesById: {},
    entitiesByFile: {},
    relations: [],
  };
}

export function mergeParseResult(graph: CodeGraphSnapshot, args: {
  filePath: string;
  entities: CodeEntity[];
  relations: CodeRelation[];
}): void {
  const { filePath, entities, relations } = args;

  // Drop existing entities for this file before re-adding.
  const prevIds = graph.entitiesByFile[filePath] ?? [];
  if (prevIds.length) {
    const prevSet = new Set(prevIds);
    for (const id of prevIds) delete graph.entitiesById[id];
    graph.relations = graph.relations.filter((r) => !prevSet.has(r.from) && !prevSet.has(r.to));
  }

  const nextIds: string[] = [];
  for (const e of entities) {
    graph.entitiesById[e.id] = e;
    nextIds.push(e.id);
  }
  graph.entitiesByFile[filePath] = nextIds;
  graph.relations.push(...relations);
}

export function clearGraph(graph: CodeGraphSnapshot): void {
  graph.entitiesById = {};
  graph.entitiesByFile = {};
  graph.relations = [];
  graph.rootPath = null;
  graph.parsedAt = null;
}

export function entitiesByKind(graph: CodeGraphSnapshot): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of Object.values(graph.entitiesById)) {
    out[e.kind] = (out[e.kind] ?? 0) + 1;
  }
  return out;
}

export function entitiesByLanguage(graph: CodeGraphSnapshot): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of Object.values(graph.entitiesById)) {
    if (e.kind === 'file') continue;
    const k = e.language ?? 'unknown';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function searchEntities(
  graph: CodeGraphSnapshot,
  query: string,
): CodeEntity[] {
  if (!query) return [];
  const q = query.toLowerCase();
  return Object.values(graph.entitiesById)
    .filter((e) => e.kind !== 'file' && e.kind !== 'module')
    .filter((e) => e.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 30);
}
