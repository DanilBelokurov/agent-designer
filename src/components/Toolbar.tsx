import { useRef } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { Download, Upload, FileCode, Trash2, Layers } from 'lucide-react';

const Toolbar = () => {
  const { projectName, setProjectName, exportProject, importProject, clearGraph, nodes } = useGraphStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const json = exportProject();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.replace(/\s+/g, '_').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        importProject(content);
      };
      reader.readAsText(file);
    }
  };

  const handleClear = () => {
    if (confirm('Are you sure you want to clear the canvas?')) {
      clearGraph();
    }
  };

  const handleGenerateCode = () => {
    const json = exportProject();
    const code = generateAgentCode(json);
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.replace(/\s+/g, '_').toLowerCase()}_agents.py`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const nodeCount = nodes.length;
  const orchestratorCount = nodes.filter(n => n.type === 'orchestrator').length;
  const agentCount = nodes.filter(n => n.type === 'sub_agent').length;
  const skillCount = nodes.filter(n => n.type === 'skill').length;

  return (
    <div className="h-16 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-700/50 px-6 flex items-center justify-between backdrop-blur-xl">
      {/* Left section - Logo & Project name */}
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="relative">
            <div className="absolute inset-0 bg-indigo-500/30 blur-lg rounded-xl" />
            <div className="relative p-2 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-xl shadow-lg shadow-indigo-500/20">
              <Layers className="w-5 h-5 text-white" />
            </div>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">Agent Designer</h1>
          </div>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-slate-700/50" />

        {/* Project name */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="px-3 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded-lg text-white text-sm 
                       focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 
                       transition-all backdrop-blur-sm w-48"
          />
        </div>

        {/* Stats */}
        <div className="hidden lg:flex items-center gap-3 ml-4">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800/30 rounded-lg border border-slate-700/30">
            <span className="w-2 h-2 bg-indigo-400 rounded-full" />
            <span className="text-xs text-slate-400">{orchestratorCount}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800/30 rounded-lg border border-slate-700/30">
            <span className="w-2 h-2 bg-blue-400 rounded-full" />
            <span className="text-xs text-slate-400">{agentCount}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800/30 rounded-lg border border-slate-700/30">
            <span className="w-2 h-2 bg-emerald-400 rounded-full" />
            <span className="text-xs text-slate-400">{skillCount}</span>
          </div>
        </div>
      </div>

      {/* Right section - Actions */}
      <div className="flex items-center gap-2">
        {/* Import */}
        <button
          onClick={handleImport}
          className="group flex items-center gap-2 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 
                     border border-slate-700/50 text-slate-300 text-sm rounded-xl 
                     transition-all hover:border-slate-600/50 hover:text-white backdrop-blur-sm"
        >
          <Upload className="w-4 h-4" />
          <span className="hidden sm:inline">Import</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Export */}
        <button
          onClick={handleExport}
          className="group flex items-center gap-2 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 
                     border border-slate-700/50 text-slate-300 text-sm rounded-xl 
                     transition-all hover:border-slate-600/50 hover:text-white backdrop-blur-sm
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={nodeCount === 0}
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Export</span>
        </button>

        {/* Divider */}
        <div className="h-6 w-px bg-slate-700/50 mx-1" />

        {/* Generate Code */}
        <button
          onClick={handleGenerateCode}
          className="group flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 
                     hover:from-indigo-400 hover:to-purple-500 text-white text-sm rounded-xl 
                     shadow-lg shadow-indigo-500/20 transition-all hover:shadow-indigo-500/30 
                     hover:scale-[1.02] active:scale-[0.98]"
          disabled={nodeCount === 0}
        >
          <div className="relative">
            <div className="absolute inset-0 bg-white/20 rounded-lg blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
            <FileCode className="w-4 h-4 relative" />
          </div>
          <span className="hidden sm:inline font-medium">Generate Code</span>
        </button>

        {/* Clear */}
        <button
          onClick={handleClear}
          className="group flex items-center gap-2 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 
                     border border-red-500/30 text-red-400 text-sm rounded-xl 
                     transition-all hover:border-red-500/50 hover:text-red-300 backdrop-blur-sm
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={nodeCount === 0}
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden sm:inline">Clear</span>
        </button>
      </div>
    </div>
  );
};

function generateAgentCode(projectJson: string): string {
  const project = JSON.parse(projectJson);
  const { nodes, edges } = project;

  const orchestrators = nodes.filter((n: { type: string }) => n.type === 'orchestrator');
  const agents = nodes.filter((n: { type: string }) => n.type === 'sub_agent');
  const skills = nodes.filter((n: { type: string }) => n.type === 'skill');

  let code = `# Auto-generated Agent Configuration
# Project: ${project.name}
# Generated: ${new Date().toISOString()}

from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field

