const API_BASE = import.meta.env.VITE_API_BASE || '';

async function request(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.error || `Request failed: ${response.status}`);
  }
  return data;
}

async function* streamRunSpec(path, lineNumber = null) {
  const response = await fetch(`${API_BASE}/api/run-spec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec_path: path, line_number: lineNumber }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Request failed: ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop();
    for (const part of parts) {
      if (part.startsWith('data: ')) {
        yield JSON.parse(part.slice(6));
      }
    }
  }
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
  runSpec: streamRunSpec,

  // Settings
  getSettings: () => request('/api/settings'),
  saveSettings: (payload) =>
    request('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  resetSettings: () => request('/api/settings', { method: 'DELETE' }),
  listContainers: () => request('/api/containers'),
};
