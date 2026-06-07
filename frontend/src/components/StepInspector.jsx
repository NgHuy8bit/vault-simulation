import { clone } from '../utils/format.js';

export function StepInspector({ node, onChange, addresses = [], accountIds = [] }) {
  const data = node.data || {};

  function patch(field, value) {
    onChange({ ...data, [field]: value });
  }

  function patchRow(field, index, key, value) {
    const rows = clone(data[field] || []);
    rows[index] = { ...rows[index], [key]: value };
    patch(field, rows);
  }

  function addRow(field, template) {
    patch(field, [...(data[field] || []), template]);
  }

  function sortRows(field) {
    patch(field, sortedRows(field, data[field] || []));
  }

  function removeRow(field, index) {
    patch(field, (data[field] || []).filter((_, i) => i !== index));
  }

  if (node.type === 'scenario') {
    return (
      <FormGrid>
        <Field label="Scenario name" value={data.name} onChange={(v) => patch('name', v)} />
        <Field label="Tags" value={data.tags} onChange={(v) => patch('tags', v)} />
      </FormGrid>
    );
  }

  if (node.type === 'config') {
    return (
      <FormGrid>
        <label>
          Type
          <select value={data.key || 'timezone'} onChange={(e) => patch('key', e.target.value)}>
            <option value="timezone">Time Zone</option>
            <option value="start_timestamp">Start Timestamp</option>
            <option value="end_timestamp">End Timestamp</option>
            <option value="global_param">Global Param / Setup</option>
          </select>
        </label>
        <Field label="Value" value={data.value} onChange={(v) => patch('value', v)} />
      </FormGrid>
    );
  }

  if (node.type === 'product') {
    return (
      <FormGrid>
        <Field label="Product name" value={data.name} onChange={(v) => patch('name', v)} />
        <Field label="Version ID" value={data.version_id} onChange={(v) => patch('version_id', v)} />
        <EditableRows
          title="Template parameters"
          rows={data.params || []}
          columns={['name', 'value']}
          onAdd={() => addRow('params', { name: '', value: '' })}
          onChange={(index, key, value) => patchRow('params', index, key, value)}
          onRemove={(index) => removeRow('params', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'account') {
    return (
      <FormGrid>
        <FieldWithSuggestions
          label="Account ID"
          fieldKey="account_id"
          value={data.account_id}
          onChange={(v) => patch('account_id', v)}
          suggestions={accountIds}
        />
        <Field label="Product version ID" value={data.version_id} onChange={(v) => patch('version_id', v)} />
        <EditableRows
          title="Instance parameters"
          rows={data.params || []}
          columns={['name', 'value']}
          onAdd={() => addRow('params', { name: '', value: '' })}
          onChange={(index, key, value) => patchRow('params', index, key, value)}
          onRemove={(index) => removeRow('params', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'balance_check') {
    return (
      <FormGrid>
        <Field label="Denomination" value={data.denomination} onChange={(v) => patch('denomination', v)} />
        <EditableRows
          title="Balance rows"
          rows={data.rows || []}
          columns={['timestamp', 'account_id', 'address', 'balance']}
          inputTypes={{ timestamp: 'datetime-local', balance: 'number' }}
          suggestions={{ account_id: accountIds, address: addresses }}
          onAdd={() => addRow('rows', { timestamp: '', account_id: '', address: '', balance: '0' })}
          onChange={(index, key, value) => patchRow('rows', index, key, value)}
          onBlur={() => sortRows('rows')}
          onRemove={(index) => removeRow('rows', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'balance_check_multi') {
    return (
      <FormGrid>
        <Field label="Default denomination" value={data.denomination} onChange={(v) => patch('denomination', v)} />
        <EditableRows
          title="Balance rows"
          rows={data.rows || []}
          columns={['timestamp', 'account_id', 'address', 'denomination', 'balance']}
          inputTypes={{ timestamp: 'datetime-local', balance: 'number' }}
          suggestions={{ account_id: accountIds, address: addresses }}
          onAdd={() => addRow('rows', { timestamp: '', account_id: '', address: '', denomination: data.denomination || 'VND', phase: 'POSTING_PHASE_COMMITTED', asset: 'COMMERCIAL_BANK_MONEY', balance: '0' })}
          onChange={(index, key, value) => patchRow('rows', index, key, value)}
          onBlur={() => sortRows('rows')}
          onRemove={(index) => removeRow('rows', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'inbound' || node.type === 'outbound') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <Field label="Amount" type="number" value={data.amount} onChange={(v) => patch('amount', v)} />
        <Field label="Denomination" value={data.denomination} onChange={(v) => patch('denomination', v)} />
        <FieldWithSuggestions label="From account ID" fieldKey="from_account" value={data.from_account} onChange={(v) => patch('from_account', v)} suggestions={accountIds} />
        <FieldWithSuggestions label="To account ID" fieldKey="to_account" value={data.to_account} onChange={(v) => patch('to_account', v)} suggestions={accountIds} />
        <EditableRows
          title="Instruction details"
          rows={data.instruction_detail || []}
          columns={['key', 'value']}
          onAdd={() => addRow('instruction_detail', { key: '', value: '' })}
          onChange={(index, key, value) => patchRow('instruction_detail', index, key, value)}
          onRemove={(index) => removeRow('instruction_detail', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'inbound_auth' || node.type === 'outbound_auth') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <Field label="Amount" type="number" value={data.amount} onChange={(v) => patch('amount', v)} />
        <Field label="Denomination" value={data.denomination} onChange={(v) => patch('denomination', v)} />
        <FieldWithSuggestions label="Customer account ID" fieldKey="customer_account_id" value={data.customer_account_id} onChange={(v) => patch('customer_account_id', v)} suggestions={accountIds} />
        <FieldWithSuggestions label="Internal account ID" fieldKey="internal_account_id" value={data.internal_account_id} onChange={(v) => patch('internal_account_id', v)} suggestions={accountIds} />
        {node.type === 'outbound_auth' && (
          <Field label="Client transaction ID (optional)" value={data.client_transaction_id} onChange={(v) => patch('client_transaction_id', v)} />
        )}
        <EditableRows
          title="Instruction details"
          rows={data.instruction_detail || []}
          columns={['key', 'value']}
          onAdd={() => addRow('instruction_detail', { key: '', value: '' })}
          onChange={(index, key, value) => patchRow('instruction_detail', index, key, value)}
          onRemove={(index) => removeRow('instruction_detail', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'transfer') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <Field label="Amount" type="number" value={data.amount} onChange={(v) => patch('amount', v)} />
        <Field label="Denomination" value={data.denomination} onChange={(v) => patch('denomination', v)} />
        <FieldWithSuggestions label="Debtor account ID" fieldKey="debtor_account_id" value={data.debtor_account_id} onChange={(v) => patch('debtor_account_id', v)} suggestions={accountIds} />
        <FieldWithSuggestions label="Creditor account ID" fieldKey="creditor_account_id" value={data.creditor_account_id} onChange={(v) => patch('creditor_account_id', v)} suggestions={accountIds} />
        <EditableRows
          title="Instruction details"
          rows={data.instruction_detail || []}
          columns={['key', 'value']}
          onAdd={() => addRow('instruction_detail', { key: '', value: '' })}
          onChange={(index, key, value) => patchRow('instruction_detail', index, key, value)}
          onRemove={(index) => removeRow('instruction_detail', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'settlement') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <Field label="Amount" type="number" value={data.amount} onChange={(v) => patch('amount', v)} />
        <Field label="Client transaction ID" value={data.client_transaction_id} onChange={(v) => patch('client_transaction_id', v)} />
        <EditableRows
          title="Instruction details"
          rows={data.instruction_detail || []}
          columns={['key', 'value']}
          onAdd={() => addRow('instruction_detail', { key: '', value: '' })}
          onChange={(index, key, value) => patchRow('instruction_detail', index, key, value)}
          onRemove={(index) => removeRow('instruction_detail', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'release') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <Field label="Client transaction ID" value={data.client_transaction_id} onChange={(v) => patch('client_transaction_id', v)} />
        <EditableRows
          title="Instruction details"
          rows={data.instruction_detail || []}
          columns={['key', 'value']}
          onAdd={() => addRow('instruction_detail', { key: '', value: '' })}
          onChange={(index, key, value) => patchRow('instruction_detail', index, key, value)}
          onRemove={(index) => removeRow('instruction_detail', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'custom_instruction') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <Field label="Amount" type="number" value={data.amount} onChange={(v) => patch('amount', v)} />
        <Field label="Denomination" value={data.denomination} onChange={(v) => patch('denomination', v)} />
        <FieldWithSuggestions label="Debtor account ID" fieldKey="debtor_account_id" value={data.debtor_account_id} onChange={(v) => patch('debtor_account_id', v)} suggestions={accountIds} />
        <FieldWithSuggestions label="Debtor address" fieldKey="debtor_address" value={data.debtor_account_address} onChange={(v) => patch('debtor_account_address', v)} suggestions={addresses} />
        <FieldWithSuggestions label="Creditor account ID" fieldKey="creditor_account_id" value={data.creditor_account_id} onChange={(v) => patch('creditor_account_id', v)} suggestions={accountIds} />
        <FieldWithSuggestions label="Creditor address" fieldKey="creditor_address" value={data.creditor_account_address} onChange={(v) => patch('creditor_account_address', v)} suggestions={addresses} />
      </FormGrid>
    );
  }

  if (node.type === 'posting_instruction_batch') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        {data.instructions?.length > 0 ? (
          <div className="inspector-text">Contains {data.instructions.length} instructions. Edit in source view.</div>
        ) : (
          <div className="inspector-text">No instructions yet.</div>
        )}
      </FormGrid>
    );
  }

  if (node.type === 'auth_adjustment') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <Field label="Amount" type="number" value={data.amount} onChange={(v) => patch('amount', v)} />
        <Field label="Client transaction ID" value={data.client_transaction_id} onChange={(v) => patch('client_transaction_id', v)} />
      </FormGrid>
    );
  }

  if (node.type === 'accepted') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <FieldWithSuggestions label="Account ID" fieldKey="accepted_account_id" value={data.account_id} onChange={(v) => patch('account_id', v)} suggestions={accountIds} />
      </FormGrid>
    );
  }

  if (node.type === 'rejected') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <FieldWithSuggestions label="Account ID" fieldKey="rejected_account_id" value={data.account_id} onChange={(v) => patch('account_id', v)} suggestions={accountIds} />
        <label>
          Rejection type
          <select value={data.rejection_type || 'InsufficientFunds'} onChange={(e) => patch('rejection_type', e.target.value)}>
            <option value="AgainstTermsAndConditions">AgainstTermsAndConditions</option>
            <option value="InsufficientFunds">InsufficientFunds</option>
            <option value="Unknown">Unknown</option>
            <option value="Other">Other</option>
          </select>
        </label>
        <Field label="Rejection reason" value={data.rejection_reason} onChange={(v) => patch('rejection_reason', v)} />
      </FormGrid>
    );
  }

  if (node.type === 'notification') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <FieldWithSuggestions label="Account ID" fieldKey="notif_account_id" value={data.account_id} onChange={(v) => patch('account_id', v)} suggestions={accountIds} />
        <Field label="Notification type" value={data.notification_type} onChange={(v) => patch('notification_type', v)} />
        <EditableRows
          title="Notification details"
          rows={data.notification_details || []}
          columns={['key', 'value']}
          onAdd={() => addRow('notification_details', { key: '', value: '' })}
          onChange={(index, key, value) => patchRow('notification_details', index, key, value)}
          onRemove={(index) => removeRow('notification_details', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'no_notifications') {
    return <div className="inspector-text">Expect no contract notifications. No fields to configure.</div>;
  }

  if (node.type === 'schedule') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <FieldWithSuggestions label="Account ID" fieldKey="schedule_account_id" value={data.account_id} onChange={(v) => patch('account_id', v)} suggestions={accountIds} />
        <Field label="Event ID" value={data.event_id} onChange={(v) => patch('event_id', v)} />
      </FormGrid>
    );
  }

  if (node.type === 'parameter_rejected') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <FieldWithSuggestions label="Account ID" fieldKey="param_rej_account_id" value={data.account_id} onChange={(v) => patch('account_id', v)} suggestions={accountIds} />
        <label>
          Rejection type
          <select value={data.rejection_type || 'AgainstTermsAndConditions'} onChange={(e) => patch('rejection_type', e.target.value)}>
            <option value="AgainstTermsAndConditions">AgainstTermsAndConditions</option>
            <option value="InsufficientFunds">InsufficientFunds</option>
            <option value="Unknown">Unknown</option>
            <option value="Other">Other</option>
          </select>
        </label>
        <Field label="Rejection reason" value={data.rejection_reason} onChange={(v) => patch('rejection_reason', v)} />
      </FormGrid>
    );
  }

  if (node.type === 'derived_parameters') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <FieldWithSuggestions label="Account ID" fieldKey="derived_account_id" value={data.account_id} onChange={(v) => patch('account_id', v)} suggestions={accountIds} />
        <EditableRows
          title="Expected parameters"
          rows={data.rows || []}
          columns={['name', 'value']}
          onAdd={() => addRow('rows', { name: '', value: '' })}
          onChange={(index, key, value) => patchRow('rows', index, key, value)}
          onRemove={(index) => removeRow('rows', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'derived_parameter_dict') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <Field label="Parameter name" value={data.param_name} onChange={(v) => patch('param_name', v)} />
        <FieldWithSuggestions label="Account ID" fieldKey="dpd_account_id" value={data.account_id} onChange={(v) => patch('account_id', v)} suggestions={accountIds} />
        <Field label="Expected value" value={data.value} onChange={(v) => patch('value', v)} />
      </FormGrid>
    );
  }

  if (node.type === 'global_param') {
    return (
      <FormGrid>
        <Field label="Timestamp" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <Field label="Parameter name / ID" value={data.name} onChange={(v) => patch('name', v)} />
        <Field label="Value" value={data.value} onChange={(v) => patch('value', v)} />
        <EditableRows
          title="Rows (for multi-param)"
          rows={data.rows || []}
          columns={['name', 'value']}
          onAdd={() => addRow('rows', { name: '', value: '' })}
          onChange={(index, key, value) => patchRow('rows', index, key, value)}
          onRemove={(index) => removeRow('rows', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'exception_msg') {
    return (
      <FormGrid>
        <Field label="Message" value={data.message} onChange={(v) => patch('message', v)} />
      </FormGrid>
    );
  }

  if (node.type === 'instruction_detail_check') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <EditableRows
          title="Expected details"
          rows={data.rows || []}
          columns={['key', 'value']}
          onAdd={() => addRow('rows', { key: '', value: '' })}
          onChange={(index, key, value) => patchRow('rows', index, key, value)}
          onRemove={(index) => removeRow('rows', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'batch_detail_check') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <EditableRows
          title="Expected metadata"
          rows={data.rows || []}
          columns={['key', 'value']}
          onAdd={() => addRow('rows', { key: '', value: '' })}
          onChange={(index, key, value) => patchRow('rows', index, key, value)}
          onRemove={(index) => removeRow('rows', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'change_instance_params') {
    return (
      <FormGrid>
        <FieldWithSuggestions label="Account ID" fieldKey="cip_account_id" value={data.account_id} onChange={(v) => patch('account_id', v)} suggestions={accountIds} />
        <EditableRows
          title="Parameters"
          rows={data.params || []}
          columns={['name', 'value']}
          onAdd={() => addRow('params', { name: '', value: '' })}
          onChange={(index, key, value) => patchRow('params', index, key, value)}
          onRemove={(index) => removeRow('params', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'change_template_params') {
    return (
      <FormGrid>
        <Field label="Product version ID" value={data.product_version_id} onChange={(v) => patch('product_version_id', v)} />
        <EditableRows
          title="Parameters"
          rows={data.params || []}
          columns={['name', 'value']}
          onAdd={() => addRow('params', { name: '', value: '' })}
          onChange={(index, key, value) => patchRow('params', index, key, value)}
          onRemove={(index) => removeRow('params', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'update_account_status') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <FieldWithSuggestions label="Account ID" fieldKey="upd_status_account_id" value={data.account_id} onChange={(v) => patch('account_id', v)} suggestions={accountIds} />
        <label>
          Status
          <select value={data.status || 'ACCOUNT_STATUS_PENDING_CLOSURE'} onChange={(e) => patch('status', e.target.value)}>
            <option value="ACCOUNT_STATUS_OPEN">ACCOUNT_STATUS_OPEN</option>
            <option value="ACCOUNT_STATUS_PENDING_CLOSURE">ACCOUNT_STATUS_PENDING_CLOSURE</option>
            <option value="ACCOUNT_STATUS_CLOSED">ACCOUNT_STATUS_CLOSED</option>
          </select>
        </label>
      </FormGrid>
    );
  }

  if (node.type === 'account_close') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <FieldWithSuggestions label="Account ID" fieldKey="close_account_id" value={data.account_id} onChange={(v) => patch('account_id', v)} suggestions={accountIds} />
      </FormGrid>
    );
  }

  if (node.type === 'update_account_version') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <FieldWithSuggestions label="Account ID" fieldKey="upd_account_id" value={data.account_id} onChange={(v) => patch('account_id', v)} suggestions={accountIds} />
        <Field label="Product version ID" value={data.product_version_id} onChange={(v) => patch('product_version_id', v)} />
      </FormGrid>
    );
  }

  if (node.type === 'flag_definition') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <Field label="Flag name" value={data.flag_name} onChange={(v) => patch('flag_name', v)} />
      </FormGrid>
    );
  }

  if (node.type === 'flag') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(v) => patch('timestamp', v)} />
        <Field label="Flag name" value={data.flag_name} onChange={(v) => patch('flag_name', v)} />
        <FieldWithSuggestions label="Account ID" fieldKey="flag_account_id" value={data.account_id} onChange={(v) => patch('account_id', v)} suggestions={accountIds} />
        <Field label="Expiry timestamp" value={data.expiry_timestamp} onChange={(v) => patch('expiry_timestamp', v)} />
      </FormGrid>
    );
  }

  return <Field label="Raw step" value={data.raw_text} onChange={(v) => patch('raw_text', v)} />;
}

function sortedRows(field, rows) {
  if (field !== 'rows') return rows;
  return [...rows].sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
}

function FormGrid({ children }) {
  return <div className="inspector-form">{children}</div>;
}

function Field({ label, value = '', onChange, type = 'text' }) {
  return (
    <label>
      {label}
      <input type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function FieldWithSuggestions({ label, fieldKey, value = '', onChange, suggestions = [] }) {
  const listId = suggestions.length > 0 ? `dl-${fieldKey}` : undefined;
  return (
    <label>
      {label}
      <input value={value || ''} onChange={(e) => onChange(e.target.value)} list={listId} />
      {listId && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </label>
  );
}

function EditableRows({ title, rows, columns, inputTypes = {}, suggestions = {}, onAdd, onChange, onBlur, onRemove }) {
  return (
    <div className="editable-rows">
      <div className="row-header">
        <strong>{title}</strong>
        <button type="button" onClick={onAdd}>Add row</button>
      </div>
      {rows.length > 0 && (
        <div className="node-table">
          <div className="node-table-row head" style={{ '--cols': columns.length }}>
            {columns.map((col) => <span key={col}>{col}</span>)}
            <span />
          </div>
          {rows.map((row, index) => (
            <div className="node-table-row" key={index} style={{ '--cols': columns.length }}>
              {columns.map((col) => {
                const listId = suggestions[col]?.length > 0 ? `dl-row-${col}` : undefined;
                return (
                  <span key={col} style={{ display: 'contents' }}>
                    <input
                      type={inputTypes[col] || 'text'}
                      value={row[col] || ''}
                      onChange={(e) => onChange(index, col, e.target.value)}
                      onBlur={onBlur}
                      list={listId}
                    />
                    {listId && (
                      <datalist id={listId}>
                        {suggestions[col].map((s) => <option key={s} value={s} />)}
                      </datalist>
                    )}
                  </span>
                );
              })}
              <button type="button" onClick={() => onRemove(index)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
