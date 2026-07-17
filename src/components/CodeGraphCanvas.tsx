// Read-only ReactFlow canvas for the code-intel graph. Every CodeEntity
// becomes a node, every CodeRelation becomes an edge. Class/interface/
// enum/object/companion nodes are *compound*: their children
// (methods/fields/parameters) are nested via ReactFlow's `parentNode` +
// `extent: 'parent'` mechanism.
//
// Edge styles are chosen per RelationKind so the user can tell apart
// inheritance, calls, imports, references, etc. at a glance.
//
// Filters (kinds / relations / languages / archetypes) live in
// `useUiStore.graphFilters` and are applied here before the data goes to
// ReactFlow.

import { useMemo, useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap } from 'reactflow';
import type { Node, Edge, NodeProps, NodeTypes } from 'reactflow';
import { useReactFlow as useReactFlowNamed, Handle, Position } from 'reactflow';
import {
  Box, Braces, ChevronDown, ChevronUp, Cog, Cpu, FunctionSquare, GitBranch, Hash, Layers, Package, Tag, Type, Variable,
} from 'lucide-react';
import { useCodeGraphStore } from '../store/useCodeGraphStore';
import type { CodeEntity, CodeRelation, EntityKind, RelationKind } from '../services/codeIntel/types';
import { useUiStore } from '../store/useUiStore';

// ─── Layout constants ───────────────────────────────────────────────────

const STANDALONE_WIDTH = 220;
const STANDALONE_HEIGHT = 64;
const CHILD_WIDTH = 200;
const CHILD_HEIGHT = 44;
const COL_GAP = 80;
const ROW_GAP = 16;
const CONTAINER_WIDTH = 420;
const CONTAINER_HEADER = 36;
const CONTAINER_PADDING = 12;
const CHILD_COL_GAP = 10;
const CHILD_ROW_GAP = 8;

// ─── Color palettes ─────────────────────────────────────────────────────

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

// ─── Node renderers ─────────────────────────────────────────────────────

interface EntityNodeData {
  entity: CodeEntity;
  color: KindStyle | undefined;
  compound?: boolean;
}

