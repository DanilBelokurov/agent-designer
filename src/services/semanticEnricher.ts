// Per-entity semantic enrichment via the local Qwen CLI.
//
// Two flavours:
//   - `enrichEntity(entity)` — single-entity prompt (signature + body only).
//     Used as a cheap fallback / legacy path.
//   - `enrichEntityContext(entity, state)` — full-context prompt that also
//     passes the entity's incoming & outgoing relations so Qwen can answer
//     the WHY (purpose), the WHO (usedBy), and the WHAT (dependsOn)
//     questions alongside role + description.

import { generateViaQwen, QwenUnavailableError } from './qwenClient';
import { semanticCache, type SemanticInfo } from './semanticCache';
import type { AgentState, CodeEntity, CodeRelation } from './codeIntel/types';

const BODY_MAX = 2000;
const DESCRIPTION_MAX = 100;
const PURPOSE_MAX = 200;
const USED_BY_MAX = 160;
const DEPENDS_ON_MAX = 160;

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
  return 'unknown';
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function shortName(id: string): string {
  // entity ids look like `path/to/File.kt::class::Name::12` — return just `Name`.
  const parts = id.split('::');
  return parts[parts.length - 2] ?? parts[parts.length - 1] ?? id;
}

interface RelationContext {
  /** Where this entity is the source (this entity → something). */
  outgoing: CodeRelation[];
  /** Where this entity is the target (something → this entity). */
  incoming: CodeRelation[];
}

function collectRelationContext(entityId: string, state: AgentState): RelationContext {
  const outgoing: CodeRelation[] = [];
  const incoming: CodeRelation[] = [];
  for (const r of state.relations) {
    if (r.from === entityId) outgoing.push(r);
    if (r.to === entityId) incoming.push(r);
  }
  return { outgoing, incoming };
}

function nameOf(entityId: string, state: AgentState): string {
  const e = state.entities.find((x) => x.id === entityId);
  return e?.name ?? shortName(entityId);
}

function renderRelationContext(ctx: RelationContext, state: AgentState): string {
  if (ctx.incoming.length === 0 && ctx.outgoing.length === 0) return '(нет связей)';
  const lines: string[] = [];
  if (ctx.incoming.length > 0) {
    lines.push('Входящие связи (кто ссылается на эту сущность):');
    for (const r of ctx.incoming.slice(0, 12)) {
      lines.push(`  - ${r.kind} ← ${nameOf(r.from, state)}`);
    }
    if (ctx.incoming.length > 12) lines.push(`  … и ещё ${ctx.incoming.length - 12}`);
  }
  if (ctx.outgoing.length > 0) {
    lines.push('Исходящие связи (на что ссылается эта сущность):');
    for (const r of ctx.outgoing.slice(0, 12)) {
      lines.push(`  - ${r.kind} → ${nameOf(r.to, state)}`);
    }
    if (ctx.outgoing.length > 12) lines.push(`  … и ещё ${ctx.outgoing.length - 12}`);
  }
  return lines.join('\n');
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
    docBlock,
    '',
    'Ответь строго в формате:',
    'РОЛЬ: <одно слово из списка: controller, service, repository, factory, adapter, configuration, entity, dto, mapper, handler, validator, utility, middleware, guard, filter, resolver, provider, helper, composable, hook, unknown>',
    `ОПИСАНИЕ: <краткое описание до ${DESCRIPTION_MAX} символов>`,
    '',
    'Не добавляй лишнего текста, заголовков или пояснений.',
  ].join('\n');
}

function buildContextualPrompt(entity: CodeEntity, state: AgentState, ctx: RelationContext): string {
  const body = entity.bodySnippet ? clip(entity.bodySnippet, BODY_MAX) : '(нет тела)';
  const docBlock = entity.docComment ? `Документация:\n${entity.docComment}\n` : '';
  const relationBlock = renderRelationContext(ctx, state);

  return [
    'Ты — эксперт по анализу кода. Определи роль этой сущности И её место в проекте.',
    '',
    '## Сущность',
    `Имя: ${entity.name}`,
    `Тип: ${entity.kind}`,
    `Сигнатура: ${entity.signature ?? '(нет)'}`,
    entity.archetype ? `Архетип: ${entity.archetype}` : '',
    'Тело (сокращённое):',
    '```',
    body,
    '```',
    docBlock,
    '',
    '## Связи в графе кода',
    relationBlock,
    '',
    '## Что нужно выяснить',
    '1. Какую роль она выполняет в проекте (controller/service/repository/...)',
    '2. ЗАЧЕМ она существует (purpose) — какую задачу решает',
    '3. КТО её использует (usedBy) — кем вызывается / наследуется / реализуется',
    '4. ОТ ЧЕГО она зависит (dependsOn) — какие другие сущности ей нужны',
    '',
    '## Формат ответа (строго)',
    'РОЛЬ: <одно слово из списка: controller, service, repository, factory, adapter, configuration, entity, dto, mapper, handler, validator, utility, middleware, guard, filter, resolver, provider, helper, composable, hook, unknown>',
    `ОПИСАНИЕ: <краткое описание до ${DESCRIPTION_MAX} символов>`,
    `НАЗНАЧЕНИЕ: <зачем эта сущность в проекте, до ${PURPOSE_MAX} символов>`,
    `ИСПОЛЬЗУЕТСЯ_КЕМ: <кратко кто её вызывает/наследует, до ${USED_BY_MAX} символов; "не используется" если связей нет>`,
    `ЗАВИСИТ_ОТ: <кратко какие другие сущности/типы она использует, до ${DEPENDS_ON_MAX} символов; "нет зависимостей" если связей нет>`,
    '',
    'Не добавляй ничего сверх указанных полей.',
  ].filter(Boolean).join('\n');
}

