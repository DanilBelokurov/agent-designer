// Per-entity semantic enrichment via the local Qwen CLI.
//
// `enrichEntity(entity)` returns the role + short description either from
// the persisted cache, or by calling `qwen -p <prompt>` and parsing the
// response. After a successful call the result is written to the
// semanticCache (memory + IDB). Any failure (Qwen down, parse miss, …)
// falls back to `{ role: 'unknown', description: '…' }` so callers can
// proceed without enriching.

import { generateViaQwen, QwenUnavailableError } from './qwenClient';
import { semanticCache, type SemanticInfo } from './semanticCache';
import type { CodeEntity } from './treeSitter/codeGraph';

const BODY_MAX = 2000;
const DESCRIPTION_MAX = 100;
const KNOWN_ROLES = new Set([
  'controller', 'service', 'repository', 'factory', 'adapter',
  'configuration', 'entity', 'dto', 'mapper', 'handler',
  'validator', 'utility', 'middleware', 'guard', 'filter',
  'resolver', 'provider', 'helper', 'composable', 'hook',
  'unknown',
]);

function normaliseRole(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/[^a-z_]/g, '_');
  if (KNOWN_ROLES.has(trimmed)) return trimmed;
  // Unknown / non-canonical -> map to 'unknown' rather than free-form strings
  // that wouldn't survive round-trips cleanly.
  return 'unknown';
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function buildEnrichmentPrompt(entity: CodeEntity): string {
  const body = entity.bodySnippet ? clip(entity.bodySnippet, BODY_MAX) : '(no body)';
  const docBlock = entity.docComment ? `Документация:\n${entity.docComment}\n` : '';
  return [
    'Ты — эксперт по анализу кода. Определи семантическую роль и дай краткое описание для следующей сущности.',
    '',
    `Имя: ${entity.name}`,
    `Тип: ${entity.kind}`,
    `Сигнатура: ${entity.signature ?? '(нет)'}`,
    'Тело (сокращённое):',
    '```',
    body,
    '```',
    docBlock ? `${docBlock}` : '',
    '',
    'Ответь строго в формате:',
    'РОЛЬ: <одно слово из списка: controller, service, repository, factory, adapter, configuration, entity, dto, mapper, handler, validator, utility, middleware, guard, filter, resolver, provider, helper, composable, hook, unknown>',
    `ОПИСАНИЕ: <краткое описание до ${DESCRIPTION_MAX} символов>`,
    '',
    'Не добавляй лишнего текста, заголовков или пояснений.',
  ].join('\n');
}

function parseSemanticResponse(raw: string): SemanticInfo['role'] extends string
  ? { role: string; description: string }
  : { role: string; description: string } {
  let role = 'unknown';
  let description = '';
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:РОЛЬ|РОЛЬ)\s*:\s*(.+?)\s*$/i);
    if (m) {
      role = normaliseRole(m[1]);
      continue;
    }
    const d = line.match(/^\s*(?:ОПИСАНИЕ|OPISANIE)\s*:\s*(.+?)\s*$/i);
    if (d) {
      description = clip(d[1], DESCRIPTION_MAX);
    }
  }
  return { role, description };
}

function fallbackInfo(entityId: string, reason: string): SemanticInfo {
  return {
    entityId,
    role: 'unknown',
    description: clip(reason, DESCRIPTION_MAX),
    timestamp: Date.now(),
  };
}

export async function enrichEntity(entity: CodeEntity): Promise<SemanticInfo> {
  // 1. Cache hit — return directly.
  const cached = await semanticCache.get(entity.id);
  if (cached) return cached;

  const prompt = buildEnrichmentPrompt(entity);

  // 2. Ask Qwen.
  let raw: string;
  try {
    raw = await generateViaQwen(prompt);
  } catch (err) {
    const reason =
      err instanceof QwenUnavailableError ? err.message : `qwen call failed: ${String(err)}`;
    const fallback = fallbackInfo(entity.id, reason);
    await semanticCache.set(fallback);
    return fallback;
  }

  // 3. Parse response.
  let parsed = parseSemanticResponse(raw);
  if (!parsed.description) {
    parsed = { role: parsed.role, description: 'Не удалось распарсить ответ Qwen' };
  }

  const info: SemanticInfo = {
    entityId: entity.id,
    role: parsed.role,
    description: parsed.description,
    timestamp: Date.now(),
  };

  // 4. Cache write-through (memory + IDB) — fire-and-forget IDB persist.
  await semanticCache.set(info);
  return info;
}

/**
 * Sequential enrichment of multiple entities. Calls Qwen once per entity
 * (sequential, never parallel — local CLI cannot handle bursts well) and
 * invokes `onProgress` after each entity completes (or has been served
 * from cache).
 *
 * Returns the (entity, info) pairs in input order, including cached and
 * fallback entries so the caller always has one info per entity.
 */
export async function enrichEntities(
  entities: CodeEntity[],
  onProgress?: (current: number, total: number, entityName: string, info: SemanticInfo) => void,
): Promise<Array<{ entity: CodeEntity; info: SemanticInfo }>> {
  const out: Array<{ entity: CodeEntity; info: SemanticInfo }> = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    // eslint-disable-next-line no-await-in-loop
    const info = await enrichEntity(e);
    out.push({ entity: e, info });
    onProgress?.(i + 1, entities.length, e.name, info);
  }
  return out;
}

export { clip as clipForPrompt };
