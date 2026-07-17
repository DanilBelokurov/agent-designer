// Static architecture labeler — used as a fallback when no learned rules are
// available (Qwen offline, fresh project, manual override). Filename + path
// heuristics are intentionally conventional so they pass through Qwen once a
// project has stable conventions, then the learned rules take over.

import type { Archetype } from './types';

interface ArchetypeHeuristic {
  archetype: Archetype;
  /** Returns true if the file is a strong match. */
  test: (fileBaseName: string, relPathSegments: string[]) => boolean;
  /** Confidence the heuristic places on this call. */
  weight: 'high' | 'medium' | 'low';
}

const ARCHETYPE_HEURISTICS: ArchetypeHeuristic[] = [
  {
    archetype: 'config',
    weight: 'high',
    test: (base, _segs) =>
      /^(package|tsconfig|tsconfig\.base|application|settings|gradle|pom|build|cargo|composer|pyproject|setup)\.(json|yaml|yml|properties|toml|kts)$/i.test(base) ||
      /^(Dockerfile|Makefile|README|README\.\w+)$/i.test(base),
  },
  {
    archetype: 'main',
    weight: 'high',
    test: (base, _segs) => /^main\.\w+$/i.test(base) || /^Main\.\w+$/i.test(base),
  },
  {
    archetype: 'test',
    weight: 'medium',
    test: (base, _segs) =>
      /(?:^|[\/\\])(?:[A-Z][\w]*(?:Test|Tests|Spec)|.*Test\.[A-Za-z]+)$/.test(base) ||
      /_(?:test|tests|spec)\./i.test(base) ||
      /(?:^|[\/\\])tests?[\/\\]/i.test('/' + _segs.join('/')),
  },
  {
    archetype: 'controller',
    weight: 'medium',
    test: (base, segs) =>
      /(?:^|[\/\\])([A-Za-z0-9_]+(?:Controller|RestController|Resource|Handler|Api|Routes))\.\w+$/.test(base) ||
      segs.some((s) => /^(controllers?|rest|web|api|resources?|routes?|edges?|graphql|http)$/i.test(s)),
  },
  {
    archetype: 'service',
    weight: 'medium',
    test: (base, segs) =>
      /(?:^|[\/\\])([A-Za-z0-9_]+(?:Service|UseCase|UseCases|Handler|Manager|Interactor))\.\w+$/.test(base) ||
      segs.some((s) => /^(services?|application|usecase|usecases?|domain|operations?)$/i.test(s)),
  },
  {
    archetype: 'repository',
    weight: 'medium',
    test: (base, segs) =>
      /(?:^|[\/\\])([A-Za-z0-9_]+(?:Repository|Repo|Dao|Store))\.\w+$/.test(base) ||
      segs.some((s) => /^(repositor(y|ies)|persistence|dao|infrastructure|storage|db|jpa|adapters?)$/i.test(s)),
  },
  {
    archetype: 'mapper',
    weight: 'medium',
    test: (base, _segs) => /Mapper(?:[A-Z][\w]*|s)?\.\w+$/.test(base) || /(?:^|[\/\\])mappers?[\/\\]/i.test('/' + _segs.join('/')),
  },
  {
    archetype: 'dto',
    weight: 'medium',
    test: (base, segs) =>
      /(?:Request|Response|Model|Entity|Dto|Payload|Resource|View)\.\w+$/.test(base) ||
      segs.some((s) => /^(dto|model|entity|view|payload|request|response)$/i.test(s)),
  },
  {
    archetype: 'filter',
    weight: 'medium',
    test: (base, _segs) => /(?:^|[\/\\])([A-Za-z0-9_]+(?:Filter|Interceptor))\.\w+$/.test(base) || /(?:^|[\/\\])filters?[\/\\]/i.test('/' + _segs.join('/')),
  },
  {
    archetype: 'middleware',
    weight: 'medium',
    test: (base, _segs) => /(?:^|[\/\\])([A-Za-z0-9_]+Middleware)\.\w+$/.test(base) || /(?:^|[\/\\])middlewares?[\/\\]/.test('/' + _segs.join('/')),
  },
  {
    archetype: 'util',
    weight: 'low',
    test: (base, segs) =>
      /(?:Util|Helper|Common|Shared)\.\w+$/.test(base) ||
      segs.some((s) => /^(util|utils?|common|shared|helpers?|lib)$/i.test(s)),
  },
];

/**
 * Run static heuristics against a file's relative path. Used when no
 * learned rule from Qwen matches.
 */
export function staticArchetypeForFile(
  filePath: string,
): { archetype: Archetype; confidence: 'high' | 'medium' | 'low' } | null {
  const norm = filePath.replace(/\\/g, '/');
  const segments = norm.split('/').filter(Boolean);
  const base = segments.at(-1) ?? '';
  const parents = segments.slice(0, -1);

  const order = ['high', 'medium', 'low'];
  for (const w of order) {
    for (const h of ARCHETYPE_HEURISTICS) {
      if (h.weight !== w) continue;
      if (h.test(base, parents)) {
        return { archetype: h.archetype, confidence: h.weight };
      }
    }
  }
  return null;
}

export function staticArchetypeFromAnnotations(
  annotations: string[] | undefined,
): Archetype | null {
  if (!annotations?.length) return null;
  const a = annotations.map((s) => s.toLowerCase());
  if (a.includes('@restcontroller') || a.includes('@controller')) return 'controller';
  if (a.includes('@service')) return 'service';
  if (a.includes('@repository') || a.includes('@dao')) return 'repository';
  if (a.includes('@component') || a.includes('@configuration') || a.includes('@bean')) return 'config';
  return null;
}
