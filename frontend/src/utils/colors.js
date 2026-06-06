const ADDRESS_COLORS = {
  PRINCIPAL: '#34d399',
  DEFAULT: '#94a3b8',
  DUE_PRINCIPAL: '#f59e0b',
  OVERDUE_PRINCIPAL: '#ef4444',
  ACCRUED_INTEREST_RECEIVABLE: '#818cf8',
  ACCRUAL_INTEREST: '#818cf8',
  DUE_INTEREST: '#fb923c',
  OVERDUE_INTEREST: '#f43f5e',
  INTERNAL_CONTRA: '#334155',
};

const PALETTE = ['#34d399', '#818cf8', '#f59e0b', '#fb923c', '#06b6d4', '#a78bfa', '#f472b6'];

export function addressColor(address) {
  if (ADDRESS_COLORS[address]) return ADDRESS_COLORS[address];
  let hash = 0;
  for (const char of String(address)) hash = (Math.imul(31, hash) + char.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function eventColor(kind) {
  return {
    accepted: '#22c55e',
    rejected: '#ef4444',
    notification: '#f59e0b',
    accrual: '#3b82f6',
    posting: '#22c55e',
    setup: '#64748b',
  }[kind] || '#94a3b8';
}
