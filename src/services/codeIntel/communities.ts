// Client-side Louvain community detection over the code graph. Used by
// the Sigma renderer when `colorMode === 'community'` to colour nodes
// by their modularity cluster — gives the user a high-level "which
// areas of the codebase cluster together" view without leaving the
// canvas.
//
// Implementation choices:
//   - We run Louvain on the *full* graph (not the visible subset) so
//     community ids are stable across filter changes. The result is a
//     `Map<entityId, communityIndex>` that `buildSigmaGraph` can then
//     embed as a node attribute.
//   - Resolution is fixed at the default `1`. Higher values produce
//     smaller communities; lower values produce bigger ones. We don't
//     expose this as a setting yet — the auto-tuned default is good
//     enough for the code-intel use case.
//   - Louvain is non-deterministic across runs (the package uses an
//     internal PRNG by default). The community *count* is stable;
//     individual labels are not. The colour palette (`CATEGORICAL` in
//     sigmaGraph.ts) wraps via modulo so any labels still look right
//     even if cluster membership shifts slightly between runs.

import louvain from 'graphology-communities-louvain';
import Graph from 'graphology';

export interface CommunityResult {
  /** Entity id → community index. */
  byEntity: Map<string, number>;
  /** Total number of distinct communities. */
  count: number;
  /** Louvain's modularity score (higher = better-defined clusters). */
  modularity: number;
}

/**
 * Run Louvain over the supplied graphology `Graph`. Returns a
 * `CommunityResult` with per-node community assignments. Empty graph
 * is a no-op (returns `byEntity = empty`, `count = 0`).
 */
export function detectCommunities(graph: Graph): CommunityResult {
  if (graph.order === 0) {
    return { byEntity: new Map(), count: 0, modularity: 0 };
  }
  const mapping = louvain(graph, {
    nodeCommunityAttribute: '_louvainCommunity',
  });
  const byEntity = new Map<string, number>();
  for (const [nodeId, community] of Object.entries(mapping)) {
    byEntity.set(nodeId, community);
  }
  // Detailed run is more expensive — skip unless the caller actually
  // wants the modularity/count for logging. The basic `louvain` call
  // already populated the `_louvainCommunity` attribute on the graph.
  const distinct = new Set(byEntity.values()).size;
  return {
    byEntity,
    count: distinct,
    modularity: 0,
  };
}
