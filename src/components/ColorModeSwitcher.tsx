// Dropdown for switching Sigma's node colouring between three modes:
//   - kind      (default — class/interface/function/...)
//   - language  (per-language GitHub-style palette)
//   - community (Louvain clusters — uses a categorical palette)
//
// Sits inside the bottom-left control cluster (SigmaControls) so it
// doesn't collide with the top-left detail panel.

import { useUiStore } from '../store/useUiStore';
import type { UiState } from '../store/useUiStore';

const OPTIONS: Array<{ value: UiState['codeGraphColorMode']; label: string; hint: string }> = [
  { value: 'kind', label: 'Kind', hint: 'class / interface / function / …' },
  { value: 'language', label: 'Language', hint: 'TypeScript / Python / Rust / …' },
  { value: 'community', label: 'Community', hint: 'Louvain clusters' },
];

export default function ColorModeSwitcher() {
  const mode = useUiStore((s) => s.codeGraphColorMode);
  const setMode = useUiStore((s) => s.setCodeGraphColorMode);
  return (
    <div
      data-testid="sigma-color-mode-switcher"
      className="flex items-center gap-0.5 rounded-lg bg-slate-800/40 border border-slate-700/40 p-0.5 text-[10px] font-medium text-slate-300"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setMode(opt.value)}
          title={opt.hint}
          className={`px-2 py-1 rounded-md transition-colors ${
            mode === opt.value
              ? 'bg-indigo-500/20 text-indigo-200'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/60'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
