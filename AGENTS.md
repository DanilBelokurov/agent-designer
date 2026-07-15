# Agent Designer — AGENTS.md

A guide for AI agents working on this codebase. Describes what the app does, how it is structured, and where to make common changes.

---

## 1. What this app is

**Agent Designer** is a single-page web app for visually designing a graph of AI agents:

- **Nodes** represent three kinds of things — *Orchestrator*, *Sub-Agent* (dispatchable worker), and *Skill* (tool/function).
- **Directed edges** express two relationships: `delegation` (orchestrator → sub-agent, or orchestrator → skill), and `skill_attachment` (sub-agent → skill).
- The user drags components from the left palette onto a React Flow canvas, wires them with directed handles, edits properties in the right panel, then either exports the project as JSON or generates Python `dataclass` code.

The app is purely client-side; there is no backend.

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Build | Vite 8 | `npm run dev` / `npm run build` |
| UI runtime | React 19 | strict via `tsconfig.app.json` |
| Language | TypeScript | `verbatimModuleSyntax: true` — every type-only import must use `import type` |
| Graph canvas | `reactflow` 11 | custom node types, custom controls, validated connections |
| State | `zustand` 5 | single store; React Flow's local change events are forwarded into it |
| Icons | `lucide-react` 1.x | used in nodes, panels, toolbar, controls |
| Styling | Tailwind CSS 3 + PostCSS | glassmorphism via `src/index.css` `@layer components` |
| Lint | `oxlint` (`npm run lint`) | |
| Entry | `src/main.tsx` → `src/App.tsx` (wraps `<GraphCanvas>` in `<ReactFlowProvider>`) | |

---

## 3. Repository layout

```
agent-graph-designer/
├── index.html                        # Google Fonts (Inter) + root div
├── package.json                      # scripts: dev, build, lint, preview
├── vite.config.ts                    # vite + @vitejs/plugin-react
├── tsconfig.json / .app / .node      # strict TS, verbatimModuleSyntax
├── tailwind.config.js
├── postcss.config.js
├── .oxlintrc.json
├── base-config.json                  # pre-built sample project (213 nodes)
├── scripts/
│   └── generate-base-config.cjs      # Node script that builds base-config.json
├── src/
│   ├── main.tsx                      # ReactDOM.createRoot
│   ├── App.tsx                       # ReactFlowProvider + GraphCanvas
│   ├── index.css                     # Tailwind + React Flow overrides + glass styles
│   ├── types/
│   │   └── index.ts                  # NodeType, NodeConfig, AppNode, AppEdge, Project
│   ├── store/
│   │   └── useGraphStore.ts          # Zustand store (single source of truth)
│   ├── utils/
│   │   └── autoLayout.ts             # hierarchical top-down layout algorithm
│   └── components/
│       ├── GraphCanvas.tsx           # top-level layout, hosts ReactFlow
│       ├── Toolbar.tsx               # top bar (project name, import/export, codegen)
│       ├── nodes/
│       │   ├── index.ts              # re-exports the three node components
│       │   ├── OrchestratorNode.tsx  # indigo gradient, target handle top, source bottom
│       │   ├── SubAgentNode.tsx      # blue gradient, target top, source bottom
│       │   └── SkillNode.tsx         # emerald gradient, target top, source bottom
│       └── panels/
│           ├── NodePalette.tsx       # left: collapsible draggable item list
│           └── PropertiesPanel.tsx   # right: shown only when a node is selected
└── README.md
```

---

## 4. Data model (`src/types/index.ts`)

```ts
type NodeType = 'orchestrator' | 'sub_agent' | 'skill';

// Config discriminated by type:
OrchestratorConfig = { instructions?: string; maxDelegations?: number }
SubAgentConfig     = { instructions?: string; tools?: string[] }
SkillConfig        = { functionName: string; description: string; parameters?: Record<string, unknown> }

BaseNode = { id, type: NodeType, label: string, config: NodeConfig }
AppNode  = OrchestratorNode | SubAgentNode | SkillNode      // discriminated by `type`
AppEdge  = { id, source: string, target: string, edgeType: 'delegation' | 'skill_attachment' }

Project = { id, name, nodes: AppNode[], edges: AppEdge[], createdAt, updatedAt }
```

