import { clone } from './format.js';

export function newId() {
  return `node_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function nodeTitle({ type, data }) {
  if (type === 'scenario') return data.name || 'Scenario';
  if (type === 'config') return data.key || 'Config';
  if (type === 'product') return data.name || 'Product';
  if (type === 'account') return data.account_id || 'Account';
  if (type === 'balance_check') return `${data.rows?.length || 0} checks`;
  if (type === 'balance_check_multi') return `${data.rows?.length || 0} checks`;
  if (type === 'notification') return data.notification_type || 'Notification';
  if (type === 'no_notifications') return 'No Notifications';
  if (type === 'posting_instruction_batch') return `${data.instructions?.length || 0} instructions`;
  if (type === 'schedule') return data.event_id || 'Schedule';
  if (type === 'parameter_rejected') return 'Param Rejected';
  if (type === 'derived_parameters') return `${data.rows?.length || 0} params`;
  if (type === 'change_instance_params') return data.account_id || 'Instance Params';
  if (type === 'change_template_params') return data.product_version_id || 'Template Params';
  if (type === 'update_account_status') return data.status || 'Update Status';
  if (type === 'account_close') return data.account_id || 'Close Account';
  if (type === 'update_account_version') return data.account_id || 'Update Version';
  if (type === 'flag_definition') return data.flag_name || 'Flag Definition';
  if (type === 'flag') return data.flag_name || 'Set Flag';
  if (type === 'auth_adjustment') return data.client_transaction_id || 'Auth Adjustment';
  if (type === 'global_param') return data.name || 'Global Param';
  if (type === 'derived_parameter_dict') return data.param_name || 'Derived Param';
  if (type === 'exception_msg') return 'Exception';
  if (type === 'instruction_detail_check') return `${data.rows?.length || 0} details`;
  if (type === 'batch_detail_check') return `${data.rows?.length || 0} details`;
  if (type === 'inbound' || type === 'outbound') return `${data.amount} ${data.denomination || ''}`.trim();
  if (type === 'inbound_auth' || type === 'outbound_auth') return `${data.amount} ${data.denomination || ''}`.trim();
  if (type === 'transfer' || type === 'custom_instruction') return `${data.amount} ${data.denomination || ''}`.trim();
  if (type === 'settlement') return `${data.amount}`;
  if (type === 'release') return data.client_transaction_id || 'Release';
  if (type === 'accepted' || type === 'rejected') return data.account_id || type;
  if (type === 'other') return data.raw_text ? String(data.raw_text).slice(0, 40) : 'Free text';
  return type;
}

export function nodeSubtitle({ type, data }) {
  if (type === 'inbound' || type === 'outbound') return `${data.amount} ${data.denomination}`;
  if (type === 'inbound_auth' || type === 'outbound_auth' || type === 'transfer' || type === 'custom_instruction') return `${data.amount} ${data.denomination}`;
  if (type === 'settlement') return `${data.amount} (TXN: ${data.client_transaction_id})`;
  if (type === 'release') return `TXN: ${data.client_transaction_id}`;
  if (type === 'auth_adjustment') return `${data.amount}`;
  if (type === 'accepted' || type === 'rejected') return data.account_id || '';
  if (type === 'notification') return data.account_id || '';
  if (type === 'schedule' || type === 'parameter_rejected' || type === 'derived_parameters') return data.account_id || '';
  if (type === 'change_instance_params') return `${data.params?.length || 0} params`;
  if (type === 'change_template_params') return `${data.params?.length || 0} params`;
  if (type === 'update_account_status') return data.account_id || '';
  if (type === 'account_close' || type === 'update_account_version') return data.account_id || '';
  if (type === 'flag' || type === 'flag_definition') return data.timestamp || '';
  if (type === 'balance_check_multi') return data.denomination || '';
  if (type === 'global_param') return data.timestamp || '';
  if (type === 'derived_parameter_dict') return data.account_id || '';
  if (type === 'exception_msg') return data.message || '';
  if (type === 'instruction_detail_check' || type === 'batch_detail_check') return data.timestamp || '';
  if (type === 'scenario') return data.tags || '';
  return data.timestamp || data.value || '';
}

export function specToFlow(parsed) {
  const nodes = [];
  const edges = [];

  let currentY = 50;
  let currentX = 50;
  let lastNodeId = null;

  function pushNode(type, data, isNewRow = false) {
    if (isNewRow) {
      currentY += 150;
      currentX = 50;
      lastNodeId = null;
    }

    const id = newId();
    nodes.push({
      id,
      type: 'custom',
      position: { x: currentX, y: currentY },
      data: {
        type,
        title: nodeTitle({ type, data }),
        subtitle: nodeSubtitle({ type, data }),
        _rawData: clone(data),
      },
    });

    if (lastNodeId) {
      edges.push({ id: `e-${lastNodeId}-${id}`, source: lastNodeId, target: id });
    }
    lastNodeId = id;
    currentX += 320;
  }

  for (const step of parsed.setup_steps || []) {
    pushNode(step.type, step.data, false);
  }
  for (const scenario of parsed.scenarios || []) {
    pushNode('scenario', { name: scenario.name, tags: (scenario.tags || []).join(', ') }, true);
    for (const step of scenario.steps || []) {
      pushNode(step.type, step.data, false);
    }
  }
  return { nodes, edges };
}
