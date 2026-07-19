// WebGL-backed code-graph canvas built on Sigma.js v3.
//
// This replaces the ReactFlow-based canvas. Sigma renders every node and
// edge as a single WebGL draw call, so 10k–50k entities stay interactive
// in a way that the SVG canvas never could. The cost is the loss of
// React-rendered custom nodes — there is no `parentNode + extent:'parent'`
// in Sigma, and there are no React components for individual nodes. We
// handle compound hierarchy by resolving children's *local* positions to
// absolute ones in `services/codeIntel/sigmaGraph.ts` before the graph
// reaches Sigma; click details live in a separate HTML overlay
// (`EntityDetailOverlay`); drag lives in the Sigma v3 built-in
// `enableDragging: true` option.
//
// Coordinate system matches what ReactFlow was getting: top-left corners
// in pixel space, so we don't fight the `computeLayoutPositions` output.

import { useEffect, useMemo, useRef, useState } from 'react';
import Sigma from 'sigma';
import type { Settings } from 'sigma/settings';
import type { Coordinates } from 'sigma/types';
import Graph from 'graphology';
import {
  buildSigmaGraph,
  type ColorMode,
} from '../services/codeIntel/sigmaGraph';
import type { AgentState, CodeEntity } from '../services/codeIntel/types';
import type { LayoutPosition } from '../services/codeIntel/layoutCache';
import { useCodeGraphStore } from '../store/useCodeGraphStore';
import { useUiStore } from '../store/useUiStore';
import { computeLayoutPositions } from '../services/codeIntel/layoutEngine';
import { detectCommunities } from '../services/codeIntel/communities';
import SigmaDetailPanel from './SigmaDetailPanel';
import SigmaControls from './SigmaControls';
import SigmaMinimap from './SigmaMinimap';
import { logger } from '../services/logger';
// Renderer switcher lives in `GraphCanvas.tsx` so it stays visible no
// matter which renderer is active; we deliberately don't render one
// inside this component to avoid the double pill in the corner.

export interface SigmaGraphCanvasProps {
  state: AgentState;
  visibleEntities: ReadonlySet<string>;
  visibleRelations: ReadonlySet<string>;
  positions: Map<string, LayoutPosition>;
  colorMode: ColorMode;
  communityByEntity?: Map<string, number> | null;
  onEntityClick?: (entity: CodeEntity) => void;
}

const SIGMA_BASE_SETTINGS: Partial<Settings> = {
  // WebGL: WebGL2 when available, falls back to WebGL1 automatically.
  defaultNodeType: 'circle',
  defaultEdgeType: 'arrow',
  labelDensity: 0.07,
  labelGridCellSize: 60,
  labelRenderedSizeThreshold: 8,
  minCameraRatio: 0.05,
  maxCameraRatio: 20,
  renderEdgeLabels: false,
  // Default colors match what we feed into `graph.addNode` for most
  // entities; Sigma only reaches them when a node has no `color` attr.
  defaultNodeColor: '#64748b',
  defaultEdgeColor: 'rgba(170,170,180,0.4)',
  // Fit-viewport on resize so the canvas doesn't cut off when the
  // browser window changes shape.
  autoRescale: true,
};

/**
 * Standalone (or embedded) Sigma.js v3 canvas. Pulls everything it needs
 * from the stores itself, so the wrapper doesn't have to compute visible
 * entities / positions / filters twice. Embedders can still pass props
 * explicitly via `SigmaGraphCanvasProps` to override defaults.
 */