interface ParsedSemantic {
  role: string;
  description: string;
  purpose?: string;
  usedBy?: string;
  dependsOn?: string;
}

function parseSemanticResponse(raw: string): ParsedSemantic {
  let role = 'unknown';
  let description = '';
  let purpose: string | undefined;
  let usedBy: string | undefined;
  let dependsOn: string | undefined;

  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    const mRole = t.match(/^(?:РОЛЬ|ROLE)\s*:\s*(.+?)\s*$/i);
    if (mRole) { role = normaliseRole(mRole[1]); continue; }
    const mDesc = t.match(/^(?:ОПИСАНИЕ|DESCRIPTION)\s*:\s*(.+?)\s*$/i);
    if (mDesc) { description = clip(mDesc[1], DESCRIPTION_MAX); continue; }
    const mPurpose = t.match(/^(?:НАЗНАЧЕНИЕ|PURPOSE)\s*:\s*(.+?)\s*$/i);
    if (mPurpose) { purpose = clip(mPurpose[1], PURPOSE_MAX); continue; }
    const mUsed = t.match(/^(?:ИСПОЛЬЗУЕТСЯ_КЕМ|USED_BY|USED BY)\s*:\s*(.+?)\s*$/i);
    if (mUsed) { usedBy = clip(mUsed[1], USED_BY_MAX); continue; }
    const mDep = t.match(/^(?:ЗАВИСИТ_ОТ|DEPENDS_ON|DEPENDS ON)\s*:\s*(.+?)\s*$/i);
    if (mDep) { dependsOn = clip(mDep[1], DEPENDS_ON_MAX); continue; }
  }
  return { role, description, purpose, usedBy, dependsOn };
}

function fallbackInfo(entityId: string, reason: string): SemanticInfo {
  return {
    entityId,
    role: 'unknown',
    description: clip(reason, DESCRIPTION_MAX),
    timestamp: Date.now(),
  };
}

/** Backwards-compatible single-entity enrichment (no relation context). */
export async function enrichEntity(entity: CodeEntity): Promise<SemanticInfo> {
  const cached = await semanticCache.get(entity.id);
  if (cached) return cached;

  const prompt = buildEnrichmentPrompt(entity);
  let raw: string;
  try {
    raw = await generateViaQwen(prompt);
  } catch (err) {
    const reason = err instanceof QwenUnavailableError ? err.message : `qwen call failed: ${String(err)}`;
    const fallback = fallbackInfo(entity.id, reason);
    await semanticCache.set(fallback);
    return fallback;
  }

  const parsed = parseSemanticResponse(raw);
  const info: SemanticInfo = {
    entityId: entity.id,
    role: parsed.role,
    description: parsed.description || 'Не удалось распарсить ответ Qwen',
    timestamp: Date.now(),
  };
  await semanticCache.set(info);
  return info;
}

/**
 * Contextual enrichment: passes the entity's incoming & outgoing relations
 * to Qwen so it can answer role + description + purpose + usedBy + dependsOn.
 * If `state` is null we fall back to the simple `enrichEntity` flow.
 */
export async function enrichEntityContext(
  entity: CodeEntity,
  state: AgentState | null,
): Promise<SemanticInfo> {
  const cached = await semanticCache.get(entity.id);
  // We only reuse the cache if it already has the contextual fields —
  // older cache entries from `enrichEntity` lack purpose/usedBy/dependsOn.
  if (cached && (cached.purpose || cached.usedBy || cached.dependsOn)) {
    return cached;
  }

  if (!state) return enrichEntity(entity);

  const ctx = collectRelationContext(entity.id, state);
  const prompt = buildContextualPrompt(entity, state, ctx);
  let raw: string;
  try {
    raw = await generateViaQwen(prompt);
  } catch (err) {
    const reason = err instanceof QwenUnavailableError ? err.message : `qwen call failed: ${String(err)}`;
    const fallback = fallbackInfo(entity.id, reason);
    await semanticCache.set(fallback);
    return fallback;
  }

  const parsed = parseSemanticResponse(raw);
  const info: SemanticInfo = {
    entityId: entity.id,
    role: parsed.role,
    description: parsed.description || 'Не удалось распарсить ответ Qwen',
    purpose: parsed.purpose,
    usedBy: parsed.usedBy,
    dependsOn: parsed.dependsOn,
    timestamp: Date.now(),
  };
  await semanticCache.set(info);
  return info;
}

/**
 * Sequential enrichment of multiple entities using the contextual prompt.
 * The caller passes the full `AgentState` so Qwen sees incoming/outgoing
 * relations for each entity.
 */
export async function enrichEntitiesContext(
  entities: CodeEntity[],
  state: AgentState,
  onProgress?: (current: number, total: number, entityName: string, info: SemanticInfo) => void,
): Promise<Array<{ entity: CodeEntity; info: SemanticInfo }>> {
  const out: Array<{ entity: CodeEntity; info: SemanticInfo }> = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    // eslint-disable-next-line no-await-in-loop
    const info = await enrichEntityContext(e, state);
    out.push({ entity: e, info });
    onProgress?.(i + 1, entities.length, e.name, info);
  }
  return out;
}

/** Sequential enrichment (legacy path — no relation context). */
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