// Dagre-based layout computation for the code-intel graph. Extracted from
// `CodeGraphCanvas.tsx` so the same engine can run both:
//   - in the canvas (fallback path, when no cache is available),
//   - server-side during `analyzeProject`, where its result is persisted
//     to `.agent-graph/layout.json` and replayed on every subsequent open.
//
// `computeLayoutPositions` always operates on the *full* graph — no
// filters, all compounds expanded. The UI then applies filters / collapse
// on top of the cached positions, which is valid because those UI steps
// hide nodes but don't change the relative topology of what's visible.
//
// ## Why no dagre `compound: true`?
//
// We tried using dagre's compound mode (via `g.setParent`) and feeding
// positions straight to ReactFlow's `parentNode + extent:'parent'` — but
// the two coordinate systems don't compose cleanly:
//   - dagre compound mode returns *absolute* coordinates for every node
//     (including children), already offset by the parent's position.
//   - ReactFlow treats the `position` of a node with `parentNode` as a
//     *local* coordinate relative to the parent.
//
// Feeding absolute dagre coordinates into ReactFlow as local ones puts
// every method at world-coords (~its parent's center, far away) instead
// of (0, 0) inside the parent — visible as a pile of overlapping
// children stacked on top of the container.
//
// Workaround: run dagre without `compound: true`, treating every entity
// as a top-level node (relations still pull containers and their members
// together because we keep the `contains` edges). After layout, convert
// each compound child's position from absolute to local by subtracting
// its parent's position. Top-level entities (no parent or file/unknown
// parent) keep their absolute coordinates — those flow straight into
// ReactFlow without a `parentNode`.
//
// This keeps the layout faithful to the original graph structure while
// letting ReactFlow's compound-node mechanism place children inside
// containers without fighting the canvas renderer.

import * as dagre from 'dagre';
import type { CodeEntity, CodeRelation, EntityKind } from './types';
import type { LayoutPosition } from './layoutCache';
import { logger } from '../logger';

const STANDALONE_W = 220;
const STANDALONE_H = 64;
const COMPOUND_W = 280;
const COMPOUND_H = 88;
const DAGRE_NODE_SEP = 60;
const DAGRE_EDGE_SEP = 20;
const DAGRE_RANK_SEP = 90;

const CONTAINER_KINDS: ReadonlySet<EntityKind> = new Set([
  'class', 'interface', 'enum', 'object', 'companion',
]);

/**
 * Compute top-left positions for every entity in the graph.
 *
 * - Top-level entities (no parent, or file/unknown parent) get absolute
 *   coordinates in ReactFlow world space.
 * - Compound children (parent is a container kind) get *local*
 *   coordinates relative to their parent — this is the form ReactFlow's
 *   `parentNode + extent:'parent'` expects.
 *
 * Multi-edges between the same pair of nodes are supported (dagre's
 * `multigraph` mode); self-loops are skipped.
 */
export function computeLayoutPositions(
  entities: CodeEntity[],
  relations: CodeRelation[],
): Map<string, LayoutPosition> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: 'TB',
    nodesep: DAGRE_NODE_SEP,
    edgesep: DAGRE_EDGE_SEP,
    ranksep: DAGRE_RANK_SEP,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const entityById = new Map<string, CodeEntity>();
  for (const e of entities) entityById.set(e.id, e);

  for (const e of entities) {
    const isContainer = CONTAINER_KINDS.has(e.kind);
    g.setNode(e.id, {
      width: isContainer ? COMPOUND_W : STANDALONE_W,
      height: isContainer ? COMPOUND_H : STANDALONE_H,
    });
  }

  for (const r of relations) {
    if (r.from === r.to) continue;
    if (!entityById.has(r.from) || !entityById.has(r.to)) continue;
    try {
      g.setEdge(r.from, r.to, { className: r.kind }, r.kind);
    } catch { /* skip invalid edges */ }
  }

  try {
    dagre.layout(g);
  } catch (err) {
    logger.warn('layout.dagre.failed', { message: err instanceof Error ? err.message : String(err) });
  }

  // First pass: collect absolute top-left positions for every node that
  // dagre actually laid out. Some nodes (e.g. unreachable from the root
  // component) may not get a position — they default to (0, 0).
  const absolute = new Map<string, LayoutPosition>();
  for (const e of entities) {
    const n = g.node(e.id);
    if (!n) {
      absolute.set(e.id, { x: 0, y: 0 });
      continue;
    }
    const w = n.width ?? STANDALONE_W;
    const h = n.height ?? STANDALONE_H;
    absolute.set(e.id, { x: n.x - w / 2, y: n.y - h / 2 });
  }

  // Second pass: convert compound children to local coordinates relative
  // to their parent. Children of non-container parents (file / unknown)
  // keep absolute coords — the canvas only renders them with `parentNode`
  // when the parent itself is a rendered container.
  const positions = new Map<string, LayoutPosition>();
  for (const e of entities) {
    const pos = absolute.get(e.id) ?? { x: 0, y: 0 };
    if (
      e.parentId
      && entityById.has(e.parentId)
      && CONTAINER_KINDS.has(entityById.get(e.parentId)!.kind)
    ) {
      const parentPos = absolute.get(e.parentId) ?? { x: 0, y: 0 };
      positions.set(e.id, {
        x: pos.x - parentPos.x,
        y: pos.y - parentPos.y,
      });
    } else {
      positions.set(e.id, pos);
    }
  }

  return positions;
}

/**
 * Convenience wrapper for `LayoutCache.positions` (plain object form).
 */
export function computeLayoutPositionsAsRecord(
  entities: CodeEntity[],
  relations: CodeRelation[],
): Record<string, LayoutPosition> {
  const map = computeLayoutPositions(entities, relations);
  const out: Record<string, LayoutPosition> = {};
  for (const [id, pos] of map) out[id] = pos;
  return out;
}
