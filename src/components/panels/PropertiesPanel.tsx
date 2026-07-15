import { useMemo } from 'react';
import type { Node, Edge } from 'reactflow';
import { useGraphStore } from '../../store/useGraphStore';
import type { NodeType, OrchestratorConfig, SubAgentConfig, SkillConfig } from '../../types';
import { Trash2, X, Link2, Settings, ChevronRight } from 'lucide-react';

const PropertiesPanel = () => {
  const { nodes, edges, selectedNodeId, updateNode, deleteNode, selectNode } = useGraphStore();

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  const connectedEdges = useMemo(
    () => edges.filter((e) => e.source === selectedNodeId || e.target === selectedNodeId),
    [edges, selectedNodeId]
  );

  if (!selectedNode) {
    return (
      <div className="w-80 bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border-l border-slate-700/50 flex flex-col items-center justify-center">
        <div className="text-center">
          <div className="relative mx-auto mb-4">
            <div className="absolute inset-0 bg-slate-500/20 blur-xl rounded-full" />
            <div className="relative p-4 bg-slate-800/50 rounded-2xl border border-slate-700/50">
              <Settings className="w-8 h-8 text-slate-500" />
            </div>
          </div>
          <p className="text-slate-400 text-sm">Select a node to edit</p>
        </div>
      </div>
    );
  }

  const nodeType = selectedNode.type as NodeType;
  const config = selectedNode.data.config;

  const handleConfigChange = (key: string, value: unknown) => {
    updateNode(selectedNode.id, {
      config: { ...config, [key]: value },
    });
  };

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateNode(selectedNode.id, { label: e.target.value });
  };

  const handleDelete = () => {
    deleteNode(selectedNode.id);
  };

  const getNodeTheme = () => {
    switch (nodeType) {
      case 'orchestrator':
        return {
          gradient: 'from-indigo-500 to-purple-600',
          border: 'border-indigo-500/40',
          bg: 'bg-indigo-500/10',
          text: 'text-indigo-400',
          ring: 'ring-indigo-500/30',
        };
      case 'sub_agent':
        return {
          gradient: 'from-blue-500 to-cyan-600',
          border: 'border-blue-500/40',
          bg: 'bg-blue-500/10',
          text: 'text-blue-400',
          ring: 'ring-blue-500/30',
        };
      case 'skill':
        return {
          gradient: 'from-emerald-500 to-teal-600',
          border: 'border-emerald-500/40',
          bg: 'bg-emerald-500/10',
          text: 'text-emerald-400',
          ring: 'ring-emerald-500/30',
        };
    }
  };

  const theme = getNodeTheme();

  return (
    <div className="w-80 bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border-l border-slate-700/50 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg bg-gradient-to-br ${theme.gradient}`}>
              <Settings className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-base font-semibold text-white">Properties</h2>
          </div>
          <button
            onClick={() => selectNode(null)}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Node Type Badge */}
      <div className="p-4">
        <div className={`p-3 rounded-xl border ${theme.border} ${theme.bg} backdrop-blur-sm`}>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold uppercase tracking-widest ${theme.text}`}>
              {nodeType.replace('_', ' ')}
            </span>
            <ChevronRight className={`w-3 h-3 ${theme.text}`} />
            <span className="text-sm text-white font-medium">{selectedNode.data.label}</span>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-4 space-y-4">
        {/* Label Input */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
            Label
          </label>
          <input
            type="text"
            value={selectedNode.data.label}
            onChange={handleLabelChange}
            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white 
                       placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 
                       focus:border-indigo-500/50 transition-all backdrop-blur-sm"
          />
        </div>

        {/* Type-specific fields */}
        {nodeType === 'orchestrator' && (
          <OrchestratorFields
            config={config as OrchestratorConfig}
            onChange={handleConfigChange}
          />
        )}

        {nodeType === 'sub_agent' && (
          <SubAgentFields
            config={config as SubAgentConfig}
            onChange={handleConfigChange}
            skills={nodes.filter(n => n.type === 'skill')}
            connectedEdges={connectedEdges}
          />
        )}

        {nodeType === 'skill' && (
          <SkillFields
            config={config as SkillConfig}
            onChange={handleConfigChange}
          />
        )}

        {/* Connections Section */}
        <div className="pt-4 border-t border-slate-700/50">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Link2 className="w-3.5 h-3.5" />
            Connections
          </h3>
          {connectedEdges.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No connections</p>
          ) : (
            <div className="space-y-2">
              {connectedEdges.map((edge) => {
                const isSource = edge.source === selectedNode.id;
                const otherNodeId = isSource ? edge.target : edge.source;
                const otherNode = nodes.find((n) => n.id === otherNodeId);
                const edgeType = edge.data?.edgeType || 'delegation';

                return (
                  <div
                    key={edge.id}
                    className="flex items-center justify-between p-2 bg-slate-800/30 rounded-lg border border-slate-700/30"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${edgeType === 'delegation' ? 'text-indigo-400' : 'text-emerald-400'}`}>
                        {isSource ? '→' : '←'}
                      </span>
                      <span className="text-sm text-white">
                        {otherNode?.data.label || 'Unknown'}
                      </span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      edgeType === 'delegation' 
                        ? 'bg-indigo-500/20 text-indigo-300' 
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}>
                      {edgeType}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delete Button */}
      <div className="p-4 border-t border-slate-700/50">
        <button
          onClick={handleDelete}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 
                     bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 
                     text-red-400 rounded-xl transition-all
                     hover:shadow-lg hover:shadow-red-500/10"
        >
          <Trash2 className="w-4 h-4" />
          Delete Node
        </button>
      </div>
    </div>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FieldProps<C = any> = {
  config: C;
  onChange: (key: string, value: unknown) => void;
};

