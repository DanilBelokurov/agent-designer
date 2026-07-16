# Agent Designer — AGENTS.md

Краткий гид для AI-агентов, работающих с этим репо. Описывает, что делает приложение, как устроен код и где делать типовые изменения. Каждый реализованный функционал документирован пошагово.

---

## 1. Что это такое

**Agent Designer** — single-page web-приложение для визуального проектирования графа AI-агентов.

- **Ноды** представляют три типа сущностей: *Orchestrator*, *Sub-Agent* (диспатчируемый воркер), *Skill* (инструмент/функция).
- **Направленные рёбра** выражают два отношения: `delegation` (orchestrator → sub-agent, или orchestrator → skill) и `skill_attachment` (sub-agent → skill).
- Пользователь перетаскивает компоненты из левой палитры на React Flow canvas, соединяет их ручками (handles), редактирует свойства в правой панели, затем либо экспортирует проект как JSON, либо генерирует Python `dataclass`-скелет.

Приложение поддерживает также:
- генерацию Markdown-инструкции для любой ноды через локальный Qwen CLI с привязкой к шаблонам;
- сканирование выбранной папки проекта через tree-sitter (WASM) для построения графа кода, чтобы LLM писал инструкции по реальным сигнатурам, а не на глаз.

Приложение полностью клиентское; единственная server-сторона — лёгкий Node-bridge для `spawn('qwen', …)`, раздаваемый на том же origin'е (порт `5173` в dev, `3001` в prod).

---

## 2. Архитектура одним взглядом

```
┌──────────────────────────── Browser ────────────────────────────┐
│                                                                  │
│   React UI (Vite dev :5173  /  prod :3001)                      │
│   ┌─────────┐  ┌──────────┐  ┌────────────┐  ┌───────────────┐    │
│   │Toolbar  │  │NodePalette│  │ <ReactFlow>│  │PropertiesPanel│   │
│   └────┬────┘  │ (left)    │  │ + MiniMap  │  │ (right, только│   │
│        │       └─────┬────┘  │ + Controls │  │  при выборе)  │   │
│        │             │        └────────────┘  └───────────────┘    │
│        │             │ drag-drop      ↑            ↑ onSelect    │
│        │             ↓                               ↓           │
│        │       screenToFlowPosition            updateNode        │
│        │       addNode(type, pos)                                │
│        ↓                                                          │
│   fetch('/generate', POST {prompt})                              │
│   fetch('/grammars/*.wasm')                                      │
│   (same origin → no CORS)                                        │
│                                                                  │
│   Zustand stores:                                                │
│     useGraphStore (nodes, edges, selection)                     │
│     useFileSystemStore (picked folder)                           │
│     useCodeGraphStore (entities, relations, scan phase)          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────── Same-origin Node ────────────────────────┐
│   server/qwenHandler.mjs  (shared, ES module)                    │
│     handleGenerate → spawn('qwen', ['-p', prompt])              │
│     handleHealth   → { ok, qwen, timeoutMs }                    │
│                                                                  │
│   Mounted by:                                                    │
│     • vite.config.ts (configureServer/Preview) in dev          │
│     • server/prod-server.mjs in prod                            │
│                                                                  │
│   Static serving + SPA fallback: prod-server.mjs reads dist/    │
└──────────────────────────────────────────────────────────────────┘
```

**Один порт, одно приложение.** Лоадер грамматик `web-tree-sitter` тянет `/grammars/*.wasm` (Vite dev отдаёт из `public/`, prod-server.mjs отдаёт из `dist/`, тот же origin).

---

## 3. Стек

| Слой | Выбор | Заметки |
|---|---|---|
| Bundler | Vite 8 | `npm run dev` / `npm run build` |
| UI runtime | React 19 | strict via `tsconfig.app.json` |
| Language | TypeScript | `verbatimModuleSyntax: true` — type-only импорты через `import type { … }` |
| Graph canvas | `reactflow` 11 | custom node types, custom controls, validated connections |
| State | `zustand` 5 | 3 независимых стора: `useGraphStore`, `useFileSystemStore`, `useCodeGraphStore` |
| Icons | `lucide-react` 1.x | всё UI (ноды, панели, toolbar, controls) |
| Styling | Tailwind 3 + PostCSS | glassmorphism в `src/index.css` `@layer components` |
| Filesystem access | File System Access API | хранилище для записи инструкций; fallback на browser download |
| Code parsing | `web-tree-sitter` 0.26 | WASM-грамматики в `public/grammars/`; regex-фолбэк |
| Qwen bridge | Node `http` built-in | `server/qwenHandler.mjs` — без внешних deps |
| Lint | `oxlint` (`npm run lint`) | |
| Entry | `src/main.tsx` → `src/App.tsx` (внутри `<ReactFlowProvider>`) | |

---

## 4. Структура репозитория

```
agent-graph-designer/
├── index.html                          # Google Fonts (Inter) + #root
├── package.json                        # scripts: dev, build, lint, preview, server, prod, grammars
├── vite.config.ts                      # vite + @vitejs/plugin-react + qwenBridge() middleware
├── tsconfig.json / .app / .node        # strict TS, verbatimModuleSyntax
├── tailwind.config.js, postcss.config.js, .oxlintrc.json
├── base-config.json                    # пример проекта (213 nodes: 8 орч. + 41 агент + 164 скила)
├── README.md
├── AGENTS.md
├── public/
│   ├── favicon.svg, icons.svg
│   └── grammars/                       # WASM, вендоренные через scripts/fetch-grammars.cjs
│       ├── web-tree-sitter.wasm        # runtime
│       ├── tree-sitter-typescript.wasm
│       ├── tree-sitter-javascript.wasm
│       └── tree-sitter-python.wasm
├── scripts/
│   ├── generate-base-config.cjs        # Node-скрипт, регенерирует base-config.json
│   └── fetch-grammars.cjs              # скачивает WASM-грамматики в public/grammars/
├── server/
│   ├── qwenHandler.mjs                 # shared handler: /generate, /health, dispatchBridge
│   └── prod-server.mjs                 # production: один Node-процесс на dist/ + /generate + /health
├── templates/
│   ├── agent-template.md               # reference для /generate: name, description, model, …
│   └── skill-template.md               # reference для /generate: name, description, priority
├── src/
│   ├── main.tsx, App.tsx, index.css
│   ├── types/index.ts                  # NodeType, *Config, AppNode, AppEdge, Project
│   ├── store/
│   │   ├── useGraphStore.ts            # nodes / edges / selection / projectName
│   │   ├── useFileSystemStore.ts       # picked project directory + lastError
│   │   └── useCodeGraphStore.ts        # code-graph snapshot, scan progress, persist в IDB
│   ├── services/
│   │   ├── qwenClient.ts               # fetch wrapper /generate (relative URL)
│   │   ├── fileSystem.ts               # FS Access API + browser-download fallback
│   │   ├── instructionGenerator.ts     # prompt builder + relativePathForNode + frontmatter parser/validator
│   │   └── treeSitter/
│   │       ├── loader.ts               # WASM runtime init + grammar fetch/IDB-cache
│   │       ├── codeGraph.ts            # CodeEntity/CodeRelation/ParseResult (доменные типы)
│   │       ├── codeGraphStore.ts       # in-memory graph: mergeParseResult, clearGraph, queries
│   │       ├── tsExtractor.ts          # AST walker: TS/JS/Python, вытаскивает entities
│   │       ├── regexExtractor.ts       # fallback parser (regex-based, без wasm)
│   │       ├── codeParserSelector.ts   # runParserForFile: tree-sitter → regex
│   │       ├── folderScanner.ts        # walks picked FileSystemDirectoryHandle → graph
│   │       └── contextCollector.ts     # top-N match node→entities, рендерит Markdown
│   ├── utils/autoLayout.ts             # иерархическая top-down раскладка
│   └── components/
│       ├── GraphCanvas.tsx             # top-level shell, держит React Flow + панели
│       ├── Toolbar.tsx                 # top bar: project name, импорт/экспорт, codegen
│       ├── InstructionGeneratorDialog.tsx # модалка генерации инструкции
│       ├── CodeGraphToolbarButton.tsx  # floating панель сканирования кода
│       ├── nodes/
│       │   ├── OrchestratorNode.tsx    # indigo, target top, source bottom
│       │   ├── SubAgentNode.tsx        # blue, target top, source bottom
│       │   └── SkillNode.tsx           # emerald, target top, source bottom
│       └── panels/
│           ├── NodePalette.tsx         # left: collapse-иконка + draggable cards
│           └── PropertiesPanel.tsx     # right: per-type form + Connections + Delete
```

