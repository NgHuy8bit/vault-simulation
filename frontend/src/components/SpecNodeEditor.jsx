import '@xyflow/react/dist/style.css';

import { useCallback, useMemo, useState } from 'react';
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

const PALETTE = [
  // Setup
  ['config', 'Config'],
  ['product', 'Product'],
  ['account', 'Account'],
  // Posting instructions
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
  // Checks
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
  // Account changes
  ['change_instance_params', 'Change Instance Params'],
  ['change_template_params', 'Change Template Params'],
  ['update_account_status', 'Update Account Status'],
  ['account_close', 'Account Close (pending)'],
  ['update_account_version', 'Update Account Version'],
  // Flags
  ['flag_definition', 'Flag Definition'],
  ['flag', 'Set Flag'],
  // Global params / misc
  ['global_param', 'Global Parameter'],
  ['exception_msg', 'Exception Message'],
  // Structure
  ['scenario', 'Scenario'],
];

const nodeTypes = {
  custom: SpecCustomNode,
};

export function SpecNodeEditor({ spec, summary, onCancel, onSaved }) {
  const initialFlow = useMemo(() => specToFlow(spec.parsed), [spec.parsed]);

  const [nodes, setNodes] = useNodesState(initialFlow.nodes);
  const [edges, setEdges] = useEdgesState(initialFlow.edges);

  const [editMode, setEditMode] = useState('visual'); // 'visual' | 'source'
  const [sourceContent, setSourceContent] = useState(spec.content || '');

  const [title, setTitle] = useState(spec.parsed.title || 'New Spec');
  const [fileTags, setFileTags] = useState((spec.parsed.file_tags || []).join(', '));
  const [path, setPath] = useState(spec.path);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [inspectingNodeId, setInspectingNodeId] = useState(null);
  const [insertAfterNodeId, setInsertAfterNodeId] = useState(null);

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

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  const onNodeClick = useCallback((event, node) => {
    setInspectingNodeId(node.id);
  }, []);

  // After dragging, recompute edges to match new visual order
  const onNodeDragStop = useCallback(() => {
    setNodes((nds) => {
      const sorted = [...nds].sort((a, b) => {
        if (Math.abs(a.position.y - b.position.y) < 50) return a.position.x - b.position.x;
        return a.position.y - b.position.y;
      });
      setEdges(
        sorted.slice(0, -1).map((n, i) => ({
          id: `e-${n.id}-${sorted[i + 1].id}`,
          source: n.id,
          target: sorted[i + 1].id,
        })),
      );
      return nds;
    });
  }, [setEdges]);

  function addNode(type) {
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
      const lastNodeId = nodes[nodes.length - 1].id;
      setEdges((eds) => [...eds, { id: `e-${lastNodeId}-${id}`, source: lastNodeId, target: id }]);
    }

    setIsPaletteOpen(false);
    setInspectingNodeId(id);
  }

  function insertNodeAfter(type, afterNodeId) {
    const afterNode = nodes.find((n) => n.id === afterNodeId);
    if (!afterNode) return addNode(type);

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
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id !== inspectingNodeId) return node;
        return {
          ...node,
          data: {
            ...node.data,
            title: nodeTitle({ type: node.data.type, data: newData }),
            subtitle: nodeSubtitle({ type: node.data.type, data: newData }),
            _rawData: newData,
          },
        };
      }),
    );
  }

  function deleteSelected() {
    if (!inspectingNodeId) return;
    const node = nodes.find((n) => n.id === inspectingNodeId);
    if (!window.confirm(`Delete "${node?.data?.type || 'node'}"? This cannot be undone.`)) return;
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
      if (editMode === 'source') {
        await api.saveSpec({ path, raw_content: sourceContent });
      } else {
        await api.saveSpec({ path, steps_json: flowToSpec(nodes, title, fileTags) });
      }
      setToast({ type: 'success', message: 'Spec saved.' });
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
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Tags
          <input value={fileTags} onChange={(e) => setFileTags(e.target.value)} placeholder="tag1, tag2" />
        </label>
        <label className="wide-field">
          File path
          <input value={path} onChange={(e) => setPath(e.target.value)} />
        </label>
        <div className="editor-mode-toggle">
          <button className={`filter${editMode === 'visual' ? ' active' : ''}`} onClick={() => setEditMode('visual')}>Visual</button>
          <button className={`filter${editMode === 'source' ? ' active' : ''}`} onClick={() => setEditMode('source')}>Source</button>
        </div>
        <button className="filter" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}

      {editMode === 'source' ? (
        <div className="source-editor-wrap">
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
            <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 4 }}>
              <button className="primary" onClick={() => { setInsertAfterNodeId(null); setIsPaletteOpen(true); }}>
                + Add Node
              </button>
            </div>

            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onNodeDragStop={onNodeDragStop}
              nodeTypes={nodeTypes}
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
              onClose={() => { setIsPaletteOpen(false); setInsertAfterNodeId(null); }}
            >
              <div className="palette-grid">
                {PALETTE.map(([type, label]) => (
                  <button key={type} className="palette-btn" onClick={() => handlePaletteSelect(type)}>
                    <span className={`node-type type-${type}`}>{type}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </Modal>
          )}

          {inspectingNode && (
            <Modal title={`Edit: ${inspectingNode.data.type}`} onClose={() => setInspectingNodeId(null)}>
              <div className="inspector-modal-content">
                <StepInspector
                  node={{ type: inspectingNode.data.type, data: inspectingNode.data._rawData }}
                  onChange={updateSelected}
                  addresses={addresses}
                  accountIds={accountIds}
                />
                <div className="inspector-actions" style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  <button className="danger" onClick={deleteSelected}>Delete</button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="filter" onClick={openInsertAfter} title="Insert a new node immediately after this one">
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

function flowToSpec(nodes, title, fileTags) {
  const setup_steps = [];
  const scenarios = [];

  const sortedNodes = [...nodes].sort((a, b) => {
    if (Math.abs(a.position.y - b.position.y) < 50) return a.position.x - b.position.x;
    return a.position.y - b.position.y;
  });

  let currentScenario = null;
  for (const node of sortedNodes) {
    const type = node.data.type;
    const rawData = node.data._rawData;

    if (type === 'scenario') {
      currentScenario = {
        name: rawData.name || 'Scenario',
        tags: splitTags(rawData.tags),
        steps: [],
      };
      scenarios.push(currentScenario);
      continue;
    }
    const step = { type, raw: '', data: clone(rawData) };
    if (currentScenario) currentScenario.steps.push(step);
    else setup_steps.push(step);
  }
  return { title, file_tags: splitTags(fileTags), setup_steps, scenarios };
}

function splitTags(value) {
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
    posting_instruction_batch: { timestamp: `${day}T10:00:00`, instructions: [] },
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

