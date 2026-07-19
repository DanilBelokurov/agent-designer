// Maps an agent-graph node onto the most relevant entities from
// `.agent-graph/state.json` and builds a Markdown-flavoured context snippet
// for the instruction prompt.
//
// Two independent ranking passes feed the prompt:
//   1. **Exact / fuzzy name match** against `node.label` / `functionName`
//      — the original behaviour; works for skills named after the class
//      they wrap ("CreateUserSkill" → `CreateUserService`).
//   2. **Intent-based match** against the user's free-form request —
//      `intentSearch` extracts semantic tags like `rest-client` / `auth` /
//      `database` and matches entities by archetype + body/signature
//      signals. This is what makes "Architecture of the external REST-
//      interaction module" find the project's actual `RestClient`,
//      `HttpGateway`, `ExternalApiAdapter` instead of nothing.
//
// Each pass is rendered under its own Markdown heading so Qwen can tell
// `## Exact name match` (the primary anchor for `## Examples`) from
// `## Discovered by intent` (additional context the user asked for).
// When neither pass finds anything we fall back to a small set of the
// project's top-level entities so the generator still has real code to
// ground `## Examples` in.
//
// Async — enriches each picked entity through the local Qwen CLI (or its
// cache) before rendering. Calls are sequential and report progress via
// the optional `onProgress` callback.

import type { AppNode } from '../../types';
import type { AgentState, CodeEntity } from './types';
import type { SemanticInfo } from './types';
import { enrichEntitiesContext } from '../semanticEnricher';
import {
  findEntitiesForRequest,
  type Intent,
} from './intentSearch';

const DEFAULT_LIMIT = 10;       // how many snippets land in the prompt
const RELEVANT_POOL_SIZE = 15;  // how many candidates to enrich
const INTENT_LIMIT = 8;        // how many intent matches land in the prompt
const FALLBACK_LIMIT = 5;      // when neither pass finds anything, surface a few top entities by description length

/**
 * Pick the anchor name we expect the user's request to be about: skill's
 * `functionName` if set, otherwise the raw label. Mirrors the helper of
 * the same name in `instructionGenerator.ts` — kept duplicated here so
 * the context collector doesn't depend on the prompt builder.
 */
