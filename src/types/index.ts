export type NodeType = 'orchestrator' | 'sub_agent' | 'skill';

export interface OrchestratorConfig {
  instructions?: string;
  maxDelegations?: number;
}

export interface SubAgentConfig {
  instructions?: string;
  tools?: string[];
}

export interface SkillConfig {
  functionName: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export type NodeConfig = OrchestratorConfig | SubAgentConfig | SkillConfig;

export interface BaseNode {
  id: string;
  type: NodeType;
  label: string;
  config: NodeConfig;
}

export interface OrchestratorNode extends BaseNode {
  type: 'orchestrator';
  config: OrchestratorConfig;
}

export interface SubAgentNode extends BaseNode {
  type: 'sub_agent';
  config: SubAgentConfig;
}

export interface SkillNode extends BaseNode {
  type: 'skill';
  config: SkillConfig;
}

export type AppNode = OrchestratorNode | SubAgentNode | SkillNode;

export type EdgeType = 'delegation' | 'skill_attachment';

export interface AppEdge {
  id: string;
  source: string;
  target: string;
  edgeType: EdgeType;
}

export interface Project {
  id: string;
  name: string;
  nodes: AppNode[];
  edges: AppEdge[];
  createdAt: string;
  updatedAt: string;
}
