import { Handle, Position } from '@xyflow/react';

export function SpecCustomNode({ data, isConnectable }) {
  const isScenario = data.type === 'scenario';

  return (
    <div className={`flow-node custom-flow-node ${isScenario ? 'scenario-node' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        style={{ background: '#475569', width: 8, height: 8 }}
      />
      
      <div className="node-content">
        <span className={`node-type type-${data.type}`}>{data.type}</span>
        <div className="node-text">
          <strong>{data.title}</strong>
          <small>{data.subtitle}</small>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        style={{ background: '#475569', width: 8, height: 8 }}
      />
    </div>
  );
}
