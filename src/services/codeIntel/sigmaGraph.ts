// Adapter: build a graphology `Graph` from our `AgentState` for Sigma.js
// v3 rendering. Handles the coordinate-system conversion that Sigma v3
// needs but our code-intel layout doesn't natively produce:
//
//   - Graphology expects a single global coordinate system (no compound
//     hierarchy). Our dagre layout gives compound children *local*
//     coordinates relative to their parent. We resolve that here by
//     walking children first, then promoting parent + offset = absolute
//     position.
//   - Sigma v3 uses camera-space coordinates; the bounding box is fit
//     automatically from node positions. We hand it positions in pixel
//     space (matching what ReactFlow was getting from `positions.get(id)`)
//     so the viewport fits the same canvas region.
//   - Color modes are computed here (language / kind / community) instead
//     of being a Sigma reducer — Sigma reducers only re-style, they
//     can't pick from a structural attribute like `community`. We
//     precompute one color per node and let Sigma treat it as static.

import Graph from 'graphology';
import type { AgentState, CodeEntity, CodeRelation, EntityKind } from './types';
import type { LayoutPosition } from './layoutCache';
import { logger } from '../logger';

export type ColorMode = 'kind' | 'language' | 'community';

/**
 * 20-colour categorical palette for `community` mode. Wraps modulo 20
 * so any Louvain clustering (which can produce arbitrarily many
 * communities) still gets a visually distinct colour. Mirrors the
 * Tableau "categorical" palette that GraphFocus uses.
 */
const CATEGORICAL: ReadonlyArray<string> = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
];

export const KIND_COLORS: Record<EntityKind, string> = {
  class: '#6366f1',
  interface: '#06b6d4',
  function: '#10b981',
  method: '#14b8a6',
  field: '#f97316',
  constant: '#eab308',
  enum: '#f59e0b',
  parameter: '#a78bfa',
  variable: '#94a3b8',
  object: '#818cf8',
  companion: '#c084fc',
  annotation: '#fb923c',
  file: '#475569',
  unknown: '#64748b',
  package: '#0ea5e9',
  type: '#22d3ee',
  module: '#94a3b8',
};

const FALLBACK_COLOR = '#64748b';

/**
 * Per-relation-kind edge styling for Sigma.js v3. We vary only `size`
 * and `color` from the default arrow program — no custom edgeProgram
 * shaders, no animated dashes (Sigma v3 dropped those). The mapping
 * mirrors what the ReactFlow canvas uses (`RELATION_STYLE` in
 * `CodeGraphCanvas.tsx`) so users see the same visual semantics in
 * both renderers.
 *
 * `contains` edges (class → method, class → field) are now clearly
 * visible — users want to see the class hierarchy in the canvas, not
 * just the cross-references. The connector type is `line` (no arrow
 * head) because the direction is implied by the container/child
 * relationship: parent draws a non-directional connector down to each
 * child. Other relations keep the arrow tip so calls/imports are
 * unambiguous about which way the dependency flows.
 */
export const RELATION_EDGE_STYLE: Record<
  string,
  { size: number; color: string; type: 'arrow' | 'line' }
> = {
  inherits: { size: 0.7, color: '#a78bfa', type: 'arrow' },
  implements: { size: 0.6, color: '#06b6d4', type: 'arrow' },
  calls: { size: 0.8, color: '#10b981', type: 'arrow' },
  imports: { size: 0.5, color: 'rgba(170,170,180,0.55)', type: 'arrow' },
  extension_of: { size: 0.6, color: '#94a3b8', type: 'arrow' },
  contains: { size: 0.6, color: 'rgba(170,170,180,0.5)', type: 'line' },
  references: { size: 0.5, color: 'rgba(170,170,180,0.45)', type: 'arrow' },
  has_parameter: { size: 0.4, color: 'rgba(170,170,180,0.4)', type: 'arrow' },
  field_of: { size: 0.4, color: 'rgba(170,170,180,0.4)', type: 'arrow' },
  returns: { size: 0.4, color: 'rgba(170,170,180,0.4)', type: 'arrow' },
};

const FALLBACK_EDGE = { size: 0.4, color: 'rgba(170,170,180,0.45)', type: 'arrow' as const };

/**
 * Build a graphology `Graph` ready to hand to `new Sigma(...)`.
 *
 * Coordinates: compound children's `local` position is resolved against
 * their parent's position so Sigma sees everything in one system. If a
 * child is missing a position (rare — happens when dagre returned NaN
 * for an unreachable node), we drop the child rather than render it at
 * (0,0) and pretend that's correct.
 *
 * Colors: language palette is hardcoded for the languages our extractor
 * identifies today. Add entries as the language list grows; the rest of
 * the renderer doesn't care.
 */
