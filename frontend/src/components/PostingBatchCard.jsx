import { useState } from 'react';

import { addressColor } from '../utils/colors.js';
import { amount, tsShort } from '../utils/format.js';

/* ─────────────────────────────────────────────────
   PostingBatchCard
   Props:
     batch     – a PIB object from event.pibs[]
     eventId   – event index (for unique keys)
     batchIdx  – batch index (for unique keys)
     defaultExpanded – whether to open by default
   ───────────────────────────────────────────────── */
export function PostingBatchCard({ batch, eventId, batchIdx, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showRaw, setShowRaw] = useState(false);

  const instructions = batch.posting_instructions || [];
  const status = batch.status || '';
  const isAccepted = status.includes('ACCEPTED');
  const isRejected = status.includes('REJECTED');
  const statusLabel = status
    ? status.replace('POSTING_INSTRUCTION_BATCH_STATUS_', '')
    : 'BATCH';

  const totalPostings = instructions.reduce(
    (n, inst) => n + (inst.committed_postings || inst.custom_instruction?.postings || []).length,
    0,
  );

  return (
    <div className={`pib-card ${isRejected ? 'pib-rejected' : ''}`}>
      {/* ── Header ── */}
      <button
        type="button"
        className="pib-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="pib-toggle">{expanded ? '▼' : '▶'}</span>
        <span className={`pib-status-chip ${isAccepted ? 'chip-accepted' : isRejected ? 'chip-rejected' : 'chip-neutral'}`}>
          {statusLabel}
        </span>
        <span className="pib-id" title={batch.client_batch_id || batch.id || ''}>
          {batch.client_batch_id || batch.id || 'Batch'}
        </span>
        <span className="pib-meta">
          {instructions.length} instr · {totalPostings} posting{totalPostings !== 1 ? 's' : ''}
        </span>
      </button>

      {/* ── Body ── */}
      {expanded && (
        <div className="pib-body">
          {/* Raw JSON toggle */}
          <div className="pib-raw-toggle">
            <button
              type="button"
              className={`filter ${showRaw ? 'active' : ''}`}
              style={{ fontSize: '11px', padding: '3px 10px', minHeight: 26 }}
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? 'Show structured' : 'View raw JSON'}
            </button>
          </div>

          {showRaw ? (
            <pre className="pib-raw-json">{JSON.stringify(batch, null, 2)}</pre>
          ) : (
            instructions.map((inst, instIdx) => (
              <InstructionBlock
                key={`${eventId}-${batchIdx}-${instIdx}`}
                instruction={inst}
                instIdx={instIdx}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────
   InstructionBlock – one posting instruction
   ───────────────────────────────────────────────── */
function InstructionBlock({ instruction, instIdx }) {
  const details = instruction.instruction_details || {};
  const postings = instruction.committed_postings || instruction.custom_instruction?.postings || [];
  const violations = [
    ...(instruction.contract_violations || []),
    ...(instruction.posting_violations || []),
    ...(instruction.account_violations || []),
  ];

  const skipKeys = new Set(['event', 'description']);
  const extras = Object.entries(details).filter(([k]) => !skipKeys.has(k));

  return (
    <div className="pib-instruction">
      {/* Instruction meta bar */}
      {(instruction.client_transaction_id || details.event || details.description || extras.length > 0) && (
        <div className="pib-inst-meta">
          {instruction.client_transaction_id && (
            <span className="pib-inst-txid">TXN: {instruction.client_transaction_id}</span>
          )}
          {details.event && (
            <span className="pib-inst-event">{details.event}</span>
          )}
          {details.description && (
            <span className="pib-inst-desc">{details.description}</span>
          )}
          {extras.length > 0 && (
            <span className="pib-inst-extras">
              {extras.map(([k, v]) => (
                <span key={k} className="pib-kv">
                  <span className="pib-kv-key">{k}:</span>
                  <span className="pib-kv-val">{String(v)}</span>
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      {/* Violations */}
      {violations.length > 0 && (
        <div className="pib-violations">
          {violations.map((v, vi) => (
            <div key={vi} className="pib-violation">
              ⚠ {typeof v === 'string' ? v : JSON.stringify(v)}
            </div>
          ))}
        </div>
      )}

      {/* Postings table */}
      {postings.length > 0 && (
        <div className="pib-postings-table">
          <div className="pib-postings-head">
            <span>DR/CR</span>
            <span>Amount</span>
            <span>Account</span>
            <span>Address</span>
            <span>Denom / Asset</span>
          </div>
          {postings.map((posting, pi) => (
            <PostingRow key={pi} posting={posting} />
          ))}
        </div>
      )}

      {postings.length === 0 && violations.length === 0 && !details.event && !details.description && (
        <div className="pib-empty-inst">No posting data</div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────
   PostingRow – a single committed posting line
   ───────────────────────────────────────────────── */
function PostingRow({ posting }) {
  const isCredit = posting.credit === true;
  const isInternal = (posting.account_address || '').includes('INTERNAL_CONTRA');
  const addrColor = addressColor(posting.account_address || '');

  return (
    <div
      className={`pib-posting-row ${isCredit ? 'posting-credit' : 'posting-debit'}`}
      style={{ opacity: isInternal ? 0.5 : 1 }}
    >
      <span className={isCredit ? 'drcr-credit' : 'drcr-debit'}>
        {isCredit ? 'CR' : 'DR'}
      </span>
      <span className={`posting-amount ${isCredit ? 'amount-credit' : 'amount-debit'}`}>
        {amount(posting.amount)}
      </span>
      <span className="posting-account">{posting.account_id || '—'}</span>
      <span className="posting-address" style={{ color: addrColor }}>
        {posting.account_address || '—'}
      </span>
      <span className="posting-denom">
        {posting.denomination || '—'}
        {posting.asset ? <span className="posting-asset"> / {posting.asset.replace('COMMERCIAL_BANK_MONEY', 'CBM')}</span> : null}
      </span>
    </div>
  );
}
