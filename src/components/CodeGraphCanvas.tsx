// Read-only ReactFlow canvas for the code-intel graph. Every CodeEntity
// becomes a node, every CodeRelation becomes an edge. Container kinds
// (class / interface / enum / object / companion) are *compound*: their
// children (methods / fields / parameters) are nested via ReactFlow's
// `parentNode` + `extent: 'parent'` mechanism. Compound nodes are
// collapsed by default — toggleable via the toolbar, persisted in
// `useUiStore.compoundsCollapsed`.
//
// Performance: with thousands of entities (real projects produce 5K–15K)
// we need to keep the rendered DOM small. Two complementary mechanisms:
//   1. Collapsed compounds omit their children entirely.
//   2. ReactFlow `onlyRenderVisibleElements` virtualises off-screen nodes.
// Plus aggressive defaults (only architectural kinds visible) and
// `React.memo` on EntityNode so re-renders stay local.

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap } from 'reactflow';
import type { Node, Edge, NodeProps, NodeTypes } from 'reactflow';
import { useReactFlow as useReactFlowNamed } from 'reactflow';
import {
  Box, Braces, ChevronDown, ChevronUp, Cog, Cpu, FunctionSquare, GitBranch, Hash, Layers, Maximize2, Minimize2, Package, Tag, Type, Variable,
} from 'lucide-react';
import { useCodeGraphStore } from '../store/useCodeGraphStore';
import type { CodeEntity, CodeRelation, EntityKind, RelationKind } from '../services/codeIntel/types';
import type { LayoutPosition } from '../services/codeIntel/layoutCache';
import { computeLayoutPositions } from '../services/codeIntel/layoutEngine';
import { computeAndCacheLayout } from '../services/codeIntel/layer';
import { useUiStore } from '../store/useUiStore';
import { useFileSystemStore } from '../store/useFileSystemStore';
import { logger } from '../services/logger';

// ─── Constants ──────────────────────────────────────────────────────────

const COMPOUND_W = 280;
const COMPOUND_H = 88;
const CHILD_H = 44;

const CONTAINER_KINDS: ReadonlySet<EntityKind> = new Set([
  'class', 'interface', 'enum', 'object', 'companion',
]);

// Edge kinds that should be shown even when both endpoints are inside
// the same compound (they communicate something structural).
const CROSS_COMPOUND_OK: ReadonlySet<RelationKind> = new Set([
  'inherits', 'implements', 'extension_of',
]);

// ─── Color / style palettes ─────────────────────────────────────────────

interface KindStyle {
  bg: string;
  border: string;
  text: string;
  icon: React.ReactNode;
}

const KIND_COLORS: Partial<Record<EntityKind, KindStyle>> = {
  class: { bg: 'from-indigo-500/15 to-indigo-600/5', border: 'border-indigo-500/40', text: 'text-indigo-300', icon: <Box className="w-3.5 h-3.5" /> },
  interface: { bg: 'from-cyan-500/15 to-cyan-600/5', border: 'border-cyan-500/40', text: 'text-cyan-300', icon: <Braces className="w-3.5 h-3.5" /> },
  enum: { bg: 'from-amber-500/15 to-amber-600/5', border: 'border-amber-500/40', text: 'text-amber-300', icon: <Tag className="w-3.5 h-3.5" /> },
  object: { bg: 'from-violet-500/15 to-violet-600/5', border: 'border-violet-500/40', text: 'text-violet-300', icon: <Layers className="w-3.5 h-3.5" /> },
  companion: { bg: 'from-fuchsia-500/15 to-fuchsia-600/5', border: 'border-fuchsia-500/40', text: 'text-fuchsia-300', icon: <Layers className="w-3.5 h-3.5" /> },
  function: { bg: 'from-emerald-500/15 to-emerald-600/5', border: 'border-emerald-500/40', text: 'text-emerald-300', icon: <FunctionSquare className="w-3.5 h-3.5" /> },
  method: { bg: 'from-teal-500/15 to-teal-600/5', border: 'border-teal-500/40', text: 'text-teal-300', icon: <Cpu className="w-3.5 h-3.5" /> },
  field: { bg: 'from-orange-500/15 to-orange-600/5', border: 'border-orange-500/40', text: 'text-orange-300', icon: <Hash className="w-3.5 h-3.5" /> },
  parameter: { bg: 'from-slate-400/15 to-slate-500/5', border: 'border-slate-400/40', text: 'text-slate-300', icon: <Variable className="w-3.5 h-3.5" /> },
  variable: { bg: 'from-slate-500/15 to-slate-600/5', border: 'border-slate-500/40', text: 'text-slate-300', icon: <Variable className="w-3.5 h-3.5" /> },
  constant: { bg: 'from-yellow-500/15 to-yellow-600/5', border: 'border-yellow-500/40', text: 'text-yellow-300', icon: <Tag className="w-3.5 h-3.5" /> },
  annotation: { bg: 'from-pink-500/15 to-pink-600/5', border: 'border-pink-500/40', text: 'text-pink-300', icon: <Type className="w-3.5 h-3.5" /> },
  module: { bg: 'from-blue-500/15 to-blue-600/5', border: 'border-blue-500/40', text: 'text-blue-300', icon: <Package className="w-3.5 h-3.5" /> },
  package: { bg: 'from-sky-500/15 to-sky-600/5', border: 'border-sky-500/40', text: 'text-sky-300', icon: <Package className="w-3.5 h-3.5" /> },
  type: { bg: 'from-zinc-500/15 to-zinc-600/5', border: 'border-zinc-500/40', text: 'text-zinc-300', icon: <GitBranch className="w-3.5 h-3.5" /> },
};

