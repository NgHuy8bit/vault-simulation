import { Handle, Position } from '@xyflow/react';

// Type → accent color class (left border strip + badge tint)
const TYPE_ACCENT = {
  scenario:               'accent-scenario',
  config:                 'accent-config',
  product:                'accent-product',
  account:                'accent-account',
  balance_check:          'accent-balance',
  balance_check_multi:    'accent-balance',
  inbound:                'accent-inbound',
  outbound:               'accent-outbound',
  transfer:               'accent-transfer',
  settlement:             'accent-transfer',
  release:                'accent-transfer',
  inbound_auth:           'accent-inbound',
  outbound_auth:          'accent-outbound',
  custom_instruction:     'accent-transfer',
  posting_instruction_batch: 'accent-transfer',
  schedule:               'accent-schedule',
  notification:           'accent-notification',
  no_notifications:       'accent-notification',
  flag:                   'accent-flag',
  flag_definition:        'accent-flag',
  global_param:           'accent-config',
  derived_parameters:     'accent-config',
  derived_parameter_dict: 'accent-config',
  change_instance_params: 'accent-config',
  change_template_params: 'accent-config',
  update_account_status:  'accent-account',
  account_close:          'accent-account',
  update_account_version: 'accent-account',
  accepted:               'accent-inbound',
  rejected:               'accent-outbound',
  exception_msg:          'accent-outbound',
  parameter_rejected:     'accent-outbound',
  instruction_detail_check: 'accent-balance',
  batch_detail_check:     'accent-balance',
  other:                  'accent-other',
};

function fmtTs(ts) {
  if (!ts) return null;
  return String(ts).replace('T', ' ').replace(/\s*[+-]\d{2}:?\d{2}$|Z$/, '');
}

function fmtAmt(val, denom) {
  if (!val) return null;
  const n = Number(String(val).replace(/_/g, ''));
  const s = isNaN(n) ? String(val).replace(/_/g, ',') : n.toLocaleString('en-US');
  return denom ? `${s} ${denom}` : s;
}

function MetaRow({ icon, children }) {
  if (!children) return null;
  return (
    <div className="fn-meta-row">
      {icon && <span className="fn-meta-icon">{icon}</span>}
      <span className="fn-meta-text">{children}</span>
    </div>
  );
}

function AddressPills({ rows, max = 4 }) {
  if (!rows || rows.length === 0) return null;
  const addresses = [...new Set(rows.map((r) => r.address).filter(Boolean))];
  const shown = addresses.slice(0, max);
  const rest = addresses.length - shown.length;
  return (
    <div className="fn-pill-row">
      {shown.map((addr) => (
        <span key={addr} className="fn-pill">{addr}</span>
      ))}
      {rest > 0 && <span className="fn-pill fn-pill-more">+{rest}</span>}
    </div>
  );
}

