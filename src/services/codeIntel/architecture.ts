// Static architecture labeler — used as a fallback when no learned rules are
// available (Qwen offline, fresh project, manual override). Filename + path
// heuristics are intentionally conventional so they pass through Qwen once a
// project has stable conventions, then the learned rules take over.
//
// Filename matching: every rule checks the **last suffix word** of the
// filename stem (`UserServiceClient` → stem `UserServiceClient` → ends in
// `Client`, not `Service`). The earlier `*Service*` style greedy substring
// match caused `UserServiceClient` to be mis-classified as `service`; the
// new pattern `(?:Service|UseCase|...)$` only matches when the suffix is the
// final word of the stem.

import type { Archetype } from './types';

interface ArchetypeHeuristic {
  archetype: Archetype;
  /** Returns true if the file is a strong match. */
  test: (fileBaseName: string, relPathSegments: string[]) => boolean;
  /** Confidence the heuristic places on this call. */
  weight: 'high' | 'medium' | 'low';
}

function stem(base: string): string {
  return base.replace(/\.[^.]+$/, '');
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
      /(?:Test|Tests|Spec)$/.test(stem(base)) ||
      /_(?:test|tests|spec)\./i.test(base) ||
      /(?:^|[\/\\])tests?[\/\\]/i.test('/' + _segs.join('/')),
  },
  {
    archetype: 'controller',
    weight: 'medium',
    test: (base, segs) =>
      /(?:Controller|RestController|Resource|Handler|Api|Routes)$/.test(stem(base)) ||
      segs.some((s) => /^(controllers?|rest|web|api|resources?|routes?|edges?|graphql|http)$/i.test(s)),
  },
  {
    archetype: 'service',
    weight: 'medium',
    test: (base, segs) =>
      /(?:Service|UseCase|UseCases|Manager|Interactor)$/.test(stem(base)) ||
      segs.some((s) => /^(services?|application|usecase|usecases?|domain|operations?)$/i.test(s)),
  },
  {
    archetype: 'repository',
    weight: 'medium',
    test: (base, segs) =>
      /(?:Repository|Repo|Dao|Store)$/.test(stem(base)) ||
      segs.some((s) => /^(repositor(y|ies)|persistence|dao|infrastructure|storage|db|jpa)$/i.test(s)),
  },
  {
    archetype: 'mapper',
    weight: 'medium',
    test: (base, _segs) => /(?:Mapper)$/.test(stem(base)) || /(?:^|[\/\\])mappers?[\/\\]/i.test('/' + _segs.join('/')),
  },
  {
    archetype: 'dto',
    weight: 'medium',
    test: (base, segs) =>
      /(?:Request|Response|Model|Dto|Payload|View)$/.test(stem(base)) ||
      segs.some((s) => /^(dto|model|entity|payload|request|response)$/i.test(s)),
  },
  {
    archetype: 'filter',
    weight: 'medium',
    test: (base, _segs) =>
      /(?:Filter|Interceptor)$/.test(stem(base)) ||
      /(?:^|[\/\\])filters?[\/\\]/i.test('/' + _segs.join('/')),
  },
  {
    archetype: 'middleware',
    weight: 'medium',
    test: (base, _segs) =>
      /(?:Middleware)$/.test(stem(base)) ||
      /(?:^|[\/\\])middlewares?[\/\\]/.test('/' + _segs.join('/')),
  },
  {
    archetype: 'client',
    weight: 'medium',
    test: (base, segs) =>
      /(?:Client|RestClient|HttpClient|ApiClient|FeignClient|GraphQLClient|GrpcClient|WebClient)$/.test(stem(base)) ||
      segs.some((s) => /^(clients?|httpclients?|sdks?)$/i.test(s)),
  },
  {
    archetype: 'gateway',
    weight: 'medium',
    test: (base, segs) =>
      /(?:Gateway|Edge|Proxy)$/.test(stem(base)) ||
      segs.some((s) => /^(gateways?|edges?|proxies?|ingress)$/i.test(s)),
  },
  {
    archetype: 'adapter',
    weight: 'medium',
    test: (base, segs) =>
      /(?:Adapter|Bridge|Translator)$/.test(stem(base)) ||
      segs.some((s) => /^(adapters?|bridges?)$/i.test(s)),
  },
  {
    archetype: 'producer',
    weight: 'medium',
    test: (base, segs) =>
      /(?:Producer|Publisher|Emitter|Sender|Dispatcher)$/.test(stem(base)) ||
      segs.some((s) => /^(producers?|publishers?|emitters?)$/i.test(s)),
  },
  {
    archetype: 'consumer',
    weight: 'medium',
    test: (base, segs) =>
      /(?:Consumer|Subscriber|Listener|Receiver|Worker|Handler)$/.test(stem(base)) ||
      segs.some((s) => /^(consumers?|subscribers?|listeners?|workers?)$/i.test(s)),
  },
  {
    archetype: 'validator',
    weight: 'medium',
    test: (base, segs) =>
      /(?:Validator|Validation|Rule|Check)$/.test(stem(base)) ||
      segs.some((s) => /^(validators?|rules?|checks?)$/i.test(s)),
  },
  {
    archetype: 'presenter',
    weight: 'low',
    test: (base, segs) =>
      /(?:Presenter|ControllerAdvice|ViewModel)$/.test(stem(base)) ||
      segs.some((s) => /^(presenters?|viewmodels?)$/i.test(s)),
  },
  {
    archetype: 'view',
    weight: 'low',
    test: (base, segs) =>
      /(?:View|Page|Screen|Template|Component)$/.test(stem(base)) ||
      segs.some((s) => /^(views?|pages?|screens?|templates?|components?)$/i.test(s)),
  },
  {
    archetype: 'exception',
    weight: 'low',
    test: (base, _segs) =>
      /(?:Exception|Error|Throwable|Failure)$/.test(stem(base)) ||
      /(?:^|[\/\\])(exceptions?|errors?)\//i.test('/' + _segs.join('/')),
  },
  {
    archetype: 'util',
    weight: 'low',
    test: (base, segs) =>
      /(?:Util|Helper|Common|Shared|Support)$/.test(stem(base)) ||
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

  // Order matters — more specific first.
  if (a.includes('@restcontroller') || a.includes('@controller')) return 'controller';
  if (a.includes('@feignclient') || a.includes('@restclient') || a.includes('@httpclient')) return 'client';
  if (a.includes('@service')) return 'service';
  if (a.includes('@repository') || a.includes('@dao')) return 'repository';
  if (a.includes('@gateway')) return 'gateway';
  if (a.includes('@adapter')) return 'adapter';
  if (a.includes('@producer') || a.includes('@publisher') || a.includes('@sendto')) return 'producer';
  if (a.includes('@consumer') || a.includes('@subscriber') || a.includes('@kafkalistener') || a.includes('@rabbitlistener')) return 'consumer';
  if (a.includes('@validated') || a.includes('@valid')) return 'validator';
  if (a.includes('@controlleradvice') || a.includes('@exceptionhandler')) return 'exception';
  if (a.includes('@component') || a.includes('@configuration') || a.includes('@bean')) return 'config';

  return null;
}