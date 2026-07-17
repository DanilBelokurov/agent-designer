# Agent Designer

Visual designer for AI-agent graphs. Drag orchestrators, sub-agents and skills
onto a canvas, connect them, edit properties, generate Markdown instructions
via a local Qwen CLI, and let the same project scan the real code you have on
disk via a universal in-house code-intel extractor — all client-side, all
from a single dev or prod server on **one port**.

## Quick start (dev)

```sh
npm install
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
project folder you picked in the instruction dialog, runs the universal
code-intel extractor over each supported file, and builds a graph of
classes / functions / methods / imports. The extractor covers a wide set of
languages out of the box (TypeScript, JavaScript, TSX, Python, Kotlin, Java,
Scala, Groovy, C#, Go, Rust, C/C++, Swift, Ruby) without any per-language
WASM runtime. When you generate an instruction, any entities matching the
node's label or function name are inserted into the prompt as Markdown
snippets — the LLM then writes the instruction grounded in real
signatures, doc comments, file archetypes (controller / service /
repository / …), modifiers and annotations rather than guessing.

### Persistence

Scan results — entities, relations, learned archetypes, conventions, the
Qwen semantic cache — are stored in `.agent-graph/state.json` **inside the
picked project folder**, atomically written (tmp + rename). The folder's
`.agent-graph/.gitignore` is auto-managed to keep the state out of source
control unless the user opts in. This means the cache survives between
sessions and travels with the project itself; there is no browser-only
IndexedDB layer.

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
| `npm run lint` | oxlint |

## Where things live

See `AGENTS.md` for the full codebase guide — data model, store API, every
component, the code-intel pipeline (tokenize → brace/indent extractor →
project-aware archetype learner → convention sniffer → search index),
bridge server architecture, and recipes for common changes.