The format used by `exportProject` / `importProject` is exactly `Project` (without the type-only wrappers) — see `base-config.json` for a worked example.

The Wire format used inside the running app (the Zustand store) uses **React Flow shapes** (`{ id, type, position, data: { label, config } }`), not the `AppNode` shape. The conversion happens in `exportProject` / `importProject` in `useGraphStore.ts`.

---

## 5. State management (`src/store/useGraphStore.ts`)

Single Zustand store: `useGraphStore`. The store holds:

| Field | Type | Notes |
|---|---|---|
| `nodes` | `Node[]` | React Flow shape; `position` is mutated freely |
| `edges` | `Edge[]` | React Flow shape; `data.edgeType` carries `delegation` / `skill_attachment` |
| `selectedNodeId` | `string \| null` | drives the right panel and selected-node UI |
| `projectName` | `string` | shown in toolbar, exported as `Project.name` |

Exposed actions (all selectors destructure these):

- `onNodesChange(changes)` / `onEdgesChange(changes)` — wired straight into React Flow; they use `applyNodeChanges` / `applyEdgeChanges`.
- `onConnect(connection)` — guards against disallowed connections using `getEdgeType(sourceType, targetType)`. Allowed pairs:
  - `orchestrator → sub_agent`  → `delegation`
  - `sub_agent → skill`         → `skill_attachment`
  - `orchestrator → skill`      → `skill_attachment`
- `addNode(type, position)` — generates `type_N` id, default `label` and default `config`.
- `updateNode(id, { label?, config? })` — merges updates into `data`.
- `deleteNode(id)` — removes the node, all incident edges, clears selection if it was selected.
- `selectNode(id | null)` — sets `selectedNodeId`.
- `setProjectName(name)` / `setNodesPositions(positions)` / `clearGraph()` / `importProject(json)` / `exportProject()`.

> `getEdgeType` is the **single source of truth** for connection validity on the store side. The canvas **also** has a parallel `isValidConnection` in `GraphCanvas.tsx` which mirrors it for the UI; keep them in sync if you add a new edge type.

ID generators in this file use module-scoped counters that only increment — re-imports will allocate fresh `type_N` ids because positions are then randomized anyway.

---

## 6. Components

### `App.tsx`
Wraps the canvas in `<ReactFlowProvider>` so `useReactFlow()` works in descendants. No other state.

### `GraphCanvas.tsx`
Top-level layout shell (`h-screen flex flex-col`). Owns the drag-drop wiring:

- `Toolbar` on top.
- `NodePalette` on the left.
- `<ReactFlow>` in the middle, with `Background` (dots), `Controls` (zoom/fit + custom auto-layout button), and `MiniMap`.
- `PropertiesPanel` on the right — rendered **only** when `selectedNodeId !== null`.

Owns:
- `screenToFlowPosition`, `fitView` from `useReactFlow()`.
- `handleAutoLayout`: runs `autoLayout(nodes, edges)` → `setNodesPositions(...)` → `fitView({ duration: 400, padding: 0.1 })` in a `requestAnimationFrame`.
- `<Controls>` shows zoom, fit view, then a separator `<div>` and a custom `<ControlButton>` whose icon is `Workflow` from `lucide-react`.

`<ReactFlow>` props that matter for behaviour:
- `minZoom={0.005}` — required so users can zoom out on large auto-laid-out graphs.
- `maxZoom={2}`.
- `snapToGrid snapGrid={[16, 16]}`.
- `connectionMode={ConnectionMode.Loose}`.
- `isValidConnection` mirrors `getEdgeType` from the store.

