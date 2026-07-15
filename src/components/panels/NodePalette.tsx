import { useState } from 'react';
import type { NodeType } from '../../types';
import { Sparkles, Bot, Wrench, GripVertical } from 'lucide-react';

interface NodePaletteProps {
  onDragStart: (event: React.DragEvent, nodeType: NodeType) => void;
}

const paletteItems: { type: NodeType; label: string; description: string; icon: React.ReactNode; gradient: string; borderColor: string; hoverGradient: string }[] = [
  {
    type: 'orchestrator',
    label: 'Orchestrator',
    description: 'Manages sub-agents & delegates tasks',
    icon: <Sparkles className="w-5 h-5" />,
    gradient: 'from-indigo-500 to-purple-600',
    borderColor: 'border-indigo-500/40',
    hoverGradient: 'hover:from-indigo-400 hover:to-purple-500',
  },
  {
    type: 'sub_agent',
    label: 'Agent',
    description: 'Executes tasks with skills',
    icon: <Bot className="w-5 h-5" />,
    gradient: 'from-blue-500 to-cyan-600',
    borderColor: 'border-blue-500/40',
    hoverGradient: 'hover:from-blue-400 hover:to-cyan-500',
  },
  {
    type: 'skill',
    label: 'Skill',
    description: 'Tool or function for agents',
    icon: <Wrench className="w-5 h-5" />,
    gradient: 'from-emerald-500 to-teal-600',
    borderColor: 'border-emerald-500/40',
    hoverGradient: 'hover:from-emerald-400 hover:to-teal-500',
  },
];

const NodePalette = ({ onDragStart }: NodePaletteProps) => {
  const [draggingItem, setDraggingItem] = useState<NodeType | null>(null);

  return (
    <div className="w-72 bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border-r border-slate-700/50 flex flex-col">
      {/* Header */}
      <div className="p-5 border-b border-slate-700/50">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-indigo-500/30 blur-lg rounded-lg" />
            <div className="relative p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Components</h2>
            <p className="text-xs text-slate-500">Drag to canvas</p>
          </div>
        </div>
      </div>

      {/* Node List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {paletteItems.map((item) => (
          <div
            key={item.type}
            draggable
            onDragStart={(e) => {
              setDraggingItem(item.type);
              onDragStart(e, item.type);
            }}
            onDragEnd={() => setDraggingItem(null)}
            className={`
              group relative p-4 rounded-xl cursor-grab active:cursor-grabbing
              bg-slate-800/50 backdrop-blur-sm border ${item.borderColor}
              transition-all duration-300 ease-out
              hover:bg-slate-800/80 hover:${item.hoverGradient}
              ${draggingItem === item.type ? 'opacity-50 scale-95' : ''}
            `}
          >
            {/* Glow on hover */}
            <div className={`
              absolute inset-0 rounded-xl bg-gradient-to-r ${item.gradient} opacity-0
              group-hover:opacity-10 blur-xl transition-opacity duration-300
            `} />

            {/* Drag indicator */}
            <div className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-50 transition-opacity">
              <GripVertical className="w-4 h-4 text-slate-400" />
            </div>

            <div className="relative flex items-start gap-3 pl-4">
              <div className={`
                relative p-2.5 rounded-xl bg-gradient-to-br ${item.gradient} 
                shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3
              `}>
                <div className="absolute inset-0 bg-white/20 rounded-xl blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative text-white">
                  {item.icon}
                </div>
              </div>
              
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white text-sm mb-0.5">{item.label}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{item.description}</p>
              </div>
            </div>

            {/* Animated border on hover */}
            <div className={`
              absolute inset-0 rounded-xl border-2 border-transparent
              bg-gradient-to-r ${item.gradient} bg-origin-border
              opacity-0 group-hover:opacity-30 transition-opacity duration-300
              mask-image: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)
              mask-composite: exclude
            `} />
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <div className="p-4 border-t border-slate-700/50">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <div className="p-1.5 bg-slate-800/50 rounded-lg">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span>Connect nodes by dragging handles</span>
        </div>
      </div>
    </div>
  );
};

export default NodePalette;
