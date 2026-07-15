# Agent Designer

Visual designer for AI-agent graphs. Drag orchestrators, sub-agents and skills
onto a canvas, connect them, edit properties, generate Markdown instructions
via a local Qwen CLI, and let the same project scan the real code you have on
disk via tree-sitter — all client-side, all from one dev server.

## Quick start

```sh
npm install
node scripts/fetch-grammars.cjs   # download tree-sitter language WASMs
npm run dev                       # opens http://localhost:5173
```

## Optional: AI instruction generation

The "Generate instruction with Qwen…" button inside a node's PropertiesPanel
talks to a local bridge server that shells out to the `qwen` CLI.

In a second terminal:

```sh
npm run server     # starts the bridge on http://localhost:3001
```

Environment overrides (all optional):

| variable | default | meaning |
|---|---|---|
| `PORT` | `3001` | listen port |
| `HOST` | `127.0.0.1` | bind host (kept `localhost` only by default) |
| `QWEN_COMMAND` | `qwen` | binary to invoke (point at any LLM CLI that takes `-p "<prompt>"`) |
| `QWEN_TIMEOUT_MS` | `120000` | per-request timeout |
| `CORS_ORIGIN` | `http://localhost:5173` | which dev origin may call the server |

When the server is unreachable the dialog surfaces a clear error and the rest
of the app keeps working.

## Code-graph scan

The bottom-left `Code graph` button opens a floating panel that walks the
project folder you picked in the instruction dialog, parses each supported
file, and builds an in-memory graph of classes / functions / methods /
imports (TypeScript / JavaScript / Python). When you generate an instruction,
any entities matching the node's label or function name are inserted into the
prompt as Markdown snippets — the LLM then writes the instruction grounded
in real signatures and doc comments rather than guessing.

The scan uses `web-tree-sitter` (WASM) when its grammar files are present in
`public/grammars/`, and falls back to a regex extractor otherwise so the app
is still useful without `fetch-grammars`.

To refresh or update grammars:

```sh
node scripts/fetch-grammars.cjs   # downloads runtime + TS/JS/Python grammars
```

Override pinned releases with env vars (`TREE_SITTER_TYPESCRIPT_VERSION`,
etc.) — see the script.

## Saving instructions to disk

Pick a project folder once via the `Pick folder…` button at the top of the
generator dialog. The app uses the [File System Access
API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API),
so on Chrome/Edge/Brave it writes `agents/<slug>/AGENT.md` and
`skills/<slug>/SKILL.md` directly to disk. Firefox / Safari users get a
browser download instead — the path is still recorded on the node.

## Scripts

| script | what it does |
|---|---|
| `npm run dev` | Vite dev server (port 5173) |
| `npm run server` | qwen bridge (port 3001, requires Qwen CLI installed) |
| `npm run build` | TypeScript project build + production bundle |
| `npm run preview` | serve `dist/` |
| `npm run lint` | oxlint |

## Where things live

See `AGENTS.md` for the full codebase guide — data model, store API, every
component, tree-sitter architecture, and recipes for common changes.
