// Maps an agent-graph node onto the most relevant code-graph entities and
// builds a Markdown-flavoured context snippet for the instruction prompt.

import type { AppNode } from '../../types';
import type { CodeEntity } from './codeGraph';
import type { CodeGraphSnapshot } from './codeGraphStore';
import { entitiesByKind } from './codeGraphStore';

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
      // Take first 4 tokens of the instruction for hint extraction.
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
  if (entity.kind === 'file' || entity.kind === 'module') return -1;
  const name = normalise(entity.name);
  let score = 0;
  for (const cand of candidates) {
    if (!cand) continue;
    if (name === cand) score += 10;
    else if (name.includes(cand) || cand.includes(name)) score += 4;
  }
  // De-prioritise tiny accessors (heuristic: short body).
  if (entity.bodySnippet && entity.bodySnippet.length < 80 && entity.kind === 'function') score -= 1;
  return score;
}

export interface CollectedContext {
  entityCount: number;
  markdown: string;
  entities: CodeEntity[];
}

export interface CollectOptions {
  /** Cap on returned snippets (default 5). */
  maxSnippets?: number;
}

export function collectContextForNode(
  node: AppNode,
  graph: CodeGraphSnapshot,
  options: CollectOptions = {},
): CollectedContext {
  const candidates = codeNameCandidates(node);
  const matched = Object.values(graph.entitiesById)
    .map((e) => ({ e, score: scoreEntity(e, candidates) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const maxSnippets = options.maxSnippets ?? 5;
  const picked = matched.slice(0, maxSnippets).map((m) => m.e);
  if (picked.length === 0) {
    return { entityCount: 0, markdown: '', entities: [] };
  }

  const lines: string[] = [
    `The user is documenting the **${node.type.replace('_', ' ')}** node labelled "${node.label}".`,
    `Found ${picked.length} matching code entity(ies) in the project:`,
    '',
  ];

  for (const e of picked) {
    lines.push(`### ${e.signature ?? `${e.kind} ${e.name}`}`);
    lines.push(`*File:* \`${e.filePath}\`${e.startLine !== undefined ? `, line ${e.startLine + 1}` : ''}`);
    if (e.docComment) {
      lines.push('', e.docComment);
    }
    if (e.bodySnippet) {
      lines.push('', '```' + (e.language === 'python' ? 'python' : e.language === 'javascript' || e.language === 'typescript' || e.language === 'tsx' ? 'ts' : ''), e.bodySnippet, '```');
    }
    lines.push('');
  }

  return {
    entityCount: picked.length,
    markdown: lines.join('\n'),
    entities: picked,
  };
}

export function graphNotEmpty(graph: CodeGraphSnapshot): boolean {
  return Object.keys(graph.entitiesById).length > 0;
}

export function summarise(graph: CodeGraphSnapshot): string {
  const byKind = entitiesByKind(graph);
  const parts: string[] = [];
  for (const [kind, n] of Object.entries(byKind)) {
    parts.push(`${n} ${kind}`);
  }
  return parts.join(', ');
}
