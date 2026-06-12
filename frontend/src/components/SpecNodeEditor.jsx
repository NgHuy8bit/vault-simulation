import '@xyflow/react/dist/style.css';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';

import { api } from '../api/client.js';
import { clone } from '../utils/format.js';
import { newId, nodeTitle, nodeSubtitle, specToFlow } from '../utils/specFlow.js';
import { StepInspector } from './StepInspector.jsx';
import { SpecCustomNode } from './SpecCustomNode.jsx';
import { Modal } from './Modal.jsx';

const PALETTE_SECTIONS = [
  { label: 'Setup', items: [
    ['config', 'Config'],
    ['product', 'Product'],
    ['account', 'Account'],
    ['scenario', 'Scenario'],
  ]},
  { label: 'Posting', items: [
    ['inbound', 'Inbound Hard Settlement'],
    ['outbound', 'Outbound Hard Settlement'],
    ['inbound_auth', 'Inbound Authorisation'],
    ['outbound_auth', 'Outbound Authorisation'],
    ['transfer', 'Transfer'],
    ['settlement', 'Settlement'],
    ['release', 'Release Event'],
    ['custom_instruction', 'Custom Instruction'],
    ['posting_instruction_batch', 'Posting Batch'],
    ['auth_adjustment', 'Auth Adjustment'],
  ]},
  { label: 'Checks', items: [
    ['balance_check', 'Balance Check'],
    ['balance_check_multi', 'Balance Check (multi-account)'],
    ['accepted', 'Verify Accepted'],
    ['rejected', 'Verify Rejected'],
    ['notification', 'Notification'],
    ['no_notifications', 'No Notifications'],
    ['schedule', 'Verify Schedule'],
    ['parameter_rejected', 'Parameter Rejected'],
    ['derived_parameters', 'Derived Parameters'],
    ['derived_parameter_dict', 'Derived Param (single)'],
    ['instruction_detail_check', 'Instruction Detail Check'],
    ['batch_detail_check', 'Batch Detail Check'],
  ]},
  { label: 'Account', items: [
    ['change_instance_params', 'Change Instance Params'],
    ['change_template_params', 'Change Template Params'],
    ['update_account_status', 'Update Account Status'],
    ['account_close', 'Account Close (pending)'],
    ['update_account_version', 'Update Account Version'],
  ]},
  { label: 'Flags & Misc', items: [
    ['flag_definition', 'Flag Definition'],
    ['flag', 'Set Flag'],
    ['global_param', 'Global Parameter'],
    ['exception_msg', 'Exception Message'],
  ]},
];

const PALETTE = PALETTE_SECTIONS.flatMap((s) => s.items);

const nodeTypes = {
  custom: SpecCustomNode,
};