const RELATION_STYLE: Record<RelationKind, { color: string; strokeWidth: number; dash?: string; animated?: boolean }> = {
  contains: { color: '#475569', strokeWidth: 1, dash: '2 4' },
  inherits: { color: '#a855f7', strokeWidth: 2 },
  implements: { color: '#06b6d4', strokeWidth: 2 },
  calls: { color: '#10b981', strokeWidth: 1.5, animated: true },
  annotated_by: { color: '#ec4899', strokeWidth: 1.5, dash: '4 4' },
  imports: { color: '#f59e0b', strokeWidth: 1.5, dash: '6 4' },
  returns: { color: '#94a3b8', strokeWidth: 1 },
  has_parameter: { color: '#64748b', strokeWidth: 1 },
  field_of: { color: '#64748b', strokeWidth: 1 },
  extension_of: { color: '#f97316', strokeWidth: 1.5, dash: '6 3 2 3' },
  references: { color: '#71717a', strokeWidth: 1, dash: '2 6' },
};

const FALLBACK_STYLE: KindStyle = {
  bg: 'from-slate-500/15 to-slate-600/5',
  border: 'border-slate-500/40',
  text: 'text-slate-300',
  icon: <Cog className="w-3.5 h-3.5" />,
};

// ─── Node renderer (memoised) ───────────────────────────────────────────

interface EntityNodeData {
  entity: CodeEntity;
  color: KindStyle;
  compound?: boolean;
  collapsed?: boolean;
}

