import { ReactFlowProvider } from 'reactflow';
import GraphCanvas from './components/GraphCanvas';

function App() {
  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  );
}

export default App;
