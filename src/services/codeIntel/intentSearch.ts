// Intent-based search over the code-intel graph.
//
// The base `collectContextForNode` ranks entities by name match against
// the node's label / functionName. That works for "find me the AuthService
// class" but fails for a skill labelled "Architecture of the external
// REST-interaction module" — there's no entity with that name, and the
// generator ends up writing `## Examples` from generic knowledge instead
// of the project's actual `RestClient`, `HttpGateway`, `ExternalApiAdapter`,
// etc.
//
// `extractIntent` is a small keyword-driven classifier that turns a free-
// form user request + the node's existing label/description into one or
// more `Intent` tags (rest-client, auth, database, …). `findEntitiesByIntent`
// then matches entities against an intent's archetype / kind / signal
// fingerprint: archetype from the project-aware learner, kinds from the
// code-intel extractor, signals from substring search over body / signature
// / Qwen-generated description.
//
// Not as smart as an LLM-based rerank, but cheap (no extra Qwen calls),
// deterministic, and good enough for the 80% case — the user typically
// knows roughly what kind of module their skill targets and the keyword
// covers "rest", "http", "fetch", "axios", "RestTemplate" all at once.

import type { CodeEntity, EntityKind } from './types';

export type IntentId =
  | 'rest-client'
  | 'auth'
  | 'database'
  | 'queue'
  | 'cache'
  | 'logging'
  | 'validation'
  | 'serialization'
  | 'file-storage'
  | 'scheduling';

export interface Intent {
  id: IntentId;
  /** Human-readable label for prompt rendering. */
  label: string;
  /** Words / phrases that indicate this intent in user-supplied text. */
  keywords: string[];
  /** Entity archetypes (from `archetypeLearner`) that count as on-target. */
  archetypes: string[];
  /** Entity kinds that count as on-target. */
  kinds: EntityKind[];
  /**
   * Substring signals searched in `body`, `signature`, `description`,
   * `qualifiedName`. Lowercase substring match; one hit adds to the
   * score. Covers the canonical names of popular libraries so e.g. a
   * `RestClient` in Java picks up "http" via `RestTemplate` mentions in
   * the body, even without the user writing "http" in the request.
   */
  signals: string[];
}

/**
 * Hand-curated intent set. Extend by adding an entry below — keyword
 * lists accept both Russian and English so the user can phrase the
 * request in either language.
 */
