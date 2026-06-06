export function Sidebar({ tree, loading, selectedPath, onSelect }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="eyebrow green">Simulation Viewer</div>
        <div className="muted">Vault test results</div>
      </div>
      <div className="tree">
        {loading && <div className="muted pad">Loading...</div>}
        {tree && <TreeNode node={tree} selectedPath={selectedPath} onSelect={onSelect} depth={0} />}
      </div>
    </aside>
  );
}

function TreeNode({ node, selectedPath, onSelect, depth }) {
  return (
    <>
      {Object.entries(node.dirs || {}).map(([name, child]) => (
        <details key={child.path || name} open>
          <summary className="tree-dir" style={{ paddingLeft: 8 + depth * 12 }}>
            {name}
          </summary>
          <TreeNode node={child} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
        </details>
      ))}
      {(node.files || []).map((file) => (
        <button
          key={file.responsePath}
          className={`tree-file ${selectedPath === file.responsePath ? 'active' : ''}`}
          style={{ paddingLeft: 18 + depth * 12 }}
          title={file.name}
          onClick={() => onSelect(file)}
        >
          {file.name.replaceAll('_', ' ')}
        </button>
      ))}
    </>
  );
}
