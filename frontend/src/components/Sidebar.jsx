export function Sidebar({ tree, loading, selectedPath, onSelect }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="eyebrow green">Simulation Viewer</div>
        <div className="muted">Vault test specs</div>
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
        <TreeDir key={child.path || name} name={name} child={child} selectedPath={selectedPath} onSelect={onSelect} depth={depth} />
      ))}
      {(node.files || []).map((file) => (
        <SpecFile key={file.specPath} file={file} selectedPath={selectedPath} onSelect={onSelect} depth={depth} />
      ))}
    </>
  );
}

function SpecFile({ file, selectedPath, onSelect, depth }) {
  const scenarios = file.scenarios || [];
  const isFileSelected = selectedPath === file.specPath;

  // A spec with scenarios always shows as expandable
  if (scenarios.length > 0) {
    const isOpen = isFileSelected || scenarios.some(
      (s) => selectedPath === (s.responsePath ?? `${file.specPath}#${s.lineNumber}`)
    );

    return (
      <details open={isOpen}>
        <summary
          className={`tree-dir ${isFileSelected ? 'active' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={(e) => {
            // Clicking the summary itself selects the spec file (not toggle)
            e.preventDefault();
            const details = e.currentTarget.parentElement;
            details.open = !details.open;
            onSelect({ type: 'spec', ...file, name: file.name });
          }}
        >
          <span className="tree-file-name">{file.name.replaceAll('_', ' ')}</span>
          {file.hasResponses && <span className="tree-badge">●</span>}
        </summary>
        {scenarios.map((scenario, idx) => (
          <ScenarioRow
            key={idx}
            scenario={scenario}
            file={file}
            selectedPath={selectedPath}
            onSelect={onSelect}
            depth={depth}
          />
        ))}
      </details>
    );
  }

  // Spec with no scenarios — plain file button
  return (
    <button
      className={`tree-file ${isFileSelected ? 'active' : ''}`}
      style={{ paddingLeft: 18 + depth * 12 }}
      title={file.specPath}
      onClick={() => onSelect({ type: 'spec', ...file, name: file.name })}
    >
      {file.name.replaceAll('_', ' ')}
    </button>
  );
}

function ScenarioRow({ scenario, file, selectedPath, onSelect, depth }) {
  const itemPath = scenario.responsePath ?? `${file.specPath}#${scenario.lineNumber}`;
  const isActive = selectedPath === itemPath;

  return (
    <button
      className={`tree-file ${isActive ? 'active' : ''}`}
      style={{ paddingLeft: 20 + (depth + 1) * 12 }}
      title={scenario.name}
      onClick={() =>
        onSelect({
          type: 'scenario',
          name: scenario.name,
          specPath: file.specPath,
          specName: file.name,
          lineNumber: scenario.lineNumber,
          responsePath: scenario.responsePath ?? null,
          requestPath: scenario.requestPath ?? null,
          hasResponse: scenario.hasResponse,
        })
      }
    >
      <span className={`scenario-dot ${scenario.hasResponse ? 'has-response' : 'no-response'}`} />
      <span className="scenario-label">{scenario.name.replaceAll('_', ' ')}</span>
    </button>
  );
}

function TreeDir({ name, child, selectedPath, onSelect, depth }) {
  const isOpen = selectedPath?.startsWith(child.path);
  return (
    <details open={isOpen}>
      <summary className="tree-dir" style={{ paddingLeft: 8 + depth * 12 }}>
        {name}
      </summary>
      <TreeNode node={child} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
    </details>
  );
}
