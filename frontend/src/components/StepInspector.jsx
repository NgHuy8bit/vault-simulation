import { clone } from '../utils/format.js';

export function StepInspector({ node, onChange }) {
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
    patch(
      field,
      (data[field] || []).filter((_, rowIndex) => rowIndex !== index),
    );
  }

  if (node.type === 'scenario') {
    return (
      <FormGrid>
        <Field label="Scenario name" value={data.name} onChange={(value) => patch('name', value)} />
        <Field label="Tags" value={data.tags} onChange={(value) => patch('tags', value)} />
      </FormGrid>
    );
  }

  if (node.type === 'config') {
    return (
      <FormGrid>
        <label>
          Type
          <select value={data.key || 'timezone'} onChange={(event) => patch('key', event.target.value)}>
            <option value="timezone">Time Zone</option>
            <option value="start_timestamp">Start Timestamp</option>
            <option value="end_timestamp">End Timestamp</option>
            <option value="global_param">Global Param / Setup</option>
          </select>
        </label>
        <Field label="Value" value={data.value} onChange={(value) => patch('value', value)} />
      </FormGrid>
    );
  }

  if (node.type === 'product') {
    return (
      <FormGrid>
        <Field label="Product name" value={data.name} onChange={(value) => patch('name', value)} />
        <Field label="Version ID" value={data.version_id} onChange={(value) => patch('version_id', value)} />
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
        <Field label="Account ID" value={data.account_id} onChange={(value) => patch('account_id', value)} />
        <Field label="Product version ID" value={data.version_id} onChange={(value) => patch('version_id', value)} />
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
        <Field label="Denomination" value={data.denomination} onChange={(value) => patch('denomination', value)} />
        <EditableRows
          title="Balance rows"
          rows={data.rows || []}
          columns={['timestamp', 'account_id', 'address', 'balance']}
          inputTypes={{ timestamp: 'datetime-local', balance: 'number' }}
          onAdd={() => addRow('rows', { timestamp: '', account_id: '', address: '', balance: '0' })}
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
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(value) => patch('timestamp', value)} />
        <Field label="Amount" type="number" value={data.amount} onChange={(value) => patch('amount', value)} />
        <Field label="Denomination" value={data.denomination} onChange={(value) => patch('denomination', value)} />
        <Field label="From account ID" value={data.from_account} onChange={(value) => patch('from_account', value)} />
        <Field label="To account ID" value={data.to_account} onChange={(value) => patch('to_account', value)} />
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

  if (node.type === 'accepted') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(value) => patch('timestamp', value)} />
        <Field label="Account ID" value={data.account_id} onChange={(value) => patch('account_id', value)} />
      </FormGrid>
    );
  }

  if (node.type === 'rejected') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(value) => patch('timestamp', value)} />
        <Field label="Account ID" value={data.account_id} onChange={(value) => patch('account_id', value)} />
        <label>
          Reason code
          <select value={data.reason_code || 'InsufficientFunds'} onChange={(event) => patch('reason_code', event.target.value)}>
            <option value="AgainstTermsAndConditions">AgainstTermsAndConditions</option>
            <option value="InsufficientFunds">InsufficientFunds</option>
            <option value="Unknown">Unknown</option>
            <option value="Other">Other</option>
          </select>
        </label>
        <Field label="Reason text" value={data.reason_text} onChange={(value) => patch('reason_text', value)} />
        <Field label="Contract violation code" value={data.contract_violation_code} onChange={(value) => patch('contract_violation_code', value)} />
        <EditableRows
          title="Violation details"
          rows={data.details || []}
          columns={['key', 'value']}
          onAdd={() => addRow('details', { key: '', value: '' })}
          onChange={(index, key, value) => patchRow('details', index, key, value)}
          onRemove={(index) => removeRow('details', index)}
        />
      </FormGrid>
    );
  }

  if (node.type === 'notification') {
    return (
      <FormGrid>
        <Field label="Timestamp" type="datetime-local" value={data.timestamp} onChange={(value) => patch('timestamp', value)} />
        <Field label="Account ID" value={data.account_id} onChange={(value) => patch('account_id', value)} />
        <Field label="Notification type" value={data.notification_type} onChange={(value) => patch('notification_type', value)} />
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

  return <Field label="Raw step" value={data.raw_text} onChange={(value) => patch('raw_text', value)} />;
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
      <input type={type} value={value || ''} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function EditableRows({ title, rows, columns, inputTypes = {}, onAdd, onChange, onBlur, onRemove }) {
  return (
    <div className="editable-rows">
      <div className="row-header">
        <strong>{title}</strong>
        <button type="button" onClick={onAdd}>
          Add row
        </button>
      </div>
      {rows.length > 0 && (
        <div className="node-table">
          <div className="node-table-row head" style={{ '--cols': columns.length }}>
            {columns.map((column) => (
              <span key={column}>{column}</span>
            ))}
            <span />
          </div>
          {rows.map((row, index) => (
            <div className="node-table-row" key={index} style={{ '--cols': columns.length }}>
              {columns.map((column) => (
                <input
                  key={column}
                  type={inputTypes[column] || 'text'}
                  value={row[column] || ''}
                  onChange={(event) => onChange(index, column, event.target.value)}
                  onBlur={onBlur}
                />
              ))}
              <button type="button" onClick={() => onRemove(index)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
