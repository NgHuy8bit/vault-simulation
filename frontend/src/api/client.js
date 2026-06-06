const API_BASE = import.meta.env.VITE_API_BASE || '';

async function request(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.error || `Request failed: ${response.status}`);
  }
  return data;
}

export const api = {
  tree: () => request('/api/tree'),
  scenarioSummary: (responsePath) =>
    request(`/api/scenario-summary?response-path=${encodeURIComponent(responsePath)}`),
  findSpec: (responsePath) =>
    request(`/api/find-spec?response-path=${encodeURIComponent(responsePath)}`),
  parseSpec: (path) => request(`/api/parse-spec?path=${encodeURIComponent(path)}`),
  readSpec: (path) => request(`/api/spec?path=${encodeURIComponent(path)}`),
  saveSpec: (payload) =>
    request('/api/save-spec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
};
