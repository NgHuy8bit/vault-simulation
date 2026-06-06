import { useEffect, useMemo, useState } from 'react';

import { amount, tsShort } from '../utils/format.js';

export function Accounts({ summary, spec }) {
  const [account, setAccount] = useState(summary.accounts[0] || '');
  const accountBalances = summary.balances[account] || { monetary: [], params: [], all: [] };
  const denominations = [...new Set((accountBalances.all || []).map((item) => item.denomination).filter(Boolean))];
  const [denomination, setDenomination] = useState(denominations[0] || '');
  const denominationKey = denominations.join('\u0000');
  const monetary = (accountBalances.all || []).filter(
    (item) => item.asset === 'COMMERCIAL_BANK_MONEY' && (!denomination || item.denomination === denomination),
  );
  const specParams = useMemo(() => extractSpecParams(spec, account), [spec, account]);

  useEffect(() => {
    setAccount(summary.accounts[0] || '');
  }, [summary]);

  useEffect(() => {
    setDenomination((current) => (denominations.includes(current) ? current : denominations[0] || ''));
  }, [account, denominationKey]);

  return (
    <div className="tab-page">
      <div className="toolbar">
        <label>
          Account
          <select value={account} onChange={(event) => setAccount(event.target.value)}>
            {summary.accounts.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Denomination
          <select value={denomination} onChange={(event) => setDenomination(event.target.value)}>
            {denominations.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
      <section className="data-card">
        <div className="section-title">Latest balances</div>
        <div className="table">
          <div className="table-row head">
            <span>Address</span>
            <span>Amount</span>
            <span>Total debit</span>
            <span>Total credit</span>
            <span>Timestamp</span>
          </div>
          {monetary.map((item) => (
            <div className="table-row" key={`${item.address}-${item.asset}`}>
              <span>{item.address}</span>
              <span>{amount(item.amount)}</span>
              <span>{amount(item.total_debit)}</span>
              <span>{amount(item.total_credit)}</span>
              <span>{tsShort(item.timestamp)}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="data-card">
        <div className="section-title">Product configuration balances</div>
        <KeyValueTable rows={accountBalances.params || []} />
      </section>
      <section className="data-card">
        <div className="section-title">Spec instance params</div>
        <KeyValueTable rows={Object.entries(specParams).map(([name, value]) => ({ name, value }))} />
      </section>
    </div>
  );
}

function KeyValueTable({ rows }) {
  if (!rows.length) return <div className="muted">No rows.</div>;
  return (
    <div className="table key-values">
      {rows.map((row) => (
        <div className="table-row" key={row.name}>
          <span>{row.name}</span>
          <span>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function extractSpecParams(spec, accountId) {
  const params = {};
  if (!spec) return params;
  const sections = [{ steps: spec.setup_steps || [] }, ...(spec.scenarios || [])];
  for (const section of sections) {
    for (const step of section.steps || []) {
      if (step.type !== 'account' || step.data?.account_id !== accountId) continue;
      for (const row of step.data.params || []) params[row.name] = row.value;
    }
  }
  return params;
}
