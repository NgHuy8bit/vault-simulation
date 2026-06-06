export function tsShort(timestamp) {
  if (!timestamp) return '-';
  return timestamp.replace('T', ' ').replace(/\.\d+/, '').replace('Z', ' UTC');
}

export function amount(value) {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return numeric.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
