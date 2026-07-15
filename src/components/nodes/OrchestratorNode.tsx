import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { Sparkles } from 'lucide-react';

interface OrchestratorData {
  label: string;
  config: {
    instructions?: string;
    maxDelegations?: number;
  };
}

const OrchestratorNode = memo(({ data, selected }: NodeProps<OrchestratorData>) => {
  return (
    <div className="group relative">
      {/* Glow effect */}
      <div className={`
        absolute -inset-1 rounded-2xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500
        opacity-0 group-hover:opacity-30 blur-lg transition-opacity duration-300
        ${selected ? 'opacity-50' : ''}
      `} />
      
      {/* Main card */}
      <div
        className={`
          relative px-5 py-4 min-w-[220px] rounded-xl
          bg-gradient-to-br from-slate-900/95 via-indigo-950/90 to-slate-900/95
          backdrop-blur-xl border border-indigo-500/30
          text-white shadow-2xl shadow-indigo-500/10
          transition-all duration-300 ease-out
          ${selected 
            ? 'ring-2 ring-indigo-400/80 ring-offset-2 ring-offset-slate-950 scale-105 shadow-indigo-500/30' 
            : 'hover:scale-[1.02] hover:shadow-indigo-500/20'
          }
        `}
      >
        {/* Gradient overlay */}
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-indigo-500/10 to-transparent pointer-events-none" />
        
        <Handle
          type="target"
          position={Position.Top}
          className="!w-4 !h-4 !bg-gradient-to-br !from-indigo-400 !to-purple-500 !border-2 !border-slate-900 !-top-2 transition-transform group-hover:scale-125"
        />
        
        <div className="relative flex items-center gap-3 mb-3">
          <div className="relative">
            <div className="absolute inset-0 bg-indigo-500/30 rounded-xl blur-md" />
            <div className="relative p-2.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg shadow-indigo-500/30">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold">Orchestrator</p>
            <h3 className="font-bold text-base text-white">{data.label}</h3>
          </div>
        </div>

        <div className="relative flex items-center gap-2 text-xs">
          <span className="px-2 py-1 bg-slate-800/50 border border-slate-700/50 rounded-full text-slate-400">
            {data.config.maxDelegations || 5} max delegations
          </span>
        </div>

        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-4 !h-4 !bg-gradient-to-br !from-indigo-400 !to-purple-500 !border-2 !border-slate-900 !-bottom-2 transition-transform group-hover:scale-125"
        />
      </div>
    </div>
  );
});

OrchestratorNode.displayName = 'OrchestratorNode';

export default OrchestratorNode;
