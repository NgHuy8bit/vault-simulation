import { useMemo, useState } from 'react';

import { api } from '../api/client.js';
import { clone } from '../utils/format.js';
import { StepInspector } from './StepInspector.jsx';

const PALETTE = [
  ['config', 'Config'],
  ['product', 'Product'],
  ['account', 'Account'],
  ['balance_check', 'Balance Check'],
  ['inbound', 'Inbound Settlement'],
  ['outbound', 'Outbound Settlement'],
  ['accepted', 'Verify Accepted'],
  ['rejected', 'Verify Rejected'],
  ['notification', 'Notification'],
  ['scenario', 'Scenario'],
];

export function SpecNodeEditor({ spec, onCancel, onSaved }) {
  const initialNodes = useMemo(() => specToNodes(spec.parsed), [spec.parsed]);
  const [nodes, setNodes] = useState(initialNodes);
  const [selectedId, setSelectedId] = useState(initialNodes[0]?.id || null);
  const [title, setTitle] = useState(spec.parsed.title || 'New Spec');
  const [fileTags, setFileTags] = useState((spec.parsed.file_tags || []).join(', '));
  const [path, setPath] = useState(spec.path);
  const [dragId, setDragId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const selected = nodes.find((node) => node.id === selectedId) || nodes[0];

  function addNode(type) {
    const node = { id: newId(), type, data: defaultData(type) };
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
  }

  function updateSelected(data) {
    setNodes((current) => current.map((node) => (node.id === selected.id ? { ...node, data } : node)));
  }

  function deleteSelected() {
    if (!selected) return;
    setNodes((current) => current.filter((node) => node.id !== selected.id));
    setSelectedId(nodes.find((node) => node.id !== selected.id)?.id || null);
  }

  function dropOn(targetId) {
    if (!dragId || dragId === targetId) return;
    setNodes((current) => {
      const sourceIndex = current.findIndex((node) => node.id === dragId);
      const targetIndex = current.findIndex((node) => node.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDragId(null);
  }

  async function save() {
    setSaving(true);
    setToast(null);
    try {
      await api.saveSpec({
        path,
        steps_json: nodesToSpec(nodes, title, fileTags),
      });
      setToast({ type: 'success', message: 'Spec saved.' });
      await onSaved();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Save failed.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="node-editor">
      <div className="node-editor-top">
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Tags
          <input value={fileTags} onChange={(event) => setFileTags(event.target.value)} placeholder="tag1, tag2" />
        </label>
        <label className="wide-field">
          File path
          <input value={path} onChange={(event) => setPath(event.target.value)} />
        </label>
        <button className="filter" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={saving} onClick={save}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}

      <div className="node-editor-body">
        <aside className="node-palette">
          <div className="section-title">Nodes</div>
          {PALETTE.map(([type, label]) => (
            <button key={type} onClick={() => addNode(type)}>
              {label}
            </button>
          ))}
        </aside>

        <section className="node-canvas">
          {nodes.length === 0 && <div className="muted">Add a node from the palette.</div>}
          {nodes.map((node, index) => (
            <button
              key={node.id}
              draggable
              className={`flow-node ${selected?.id === node.id ? 'selected' : ''} ${node.type === 'scenario' ? 'scenario-node' : ''}`}
              onClick={() => setSelectedId(node.id)}
              onDragStart={() => setDragId(node.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropOn(node.id)}
            >
              {index > 0 && <span className="flow-line" />}
              <span className={`node-type type-${node.type}`}>{node.type}</span>
              <strong>{nodeTitle(node)}</strong>
              <small>{nodeSubtitle(node)}</small>
            </button>
          ))}
        </section>

        <aside className="node-inspector">
          <div className="section-title">Inspector</div>
          {selected ? (
            <>
              <StepInspector node={selected} onChange={updateSelected} />
              <button className="danger" onClick={deleteSelected}>
                Delete selected
              </button>
            </>
          ) : (
            <div className="muted">Select a node.</div>
          )}
        </aside>
      </div>
    </div>
  );
}

function specToNodes(parsed) {
  const nodes = [];
  for (const step of parsed.setup_steps || []) {
    nodes.push({ id: newId(), type: step.type, data: clone(step.data) });
  }
  for (const scenario of parsed.scenarios || []) {
    nodes.push({ id: newId(), type: 'scenario', data: { name: scenario.name, tags: (scenario.tags || []).join(', ') } });
    for (const step of scenario.steps || []) {
      nodes.push({ id: newId(), type: step.type, data: clone(step.data) });
    }
  }
  return nodes;
}

function nodesToSpec(nodes, title, fileTags) {
  const setup_steps = [];
  const scenarios = [];
  let currentScenario = null;
  for (const node of nodes) {
    if (node.type === 'scenario') {
      currentScenario = {
        name: node.data.name || 'Scenario',
        tags: splitTags(node.data.tags),
        steps: [],
      };
      scenarios.push(currentScenario);
      continue;
    }
    const step = { type: node.type, raw: '', data: clone(node.data) };
    if (currentScenario) currentScenario.steps.push(step);
    else setup_steps.push(step);
  }
  return { title, file_tags: splitTags(fileTags), setup_steps, scenarios };
}

function splitTags(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
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
    inbound: {
      timestamp: `${day}T10:00:00`,
      amount: '1000000',
      denomination: 'VND',
      from_account: '1',
      to_account: 'LOAN_ACCOUNT',
      instruction_detail: [],
    },
    outbound: {
      timestamp: `${day}T10:00:00`,
      amount: '1000000',
      denomination: 'VND',
      from_account: 'LOAN_ACCOUNT',
      to_account: '1',
      instruction_detail: [],
    },
    accepted: { timestamp: `${day}T10:00:00`, account_id: 'LOAN_ACCOUNT' },
    rejected: {
      timestamp: `${day}T10:00:00`,
      account_id: 'LOAN_ACCOUNT',
      reason_code: 'InsufficientFunds',
      contract_violation_code: 'CV_006',
      details: [],
    },
    notification: {
      timestamp: `${day}T10:00:00`,
      account_id: 'LOAN_ACCOUNT',
      notification_type: 'ACTIVITY',
      notification_details: [],
      expected: true,
    },
  }[type];
}

function newId() {
  return `node_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function nodeTitle(node) {
  const data = node.data || {};
  if (node.type === 'scenario') return data.name || 'Scenario';
  if (node.type === 'config') return data.key || 'Config';
  if (node.type === 'product') return data.name || 'Product';
  if (node.type === 'account') return data.account_id || 'Account';
  if (node.type === 'balance_check') return `${data.rows?.length || 0} checks`;
  if (node.type === 'notification') return data.notification_type || 'Notification';
  return node.type;
}

function nodeSubtitle(node) {
  const data = node.data || {};
  if (node.type === 'inbound' || node.type === 'outbound') return `${data.amount} ${data.denomination}`;
  if (node.type === 'accepted' || node.type === 'rejected') return data.account_id || '';
  if (node.type === 'scenario') return data.tags || '';
  return data.timestamp || data.value || '';
}