function EntityNode({ data }: NodeProps<EntityNodeData>) {
  const { entity, color, compound } = data;
  const fallback: KindStyle = { bg: 'from-slate-500/15 to-slate-600/5', border: 'border-slate-500/40', text: 'text-slate-300', icon: <Cog className="w-3.5 h-3.5" /> };
  const c = color ?? fallback;
  return (
    <div
      className={`
        relative ${compound ? 'w-full h-full' : 'w-[220px]'} rounded-xl bg-gradient-to-br ${c.bg}
        backdrop-blur-xl border ${c.border} text-white shadow-lg
        transition-all duration-200 hover:scale-[1.02]
      `}
      title={entity.signature ?? entity.name}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-slate-500 !border-0" />
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-slate-500 !border-0" />
      <div className={`px-3 ${compound ? 'py-1' : 'py-2'} flex items-center gap-2`}>
        <span className={c.text}>{c.icon}</span>
        <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold ${c.text} bg-slate-900/40`}>
          {entity.kind}
        </span>
        {entity.archetype && (
          <span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold text-sky-300 bg-sky-500/15">
            {entity.archetype}
          </span>
        )}
      </div>
      {!compound && (
        <div className="px-3 pb-2">
          <div className="font-mono text-sm font-semibold text-white truncate">{entity.name}</div>
          {entity.signature && (
            <div className="text-[10px] text-slate-400 font-mono truncate">{entity.signature}</div>
          )}
          <div className="text-[10px] text-slate-500 truncate mt-0.5">
            {entity.filePath}:{(entity.startLine ?? 0) + 1}
          </div>
        </div>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = { entity: EntityNode };

// ─── Layout ─────────────────────────────────────────────────────────────

interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  sizes: Map<string, { w: number; h: number }>;
  parentOf: Map<string, string | undefined>;
}

const CONTAINER_KINDS: ReadonlySet<EntityKind> = new Set([
  'class', 'interface', 'enum', 'object', 'companion',
]);

function layoutEntities(entities: CodeEntity[]): LayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  const sizes = new Map<string, { w: number; h: number }>();
  const parentOf = new Map<string, string | undefined>();
  for (const e of entities) parentOf.set(e.id, e.parentId);

  // Group children by parent.
  const childrenByParent = new Map<string, CodeEntity[]>();
  for (const e of entities) {
    if (!e.parentId) continue;
    const arr = childrenByParent.get(e.parentId) ?? [];
    arr.push(e);
    childrenByParent.set(e.parentId, arr);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => (a.startLine ?? 0) - (b.startLine ?? 0));
  }

  // First pass: compute container sizes.
  for (const e of entities) {
    if (!CONTAINER_KINDS.has(e.kind)) continue;
    const kids = childrenByParent.get(e.id) ?? [];
    const cols = 2;
    const rows = Math.max(1, Math.ceil(kids.length / cols));
    const w = CONTAINER_WIDTH;
    const h = CONTAINER_HEADER + CONTAINER_PADDING * 2 + rows * CHILD_HEIGHT + (rows - 1) * CHILD_ROW_GAP;
    sizes.set(e.id, { w, h });
  }

  // Top-level entities (no parent) — arrange horizontally per file, vertically across files.
  const tops = entities.filter((e) => !e.parentId && e.kind !== 'file' && e.kind !== 'unknown');
  tops.sort((a, b) => {
    const fp = a.filePath.localeCompare(b.filePath);
    if (fp !== 0) return fp;
    if (CONTAINER_KINDS.has(a.kind) && !CONTAINER_KINDS.has(b.kind)) return -1;
    if (!CONTAINER_KINDS.has(a.kind) && CONTAINER_KINDS.has(b.kind)) return 1;
    return (a.startLine ?? 0) - (b.startLine ?? 0);
  });

  let cursorY = 0;
  const fileBuckets = new Map<string, CodeEntity[]>();
  for (const e of tops) {
    const arr = fileBuckets.get(e.filePath) ?? [];
    arr.push(e);
    fileBuckets.set(e.filePath, arr);
  }

  for (const [, list] of fileBuckets) {
    let maxRowH = 0;
    let cursorX = 0;
    for (const e of list) {
      const size = CONTAINER_KINDS.has(e.kind)
        ? sizes.get(e.id) ?? { w: CONTAINER_WIDTH, h: 200 }
        : { w: STANDALONE_WIDTH, h: STANDALONE_HEIGHT };
      positions.set(e.id, { x: cursorX, y: cursorY });
      sizes.set(e.id, size);
      cursorX += size.w + COL_GAP;
      maxRowH = Math.max(maxRowH, size.h);
    }
    cursorY += maxRowH + ROW_GAP * 2;
  }

  // Second pass: position children inside their container.
  for (const [parentId, kids] of childrenByParent) {
    const parentPos = positions.get(parentId);
    if (!parentPos) continue;
    const cols = 2;
    kids.forEach((kid, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      positions.set(kid.id, {
        x: CONTAINER_PADDING + col * (CHILD_WIDTH + CHILD_COL_GAP),
        y: CONTAINER_HEADER + CONTAINER_PADDING + row * (CHILD_HEIGHT + CHILD_ROW_GAP),
      });
      sizes.set(kid.id, { w: CHILD_WIDTH, h: CHILD_HEIGHT });
    });
  }

  return { positions, sizes, parentOf };
}

// ─── Filtering ──────────────────────────────────────────────────────────

function applyFilters(
  state: { entities: CodeEntity[]; relations: CodeRelation[] },
  filters: ReturnType<typeof useUiStore.getState>['graphFilters'],
): { entities: CodeEntity[]; relations: CodeRelation[] } {
  const allowedIds = new Set<string>();
  for (const e of state.entities) {
    if (filters.kinds.size > 0 && !filters.kinds.has(e.kind)) continue;
    if (filters.languages.size > 0 && (!e.language || !filters.languages.has(e.language))) continue;
    if (filters.archetypes.size > 0) {
      if (!e.archetype || !filters.archetypes.has(e.archetype)) continue;
    }
    allowedIds.add(e.id);
  }
  const relations = state.relations.filter(
    (r) => filters.relations.has(r.kind) && allowedIds.has(r.from) && allowedIds.has(r.to),
  );
  const entities = state.entities.filter((e) => allowedIds.has(e.id));
  return { entities, relations };
}

// ─── Main component ─────────────────────────────────────────────────────

export default function CodeGraphCanvas() {
  const state = useCodeGraphStore((s) => s.state);
  const filters = useUiStore((s) => s.graphFilters);
  const { fitView } = useReactFlowNamed();

  const { nodes, edges } = useMemo(() => {
    if (!state || state.entities.length === 0) {
      return { nodes: [] as Node<EntityNodeData>[], edges: [] as Edge[] };
    }
    const filtered = applyFilters(state, filters);
    const { positions, sizes, parentOf } = layoutEntities(filtered.entities);

    const flowNodes: Node<EntityNodeData>[] = filtered.entities
      .filter((e) => e.kind !== 'file' && e.kind !== 'unknown')
      .map((e) => {
        const isContainer = CONTAINER_KINDS.has(e.kind);
        const parentId = parentOf.get(e.id);
        const inContainer = parentId && filtered.entities.some((x) => x.id === parentId && CONTAINER_KINDS.has(x.kind));
        return {
          id: e.id,
          type: 'entity',
          position: positions.get(e.id) ?? { x: 0, y: 0 },
          data: { entity: e, color: KIND_COLORS[e.kind], compound: inContainer === true },
          draggable: !inContainer,
          ...(inContainer
            ? { parentNode: parentId, extent: 'parent' as const }
            : {}),
          ...(isContainer && !inContainer
            ? {
                style: {
                  width: sizes.get(e.id)?.w ?? CONTAINER_WIDTH,
                  height: sizes.get(e.id)?.h ?? 200,
                  padding: 0,
                  background: 'transparent',
                  border: 'none',
                },
              }
            : {}),
        };
      });

    const flowEdges: Edge[] = filtered.relations.map((r) => {
      const style = RELATION_STYLE[r.kind];
      return {
        id: `${r.from}->${r.to}->${r.kind}`,
        source: r.from,
        target: r.to,
        type: 'smoothstep',
        animated: style?.animated ?? false,
        style: {
          stroke: style?.color ?? '#64748b',
          strokeWidth: style?.strokeWidth ?? 1.5,
          strokeDasharray: style?.dash,
          opacity: 0.85,
        },
      };
    });

    return { nodes: flowNodes, edges: flowEdges };
  }, [state, filters]);

  useEffect(() => {
    if (nodes.length === 0) return;
    const t = setTimeout(() => fitView({ duration: 300, padding: 0.15 }), 100);
    return () => clearTimeout(t);
  }, [nodes.length, fitView]);

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
        fitView
        minZoom={0.05}
        maxZoom={2}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        edgesFocusable
      >
        <Background color="#1e293b" gap={20} size={1} />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const data = n.data as EntityNodeData | undefined;
            const kind = data?.entity.kind ?? 'unknown';
            const style = KIND_COLORS[kind as EntityKind];
            if (!style) return '#64748b';
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
    { kind: 'returns', label: 'Returns' },
    { kind: 'has_parameter', label: 'Has param' },
  ];
  return (
    <div
      className="absolute top-4 right-4 z-30 overflow-hidden rounded-xl bg-slate-900/85 border border-slate-700/60 backdrop-blur-md text-[11px] text-slate-300 pointer-events-auto"
    >
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
            Class / interface shown as a container; methods & fields nested inside.
          </div>
        </div>
      )}
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