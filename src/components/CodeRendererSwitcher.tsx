// Floating pill that lets the user toggle the code-graph canvas between
// the WebGL renderer (Sigma.js v3) and the legacy SVG renderer
// (ReactFlow). Lifted out of SigmaGraphCanvas so it stays visible no
// matter which renderer is active — otherwise switching from ReactFlow
// back to Sigma would require already being in Sigma mode to see the
// switcher.

import { useUiStore } from '../store/useUiStore';

export default function CodeRendererSwitcher() {
  const renderer = useUiStore((s) => s.codeGraphRenderer);
  const setRenderer = useUiStore((s) => s.setCodeGraphRenderer);
  return (
    <div
      data-testid="code-renderer-switcher"
      className="absolute top-4 right-4 z-30 flex items-center gap-1 rounded-lg bg-slate-900/90 border border-slate-700/60 backdrop-blur-md p-1 text-[11px] font-medium text-slate-300 shadow-2xl pointer-events-auto"
    >
      <button
        type="button"
        onClick={() => setRenderer('sigma')}
        className={`px-3 py-1.5 rounded-md transition-colors ${
          renderer === 'sigma'
            ? 'bg-indigo-500/20 text-indigo-200'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
        }`}
        title="WebGL renderer (Sigma.js v3) — handles 10k+ entities"
      >
        Sigma (WebGL)
      </button>
      <button
        type="button"
        onClick={() => setRenderer('reactflow')}
        className={`px-3 py-1.5 rounded-md transition-colors ${
          renderer === 'reactflow'
            ? 'bg-indigo-500/20 text-indigo-200'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
        }`}
        title="Legacy SVG renderer (ReactFlow)"
      >
        ReactFlow
      </button>
    </div>
  );
}
