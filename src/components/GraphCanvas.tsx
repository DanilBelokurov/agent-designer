import { useCallback, useEffect, useRef, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  ControlButton,
  MiniMap,
  ConnectionMode,
  useReactFlow,
  BackgroundVariant,
  MarkerType,
} from 'reactflow';
import type { Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { Workflow } from 'lucide-react';

import { useGraphStore } from '../store/useGraphStore';
import { OrchestratorNode, SubAgentNode, SkillNode } from './nodes';
import NodePalette from './panels/NodePalette';
import PropertiesPanel from './panels/PropertiesPanel';
import Toolbar from './Toolbar';
import CodeGraphToolbarButton from './CodeGraphToolbarButton';
import type { NodeType } from '../types';
import { autoLayout } from '../utils/autoLayout';
import { hydrateCodeGraphStore } from '../store/useCodeGraphStore';

const nodeTypes = {
  orchestrator: OrchestratorNode,
  sub_agent: SubAgentNode,
  skill: SkillNode,
};

const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: true,
  style: { strokeWidth: 2 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 20,
    height: 20,
  },
};

const GraphCanvas = () => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const { nodes, edges, selectedNodeId, onNodesChange, onEdgesChange, onConnect, addNode, selectNode, setNodesPositions } = useGraphStore();

  useEffect(() => {
    void hydrateCodeGraphStore();
  }, []);

  const onDragStart = useCallback(
    (event: React.DragEvent, nodeType: NodeType) => {
      event.dataTransfer.setData('application/reactflow', nodeType);
      event.dataTransfer.effectAllowed = 'move';
    },
    []
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow') as NodeType;
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(type, position);
    },
    [screenToFlowPosition, addNode]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id);
    },
    [selectNode]
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  const handleAutoLayout = useCallback(() => {
    if (nodes.length === 0) return;
    const positions = autoLayout(nodes, edges);
    setNodesPositions(positions);
    requestAnimationFrame(() => {
      fitView({ duration: 400, padding: 0.1 });
    });
  }, [nodes, edges, setNodesPositions, fitView]);

  const isValidConnection = useCallback((connection: { source: string | null; target: string | null }) => {
    if (!connection.source || !connection.target) return false;
    if (connection.source === connection.target) return false;

    const sourceNode = nodes.find(n => n.id === connection.source);
    const targetNode = nodes.find(n => n.id === connection.target);
    if (!sourceNode || !targetNode) return false;

    const sourceType = sourceNode.type;
    const targetType = targetNode.type;

    const validConnections: Record<string, string[]> = {
      orchestrator: ['sub_agent', 'skill'],
      sub_agent: ['skill'],
    };

    return validConnections[sourceType as string]?.includes(targetType as string) || false;
  }, [nodes]);

  const minimapNodeColor = useMemo(() => {
    return (node: Node) => {
      switch (node.type) {
        case 'orchestrator': return '#6366f1';
        case 'sub_agent': return '#3b82f6';
        case 'skill': return '#10b981';
        default: return '#6b7280';
      }
    };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <Toolbar />
      
      <div className="flex-1 flex">
        <NodePalette onDragStart={onDragStart} />
        
        <div ref={reactFlowWrapper} className="flex-1 relative">
          {/* Subtle grid pattern overlay */}
          <div 
            className="absolute inset-0 pointer-events-none opacity-[0.02]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
          
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            minZoom={0.005}
            maxZoom={2}
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode="Delete"
            className="bg-transparent"
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="#334155"
              className="opacity-30"
            />
            <Controls
              className="!bg-slate-900/90 !border-slate-700/50 !shadow-2xl !rounded-xl overflow-hidden"
              showZoom
              showFitView
              showInteractive={false}
            >
              <div className="h-px bg-slate-700/50 mx-2" />
              <ControlButton
                onClick={handleAutoLayout}
                title="Auto layout (hierarchy)"
                aria-label="Auto layout"
                disabled={nodes.length === 0}
                className="!text-indigo-300 hover:!bg-indigo-500/20 hover:!text-indigo-200 disabled:!opacity-40"
              >
                <Workflow className="w-4 h-4" />
              </ControlButton>
            </Controls>
            <MiniMap
              className="!bg-slate-900/90 !border-slate-700/50 !rounded-xl !shadow-2xl"
              nodeColor={minimapNodeColor}
              maskColor="rgba(15, 23, 42, 0.8)"
              pannable
              zoomable
            />
          </ReactFlow>
          
          {/* Empty state hint */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <div className="relative mx-auto mb-4">
                  <div className="absolute inset-0 bg-indigo-500/20 blur-2xl rounded-full" />
                  <div className="relative p-4 bg-slate-800/50 rounded-2xl border border-slate-700/50 backdrop-blur-sm">
                    <svg className="w-10 h-10 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                </div>
                <p className="text-slate-400 text-sm">Drag components from the left panel</p>
                <p className="text-slate-500 text-xs mt-1">or double-click on the canvas</p>
              </div>
            </div>
          )}
        </div>
        
        {selectedNodeId !== null && <PropertiesPanel />}
      </div>

      <CodeGraphToolbarButton />
    </div>
  );
};

export default GraphCanvas;
