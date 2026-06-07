import { useEffect, useMemo, useRef, useState } from 'react';

import { ReactFlow, Background, Controls } from '@xyflow/react';

import { api } from '../api/client.js';
import { specToFlow } from '../utils/specFlow.js';
import { SpecNodeEditor } from './SpecNodeEditor.jsx';
import { SpecCustomNode } from './SpecCustomNode.jsx';

const nodeTypes = { custom: SpecCustomNode };

// ── Gauge output parser ───────────────────────────────────────────────────

function parseGaugeOutput(lines) {
  const result = { specTitle: null, scenarios: [], summary: null, scenariosSummary: null, timing: null };
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^#(?!#)\s+/.test(t)) {
      result.specTitle = t.replace(/^#\s+/, '');
    } else if (/^\s*##\s+/.test(line)) {
      const passed = (t.match(/✔/g) || []).length;
      const failed = (t.match(/✗/g) || []).length;
      const name = t.replace(/^##\s+/, '').replace(/\s{2,}[✔✗].*$/, '').trim();
      result.scenarios.push({ name, passed, failed });
    } else if (t.startsWith('Specifications:')) {
      result.summary = t;
    } else if (t.startsWith('Scenarios:')) {
      result.scenariosSummary = t;
    } else if (t.startsWith('Total time taken:')) {
      result.timing = t.replace('Total time taken:', '').trim();
    }
  }
  return result;
}

