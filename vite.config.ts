import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Connect, Plugin } from 'vite';

// Same-plugin handler for /generate and /health, mounted into both Vite's
// dev server (`configureServer`) and the preview server (`configurePreviewServer`),
// so the same `/generate` endpoint works whether you're iterating locally or
// running `vite preview` against the built bundle.

const qwenBridge = (): Plugin => ({
  name: 'agent-designer:qwen-bridge',
  async configureServer(server) {
    const { dispatchBridge } = await import('./server/qwenHandler.mjs');
    server.middlewares.use(makeMiddleware(dispatchBridge));
  },
  async configurePreviewServer(server) {
    const { dispatchBridge } = await import('./server/qwenHandler.mjs');
    server.middlewares.use(makeMiddleware(dispatchBridge));
  },
});

function makeMiddleware(
  dispatchBridge: (req: any, res: any, urlPath: string) => Promise<boolean>,
): Connect.NextHandleFunction {
  return async (req, res, next) => {
    try {
      const url = (req.url ?? '/').split('?')[0];
      const handled = await dispatchBridge(req, res, url);
      if (handled) return;
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: `bridge middleware error: ${(err as Error).message}` }));
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