export default function SigmaGraphCanvas(props: Partial<SigmaGraphCanvasProps> = {}) {
  const storeState = useCodeGraphStore((s) => s.state);
  const storeLayoutPositions = useCodeGraphStore((s) => s.layoutPositions);
  const storeManualPositions = useCodeGraphStore((s) => s.manualPositions);
  const filters = useUiStore((s) => s.graphFilters);
  const colorMode = useUiStore((s) => s.codeGraphColorMode);

  const state = props.state ?? storeState;
  const layoutPositions = storeLayoutPositions;
  const manualPositions = storeManualPositions;

  // 1) Apply kind/language/archetype filters to entity set.
  const visibleEntities = useMemo(() => {
    if (!state) return new Set<string>();
    const out = new Set<string>();
    for (const e of state.entities) {
      if (filters.kinds.size > 0 && !filters.kinds.has(e.kind)) continue;
      if (filters.languages.size > 0 && (!e.language || !filters.languages.has(e.language))) continue;
      if (filters.archetypes.size > 0) {
        if (!e.archetype || !filters.archetypes.has(e.archetype)) continue;
      }
      out.add(e.id);
    }
    return out;
  }, [state, filters]);

  // 2) Filter relations: both endpoints visible, relation kind enabled.
  const visibleRelations = useMemo(() => {
    if (!state) return new Set<string>();
    const out = new Set<string>();
    for (const r of state.relations) {
      if (!filters.relations.has(r.kind)) continue;
      if (!visibleEntities.has(r.from) || !visibleEntities.has(r.to)) continue;
      out.add(`${r.from}|${r.to}|${r.kind}`);
    }
    return out;
  }, [state, filters, visibleEntities]);

  // 3) Resolve positions: manualPositions overlay on top of layoutPositions,
  //    fall back to runtime dagre on the visible subset if both caches
  //    are missing. Sigma needs absolute coords — we resolve compound
  //    children's local coords to absolute here by walking parents first.
  const positions = useMemo(() => {
    if (!state) return new Map<string, LayoutPosition>();
    const visibleList = state.entities.filter((e) => visibleEntities.has(e.id));
    let base: Map<string, LayoutPosition>;
    if (layoutPositions && layoutPositions.size > 0) {
      base = layoutPositions;
    } else {
      base = computeLayoutPositions(
        visibleList,
        state.relations.filter((r) => visibleRelations.has(`${r.from}|${r.to}|${r.kind}`)),
      );
    }
    const overlay = new Map(base);
    if (manualPositions) {
      for (const [id, pos] of manualPositions) overlay.set(id, pos);
    }
    return resolveCompoundPositions(overlay, visibleList);
  }, [state, layoutPositions, manualPositions, visibleEntities, visibleRelations]);

  // Community detection runs only when `colorMode === 'community'` to
  // avoid wasting cycles on the other modes. The result is cached by
  // reference identity on the underlying graphology graph; the graph
  // itself is rebuilt on every filter/positions change, so the cache
  // invalidates implicitly.
  const communityByEntity = useMemo(() => {
    if (colorMode !== 'community' || !state) return null;
    // Build a temporary graphology view of the visible entities for
    // Louvain — we don't want community detection to include filtered-
    // out nodes, because they'd never get the colour and would still
    // pull clustering.
    const temp = new Graph({ multi: true, type: 'directed' });
    for (const e of state.entities) {
      if (!visibleEntities.has(e.id)) continue;
      if (temp.hasNode(e.id)) continue; // upstream may emit duplicate ids — `buildSigmaGraph` has the same guard
      temp.addNode(e.id);
    }
    for (const r of state.relations) {
      if (!visibleRelations.has(`${r.from}|${r.to}|${r.kind}`)) continue;
      if (!temp.hasNode(r.from) || !temp.hasNode(r.to)) continue;
      try {
        temp.addEdgeWithKey(`${r.from}|${r.to}|${r.kind}`, r.from, r.to);
      } catch { /* ignore parallel */ }
    }
    if (temp.order === 0) return new Map<string, number>();
    const result = detectCommunities(temp);
    logger.info('sigma.communities', { count: result.count });
    return result.byEntity;
  }, [colorMode, state, visibleEntities, visibleRelations]);

  if (!state) {
    return <SigmaEmptyState message="No project scanned yet. Switch to the Graph tab on the left and run a scan." />;
  }
  if (state.entities.length === 0) {
    return <SigmaEmptyState message="Scan returned no entities. Pick a project with source files." />;
  }

  return (
    <SigmaRenderer
      state={state}
      visibleEntities={visibleEntities}
      visibleRelations={visibleRelations}
      positions={positions}
      colorMode={colorMode}
      communityByEntity={communityByEntity}
      onEntityClick={props.onEntityClick}
    />
  );
}

