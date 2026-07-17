import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Connect, Plugin } from 'vite';

// Same-plugin handler for /generate, /health, /log, and /logs, mounted into
// both Vite's dev server (`configureServer`) and the preview server
// (`configurePreviewServer`). The same endpoints work whether you're
// iterating locally or running `vite preview` against the built bundle.

const qwenBridge = (): Plugin => ({
  name: 'agent-designer:qwen-bridge',
  async configureServer(server) {
    const { dispatchBridge } = await import('./server/qwenHandler.mjs');
    const { dispatchLog } = await import('./server/logHandler.mjs');
    server.middlewares.use(makeMiddleware(dispatchBridge, 'bridge'));
    server.middlewares.use(makeMiddleware(dispatchLog, 'log'));
  },
  async configurePreviewServer(server) {
    const { dispatchBridge } = await import('./server/qwenHandler.mjs');
    const { dispatchLog } = await import('./server/logHandler.mjs');
    server.middlewares.use(makeMiddleware(dispatchBridge, 'bridge'));
    server.middlewares.use(makeMiddleware(dispatchLog, 'log'));
  },
});

function makeMiddleware(
  dispatcher: (req: any, res: any, urlPath: string) => Promise<boolean>,
  name: 'bridge' | 'log',
): Connect.NextHandleFunction {
  return async (req, res, next) => {
    try {
      const url = (req.url ?? '/').split('?')[0];
      const handled = await dispatcher(req, res, req.url ?? url);
      if (handled) return;
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: `${name} middleware error: ${(err as Error).message}` }));
      }
      return;
    }
    next();
  };
}

export default defineConfig({
  plugins: [react(), qwenBridge()],
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
});