export const INTENTS: readonly Intent[] = [
  {
    id: 'rest-client',
    label: 'external REST / HTTP communication',
    keywords: [
      'rest', 'http', 'https', 'api', 'endpoint', 'external', 'integration',
      'rest-взаимодействие', 'внешнее', 'взаимодействие', 'отправлялк', 'запрос',
      'клиент', 'client', 'fetch', 'request', 'call', 'вызов',
    ],
    archetypes: ['client', 'gateway', 'adapter'],
    kinds: ['class', 'interface', 'object', 'function'],
    signals: [
      'httpclient', 'resttemplate', 'webclient', 'feignclient', 'retrofit',
      'okhttp', 'axios', 'fetch(', 'got(', 'ky', 'requests.', 'urllib',
      'http.get', 'http.post', 'http.put', 'http.delete', 'restapi',
      'restcontroller', '@getmapping', '@postmapping', '@requestmapping',
      '@feignclient', 'restassured', 'apiclient', 'restclient', 'httpclient',
    ],
  },
  {
    id: 'auth',
    label: 'authentication / authorization',
    keywords: [
      'auth', 'authorization', 'authentication', 'login', 'logout', 'session',
      'token', 'oauth', 'jwt', 'security', 'permission', 'role',
      'авторизац', 'аутентификац', 'безопасност', 'токен', 'сессия', 'роль',
      'права доступа',
    ],
    archetypes: ['middleware', 'filter', 'guard', 'validator'],
    kinds: ['class', 'interface', 'object', 'function'],
    signals: [
      'jwt', 'oauth', 'bearer', 'sessiontoken', 'authoriz', 'authenticat',
      'springsecurity', 'securityconfig', 'jwtutil', 'tokenprovider',
      'passport', 'bcrypt', '@secured', '@preauthorize', '@rolesallowed',
      'authorities', 'authenticationmanager', 'securityfilterchain',
    ],
  },
  {
    id: 'database',
    label: 'persistence / database access',
    keywords: [
      'database', 'db', 'sql', 'persistence', 'repository', 'orm',
      'база данных', 'бд', 'репозитор', 'миграц', 'persistence',
      'хранилище', 'запрос к базе',
    ],
    archetypes: ['repository', 'mapper', 'service'],
    kinds: ['class', 'interface', 'object'],
    signals: [
      'jpa', 'hibernate', 'crudrepository', 'jparepository', 'entitymanager',
      'sessionfactory', 'select ', 'insert ', 'update ', 'delete ',
      'prisma', 'sequelize', 'typeorm', 'drizzle', 'knex', 'querybuilder',
      'selectfrom', 'wherelike', 'sqlalchemy', 'alembic', 'flyway',
      'liquibase', 'migration', '@entity', '@table', '@column', '@repository',
      'mongorepository', 'mongotemplate',
    ],
  },
  {
    id: 'queue',
    label: 'message queue / streaming',
    keywords: [
      'queue', 'message', 'messaging', 'kafka', 'rabbitmq', 'producer',
      'consumer', 'stream', 'event', 'publish', 'subscribe', 'pubsub',
      'очеред', 'сообщен', 'событи', 'продюсер', 'консьюмер',
      'подпис', 'паблиш',
    ],
    archetypes: ['producer', 'consumer', 'service'],
    kinds: ['class', 'interface', 'object', 'function'],
    signals: [
      'kafka', 'kafkatemplate', 'rabbitmq', 'amqp', 'activemq', 'rocketmq',
      'sns', 'sqs', 'pubsub', 'eventbridge', 'kineses',
      '@kafkalistener', '@rabbitlistener', '@jmslistener',
      'messagelistener', 'messageproducer', 'sendmessage', 'consumemessage',
      'onmessage', 'channel.publish', 'channel.consume',
    ],
  },
  {
    id: 'cache',
    label: 'caching / in-memory stores',
    keywords: ['cache', 'redis', 'memcached', 'caching', 'кэш', 'кэширован'],
    archetypes: ['service', 'adapter'],
    kinds: ['class', 'interface', 'object', 'function'],
    signals: [
      'redis', 'redistemplate', 'memcached', 'caffeine', 'ehcache', 'hazelcast',
      '@cacheable', '@cacheevict', '@cacheput', '@caching',
      'cachemanager', 'cachebuilder', 'getorload',
    ],
  },
  {
    id: 'logging',
    label: 'logging / observability',
    keywords: [
      'log', 'logging', 'logger', 'observability', 'metrics', 'tracing',
      'monitoring', 'audit',
      'лог', 'логирован', 'наблюдаемост', 'монитор', 'аудит', 'метрик',
    ],
    archetypes: ['service', 'util'],
    kinds: ['class', 'interface', 'object', 'function'],
    signals: [
      'loggerfactory', 'logger.', 'log4j', 'logback', 'slf4j',
      'mdc.', 'structuredarguments', 'opentelemetry', 'opentracings',
      'micrometer', 'prometheus', 'meterregistry',
      '@logged', '@withlogging', '@trace', '@withspan',
    ],
  },
  {
    id: 'validation',
    label: 'input validation',
    keywords: [
      'validation', 'validator', 'validate', 'constraint', 'schema',
      'валидац', 'проверк', 'ограничен',
    ],
    archetypes: ['validator', 'filter', 'service'],
    kinds: ['class', 'interface', 'object', 'function'],
    signals: [
      'validator', 'constraintviolation', 'bean validation',
      '@valid', '@validated', '@notnull', '@notblank', '@size', '@pattern',
      '@min', '@max', '@email', '@pattern', 'zod', 'joi', 'yup', 'class-validator',
      'constraintvalidator', 'validationresult', 'errors.isempty',
    ],
  },
  {
    id: 'serialization',
    label: 'serialization / deserialization',
    keywords: [
      'serialization', 'deserialization', 'serialize', 'deserialize', 'json',
      'xml', 'codec', 'mapper',
      'сериализац', 'десериализац', 'кодек', 'маршалинг',
    ],
    archetypes: ['mapper', 'adapter', 'service'],
    kinds: ['class', 'interface', 'object', 'function'],
    signals: [
      'jackson', 'gson', 'moshi', 'kotlinx.serialization',
      'objectmapper', 'jsonnode', '@jsonproperty', '@jsonserialize',
      '@jsondeserialize', 'xmlmapper', 'jacksonxml', 'jakarta.xml.bind',
      'protobuf', 'avro', 'thrift', 'messagepack',
    ],
  },
  {
    id: 'file-storage',
    label: 'file / blob / object storage',
    keywords: [
      'file', 'filesystem', 'blob', 's3', 'storage', 'object storage',
      'upload', 'download', 'attachment',
      'файл', 'хранилище', 'загрузк', 'выгрузк', 'вложен',
    ],
    archetypes: ['adapter', 'service', 'client'],
    kinds: ['class', 'interface', 'object', 'function'],
    signals: [
      's3client', 'blobclient', 'filesystem', 'path.', 'files.', 'multipartfile',
      'storageclient', 's3object', 'putobject', 'getobject',
      'minio', 'gcs', 'azureblob', 'cosclient',
      'fileupload', 'filedownload', 'inputstream', 'outputstream',
    ],
  },
  {
    id: 'scheduling',
    label: 'scheduled / background jobs',
    keywords: [
      'schedule', 'scheduler', 'cron', 'job', 'background', 'periodic',
      'таймер', 'расписан', 'задач', 'фонов', 'периодическ',
    ],
    archetypes: ['service', 'main'],
    kinds: ['class', 'interface', 'object', 'function'],
    signals: [
      '@scheduled', '@enableScheduling', 'scheduledexecutorservice',
      'cronexpression', 'crontrigger', 'jobdetail', 'quartz',
      '@scheduled(fixedrate', '@scheduled(cron',
      'periodic', 'interval', 'every(.*)minutes',
    ],
  },
] as const;