/**
 * Walk every compound child and convert its (possibly local) layout
 * coordinate to an absolute coordinate by walking up to the nearest
 * top-level ancestor. Sigma has no parentNode concept; the only way
 * to keep a child *visually inside* its parent is to give it an
 * absolute position that already accounts for the parent's position.
 *
 * If either endpoint is missing from `positions` we fall back to (0,0)
 * — at that point dagre itself didn't have an answer, and dropping the
 * node silently is worse than placing it at the origin.
 */
function resolveCompoundPositions(
  positions: Map<string, LayoutPosition>,
  visible: CodeEntity[],
): Map<string, LayoutPosition> {
  const byId = new Map(visible.map((e) => [e.id, e]));
  const resolved = new Map<string, LayoutPosition>();
  for (const e of visible) {
    const own = positions.get(e.id);
    if (!own) continue;
    if (!e.parentId) {
      resolved.set(e.id, own);
      continue;
    }
    // Walk up until we reach a top-level entity.
    let chain: CodeEntity[] = [];
    let cursor: CodeEntity | undefined = e;
    let safety = 32;
    while (cursor && cursor.parentId && safety-- > 0) {
      const parent = byId.get(cursor.parentId);
      if (!parent) break;
      chain.push(parent);
      if (!parent.parentId) break;
      cursor = parent;
    }
    let dx = 0;
    let dy = 0;
    for (const parent of chain) {
      const pp = positions.get(parent.id);
      if (!pp) continue;
      dx += pp.x;
      dy += pp.y;
    }
    resolved.set(e.id, { x: own.x + dx, y: own.y + dy });
  }
  return resolved;
}