// ── Scenario-slice helpers ────────────────────────────────────────────────────
// Build an ordered list of `## heading` line numbers (1-indexed) — duplicated
// here to avoid circular imports with SpecView.jsx.
function _extractScenarioLineList(content) {
  if (!content) return [];
  const out = [];
  content.split('\n').forEach((line, i) => {
    if (/^##\s+/.test(line)) out.push(i + 1);
  });
  return out;
}

// Return the raw source text of scenario[scenarioIndex] (from its `##` heading
// to just before the next `##`, trailing blank lines stripped) plus the 0-based
// [startIdx, endIdx) range inside the split-lines array.
function _scenarioSourceSlice(content, scenarioIndex) {
  const lineList = _extractScenarioLineList(content);
  const lines = (content || '').split('\n');
  const startIdx = (lineList[scenarioIndex] ?? 1) - 1; // 0-based
  const nextStart = lineList[scenarioIndex + 1];
  const rawEnd = nextStart != null ? nextStart - 1 : lines.length;
  // Trim trailing blank lines so the textarea doesn't have a ragged bottom
  let sliceEnd = rawEnd;
  while (sliceEnd > startIdx && !lines[sliceEnd - 1]?.trim()) sliceEnd--;
  return {
    text: lines.slice(startIdx, sliceEnd).join('\n'),
    startIdx,
    endIdx: rawEnd, // where to resume copying from when splicing
  };
}

// Splice newScenarioText back into fullContent, replacing [startIdx, endIdx).
function _spliceScenarioIntoContent(fullContent, startIdx, endIdx, newScenarioText) {
  const lines = fullContent.split('\n');
  const newLines = newScenarioText.split('\n');
  // Keep one blank separator line between scenarios when there is a next one
  const needsSeparator = endIdx < lines.length;
  return [
    ...lines.slice(0, startIdx),
    ...newLines,
    ...(needsSeparator ? [''] : []),
    ...lines.slice(endIdx),
  ].join('\n');
}

// Order nodes by walking the edge chain (source → target). Step order is
// defined by the connections the user draws, not node positions. Heads
// (nodes with no incoming edge) are visited in position order; any nodes
// unreachable through edges are appended at the end, also by position.
function _orderByEdges(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map();
  const hasIncoming = new Set();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source).push(e.target);
    hasIncoming.add(e.target);
  }
  const posSort = (a, b) => {
    if (Math.abs(a.position.y - b.position.y) < 50) return a.position.x - b.position.x;
    return a.position.y - b.position.y;
  };
  const heads = nodes.filter((n) => !hasIncoming.has(n.id)).sort(posSort);
  const visited = new Set();
  const ordered = [];
  for (const head of heads) {
    let queue = [head.id];
    while (queue.length) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      ordered.push(byId.get(id));
      const next = (outgoing.get(id) || [])
        .filter((t) => !visited.has(t))
        .map((t) => byId.get(t))
        .sort(posSort)
        .map((n) => n.id);
      queue = [...next, ...queue];
    }
  }
  const leftovers = nodes.filter((n) => !visited.has(n.id)).sort(posSort);
  return [...ordered, ...leftovers];
}

