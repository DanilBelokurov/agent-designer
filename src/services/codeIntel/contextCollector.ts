// Maps an agent-graph node onto the most relevant entities from
// `.agent-graph/state.json` and builds a Markdown-flavoured context snippet
// for the instruction prompt.
//
// Async — enriches each picked entity through the local Qwen CLI (or its
// cache) before rendering. Calls are sequential and report progress via
// the optional `onProgress` callback.
//
// The Markdown block surfaces the new code-intel fields so the prompt
// grounds Qwen in:
//   - signature + body (ground truth),
//   - archetype (controller / service / repository / …) learned per
//     package or recovered from static heuristics,
//   - modifiers / annotations (Kotlin/Java style labels),
//   - semantic role + description (Qwen-derived).

import type { AppNode } from '../../types';
import type { AgentState, CodeEntity } from './types';
import type { SemanticInfo } from './types';
import { enrichEntities } from '../semanticEnricher';

const DEFAULT_LIMIT = 10;       // how many snippets land in the prompt
const RELEVANT_POOL_SIZE = 15;  // how many candidates to enrich

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
}

export interface CollectOptions {
  /** Cap on how many snippets end up in the rendered Markdown. */
  maxSnippets?: number;
  /** Cap on how many entities are sent to Qwen for enrichment. */
  enrichPoolSize?: number;
  /** Skip the enrichment step entirely (uses stored semantic fields or none). */
  skipEnrich?: boolean;
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
  const candidates = codeNameCandidates(node);

  const matched = state.entities
    .map((e) => ({ e, score: scoreEntity(e, candidates) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, poolSize);

  if (matched.length === 0) {
    return { entityCount: 0, markdown: '', entities: [] };
  }

  const entities = matched.map((m) => m.e);

  // Enrich sequentially via Qwen (or cache). Always returns one info per entity.
  const enriched = options.skipEnrich
    ? entities.map((e) => ({
        entity: e,
        info: {
          entityId: e.id,
          role: e.semanticRole ?? 'unknown',
          description: e.semanticDescription ?? 'Обогащение отключено',
          timestamp: 0,
        } satisfies SemanticInfo,
      }))
    : await enrichEntities(entities, options.onProgress);

  // Re-rank: bump entities that survived enrichment with a recognised role
  // and have a non-empty description.
  enriched.sort((a, b) => {
    const roleBonus = (info: SemanticInfo) =>
      info.role && info.role !== 'unknown' ? 5 : 0;
    const descBonus = (info: SemanticInfo) =>
      info.description && info.description.length > 5 ? 1 : 0;
    const scoreA = roleBonus(a.info) + descBonus(a.info);
    const scoreB = roleBonus(b.info) + descBonus(b.info);
    return scoreB - scoreA;
  });

  const picked = enriched.slice(0, maxSnippets);
  if (picked.length === 0) {
    return { entityCount: 0, markdown: '', entities: [] };
  }

  const lines: string[] = [
    `The user is documenting the **${node.type.replace('_', ' ')}** node labelled "${node.label}".`,
    `Found ${picked.length} code entity(ies) below, each annotated by a local Qwen call with role + short description, and tagged with the file's archetype (controller / service / repository / …) when known.`,
    '',
  ];

  for (const { entity, info } of picked) {
    lines.push(...renderEntityBlock(entity, info));
  }

  return {
    entityCount: picked.length,
    markdown: lines.join('\n'),
    entities: picked.map((x) => x.entity),
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