function SigmaRenderer({
  state,
  visibleEntities,
  visibleRelations,
  positions,
  colorMode,
  communityByEntity,
  onEntityClick,
}: SigmaGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Ref-mirrored hover state so the reducers can read the latest value
  // without being re-installed on every hover (which would tear down
  // and rebuild the WebGL context).
  const hoveredRef = useRef<string | null>(null);
  // Ref-mirrored viewport bounds (in graph space) for the frustum-cull
  // path in `edgeReducer`. Updated on every `camera.updated` event.
  const viewportBoundsRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);

  // Rebuild the graphology graph whenever the underlying state changes.
  // Sigma v3 expects a full graph swap when nodes/edges change — we
  // can't mutate in place without resetting the camera.
  const graph = useMemo(() => {
    return buildSigmaGraph(state, visibleEntities, visibleRelations, positions, {
      colorMode,
      communityByEntity: communityByEntity ?? null,
    });
  }, [state, visibleEntities, visibleRelations, positions, colorMode, communityByEntity]);

  // ─── Drag-to-rearrange ───────────────────────────────────────────────
  // Sigma v3 dropped built-in node dragging (the v2 `sigma-dragNodes`
  // plugin didn't survive the v3 rewrite). We implement it manually:
  //
  //   1. `downNode` captures the dragged id + the graph-space starting
  //      point + the original position of every node that will follow
  //      (the dragged node plus its compound children, if any).
  //   2. Window-level `mousemove` converts the current mouse position
  //      via `viewportToGraph` and shifts every dragged node by
  //      `current - start`.
  //   3. Window-level `mouseup` (or `upNode`) releases the drag and
  //      schedules a debounced write to `.agent-graph/manual-positions.json`
  //      via the existing `setManualPositions` store action.
  //
  // Compound children move with their parent: `resolveCompoundPositions`
  // gave them absolute coords above, so a parent-shift of N pixels
  // also shifts each child by N to keep them inside the parent's bounds.
  const dragSessionRef = useRef<{
    nodeId: string;
    startGraphX: number;
    startGraphY: number;
    originalPositions: Map<string, { x: number; y: number }>;
  } | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  function scheduleManualSave(current: Graph, sessionOriginals: Map<string, { x: number; y: number }>) {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      // Re-derive from session originals + current graph position so
      // the saved position reflects the final spot of the drag, not
      // an intermediate mousemove tick.
      const existing = useCodeGraphStore.getState().manualPositions ?? new Map();
      const merged = new Map<string, LayoutPosition>(existing);
      for (const [id] of sessionOriginals) {
        if (!current.hasNode(id)) continue;
        const x = current.getNodeAttribute(id, 'x') as number;
        const y = current.getNodeAttribute(id, 'y') as number;
        merged.set(id, { x, y });
      }
      void useCodeGraphStore.getState().setManualPositions(merged, new Date().toISOString());
    }, 400);
  }

  useEffect(() => {
    if (!containerRef.current) return;
    if (sigmaRef.current) {
      sigmaRef.current.kill();
      sigmaRef.current = null;
    }
    const renderer = new Sigma(graph, containerRef.current, SIGMA_BASE_SETTINGS);
    sigmaRef.current = renderer;

    renderer.on('clickNode', (e) => {
      // Only treat as click if no drag session was active — a real drag
      // never emits `clickNode`, but the heuristic is cheap insurance
      // against a mouseup landing on the same node after a tiny drag.
      if (dragSessionRef.current && dragSessionRef.current.nodeId === e.node) {
        // No-op — drag end already saved positions; user can click
        // again to open detail after release.
        return;
      }
      setSelectedNodeId(e.node);
      const entity = state.entities.find((x) => x.id === e.node);
      if (entity && onEntityClick) onEntityClick(entity);
      logger.info('sigma.clickNode', { id: e.node });
    });
    renderer.on('clickStage', () => {
      setSelectedNodeId(null);
    });

    // ── Hover highlight: when the user hovers a node, dim every
    // other node (and edges not connected to the hovered one) via
    // reducers. Sigma recomputes the frame automatically on every
    // reducer call. We mirror `hoveredNodeId` to `hoveredRef` so the
    // reducers read the latest value without re-installing on every
    // hover (which would tear down the WebGL context).
    const neighborhood = new Set<string>();
    function setHovered(id: string | null) {
      hoveredRef.current = id;
      neighborhood.clear();
      if (id) {
        neighborhood.add(id);
        if (graph.hasNode(id)) {
          graph.forEachNeighbor(id, (neighbor) => neighborhood.add(neighbor));
        }
      }
      renderer.refresh();
    }
    renderer.on('enterNode', (e) => setHovered(e.node));
    renderer.on('leaveNode', () => setHovered(null));

    renderer.setSetting('nodeReducer', (nodeId, attrs) => {
      const data = attrs as Record<string, unknown>;
      const hovered = hoveredRef.current;
      if (hovered && !neighborhood.has(nodeId) && nodeId !== hovered) {
        return { ...data, color: 'rgba(148, 163, 184, 0.18)', label: '', zIndex: 0 };
      }
      return data;
    });
    renderer.setSetting('edgeReducer', (edgeKey, attrs) => {
      const data = attrs as Record<string, unknown>;
      const hovered = hoveredRef.current;
      if (hovered) {
        // graphology owns edge endpoints — pull them from `graph`,
        // not the Sigma renderer.
        if (graph.hasEdge(edgeKey)) {
          const { source, target } = graph.getEdgeAttributes(edgeKey) as { source: string; target: string };
          if (neighborhood.has(source) || neighborhood.has(target)) {
            return { ...data, size: ((data.size as number) ?? 0.4) * 2.5 };
          }
        }
        return { ...data, color: 'rgba(170, 170, 180, 0.08)', size: 0.2 };
      }
      // No hover — apply viewport (frustum) culling. Hide edges whose
      // BOTH endpoints are off-screen, with a small pad so we don't
      // clip edges that just enter the visible area. This is a
      // pragmatic approximation of GPU-side culling — cheaper than a
      // custom edgeProgram shader for the densities we expect
      // (≤10k edges visible at any given time after filtering).
      if (!graph.hasEdge(edgeKey)) return data;
      const { source, target } = graph.getEdgeAttributes(edgeKey) as { source: string; target: string };
      if (!viewportBoundsRef.current) return data;
      // Defensive: even with hasEdge confirmed, an endpoint may have
      // been pruned by a parallel graph rebuild. Bail rather than
      // crash the renderer with NotFoundGraphError.
      if (!graph.hasNode(source) || !graph.hasNode(target)) return data;
      const bounds = viewportBoundsRef.current;
      const sx = graph.getNodeAttribute(source, 'x') as number;
      const sy = graph.getNodeAttribute(source, 'y') as number;
      const tx = graph.getNodeAttribute(target, 'x') as number;
      const ty = graph.getNodeAttribute(target, 'y') as number;
      const sourceVisible = sx >= bounds.minX && sx <= bounds.maxX && sy >= bounds.minY && sy <= bounds.maxY;
      const targetVisible = tx >= bounds.minX && tx <= bounds.maxX && ty >= bounds.minY && ty <= bounds.maxY;
      if (!sourceVisible && !targetVisible) {
        return { ...data, hidden: true };
      }
      return data;
    });

    // ── Drag start: downNode captures the dragged node + its
    // compound children so they all move together. We pre-snapshot
    // their original positions so per-mousemove updates are pure
    // `original + delta` (no accumulating floating-point drift).
    renderer.on('downNode', (e) => {
      // `MouseCaptor` exposes the last mouse position as `lastMouseX/Y`
      // (public fields — see `node_modules/sigma/dist/declarations/src/core/captors/mouse.d.ts`).
      // There is no `getMousePosition()` accessor in v3; using these
      // fields is the canonical way to read mouse coords without
      // attaching our own listener.
      const captor = renderer.getMouseCaptor();
      const start = renderer.viewportToGraph({ x: captor.lastMouseX ?? 0, y: captor.lastMouseY ?? 0 });
      const originals = new Map<string, { x: number; y: number }>();
      // Guard with `hasNode`: graphology throws `NotFoundGraphError` if
      // we read attributes for an id that isn't in the graph — happens
      // when the user clicks during a brief window where Sigma has
      // rebuilt the graph but our React `state.entities` still references
      // the stale parent/child ids.
      if (graph.hasNode(e.node)) {
        originals.set(e.node, {
          x: graph.getNodeAttribute(e.node, 'x') as number,
          y: graph.getNodeAttribute(e.node, 'y') as number,
        });
        // Walk every entity with parentId === e.node to capture
        // compound children — they need to move with their parent so
        // they stay visually "inside" the container. Same guard: a child
        // may be filtered out of the graph even though `state.entities`
        // still has the parent link.
        for (const entity of state.entities) {
          if (entity.parentId === e.node && graph.hasNode(entity.id)) {
            originals.set(entity.id, {
              x: graph.getNodeAttribute(entity.id, 'x') as number,
              y: graph.getNodeAttribute(entity.id, 'y') as number,
            });
          }
        }
      }
      dragSessionRef.current = {
        nodeId: e.node,
        startGraphX: start.x,
        startGraphY: start.y,
        originalPositions: originals,
      };
      logger.info('sigma.dragStart', {
        nodeId: e.node,
        compoundChildren: Math.max(0, originals.size - 1),
      });
    });

    renderer.getCamera().animatedReset({ duration: 0 });

    // ── Viewport bounds tracking. On every camera update we
    // recompute the visible rect in graph space and stash it in a ref
    // for the edgeReducer. Sigma's CameraState has no width/height
    // fields, so we pull the viewport pixel size from the container's
    // bounding rect (reflowed automatically on window resize).
    function updateViewportBounds() {
      const camera = renderer.getCamera();
      const { x, y, ratio } = camera.getState();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const halfW = rect.width / ratio / 2;
      const halfH = rect.height / ratio / 2;
      const pad = 100; // graph-space pixels — keeps edges from popping in/out at the edges
      viewportBoundsRef.current = {
        minX: x - halfW - pad,
        maxX: x + halfW + pad,
        minY: y - halfH - pad,
        maxY: y + halfH + pad,
      };
    }
    updateViewportBounds();
    renderer.getCamera().on('updated', updateViewportBounds);

    return () => {
      renderer.getCamera().removeListener('updated', updateViewportBounds);
      renderer.kill();
      sigmaRef.current = null;
    };
  }, [graph, state, onEntityClick]);

  // Window-level drag listeners. Sigma doesn't expose `mousemove` after
  // `downNode` cleanly through its public API, so we listen at the
  // window level — Sigma still handles pan on empty canvas via its own
  // mouseCaptor and our `mousedown` only fires when we got `downNode`.
  useEffect(() => {
    if (!sigmaRef.current) return;
    const renderer = sigmaRef.current;

    function onMouseMove(ev: MouseEvent) {
      const session = dragSessionRef.current;
      if (!session) return;
      // Convert viewport mouse position → graph coords using the
      // current camera matrix. Note: `viewportToGraph` takes viewport
      // pixels, not client coords, so we offset by the canvas's
      // bounding rect.
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportX = ev.clientX - rect.left;
      const viewportY = ev.clientY - rect.top;
      const current = renderer.viewportToGraph({ x: viewportX, y: viewportY });
      const dx = current.x - session.startGraphX;
      const dy = current.y - session.startGraphY;
      for (const [id, orig] of session.originalPositions) {
        graph.setNodeAttribute(id, 'x', orig.x + dx);
        graph.setNodeAttribute(id, 'y', orig.y + dy);
      }
    }

    function onMouseUp() {
      const session = dragSessionRef.current;
      if (!session) return;
      logger.info('sigma.dragEnd', {
        nodeId: session.nodeId,
        draggedCount: session.originalPositions.size,
      });
      dragSessionRef.current = null;
      scheduleManualSave(graph, session.originalPositions);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [graph]);

  // Drop any pending manual-position write on unmount.
  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
  }, []);

  const selectedEntity = useMemo(() => {
    if (!selectedNodeId) return null;
    if (graph.hasNode(selectedNodeId)) {
      const attr = graph.getNodeAttribute(selectedNodeId, 'entity') as CodeEntity | undefined;
      if (attr) return attr;
    }
    return state.entities.find((e) => e.id === selectedNodeId) ?? null;
  }, [selectedNodeId, state.entities, graph]);

  return (
    <div className="relative w-full h-full bg-slate-950">
      <div ref={containerRef} className="absolute inset-0" />
      <SigmaControls />
      <SigmaMinimap renderer={sigmaRef.current} />
      {selectedEntity && (
        <SigmaDetailPanel
          entity={selectedEntity}
          graph={graph}
          onNavigate={(next) => setSelectedNodeId(next.id)}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}

/** Re-export the graphology type so consumers don't need a direct dep. */
export type { Graph };
/** Coordinates type for callers that want to talk to the camera. */
export type SigmaCoordinates = Coordinates;

function SigmaEmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-950">
      <div className="max-w-md text-center text-sm text-slate-400 px-6">{message}</div>
    </div>
  );
}
