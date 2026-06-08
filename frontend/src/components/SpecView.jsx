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

// Build an ORDERED list of `## heading` line numbers (1-indexed) from raw
// spec content — one entry per scenario, in source order.
//
// Deliberately NOT a { name: lineNumber } map: data-driven/parameterized specs
// routinely produce multiple scenarios with the *identical* heading text and
// only differing tags (e.g. "Update both last due principal date and maturity
// date" @AC4 vs. the same heading @AC8 — visible in the sidebar as repeated
// "Early repayment during cycle..." entries). A name-keyed map collapses those
// duplicates, so every node with that name resolves to the SAME (last) line —
// clicking "Run this scenario" on the first one would silently run the last
// one instead (gauge runs the correct line, the log is "right", but it's not
// the scenario the user clicked). Matching by source-order position instead —
// paired with each node's `scenarioIndex` from `specToFlow` — is unambiguous
// regardless of duplicate names.
function extractScenarioLineList(content) {
  if (!content) return [];
  const lines = [];
  content.split('\n').forEach((line, i) => {
    if (/^##\s+(.+?)(?:\s+@\S+)*\s*$/.test(line)) lines.push(i + 1);
  });
  return lines;
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

function RunOutputPanel({ lines, status, progress, result, specPath, specScenarios, stepLines, onJumpToLine, onClose, onCollapse }) {
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
    <div className={`run-output-drawer${showLog ? ' wide' : ''}`}>
      <div className="run-output-header">
        <span className={`run-status-indicator ${status}`} />
        <span className="run-output-title">{statusLabel}</span>
        <button
          className={`run-log-toggle${showLog ? ' active' : ''}`}
          onClick={() => setShowLog((v) => !v)}
          title="Toggle raw log"
        >
          Log
        </button>
        <div className="spacer" />
        <button className="run-output-close" onClick={onCollapse} title="Collapse panel">⏵</button>
        <button className="run-output-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="run-output-path muted">{specPath}</div>

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [runTargetScenarioIndex, setRunTargetScenarioIndex] = useState(null); // null = "Run All"
  const [highlightLine, setHighlightLine] = useState(null);
  const sourceLineRefs = useRef([]);

  // Progressive parse of the raw streamed console lines — this is the same
  // mechanism that already animates the scenario tick-list one row at a
  // time, so it's the most reliable "what has finished so far" live source.
  const parsedRunOutput = useMemo(() => parseGaugeOutput(runLines || []), [runLines]);

  const scenarioLineList = useMemo(() => extractScenarioLineList(spec?.content), [spec?.content]);
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
    setDrawerOpen(true);
    // Remember WHICH scenario was targeted (by its source-order index, the
    // only collision-free key — see extractScenarioLineList) so the live
    // "while running" approximation can light up that exact node instead of
    // guessing positionally from the console output, which only ever lists
    // the scenario(s) that actually ran — wrong for single-scenario runs.
    setRunTargetScenarioIndex(lineNumber != null ? scenarioLineList.indexOf(lineNumber) : null);
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
      <div className="spec-path-bar">
        <span className="spec-path-label muted">SPEC FILE</span>
        <span className="spec-path-value">{spec.path}</span>
      </div>
      <div className="toolbar spec-toolbar">
        <button className={`filter ${mode === 'visual' ? 'active' : ''}`} onClick={() => setMode('visual')}>
          Visual
        </button>
        <button className={`filter ${mode === 'source' ? 'active' : ''}`} onClick={() => setMode('source')}>
          Source
        </button>
        <button className="filter" onClick={onReload}>Reload</button>
        <div className="spacer" />
        {runLines !== null && (
          <button
            className={`filter ${drawerOpen ? 'active' : ''}`}
            onClick={() => setDrawerOpen((v) => !v)}
            title="Toggle run results panel"
          >
            {drawerOpen ? 'Hide results ▸' : '◂ Show results'}
          </button>
        )}
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

      <div className="spec-body">
        <div className="spec-main">
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
              scenarioLineList={scenarioLineList}
              onRunScenario={handleRun}
              runDisabled={runStatus === 'running'}
              runStatus={runStatus}
              parsedRunOutput={parsedRunOutput}
              runResult={runResult}
              runTargetScenarioIndex={runTargetScenarioIndex}
            />
          )}
        </div>

        {runLines !== null && drawerOpen && (
          <RunOutputPanel
            lines={runLines}
            status={runStatus}
            progress={runProgress}
            result={runResult}
            specPath={spec.path}
            specScenarios={spec.parsed?.scenarios}
            stepLines={stepLines}
            onJumpToLine={jumpToLine}
            onClose={() => { setRunLines(null); setRunStatus(null); setRunProgress(null); setRunResult(null); setDrawerOpen(false); }}
            onCollapse={() => setDrawerOpen(false)}
          />
        )}
      </div>
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

// ── Pinpointing balance-check failures to their exact node ────────────────
//
// The framework runs balance assertions as part of the "run simulation" step
// but gauge surfaces their failures via `afterScenarioHookFailure` — i.e.
// attached to the *scenario*, not to any step. That leaves the diagram unable
// to point at "this node" using status alone. However, the assertion message
// itself is highly structured ("At <ts> check the balance of account <id>,
// address <addr>, denomination <denom>, asset <asset> ..."), and every
// `balance_check`/`balance_check_multi` node carries the exact same fields in
// its parsed `_rawData.rows` (see spec_parser._parse_balance_check*). So we
// can regex the failure message and cross-reference it against each
// candidate node's rows to land on the precise node — and even the precise
// row — that the assertion was checking.

const _BALANCE_FAILURE_RE =
  /At\s+(\S+(?:\s+\S+)?)\s+check the balance of account\s+([^\s,]+),\s*address\s+([^\s,]+),\s*denomination\s+([^\s,]+),\s*asset\s+([^\s,.]+)/;

function _normalizeTimestamp(ts) {
  if (!ts) return '';
  // Spec tables use "2024-09-15T01:00:00"; assertion messages use
  // "2024-09-15 01:00:00+07:00" — collapse both to "date time" with no tz.
  return String(ts).replace('T', ' ').replace(/\s*[+-]\d{2}:?\d{2}$|Z$/, '').trim();
}

function parseBalanceCheckFailure(message) {
  const m = (message || '').match(_BALANCE_FAILURE_RE);
  if (!m) return null;
  return { timestamp: m[1].trim(), account_id: m[2], address: m[3], denomination: m[4], asset: m[5] };
}

// Search the scenario's own step nodes (never across scenarios — a failure
// belongs to the run that produced it) for the balance-check row that the
// failure message describes.
function findBalanceCheckMatch(stepNodes, failure) {
  if (!failure) return null;
  const wantTs = _normalizeTimestamp(failure.timestamp);
  for (const node of stepNodes) {
    if (node.data.type !== 'balance_check' && node.data.type !== 'balance_check_multi') continue;
    const rows = node.data._rawData?.rows || [];
    const rowIndex = rows.findIndex((row) =>
      row.account_id === failure.account_id &&
      row.address === failure.address &&
      row.denomination === failure.denomination &&
      row.asset === failure.asset &&
      _normalizeTimestamp(row.timestamp) === wantTs
    );
    if (rowIndex !== -1) return { node, rowIndex, totalRows: rows.length };
  }
  return null;
}

const _statusOf = (gaugeStatus) => {
  if (gaugeStatus === 'passed') return 'passed';
  if (gaugeStatus === 'failed') return 'failed';
  return null;
};

// Precise mapping (post-run): correlates each node's `_matchText` against the
// authoritative gauge json-report tree (exact step text + pass/fail). This is
// only available once the run finishes and gauge has (re)written result.json.
// Returns both the status per node and — for failed nodes — the assertion
// message straight from the json-report, so the diagram can surface "what
// broke" without the user having to dig through the raw log.
function buildPreciseStatusMap(nodes, runResult) {
  const statusMap = {};
  const errorMap = {};
  const resultScenarios = [];
  for (const spec of runResult?.specs || []) {
    for (const sc of spec.scenarios) resultScenarios.push(sc);
  }

  // Group the diagram's flat node list into per-scenario blocks (a `scenario`
  // header followed by its step nodes) so each block can be matched against
  // exactly one result scenario — critical for partial runs (e.g. running a
  // single scenario by line number), where `resultScenarios` only has ONE
  // entry: a loose substring match against every block would happily match
  // several similarly-named scenarios (e.g. "Update X" vs "Update X non-...")
  // and light all of them up red. Matching is greedy and consumes each result
  // scenario at most once, with an exact-heading match always preferred over
  // a loose one, so unrelated/un-run scenarios are left with no status at all.
  const blocks = [];
  let currentBlock = null;
  for (const node of nodes) {
    if (node.data.type === 'scenario') {
      currentBlock = { scenarioNode: node, stepNodes: [] };
      blocks.push(currentBlock);
    } else if (currentBlock) {
      currentBlock.stepNodes.push(node);
    }
  }

  const usedResultIndex = new Set();
  function consumeMatchingResult(matchText) {
    const needle = _normalizeStepText(matchText);
    if (!needle) return null;
    let idx = resultScenarios.findIndex((sc, i) => !usedResultIndex.has(i) && _normalizeStepText(sc.heading) === needle);
    if (idx === -1) {
      idx = resultScenarios.findIndex((sc, i) => !usedResultIndex.has(i) && _textsLooselyMatch(sc.heading, matchText));
    }
    if (idx === -1) return null;
    usedResultIndex.add(idx);
    return resultScenarios[idx];
  }

  for (const block of blocks) {
    const matchText = block.scenarioNode.data._matchText || block.scenarioNode.data.title;
    const scenarioResult = consumeMatchingResult(matchText);
    if (!scenarioResult) continue;

    const st = _statusOf(scenarioResult.status);
    if (st) statusMap[block.scenarioNode.id] = st;

    for (const stepNode of block.stepNodes) {
      const stepMatchText = stepNode.data._matchText || stepNode.data.title;
      const stepResult = scenarioResult.steps.find((st2) => _textsLooselyMatch(st2.text, stepMatchText));
      const sst = stepResult && _statusOf(stepResult.status);
      if (sst) statusMap[stepNode.id] = sst;
      if (sst === 'failed' && stepResult?.error_message) errorMap[stepNode.id] = stepResult.error_message;
    }

    // Hook-level failure (gauge attaches balance/teardown assertions to the
    // scenario, not a step) — try to resolve it down to the exact
    // balance-check node + row it was actually checking; only fall back to
    // pinning the message on the scenario header when that's not possible.
    if (st === 'failed' && scenarioResult.hook_failure) {
      const message = scenarioResult.hook_failure.error_message;
      const failure = parseBalanceCheckFailure(message);
      const match = failure && findBalanceCheckMatch(block.stepNodes, failure);
      if (match) {
        statusMap[match.node.id] = 'failed';
        errorMap[match.node.id] = `Row ${match.rowIndex + 1}/${match.totalRows} — ${message}`;
      } else {
        errorMap[block.scenarioNode.id] = message;
      }
    }
  }
  return { statusMap, errorMap };
}

// Live approximation (while running): gauge's console reporter buffers a
// scenario's entire output (heading + every step's tick/cross) and only
// flushes it to stdout once that scenario finishes — there is no real-time
// per-step signal to read. What DOES arrive progressively, scenario by
// scenario, is the `## <heading>  ✔ ✔ ✗ ...` summary line — which is exactly
// what `parseGaugeOutput` already extracts into `parsed.scenarios` (that's
// how the existing tick-list above animates in). So: the Nth scenario block
// lights up amber as soon as scenario N-1's summary line has streamed in,
// and flips to green/red using that same line's pass/fail counts — at
// scenario-block granularity, which is the finest grain gauge actually
// reports live. The precise per-step colors land once `runResult` arrives.
// `targetScenarioIndex` is the source-order index of the scenario the user
// actually asked gauge to run (null = "Run All"). The console only ever
// reports the scenario(s) that ran — for a single-scenario run that's a
// one-element list — so positionally mapping "Nth reported" to "Nth node in
// the diagram" is wrong whenever the targeted scenario isn't the first one.
// When we know the target, light up only that scenario's block directly from
// the lone reported entry instead of guessing by position.
function buildLiveStatusMap(nodes, runStatus, parsedOutput, targetScenarioIndex) {
  const map = {};
  const completed = parsedOutput?.scenarios || [];
  let scenarioIndex = -1;
  let blockActive = false;
  let blockStatus = null;

  for (const node of nodes) {
    if (node.data.type === 'scenario') {
      scenarioIndex += 1;
      if (targetScenarioIndex != null) {
        blockActive = scenarioIndex === targetScenarioIndex;
        if (blockActive) {
          if (completed.length > 0) {
            blockStatus = completed[0].failed > 0 ? 'failed' : 'passed';
          } else if (runStatus === 'running') {
            blockStatus = 'running';
          } else {
            blockStatus = null;
          }
        } else {
          blockStatus = null;
        }
      } else {
        blockActive = true;
        if (scenarioIndex < completed.length) {
          blockStatus = completed[scenarioIndex].failed > 0 ? 'failed' : 'passed';
        } else if (scenarioIndex === completed.length && runStatus === 'running') {
          blockStatus = 'running';
        } else {
          blockStatus = null;
        }
      }
    }
    if (blockActive && blockStatus) map[node.id] = blockStatus;
  }
  return map;
}

// Walk the flow nodes and assign each a live run status — 'running' |
// 'passed' | 'failed' — preferring the precise per-step json-report mapping
// once it's available, and falling back to the scenario-block-level live
// approximation while the run is still in progress. Also returns an
// `errorMap` of nodeId → assertion message for nodes that failed, so the
// diagram itself can show "what broke" inline.
function buildNodeStatusMap(nodes, runStatus, parsedOutput, runResult, targetScenarioIndex) {
  if (!runStatus) return { statusMap: {}, errorMap: {} };
  if (runResult) return buildPreciseStatusMap(nodes, runResult);
  return { statusMap: buildLiveStatusMap(nodes, runStatus, parsedOutput, targetScenarioIndex), errorMap: {} };
}

function SpecVisual({ parsed, scenarioLineList, onRunScenario, runDisabled, runStatus, parsedRunOutput, runResult, runTargetScenarioIndex }) {
  const [selectedNode, setSelectedNode] = useState(null);
  const { nodes: rawNodes, edges } = useMemo(() => specToFlow(parsed), [parsed]);

  const { statusMap: nodeStatusMap, errorMap: nodeErrorMap } = useMemo(
    () => buildNodeStatusMap(rawNodes, runStatus, parsedRunOutput, runResult, runTargetScenarioIndex),
    [rawNodes, runStatus, parsedRunOutput, runResult, runTargetScenarioIndex]
  );

  const nodes = useMemo(
    () => rawNodes.map((n) => {
      const status = nodeStatusMap[n.id];
      const error = nodeErrorMap[n.id] || null;
      if (!status && !n.data.runStatus && !n.data.runError) return n;
      return { ...n, data: { ...n.data, runStatus: status, runError: error } };
    }),
    [rawNodes, nodeStatusMap, nodeErrorMap]
  );

  const failedNodes = useMemo(() => nodes.filter((n) => n.data.runStatus === 'failed'), [nodes]);

  // Auto-pan the diagram so the node that needs attention stays in view —
  // while running, follow the currently-executing node; once the run lands,
  // jump straight to the first failure so the user sees what broke without
  // hunting through a dense diagram.
  const flowInstanceRef = useRef(null);
  useEffect(() => {
    const instance = flowInstanceRef.current;
    if (!instance?.setCenter) return;

    let target = null;
    if (runStatus === 'running') {
      target = nodes.find((n) => n.data.runStatus === 'running');
    } else if (runStatus === 'failed' && failedNodes.length > 0) {
      // Prefer landing on the node carrying the actual error message (the
      // precisely-resolved failing step) over the scenario header it rolls
      // up to — that's the node the user actually needs to look at.
      target = failedNodes.find((n) => n.data.runError) || failedNodes[0];
    }
    if (target) {
      const x = target.position.x + 140;
      const y = target.position.y + 40;
      instance.setCenter(x, y, { zoom: 0.85, duration: 450 });
    }
  }, [nodes, runStatus, failedNodes]);

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
        <Controls position="top-right" />
      </ReactFlow>

      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          lineNumber={selectedNode.data.type === 'scenario'
            ? scenarioLineList[selectedNode.data.scenarioIndex] ?? null
            : null}
          onClose={() => setSelectedNode(null)}
          onRunScenario={(ln) => { onRunScenario(ln); setSelectedNode(null); }}
          runDisabled={runDisabled}
        />
      )}
    </div>
  );
}