---

## 5. Модель данных (`src/types/index.ts`)

```ts
NodeType = 'orchestrator' | 'sub_agent' | 'skill'

OrchestratorConfig = { instructions?: string; maxDelegations?: number; instructionFilePath?: string }
SubAgentConfig      = { instructions?: string; tools?: string[]; instructionFilePath?: string }
SkillConfig         = { functionName: string; description: string; parameters?: Record<string,unknown>; instructionFilePath?: string }

BaseNode = { id, type: NodeType, label, config: NodeConfig }
AppNode  = OrchestratorNode | SubAgentNode | SkillNode      // discriminated по type
AppEdge  = { id, source, target, edgeType: 'delegation' | 'skill_attachment' }

Project = { id, name, nodes: AppNode[], edges: AppEdge[], createdAt, updatedAt }
```

Две разные формы:
- **Project form** — то, что попадает в `base-config.json`, `exportProject()`, `importProject()`. Сериализуется как JSON и передаётся через clipboard/filesystem.
- **Wire form** — что внутри Zustand-стора и React Flow. У ноды `{ id, type, position, data: { label, config } }`, у ребра `{ id, source, target, type:'smoothstep', animated, style:{stroke}, data:{edgeType} }`.

Конверсия между ними — в `useGraphStore.ts` (`exportProject`/`importProject`). Позиции при импорте рандомизируются (`{ x: Math.random()*400, y: Math.random()*400 }`) — это нормально, т.к. пользователь обычно сразу жмёт Auto-layout.

---

## 6. State management — `useGraphStore`

Zustand-стор (`src/store/useGraphStore.ts`) с четырьмя полями:

| Поле | Тип | Заметки |
|---|---|---|
| `nodes` | `Node[]` | React Flow shape; `position` мутируется свободно |
| `edges` | `Edge[]` | React Flow shape; `data.edgeType` несёт `delegation`/`skill_attachment` |
| `selectedNodeId` | `string \| null` | управляет правой панелью |
| `projectName` | `string` | отображается в Toolbar, попадает в `Project.name` |

### 6.1 Actions (пошагово что делают)

| Action | Что делает |
|---|---|
| `onNodesChange(changes)` | `applyNodeChanges(changes, state.nodes)` — React Flow передаёт сюда drag/resize/select/delete, стор сам применяет |
| `onEdgesChange(changes)` | то же для рёбер |
| `onConnect(connection)` | 1) ищет ноды-источник и цель; 2) берёт их `type`; 3) `getEdgeType(srcType, dstType)` возвращает `delegation` / `skill_attachment` / `null`; 4) `null` — отмена; 5) иначе создаёт ребро с правильным `style.stroke` (`#6366f1` indigo для delegation, `#10b981` emerald для skill_attachment) и `animated: true/false` |
| `addNode(type, position)` | 1) генерит id `type_N` через module-scoped counter; 2) подбирает дефолтный `label` (`Orchestrator` / `Agent` / `Skill`); 3) кладёт `getDefaultConfig(type)`; 4) push в `nodes` |
| `updateNode(id, { label?, config? })` | spread-merge в `node.data` |
| `deleteNode(id)` | удаляет ноду + все рёбра, где она source/target; если она была выбрана — `selectedNodeId = null` |
| `selectNode(id \| null)` | пишет в `selectedNodeId`; если `null` — `GraphCanvas` размонтирует правую панель |
| `setProjectName(name)` | для input'а в Toolbar |
| `setNodesPositions(positions)` | bulk-обновление координат; используется Auto-layout |
| `clearGraph()` | пустые `nodes`/`edges`, `selectedNodeId = null` |
| `exportProject()` | 1) берёт текущее состояние; 2) собирает `{ id, name, nodes: AppNode[], edges: AppEdge[], createdAt, updatedAt }`; 3) возвращает JSON-строку |
| `importProject(json)` | 1) `JSON.parse`; 2) для каждой ноды генерит id, тип, рандомную позицию, `data: { label, config }`; 3) для каждого ребра восстанавливает `type:'smoothstep'`, `animated`, `style.stroke`, `data.edgeType`; 4) `set({ nodes, edges, projectName })` |

### 6.2 `getEdgeType` — единственный источник истины

Возвращает `delegation`/`skill_attachment`/`null` для пары `(src, dst)`:

```
orchestrator → sub_agent  → delegation
sub_agent    → skill      → skill_attachment
orchestrator → skill      → skill_attachment
всё остальное              → null
```

`isValidConnection` в `GraphCanvas.tsx` — точная зеркальная копия. При добавлении новых рёбер обновлять оба.

### 6.3 Module-scoped counter для id

`nodeIdCounter` и `edgeIdCounter` инкрементируются на каждое создание, нигде не сбрасываются — загрузка всегда даёт уникальные id. При импорте `nodes[].id` берётся из JSON, но позиции всё равно рандомные, поэтому коллизий не бывает.

---

## 7. State management — `useFileSystemStore`

Минимальный стор (`src/store/useFileSystemStore.ts`):

```ts
{ directory: ProjectDirectory | null,
  isSupported: boolean,  // detect showDirectoryPicker at load
  lastError: string | null,
  setDirectory(dir | null), clearDirectory(), setError(msg) }
```

`ProjectDirectory` из `services/fileSystem.ts`:
```ts
{ handle: FileSystemDirectoryHandle, name: string, verifyWritable() }
```