const TextareaField = ({ label, value, onChange, placeholder, rows = 3 }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) => (
  <div className="space-y-2">
    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
      {label}
    </label>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white 
                 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 
                 focus:border-indigo-500/50 transition-all resize-none backdrop-blur-sm font-mono text-sm"
    />
  </div>
);

const NumberField = ({ label, value, onChange, min, max }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) => (
  <div className="space-y-2">
    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
      {label}
    </label>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value))}
      min={min}
      max={max}
      className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white 
                 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all backdrop-blur-sm"
    />
  </div>
);

const OrchestratorFields = ({ config, onChange }: FieldProps<OrchestratorConfig>) => (
  <div className="space-y-4">
    <TextareaField
      label="Instructions"
      value={(config.instructions as string) || ''}
      onChange={(v) => onChange('instructions', v)}
      placeholder="Enter orchestrator instructions..."
      rows={4}
    />
    <NumberField
      label="Max Delegations"
      value={(config.maxDelegations as number) || 5}
      onChange={(v) => onChange('maxDelegations', v)}
      min={1}
      max={20}
    />
  </div>
);

interface SubAgentFieldsProps {
  config: SubAgentConfig;
  onChange: (key: string, value: unknown) => void;
  skills: Node[];
  connectedEdges: Edge[];
}

const SubAgentFields = ({ config, onChange, skills, connectedEdges }: SubAgentFieldsProps) => {
  const attachedSkills = skills.filter((s: Node) =>
    connectedEdges.some((e: Edge) => e.target === s.id && e.source === connectedEdges[0]?.source)
  );

  return (
    <div className="space-y-4">
      <TextareaField
        label="Instructions"
        value={(config.instructions as string) || ''}
        onChange={(v) => onChange('instructions', v)}
        placeholder="Enter agent instructions..."
        rows={4}
      />
      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
          Attached Skills ({attachedSkills.length})
        </label>
        {attachedSkills.length === 0 ? (
          <p className="text-xs text-slate-500 italic py-2">No skills attached yet</p>
        ) : (
          <div className="space-y-1">
            {attachedSkills.map((skill: Node) => (
              <div
                key={skill.id}
                className="flex items-center gap-2 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg"
              >
                <span className="text-emerald-400">•</span>
                <span className="text-sm text-white font-mono">
                  {(skill.data.config as SkillConfig)?.functionName || skill.data.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const SkillFields = ({ config, onChange }: FieldProps<SkillConfig>) => (
  <div className="space-y-4">
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
        Function Name
      </label>
      <input
        type="text"
        value={(config.functionName as string) || ''}
        onChange={(e) => onChange('functionName', e.target.value)}
        placeholder="e.g., get_weather"
        className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white 
                   placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 
                   focus:border-emerald-500/50 transition-all backdrop-blur-sm font-mono"
      />
    </div>
    <TextareaField
      label="Description"
      value={(config.description as string) || ''}
      onChange={(v) => onChange('description', v)}
      placeholder="Describe what this skill does..."
      rows={3}
    />
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
        Parameters (JSON)
      </label>
      <textarea
        value={JSON.stringify(config.parameters || {}, null, 2)}
        onChange={(e) => {
          try {
            onChange('parameters', JSON.parse(e.target.value));
          } catch {
            // Invalid JSON, ignore
          }
        }}
        rows={4}
        placeholder='{"param1": "type"}'
        className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white 
                   placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 
                   focus:border-emerald-500/50 transition-all resize-none backdrop-blur-sm font-mono text-xs"
      />
    </div>
  </div>
);

export default PropertiesPanel;