function NodeExtra({ type, raw }) {
  if (!raw) return null;

  if (type === 'balance_check' || type === 'balance_check_multi') {
    return (
      <>
        {raw.denomination && (
          <MetaRow icon="◈">{raw.denomination}</MetaRow>
        )}
        <AddressPills rows={raw.rows} />
      </>
    );
  }

  if (type === 'inbound' || type === 'outbound' || type === 'transfer') {
    return (
      <>
        {fmtTs(raw.timestamp) && <MetaRow icon="◷">{fmtTs(raw.timestamp)}</MetaRow>}
        {(raw.from_account || raw.to_account) && (
          <MetaRow icon="⇄">
            {[raw.from_account, raw.to_account].filter(Boolean).join(' → ')}
          </MetaRow>
        )}
      </>
    );
  }

  if (type === 'custom_instruction') {
    return (
      <>
        {fmtTs(raw.timestamp) && <MetaRow icon="◷">{fmtTs(raw.timestamp)}</MetaRow>}
        {raw.account_id && <MetaRow icon="⊛">{raw.account_id}</MetaRow>}
        {(raw.from_address || raw.to_address) && (
          <MetaRow icon="⇄">
            {[raw.from_address, raw.to_address].filter(Boolean).join(' → ')}
          </MetaRow>
        )}
      </>
    );
  }

  if (type === 'inbound_auth' || type === 'outbound_auth') {
    return (
      <>
        {fmtTs(raw.timestamp) && <MetaRow icon="◷">{fmtTs(raw.timestamp)}</MetaRow>}
        {raw.client_transaction_id && <MetaRow icon="#">{raw.client_transaction_id}</MetaRow>}
      </>
    );
  }

  if (type === 'settlement' || type === 'release') {
    return (
      <>
        {fmtTs(raw.timestamp) && <MetaRow icon="◷">{fmtTs(raw.timestamp)}</MetaRow>}
        {raw.client_transaction_id && <MetaRow icon="#">{raw.client_transaction_id}</MetaRow>}
      </>
    );
  }

  if (type === 'account') {
    return (
      <>
        <MetaRow icon="⊛">{raw.account_id}</MetaRow>
        {raw.version_id && <MetaRow icon="v">v{raw.version_id}</MetaRow>}
        {raw.params?.length > 0 && <MetaRow icon="⊞">{raw.params.length} params</MetaRow>}
      </>
    );
  }

  if (type === 'product') {
    return (
      <>
        {raw.version_id && <MetaRow icon="v">v{raw.version_id}</MetaRow>}
        {raw.params?.length > 0 && <MetaRow icon="⊞">{raw.params.length} params</MetaRow>}
      </>
    );
  }

  if (type === 'config') {
    return <MetaRow icon="=">{String(raw.value ?? '').slice(0, 50)}</MetaRow>;
  }

  if (type === 'schedule') {
    return (
      <>
        {fmtTs(raw.timestamp) && <MetaRow icon="◷">{fmtTs(raw.timestamp)}</MetaRow>}
        {raw.account_id && <MetaRow icon="⊛">{raw.account_id}</MetaRow>}
      </>
    );
  }

  if (type === 'notification') {
    return (
      <>
        {fmtTs(raw.timestamp) && <MetaRow icon="◷">{fmtTs(raw.timestamp)}</MetaRow>}
        {raw.account_id && <MetaRow icon="⊛">{raw.account_id}</MetaRow>}
      </>
    );
  }

  if (type === 'flag' || type === 'flag_definition') {
    return (
      <>
        {fmtTs(raw.timestamp) && <MetaRow icon="◷">{fmtTs(raw.timestamp)}</MetaRow>}
        {raw.account_id && <MetaRow icon="⊛">{raw.account_id}</MetaRow>}
      </>
    );
  }

  if (type === 'global_param') {
    return (
      <>
        {fmtTs(raw.timestamp) && <MetaRow icon="◷">{fmtTs(raw.timestamp)}</MetaRow>}
        {raw.name && <MetaRow icon="⊞">{raw.name}</MetaRow>}
      </>
    );
  }

  if (type === 'derived_parameters' || type === 'derived_parameter_dict') {
    return (
      <>
        {fmtTs(raw.timestamp) && <MetaRow icon="◷">{fmtTs(raw.timestamp)}</MetaRow>}
        {raw.account_id && <MetaRow icon="⊛">{raw.account_id}</MetaRow>}
        {raw.rows?.length > 0 && <MetaRow icon="⊞">{raw.rows.length} values</MetaRow>}
      </>
    );
  }

  if (type === 'update_account_status' || type === 'account_close' || type === 'update_account_version') {
    return (
      <>
        {fmtTs(raw.timestamp) && <MetaRow icon="◷">{fmtTs(raw.timestamp)}</MetaRow>}
        {raw.account_id && <MetaRow icon="⊛">{raw.account_id}</MetaRow>}
        {raw.status && <MetaRow icon="→">{raw.status}</MetaRow>}
      </>
    );
  }

  if (type === 'accepted' || type === 'rejected' || type === 'parameter_rejected') {
    return (
      <>
        {fmtTs(raw.timestamp) && <MetaRow icon="◷">{fmtTs(raw.timestamp)}</MetaRow>}
        {raw.account_id && <MetaRow icon="⊛">{raw.account_id}</MetaRow>}
        {raw.rejection_reason && (
          <MetaRow icon="!">{String(raw.rejection_reason).slice(0, 50)}</MetaRow>
        )}
      </>
    );
  }

  if (type === 'change_instance_params' || type === 'change_template_params') {
    return (
      <>
        {raw.account_id && <MetaRow icon="⊛">{raw.account_id}</MetaRow>}
        {raw.params?.length > 0 && <MetaRow icon="⊞">{raw.params.length} params changed</MetaRow>}
      </>
    );
  }

  if (type === 'instruction_detail_check' || type === 'batch_detail_check') {
    return fmtTs(raw.timestamp) ? <MetaRow icon="◷">{fmtTs(raw.timestamp)}</MetaRow> : null;
  }

  if (type === 'posting_instruction_batch') {
    const instrs = raw.instructions || [];
    // Collect unique instruction types — two column-name patterns appear in specs:
    //   "initiate an instruction batch with:" → instruction_type column
    //   "make a posting instruction batch with:..." → posting_type column
    const types = [...new Set(
      instrs.map((i) => i.instruction_type || i.posting_type || '').filter(Boolean),
    )];
    return (
      <>
        {fmtTs(raw.timestamp) && <MetaRow icon="◷">{fmtTs(raw.timestamp)}</MetaRow>}
        {types.length > 0 && <MetaRow icon="⇄">{types.join(' · ')}</MetaRow>}
      </>
    );
  }

  return null;
}

export function SpecCustomNode({ data, isConnectable }) {
  const isScenario = data.type === 'scenario';
  const isAnnotation = data.type === 'other';
  const runStatusClass = data.runStatus ? `run-status-${data.runStatus}` : '';
  const accentClass = TYPE_ACCENT[data.type] || 'accent-config';
  const statusLabel = data.runStatus === 'running'
    ? 'Running'
    : data.runStatus === 'passed'
      ? 'Passed'
      : data.runStatus === 'failed'
        ? 'Failed'
        : null;

  return (
    <div className={`flow-node custom-flow-node ${isScenario ? 'scenario-node' : ''} ${isAnnotation ? 'annotation-node' : ''} ${runStatusClass} ${accentClass}`}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        style={{ background: '#475569', width: 8, height: 8 }}
      />

      <div className="node-content">
        {!isAnnotation && (
          <div className="node-header">
            <span className={`node-type type-${data.type}`}>{data.type}</span>
            {statusLabel && (
              <span className={`node-status-pill ${data.runStatus}`}>
                <span className={`node-run-dot ${data.runStatus}`} />
                {statusLabel}
              </span>
            )}
          </div>
        )}

        <div className="node-body">
          {isAnnotation ? (
            // Free-text annotation line — render as an inline comment label
            <div className="annotation-body">
              <span className="annotation-sigil">//</span>
              <span className="annotation-text">{data.title}</span>
            </div>
          ) : (
            <>
              <div className="node-title">{data.title}</div>
              {data.subtitle && <div className="node-subtitle">{data.subtitle}</div>}
              <NodeExtra type={data.type} raw={data._rawData} />
            </>
          )}
        </div>
      </div>

      {data.runStatus === 'failed' && data.runError && (
        <div className="node-error-banner" title={data.runError}>
          <span className="node-error-icon">✗</span>
          <span className="node-error-text">{data.runError}</span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        style={{ background: '#475569', width: 8, height: 8 }}
      />
    </div>
  );
}