### `Toolbar.tsx`
Top bar with:
- Logo (`Layers` icon) and project name `<input>` (two-way bound to `projectName`).
- Live counts of orchestrators / agents / skills shown as colored dots.
- Import / Export buttons (project JSON, downloaded as `<projectName>.json`).
- `Generate Code` button — calls `generateAgentCode(exportProject())`, downloads `*_agents.py`.
- Clear button (with `confirm`).

`generateAgentCode(projectJson)` parses the project JSON and emits:
- `@dataclass` per **Skill** with `name`, `description`, optional `parameters`.
- `@dataclass` per **Sub-Agent** with `instructions`, `tools: List[Any]` built from attached skills.
- `@dataclass` per **Orchestrator** with `instructions`, `max_delegations`, `sub_agents: List[Any]` from delegation edges.
- `create_agent_graph()` factory that returns `{"orchestrators": [...], "agents": [...], "skills": [...]}`.
- `if __name__ == "__main__":` entrypoint that prints the counts.

All names are `toPascalCase` of the user-entered label, so labels in the UI must be PascalCase-friendly to produce predictable Python class names.

### `nodes/OrchestratorNode.tsx`, `nodes/SubAgentNode.tsx`, `nodes/SkillNode.tsx`
Custom node renderers. Each is `memo`-wrapped and reads `data.label` plus its own slice of `data.config`. Common conventions:
- Target handle on top, source handle on bottom (so flows always go top-down).
- Handles are styled with a per-node gradient (`indigo`, `blue`, `emerald`), `border-2 border-slate-900`, and hover scale.
- A glow div sits behind the card with `group-hover:opacity-25` (or more on selection).
- Selected state adds `ring-2 ring-<color>-400/80 ring-offset-2 ring-offset-slate-950 scale-105`.

The actual edge colors:
- delegation edges: `#6366f1` (indigo) and `animated: true`.
- skill_attachment edges: `#10b981` (emerald) and static.

### `panels/NodePalette.tsx`
Left panel with local `collapsed` state. Contains the three draggable cards (`Orchestrator`, `Agent`, `Skill`). Drag uses `dataTransfer.setData('application/reactflow', type)` — the canvas reads it on `drop`.

When **collapsed** it becomes a 64 px strip with the three icons (still draggable, with tooltips) and an expand button.

When **expanded** it has a header (logo + title + collapse `ChevronLeft`), the three cards with descriptions, and a footer hint.

### `panels/PropertiesPanel.tsx`
Right panel. Reads `selectedNodeId` from the store and finds the node. Shows:

- Node-type-themed header with `×` (deselects).
- Label input.
- Type-specific form (`OrchestratorFields`, `SubAgentFields`, `SkillFields`):
  - Orchestrator: `instructions` textarea, `maxDelegations` number input (1-20).
  - Agent: `instructions` textarea, list of attached skills (computed from incoming edges from this agent).
  - Skill: `functionName`, `description`, JSON `parameters` editor (invalid JSON is silently ignored).
- Connections section listing all incident edges with the other node's label and edge type.
- `Delete Node` button at the bottom.

`x-deselects` button is *also* the way to collapse the panel — it just calls `selectNode(null)`, and `GraphCanvas` then unmounts the panel.

---

## 7. Utilities

### `utils/autoLayout.ts`
Hierarchical top-down layout that never overlaps within a level.

Algorithm:
1. Build `childrenOf: Map<source, target[]>` from edges; collect `incoming` set.
2. Roots = nodes whose ids are not in `incoming` (multiple disconnected components are placed side-by-side).
3. Recursively compute each node's subtree width with memoization:
   - leaf = `NODE_WIDTH` (240)
   - internal = `max(NODE_WIDTH, sum(child widths) + (n-1) * X_SPACING)` (60)
4. Place each node centered over its subtree, with `y = depth * LEVEL_HEIGHT` (300).
5. Cycle protection via a per-call `Set`.

Returns `Record<nodeId, { x, y }>`. Nodes without a computed position keep their existing position. Output is then fed to `setNodesPositions` in the store.

---

## 8. User flows