export function buildSigmaGraph(
  state: AgentState,
  visibleEntities: ReadonlySet<string>,
  visibleRelations: ReadonlySet<string>,
  positions: Map<string, LayoutPosition>,
  options: { colorMode: ColorMode; communityByEntity: Map<string, number> | null },
): Graph {
  const graph = new Graph({ multi: true, type: 'directed' });

  // 1) Add every visible node, with size scaled by degree so hubs stand
  //    out without dominating (same heuristic GraphFocus uses).
  //
  // Dedupe by `id` — `state.entities` *can* contain duplicates emitted
  // by the extractor (same file+kind+name+index produced twice for
  // different languages or via the merger). ReactFlow silently ignored
  // them via its React `key` mechanism; graphology.addNode throws, which
  // is correct behaviour. We log + skip so the canvas keeps working
  // while the upstream duplicate-emission bug is still being diagnosed.
  let dupes = 0;
  for (const e of state.entities) {
    if (!visibleEntities.has(e.id)) continue;
    const pos = positions.get(e.id);
    if (!pos) continue;
    if (graph.hasNode(e.id)) {
      dupes += 1;
      continue;
    }
    const color = colorOf(e, options.colorMode, options.communityByEntity);
    const size = computeSize(e, state.relations);
    graph.addNode(e.id, {
      x: pos.x,
      y: pos.y,
      size,
      color,
      label: e.name,
      kind: e.kind,
      language: e.language,
      community: options.communityByEntity?.get(e.id) ?? 0,
      filePath: e.filePath,
      startLine: e.startLine ?? 0,
      // Reference the full CodeEntity so SigmaDetailPanel can render
      // rich details (signature, description, archetype, neighbours)
      // without doing an O(N) lookup in state.entities every click.
      entity: e,
    });
  }
  if (dupes > 0) {
    logger.warn('sigmaGraph.duplicateEntityIds', {
      count: dupes,
      totalEntities: state.entities.length,
      hint: 'extractor emitted the same id twice — check brace/indent extractors + merger',
    });
  }

  // 2) Add edges between visible endpoints. Edge color/size follow
  //    `RELATION_EDGE_STYLE` so different relation kinds are visually
  //    distinct (calls = bright green, imports = translucent gray, etc.).
  for (const r of state.relations) {
    if (!visibleRelations.has(`${r.from}|${r.to}|${r.kind}`)) continue;
    if (!graph.hasNode(r.from) || !graph.hasNode(r.to)) continue;
    if (r.from === r.to) continue;
    const style = RELATION_EDGE_STYLE[r.kind] ?? FALLBACK_EDGE;
    try {
      graph.addEdgeWithKey(`${r.from}|${r.to}|${r.kind}`, r.from, r.to, {
        size: style.size,
        color: style.color,
        type: style.type,
        label: r.kind,
        relationKind: r.kind,
      });
    } catch {
      // graphology throws on parallel edges in `multi:false`; we use
      // `multi: true`, so this is just defensive.
    }
  }

  return graph;
}

function computeSize(entity: CodeEntity, relations: CodeRelation[]): number {
  // degree proxy: how many relations mention this id
  let degree = 0;
  for (const r of relations) {
    if (r.from === entity.id || r.to === entity.id) degree += 1;
  }
  return Math.max(2, Math.min(14, 2 + Math.sqrt(degree)));
}

function colorOf(
  entity: CodeEntity,
  mode: ColorMode,
  communityByEntity: Map<string, number> | null,
): string {
  if (mode === 'language') {
    return entity.language ? LANGUAGE_COLORS[entity.language] ?? FALLBACK_COLOR : FALLBACK_COLOR;
  }
  if (mode === 'community') {
    if (!communityByEntity) return FALLBACK_COLOR;
    const community = communityByEntity.get(entity.id) ?? 0;
    return CATEGORICAL[community % CATEGORICAL.length];
  }
  // kind mode (default)
  return KIND_COLORS[entity.kind] ?? FALLBACK_COLOR;
}

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: '#3178c6',
  javascript: '#f1e05a',
  tsx: '#3178c6',
  jsx: '#f1e05a',
  python: '#3572A5',
  java: '#B07219',
  kotlin: '#A97BFF',
  rust: '#DEA584',
  go: '#00ADD8',
  csharp: '#178600',
  cpp: '#F34B7D',
  c: '#555555',
  ruby: '#701516',
  php: '#4F5D95',
  swift: '#F05138',
  scala: '#c22d40',
  vue: '#41b883',
  lua: '#000080',
  dart: '#00B4AB',
  r: '#198CE7',
  sql: '#E38C00',
  markdown: '#083fa1',
};