function EntityNodeImpl({ data }: NodeProps<EntityNodeData>) {
  const { entity, color, compound, collapsed } = data;
  return (
    <div
      className={`
        relative ${compound ? 'w-full h-full' : 'w-[220px]'} rounded-xl bg-gradient-to-br ${color.bg}
        backdrop-blur-xl border ${color.border} text-white shadow-lg
        transition-transform duration-150 hover:scale-[1.02]
      `}
      title={entity.signature ?? entity.name}
    >
      <div className={`px-3 ${compound ? 'py-1' : 'py-2'} flex items-center gap-2 min-w-0`}>
        <span className={color.text}>{color.icon}</span>
        <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold ${color.text} bg-slate-900/40 shrink-0`}>
          {entity.kind}
        </span>
        {entity.archetype && (
          <span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold text-sky-300 bg-sky-500/15 shrink-0">
            {entity.archetype}
          </span>
        )}
        {compound && collapsed && entity.parentId && (
          <span className="ml-auto text-[9px] text-slate-500 uppercase tracking-wider shrink-0">
            children hidden
          </span>
        )}
      </div>
      {!compound && (
        <div className="px-3 pb-2 min-w-0">
          <div className="font-mono text-sm font-semibold text-white truncate">{entity.name}</div>
          {entity.signature && (
            <div className="text-[10px] text-slate-400 font-mono truncate">{entity.signature}</div>
          )}
          <div className="text-[10px] text-slate-500 truncate mt-0.5">
            {entity.filePath}:{(entity.startLine ?? 0) + 1}
          </div>
        </div>
      )}
      {compound && (
        <div className="px-3 pb-2 min-w-0">
          <div className="font-mono text-sm font-semibold text-white truncate">{entity.name}</div>
          {entity.signature && (
            <div className="text-[10px] text-slate-400 font-mono truncate">{entity.signature}</div>
          )}
        </div>
      )}
    </div>
  );
}

const EntityNode = memo(EntityNodeImpl, (prev, next) => (
  prev.data.entity === next.data.entity &&
  prev.data.collapsed === next.data.collapsed &&
  prev.data.compound === next.data.compound &&
  prev.selected === next.selected
));

const nodeTypes: NodeTypes = { entity: EntityNode };

// ─── Layout (dagre) ────────────────────────────────────────────────────
//
// Layout positions come from `codeIntel/layoutEngine.computeLayoutPositions`
// — both the cached path (`layoutPositions` from `.agent-graph/layout.json`)
// and the fallback path use the same engine so coordinates stay consistent
// with what scan wrote to disk. The engine stores top-level entities at
// world coordinates and compound children at coordinates *relative* to
// their parent, matching ReactFlow's `parentNode + extent:'parent'`
// expectations.

// ─── Filtering ──────────────────────────────────────────────────────────

function applyFilters(
  state: { entities: CodeEntity[]; relations: CodeRelation[] },
  filters: ReturnType<typeof useUiStore.getState>['graphFilters'],
): { entities: CodeEntity[]; relations: CodeRelation[] } {
  const allowed = new Set<string>();
  for (const e of state.entities) {
    if (filters.kinds.size > 0 && !filters.kinds.has(e.kind)) continue;
    if (filters.languages.size > 0 && (!e.language || !filters.languages.has(e.language))) continue;
    if (filters.archetypes.size > 0) {
      if (!e.archetype || !filters.archetypes.has(e.archetype)) continue;
    }
    allowed.add(e.id);
  }
  const relations = state.relations.filter(
    (r) => filters.relations.has(r.kind) && allowed.has(r.from) && allowed.has(r.to),
  );
  const entities = state.entities.filter((e) => allowed.has(e.id));
  return { entities, relations };
}

// ─── Compound collapse logic ───────────────────────────────────────────

function selectVisibleEntities(
  filtered: CodeEntity[],
  relations: CodeRelation[],
  collapsedSet: ReadonlySet<string>,
): { visible: CodeEntity[]; relations: CodeRelation[] } {
  // Determine which entities are visible: everything except children of
  // collapsed compound nodes.
  const visibleIds = new Set<string>();
  for (const e of filtered) {
    if (e.parentId && collapsedSet.has(e.parentId)) continue;
    visibleIds.add(e.id);
  }
  const visible = filtered.filter((e) => visibleIds.has(e.id));

  // Drop edges that reference hidden nodes, plus edges that go between
  // siblings inside the same compound (those create visual noise).
  const sameCompound = new Map<string, string>();
  for (const e of visible) {
    if (e.parentId) sameCompound.set(e.id, e.parentId);
  }
  const relations2 = relations.filter((r) => {
    if (!visibleIds.has(r.from) || !visibleIds.has(r.to)) return false;
    if (r.from === r.to) return false;
    const pa = sameCompound.get(r.from);
    const pb = sameCompound.get(r.to);
    if (pa && pa === pb && !CROSS_COMPOUND_OK.has(r.kind)) return false;
    return true;
  });

  return { visible, relations: relations2 };
}

// ─── Main component ─────────────────────────────────────────────────────

export default function CodeGraphCanvas() {
  const state = useCodeGraphStore((s) => s.state);
  const layoutPositions = useCodeGraphStore((s) => s.layoutPositions);
  const setLayout = useCodeGraphStore((s) => s.setLayout);
  const filters = useUiStore((s) => s.graphFilters);
  const collapsedSet = useUiStore((s) => s.compoundsCollapsed);
  const toggleCompoundCollapse = useUiStore((s) => s.toggleCompoundCollapse);
  const expandAllCompounds = useUiStore((s) => s.expandAllCompounds);
  const collapseAllCompounds = useUiStore((s) => s.collapseAllCompounds);
  const requestAutoLayout = useUiStore((s) => s.requestAutoLayout);
  const autoLayoutRequested = useUiStore((s) => s.autoLayoutRequested);
  const directory = useFileSystemStore((s) => s.directory);
  const { fitView } = useReactFlowNamed();

  // Build entity id list of compound parents (for Collapse all button).
  const containerIds = useMemo(() => {
    if (!state) return [] as string[];
    const ids: string[] = [];
    for (const e of state.entities) {
      if (CONTAINER_KINDS.has(e.kind)) ids.push(e.id);
    }
    return ids;
  }, [state]);

  const { nodes, edges, lastEntityCount } = useMemo(() => {
    if (!state || state.entities.length === 0) {
      return { nodes: [] as Node<EntityNodeData>[], edges: [] as Edge[], lastEntityCount: 0 };
    }
    const t0 = performance.now();
    const filtered = applyFilters(state, filters);
    const t1 = performance.now();
    const { visible, relations: visibleRelations } = selectVisibleEntities(
      filtered.entities, filtered.relations, collapsedSet,
    );
    const t2 = performance.now();

    // Build the set of ids that will actually be rendered as flow nodes.
    // Used both for dagre's parent-child wiring and for ReactFlow's
    // `parentNode` — both need to point at a node that's actually in
    // the nodes array (file entities are filtered out below).
    const renderedIds = new Set<string>();
    for (const e of visible) {
      if (e.kind !== 'file' && e.kind !== 'unknown') renderedIds.add(e.id);
    }

    let positions: Map<string, LayoutPosition>;
    if (layoutPositions && layoutPositions.size > 0) {
      // Fast path: positions are pre-computed by `analyzeProject` and
      // persisted to `.agent-graph/layout.json`. Filters / collapse only
      // hide nodes; topology doesn't change, so cached positions stay
      // valid for whatever subset is currently visible.
      positions = layoutPositions;
    } else {
      // Fallback: no cached layout (first scan in progress, cache deleted,
      // fingerprint mismatch). Run the same engine `analyzeProject` uses,
      // on the currently visible subset — this is the slow path the cache
      // exists to avoid.
      positions = computeLayoutPositions(visible, visibleRelations);
    }
    const t3 = performance.now();

    // Compute visible-child-count per container for the badge.
    const childCount = new Map<string, number>();
    for (const e of visible) {
      if (e.parentId) {
        childCount.set(e.parentId, (childCount.get(e.parentId) ?? 0) + 1);
      }
    }

    const flowNodes: Node<EntityNodeData>[] = [];
    for (const e of visible) {
      if (e.kind === 'file' || e.kind === 'unknown') continue;
      const isContainer = CONTAINER_KINDS.has(e.kind);
      const parentId = e.parentId ?? null;
      // Only attach to a parent if that parent is actually in the
      // nodes array we hand to ReactFlow — otherwise ReactFlow throws
      // "Parent node … not found".
      const parentWillRender = parentId !== null && renderedIds.has(parentId);
      const collapsed = isContainer && collapsedSet.has(e.id);
      const pos = positions.get(e.id) ?? { x: 0, y: 0 };
      const color = KIND_COLORS[e.kind] ?? FALLBACK_STYLE;
      const kids = childCount.get(e.id) ?? 0;
      flowNodes.push({
        id: e.id,
        type: 'entity',
        position: pos,
        data: { entity: e, color, compound: parentWillRender, collapsed },
        draggable: false,
        selectable: true,
        ...(parentWillRender
          ? { parentNode: parentId!, extent: 'parent' as const }
          : {}),
        ...(isContainer
          ? {
              style: {
                width: collapsed ? COMPOUND_W : COMPOUND_W + 80,
                height: collapsed ? COMPOUND_H : COMPOUND_H + Math.ceil(kids / 2) * (CHILD_H + 8),
                padding: 0,
                background: 'transparent',
                border: 'none',
              },
            }
          : {}),
      });
    }

    const flowEdges: Edge[] = visibleRelations.map((r) => {
      const style = RELATION_STYLE[r.kind] ?? { color: '#64748b', strokeWidth: 1.5 };
      return {
        id: `${r.from}->${r.to}->${r.kind}`,
        source: r.from,
        target: r.to,
        type: 'smoothstep',
        animated: !!style.animated,
        style: {
          stroke: style.color,
          strokeWidth: style.strokeWidth,
          strokeDasharray: style.dash,
          opacity: 0.85,
        },
      };
    });

    const t4 = performance.now();
    if (visible.length > 100) {
      logger.debug('graph.layout', {
        entities: visible.length,
        relations: visibleRelations.length,
        filterMs: Math.round(t1 - t0),
        collapseMs: Math.round(t2 - t1),
        dagreMs: Math.round(t3 - t2),
        flowMs: Math.round(t4 - t3),
        totalMs: Math.round(t4 - t0),
      });
    }

    return { nodes: flowNodes, edges: flowEdges, lastEntityCount: visible.length };
  }, [state, filters, collapsedSet, layoutPositions]);

  // Handle explicit auto-layout request — re-run dagre, persist to
  // `.agent-graph/layout.json`, and re-fit the viewport. With the cache
  // in place this is no longer the only way to layout — opening a fresh
  // scan already gives you pre-computed positions — but it's still the
  // escape hatch for "I want to re-shuffle this".
  useEffect(() => {
    if (autoLayoutRequested === 0 || lastEntityCount === 0) return;
    if (!state || !directory) {
      // No project bound — nothing to lay out. fitView alone still helps
      // for an empty canvas.
      const t = setTimeout(() => fitView({ duration: 400, padding: 0.15 }), 50);
      return () => clearTimeout(t);
    }
    logger.info('layout.autolayout.start', { entities: lastEntityCount });
    let cancelled = false;
    (async () => {
      try {
        const cache = await computeAndCacheLayout(
          directory,
          state.entities,
          state.relations,
          state.projectFingerprint,
        );
        if (cancelled) return;
        const map = new Map<string, LayoutPosition>();
        for (const [id, pos] of Object.entries(cache.positions)) map.set(id, pos);
        setLayout(map, cache.computedAt);
        const t = setTimeout(() => fitView({ duration: 400, padding: 0.15 }), 50);
        return () => clearTimeout(t);
      } catch (err) {
        logger.warn('layout.autolayout.failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoLayoutRequested, lastEntityCount, fitView, state, directory, setLayout]);

  // Fit the viewport whenever a freshly-loaded project becomes visible. The
  // dependency on `state?.projectFingerprint` (not `nodes.length`) ensures
  // fitView re-runs when the user re-opens an already-scanned project — a
  // stale `initialized` ref used to swallow that and leave the viewport
  // pointed at the previous project's coordinates.
  useEffect(() => {
    if (!state || nodes.length === 0) return;
    const fp = state.projectFingerprint;
    if (!fp) return;
    const t = setTimeout(() => fitView({ duration: 300, padding: 0.15 }), 100);
    logger.info('layout.fitview', { fingerprint: fp, nodes: nodes.length });
    return () => clearTimeout(t);
  }, [state?.projectFingerprint, nodes.length, fitView, state]);

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if (CONTAINER_KINDS.has((node.data as EntityNodeData).entity.kind)) {
        logger.info('compound.toggle', { id: node.id, to: collapsedSet.has(node.id) ? 'expanded' : 'collapsed' });
        toggleCompoundCollapse(node.id);
      }
    },
    [toggleCompoundCollapse, collapsedSet],
  );

  const onAutoLayoutClick = useCallback(() => {
    logger.info('layout.button.click', { action: 'autoLayout', entities: lastEntityCount });
    requestAutoLayout();
  }, [requestAutoLayout, lastEntityCount]);

  const onExpandAllClick = useCallback(() => {
    logger.info('layout.button.click', { action: 'expandAll', entities: lastEntityCount });
    expandAllCompounds();
  }, [expandAllCompounds, lastEntityCount]);

  const onCollapseAllClick = useCallback(() => {
    logger.info('layout.button.click', { action: 'collapseAll', containers: containerIds.length });
    collapseAllCompounds(containerIds);
  }, [collapseAllCompounds, containerIds]);

  if (!state) {
    return <EmptyState message="No project scanned yet. Switch to the Graph tab on the left and run a scan." />;
  }
  if (state.entities.length === 0) {
    return <EmptyState message="Scan returned no entities. Pick a project with source files." />;
  }

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView={false}
        minZoom={0.02}
        maxZoom={2}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        edgesFocusable={false}
        onlyRenderVisibleElements
        elevateNodesOnSelect={false}
        onNodeClick={onNodeClick}
      >
        <Background color="#1e293b" gap={20} size={1} />
        <Controls
          position="bottom-left"
          showInteractive={false}
          className="!bg-slate-900/90 !border-slate-700/50 !shadow-2xl !rounded-xl overflow-hidden"
        >
          <div className="h-px bg-slate-700/50 mx-2" />
          <button
            type="button"
            onClick={onAutoLayoutClick}
            title="Auto layout (re-run dagre)"
            aria-label="Auto layout"
            className="!text-indigo-300 hover:!bg-indigo-500/20 hover:!text-indigo-200 !w-[28px] !h-[28px] flex items-center justify-center"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onExpandAllClick}
            title="Expand all compounds"
            aria-label="Expand all compounds"
            className="!text-emerald-300 hover:!bg-emerald-500/20 hover:!text-emerald-200 !w-[28px] !h-[28px] flex items-center justify-center"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onCollapseAllClick}
            title="Collapse all compounds"
            aria-label="Collapse all compounds"
            className="!text-amber-300 hover:!bg-amber-500/20 hover:!text-amber-200 !w-[28px] !h-[28px] flex items-center justify-center"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
        </Controls>
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const data = n.data as EntityNodeData | undefined;
            const kind = data?.entity.kind ?? 'unknown';
            if (kind === 'class' || kind === 'object') return '#6366f1';
            if (kind === 'interface') return '#06b6d4';
            if (kind === 'function') return '#10b981';
            if (kind === 'method') return '#14b8a6';
            if (kind === 'field') return '#f97316';
            if (kind === 'constant') return '#eab308';
            if (kind === 'enum') return '#f59e0b';
            return '#64748b';
          }}
          maskColor="rgba(2, 6, 23, 0.7)"
          style={{ background: 'rgba(15, 23, 42, 0.8)' }}
        />
      </ReactFlow>
      <Legend />
      <StatusBar visible={lastEntityCount} containers={containerIds.length} collapsed={collapsedSet.size} />
    </>
  );
}

// ─── Legend ─────────────────────────────────────────────────────────────

function Legend() {
  const [open, setOpen] = useState(true);
  const relationKinds: Array<{ kind: RelationKind; label: string }> = [
    { kind: 'inherits', label: 'Inherits' },
    { kind: 'implements', label: 'Implements' },
    { kind: 'calls', label: 'Calls (animated)' },
    { kind: 'imports', label: 'Imports' },
    { kind: 'extension_of', label: 'Extension' },
  ];
  return (
    <div className="absolute top-4 right-4 z-30 overflow-hidden rounded-xl bg-slate-900/85 border border-slate-700/60 backdrop-blur-md text-[11px] text-slate-300 pointer-events-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Collapse legend' : 'Expand legend'}
        title={open ? 'Collapse legend' : 'Expand legend'}
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest font-semibold text-white hover:text-slate-200"
      >
        <span>Legend</span>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div className="px-3 pb-3 w-56 space-y-1.5">
          {relationKinds.map(({ kind, label }) => {
            const s = RELATION_STYLE[kind];
            const dash = s.dash ?? 'none';
            return (
              <div key={kind} className="flex items-center gap-2">
                <svg width="32" height="6" className="flex-shrink-0">
                  <line x1="0" y1="3" x2="32" y2="3" stroke={s.color} strokeWidth={s.strokeWidth} strokeDasharray={dash === 'none' ? undefined : dash}>
                    {s.animated && (
                      <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="0.6s" repeatCount="indefinite" />
                    )}
                  </line>
                </svg>
                <span>{label}</span>
              </div>
            );
          })}
          <div className="mt-2 pt-2 border-t border-slate-700/40 text-[10px] text-slate-500">
            Click a class/interface to expand or collapse its children. Use toolbar for Auto layout / Expand all / Collapse all.
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBar({
  visible, containers, collapsed,
}: { visible: number; containers: number; collapsed: number }) {
  return (
    <div className="absolute top-4 left-4 z-20 px-3 py-1.5 rounded-lg bg-slate-900/70 border border-slate-700/50 backdrop-blur-md text-[10px] uppercase tracking-widest text-slate-300 pointer-events-none flex items-center gap-3">
      <span><b className="text-white">{visible}</b> visible</span>
      <span className="text-slate-600">·</span>
      <span><b className="text-white">{containers}</b> containers</span>
      <span className="text-slate-600">·</span>
      <span><b className="text-white">{collapsed}</b> collapsed</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="px-6 py-4 rounded-2xl bg-slate-900/80 border border-slate-700/60 backdrop-blur-md max-w-md text-center">
        <div className="text-sm text-slate-300">{message}</div>
      </div>
    </div>
  );
}