1. **Start** — empty canvas, both panels visible. The centre shows a "Drag components from the left panel" hint.
2. **Add a node** — drag from the left palette to the canvas. The drop position comes from `screenToFlowPosition` (mouse coords → flow coords).
3. **Connect** — drag from the bottom handle of an orchestrator/agent to the top handle of an agent/skill. Rejected connections show a "not allowed" cursor; allowed ones get the right colour and animated dashed edge for delegation.
4. **Select** — click any node. PropertiesPanel slides in with a themed header and per-type form. Click anywhere empty to deselect → panel hides.
5. **Auto-layout** — click the `Workflow` icon in the bottom-right Controls. The whole graph is re-positioned into a clean tree and the viewport fits.
6. **Save / load** — Toolbar's `Export` writes `<projectName>.json`. `Import` reads it back. `Generate Code` writes Python.
7. **Clear** — Toolbar's `Clear` button (after confirm) wipes nodes and edges.

---

## 9. How to extend

### Add a new node type
1. Add the type literal to `NodeType` in `src/types/index.ts`.
2. Add a `XxxConfig` interface and extend the `NodeConfig` union.
3. In `useGraphStore.ts`:
   - Extend `getDefaultConfig` switch.
   - Extend `getEdgeType` if this type can be a source/target of an existing edge, or add new edge types.
4. Create a new node component under `src/components/nodes/XxxNode.tsx` and re-export it from `src/components/nodes/index.ts`.
5. Register the type in `nodeTypes` in `src/components/GraphCanvas.tsx`.
6. Update `paletteItems` in `src/components/panels/NodePalette.tsx`.
7. Add a form section in `src/components/panels/PropertiesPanel.tsx` (`XxxFields`) and wire it into the type-specific dispatch.
8. Update `generateAgentCode` in `src/components/Toolbar.tsx` if Python should include this kind.

### Add a new edge type
1. Add the literal to `EdgeType` in `src/types/index.ts`.
2. Update `getEdgeType` in the store.
3. Mirror the rule in `isValidConnection` in `GraphCanvas.tsx`.
4. Pass the right colour/`animated` flag in `onConnect` (the store decides the style; tweak there).
5. If the new edge needs a custom renderer, add it to `defaultEdgeOptions` in `GraphCanvas.tsx` via `type="yourEdgeType"` and register the component.

### Wire a new behaviour into the toolbar
- Add a button to `src/components/Toolbar.tsx`. If it needs new state, extend `useGraphStore`.

### Add a new control to the bottom-right React Flow panel
- Add a `<ControlButton>` inside `<Controls>` in `src/components/GraphCanvas.tsx`. Use `handleAutoLayout` as a template if you need `useReactFlow()` callbacks like `fitView`/`zoomTo`.

### Add a project-level setting
- Extend `Project` in `types/index.ts`, the `exportProject`/`importProject` payload, and the toolbar UI as needed.

---

## 10. Conventions

- **Strict TypeScript with `verbatimModuleSyntax`** — type-only imports must use `import type { ... }`.
- **Tailwind classes with `!` prefix** override library defaults (especially inside `<Controls>`/`<MiniMap>` class names).
- **Glass/dark theme** — colours come from `slate`/`indigo`/`blue`/`emerald` ranges; surfaces are `slate-900/95` or `slate-800/50` over a dark gradient body.
- **Node data lives at `node.data.label` and `node.data.config`**, not on the node itself. Don't write to `node.label`.
- **IDs that go into edges** must be valid React Flow node ids — they become the `source` / `target` of edges. The store counters start at 1 per session; imports keep original ids but positions are randomized by `importProject`.
- **No tests yet** — verify changes by running `npm run build` (full TS check via `tsc -b`) and `npm run dev` to interactively test the UI.

---

## 11. Build & dev commands

```sh
npm install
npm run dev        # http://localhost:5173 (vite default)
npm run build      # tsc -b + vite build → dist/
npm run lint       # oxlint
npm run preview    # serve dist/

# Regenerate base-config.json:
node scripts/generate-base-config.cjs
```
