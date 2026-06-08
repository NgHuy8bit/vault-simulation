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

// Build an ordered list of { text, line (1-indexed) } for every `* step` line
// in the raw spec content — used to jump straight to a failing step reported
// by the json-report (which only gives us step text, not a line number).
function extractStepLines(content) {
  if (!content) return [];
  const steps = [];
  content.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*\*\s+(.+?)\s*$/);
    if (m) steps.push({ text: m[1].trim(), line: i + 1 });
  });
  return steps;
}

function _normalizeStepText(text) {
  return (text || '').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim().toLowerCase();
}

// Find the best-matching line number for a step's text (exact match first,
// then a loose substring match — gauge's reported stepText should mirror the
// spec source for static-string steps, but may differ slightly for params).
function findStepLine(stepLines, stepText) {
  const needle = _normalizeStepText(stepText);
  if (!needle) return null;
  let exact = stepLines.find((s) => _normalizeStepText(s.text) === needle);
  if (exact) return exact.line;
  let loose = stepLines.find((s) => {
    const hay = _normalizeStepText(s.text);
    return hay.includes(needle) || needle.includes(hay);
  });
  return loose ? loose.line : null;
}

// ── Run output overlay ────────────────────────────────────────────────────

function RunOutputPanel({ lines, status, progress, result, specPath, specScenarios, stepLines, onJumpToLine, onClose }) {
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

  // Failing steps across the whole run, flattened — pulled from the gauge
  // json-report (authoritative: exact spec › scenario › step + error/trace).
  const failures = useMemo(() => {
    if (!result?.specs) return [];
    const out = [];
    for (const spec of result.specs) {
      for (const scenario of spec.scenarios) {
        for (const step of scenario.steps) {
          if (step.status === 'failed') {
            out.push({ spec, scenario, step });
          }
        }
        if (scenario.hook_failure) {
          out.push({ spec, scenario, step: null, hookFailure: scenario.hook_failure });
        }
      }
    }
    return out;
  }, [result]);

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

      {/* Live "where are we" breadcrumb — driven by --verbose console parsing
          on the backend. Best-effort: just doesn't update if gauge changes
          its console format, the rest of the panel keeps working regardless. */}
      {status === 'running' && progress && (
        <div className="run-progress-breadcrumb">
          <span className="run-cursor">▋</span>
          {progress.spec && <span className="crumb crumb-spec">{progress.spec}</span>}
          {progress.scenario && <><span className="crumb-sep">›</span><span className="crumb crumb-scenario">{progress.scenario}</span></>}
          {progress.step && <><span className="crumb-sep">›</span><span className="crumb crumb-step">{progress.step}</span></>}
        </div>
      )}

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

          {/* Structured failure breakdown from the json-report — exactly
              which spec › scenario › step failed, with the assertion message
              and a one-click jump to that line in the spec source. */}
          {failures.length > 0 && (
            <div className="run-failures-list">
              <div className="run-failures-title">Failed at</div>
              {failures.map((f, i) => {
                const lineNumber = f.step ? findStepLine(stepLines, f.step.text) : null;
                const errorMessage = f.step ? f.step.error_message : f.hookFailure?.error_message;
                return (
                  <div key={i} className="run-failure-item">
                    <div className="run-failure-path">
                      <span className="muted">{f.spec.heading}</span>
                      <span className="crumb-sep">›</span>
                      <span className="muted">{f.scenario.heading}</span>
                      {f.step && (
                        <>
                          <span className="crumb-sep">›</span>
                          {lineNumber != null ? (
                            <button
                              className="run-failure-step-link"
                              onClick={() => onJumpToLine?.(lineNumber)}
                              title={`Jump to line ${lineNumber} in spec`}
                            >
                              {f.step.text}
                            </button>
                          ) : (
                            <span>{f.step.text}</span>
                          )}
                        </>
                      )}
                      {!f.step && <span className="muted">(scenario teardown / assertion)</span>}
                    </div>
                    {errorMessage && <div className="run-failure-message">{errorMessage}</div>}
                  </div>
                );
              })}
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
  const [runProgress, setRunProgress] = useState(null); // { spec, scenario, step }
  const [runResult, setRunResult] = useState(null);     // structured json-report tree
  const [highlightLine, setHighlightLine] = useState(null);
  const sourceLineRefs = useRef([]);

  const scenarioLineMap = useMemo(() => extractScenarioLines(spec?.content), [spec?.content]);
  const stepLines = useMemo(() => extractStepLines(spec?.content), [spec?.content]);
  const sourceLines = useMemo(() => (spec?.content ? spec.content.split('\n') : []), [spec?.content]);

  function jumpToLine(lineNumber) {
    setMode('source');
    setHighlightLine(lineNumber);
    // Wait for the source view to mount/render before scrolling to it.
    requestAnimationFrame(() => {
      const el = sourceLineRefs.current[lineNumber - 1];
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  async function handleRun(lineNumber = null) {
    if (!spec || runStatus === 'running') return;
    setRunLines([]);
    setRunStatus('running');
    setRunProgress(null);
    setRunResult(null);
    try {
      for await (const payload of api.runSpec(spec.path, lineNumber)) {
        if (payload.line != null) setRunLines((prev) => [...prev, payload.line]);
        if (payload.progress) {
          setRunProgress((prev) => {
            const p = payload.progress;
            // Roll spec/scenario/step headings into a single breadcrumb,
            // resetting the deeper levels whenever a higher one changes.
            if (p.level === 'spec') return { spec: p.text, scenario: null, step: null };
            if (p.level === 'scenario') return { spec: prev?.spec ?? null, scenario: p.text, step: null };
            return { spec: prev?.spec ?? null, scenario: prev?.scenario ?? null, step: p.text };
          });
        }
        if (payload.result) setRunResult(payload.result);
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
        <pre className="source-box">
          {sourceLines.map((line, i) => (
            <div
              key={i}
              ref={(el) => { sourceLineRefs.current[i] = el; }}
              className={`source-line${highlightLine === i + 1 ? ' highlighted' : ''}`}
            >
              <span className="source-line-no muted">{i + 1}</span>
              <span className="source-line-text">{line}</span>
            </div>
          ))}
        </pre>
      ) : (
        <SpecVisual
          parsed={spec.parsed}
          scenarioLineMap={scenarioLineMap}
          onRunScenario={handleRun}
          runDisabled={runStatus === 'running'}
          runStatus={runStatus}
          runProgress={runProgress}
          runResult={runResult}
        />
      )}

      {runLines !== null && (
        <RunOutputPanel
          lines={runLines}
          status={runStatus}
          progress={runProgress}
          result={runResult}
          specPath={spec.path}
          specScenarios={spec.parsed?.scenarios}
          stepLines={stepLines}
          onJumpToLine={jumpToLine}
          onClose={() => { setRunLines(null); setRunStatus(null); setRunProgress(null); setRunResult(null); }}
        />
      )}
    </div>
  );
}

// ── Spec visual (ReactFlow, read-only but clickable) ──────────────────────

function _textsLooselyMatch(a, b) {
  const na = _normalizeStepText(a);
  const nb = _normalizeStepText(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// Walk the flow nodes in source order and assign each a live run status —
// 'running' | 'passed' | 'failed' — by correlating its `_matchText` (raw
// gauge step/scenario text) against:
//   - runProgress: the live "currently executing" breadcrumb (while running)
//   - runResult:   the authoritative json-report tree (once finished)
// Nodes with no correlation get no status (rendered unchanged).
function buildNodeStatusMap(nodes, runStatus, runProgress, runResult) {
  const map = {};
  if (!runStatus) return map;

  const resultScenarios = [];
  if (runResult?.specs) {
    for (const spec of runResult.specs) {
      for (const sc of spec.scenarios) resultScenarios.push(sc);
    }
  }
  const statusOf = (gaugeStatus) => {
    if (gaugeStatus === 'passed') return 'passed';
    if (gaugeStatus === 'failed') return 'failed';
    return null;
  };

  let activeScenarioResult = null;

  for (const node of nodes) {
    const matchText = node.data._matchText || node.data.title;

    if (node.data.type === 'scenario') {
      activeScenarioResult = resultScenarios.find((sc) => _textsLooselyMatch(sc.heading, matchText)) || null;
      if (activeScenarioResult) {
        const st = statusOf(activeScenarioResult.status);
        if (st) map[node.id] = st;
      } else if (
        runStatus === 'running' &&
        runProgress?.scenario &&
        _textsLooselyMatch(runProgress.scenario, matchText)
      ) {
        map[node.id] = 'running';
      }
      continue;
    }

    if (activeScenarioResult) {
      const stepResult = activeScenarioResult.steps.find((st) => _textsLooselyMatch(st.text, matchText));
      if (stepResult) {
        const st = statusOf(stepResult.status);
        if (st) map[node.id] = st;
      }
    } else if (
      runStatus === 'running' &&
      runProgress?.step &&
      _textsLooselyMatch(runProgress.step, matchText)
    ) {
      map[node.id] = 'running';
    }
  }
  return map;
}

function SpecVisual({ parsed, scenarioLineMap, onRunScenario, runDisabled, runStatus, runProgress, runResult }) {
  const [selectedNode, setSelectedNode] = useState(null);
  const { nodes: rawNodes, edges } = useMemo(() => specToFlow(parsed), [parsed]);

  const nodeStatusMap = useMemo(
    () => buildNodeStatusMap(rawNodes, runStatus, runProgress, runResult),
    [rawNodes, runStatus, runProgress, runResult]
  );

  const nodes = useMemo(
    () => rawNodes.map((n) => (
      nodeStatusMap[n.id]
        ? { ...n, data: { ...n.data, runStatus: nodeStatusMap[n.id] } }
        : (n.data.runStatus ? { ...n, data: { ...n.data, runStatus: undefined } } : n)
    )),
    [rawNodes, nodeStatusMap]
  );

  // Auto-pan the diagram so the currently-running node stays in view — the
  // user shouldn't have to hunt for "where is it now" while it's lighting up.
  const flowInstanceRef = useRef(null);
  useEffect(() => {
    if (runStatus !== 'running') return;
    const runningNode = nodes.find((n) => n.data.runStatus === 'running');
    const instance = flowInstanceRef.current;
    if (runningNode && instance?.setCenter) {
      const x = runningNode.position.x + 140;
      const y = runningNode.position.y + 40;
      instance.setCenter(x, y, { zoom: 0.85, duration: 450 });
    }
  }, [nodes, runStatus]);

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
        onInit={(instance) => { flowInstanceRef.current = instance; }}
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
