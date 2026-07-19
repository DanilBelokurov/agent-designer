// Extended detail panel for Sigma.js v3 — mirrors GraphFocus's `#detail`
// aside. Renders as an HTML overlay (Sigma can't paint React components
// inside its WebGL canvas) and is anchored to the top-left of the canvas.
//
// Provides:
//   - label / id / kind / language / archetype
//   - vscode://file/<path>:<line> deep-link (clicks open the file in
//     VS Code at the entity's start line — most useful affordance for
//     a code-intel canvas)
//   - degree (number of incident edges)
//   - community index (filled in by Louvain in Phase 4)
//   - up to 40 neighbours with the edge relation kind (incoming vs
//     outgoing), clickable so the panel can navigate the graph without
//     dragging or searching

import type Graph from 'graphology';
import type { CodeEntity } from '../services/codeIntel/types';
import { KIND_COLORS } from '../services/codeIntel/sigmaGraph';

const MAX_NEIGHBOURS = 40;

export interface SigmaDetailPanelProps {
  entity: CodeEntity;
  graph: Graph;
  onNavigate?: (entity: CodeEntity) => void;
  onClose?: () => void;
}

export default function SigmaDetailPanel({
  entity,
  graph,
  onNavigate,
  onClose,
}: SigmaDetailPanelProps) {
  const color = KIND_COLORS[entity.kind] ?? '#64748b';
  const degree = graph.hasNode(entity.id) ? graph.degree(entity.id) : 0;
  const community = (graph.getNodeAttribute(entity.id, 'community') as number | undefined) ?? 0;
  const filePath = (graph.getNodeAttribute(entity.id, 'filePath') as string | undefined) ?? entity.filePath;
  const startLine = ((graph.getNodeAttribute(entity.id, 'startLine') as number | undefined) ?? entity.startLine ?? 0) + 1;

  // neighbours + relation direction. We pull a single snapshot of
  // edges (graphology is fast here) and cap at MAX_NEIGHBOURS so the
  // panel doesn't blow up on hubs with 1k+ connections.
  const neighbours = collectNeighbours(graph, entity.id, MAX_NEIGHBOURS);

  const vscodeLink = filePath
    ? `vscode://file/${encodeURI(filePath)}:${startLine}`
    : null;

  return (
    <div
      data-testid="sigma-detail-panel"
      className="absolute top-4 left-4 z-20 max-w-sm max-h-[80vh] overflow-y-auto rounded-xl bg-slate-900/95 border border-slate-700/70 backdrop-blur-md p-3 shadow-2xl text-[12px] text-slate-200 pointer-events-auto"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="font-mono font-semibold text-white truncate flex-1">{entity.name}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 transition-colors"
            aria-label="Close detail panel"
          >
            ✕
          </button>
        )}
      </div>

      {/* Kind / language / archetype chips */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <Chip>{entity.kind}</Chip>
        {entity.language && <Chip tone="cyan">{entity.language}</Chip>}
        {entity.archetype && <Chip tone="sky">{entity.archetype}</Chip>}
      </div>

      {/* Signature */}
      {entity.signature && (
        <div className="text-[11px] text-slate-300 font-mono break-words mb-2 leading-snug">
          {entity.signature}
        </div>
      )}

      {/* File path + deep-link */}
      {filePath && (
        <div className="flex items-center gap-2 mb-2 text-[10px] text-slate-500">
          <span className="truncate flex-1" title={filePath}>
            {shortenPath(filePath)}:{startLine}
          </span>
          {vscodeLink && (
            <a
              href={vscodeLink}
              className="shrink-0 px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 transition-colors"
              title="Open in VS Code"
            >
              Open
            </a>
          )}
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[10px] text-slate-400 mb-2">
        <span>
          degree <span className="text-slate-200 font-medium">{degree}</span>
        </span>
        <span>
          community{' '}
          <span className="text-slate-200 font-medium">
            #{community}
          </span>
        </span>
      </div>

      {/* Description */}
      {entity.description && (
        <div className="text-[11px] text-slate-300 mb-2 leading-relaxed border-t border-slate-700/50 pt-2">
          {entity.description}
        </div>
      )}

      {/* Neighbours */}
      {neighbours.length > 0 && (
        <div className="border-t border-slate-700/50 pt-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Neighbours ({neighbours.length}{neighbours.length >= MAX_NEIGHBOURS ? '+' : ''})
          </div>
          <ul className="space-y-1">
            {neighbours.map((n) => (
              <li key={`${n.relation}-${n.direction}-${n.id}`}>
                <button
                  type="button"
                  onClick={() => onNavigate?.(n.entity)}
                  className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-800/60 text-left transition-colors"
                >
                  <span
                    className="text-[10px] font-mono shrink-0"
                    style={{ color: n.direction === 'out' ? '#10b981' : '#06b6d4' }}
                  >
                    {n.direction === 'out' ? '→' : '←'}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">{n.relation}</span>
                  <span className="text-[11px] font-mono text-slate-200 truncate flex-1">
                    {n.entity.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Chip({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode;
  tone?: 'slate' | 'cyan' | 'sky';
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-700/40 text-slate-300',
    cyan: 'bg-cyan-500/15 text-cyan-300',
    sky: 'bg-sky-500/15 text-sky-300',
  };
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold shrink-0 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function shortenPath(path: string): string {
  const parts = path.split(/[\\/]/);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-3).join('/')}`;
}

interface NeighbourEntry {
  id: string;
  entity: CodeEntity;
  relation: string;
  direction: 'in' | 'out';
}

function collectNeighbours(graph: Graph, nodeId: string, limit: number): NeighbourEntry[] {
  if (!graph.hasNode(nodeId)) return [];
  const out: NeighbourEntry[] = [];
  const seen = new Set<string>();

  // outgoing: this node has an edge → neighbour
  graph.forEachOutEdge(nodeId, (_edgeKey, attrs, source, target) => {
    if (out.length >= limit) return;
    const otherId = source === nodeId ? target : source;
    if (seen.has(otherId)) return;
    seen.add(otherId);
    const entity = (graph.getNodeAttribute(otherId, 'entity') as CodeEntity | undefined) ?? null;
    if (!entity) return;
    out.push({
      id: otherId,
      entity,
      relation: (attrs.relationKind as string) ?? (attrs.label as string) ?? 'edge',
      direction: 'out',
    });
  });

  // incoming: neighbour has an edge → this node
  graph.forEachInEdge(nodeId, (_edgeKey, attrs, source, target) => {
    if (out.length >= limit) return;
    const otherId = source === nodeId ? target : source;
    if (seen.has(otherId)) return;
    seen.add(otherId);
    const entity = (graph.getNodeAttribute(otherId, 'entity') as CodeEntity | undefined) ?? null;
    if (!entity) return;
    out.push({
      id: otherId,
      entity,
      relation: (attrs.relationKind as string) ?? (attrs.label as string) ?? 'edge',
      direction: 'in',
    });
  });

  return out;
}