// Build the full steps_json payload after a single-scenario visual edit, by
// merging the edited scenario back into the original parsed spec structure.
function _buildScenarioStepsJson(nodes, edges, scenarioName, scenarioTags, spec, scenarioIndex) {
  const sortedNodes = _orderByEdges(nodes, edges);

  const stepNodes = sortedNodes.filter((n) => n.data.type !== 'scenario');
  const editedScenario = {
    name: scenarioName,
    tags: _splitTags(scenarioTags),
    steps: stepNodes.map((n) => ({ type: n.data.type, raw: '', data: clone(n.data._rawData) })),
  };

  const scenarios = (spec.parsed.scenarios || []).map((sc, i) =>
    i === scenarioIndex ? editedScenario : sc,
  );

  return {
    title: spec.parsed.title || 'New Spec',
    file_tags: spec.parsed.file_tags || [],
    setup_steps: spec.parsed.setup_steps || [],
    scenarios,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SpecNodeEditor({ spec, summary, scenarioIndex, onCancel, onSaved }) {
  // ── Editor scope: full spec (scenarioIndex == null) or single scenario ──
  const isSingleScenario = scenarioIndex != null;
  const targetScenario = isSingleScenario ? (spec.parsed.scenarios || [])[scenarioIndex] : null;

  // For visual mode: build a mini-parsed-spec that only contains the target
  // scenario (no setup steps, no other scenarios) when in single-scenario mode.
  const parsedForEditor = useMemo(() => {
    if (!isSingleScenario) return spec.parsed;
    return {
      ...spec.parsed,
      setup_steps: [],
      scenarios: targetScenario ? [targetScenario] : [],
    };
  }, [spec.parsed, isSingleScenario, targetScenario]);

  const initialFlow = useMemo(() => specToFlow(parsedForEditor), [parsedForEditor]);

  const [nodes, setNodes] = useNodesState(initialFlow.nodes);
  const [edges, setEdges] = useEdgesState(initialFlow.edges);

  const [editMode, setEditMode] = useState('visual'); // 'visual' | 'source'

  // Source content — full file for full-spec mode; scenario slice for single-scenario mode.
  const [sourceContent, setSourceContent] = useState(() => {
    if (!isSingleScenario) return spec.content || '';
    return _scenarioSourceSlice(spec.content, scenarioIndex).text;
  });

  // File-level fields (full-spec mode only)
  const [title, setTitle] = useState(spec.parsed.title || 'New Spec');
  const [fileTags, setFileTags] = useState((spec.parsed.file_tags || []).join(', '));
  const [path, setPath] = useState(spec.path);

  // Scenario-level fields (single-scenario mode only)
  const [scenarioName, setScenarioName] = useState(targetScenario?.name || 'Scenario');
  const [scenarioTags, setScenarioTags] = useState((targetScenario?.tags || []).join(', '));

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [visualDirty, setVisualDirty] = useState(false);

  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [inspectingNodeId, setInspectingNodeId] = useState(null);
  const [insertAfterNodeId, setInsertAfterNodeId] = useState(null);

  const [clipboard, setClipboard] = useState([]);
  const [paletteSearch, setPaletteSearch] = useState('');
  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);

  const copySelected = useCallback(() => {
    const sel = nodes.filter((n) => n.selected);
    if (sel.length === 0) return;
    setClipboard(sel);
  }, [nodes]);

  const pasteClipboard = useCallback(() => {
    if (clipboard.length === 0) return;
    setVisualDirty(true);
    const OFFSET = 40;
    const pasted = clipboard.map((n) => ({
      ...n,
      id: newId(),
      position: { x: n.position.x + OFFSET, y: n.position.y + OFFSET },
      selected: true,
      data: { ...n.data, _rawData: clone(n.data._rawData) },
    }));
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...pasted]);
    // Chain pasted nodes together (in their relative order); existing edges
    // are untouched — connect the pasted block into the flow by hand.
    if (pasted.length > 1) {
      const sorted = [...pasted].sort((a, b) => {
        if (Math.abs(a.position.y - b.position.y) < 50) return a.position.x - b.position.x;
        return a.position.y - b.position.y;
      });
      setEdges((eds) => [
        ...eds,
        ...sorted.slice(0, -1).map((n, i) => ({
          id: `e-${n.id}-${sorted[i + 1].id}`,
          source: n.id,
          target: sorted[i + 1].id,
        })),
      ]);
    }
  }, [clipboard, setNodes, setEdges]);

  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'c') { e.preventDefault(); copySelected(); }
      if (mod && e.key === 'v') { e.preventDefault(); pasteClipboard(); }
      // Delete/Backspace removes selected EDGES only (nodes have their own
      // explicit Delete button in the inspector to avoid accidents).
      if (e.key === 'Delete' || e.key === 'Backspace') {
        setEdges((eds) => {
          if (!eds.some((edge) => edge.selected)) return eds;
          setVisualDirty(true);
          return eds.filter((edge) => !edge.selected);
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [copySelected, pasteClipboard, setEdges]);

  // Derive addresses and account IDs from simulation summary
  const addresses = useMemo(() => {
    if (!summary?.balance_history) return [];
    const all = new Set();
    for (const accHist of Object.values(summary.balance_history)) {
      for (const denomHist of Object.values(accHist)) {
        for (const addr of Object.keys(denomHist)) all.add(addr);
      }
    }
    return [...all].sort();
  }, [summary]);

  const accountIds = useMemo(() => summary?.accounts || [], [summary]);

  const onNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [setNodes],
  );

  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges],
  );

  // Manual edge wiring: a step has at most one predecessor and one successor,
  // so a new connection replaces any existing edge from the same source or
  // into the same target. This makes "re-linking" a one-drag operation.
  const onConnect = useCallback(
    (params) => {
      if (params.source === params.target) return;
      setVisualDirty(true);
      setEdges((eds) =>
        addEdge(params, eds.filter((e) => e.source !== params.source && e.target !== params.target)),
      );
    },
    [setEdges],
  );

  const onEdgeDoubleClick = useCallback(
    (event, edge) => {
      event.stopPropagation();
      setVisualDirty(true);
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    },
    [setEdges],
  );

  const onNodeClick = useCallback((event, node) => {
    setInspectingNodeId(node.id);
  }, []);

  // Dragging only moves nodes — edges stay as the user wired them.
  const onNodeDragStop = useCallback(() => {
    setVisualDirty(true);
  }, []);

  function addNode(type) {
    setVisualDirty(true);
    const id = newId();
    let targetX = 50;
    let targetY = 50;

    if (nodes.length > 0) {
      let maxY = 0;
      nodes.forEach((n) => { if (n.position.y > maxY) maxY = n.position.y; });
      const nodesInLastRow = nodes.filter((n) => Math.abs(n.position.y - maxY) < 50);
      let maxX = 0;
      nodesInLastRow.forEach((n) => { if (n.position.x >= maxX) maxX = n.position.x; });
      targetY = maxY;
      targetX = maxX + 320;
    }

    const data = defaultData(type);
    const newNode = {
      id,
      type: 'custom',
      position: { x: targetX, y: targetY },
      data: {
        type,
        title: nodeTitle({ type, data }),
        subtitle: nodeSubtitle({ type, data }),
        _rawData: clone(data),
      },
    };

    setNodes((nds) => [...nds, newNode]);

    if (nodes.length > 0) {
      // Append to the tail of the edge chain (last node in walk order).
      const tail = _orderByEdges(nodes, edges).at(-1);
      if (tail) {
        setEdges((eds) => [...eds, { id: `e-${tail.id}-${id}`, source: tail.id, target: id }]);
      }
    }

    setIsPaletteOpen(false);
    setInspectingNodeId(id);
  }

  function insertNodeAfter(type, afterNodeId) {
    const afterNode = nodes.find((n) => n.id === afterNodeId);
    if (!afterNode) return addNode(type);

    setVisualDirty(true);
    const id = newId();
    const data = defaultData(type);
    const newX = afterNode.position.x + 320;
    const newY = afterNode.position.y;

    // Find direct successor
    const outEdge = edges.find((e) => e.source === afterNodeId);
    const nextId = outEdge?.target;

    // Shift same-row nodes at or beyond newX rightward
    const shiftedNodes = nodes.map((n) =>
      Math.abs(n.position.y - newY) < 50 && n.position.x >= newX
        ? { ...n, position: { ...n.position, x: n.position.x + 320 } }
        : n,
    );

    const newNode = {
      id,
      type: 'custom',
      position: { x: newX, y: newY },
      data: {
        type,
        title: nodeTitle({ type, data }),
        subtitle: nodeSubtitle({ type, data }),
        _rawData: clone(data),
      },
    };

    // Rewire: remove afterNode→nextId, add afterNode→newNode and newNode→nextId
    const newEdges = edges.filter((e) => !(e.source === afterNodeId && e.target === nextId));
    newEdges.push({ id: `e-${afterNodeId}-${id}`, source: afterNodeId, target: id });
    if (nextId) newEdges.push({ id: `e-${id}-${nextId}`, source: id, target: nextId });

    setNodes([...shiftedNodes, newNode]);
    setEdges(newEdges);
    setInsertAfterNodeId(null);
    setIsPaletteOpen(false);
    setInspectingNodeId(id);
  }

  function handlePaletteSelect(type) {
    if (insertAfterNodeId) {
      insertNodeAfter(type, insertAfterNodeId);
    } else {
      addNode(type);
    }
  }

  function openInsertAfter() {
    setInsertAfterNodeId(inspectingNodeId);
    setInspectingNodeId(null);
    setIsPaletteOpen(true);
  }

  function updateSelected(newData) {
    if (!inspectingNodeId) return;
    setVisualDirty(true);
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id !== inspectingNodeId) return node;
        const nextData = { ...newData, _dirty: true };
        return {
          ...node,
          data: {
            ...node.data,
            title: nodeTitle({ type: node.data.type, data: nextData }),
            subtitle: nodeSubtitle({ type: node.data.type, data: nextData }),
            _rawData: nextData,
          },
        };
      }),
    );
  }

  function deleteSelected() {
    if (!inspectingNodeId) return;
    const node = nodes.find((n) => n.id === inspectingNodeId);
    if (!window.confirm(`Delete "${node?.data?.type || 'node'}"? This cannot be undone.`)) return;
    setVisualDirty(true);
    setNodes((nds) => nds.filter((n) => n.id !== inspectingNodeId));
    setEdges((eds) =>
      eds.filter((e) => e.source !== inspectingNodeId && e.target !== inspectingNodeId),
    );
    setInspectingNodeId(null);
  }

  async function save() {
    setSaving(true);
    setToast(null);
    try {
      if (isSingleScenario) {
        // ── Single-scenario save ────────────────────────────────────────────
        // Source mode: splice the edited scenario lines back into the full file.
        // Visual mode: rebuild scenario from nodes and merge into full parsed spec.
        if (editMode === 'source') {
          const { startIdx, endIdx } = _scenarioSourceSlice(spec.content, scenarioIndex);
          const newContent = _spliceScenarioIntoContent(
            spec.content, startIdx, endIdx, sourceContent,
          );
          await api.saveSpec({ path: spec.path, raw_content: newContent });
        } else {
          const stepsJson = _buildScenarioStepsJson(
            nodes, edges, scenarioName, scenarioTags, spec, scenarioIndex,
          );
          await api.saveSpec({ path: spec.path, steps_json: stepsJson });
        }
      } else {
        // ── Full-spec save (original behaviour) ────────────────────────────
        if (editMode === 'source' && path === spec.path && sourceContent === (spec.content || '')) {
          setToast({ type: 'success', message: 'No changes to save.' });
          await onSaved();
          return;
        }
        if (editMode === 'visual' && path === spec.path && !visualDirty) {
          setToast({ type: 'success', message: 'No changes to save.' });
          await onSaved();
          return;
        }

        if (editMode === 'source') {
          await api.saveSpec({ path, raw_content: sourceContent });
        } else if (!visualDirty) {
          await api.saveSpec({ path, raw_content: spec.content || '' });
        } else {
          await api.saveSpec({ path, steps_json: flowToSpec(nodes, edges, title, fileTags) });
        }
      }

      setToast({ type: 'success', message: 'Saved.' });
      await onSaved();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Save failed.' });
    } finally {
      setSaving(false);
    }
  }

  const inspectingNode = nodes.find((n) => n.id === inspectingNodeId);

  return (
    <div className="node-editor react-flow-editor">
      <div className="node-editor-top">
        {isSingleScenario ? (
          // ── Single-scenario header ────────────────────────────────────────
          <>
            <label>
              Scenario
              <input
                value={scenarioName}
                onChange={(e) => { setScenarioName(e.target.value); setVisualDirty(true); }}
              />
            </label>
            <label>
              Tags
              <input
                value={scenarioTags}
                onChange={(e) => { setScenarioTags(e.target.value); setVisualDirty(true); }}
                placeholder="tag1, tag2"
              />
            </label>
            <label className="wide-field">
              File path
              <input value={spec.path} readOnly className="readonly-field" />
            </label>
          </>
        ) : (
          // ── Full-spec header ──────────────────────────────────────────────
          <>
            <label>
              Title
              <input
                value={title}
                onChange={(e) => { setTitle(e.target.value); setVisualDirty(true); }}
              />
            </label>
            <label>
              Tags
              <input
                value={fileTags}
                onChange={(e) => { setFileTags(e.target.value); setVisualDirty(true); }}
                placeholder="tag1, tag2"
              />
            </label>
            <label className="wide-field">
              File path
              <input value={path} onChange={(e) => setPath(e.target.value)} />
            </label>
          </>
        )}
        <div className="spacer" />
        <div className="editor-mode-toggle view-toggle">
          <button className={`filter${editMode === 'visual' ? ' active' : ''}`} onClick={() => setEditMode('visual')}>Visual</button>
          <button className={`filter${editMode === 'source' ? ' active' : ''}`} onClick={() => setEditMode('source')}>Source</button>
        </div>
        <button className="filter toolbar-ghost" onClick={onCancel}>Cancel</button>
        <button className="primary save-btn" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}

      {editMode === 'source' ? (
        <div className="source-editor-wrap">
          {isSingleScenario && (
            <div className="source-editor-notice muted">
              Editing scenario only — other scenarios are unchanged.
            </div>
          )}
          <textarea
            className="source-editor"
            value={sourceContent}
            onChange={(e) => setSourceContent(e.target.value)}
            spellCheck={false}
          />
        </div>
      ) : (
        <>
          <div className="node-editor-body">
            <div className="canvas-action-bar">
              <span className="edge-hint">Drag handle ○→○ to connect · double-click edge to disconnect</span>
              {selectedNodes.length > 0 && (
                <button
                  className="filter toolbar-ghost"
                  onClick={copySelected}
                  title={`Copy ${selectedNodes.length} selected node${selectedNodes.length > 1 ? 's' : ''} (⌘C)`}
                >
                  Copy{selectedNodes.length > 1 ? ` (${selectedNodes.length})` : ''}
                </button>
              )}
              {clipboard.length > 0 && (
                <button
                  className="filter toolbar-ghost"
                  onClick={pasteClipboard}
                  title={`Paste ${clipboard.length} node${clipboard.length > 1 ? 's' : ''} (⌘V)`}
                >
                  Paste{clipboard.length > 1 ? ` (${clipboard.length})` : ''}
                </button>
              )}
              <button className="primary add-node-btn" onClick={() => { setInsertAfterNodeId(null); setIsPaletteOpen(true); }}>
                + Add Node
              </button>
            </div>

            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgeDoubleClick={onEdgeDoubleClick}
              onNodeClick={onNodeClick}
              onNodeDragStop={onNodeDragStop}
              onSelectionDragStop={onNodeDragStop}
              nodeTypes={nodeTypes}
              deleteKeyCode={null}
              edgesFocusable
              connectionRadius={40}
              selectionOnDrag
              panOnDrag={[2]}
              panOnScroll
              fitView
              fitViewOptions={{ padding: 0.2 }}
            >
              <Background color="#1e293b" gap={16} />
              <Controls />
            </ReactFlow>
          </div>

          {isPaletteOpen && (
            <Modal
              title={insertAfterNodeId ? 'Insert Node After' : 'Add Node'}
              onClose={() => { setIsPaletteOpen(false); setInsertAfterNodeId(null); setPaletteSearch(''); }}
              wide
            >
              <div className="palette-search">
                <input
                  autoFocus
                  placeholder="Search nodes…"
                  value={paletteSearch}
                  onChange={(e) => setPaletteSearch(e.target.value)}
                />
                <div className="palette-hint">Type to filter node types, then choose a card to add it to the canvas.</div>
              </div>
              {paletteSearch.trim() ? (
                <div className="palette-grid">
                  {PALETTE
                    .filter(([type, label]) => {
                      const q = paletteSearch.toLowerCase();
                      return type.includes(q) || label.toLowerCase().includes(q);
                    })
                    .map(([type, label]) => (
                      <button key={type} className="palette-btn" onClick={() => { handlePaletteSelect(type); setPaletteSearch(''); }}>
                        <span className={`node-type type-${type}`}>{type}</span>
                        <span>{label}</span>
                      </button>
                    ))}
                </div>
              ) : (
                <div className="palette-sections">
                  {PALETTE_SECTIONS.map((section) => (
                    <div key={section.label} className="palette-section">
                      <div className="palette-section-label">{section.label}</div>
                      <div className="palette-grid">
                        {section.items.map(([type, label]) => (
                          <button key={type} className="palette-btn" onClick={() => { handlePaletteSelect(type); setPaletteSearch(''); }}>
                            <span className={`node-type type-${type}`}>{type}</span>
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Modal>
          )}

          {inspectingNode && (
            <Modal title={`Edit: ${inspectingNode.data.type}`} onClose={() => setInspectingNodeId(null)} wide>
              <div className="inspector-modal-content">
                <StepInspector
                  node={{ type: inspectingNode.data.type, data: inspectingNode.data._rawData }}
                  onChange={updateSelected}
                  addresses={addresses}
                  accountIds={accountIds}
                />
                <div className="inspector-actions">
                  <button className="danger" onClick={deleteSelected}>Delete</button>
                  <div className="inspector-action-group">
                    <button className="filter toolbar-ghost" onClick={openInsertAfter} title="Insert a new node immediately after this one">
                      Insert After →
                    </button>
                    <button className="primary" onClick={() => setInspectingNodeId(null)}>Done</button>
                  </div>
                </div>
              </div>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

// ── flowToSpec: full-spec visual → steps_json ─────────────────────────────────

function flowToSpec(nodes, edges, title, fileTags) {
  const setup_steps = [];
  const scenarios = [];

  const sortedNodes = _orderByEdges(nodes, edges);

  let currentScenario = null;
  for (const node of sortedNodes) {
    const type = node.data.type;
    const rawData = node.data._rawData;

    if (type === 'scenario') {
      currentScenario = {
        name: rawData.name || 'Scenario',
        tags: _splitTags(rawData.tags),
        steps: [],
      };
      scenarios.push(currentScenario);
      continue;
    }
    const step = { type, raw: '', data: clone(rawData) };
    if (currentScenario) currentScenario.steps.push(step);
    else setup_steps.push(step);
  }
  return { title, file_tags: _splitTags(fileTags), setup_steps, scenarios };
}

function _splitTags(value) {
  return String(value || '').split(',').map((t) => t.trim()).filter(Boolean);
}

function defaultData(type) {
  const day = new Date().toISOString().slice(0, 10);
  return {
    scenario: { name: 'New Scenario', tags: '' },
    config: { key: 'timezone', value: 'Asia/Ho_Chi_Minh' },
    product: { name: 'loan', version_id: '1', params: [], template_mode: 'default' },
    account: { account_id: 'LOAN_ACCOUNT', version_id: '1', params: [], account_param_mode: 'default' },
    balance_check: {
      denomination: 'VND',
      rows: [{ timestamp: `${day}T10:00:00`, account_id: 'LOAN_ACCOUNT', address: 'DEFAULT', balance: '0' }],
    },
    balance_check_multi: {
      denomination: 'VND',
      rows: [{ timestamp: `${day}T10:00:00`, account_id: 'LOAN_ACCOUNT', address: 'DEFAULT', denomination: 'VND', phase: 'POSTING_PHASE_COMMITTED', asset: 'COMMERCIAL_BANK_MONEY', balance: '0' }],
    },
    inbound: { timestamp: `${day}T10:00:00`, amount: '1000000', denomination: 'VND', from_account: '1', to_account: 'LOAN_ACCOUNT', instruction_detail: [] },
    outbound: { timestamp: `${day}T10:00:00`, amount: '1000000', denomination: 'VND', from_account: 'LOAN_ACCOUNT', to_account: '1', instruction_detail: [] },
    inbound_auth: { timestamp: `${day}T10:00:00`, amount: '1000000', denomination: 'VND', internal_account_id: '1', customer_account_id: 'LOAN_ACCOUNT', instruction_detail: [] },
    outbound_auth: { timestamp: `${day}T10:00:00`, amount: '1000000', denomination: 'VND', customer_account_id: 'LOAN_ACCOUNT', internal_account_id: '1', instruction_detail: [] },
    transfer: { timestamp: `${day}T10:00:00`, amount: '1000000', denomination: 'VND', debtor_account_id: '1', creditor_account_id: 'LOAN_ACCOUNT', instruction_detail: [] },
    settlement: { timestamp: `${day}T10:00:00`, amount: '1000000', client_transaction_id: 'TXN_001', instruction_detail: [] },
    release: { timestamp: `${day}T10:00:00`, client_transaction_id: 'TXN_001', instruction_detail: [] },
    custom_instruction: { timestamp: `${day}T10:00:00`, amount: '1000000', denomination: 'VND', debtor_account_id: '1', debtor_account_address: 'DEFAULT', creditor_account_id: 'LOAN_ACCOUNT', creditor_account_address: 'DEFAULT', instruction_detail: [] },
    posting_instruction_batch: { timestamp: `${day}T10:00:00`, variant: 'initiate', instructions: [] },
    accepted: { timestamp: `${day}T10:00:00`, account_id: 'LOAN_ACCOUNT' },
    rejected: { timestamp: `${day}T10:00:00`, account_id: 'LOAN_ACCOUNT', rejection_type: 'InsufficientFunds', rejection_reason: '' },
    notification: { timestamp: `${day}T10:00:00`, account_id: 'LOAN_ACCOUNT', notification_type: 'ACTIVITY', notification_details: [], expected: true },
    no_notifications: {},
    auth_adjustment: { timestamp: `${day}T10:00:00`, amount: '1000000', client_transaction_id: 'TXN_001' },
    schedule: { timestamp: `${day}T10:00:00`, account_id: 'LOAN_ACCOUNT', event_id: 'ACCRUE_INTEREST' },
    parameter_rejected: { timestamp: `${day}T10:00:00`, account_id: 'LOAN_ACCOUNT', rejection_type: 'AgainstTermsAndConditions', rejection_reason: '' },
    derived_parameters: { timestamp: `${day}T10:00:00`, account_id: 'LOAN_ACCOUNT', rows: [{ name: '', value: '' }] },
    change_instance_params: { account_id: 'LOAN_ACCOUNT', params: [{ name: '', value: '' }] },
    change_template_params: { product_version_id: '1', params: [{ name: '', value: '' }] },
    update_account_status: { timestamp: `${day}T10:00:00`, account_id: 'LOAN_ACCOUNT', status: 'ACCOUNT_STATUS_PENDING_CLOSURE' },
    account_close: { timestamp: `${day}T10:00:00`, account_id: 'LOAN_ACCOUNT' },
    update_account_version: { timestamp: `${day}T10:00:00`, account_id: 'LOAN_ACCOUNT', product_version_id: '2' },
    flag_definition: { timestamp: `${day}T10:00:00`, flag_name: 'ACCOUNT_DELINQUENT' },
    flag: { timestamp: `${day}T10:00:00`, flag_name: 'ACCOUNT_DELINQUENT', account_id: 'LOAN_ACCOUNT', expiry_timestamp: '' },
    global_param: { timestamp: `${day}T00:00:00Z`, name: '', value: '', rows: [] },
    derived_parameter_dict: { timestamp: `${day}T10:00:00`, param_name: '', account_id: 'LOAN_ACCOUNT', value: '' },
    exception_msg: { message: '' },
    instruction_detail_check: { timestamp: `${day}T10:00:00`, rows: [{ key: '', value: '' }] },
    batch_detail_check: { timestamp: `${day}T10:00:00`, rows: [{ key: '', value: '' }] },
  }[type];
}
