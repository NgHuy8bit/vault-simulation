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

function fmtDuration(ms) {
  if (ms == null) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function RunOutputPanel({ lines, status, progress, result, specPath, specScenarios, stepLines, onJumpToLine, onClose, onCollapse }) {
  const bodyRef = useRef(null);
  const logRef = useRef(null);
  const [showLog, setShowLog] = useState(false);
  const parsed = useMemo(() => parseGaugeOutput(lines), [lines]);

  const scenarioDurations = useMemo(() => {
    if (!result?.specs) return {};
    const map = {};
    for (const spec of result.specs) {
      for (const sc of spec.scenarios) {
        map[sc.heading] = sc.duration_ms;
      }
    }
    return map;
  }, [result]);

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
        <button className="run-output-close" onClick={onCollapse} title="Collapse panel">⏷</button>
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
                  {scenarioDurations[s.name] != null && (
                    <span className="run-scenario-duration muted">{fmtDuration(scenarioDurations[s.name])}</span>
                  )}
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
          {(parsed.summary || parsed.timing || result?.total_duration_ms != null) && (
            <div className="run-summary-line">
              {parsed.summary && <span>{parsed.summary}</span>}
              {parsed.scenariosSummary && <span>{parsed.scenariosSummary}</span>}
              {result?.total_duration_ms != null
                ? <span className="muted">⏱ {fmtDuration(result.total_duration_ms)}</span>
                : parsed.timing && <span className="muted">⏱ {parsed.timing}</span>}
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

// ── Node detail panel helpers ─────────────────────────────────────────────

function fmtTimestamp(ts) {
  if (!ts) return '—';
  return String(ts).replace('T', ' ').replace(/\s*[+-]\d{2}:?\d{2}$|Z$/, '');
}

function fmtBalance(val) {
  if (val == null || val === '') return '—';
  const n = Number(String(val).replace(/_/g, ''));
  if (isNaN(n)) return String(val).replace(/_/g, ',');
  return n.toLocaleString('en-US');
}

function fmtAmount(val, denom) {
  const s = fmtBalance(val);
  return denom ? `${s} ${denom}` : s;
}

function DetailLabel({ children }) {
  return <div className="nd-label">{children}</div>;
}
function DetailValue({ children, mono, muted, highlight }) {
  const cls = ['nd-value', mono && 'mono', muted && 'muted', highlight && 'highlight'].filter(Boolean).join(' ');
  return <div className={cls}>{children || '—'}</div>;
}
function DetailRow({ label, children, mono, muted, highlight }) {
  return (
    <div className="nd-row">
      <DetailLabel>{label}</DetailLabel>
      <DetailValue mono={mono} muted={muted} highlight={highlight}>{children}</DetailValue>
    </div>
  );
}
function DetailSection({ title, children }) {
  return (
    <div className="nd-section">
      {title && <div className="nd-section-title">{title}</div>}
      {children}
    </div>
  );
}

function KVTable({ rows }) {
  if (!rows || rows.length === 0) return null;
  const keys = Object.keys(rows[0] || {});
  return (
    <table className="nd-table">
      <thead>
        <tr>{keys.map((k) => <th key={k}>{k}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {keys.map((k) => <td key={k}>{String(row[k] ?? '—')}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Balance check — the richest view: structured table grouping by timestamp
function BalanceCheckView({ data }) {
  const rows = data.rows || [];
  const denom = data.denomination;

  // Group rows by timestamp so repeated timestamps collapse visually
  const groups = [];
  let last = null;
  for (const row of rows) {
    const ts = fmtTimestamp(row.timestamp);
    if (ts !== last) { groups.push({ ts, rows: [] }); last = ts; }
    groups[groups.length - 1].rows.push(row);
  }

  return (
    <div className="nd-balance-wrap">
      {denom && (
        <div className="nd-balance-denom-badge">{denom}</div>
      )}
      <table className="nd-balance-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Timestamp</th>
            <th>Account</th>
            <th>Address</th>
            <th className="nd-col-balance">Balance</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) =>
            g.rows.map((row, j) => {
              const isZero = Number(String(row.balance).replace(/_/g, '')) === 0;
              const bal = fmtBalance(row.balance);
              return (
                <tr key={`${g.ts}-${j}`} className="nd-balance-row">
                  <td className="nd-col-idx">{groups.indexOf(g) + j + 1}</td>
                  <td className="nd-col-ts">
                    {j === 0 ? (
                      <span className="nd-ts-badge">{g.ts}</span>
                    ) : (
                      <span className="nd-ts-repeat">↑</span>
                    )}
                  </td>
                  <td className="nd-col-account">
                    <span className="nd-account-id">{row.account_id || '—'}</span>
                    {(row.phase || row.asset) && (
                      <span className="nd-phase-asset">
                        {[row.phase, row.asset].filter(Boolean).map((v) =>
                          v.replace('POSTING_PHASE_', '').replace('_BANK_MONEY', '')
                        ).join(' · ')}
                      </span>
                    )}
                  </td>
                  <td className="nd-col-address">
                    <span className="nd-address-pill">{row.address || '—'}</span>
                  </td>
                  <td className={`nd-col-balance ${isZero ? 'zero' : 'nonzero'}`}>
                    {bal}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// Transaction nodes: inbound / outbound / transfer / custom_instruction / settlement / release
function TransactionView({ data, type }) {
  const isCustom = type === 'custom_instruction';
  const isTransfer = type === 'transfer' || isCustom;

  // custom_instruction: single account_id + from_address / to_address
  // transfer:           from_account / to_account
  // inbound/outbound:   no accounts in data (just amount + denomination)
  const fromLabel = isCustom ? 'From address' : isTransfer ? 'From' : type === 'inbound' ? 'Internal' : 'Customer';
  const toLabel   = isCustom ? 'To address'   : isTransfer ? 'To'   : type === 'inbound' ? 'Customer' : 'Internal';
  const fromValue = isCustom
    ? (data.from_address || '—')
    : (data.from_account || data.client_transaction_id || '—');
  const toValue   = isCustom ? (data.to_address || '—') : (data.to_account || '—');

  return (
    <DetailSection>
      {data.timestamp && (
        <DetailRow label="Timestamp" mono>{fmtTimestamp(data.timestamp)}</DetailRow>
      )}
      {isCustom && data.account_id && (
        <DetailRow label="Account ID" mono highlight>{data.account_id}</DetailRow>
      )}
      <div className="nd-tx-flow">
        <div className="nd-tx-account nd-tx-from">
          <span className="nd-tx-role muted">{fromLabel}</span>
          <span className="nd-tx-acct-id">{fromValue}</span>
        </div>
        <div className="nd-tx-arrow">
          <span className="nd-tx-amount">{fmtAmount(data.amount, data.denomination)}</span>
          <span className="nd-tx-arrow-line">→</span>
        </div>
        <div className="nd-tx-account nd-tx-to">
          <span className="nd-tx-role muted">{toLabel}</span>
          <span className="nd-tx-acct-id">{toValue}</span>
        </div>
      </div>
      {data.instruction_detail && data.instruction_detail.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <DetailLabel>Instruction details</DetailLabel>
          <KVTable rows={data.instruction_detail} />
        </div>
      )}
    </DetailSection>
  );
}

// ── Smart param value renderer ──────────────────────────────────────────

function fmtParamStr(s) {
  // Numbers written with underscores (e.g. 100_000_000) → locale-formatted
  if (/^-?\d[\d_]*(\.\d+)?$/.test(String(s))) {
    const n = Number(String(s).replace(/_/g, ''));
    if (!isNaN(n)) return n.toLocaleString('en-US');
  }
  return String(s);
}

function tryParseJSON(s) {
  const t = String(s ?? '').trim();
  if ((t.startsWith('[') || t.startsWith('{')) && (t.endsWith(']') || t.endsWith('}'))) {
    try { return JSON.parse(t); } catch {}
  }
  return null;
}

function SmartValue({ value }) {
  const s = String(value ?? '');
  const parsed = tryParseJSON(s);

  // Array of objects → mini table
  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
    const keys = Object.keys(parsed[0]);
    return (
      <table className="nd-sub-table">
        <thead><tr>{keys.map((k) => <th key={k}>{k.replace(/_/g, ' ')}</th>)}</tr></thead>
        <tbody>
          {parsed.map((row, i) => (
            <tr key={i}>
              {keys.map((k) => <td key={k}>{fmtParamStr(row[k] ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Array of scalars → comma list
  if (Array.isArray(parsed)) {
    return (
      <span className="nd-scalar-list">
        {parsed.map((v, i) => (
          <span key={i} className="nd-scalar-item">{fmtParamStr(v)}</span>
        ))}
      </span>
    );
  }

  // Plain object → nested kv
  if (parsed && typeof parsed === 'object') {
    return (
      <div className="nd-nested-kv">
        {Object.entries(parsed).map(([k, v]) => (
          <div key={k} className="nd-nested-row">
            <span className="nd-nested-key">{k.replace(/_/g, ' ')}</span>
            <span className="nd-nested-val">{fmtParamStr(v)}</span>
          </div>
        ))}
      </div>
    );
  }

  // Scalar — format and display
  return <span className="nd-scalar-val">{fmtParamStr(s) || '—'}</span>;
}

// Params list — stacks each param vertically so long keys/values have full width
function ParamsView({ params, label = 'Parameters' }) {
  if (!params || params.length === 0) return null;
  return (
    <DetailSection title={label}>
      <div className="nd-params-list">
        {params.map((p, i) => {
          const key = p.name || p.key || '—';
          const val = p.value;
          const parsed = tryParseJSON(String(val ?? ''));
          const isComplex = Array.isArray(parsed) || (parsed && typeof parsed === 'object');
          return (
            <div key={i} className={`nd-param-item${isComplex ? ' complex' : ''}`}>
              <div className="nd-param-key">{key.replace(/_/g, '_​')}</div>
              <div className="nd-param-val"><SmartValue value={val} /></div>
            </div>
          );
        })}
      </div>
    </DetailSection>
  );
}

// ── Node detail side panel (read-only) ────────────────────────────────────

function NodeDetailPanel({ node, lineNumber, onClose, onRunScenario, runDisabled }) {
  const data = node.data._rawData || {};
  const type = node.data.type;
  const isScenario = type === 'scenario';
  const isBalanceCheck = type === 'balance_check' || type === 'balance_check_multi';
  const isTx = ['inbound', 'outbound', 'transfer', 'custom_instruction', 'settlement', 'release'].includes(type);

  function renderBody() {
    if (isBalanceCheck) {
      return <BalanceCheckView data={data} />;
    }
    if (isTx) {
      return <TransactionView data={data} type={type} />;
    }
    if (type === 'account') {
      return (
        <DetailSection>
          <DetailRow label="Account ID" mono highlight>{data.account_id}</DetailRow>
          {data.version_id && <DetailRow label="Version ID" mono>{data.version_id}</DetailRow>}
          <ParamsView params={data.params || data.parameter_values} />
        </DetailSection>
      );
    }
    if (type === 'product') {
      return (
        <DetailSection>
          <DetailRow label="Product" mono highlight>{data.name}</DetailRow>
          {data.version_id && <DetailRow label="Version ID" mono>{data.version_id}</DetailRow>}
          <ParamsView params={data.params} />
        </DetailSection>
      );
    }
    if (type === 'config') {
      return (
        <DetailSection>
          <DetailRow label={data.key} mono highlight>{data.value}</DetailRow>
        </DetailSection>
      );
    }
    if (type === 'scenario') {
      return (
        <DetailSection>
          {data.name && <DetailRow label="Name">{data.name}</DetailRow>}
          {data.tags && <DetailRow label="Tags" mono muted>{data.tags}</DetailRow>}
        </DetailSection>
      );
    }
    if (type === 'schedule') {
      return (
        <DetailSection>
          <DetailRow label="Timestamp" mono>{fmtTimestamp(data.timestamp)}</DetailRow>
          <DetailRow label="Account" mono highlight>{data.account_id}</DetailRow>
          <DetailRow label="Event" mono>{data.event_id}</DetailRow>
        </DetailSection>
      );
    }
    if (type === 'notification') {
      return (
        <DetailSection>
          <DetailRow label="Timestamp" mono>{fmtTimestamp(data.timestamp)}</DetailRow>
          <DetailRow label="Account" mono highlight>{data.account_id}</DetailRow>
          <DetailRow label="Type" mono>{data.notification_type}</DetailRow>
          {data.notification_details?.length > 0 && (
            <ParamsView params={data.notification_details} label="Details" />
          )}
        </DetailSection>
      );
    }
    if (type === 'flag' || type === 'flag_definition') {
      return (
        <DetailSection>
          {data.timestamp && <DetailRow label="Timestamp" mono>{fmtTimestamp(data.timestamp)}</DetailRow>}
          <DetailRow label="Flag" mono highlight>{data.flag_name}</DetailRow>
          {data.account_id && <DetailRow label="Account" mono>{data.account_id}</DetailRow>}
          {data.expiry_timestamp && <DetailRow label="Expires" mono>{fmtTimestamp(data.expiry_timestamp)}</DetailRow>}
        </DetailSection>
      );
    }
    if (type === 'global_param') {
      return (
        <DetailSection>
          {data.timestamp && <DetailRow label="Timestamp" mono>{fmtTimestamp(data.timestamp)}</DetailRow>}
          <DetailRow label="Parameter" mono highlight>{data.name}</DetailRow>
          {data.value && <DetailRow label="Value" mono>{data.value}</DetailRow>}
          {data.rows?.length > 0 && <ParamsView params={data.rows} label="Values" />}
        </DetailSection>
      );
    }
    if (type === 'derived_parameters' || type === 'derived_parameter_dict') {
      return (
        <DetailSection>
          <DetailRow label="Timestamp" mono>{fmtTimestamp(data.timestamp)}</DetailRow>
          {data.account_id && <DetailRow label="Account" mono highlight>{data.account_id}</DetailRow>}
          {data.param_name && <DetailRow label="Parameter" mono>{data.param_name}</DetailRow>}
          <ParamsView params={data.rows} label="Expected values" />
        </DetailSection>
      );
    }
    if (type === 'update_account_status') {
      return (
        <DetailSection>
          <DetailRow label="Timestamp" mono>{fmtTimestamp(data.timestamp)}</DetailRow>
          <DetailRow label="Account" mono highlight>{data.account_id}</DetailRow>
          <DetailRow label="New status" mono>{data.status}</DetailRow>
        </DetailSection>
      );
    }
    if (type === 'change_instance_params' || type === 'change_template_params') {
      return (
        <DetailSection>
          {data.account_id && <DetailRow label="Account" mono highlight>{data.account_id}</DetailRow>}
          {data.product_version_id && <DetailRow label="Version" mono>{data.product_version_id}</DetailRow>}
          <ParamsView params={data.params} label="Parameter changes" />
        </DetailSection>
      );
    }
    if (type === 'accepted' || type === 'rejected') {
      return (
        <DetailSection>
          <DetailRow label="Timestamp" mono>{fmtTimestamp(data.timestamp)}</DetailRow>
          <DetailRow label="Account" mono highlight>{data.account_id}</DetailRow>
          {data.rejection_type && <DetailRow label="Reason type" mono>{data.rejection_type}</DetailRow>}
          {data.rejection_reason && <DetailRow label="Reason">{data.rejection_reason}</DetailRow>}
        </DetailSection>
      );
    }
    if (type === 'posting_instruction_batch') {
      const instructions = data.instructions || [];
      return (
        <DetailSection>
          {data.timestamp && <DetailRow label="Timestamp" mono>{fmtTimestamp(data.timestamp)}</DetailRow>}
          {instructions.length > 0 && (
            <DetailSection title={`Instructions (${instructions.length})`}>
              {instructions.map((instr, i) => {
                // Spec uses two column-name patterns:
                //   "initiate an instruction batch" → instruction_type / amount / denomination /
                //                                     creditor_account_id / debtor_account_id
                //   "make a posting instruction batch" → posting_type / instruction_attribute /
                //                                        client_transaction_id
                const instrType = instr.instruction_type || instr.posting_type || `#${i + 1}`;
                const amount    = instr.amount;
                const denom     = instr.denomination;
                const creditor  = instr.creditor_account_id;
                const debtor    = instr.debtor_account_id;
                const txnId     = instr.client_transaction_id;
                const attr      = instr.instruction_attribute;
                return (
                  <div key={i} className="nd-instr-item">
                    <div className="nd-instr-row">
                      <span className="nd-instr-type">{instrType}</span>
                      {amount && (
                        <span className="nd-instr-amount">{fmtAmount(amount, denom)}</span>
                      )}
                    </div>
                    {(debtor || creditor) && (
                      <div className="nd-instr-accounts">
                        <span className="nd-instr-acct debtor">{debtor || '—'}</span>
                        <span className="nd-instr-arrow">→</span>
                        <span className="nd-instr-acct creditor">{creditor || '—'}</span>
                      </div>
                    )}
                    {txnId && (
                      <div className="nd-instr-txn">TXN #{txnId}</div>
                    )}
                    {attr && (
                      <div className="nd-instr-attr">{attr}</div>
                    )}
                  </div>
                );
              })}
            </DetailSection>
          )}
        </DetailSection>
      );
    }
    if (type === 'instruction_detail_check' || type === 'batch_detail_check') {
      return (
        <DetailSection>
          {data.timestamp && <DetailRow label="Timestamp" mono>{fmtTimestamp(data.timestamp)}</DetailRow>}
          {data.rows?.length > 0 && <KVTable rows={data.rows} />}
        </DetailSection>
      );
    }
    if (type === 'inbound_auth' || type === 'outbound_auth') {
      return (
        <DetailSection>
          {data.timestamp && <DetailRow label="Timestamp" mono>{fmtTimestamp(data.timestamp)}</DetailRow>}
          <div className="nd-tx-flow">
            <div className="nd-tx-account nd-tx-from">
              <span className="nd-tx-role muted">{type === 'inbound_auth' ? 'Internal' : 'Customer'}</span>
              <span className="nd-tx-acct-id">{data.from_account || '—'}</span>
            </div>
            <div className="nd-tx-arrow">
              <span className="nd-tx-amount">{fmtAmount(data.amount, data.denomination)}</span>
              <span className="nd-tx-arrow-line">→</span>
            </div>
            <div className="nd-tx-account nd-tx-to">
              <span className="nd-tx-role muted">{type === 'inbound_auth' ? 'Customer' : 'Internal'}</span>
              <span className="nd-tx-acct-id">{data.to_account || '—'}</span>
            </div>
          </div>
          {data.client_transaction_id && <DetailRow label="TXN ID" mono>{data.client_transaction_id}</DetailRow>}
        </DetailSection>
      );
    }
    // Fallback: generic key-value
    const entries = Object.entries(data).filter(([k, v]) => {
      if (k === 'steps' || k === 'instructions') return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    });
    return (
      <DetailSection>
        {entries.map(([k, v]) => (
          <DetailRow key={k} label={k} mono>
            {Array.isArray(v)
              ? v.map((r, i) => (
                  <span key={i} style={{ display: 'block', borderTop: i > 0 ? '1px solid #1e293b' : 'none', paddingTop: i > 0 ? 3 : 0 }}>
                    {typeof r === 'object' ? Object.values(r).join(' · ') : String(r)}
                  </span>
                ))
              : String(v ?? '—')}
          </DetailRow>
        ))}
      </DetailSection>
    );
  }

  function renderError() {
    const msg = node.data.runError;
    if (!msg) return null;
    const diff = parseBalanceDiff(msg);
    if (diff) {
      return (
        <div className="nd-run-error">
          <div className="nd-run-error-title">⚠ Balance Mismatch</div>
          {diff.description && <div className="nd-run-error-desc">{diff.description}</div>}
          <table className="nd-balance-diff-table">
            <thead>
              <tr>
                <th>Address</th>
                <th>Denom</th>
                <th>Phase</th>
                <th className="nd-bd-num">Expected</th>
                <th className="nd-bd-num">Actual</th>
                <th className="nd-bd-num">Δ</th>
              </tr>
            </thead>
            <tbody>
              {diff.diffs.map((d, i) => {
                const exp = parseFloat(d.expected);
                const act = parseFloat(d.actual);
                const delta = act - exp;
                return (
                  <tr key={i}>
                    <td className="nd-bd-addr">{d.dims.address || '—'}</td>
                    <td className="nd-bd-denom">{d.dims.denomination || '—'}</td>
                    <td className="nd-bd-phase">{(d.dims.phase || '').replace('POSTING_PHASE_', '')}</td>
                    <td className="nd-bd-num nd-bd-expected">{Number(d.expected).toLocaleString()}</td>
                    <td className="nd-bd-num nd-bd-actual">{Number(d.actual).toLocaleString()}</td>
                    <td className={`nd-bd-num nd-bd-delta ${delta >= 0 ? 'nd-bd-pos' : 'nd-bd-neg'}`}>
                      {delta > 0 ? '+' : ''}{delta.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }
    return (
      <div className="nd-run-error">
        <div className="nd-run-error-title">⚠ Failure</div>
        <div className="nd-run-error-message">{msg}</div>
      </div>
    );
  }

  return (
    <div className="node-detail-overlay" onClick={onClose}>
      <div className={`node-detail-panel${isBalanceCheck ? ' wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="node-detail-panel-header">
          <div className="node-detail-panel-title">
            <span className={`node-type type-${type}`}>{type}</span>
            <span className="node-detail-panel-name">{node.data.title}</span>
            {node.data.subtitle && <span className="nd-subtitle">{node.data.subtitle}</span>}
          </div>
          <button className="run-output-close" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="node-detail-panel-body">
          {/* Error banner — shown prominently at the top when this node failed */}
          {renderError()}
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
          {renderBody()}
        </div>
      </div>
    </div>
  );
}

// ── Main SpecView ─────────────────────────────────────────────────────────

export function SpecView({ scenario, spec, summary, onReload, onSpecSaved, runStateCache }) {
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

  // ── Run state persistence ────────────────────────────────────────────────
  // Restore saved run state when the spec changes (or when this component
  // remounts after a tab switch). Save whenever run state changes so that
  // navigating away and back doesn't lose the last run result.
  const specPath = spec?.path ?? null;

  useEffect(() => {
    if (!runStateCache?.current) return;
    if (!specPath) {
      setRunLines(null);
      setRunStatus(null);
      setRunProgress(null);
      setRunResult(null);
      setRunTargetScenarioIndex(null);
      setDrawerOpen(false);
      return;
    }
    const cached = runStateCache.current.get(specPath);
    if (cached) {
      setRunLines(cached.runLines ?? null);
      setRunStatus(cached.runStatus ?? null);
      setRunProgress(cached.runProgress ?? null);
      setRunResult(cached.runResult ?? null);
      setRunTargetScenarioIndex(cached.runTargetScenarioIndex ?? null);
      setDrawerOpen(cached.drawerOpen ?? false);
    } else {
      setRunLines(null);
      setRunStatus(null);
      setRunProgress(null);
      setRunResult(null);
      setRunTargetScenarioIndex(null);
      setDrawerOpen(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specPath]);

  useEffect(() => {
    if (!runStateCache?.current || !specPath) return;
    runStateCache.current.set(specPath, {
      runLines,
      runStatus,
      runProgress,
      runResult,
      runTargetScenarioIndex,
      drawerOpen,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specPath, runLines, runStatus, runProgress, runResult, runTargetScenarioIndex, drawerOpen]);

  // Progressive parse of the raw streamed console lines — this is the same
  // mechanism that already animates the scenario tick-list one row at a
  // time, so it's the most reliable "what has finished so far" live source.
  const parsedRunOutput = useMemo(() => parseGaugeOutput(runLines || []), [runLines]);

  const scenarioLineList = useMemo(() => extractScenarioLineList(spec?.content), [spec?.content]);
  const stepLines = useMemo(() => extractStepLines(spec?.content), [spec?.content]);
  const sourceLines = useMemo(() => (spec?.content ? spec.content.split('\n') : []), [spec?.content]);

  // When a specific scenario is selected from the sidebar (not just the file),
  // filter the diagram to show only that scenario + setup nodes.
  // null = show all scenarios.
  const filterScenarioIndex = useMemo(() => {
    if (!scenario || scenario.type !== 'scenario' || scenario.lineNumber == null) return null;
    const idx = scenarioLineList.indexOf(scenario.lineNumber);
    return idx >= 0 ? idx : null;
  }, [scenario, scenarioLineList]);

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
        scenarioIndex={filterScenarioIndex}
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
        <div className="view-toggle" aria-label="Editor mode">
          <button className={`filter ${mode === 'visual' ? 'active' : ''}`} onClick={() => setMode('visual')}>
            Visual
          </button>
          <button className={`filter ${mode === 'source' ? 'active' : ''}`} onClick={() => setMode('source')}>
            Source
          </button>
        </div>
        <button className="filter toolbar-ghost" onClick={onReload}>Reload</button>
        <div className="spacer" />
        {runLines !== null && (
          <button
            className={`filter results-toggle ${drawerOpen ? 'active' : ''}`}
            onClick={() => setDrawerOpen((v) => !v)}
            title="Toggle run results panel"
          >
            {drawerOpen ? 'Hide results ▾' : '▴ Show results'}
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
        <button className="primary edit-spec-btn" onClick={() => setEditing(true)}>
          {filterScenarioIndex != null ? 'Edit scenario' : 'Edit spec'}
        </button>
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
              filterScenarioIndex={filterScenarioIndex}
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

// Parse the Python AssertionError message that inception_sdk throws on balance mismatch.
// Format: "<description>: {BalanceDimensions(address='X', ...): {'expected': Decimal('A'), 'actual': Decimal('B')}, ...}"
function parseBalanceDiff(message) {
  if (!message) return null;
  const re = /BalanceDimensions\(([^)]+)\):\s*\{['"]expected['"]:\s*Decimal\(['"]([^'"]+)['"]\),\s*['"]actual['"]:\s*Decimal\(['"]([^'"]+)['"]\)\}/g;
  const diffs = [];
  let m;
  while ((m = re.exec(message)) !== null) {
    const dims = {};
    m[1].split(',').forEach(part => {
      const eq = part.indexOf('=');
      if (eq < 0) return;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      dims[k] = v;
    });
    diffs.push({ dims, expected: m[2], actual: m[3] });
  }
  if (diffs.length === 0) return null;
  const cutIdx = message.indexOf(': {BalanceDimensions');
  const description = cutIdx > 0 ? message.slice(0, cutIdx) : null;
  return { description, diffs };
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

// ── Generic hook-failure node resolution ─────────────────────────────────
// When afterScenarioHookFailure isn't a balance-check message, try to extract
// an account_id + optional timestamp and match against accepted/rejected/
// notification/flag/schedule/etc. nodes that carry those exact fields.
// This is a best-effort heuristic — it will miss if the message doesn't
// contain a quoted or bare account_id, but it's far better than always
// falling back to the scenario header.

const _ACCOUNT_ID_RE = /(?:account\s+(?:id|ID)\s+"?([A-Z0-9_]+)"?|"([A-Z][A-Z0-9_]{2,})")/;
const _TS_RE = /(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2})?)/;

function findGenericHookFailureNode(stepNodes, message) {
  if (!message) return null;

  // Extract fields from the error message
  const acctMatch = (message || '').match(_ACCOUNT_ID_RE);
  const acctId = acctMatch ? (acctMatch[1] || acctMatch[2]) : null;
  const tsMatch = (message || '').match(_TS_RE);
  const ts = tsMatch ? _normalizeTimestamp(tsMatch[1]) : null;

  if (!acctId) return null;

  // Node types that carry account_id and optionally timestamp
  const CANDIDATE_TYPES = new Set([
    'accepted', 'rejected', 'parameter_rejected',
    'notification', 'no_notifications',
    'derived_parameters', 'derived_parameter_dict',
    'update_account_status', 'account_close', 'update_account_version',
    'flag', 'schedule',
    'change_instance_params', 'change_template_params',
    'instruction_detail_check', 'batch_detail_check',
  ]);

  let bestMatch = null;
  for (const node of stepNodes) {
    if (!CANDIDATE_TYPES.has(node.data.type)) continue;
    const raw = node.data._rawData || {};
    const nodeAcctId = raw.account_id || raw.product_version_id;
    if (nodeAcctId !== acctId) continue;
    // If the message also has a timestamp, prefer the node that matches it
    if (ts && raw.timestamp && _normalizeTimestamp(raw.timestamp) !== ts) continue;
    bestMatch = node;
    if (ts && raw.timestamp) break; // timestamp match is definitive
  }
  return bestMatch;
}

// Precise mapping (post-run): correlates diagram nodes against the
// authoritative gauge json-report tree (status + error per step).
//
// MATCHING STRATEGY (three tiers, applied in order):
//
//   1. Positional (primary): diagram step nodes are in source order, gauge
//      result.json items[] are in source order — node[i] maps to items[i].
//      Robust even when multiple steps share identical text.
//
//   2. Line-number (secondary): gauge stores each step's spec file line via
//      span.start; spec_parser tracks the same number. When positional would
//      produce a wrong match (e.g. a "concept" item shifted the index), the
//      line number breaks the tie.
//
//   3. Text fallback (tertiary): normalised substring match — kept as last
//      resort for older reports that don't carry span.start.
//
// For afterScenarioHookFailure (balance assertions, accepted/rejected checks,
// etc. that run in the @after_scenario hook and are not attached to any step):
//
//   a. Balance-check: parse the structured assertion message and match against
//      the exact balance_check node + table row that was being verified.
//   b. Generic: extract account_id + timestamp from the message and match
//      against accepted/rejected/notification/etc. nodes.
//   c. Fall back to the scenario header if nothing else matches.
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

    // Build a line-number → step-result map for secondary matching
    const stepsByLine = {};
    for (const s of scenarioResult.steps) {
      if (s.line != null) stepsByLine[s.line] = s;
    }

    block.stepNodes.forEach((stepNode, i) => {
      // 1. Positional match
      let stepResult = scenarioResult.steps[i];

      // 2. Line-number override: if the node has a _specLine AND the positional
      //    match's line disagrees with it (or positional is out of bounds),
      //    prefer the step that the spec file line number points to.
      const nodeLine = stepNode.data._specLine;
      if (nodeLine != null && stepsByLine[nodeLine]) {
        const lineResult = stepsByLine[nodeLine];
        if (!stepResult || (stepResult.line != null && stepResult.line !== nodeLine)) {
          stepResult = lineResult;
        }
      }

      // 3. Text fallback when both above yielded nothing (e.g. old report)
      if (!stepResult) {
        const stepMatchText = stepNode.data._matchText || stepNode.data.title;
        stepResult = scenarioResult.steps.find((s) => _textsLooselyMatch(s.text, stepMatchText));
      }

      const sst = stepResult && _statusOf(stepResult.status);
      if (sst) statusMap[stepNode.id] = sst;
      if (sst === 'failed' && stepResult?.error_message) {
        errorMap[stepNode.id] = stepResult.error_message;
      }
    });

    // ── Hook-level failure resolution ─────────────────────────────────────
    if (st === 'failed' && scenarioResult.hook_failure) {
      const message = scenarioResult.hook_failure.error_message;

      // a. Balance-check: structured assertion message with acct/addr/denom/asset
      const balFailure = parseBalanceCheckFailure(message);
      const balMatch = balFailure && findBalanceCheckMatch(block.stepNodes, balFailure);
      if (balMatch) {
        statusMap[balMatch.node.id] = 'failed';
        errorMap[balMatch.node.id] = `Row ${balMatch.rowIndex + 1}/${balMatch.totalRows} — ${message}`;
      } else {
        // b. Generic: extract account_id + timestamp → accepted/rejected/etc.
        const genericNode = findGenericHookFailureNode(block.stepNodes, message);
        if (genericNode) {
          statusMap[genericNode.id] = 'failed';
          errorMap[genericNode.id] = message;
        } else {
          // c. Fall back to scenario header
          errorMap[block.scenarioNode.id] = message;
        }
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

function SpecVisual({ parsed, scenarioLineList, onRunScenario, runDisabled, runStatus, parsedRunOutput, runResult, runTargetScenarioIndex, filterScenarioIndex }) {
  const [selectedNode, setSelectedNode] = useState(null);
  const { nodes: rawNodes, edges, lanes, laneGap } = useMemo(() => specToFlow(parsed), [parsed]);

  // Clear the selected node when the scenario filter changes (the previously
  // selected node may not be visible in the new filter view).
  useEffect(() => {
    setSelectedNode(null);
  }, [filterScenarioIndex]);

  // ── Scenario filter: show only setup + target scenario ────────────────────
  // When a specific scenario is chosen from the sidebar, hide all other
  // scenario lanes and shift the target lane up so there is no empty gap.
  const { filteredNodes, filteredEdges } = useMemo(() => {
    if (filterScenarioIndex == null) {
      return { filteredNodes: rawNodes, filteredEdges: edges };
    }

    // Locate the target scenario node (0-based scenarioIndex in source order)
    const targetScenarioNode = rawNodes.find(
      (n) => n.data.type === 'scenario' && n.data.scenarioIndex === filterScenarioIndex,
    );
    if (!targetScenarioNode) {
      return { filteredNodes: rawNodes, filteredEdges: edges };
    }

    const targetLaneId = targetScenarioNode.data.lane;

    // A "setup" lane is any lane that contains no scenario-header node.
    const scenarioLaneIds = new Set(
      rawNodes.filter((n) => n.data.type === 'scenario').map((n) => n.data.lane),
    );
    const setupLaneIds = new Set(
      rawNodes.filter((n) => !scenarioLaneIds.has(n.data.lane)).map((n) => n.data.lane),
    );

    const keepLaneIds = new Set([...setupLaneIds, targetLaneId]);
    const kept = rawNodes.filter((n) => keepLaneIds.has(n.data.lane));

    // Re-position: shift the target scenario lane to sit immediately below
    // the setup lane (or at the very top if there is no setup lane), so
    // fitView shows a compact diagram without a large vertical gap.
    const setupLane = lanes.find((l) => l.name === 'Setup');
    const targetLane = lanes.find((l) => l.id === targetLaneId);

    if (targetLane && targetLane.y !== (setupLane ? setupLane.y + laneGap : targetLane.y)) {
      const newTargetY = setupLane ? setupLane.y + laneGap : targetLane.y;
      const yOffset = newTargetY - targetLane.y;

      const repositioned = kept.map((n) =>
        setupLaneIds.has(n.data.lane)
          ? n
          : { ...n, position: { ...n.position, y: n.position.y + yOffset } },
      );

      const keptIds = new Set(repositioned.map((n) => n.id));
      return {
        filteredNodes: repositioned,
        filteredEdges: edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target)),
      };
    }

    const keptIds = new Set(kept.map((n) => n.id));
    return {
      filteredNodes: kept,
      filteredEdges: edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target)),
    };
  }, [rawNodes, edges, lanes, laneGap, filterScenarioIndex]);

  const { statusMap: nodeStatusMap, errorMap: nodeErrorMap } = useMemo(
    () => buildNodeStatusMap(rawNodes, runStatus, parsedRunOutput, runResult, runTargetScenarioIndex),
    [rawNodes, runStatus, parsedRunOutput, runResult, runTargetScenarioIndex]
  );

  const nodes = useMemo(
    () => filteredNodes.map((n) => {
      const status = nodeStatusMap[n.id];
      const error = nodeErrorMap[n.id] || null;
      if (!status && !n.data.runStatus && !n.data.runError) return n;
      return { ...n, data: { ...n.data, runStatus: status, runError: error } };
    }),
    [filteredNodes, nodeStatusMap, nodeErrorMap]
  );

  const failedNodes = useMemo(() => nodes.filter((n) => n.data.runStatus === 'failed'), [nodes]);

  const flowInstanceRef = useRef(null);

  // Effect 1 — fit view when the visible node set changes (scenario filter
  // applied or spec first loaded). Uses a 120 ms delay so ReactFlow has
  // finished measuring and repositioning nodes before we fit.
  // Skipped while a run is active so it doesn't fight the run-tracking pan.
  const runStatusRef = useRef(runStatus);
  useEffect(() => { runStatusRef.current = runStatus; }, [runStatus]);

  useEffect(() => {
    if (runStatusRef.current === 'running' || runStatusRef.current === 'failed') return;
    const instance = flowInstanceRef.current;
    if (!instance || filteredNodes.length === 0) return;
    const id = setTimeout(() => instance.fitView?.({ padding: 0.2 }), 120);
    return () => clearTimeout(id);
  }, [filteredNodes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effect 2 — follow the active / failed node while a run is in progress
  // or has just completed.
  //
  //  • running  → track the currently-executing step with setCenter
  //  • failed, filtered view  → fitView all scenario nodes so nothing falls
  //      off-screen (balance checks sit at the far right of the lane)
  //  • failed, full-spec view → setCenter on the failing node
  useEffect(() => {
    const instance = flowInstanceRef.current;
    if (!instance) return;

    if (runStatus === 'running') {
      const target = nodes.find((n) => n.data.runStatus === 'running');
      if (target && instance.setCenter) {
        instance.setCenter(target.position.x + 140, target.position.y + 40, { zoom: 0.85, duration: 450 });
      }
    } else if (runStatus === 'failed' && failedNodes.length > 0) {
      const target = failedNodes.find((n) => n.data.runError) || failedNodes[0];
      // Defer to let ReactFlow finish committing node-status updates to the DOM
      const id = setTimeout(() => {
        if (filterScenarioIndex != null) {
          instance.fitView?.({ padding: 0.15, duration: 400 });
        } else if (target) {
          instance.setCenter?.(target.position.x + 140, target.position.y + 40, { zoom: 0.85, duration: 400 });
        }
      }, 120);
      return () => clearTimeout(id);
    }
  }, [nodes, runStatus, failedNodes, filterScenarioIndex]);

  return (
    <div className="spec-visual">
      <ReactFlow
        nodes={nodes}
        edges={filteredEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_, node) => setSelectedNode(node)}
        onInit={(instance) => { flowInstanceRef.current = instance; }}
      >
        <Background color="#1a2740" gap={32} size={1.5} />
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