function anchorNameFor(node: AppNode): string {
  if (node.type === 'skill') {
    const cfg = node.config as { functionName?: string };
    if (cfg.functionName) return cfg.functionName;
  }
  return node.label;
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function codeNameCandidates(node: AppNode): string[] {
  const out = new Set<string>();
  if (node.label) out.add(normalise(node.label));
  if (node.type === 'skill') {
    const cfg = node.config as { functionName?: string; description?: string };
    if (cfg.functionName) out.add(normalise(cfg.functionName));
  } else {
    const cfg = node.config as { instructions?: string };
    if (cfg.instructions) {
      const tokens = cfg.instructions
        .split(/\s+/)
        .slice(0, 6)
        .filter((t) => /^[a-zA-Zа-яА-ЯёЁ_][\w]*$/.test(t))
        .map(normalise);
      for (const t of tokens) out.add(t);
    }
  }
  return [...out].filter(Boolean);
}

function scoreEntity(entity: CodeEntity, candidates: string[]): number {
  if (entity.kind === 'file' || entity.kind === 'unknown') return -1;
  const name = normalise(entity.name);
  let score = 0;
  for (const cand of candidates) {
    if (!cand) continue;
    if (name === cand) score += 10;
    else if (name.includes(cand) || cand.includes(name)) score += 4;
  }
  if (entity.bodySnippet && entity.bodySnippet.length < 80 && entity.kind === 'function') score -= 1;
  return score;
}

export interface CollectedContext {
  entityCount: number;
  markdown: string;
  entities: CodeEntity[];
  /** Which intent tags were recognised from the user's request (empty = none). */
  intents: Intent[];
  /** Which ranking pass produced the snippets — surfaced in the UI hint. */
  source: 'exact-name' | 'intent' | 'fallback' | 'none';
}

export interface CollectOptions {
  /** Cap on how many snippets end up in the rendered Markdown. */
  maxSnippets?: number;
  /** Cap on how many entities are sent to Qwen for enrichment. */
  enrichPoolSize?: number;
  /** Cap on how many intent-based matches land in the rendered Markdown. */
  intentLimit?: number;
  /**
   * Skip the enrichment step entirely (uses stored semantic fields or none).
   */
  skipEnrich?: boolean;
  /** Qwen model id forwarded to enrichEntityContext. */
  model?: string;
  /**
   * User-supplied free-form request text. When present, intent search
   * runs against it AND the node label/description so skills with
   * abstract names ("Architecture of the external REST module") can
   * still find concrete entities.
   */
  userRequest?: string;
  onProgress?: (current: number, total: number, entityName: string, info: SemanticInfo) => void;
}

function languageTag(lang: string | undefined): string {
  if (!lang) return '';
  switch (lang) {
    case 'python':
      return 'python';
    case 'kotlin':
    case 'java':
    case 'scala':
    case 'groovy':
      return lang;
    case 'csharp':
      return 'csharp';
    case 'go':
      return 'go';
    case 'rust':
      return 'rust';
    case 'ruby':
      return 'ruby';
    case 'javascript':
      return 'javascript';
    case 'tsx':
      return 'tsx';
    case 'typescript':
      return 'ts';
    default:
      return '';
  }
}

function renderEntityBlock(entity: CodeEntity, info: SemanticInfo): string[] {
  const lines: string[] = [];
  lines.push(`### ${entity.signature ?? `${entity.kind} ${entity.name}`}`);

  if (entity.archetype) {
    lines.push(`- **Archetype:** \`${entity.archetype}\`${entity.archetypeConfidence ? ` (${entity.archetypeConfidence})` : ''}`);
  }
  lines.push(`- **Semantic role:** \`${info.role}\``);
  lines.push(`- **Summary:** ${info.description || '(no description)'}`);
  if (info.purpose) {
    lines.push(`- **Purpose:** ${info.purpose}`);
  }
  if (info.usedBy) {
    lines.push(`- **Used by:** ${info.usedBy}`);
  }
  if (info.dependsOn) {
    lines.push(`- **Depends on:** ${info.dependsOn}`);
  }

  if (entity.modifiers && entity.modifiers.length) {
    lines.push(`- **Modifiers:** \`${entity.modifiers.join(' ')}\``);
  }
  if (entity.annotations && entity.annotations.length) {
    lines.push(`- **Annotations:** ${entity.annotations.map((a) => '`' + a + '`').join(' ')}`);
  }

  lines.push(`- **File:** \`${entity.filePath}\`${entity.startLine !== undefined ? `, line ${entity.startLine + 1}` : ''}`);
  if (entity.docComment) {
    lines.push(`- **Doc comment:**`);
    lines.push(`  ${entity.docComment.replace(/\n/g, '\n  ')}`);
  }
  if (entity.bodySnippet) {
    const tag = languageTag(entity.language);
    lines.push('');
    if (tag) lines.push('```' + tag, entity.bodySnippet, '```');
    else lines.push('```', entity.bodySnippet, '```');
  }
  lines.push('');
  return lines;
}

export async function collectContextForNode(
  node: AppNode,
  state: AgentState,
  options: CollectOptions = {},
): Promise<CollectedContext> {
  const maxSnippets = options.maxSnippets ?? DEFAULT_LIMIT;
  const poolSize = options.enrichPoolSize ?? RELEVANT_POOL_SIZE;
  const intentLimit = options.intentLimit ?? INTENT_LIMIT;
  const candidates = codeNameCandidates(node);

  // -------- Pass 1: exact / fuzzy name match --------
  const nameMatched = state.entities
    .map((e) => ({ e, score: scoreEntity(e, candidates) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, poolSize);

  // -------- Pass 2: intent-based match against the user's request --------
  // We feed intent search both the user request AND the node's own
  // label/description so even an empty textarea benefits from the
  // well-named skill ("ExternalRestSkill" → rest-client intent).
  const intentInput = [options.userRequest ?? '', node.label]
    .concat(node.type === 'skill' ? [(node.config as { description?: string }).description ?? ''] : [])
    .join('\n');
  const { intents, matches: intentMatched } = findEntitiesForRequest(intentInput, state.entities, {
    limit: intentLimit,
  });

  // De-dupe: anything already surfaced by exact-name pass is dropped from
  // the intent list so the user doesn't see the same snippet twice.
  const nameIds = new Set(nameMatched.map((m) => m.e.id));
  const intentOnly = intentMatched.filter((m) => !nameIds.has(m.entity.id));

  // -------- Pass 3: fallback when neither pass found anything --------
  // We surface top-level (no parent) entities with the longest Qwen
  // description so the generator at least has *some* real code to
  // ground `## Examples` in.
  const needsFallback = nameMatched.length === 0 && intentOnly.length === 0;
  let fallbackEntities: CodeEntity[] = [];
  let detectedIntents: Intent[] = intents;
  let source: CollectedContext['source'] = 'none';
  if (needsFallback) {
    fallbackEntities = state.entities
      .filter((e) => e.kind !== 'file' && e.kind !== 'unknown')
      .filter((e) => !e.parentId)
      .sort((a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0))
      .slice(0, FALLBACK_LIMIT);
    if (fallbackEntities.length > 0) source = 'fallback';
  } else if (nameMatched.length > 0) {
    source = 'exact-name';
  } else {
    source = 'intent';
  }

  if (nameMatched.length === 0 && intentOnly.length === 0 && fallbackEntities.length === 0) {
    return { entityCount: 0, markdown: '', entities: [], intents: detectedIntents, source: 'none' };
  }

  // Enrich the union. Cap the total to keep Qwen call count sane.
  const allForEnrich: CodeEntity[] = [
    ...nameMatched.map((m) => m.e),
    ...intentOnly.map((m) => m.entity),
    ...fallbackEntities,
  ].slice(0, poolSize);

  const enriched = options.skipEnrich
    ? allForEnrich.map((e) => ({
        entity: e,
        info: {
          entityId: e.id,
          role: e.semanticRole ?? 'unknown',
          description: e.semanticDescription ?? 'Обогащение отключено',
          timestamp: 0,
        } satisfies SemanticInfo,
      }))
    : await enrichEntitiesContext(allForEnrich, state, options.onProgress, { model: options.model });

  // Build lookup by entity id so each section picks up the enriched info
  // for its own entities.
  const infoById = new Map(enriched.map((x) => [x.entity.id, x.info]));

  // Re-rank each section independently: within a section, bump entities
  // that survived enrichment with a recognised role + non-empty description.
  function rerank<T extends { entity: CodeEntity }>(items: T[]): T[] {
    const scored = items.map((x) => {
      const info = infoById.get(x.entity.id);
      const roleBonus = info && info.role && info.role !== 'unknown' ? 5 : 0;
      const descBonus = info && info.description && info.description.length > 5 ? 1 : 0;
      return { x, score: roleBonus + descBonus };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.x);
  }
  const namePicked = rerank(nameMatched.map((m) => ({ entity: m.e }))).slice(0, maxSnippets);
  const intentPicked = rerank(intentOnly.map((m) => ({ entity: m.entity, match: m }))).slice(0, intentLimit);
  const fallbackPicked = rerank(fallbackEntities.map((e) => ({ entity: e }))).slice(0, FALLBACK_LIMIT);

  const lines: string[] = [
    `The user is documenting the **${node.type.replace('_', ' ')}** node labelled "${node.label}".`,
  ];

  if (detectedIntents.length > 0) {
    lines.push(
      `Recognised user intent: ${detectedIntents.map((i) => `\`${i.id}\` (${i.label})`).join(', ')}.`,
      '',
    );
  } else {
    lines.push('');
  }

  if (namePicked.length > 0) {
    lines.push(
      `### Exact name match (primary anchor for \`## Examples\`)`,
      `Found ${namePicked.length} entity(ies) whose name matches \`${anchorNameFor(node)}\`. These are the strongest candidates — anchor the skill's examples on them.`,
      '',
    );
    for (const { entity } of namePicked) {
      const info = infoById.get(entity.id)!;
      lines.push(...renderEntityBlock(entity, info));
    }
  }

  if (intentPicked.length > 0) {
    lines.push(
      `### Discovered by intent (additional \`## Examples\` candidates)`,
      `Found ${intentPicked.length} entity(ies) matching the recognised intent(s) above. Use their bodies for additional concrete examples that cover the user's described behaviour.`,
      '',
    );
    for (const { entity, match } of intentPicked) {
      const info = infoById.get(entity.id)!;
      lines.push(`**Intent match:** \`${match.intent}\` (score ${match.score})`);
      lines.push(...renderEntityBlock(entity, info));
    }
  }

  if (namePicked.length === 0 && intentPicked.length === 0 && fallbackPicked.length > 0) {
    lines.push(
      `### No exact or intent match found — top-level entities by description depth`,
      `Neither the node name nor the user request matched specific entities in the code graph. ` +
        `The ${fallbackPicked.length} entity(ies) below are surfaced as a fallback — pick whichever ` +
        `best fits the user's request and ground \`## Examples\` in them.`,
      '',
    );
    for (const { entity } of fallbackPicked) {
      const info = infoById.get(entity.id)!;
      lines.push(...renderEntityBlock(entity, info));
    }
  }

  const allEntities = [
    ...namePicked.map((x) => x.entity),
    ...intentPicked.map((x) => x.entity),
    ...fallbackPicked.map((x) => x.entity),
  ];

  return {
    entityCount: allEntities.length,
    markdown: lines.join('\n'),
    entities: allEntities,
    intents: detectedIntents,
    source,
  };
}

export function graphNotEmpty(state: AgentState | null): boolean {
  return !!state && state.entities.length > 0;
}

export function summarise(state: AgentState | null): string {
  if (!state) return '';
  const parts: string[] = [];
  for (const [kind, n] of Object.entries(state.stats.byKind)) {
    parts.push(`${n} ${kind}`);
  }
  return parts.join(', ');
}