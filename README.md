# Agent Designer

Visual designer for AI-agent graphs. Drag orchestrators, sub-agents and skills
onto a canvas, connect them, edit properties, generate Markdown instructions
via a local Qwen CLI, and let the same project scan the real code you have on
disk via tree-sitter — all client-side, all from a single dev or prod server
on **one port**.

## Quick start (dev)

```sh
npm install
node scripts/fetch-grammars.cjs   # download tree-sitter language WASMs
npm run dev                       # opens http://localhost:5173
```

Everything is served from port `5173` in dev: the React app from Vite,
the qwen bridge as a Vite middleware on `/generate` and `/health`.

## Production

```sh
npm run build                # tsc + vite build → dist/
npm run prod                 # node server/prod-server.mjs → http://localhost:3001
```

Or `npm run server` runs `build && prod` in one step.

`prod-server.mjs` serves `dist/` and answers `/generate` / `/health` from the
same Node process on `PORT` (default 3001, default host `127.0.0.1`). SPA
fallback is handled, so refresh-on-deep-link works.

## Optional: AI instruction generation

The "Generate instruction with Qwen…" button inside a node's PropertiesPanel
calls the same-origin `/generate` endpoint, which shells out to the local
`qwen` CLI. The qwen binary just has to be on PATH (or set `QWEN_COMMAND`).

Environment overrides (all optional):

| variable | default | meaning |
|---|---|---|
| `PORT` | `3001` (prod) | listen port (dev uses Vite's 5173) |
| `HOST` | `127.0.0.1` | bind host |
| `QWEN_COMMAND` | `qwen` | binary to invoke (any CLI taking `-p "<prompt>"`) |
| `QWEN_TIMEOUT_MS` | `120000` | per-request timeout |

When the bridge can't spawn `qwen` the dialog surfaces a clear error and the
rest of the app keeps working.

## Code-graph scan

The bottom-left `Code graph` button opens a floating panel that walks the
project folder you picked in the instruction dialog, parses each supported
file, and builds an in-memory graph of classes / functions / methods /
imports (TypeScript / JavaScript / Python). When you generate an instruction,
any entities matching the node's label or function name are inserted into the
prompt as Markdown snippets — the LLM then writes the instruction grounded
in real signatures and doc comments rather than guessing.

The scan uses `web-tree-sitter` (WASM) when its grammar files are present in
`public/grammars/`, and falls back to a regex extractor otherwise.

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
| `npm run dev` | Vite dev server (port 5173, includes `/generate` middleware) |
| `npm run prod` | Production server (port 3001, `dist/` + `/generate`) |
| `npm run server` | `build && prod` in one command |
| `npm run preview` | Vite preview (port 4173, includes `/generate` middleware) |
| `npm run build` | TypeScript project build + production bundle |
| `npm run grammars` | Refresh `public/grammars/*.wasm` |
| `npm run lint` | oxlint |

## Where things live

See `AGENTS.md` for the full codebase guide — data model, store API, every
component, tree-sitter architecture, bridge server architecture, and
recipes for common changes.
