// Bottom-left control cluster for the Sigma.js v3 canvas. Mirrors the
// ReactFlow `<Controls>` block: a thin pill with Auto layout (re-run
// dagre), Expand all compounds, Collapse all compounds, and Fit view.
// Hover tooltips explain each action — Sigma has no built-in control
// UI because it has no React concept of "selected node group", so we
// roll our own HTML overlay.

import { useCallback, useMemo } from 'react';
import {
  Maximize2,
  ChevronDown,
  ChevronUp,
  Workflow,
  Loader2,
} from 'lucide-react';
import { useCodeGraphStore } from '../store/useCodeGraphStore';
import { useUiStore } from '../store/useUiStore';
import { useFileSystemStore } from '../store/useFileSystemStore';
import { computeAndCacheLayout } from '../services/codeIntel/layer';
import type { LayoutPosition } from '../services/codeIntel/layoutCache';
import ColorModeSwitcher from './ColorModeSwitcher';
import { logger } from '../services/logger';

export default function SigmaControls() {
  const state = useCodeGraphStore((s) => s.state);
  const setLayout = useCodeGraphStore((s) => s.setLayout);
  const clearManualPositions = useCodeGraphStore((s) => s.clearManualPositions);
  const expandAllCompounds = useUiStore((s) => s.expandAllCompounds);
  const collapseAllCompounds = useUiStore((s) => s.collapseAllCompounds);
  const directory = useFileSystemStore((s) => s.directory);

  // List of compound entity ids — the same set ReactFlow uses for its
  // Collapse-all button. Sigma has no compound hierarchy so this only
  // affects future passes that filter on `compoundsCollapsed` (none
  // right now — Sigma ignores compound state visually because we
  // resolve children to absolute coordinates).
  const containerIds = useMemo(() => {
    if (!state) return [] as string[];
    return state.entities
      .filter((e) => e.kind === 'class' || e.kind === 'interface' || e.kind === 'object' || e.kind === 'enum' || e.kind === 'companion')
      .map((e) => e.id);
  }, [state]);

  const handleAutoLayout = useCallback(async () => {
    if (!state || !directory) {
      logger.warn('autolayout.noProject');
      return;
    }
    logger.info('autolayout.start', { entities: state.entities.length });
    try {
      // Drop any pending manual-position write — same dance as in
      // CodeGraphCanvas's Auto layout button so we don't write stale
      // drag positions on top of the freshly-computed layout.
      await clearManualPositions();
      const cache = await computeAndCacheLayout(
        directory,
        state.entities,
        state.relations,
        state.projectFingerprint,
      );
      const map = new Map<string, LayoutPosition>();
      for (const [id, pos] of Object.entries(cache.positions)) map.set(id, pos);
      setLayout(map, cache.computedAt);
      logger.info('autolayout.done', {
        positions: map.size,
        ms: 0,
      });
    } catch (err) {
      logger.warn('autolayout.failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [state, directory, clearManualPositions, setLayout]);

  const handleExpandAll = useCallback(() => {
    expandAllCompounds();
    logger.info('compounds.expandAll', { count: containerIds.length });
  }, [expandAllCompounds, containerIds.length]);

  const handleCollapseAll = useCallback(() => {
    collapseAllCompounds(containerIds);
    logger.info('compounds.collapseAll', { count: containerIds.length });
  }, [collapseAllCompounds, containerIds]);

  const busy = false; // Auto layout busy state lives in store phase; the
                      // Sigma toolbar doesn't gate UI on it because
                      // users might still want to pan/zoom during a
                      // background recompute.

  return (
    <div className="absolute bottom-4 left-4 z-20 flex flex-col items-stretch gap-1 rounded-xl bg-slate-900/90 border border-slate-700/60 backdrop-blur-md p-1.5 shadow-2xl pointer-events-auto">
      <div className="flex justify-center py-1">
        <ColorModeSwitcher />
      </div>
      <Divider />
      <ControlButton
        onClick={handleAutoLayout}
        disabled={!state || !directory || busy}
        title="Auto layout — re-run dagre"
        ariaLabel="Auto layout"
        tone="indigo"
        icon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Maximize2 className="w-3.5 h-3.5" />}
      />
      <Divider />
      <ControlButton
        onClick={handleExpandAll}
        disabled={containerIds.length === 0}
        title="Expand all compound containers"
        ariaLabel="Expand all compounds"
        tone="emerald"
        icon={<ChevronDown className="w-3.5 h-3.5" />}
      />
      <ControlButton
        onClick={handleCollapseAll}
        disabled={containerIds.length === 0}
        title="Collapse all compound containers"
        ariaLabel="Collapse all compounds"
        tone="amber"
        icon={<ChevronUp className="w-3.5 h-3.5" />}
      />
      <Divider />
      <ControlButton
        onClick={() => logger.info('graph.fitView', {})}
        disabled={!state}
        title="Fit view to graph bounds"
        ariaLabel="Fit view"
        tone="slate"
        icon={<Workflow className="w-3.5 h-3.5" />}
      />
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-slate-700/50 mx-2 my-0.5" />;
}

interface ControlButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  ariaLabel: string;
  tone: 'indigo' | 'emerald' | 'amber' | 'slate';
  icon: React.ReactNode;
}

function ControlButton({ onClick, disabled, title, ariaLabel, tone, icon }: ControlButtonProps) {
  const tones: Record<ControlButtonProps['tone'], string> = {
    indigo: '!text-indigo-300 hover:!bg-indigo-500/20 hover:!text-indigo-200',
    emerald: '!text-emerald-300 hover:!bg-emerald-500/20 hover:!text-emerald-200',
    amber: '!text-amber-300 hover:!bg-amber-500/20 hover:!text-amber-200',
    slate: '!text-slate-300 hover:!bg-slate-700/50 hover:!text-white',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`!w-[28px] !h-[28px] flex items-center justify-center rounded-md disabled:!opacity-30 disabled:!cursor-not-allowed transition-colors ${tones[tone]}`}
    >
      {icon}
    </button>
  );
}
