import type { Node, Edge } from 'reactflow';

export interface NodePosition {
  x: number;
  y: number;
}

export type PositionMap = Record<string, NodePosition>;

const NODE_WIDTH = 240;
const X_SPACING = 60;
const ROOT_X_SPACING = 100;
const LEVEL_HEIGHT = 300;

export function autoLayout(nodes: Node[], edges: Edge[]): PositionMap {
  if (nodes.length === 0) return {};

  const childrenOf = new Map<string, string[]>();
  const incoming = new Set<string>();
  const nodeIds = new Set(nodes.map((n) => n.id));

  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (e.source === e.target) continue;
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source)!.push(e.target);
    incoming.add(e.target);
  }

  for (const list of childrenOf.values()) {
    list.sort((a, b) => nodeSortKey(a).localeCompare(nodeSortKey(b)));
  }

  const roots = nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
  if (roots.length === 0) {
    roots.push(nodes[0].id);
  } else {
    roots.sort((a, b) => nodeSortKey(a).localeCompare(nodeSortKey(b)));
  }

  const widthCache = new Map<string, number>();
  const computeWidth = (id: string, stack: Set<string>): number => {
    const cached = widthCache.get(id);
    if (cached !== undefined) return cached;
    if (stack.has(id)) {
      widthCache.set(id, NODE_WIDTH);
      return NODE_WIDTH;
    }

    const next = new Set(stack);
    next.add(id);

    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      widthCache.set(id, NODE_WIDTH);
      return NODE_WIDTH;
    }

    let total = 0;
    for (let i = 0; i < kids.length; i++) {
      total += computeWidth(kids[i], next);
      if (i < kids.length - 1) total += X_SPACING;
    }

    const width = Math.max(NODE_WIDTH, total);
    widthCache.set(id, width);
    return width;
  };

  const positions: PositionMap = {};

  const place = (id: string, leftX: number, depth: number): void => {
    if (positions[id] !== undefined) return;
    const w = computeWidth(id, new Set());
    const x = leftX + w / 2 - NODE_WIDTH / 2;
    positions[id] = { x, y: depth * LEVEL_HEIGHT };

    const kids = childrenOf.get(id) ?? [];
    let cursor = leftX;
    for (let i = 0; i < kids.length; i++) {
      const cw = computeWidth(kids[i], new Set());
      place(kids[i], cursor, depth + 1);
      cursor += cw;
      if (i < kids.length - 1) cursor += X_SPACING;
    }
  };

  let cursorX = 0;
  for (const rootId of roots) {
    const w = computeWidth(rootId, new Set());
    place(rootId, cursorX, 0);
    cursorX += w + ROOT_X_SPACING;
  }

  for (const n of nodes) {
    if (!positions[n.id]) {
      positions[n.id] = { x: n.position.x, y: n.position.y };
    }
  }

  return positions;
}

function nodeSortKey(id: string): string {
  const m = id.match(/^(orch|agent|skill)_(\d+)/);
  if (m) return `${m[1]}_${m[2].padStart(6, '0')}`;
  return id;
}
