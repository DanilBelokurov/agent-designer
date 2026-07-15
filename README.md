# Agent Designer

Visual designer for AI-agent graphs. Drag orchestrators, sub-agents and skills
onto a canvas, connect them, edit properties, then either export a JSON
project or generate a Python `dataclass` skeleton.

## Quick start

```sh
npm install
npm run dev        # opens http://localhost:5173 with the designer
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
component, and recipes for common changes.