/** Lowercase + fold ё→е so Russian keywords match naturally. */
function fold(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е');
}

/**
 * Extract intents from user-supplied text. A single request can match
 * multiple intents (e.g. "validate and log outgoing REST requests" →
 * validation + logging + rest-client). Each intent has a `keywordHits`
 * score attached so callers can rank when several match.
 */
export function extractIntents(text: string): Array<{ intent: Intent; keywordHits: number }> {
  if (!text) return [];
  const folded = fold(text);
  const out: Array<{ intent: Intent; keywordHits: number }> = [];
  for (const intent of INTENTS) {
    let hits = 0;
    for (const kw of intent.keywords) {
      // Word-boundary-ish: phrase must appear as a contiguous substring.
      // Short single-token keywords (>=3 chars) get substring match; longer
      // phrases also match on word boundaries to avoid partial overlaps.
      if (folded.includes(fold(kw))) hits += 1;
    }
    if (hits > 0) out.push({ intent, keywordHits: hits });
  }
  // Stable order: most keyword hits first, then declaration order.
  out.sort((a, b) => b.keywordHits - a.keywordHits);
  return out;
}

/** Score one entity against one intent. Higher = better match. */
function scoreEntityForIntent(entity: CodeEntity, intent: Intent): number {
  if (entity.kind === 'file' || entity.kind === 'unknown') return -1;
  let score = 0;

  // Archetype hit (strong signal — comes from the project-aware learner
  // that actually looked at file contents and imports).
  if (entity.archetype && intent.archetypes.includes(entity.archetype)) {
    score += 10;
  }

  // Kind hit (weak — every class matches the "rest-client" intent's kind
  // list, so this is just a tie-breaker for matching kinds).
  if (intent.kinds.includes(entity.kind)) {
    score += 1;
  }

  // Signal hit (substring search over the places where library / framework
  // names actually appear). Body > signature > qualifiedName > description.
  const haystacks: Array<{ text: string; weight: number }> = [
    { text: entity.bodySnippet ?? '', weight: 5 },
    { text: entity.signature ?? '', weight: 3 },
    { text: entity.qualifiedName ?? entity.name, weight: 2 },
    { text: entity.description ?? '', weight: 2 },
  ];
  const foldedHaystacks = haystacks.map((h) => ({ ...h, text: fold(h.text) }));
  for (const sig of intent.signals) {
    const foldedSig = fold(sig);
    for (const h of foldedHaystacks) {
      if (h.text.includes(foldedSig)) {
        score += h.weight;
        break; // don't double-count the same signal across haystacks
      }
    }
  }

  return score;
}

export interface IntentMatch {
  entity: CodeEntity;
  intent: IntentId;
  score: number;
}

/**
 * Find entities matching any of the given intents, sorted by score
 * descending. An entity can appear under multiple intents; we return the
 * best score per (entity, intent) pair.
 */
export function findEntitiesByIntent(
  intents: ReadonlyArray<{ intent: Intent; keywordHits: number }>,
  entities: CodeEntity[],
  options: { limit?: number } = {},
): IntentMatch[] {
  const limit = options.limit ?? 20;
  const matches: IntentMatch[] = [];
  for (const e of entities) {
    let best: IntentMatch | null = null;
    for (const { intent } of intents) {
      const s = scoreEntityForIntent(e, intent);
      if (s <= 0) continue;
      if (!best || s > best.score) {
        best = { entity: e, intent: intent.id, score: s };
      }
    }
    if (best) matches.push(best);
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit);
}

/** Convenience: extract intents from text and find entities in one call. */
export function findEntitiesForRequest(
  text: string,
  entities: CodeEntity[],
  options: { limit?: number } = {},
): { intents: Intent[]; matches: IntentMatch[] } {
  const intents = extractIntents(text);
  const matches = findEntitiesByIntent(intents, entities, options);
  return { intents: intents.map((i) => i.intent), matches };
}