`;

  code += `# ============================================\n`;
  code += `# SKILL DEFINITIONS\n`;
  code += `# ============================================\n\n`;

  skills.forEach((skill: { id: string; label: string; config: { functionName: string; description: string; parameters?: Record<string, unknown> } }) => {
    code += `@dataclass\n`;
    code += `class ${toPascalCase(skill.label)}Skill:\n`;
    code += `    """${skill.config.description || 'No description'}"""\n`;
    code += `    name: str = "${skill.config.functionName || skill.label}"\n`;
    code += `    description: str = "${skill.config.description || ''}"\n`;
    if (skill.config.parameters && Object.keys(skill.config.parameters).length > 0) {
      code += `    parameters: Dict[str, Any] = field(default_factory=lambda: ${JSON.stringify(skill.config.parameters, null, 4).replace(/\n/g, '\n    ')})\n`;
    }
    code += `\n`;
  });

  code += `# ============================================\n`;
  code += `# SUB-AGENT DEFINITIONS\n`;
  code += `# ============================================\n\n`;

  const agentSkillsMap: Record<string, string[]> = {};
  edges.filter((e: { edgeType: string }) => e.edgeType === 'skill_attachment').forEach((e: { source: string; target: string }) => {
    if (!agentSkillsMap[e.source]) agentSkillsMap[e.source] = [];
    const skill = skills.find((s: { id: string }) => s.id === e.target);
    if (skill) agentSkillsMap[e.source].push(toPascalCase(skill.label) + 'Skill');
  });

  agents.forEach((agent: { id: string; label: string; config: { instructions?: string } }) => {
    const attachedSkills = agentSkillsMap[agent.id] || [];
    code += `@dataclass\n`;
    code += `class ${toPascalCase(agent.label)}Agent:\n`;
    code += `    """Worker agent: ${agent.label}"""\n`;
    code += `    name: str = "${agent.label}"\n`;
    code += `    instructions: str = """${agent.config.instructions || ''}"""\n`;
    if (attachedSkills.length > 0) {
      code += `    tools: List[Any] = field(default_factory=lambda: [${attachedSkills.join(', ')}()])\n`;
    } else {
      code += `    tools: List[Any] = field(default_factory=list)\n`;
    }
    code += `\n`;
  });

  code += `# ============================================\n`;
  code += `# ORCHESTRATOR DEFINITIONS\n`;
  code += `# ============================================\n\n`;

  const orchestratorAgentsMap: Record<string, string[]> = {};
  edges.filter((e: { edgeType: string }) => e.edgeType === 'delegation').forEach((e: { source: string; target: string }) => {
    if (!orchestratorAgentsMap[e.source]) orchestratorAgentsMap[e.source] = [];
    const agent = agents.find((a: { id: string }) => a.id === e.target);
    if (agent) orchestratorAgentsMap[e.source].push(toPascalCase(agent.label) + 'Agent');
  });

  orchestrators.forEach((orch: { id: string; label: string; config: { instructions?: string; maxDelegations?: number } }) => {
    const subAgents = orchestratorAgentsMap[orch.id] || [];
    code += `@dataclass\n`;
    code += `class ${toPascalCase(orch.label)}Orchestrator:\n`;
    code += `    """Orchestrator agent: ${orch.label}"""\n`;
    code += `    name: str = "${orch.label}"\n`;
    code += `    instructions: str = """${orch.config.instructions || ''}"""\n`;
    code += `    max_delegations: int = ${orch.config.maxDelegations || 5}\n`;
    if (subAgents.length > 0) {
      code += `    sub_agents: List[Any] = field(default_factory=lambda: [${subAgents.join(', ')}()])\n`;
    } else {
      code += `    sub_agents: List[Any] = field(default_factory=list)\n`;
    }
    code += `\n`;
  });

  code += `# ============================================\n`;
  code += `# AGENT GRAPH CONFIGURATION\n`;
  code += `# ============================================\n\n`;
  code += `def create_agent_graph():\n`;
  code += `    """Factory function to create the agent graph."""\n`;
  code += `    graph = {\n`;
  code += `        "orchestrators": [\n`;
  orchestrators.forEach((orch: { label: string }) => {
    code += `            ${toPascalCase(orch.label)}Orchestrator(),\n`;
  });
  code += `        ],\n`;
  code += `        "agents": [\n`;
  agents.forEach((agent: { label: string }) => {
    code += `            ${toPascalCase(agent.label)}Agent(),\n`;
  });
  code += `        ],\n`;
  code += `        "skills": [\n`;
  skills.forEach((skill: { label: string }) => {
    code += `            ${toPascalCase(skill.label)}Skill(),\n`;
  });
  code += `        ],\n`;
  code += `    }\n`;
  code += `    return graph\n\n`;
  code += `if __name__ == "__main__":\n`;
  code += `    agent_graph = create_agent_graph()\n`;
  code += `    print(f"Loaded {len(agent_graph['orchestrators'])} orchestrator(s), "\n`;
  code += `          f"{len(agent_graph['agents'])} agent(s), "\n`;
  code += `          f"{len(agent_graph['skills'])} skill(s)")\n`;

  return code;
}

function toPascalCase(str: string): string {
  return str
    .split(/[\s_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

export default Toolbar;
