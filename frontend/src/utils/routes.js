const SCENARIO_PREFIX = '/scenario/';
const SPEC_PREFIX = '/spec/';

const VALID_TABS = new Set(['spec', 'timeline', 'diagram', 'postings', 'accounts']);

export function routeFromLocation(location = window.location) {
  const { pathname, search } = location;
  const params = new URLSearchParams(search);
  const tab = normalizeTab(params.get('tab'));

  if (pathname.startsWith(SCENARIO_PREFIX)) {
    const responsePath = decodeRoutePath(pathname.slice(SCENARIO_PREFIX.length));
    if (!responsePath) return null;
    return { type: 'scenario', responsePath, tab };
  }

  if (pathname.startsWith(SPEC_PREFIX)) {
    const specPath = decodeRoutePath(pathname.slice(SPEC_PREFIX.length));
    if (!specPath) return null;
    const line = params.get('line');
    const lineNumber = line ? Number(line) : null;
    return {
      type: 'spec',
      specPath,
      lineNumber: Number.isFinite(lineNumber) ? lineNumber : null,
      tab: 'spec',
    };
  }

  return null;
}

export function urlForSelection(item, tab = 'spec') {
  if (!item) return '/';

  const params = new URLSearchParams();
  const normalizedTab = item.responsePath ? normalizeTab(tab) : 'spec';
  params.set('tab', normalizedTab);

  if (item.responsePath) {
    return withSearch(`/scenario/${encodeRoutePath(item.responsePath)}`, params);
  }

  if (item.lineNumber != null) {
    params.set('line', String(item.lineNumber));
  }
  return withSearch(`/spec/${encodeRoutePath(item.specPath)}`, params);
}

export function findItemForRoute(tree, route) {
  if (!tree || !route) return null;
  const files = flattenFiles(tree);

  if (route.type === 'scenario') {
    for (const file of files) {
      const scenario = (file.scenarios || []).find((item) => item.responsePath === route.responsePath);
      if (scenario) return scenarioItem(file, scenario);
    }
    return null;
  }

  const file = files.find((item) => item.specPath === route.specPath);
  if (!file) return null;

  if (route.lineNumber != null) {
    const scenario = (file.scenarios || []).find((item) => Number(item.lineNumber) === route.lineNumber);
    if (scenario) return scenarioItem(file, scenario);
  }

  return { type: 'spec', ...file, name: file.name };
}

export function selectionKey(item) {
  if (!item) return null;
  if (item.responsePath) return item.responsePath;
  if (item.lineNumber != null) return `${item.specPath}#${item.lineNumber}`;
  return item.specPath;
}

export function normalizeTab(tab) {
  return VALID_TABS.has(tab) ? tab : 'spec';
}

function scenarioItem(file, scenario) {
  return {
    type: 'scenario',
    name: scenario.name,
    specPath: file.specPath,
    specName: file.name,
    lineNumber: scenario.lineNumber,
    responsePath: scenario.responsePath ?? null,
    requestPath: scenario.requestPath ?? null,
    hasResponse: scenario.hasResponse,
  };
}

function flattenFiles(node) {
  const files = [...(node.files || [])];
  for (const child of Object.values(node.dirs || {})) {
    files.push(...flattenFiles(child));
  }
  return files;
}

function encodeRoutePath(path) {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

function decodeRoutePath(path) {
  return String(path || '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
    .join('/');
}

function withSearch(pathname, params) {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
