import { create } from 'zustand';
import { addEdge, applyNodeChanges, applyEdgeChanges } from 'reactflow';
import type { Node, Edge, Connection, NodeChange, EdgeChange } from 'reactflow';
import type { NodeType, AppNode, AppEdge, NodeConfig } from '../types';

let nodeIdCounter = 1;
let edgeIdCounter = 1;

const generateNodeId = (type: NodeType): string => `${type}_${nodeIdCounter++}`;
const generateEdgeId = (): string => `edge_${edgeIdCounter++}`;

const getDefaultConfig = (type: NodeType): NodeConfig => {
  switch (type) {
    case 'orchestrator':
      return { instructions: '', maxDelegations: 5 };
    case 'sub_agent':
      return { instructions: '', tools: [] };
    case 'skill':
      return { functionName: '', description: '', parameters: {} };
  }
};

interface GraphState {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  projectName: string;
  
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  updateNode: (nodeId: string, updates: Partial<{ label: string; config: NodeConfig }>) => void;
  deleteNode: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;
  setProjectName: (name: string) => void;
  exportProject: () => string;
  importProject: (json: string) => void;
  clearGraph: () => void;
}

export const useGraphStore = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  projectName: 'Untitled Project',

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) as Node[] });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) as Edge[] });
  },

  onConnect: (connection) => {
    const sourceNode = get().nodes.find(n => n.id === connection.source);
    const targetNode = get().nodes.find(n => n.id === connection.target);
    
    if (!sourceNode || !targetNode) return;
    if (!sourceNode.type || !targetNode.type) return;

    const sourceType = sourceNode.type as NodeType;
    const targetType = targetNode.type as NodeType;

    const edgeType = getEdgeType(sourceType, targetType);
    if (!edgeType) return;

    const newEdge: Edge = {
      id: generateEdgeId(),
      source: connection.source!,
      target: connection.target!,
      type: 'smoothstep',
      animated: edgeType === 'delegation',
      style: { stroke: edgeType === 'delegation' ? '#6366f1' : '#10b981' },
      data: { edgeType },
    };

    set({ edges: addEdge(newEdge, get().edges) });
  },

  addNode: (type, position) => {
    const id = generateNodeId(type);
    const labels: Record<NodeType, string> = {
      orchestrator: 'Orchestrator',
      sub_agent: 'Agent',
      skill: 'Skill',
    };

    const newNode: Node = {
      id,
      type,
      position,
      data: {
        label: labels[type],
        config: getDefaultConfig(type),
      },
    };

    set({ nodes: [...get().nodes, newNode] });
  },

  updateNode: (nodeId, updates) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...updates } }
          : node
      ),
    });
  },

  deleteNode: (nodeId) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== nodeId),
      edges: get().edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
    });
  },

  selectNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
  },

  setProjectName: (name) => {
    set({ projectName: name });
  },

  exportProject: () => {
    const state = get();
    const project = {
      id: crypto.randomUUID(),
      name: state.projectName,
      nodes: state.nodes.map(n => ({
        id: n.id,
        type: n.type as NodeType,
        label: n.data.label,
        config: n.data.config,
      })),
      edges: state.edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        edgeType: e.data?.edgeType || 'delegation',
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return JSON.stringify(project, null, 2);
  },

  importProject: (json) => {
    try {
      const project = JSON.parse(json);
      const nodes: Node[] = project.nodes.map((n: AppNode) => ({
        id: n.id,
        type: n.type,
        position: { x: Math.random() * 400, y: Math.random() * 400 },
        data: { label: n.label, config: n.config },
      }));
      const edges: Edge[] = project.edges.map((e: AppEdge) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        animated: e.edgeType === 'delegation',
        style: { stroke: e.edgeType === 'delegation' ? '#6366f1' : '#10b981' },
        data: { edgeType: e.edgeType },
      }));
      set({ nodes, edges, projectName: project.name });
    } catch (error) {
      console.error('Failed to import project:', error);
    }
  },

  clearGraph: () => {
    set({ nodes: [], edges: [], selectedNodeId: null });
  },
}));

function getEdgeType(sourceType: NodeType, targetType: NodeType): 'delegation' | 'skill_attachment' | null {
  if (sourceType === 'orchestrator' && targetType === 'sub_agent') {
    return 'delegation';
  }
  if (sourceType === 'sub_agent' && targetType === 'skill') {
    return 'skill_attachment';
  }
  if (sourceType === 'orchestrator' && targetType === 'skill') {
    return 'skill_attachment';
  }
  return null;
}
