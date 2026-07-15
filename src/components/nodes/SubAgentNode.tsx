import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { Bot, Wrench } from 'lucide-react';

interface SubAgentData {
  label: string;
  config: {
    instructions?: string;
    tools?: string[];
  };
}

const SubAgentNode = memo(({ data, selected }: NodeProps<SubAgentData>) => {
  const toolCount = data.config.tools?.length || 0;

  return (
    <div className="group relative">
      {/* Glow effect */}
      <div className={`
        absolute -inset-1 rounded-xl bg-gradient-to-r from-blue-500 via-cyan-500 to-blue-600
        opacity-0 group-hover:opacity-25 blur-lg transition-opacity duration-300
        ${selected ? 'opacity-40' : ''}
      `} />
      
      {/* Main card */}
      <div
        className={`
          relative px-4 py-3 min-w-[180px] rounded-xl
          bg-gradient-to-br from-slate-900/95 via-blue-950/90 to-slate-900/95
          backdrop-blur-xl border border-blue-500/30
          text-white shadow-2xl shadow-blue-500/10
          transition-all duration-300 ease-out
          ${selected 
            ? 'ring-2 ring-blue-400/80 ring-offset-2 ring-offset-slate-950 scale-105 shadow-blue-500/30' 
            : 'hover:scale-[1.02] hover:shadow-blue-500/20'
          }
        `}
      >
        {/* Gradient overlay */}
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-blue-500/10 to-transparent pointer-events-none" />
        
        <Handle
          type="target"
          position={Position.Top}
          className="!w-4 !h-4 !bg-gradient-to-br !from-blue-400 !to-cyan-500 !border-2 !border-slate-900 !-top-2 transition-transform group-hover:scale-125"
        />

        <div className="relative flex items-center gap-3 mb-2">
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500/30 rounded-lg blur-md" />
            <div className="relative p-2 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-lg shadow-lg shadow-blue-500/30">
              <Bot className="w-4 h-4 text-white" />
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-blue-400 font-semibold">Agent</p>
            <h3 className="font-semibold text-sm text-white">{data.label}</h3>
          </div>
        </div>

        <div className="relative flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-800/50 border border-slate-700/50 rounded-full text-slate-400">
            <Wrench className="w-3 h-3" />
            <span>{toolCount} {toolCount === 1 ? 'tool' : 'tools'}</span>
          </div>
        </div>

        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-4 !h-4 !bg-gradient-to-br !from-blue-400 !to-cyan-500 !border-2 !border-slate-900 !-bottom-2 transition-transform group-hover:scale-125"
        />
      </div>
    </div>
  );
});

SubAgentNode.displayName = 'SubAgentNode';

export default SubAgentNode;