// Build a map of { scenarioName: lineNumber (1-indexed) } from raw spec content
function extractScenarioLines(content) {
  if (!content) return {};
  const map = {};
  content.split('\n').forEach((line, i) => {
    const m = line.match(/^##\s+(.+?)(?:\s+@\S+)*\s*$/);
    if (m) map[m[1].trim()] = i + 1;
  });
  return map;
}

// ── Run output overlay ────────────────────────────────────────────────────

function RunOutputPanel({ lines, status, specPath, specScenarios, onClose }) {
  const bodyRef = useRef(null);
  const logRef = useRef(null);
  const [showLog, setShowLog] = useState(false);
  const parsed = useMemo(() => parseGaugeOutput(lines), [lines]);

  // Auto-open raw log when test fails
  useEffect(() => {
    if (status === 'failed') setShowLog(true);
  }, [status]);

  // Auto-scroll summary body while running
  useEffect(() => {
    if (bodyRef.current && !showLog) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines.length, showLog]);

  // Auto-scroll raw log while running
  useEffect(() => {
    if (logRef.current && status === 'running') {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines.length, status]);

  const inProgressName =
    status === 'running' && specScenarios
      ? specScenarios[parsed.scenarios.length]?.name ?? null
      : null;

  const statusLabel =
    status === 'running' ? 'Running…' : status === 'success' ? 'Passed' : 'Failed';

  return (
    <div className={`run-output-panel${showLog ? ' expanded' : ''}`}>
      <div className="run-output-header">
        <span className={`run-status-indicator ${status}`} />
        <span className="run-output-title">{statusLabel}</span>
        <span className="run-output-path muted">{specPath}</span>
        <button
          className={`run-log-toggle${showLog ? ' active' : ''}`}
          onClick={() => setShowLog((v) => !v)}
          title="Toggle raw log"
        >
          Log
        </button>
        <button className="run-output-close" onClick={onClose} title="Close">✕</button>
      </div>
      {showLog ? (
        <pre className="run-raw-log" ref={logRef}>{lines.join('')}</pre>
      ) : (
        <div className="run-output-body" ref={bodyRef}>
          {parsed.specTitle && <div className="run-spec-title">{parsed.specTitle}</div>}
          <div className="run-scenarios-list">
            {parsed.scenarios.map((s, i) => {
              const total = s.passed + s.failed;
              return (
                <div key={i} className={`run-scenario-row ${s.failed > 0 ? 'failed' : 'passed'}`}>
                  <span className="run-scenario-icon" style={{ animationDelay: `${total * 55}ms` }}>
                    {s.failed > 0 ? '✗' : '✔'}
                  </span>
                  <span className="run-scenario-name">{s.name}</span>
                  <span className="run-scenario-counts">
                    {Array.from({ length: s.passed }).map((_, j) => (
                      <span key={j} className="step-tick pass" style={{ animationDelay: `${j * 55}ms` }}>✔</span>
                    ))}
                    {Array.from({ length: s.failed }).map((_, j) => (
                      <span key={s.passed + j} className="step-tick fail" style={{ animationDelay: `${(s.passed + j) * 55}ms` }}>✗</span>
                    ))}
                  </span>
                </div>
              );
            })}
            {status === 'running' && (
              <div className="run-scenario-row in-progress">
                <span className="run-cursor">▋</span>
                <span className="run-scenario-name muted">{inProgressName || 'Running…'}</span>
              </div>
            )}
          </div>
          {(parsed.summary || parsed.timing) && (
            <div className="run-summary-line">
              {parsed.summary && <span>{parsed.summary}</span>}
              {parsed.scenariosSummary && <span>{parsed.scenariosSummary}</span>}
              {parsed.timing && <span className="muted">⏱ {parsed.timing}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Node detail side panel (read-only) ────────────────────────────────────

function NodeDetailPanel({ node, lineNumber, onClose, onRunScenario, runDisabled }) {
  const data = node.data._rawData || {};
  const isScenario = node.data.type === 'scenario';

  const entries = Object.entries(data).filter(([k, v]) => {
    if (k === 'steps' || k === 'instructions') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });

  return (
    <div className="node-detail-overlay" onClick={onClose}>
      <div className="node-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="node-detail-panel-header">
          <div className="node-detail-panel-title">
            <span className={`node-type type-${node.data.type}`}>{node.data.type}</span>
            <span className="node-detail-panel-name">{node.data.title}</span>
          </div>
          <button className="run-output-close" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="node-detail-panel-body">
          {isScenario && (
            <button
              className="primary"
              style={{ width: '100%', marginBottom: 16 }}
              disabled={runDisabled || lineNumber == null}
              onClick={() => { onRunScenario(lineNumber); onClose(); }}
              title={lineNumber ? `Run line :${lineNumber}` : 'Line number not found'}
            >
              ▶ Run this scenario
            </button>
          )}
          <dl className="node-detail-kv">
            {entries.map(([k, v]) => (
              <div key={k} className="node-detail-row">
                <dt>{k}</dt>
                <dd>
                  {Array.isArray(v)
                    ? v.length === 0 ? '—' : v.map((row, i) => (
                        <span key={i} className="detail-row-item">
                          {typeof row === 'object' ? Object.values(row).join(' · ') : String(row)}
                        </span>
                      ))
                    : String(v ?? '')}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

// ── Main SpecView ─────────────────────────────────────────────────────────

export function SpecView({ scenario, spec, summary, onReload, onSpecSaved }) {
  const [mode, setMode] = useState('visual');
  const [editing, setEditing] = useState(false);
  const [runLines, setRunLines] = useState(null);
  const [runStatus, setRunStatus] = useState(null);

  const scenarioLineMap = useMemo(() => extractScenarioLines(spec?.content), [spec?.content]);

  async function handleRun(lineNumber = null) {
    if (!spec || runStatus === 'running') return;
    setRunLines([]);
    setRunStatus('running');
    try {
      for await (const payload of api.runSpec(spec.path, lineNumber)) {
        if (payload.line != null) setRunLines((prev) => [...prev, payload.line]);
        if (payload.done) setRunStatus(payload.exit_code === 0 ? 'success' : 'failed');
      }
    } catch (err) {
      setRunLines((prev) => [...prev, `Error: ${err.message}\n`]);
      setRunStatus('failed');
    }
  }

  if (!spec) {
    return (
      <div className="tab-page">
        <div className="notice">No matching spec found for {scenario.name}.</div>
      </div>
    );
  }

  if (editing) {
    return (
      <SpecNodeEditor
        spec={spec}
        summary={summary}
        onCancel={() => setEditing(false)}
        onSaved={async () => {
          await onSpecSaved();
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="tab-page spec-page">
      <div className="toolbar">
        <span className="muted" style={{ fontSize: '12px', fontFamily: 'ui-monospace, Consolas, monospace' }}>
          {spec.path}
        </span>
        <div className="spacer" />
        <button className={`filter ${mode === 'visual' ? 'active' : ''}`} onClick={() => setMode('visual')}>
          Visual
        </button>
        <button className={`filter ${mode === 'source' ? 'active' : ''}`} onClick={() => setMode('source')}>
          Source
        </button>
        <button className="filter" onClick={onReload}>Reload</button>
        <button
          className={`run-btn ${runStatus === 'running' ? 'running' : ''}`}
          onClick={() => handleRun()}
          disabled={runStatus === 'running'}
          title="Run all scenarios"
        >
          {runStatus === 'running' ? '● Running' : '▶ Run All'}
        </button>
        <button className="primary" onClick={() => setEditing(true)}>Edit spec</button>
      </div>

      {mode === 'source' ? (
        <pre className="source-box">{spec.content}</pre>
      ) : (
        <SpecVisual
          parsed={spec.parsed}
          scenarioLineMap={scenarioLineMap}
          onRunScenario={handleRun}
          runDisabled={runStatus === 'running'}
        />
      )}

      {runLines !== null && (
        <RunOutputPanel
          lines={runLines}
          status={runStatus}
          specPath={spec.path}
          specScenarios={spec.parsed?.scenarios}
          onClose={() => { setRunLines(null); setRunStatus(null); }}
        />
      )}
    </div>
  );
}

// ── Spec visual (ReactFlow, read-only but clickable) ──────────────────────

function SpecVisual({ parsed, scenarioLineMap, onRunScenario, runDisabled }) {
  const [selectedNode, setSelectedNode] = useState(null);
  const { nodes, edges } = useMemo(() => specToFlow(parsed), [parsed]);

  return (
    <div className="spec-visual">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onNodeClick={(_, node) => setSelectedNode(node)}
      >
        <Background color="#1e293b" gap={16} />
        <Controls />
      </ReactFlow>

      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          lineNumber={selectedNode.data.type === 'scenario'
            ? scenarioLineMap[selectedNode.data.title] ?? null
            : null}
          onClose={() => setSelectedNode(null)}
          onRunScenario={(ln) => { onRunScenario(ln); setSelectedNode(null); }}
          runDisabled={runDisabled}
        />
      )}
    </div>
  );
}
