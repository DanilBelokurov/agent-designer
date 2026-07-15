import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { Wrench, FileCode } from 'lucide-react';

interface SkillData {
  label: string;
  config: {
    functionName: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
}

const SkillNode = memo(({ data, selected }: NodeProps<SkillData>) => {
  return (
    <div className="group relative">
      {/* Glow effect */}
      <div className={`
        absolute -inset-1 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-green-500
        opacity-0 group-hover:opacity-25 blur-lg transition-opacity duration-300
        ${selected ? 'opacity-40' : ''}
      `} />
      
      {/* Main card */}
      <div
        className={`
          relative px-4 py-2.5 min-w-[150px] rounded-xl
          bg-gradient-to-br from-slate-900/95 via-emerald-950/90 to-slate-900/95
          backdrop-blur-xl border border-emerald-500/30
          text-white shadow-2xl shadow-emerald-500/10
          transition-all duration-300 ease-out
          ${selected 
            ? 'ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-slate-950 scale-105 shadow-emerald-500/30' 
            : 'hover:scale-[1.02] hover:shadow-emerald-500/20'
          }
        `}
      >
        {/* Gradient overlay */}
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-emerald-500/10 to-transparent pointer-events-none" />
        
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3.5 !h-3.5 !bg-gradient-to-br !from-emerald-400 !to-teal-500 !border-2 !border-slate-900 !-top-2 transition-transform group-hover:scale-125"
        />

        <div className="relative flex items-center gap-2.5">
          <div className="relative">
            <div className="absolute inset-0 bg-emerald-500/30 rounded-lg blur-md" />
            <div className="relative p-1.5 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg shadow-lg shadow-emerald-500/30">
              <Wrench className="w-3.5 h-3.5 text-white" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] uppercase tracking-widest text-emerald-400 font-semibold">Skill</p>
            <p className="font-semibold text-sm text-white truncate font-mono">
              {data.config.functionName || 'Unnamed'}
            </p>
          </div>
        </div>

        {data.config.description && (
          <div className="relative mt-2 flex items-start gap-1.5 p-1.5 bg-slate-800/30 rounded-lg border border-slate-700/30">
            <FileCode className="w-3 h-3 mt-0.5 text-emerald-400 flex-shrink-0" />
            <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed">
              {data.config.description}
            </p>
          </div>
        )}

        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3.5 !h-3.5 !bg-gradient-to-br !from-emerald-400 !to-teal-500 !border-2 !border-slate-900 !-bottom-2 transition-transform group-hover:scale-125"
        />
      </div>
    </div>
  );
});

SkillNode.displayName = 'SkillNode';

export default SkillNode;