Стор не сериализуется — directory handle живёт только в памяти текущей сессии (handle'ы File System Access API не serializable). `isSupported` выставляется один раз при загрузке модуля.

---

## 8. State management — `useCodeGraphStore`

Стор (`src/store/useCodeGraphStore.ts`) с UI-состоянием сканирования и снапшотом графа кода:

```ts
{
  graph: CodeGraphSnapshot,    // доменная модель — entities + relations
  phase: 'idle'|'scanning'|'done'|'error'|'cancelled',
  error: string | null,
  progress: { scanned, matched, skipped, errors, currentFile? },
  parserUsed: 'tree-sitter'|'regex-fallback'|'mixed'|null,
  setProgress, setPhase, setParserUsed,
  replaceGraph(next), reset()
}
```

### 8.1 `CodeGraphSnapshot` (`services/treeSitter/codeGraphStore.ts`)

```ts
{
  rootPath: string | null,
  parsedAt: string | null,
  entitiesById: Record<id, CodeEntity>,
  entitiesByFile: Record<filePath, id[]>,
  relations: CodeRelation[]
}
```

`CodeEntity` имеет `id` формы `<file>::<kind>::<name>::<line>`, `name`, `kind` (file/class/interface/function/method/variable/enum/module/annotation), `signature`, `bodySnippet`, `docComment`, `startLine`/`endLine`, `language`.

### 8.2 Hydration через IndexedDB

При старте приложения `GraphCanvas` вызывает `hydrateCodeGraphStore()` (в `useEffect`), которая читает последний снапшот из IDB-стора `agent-designer-code-graph` и восстанавливает `graph`. Каждый `replaceGraph` сохраняет новый снапшот — пользователю не приходится пересканировать после reload.

### 8.3 Helpers

`describeGraph(snapshot)` — `{ totalEntities, byKind, byLanguage }` — для UI-карточек статистики.
`findMatchingEntities(graph, query)` — поиск сущностей по имени (для поиска в `CodeGraphToolbarButton`).

---

## 9. Single-port сервер-мост (qwen)

Подробная архитектура — см. фичу 11.8 (генерация инструкции). Краткая суть:

- `server/qwenHandler.mjs` — единственный файл с реальной логикой `spawn('qwen', ['-p', prompt])`. Экспортирует `handleGenerate`, `handleHealth`, `dispatchBridge`.
- `vite.config.ts` — плагин `qwenBridge()`, который dynamic-imports `qwenHandler.mjs` и монтирует middleware в `server.middlewares` через `configureServer` (dev) и `configurePreviewServer` (preview).
- `server/prod-server.mjs` — единый Node-сервер: mux `/generate`+`/health` через `dispatchBridge`, остальное → `dist/<file>` с SPA fallback на `index.html`. Слушает `127.0.0.1:PORT` (default 3001).
- `src/services/qwenClient.ts` — fetch на relative `/generate` (same-origin, без CORS).

То есть и dev, и prod делят один и тот же handler — нет дублирования логики.

---

## 10. Шаблоны (`templates/`)

**`templates/agent-template.md`** — reference для генерации AGENT.md:

```markdown
---
name: agent-name
description: Краткое описание того, когда и как использовать этого агента
model: inherit   # Опционально: inherit, fast, modelId или authType:modelId
approvalMode: auto-edit   # Опционально: default, plan, auto-edit, yolo, bubble
tools:           # Опционально: белый список инструментов
  - tool1
  - tool2
disallowedTools: # Опционально: чёрный список инструментов
  - tool3
---
Содержимое системного промпта.
Поддерживаются несколько абзацев.
```

**`templates/skill-template.md`** — reference для SKILL.md:

```markdown
---
name: your-skill-name
description: Brief description of what this Skill does and when to use it
priority: 10
---

# Your Skill Name

## Instructions
Provide clear, step-by-step guidance for Qwen Code.

## Examples
Show concrete examples of using this Skill.
```

Эти файлы — **источник истины** для фичи 11.8. Они бандлятся в JS через Vite `?raw` import и попадают в промпт Qwen. Output валидируется парсером из `instructionGenerator.ts` (см. фичу 11.8).

---

## 11. Реализованные фичи

### 11.1 Drag-and-drop canvas (добавление нод)

**Где:** `src/components/GraphCanvas.tsx`, `panels/NodePalette.tsx`, `store/useGraphStore.ts`.
**Триггер:** пользователь перетаскивает карточку из левой палитры.

**Step-by-step:**

1. `NodePalette` ставит каждой карточке `draggable`, при `dragstart` пишет `e.dataTransfer.setData('application/reactflow', type)`. Различаются типы: `orchestrator` / `sub_agent` / `skill`.
2. `GraphCanvas` на `<ReactFlow>` через `onDragOver={e => e.preventDefault()}` разрешает drop.
3. `onDrop(e)`:
   - достаёт тип из `e.dataTransfer.getData('application/reactflow')`
   - получает координаты через `screenToFlowPosition({x:e.clientX, y:e.clientY})` из `useReactFlow()`
   - вызывает `addNode(type, position)` из стора
4. `addNode` (см. §6.1) создаёт ноду с дефолтными label/config и новым id.
5. React Flow через `applyNodeChanges` рендерит новую ноду.

**Как расширить:**
- Добавить тип — см. §14.

---

### 11.2 Свойства ноды + формы по типу

**Где:** `src/components/panels/PropertiesPanel.tsx`, `src/types/index.ts`.
**Триггер:** клик по ноде → `selectNode(nodeId)` → `selectedNodeId !== null` → правый panel монтируется.

**Step-by-step:**

1. `PropertiesPanel` ищет `nodes.find(n => n.id === selectedNodeId)`. Если нет — `GraphCanvas` вообще не рендерит компонент (auto-hide).
2. Хедер с themed background (indigo/blue/emerald) показывает тип ноды, label, кнопку `×` (вызывает `selectNode(null)` → panel размонтируется).
3. `handleConfigChange(key, value)` вызывает `updateNode(nodeId, { config: { ...cfg, [key]: value } })` — merge-обновление.
4. Per-type форма:
   - **OrchestratorFields**: `instructions` textarea, `maxDelegations` number (1–20). Под textarea — кнопка `<GenerateButton>` для открытия `InstructionGeneratorDialog`.
   - **SubAgentFields**: `instructions` textarea + список attached skills (вычисляется по входящим `skill_attachment`-рёбрам). Под textarea — `<GenerateButton>`.
   - **SkillFields**: `functionName`, `description` (textarea) + JSON `parameters` (с `try/catch` молчаливым игнорированием невалидного JSON). Под `description` — `<GenerateButton>`.
5. Секция "Connections" — список всех incident edges (source или target), показывает «label соседа + тип ребра».
6. Кнопка `Delete Node` внизу → `deleteNode(id)`.

`TextareaField`, `NumberField`, `GenerateButton` — локальные компоненты в том же файле.

**Как расширить:**
- Добавить type — см. §14, плюс форма и генератор.

---

### 11.3 Свёртываемая левая панель

**Где:** `src/components/panels/NodePalette.tsx`.
**Триггер:** клик по `ChevronLeft` в header'е (или на свёрнутом — `ChevronRight`).

**Step-by-step:**

1. Локальный `useState<boolean>(false)` хранит `collapsed`.
2. `collapsed=true`:
   - Ширина: `w-16` (64 px).
   - Шапка: одна кнопка `ChevronRight` (icon) для разворачивания.
   - Тело: `paletteItems.map(...)` рендерит только иконки (без label/description), вертикально, с `title=...` для tooltip.
   - Каждая иконка-карточка остаётся `draggable` — перетаскивание работает и в свёрнутом виде.
3. `collapsed=false`:
   - Ширина: `w-72`.
   - Header: иконка `Layers` + «Components» + subtitle «Drag to canvas» + кнопка `ChevronLeft` свернуть.
   - Body: три большие карточки с icon, label, description, hover-glow.
4. State — локальный, не персистится.

**Как расширить:**
- Сохранять состояние — перенести флаг в `useGraphStore` (или отдельный `useUiPrefsStore`).

---

### 11.4 Автоскрытие правой панели

**Где:** `src/components/GraphCanvas.tsx`.
**Триггер:** `selectedNodeId === null`.

**Step-by-step:**

1. `GraphCanvas` читает `selectedNodeId` из стора.
2. В JSX:
   ```tsx
   {selectedNodeId !== null && <PropertiesPanel />}
   ```
   — компонент физически не рендерится, его DOM размонтируется.
3. `×` в PropertiesPanel вызывает `selectNode(null)` — это эквивалент сворачивания.

Никакого local state — `selectedNodeId` уже служит индикатором.

---

### 11.5 Auto-layout (workflow кнопка в Controls)

**Где:** `src/utils/autoLayout.ts`, `src/components/GraphCanvas.tsx`, `store/useGraphStore.ts`.
**Триггер:** клик по `Workflow`-иконке в правом нижнем углу холста.

**Step-by-step:**

1. `<Controls>` от React Flow содержит zoom/fit-view плюс разделитель и custom `<ControlButton onClick={handleAutoLayout}>` с `Workflow`-иконкой. Кнопка disabled при пустом холсте.
2. `handleAutoLayout`:
   - Берёт текущие `nodes`, `edges` из стора.
   - Вызывает `autoLayout(nodes, edges)` — получает `Record<id, {x, y}>`.
   - `setNodesPositions(positions)` — bulk-update координат всех нод в сторе.
   - `requestAnimationFrame(() => fitView({ duration: 400, padding: 0.1 }))` — подгоняет viewport к новым границам после раскладки.

**Алгоритм `autoLayout` (иерархический, без перекрытий):**

1. Строит `childrenOf: Map<source, target[]>` и `incoming: Set<id>` из рёбер. Self-loop'и и невалидные target'ы пропускаются.
2. Roots = ноды без входящих рёбер. Сортируются по `nodeSortKey` (стабильно по `type_N`).
3. Мемоизированный `computeWidth(id, stack)`:
   - leaf (нет детей) → `NODE_WIDTH = 240`
   - internal → `max(NODE_WIDTH, Σ child_width + (n-1) * X_SPACING)`, `X_SPACING = 60`
   - cycle защита через `Set`
4. `place(id, leftX, depth)`:
   - узел центрируется над своим subtree: `x = leftX + subtreeWidth/2 - NODE_WIDTH/2`
   - `y = depth * LEVEL_HEIGHT`, `LEVEL_HEIGHT = 300`
   - дети рекурсивно кладутся с курсором по `leftX`, с шагом `cw + X_SPACING`
5. Между root-компонентами — `ROOT_X_SPACING = 100`.
6. Ноды, для которых нет позиции в выводе (крайне редко), сохраняют текущую.

Результат: для базовой конфигурации (213 узлов) — 3 уровня, **0 наложений** в одном уровне.

**Step-by-step валидация на базовой конфигурации:**
- 8 roots (все 8 орчестраторов — нет входящих рёбер)
- Width: 49 180 px, 3 горизонтальных уровня
- Horizontal overlaps in same level: **0**

**Как расширить:**
- Изменить `NODE_WIDTH`/`X_SPACING`/`LEVEL_HEIGHT` под более широкие карточки.
- Поддержать radial / force layouts — заменить `place(...)` другим алгоритмом, контракт `Record<id, {x,y}>` остаётся.

---

### 11.6 Toolbar (имя проекта, импорт, экспорт, Clear)

**Где:** `src/components/Toolbar.tsx`, `store/useGraphStore.ts`.

**Step-by-step:**

1. **Top bar** с логотипом (`Layers`), `<input>` для `projectName` (controlled, `onChange={e => setProjectName(e.target.value)}`).
2. **Живые счётчики** — три chip'а с цветными точками: `nodes.filter(n => n.type === 'orchestrator').length` и т.д.
3. **Import** — `<input type="file" accept=".json" hidden>` реф. Клик по кнопке открывает диалог выбора файла. На `change`: `FileReader.readAsText` → `importProject(content)`.
4. **Export** — `exportProject()` → `Blob` с `application/json` → `<a download>` кликается программно → URL.revokeObjectURL. Имя файла: `<projectName>.json` со whitespace, заменённым на `_`.
5. **Generate Code** — отдельная фича, см. §11.7.
6. **Clear** — `confirm()` → `clearGraph()` (все ноды/рёбра, `selectedNodeId = null`).

---

### 11.7 Python codegen (`generateAgentCode`)

**Где:** `src/components/Toolbar.tsx`, `generateAgentCode(projectJson: string)`.
**Триггер:** кнопка «Generate Code» в Toolbar.

**Step-by-step:**

1. `handleGenerateCode` вызывает `exportProject()` → получает JSON-строку проекта.
2. Парсит её, фильтрует ноды по типу: `orchestrators`, `agents`, `skills`.
3. Строит:
   - `@dataclass` для каждого **Skill** с `name` (из `functionName` или label), `description`, опционально `parameters`.
   - Map `agentSkillsMap[agentId]`: для каждого sub-agent собирает список классов скилов через рёбра `skill_attachment`.
   - `@dataclass` для каждого **Sub-Agent** с `name`, `instructions`, `tools: List[Any] = field(default_factory=lambda: [<SkillClass>()])`.
   - Map `orchestratorAgentsMap[orchId]`: для каждого орчестратора собирает список классов агентов через рёбра `delegation`.
   - `@dataclass` для каждого **Orchestrator** с `name`, `instructions`, `max_delegations`, `sub_agents: List[Any] = ...`.
4. Генерирует `create_agent_graph()` factory → возвращает dict `{"orchestrators":[...], "agents":[...], "skills":[...]}`.
5. Печатает `if __name__ == "__main__":` entrypoint с количествами.
6. Имена классов — через `toPascalCase(label)` (split на `[\s_-]+`, capitalize каждое слово). Поэтому labels лучше делать PascalCase-friendly.
7. Скачивает `*_agents.py` тем же механизмом Blob + `<a>`.

**Как расширить:**
- Добавить вывод typing imports (`from typing import List, Dict, Any` уже есть) — норма.
- Включить per-skill `parameters` typing — сейчас сериализуется как `Dict[str, Any]`.

---

### 11.8 Генерация Markdown-инструкции через Qwen

**Где:** `src/components/InstructionGeneratorDialog.tsx`, `src/services/instructionGenerator.ts`, `src/services/qwenClient.ts`, `server/qwenHandler.mjs`, `templates/*.md`.

Полный pipeline состоит из трёх фаз: **сборка промпта → вызов Qwen → валидация и сохранение**.

#### 11.8.1 Сборка промпта (`buildPromptForNode`)

1. Импортируются raw-строки шаблонов через Vite `?raw`:
   ```ts
   import agentTemplate from '../../templates/agent-template.md?raw';
   import skillTemplate from '../../templates/skill-template.md?raw';
   ```
2. Извлекаются метаданные ноды:
   - `node.type` (для skill: `functionName`, `description`; для agent: `instructions`, `maxDelegations`).
   - `safeSlug(label)` вычисляется один раз и помещается в промпт как «Slug (use as `name`)» — это гарантирует, что Qwen использует стабильное имя.
3. Считается upstream/downstream через React Flow edges:
   - `edges.filter(e => e.target === node.id).map(e => nodes.find(n => n.id === e.source)?.data.label)` — upstream.
   - `edges.filter(e => e.source === node.id).map(e => nodes.find(n => n.id === e.target)?.data.label)` — downstream.
4. **Опционально** — `collectContextForNode(node, codeGraph)`:
   - Берёт top-5 матчей из code-graph по `safeSlug(label)` + `functionName` + tokens из `instructions`.
   - Скоринг: точное совпадение имени = 10, substring = 4, штраф за тривиальные accessor'ы.
   - Рендерит Markdown блок с сигнатурами, `file:line`, doc-comments, обрезанными телами в fenced block'е (` ```ts ` или ` ```python `).
5. Склеиваются блоки промпта в фиксированном порядке:
   ```
   - intro (what you're doing)
   - ## Node
   - ## Upstream / ## Downstream
   - ## Project Code Context
   - ## User Request
   - ## Template (output MUST match this structure)
   - ## <Skill|Agent> — Required Frontmatter
   - ## <Skill|Agent> — Required Body
   - ## Output Rules
   ```
6. Шаблон (`skill-template.md` или `agent-template.md`) вставляется целиком в fenced code block — Qwen видит точную структуру с комментариями.

#### 11.8.2 Сетевой вызов

1. `qwenClient.generateViaQwen(prompt)`:
   - `fetch('/generate', { method:'POST', headers:'application/json', body:JSON.stringify({prompt}) })`
   - Same-origin, no CORS.
   - `QwenUnavailableError` бросается на network/non-2xx/JSON-`error`.
2. На сервере (`server/qwenHandler.mjs` → `handleGenerate`):
   - `JSON.parse` body → `{ prompt: string }`.
   - `validate`: prompt required, ≤256 KB.
   - `spawn('qwen', ['-p', prompt], { shell: win32 })` с `process.env`.
   - Слушает stdout/stderr, таймаут `QWEN_TIMEOUT_MS` (default 120 s) — SIGTERM при таймауте.
   - Возвращает `{ result: stdout, error: null|string }` с правильным HTTP-кодом (200/400/502/504).
3. Vite-middleware (dev) или `prod-server.mjs` (prod) обслуживают этот handler — никаких изменений в кодовой базе для переключения режима.

#### 11.8.3 Валидация и сохранение

1. Response приходит → `setDraft(result.trim())` в dialog state.
2. `parseMarkdownFrontmatter(text)`:
   - Проверяет `text.startsWith('---')`.
   - Ищет ближайшую закрывающую строку `---` на отдельной строке.
   - Между ними парсит YAML subset: `key: scalar | list | empty`, с поддержкой `# comment` и кавычек вокруг строк.
   - Возвращает `{ frontmatter: {...}, body: string, missingRequired: [], errors: [] }`.
3. `validateSkillFrontmatter(parsed)` / `validateAgentFrontmatter(parsed)`:
   - `SKILL_EXPECTATIONS.required = ['name', 'description']`, optional = `['priority']`, bodyHeadings = `['Instructions', 'Examples']`.
   - `AGENT_EXPECTATIONS.required = ['name', 'description']`, optional = `['model', 'approvalMode', 'tools', 'disallowedTools']`.
   - Проверяет `name` формат `/^[a-z0-9_]+$/` (snake_case).
   - Сообщает о пропавших секциях body — каждое отсутствующее heading добавляет в `errors`.
4. `<ValidationChip draft nodeType />`:
   - пустой draft → серое italic напоминание.
   - `schemaOk` (нет missing и нет errors) → зелёный `✓ template — Matches the … structure`.
   - иначе → янтарный `⚠ template — missing name · Body is missing `## Instructions``.
5. Когда пользователь жмёт **Save**:
   - `relativePathForNode(node)`:
     - skill → `skills/<slug>/SKILL.md`
     - orchestrator/sub_agent → `agents/<slug>/AGENT.md`
     - где `slug = safeSlug(label)`
   - `applyToConfig(text, path)` обновляет `config.description` (для skill) или `config.instructions` (для агента) и `config.instructionFilePath = path`.
   - Запись на диск (`writeInstructionToDisk`) или скачивание (`downloadAsFile`):
     - File System Access API: walk через `getDirectoryHandle(part, {create:true})`, `getFileHandle(name, {create:true})`, `createWritable().write(text)`.
     - Fallback: Blob + `URL.createObjectURL` + `<a download>`.
     - При записи без папки — текст ещё и кладётся в in-memory Map через `rememberInMemory` (для пере-открытия диалога в той же сессии).
   - `updateNode(nodeId, { config })` фиксирует изменения в сторе.
6. Dialog закрывается, UI показывает «✓ saved to skills/foo/SKILL.md» в label'е превью.

#### 11.8.4 Ошибки и UX

| Симптом | Что видит пользователь |
|---|---|
| `qwen` не в PATH | Диалог показывает красный блок: «could not spawn qwen: … Set QWEN_COMMAND.» |
| Bridge не отвечает | «Cannot reach the qwen bridge. Make sure the dev server or prod server is running.» |
| Браузер без FS Access | Поле выбора папки скрыто; кнопка Save превращается в «Save & download»; файл скачивается через браузер |
| Папка без write-разрешения | «You did not grant write access. Re-pick the folder and allow modification.» |
| YAML frontmatter отсутствует или невалиден | `<ValidationChip>` показывает конкретную причину (`missing name`, `Body is missing \`## Instructions\`` и т.п.) |

**Контракт шаблонов** (высокоуровневый):
- Agent: frontmatter — `name` (snake_case), `description`; опционально `model` (`inherit`/`fast`/modelId/authType:modelId), `approvalMode` (`default`/`plan`/`auto-edit`/`yolo`/`bubble`), `tools`, `disallowedTools`. Body — многоабзацный system prompt.
- Skill: frontmatter — `name` (snake_case), `description`; опционально `priority` (int 1-100). Body — `# <title>` + `## Instructions` + `## Examples`.
- `name` берётся из `safeSlug(node.label)` — этот slug передаётся в промпте, чтобы Qwen использовал согласованное имя.

**Как расширить:**
- Добавить новое обязательное поле в `SKILL_EXPECTATIONS.required`/`AGENT_EXPECTATIONS.required` — диалог сразу начнёт его проверять.
- Сменить тон/дополнительные секции — правится шаблон в `templates/*.md` + Vite пересоберёт бандл на лету.
- Заменить `runParserForFile` на LLM-based анализ кода для первого прохода планирования.

---

### 11.9 Tree-sitter code-graph scan

**Где:** `src/services/treeSitter/*`, `src/store/useCodeGraphStore.ts`, `src/components/CodeGraphToolbarButton.tsx`, `scripts/fetch-grammars.cjs`.

#### 11.9.1 Загрузка WASM

1. `scripts/fetch-grammars.cjs` скачивает runtime (`web-tree-sitter.wasm` из `node_modules/`) и грамматики (`tree-sitter-{typescript,javascript,python}.wasm`) с официальных GitHub-релизов, кладёт в `public/grammars/`. Закреплённые версии — env-переменными (`TREE_SITTER_TYPESCRIPT_VERSION` и т.п.).
2. `npm run grammars` запускает этот скрипт.
3. Vite отдаёт `/grammars/*.wasm` из `public/`. Prod-сервер отдаёт их же из `dist/grammars/*.wasm`.
4. `services/treeSitter/loader.ts`:
   - `Parser.init({ locateFile: name => \`/grammars/${name}\` })` — runtime self-locates.
   - `getLanguage(lang)` для каждого языка: `fetch(url)` → `arrayBuffer()` → сохраняет в IDB-стор `agent-designer-grammar-cache` → `Parser.Language.load(new Uint8Array(buf))`.
   - `detectAvailableGrammars()` — HEAD-запросы для каждого URL, чтобы UI пометил «tree-sitter available» / «regex fallback» без подгрузки.

#### 11.9.2 Парсер: tree-sitter или regex (`codeParserSelector.runParserForFile`)

1. `languageForExtension(ext)` маппит расширение в `SupportedLanguage` (`typescript|tsx|javascript|python`).
2. Сначала пробует `TreeSitterCodeParser.parseFile(filePath, source)` (async):
   - `getLanguage(resolution.language)` → загружает Language.
   - `new Parser().setLanguage(lang).parse(source)` → `tree.rootNode`.
   - `extractForResolution(tree, filePath, source, resolution)`:
     - для `python` → `extractEntities_Python`.
     - иначе → `extractEntities_TS` (TS/JS/TSX).
3. При ошибке или отсутствии грамматики — `RegexCodeParser.parse(filePath, source, language)`:
   - TS/JS: regex'ы для `class`/`interface`/`function`/`enum`/`type`/`const`/`import`, brace-balanced для тела.
   - Python: regex'ы для `class`/`def`/`import`, indent-balanced для тела.
4. Оба возвращают единый `ParseResult`: `{ entities, relations }`.

#### 11.9.3 Extractor (TS/JS) — что вытаскивается

- `function_declaration`, `generator_function_declaration`, `arrow_function` (внутри `variable_declarator`)
- `class_declaration`/`class`, `interface_declaration`, `enum_declaration`
- `method_definition`
- `import_statement` (создаёт module entities + `imports` relation)
- `export_statement` (рекурсия в inner)
- `lexical_declaration` (recurse в `variable_declarator`)
- Каждый entity: `id`, `kind`, `name`, `signature`, `bodySnippet` (≤24 строк, ≤2.4 KB), `docComment`, `filePath`, `startLine`/`endLine`, `language`, `parentId`.

#### 11.9.4 Extractor (Python)

- `function_definition`, `class_definition`, `import_statement`/`import_from_statement`, `decorated_definition`.

#### 11.9.5 Folder scanner (`folderScanner.scanProjectDirectory`)

1. Требует `FileSystemDirectoryHandle` (FS Access API). Если недоступно — выбрасывает ошибку.
2. Строит `progress = { scanned, matched, skipped, errors, done }`.
3. `walk(dir.handle, '')` рекурсивно собирает пути через `handle.entries()`. Пропускает `node_modules`, `.git`, `dist`, `coverage`, `target`, `__pycache__`, директории начинающиеся с `.`.
4. Фильтрует по `languageForExtension(ext)` — увеличивает `matched`.
5. Останавливается при `options.maxFiles` или сигнале отмены.
6. Обрабатывает matched в чанках по 25 файлов:
   - Для каждого файла: `getDirectoryHandle(parts) → getFileHandle(name) → file.text()`.
   - Файл >1 MiB → `skipped++`.
   - `runParserForFile(filePath, source)` → `mergeParseResult(graph, ...)` (pre-drop entities по файлу + push новых + добавить relations).
   - `await new Promise(r => setTimeout(r, 0))` между чанками — yield UI thread.
7. По завершении — `progress.done = true`.

`mergeParseResult(snapshot, { filePath, entities, relations })`:
- Удаляет все ранее существующие entities по этому файлу (через `entitiesByFile[filePath]`) + связанные relations.
- Добавляет новые entities и relations.

#### 11.9.6 UI: плавающая панель `CodeGraphToolbarButton`

1. Bottom-left, fixed, открывается по клику.
2. Если `directory` не выбрана — кнопка Scan now сначала зовёт `pickProjectDirectory()`, потом сканирование.
3. `beginScan`: status `scanning`, прогресс через `onProgress`, по завершении `replaceGraph(graph)` → IDB-сохранение.
4. **Search** по имени (top-8 совпадений из `findMatchingEntities`).
5. **Stats**: сетка с подсчётом per kind.
6. **Parser indicator**: `tree-sitter` / `regex-fallback` показывается как маленькая pill.

#### 11.9.7 Context collector

1. `codeNameCandidates(node)`:
   - Skill: `safeSlug(label)`, `safeSlug(functionName)`.
   - Agent/Orchestrator: `safeSlug(label)` + первые ~6 токенов из `instructions`, прошедшие фильтр `^[a-zA-Zа-яА-ЯёЁ_][\w]*$`.
2. `collectContextForNode(node, graph)`:
   - Скорит все entities (не file/module) по совпадению имён с candidates (exact=10, substring=4), штраф −1 для коротких (≤80 chars) function-entities.
   - Берёт top-5, рендерит Markdown с `### <signature>`, `*File:* \`path\`, line N`, JSDoc/doc, обрезанный body в ` ```ts ` или ` ```python `.

`buildPromptForNode` инжектит результат под `## Project Code Context` — Qwen использует это как ground truth, не как намёк.

#### 11.9.8 Снапшот в IndexedDB

- Стор `agent-designer-code-graph` (version 1), ключ `'latest'`.
- `hydrateCodeGraphStore()` читает на старте.
- `replaceGraph` пишет после каждого скана.
- `reset` очищает и UI и persistence.

#### 11.9.9 Failure modes

| Симптом | Поведение |
|---|---|
| WASM 404 на `/grammars/*` | `runParserForFile` ловит, fallback на `RegexCodeParser`. UI работает, entities менее точны. |
| Браузер без FS Access | Скан недоступен; dialog прячет trigger или показывает ошибку |
| Файл >1 MiB | Тихо пропускается |
| Сетевой сбой при первой загрузке | IDB cache используется на следующем визите |

---

### 11.10 Семантическое обогащение графа кода через Qwen

Поверх tree-sitter scanner'а лежит слой семантики: Qwen получает сигнатуру + тело каждой сущности, попавшей в контекст, и возвращает короткое описание роли (`controller`/`service`/`repository`/…) плюс one-line summary. Результат кешируется и подставляется в `## Project Code Context` под каждой сущностью, чтобы основной вызов `/generate` получал уже размеченную выжимку вместо сырых сигнатур.

#### Архитектура

```
        InstructionGeneratorDialog
        ↓ click "Generate"
        buildPromptForNode (async)
        ↓
        collectContextForNode (async)
        ├─ candidates ─ top N matches by name ─┐
        ↓                                      │
        enrichEntities(entities, onProgress)   │
        │  for each entity (sequential):        │
        │   enrichEntity(entity)                │
        │     ├─ semanticCache.get (IDB-first)  │
        │     ├─ cache miss → qwen -p prompt    │
        │     ├─ parse РОЛЬ / ОПИСАНИЕ lines     │
        │     └─ semanticCache.set (write-through)
        ├─ re-rank by role-bonus                 │
        └─ render Markdown                       │
        ↓
        POST /generate  (single, with enriched Markdown)
        ↓
        write SKILL.md / AGENT.md + updateNode
```

#### Файлы

| Файл | Роль |
|---|---|
| `src/services/semanticCache.ts` | Кеш `entityId → {role, description, timestamp}`: in-memory `Map` + IDB (через `idb-keyval`, store `'agent-designer-semantic-cache'`). API: `getSync`, `setSync`, `loadFromDB`, `persistToDB`, `get`, `set`, `clear`, `size`. |
| `src/services/semanticEnricher.ts` | `enrichEntity(entity)` → `SemanticInfo`. Кеш → Qwen → парсер → кеш. `enrichEntities(entities, onProgress)` — последовательно, репортит прогресс. Fallback: `{ role: 'unknown', description: 'Не удалось определить' }` при любой ошибке. |
| `src/services/treeSitter/contextCollector.ts` | (обновлено) — `collectContextForNode` теперь async, принимает `onProgress`. Делит candidate'ов на `enrichPoolSize` (default 15), просит обогащение, ре-ранкирует по признанной роли и рендерит Markdown с `**Role:**` + `**Summary:**` блоками. |
| `src/services/instructionGenerator.ts` | `buildPromptForNode` стал async. Принимает `codeGraph` + `onEnrichmentProgress` в input. Если `codeGraph` пуст — context блок пропускается. Если передан `precomputedCodeContext` — используется verbatim (полезно для тестов). |
| `src/components/InstructionGeneratorDialog.tsx` | Новый state `enrichment { current, total, entityName, phase }`. Кнопка показывает `Анализирую N/M · <entity>` во время enrichment и `Генерирую…` во время основного вызова. |
| `src/components/CodeGraphToolbarButton.tsx` | Clear-button теперь также зовёт `semanticCache.clear()` чтобы не использовать кэш на новом проекте. |
| `src/components/GraphCanvas.tsx` | `useEffect` дополнительно вызывает `semanticCache.loadFromDB()` при старте. |

#### Step-by-step

1. **Гидрация при старте** (`GraphCanvas`): вызов `semanticCache.loadFromDB()` подтягивает все IDB-записи в `Map` (memory-first).
2. **Клик Generate**: dialog ставит `enrichment.phase = 'enriching'` и зовёт `buildPromptForNode(node, userRequest, { codeGraph, onEnrichmentProgress })`.
3. **`buildPromptForNode`**: проверяет `codeGraph.entitiesById`. Если пуст — context блок пропускается; иначе зовёт `collectContextForNode`.
4. **`collectContextForNode`**:
   - Строит `candidates` из `safeSlug(label)` + `functionName` (skill) / первых токенов `instructions` (agent).
   - Скорит все entities по совпадению имени (exact=10, substring=4, штраф за accessor'ы).
   - Top-`enrichPoolSize` (default 15) сущностей отдаются `enrichEntities`.
   - После enrichment — re-rank: узнанная роль (`≠ 'unknown'`) даёт +5, непустое описание даёт +1.
   - Top-10 попадают в рендер.
5. **`enrichEntities` → `enrichEntity`** для каждой сущности:
   - `semanticCache.get(entityId)` — id, синхронно in-memory, иначе IDB, hydrate memory по попаданию.
   - Hit → возврат, без сетевого вызова.
   - Miss → `qwenClient.generateViaQwen(buildEnrichmentPrompt(entity))`.
   - Промпт включает `name`, `kind`, `signature`, обрезанное до 2000 символов `bodySnippet`, `docComment`. В конце требуемый формат ответа: `РОЛЬ: <word>` + `ОПИСАНИЕ: <sentence>`.
   - Парсер ловит обе строки регэкспом `^\s*РОЛЬ\s*:\s*(.+?)\s*$` / `^\s*ОПИСАНИЕ\s*:\s*(.+?)\s*$` (case-insensitive).
   - Роль нормализуется через whitelist (`controller`, `service`, `repository`, `factory`, `adapter`, `configuration`, `entity`, `dto`, `mapper`, `handler`, `validator`, `utility`, `middleware`, `guard`, `filter`, `resolver`, `provider`, `helper`, `composable`, `hook`, `unknown`) — всё остальное падает в `unknown`.
   - Описание клипается до 100 символов.
   - Любая ошибка → fallback `SemanticInfo { role: 'unknown', description: <message> }`.
6. **`semanticCache.set(info)`** пишет в memory + IDB (через `idb-keyval.get/set`).
7. **`buildPromptForNode`** получает готовый Markdown и вставляет под `## Project Code Context`.
8. Dialog переходит в `phase = 'generating'`, делает `generateViaQwen(prompt)` (как раньше).
9. Ответ приходит → standard flow (template alignment, save).

#### Когда `cache` не помогает

- **Qwen CLI недоступен** — fallback `{ role: 'unknown', description: 'Cannot reach the qwen bridge…' }`. UI продолжает работать; промпт содержит entity без `Role:` / `Summary:` строк.
- **`enrichPoolSize = 0`** или `skipEnrich: true` — сущности пройдут с приглушённым placeholder'ом.
- **Парсер не вытащил `ОПИСАНИЕ`** — description становится `'Не удалось распарсить ответ Qwen'`, role — как обычно.
- **Нет entities в pool** (мало матчей по имени) — context блок опускается целиком.

#### Failure modes

| Симптом | Поведение |
|---|---|
| Qwen упал в середине enrichment | Loops incomplete, возвращаются fallback'и, генерация всё равно продолжается |
| Браузер без IDB | `idb-keyval` генерирует exception → ловится в `semanticCache`, in-memory-only |
| Кеш устарел после Clear | `semanticCache.clear()` стирает и IDB, и memory |
| Одну и ту же сущность попросили разные ноды | Один enrichment-кэш на entityId, всё ОК |

#### Метрики

- Типичный сценарий: 5–15 матчей → большая часть из кеша после первого скана.
- Холодный старт: ≈ N × 1–3 s для N свежих сущностей (sequential CLI).
- IDB cache hit-ratio: после первого дня использования стремится к 100%.

---

## 12. Build & dev

```sh
npm install
node scripts/fetch-grammars.cjs   # вендорит WASM в public/grammars/

npm run dev        # vite @ :5173, /generate middleware активен
npm run build      # tsc -b + vite build → dist/
npm run prod       # node server/prod-server.mjs @ :3001 (dist/ + /generate)
npm run server     # build && prod
npm run preview    # vite preview @ :4173, /generate middleware активен
npm run grammars   # обновить public/grammars/*.wasm
npm run lint       # oxlint

# Регенерировать base-config.json:
node scripts/generate-base-config.cjs
```

Environment overrides (все опциональны):

| var | default | значение |
|---|---|---|
| `PORT` | `3001` (prod) | listen port (dev — Vite 5173) |
| `HOST` | `127.0.0.1` | bind host |
| `QWEN_COMMAND` | `qwen` | CLI-бинарь, вызываемый с `-p <prompt>` |
| `QWEN_TIMEOUT_MS` | `120000` | таймаут per-request |

---

## 13. Conventions

- **Strict TS, `verbatimModuleSyntax`** — для всех type-only импортов используется `import type { ... }`.
- **Tailwind `!`-prefix** — переопределяет стили library-defaults (особенно `<Controls>`/`<MiniMap>` className).
- **Glass/dark theme** — slate/indigo/blue/emerald; surfaces `slate-900/95`/`slate-800/50` поверх тёмного градиента.
- **Данные ноды** живут в `node.data.label` и `node.data.config`, не на самой ноде. Не писать в `node.label`.
- **ID для рёбер** должны быть валидными React Flow id'ами — они становятся `source`/`target`.
- **Module-scoped counter** для id (`nodeIdCounter`, `edgeIdCounter`) никогда не сбрасываются.
- **`getEdgeType`** — единственный источник правил допустимых рёбер. `isValidConnection` в `GraphCanvas.tsx` — его зеркало. Держать в синхроне.
- **Шаблоны** в `templates/*.md` — единственный источник истины для генерации инструкций. Парсер там же валидирует output.
- **`safeSlug(node.label)`** — канонический `name` для генерации.
- **Никаких тестов** пока — проверять `npm run build` (полная tsc-проверка) + ручной `npm run dev`.

---

## 14. How to extend (готовые рецепты)

### 14.1 Добавить новый тип ноды

1. `NodeType` в `src/types/index.ts` ← новый литерал.
2. Новая `XxxConfig` + расширить union `NodeConfig`.
3. `useGraphStore.ts`:
   - `getDefaultConfig` — ветка switch.
   - `getEdgeType` — при необходимости новые связи.
4. Новая `XxxNode.tsx` + реэкспорт из `nodes/index.ts`.
5. `nodeTypes` в `GraphCanvas.tsx` — зарегистрировать.
6. `paletteItems` в `NodePalette.tsx` — добавить карточку.
7. `PropertiesPanel.tsx` — `XxxFields` + прокинуть в type-dispatch + `<GenerateButton>` если нужна генерация.
8. `Toolbar.tsx` `generateAgentCode` — добавить dataclass-вывод если язык должен попасть в Python.

### 14.2 Добавить новый тип ребра

1. `EdgeType` в `src/types/index.ts`.
2. `getEdgeType` в сторе.
3. `isValidConnection` в `GraphCanvas.tsx`.
4. Цвет и `animated` в `onConnect` стора (там же выбирается стиль).
5. Custom renderer: добавить в `defaultEdgeOptions` `type="yourEdgeType"` и зарегистрировать в `edgeTypes` в `GraphCanvas.tsx`.

### 14.3 Добавить новый tool в Toolbar

- Добавить кнопку в `Toolbar.tsx`. Если нужны новые поля в сторе — расширить `useGraphStore`.

### 14.4 Добавить новый control в нижнюю правую панель

- В `GraphCanvas.tsx` в `<Controls>` вставить ещё один `<ControlButton>`. Шаблон — `handleAutoLayout` (использует `useReactFlow().fitView`).

### 14.5 Добавить новый обязательный frontmatter-key в генерации

- `instructionGenerator.ts` → `AGENT_EXPECTATIONS.required` или `SKILL_EXPECTATIONS.required`.
- Шаблон в `templates/*.md` — добавить ключ с примером значения.
- `buildPromptForNode` — расширить секцию «Required Frontmatter».
- `<ValidationChip>` подсветит `missing <key>` без дополнительной правки.

### 14.6 Добавить новый язык в tree-sitter

1. `scripts/fetch-grammars.cjs` → `LANGUAGE_GRAMMARS` (repo, asset, tag, env-var).
2. `npm run grammars`.
3. `services/treeSitter/loader.ts` → `GRAMMARS[<lang>]` (extensions + url).
4. `tsExtractor.ts` — добавить правила для своего AST (если хочется лучше regex'а).
5. `regexExtractor.ts` — добавить regex-правила как fallback.

### 14.7 Заменить FS Access API на полноценную VFS

- В `services/fileSystem.ts` добавить `IndexedDB`-backed `writeInstructionToDisk` (например, через `idb-keyval`).
- Старый `writeInstructionToDisk` остаётся fallback'ом.

---

## 15. Резюме поведения пользователя

Полный happy-path от пустого холста до готового Python-проекта:

1. Открыть http://localhost:5173.
2. Перетащить Orchestrator из палитры в центр.
3. Перетащить Agent — соединить handle снизу orchestrator'а с handle сверху agent'а.
4. Перетащить Skill — соединить с agent'ом.
5. Выбрать Agent → в правой панели открыть «Generate instruction with Qwen» → ввести запрос → «Generate» → отредактировать preview → «Save» (выбрать папку проекта через «Pick folder…», или «Save & download»).
6. Повторить для остальных нод.
7. Toolbar → Auto-layout (`Workflow` иконка) — граф выстроится.
8. Toolbar → Export — скачать JSON проекта.
9. Toolbar → Generate Code — скачать `*_agents.py` для Python runtime.

Опционально (если в папке проекта есть код):
10. Кнопка «Code graph» (bottom-left) → «Scan now» — собирает граф кода. Дальнейшие генерации инструкций используют этот контекст.
