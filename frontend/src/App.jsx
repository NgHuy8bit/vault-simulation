import { useEffect, useState } from 'react';

import { api } from './api/client.js';
import { Accounts } from './components/Accounts.jsx';
import { Diagram } from './components/Diagram.jsx';
import { Postings } from './components/Postings.jsx';
import { SettingsPanel } from './components/SettingsPanel.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { SpecView } from './components/SpecView.jsx';
import { Timeline } from './components/Timeline.jsx';
import { findItemForRoute, normalizeTab, routeFromLocation, selectionKey, urlForSelection } from './utils/routes.js';

const SIM_TABS = ['spec', 'timeline', 'diagram', 'postings', 'accounts'];
const SPEC_ONLY_TABS = ['spec'];

export function App() {
  const [tree, setTree] = useState(null);
  const [loadingTree, setLoadingTree] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [summary, setSummary] = useState(null);
  const [spec, setSpec] = useState(null);
  const [activeTab, setActiveTab] = useState('spec');
  const [loadingSelection, setLoadingSelection] = useState(false);
  const [error, setError] = useState('');
  const [routeVersion, setRouteVersion] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);

  useEffect(() => {
    api
      .tree()
      .then(setTree)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingTree(false));
  }, []);

  useEffect(() => {
    function handlePopState() {
      setRouteVersion((value) => value + 1);
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!tree) return;

    const route = routeFromLocation();
    if (!route) {
      setSelectedItem(null);
      setSummary(null);
      setSpec(null);
      setActiveTab('spec');
      setError('');
      return;
    }

    const item = findItemForRoute(tree, route);
    if (!item) {
      setSelectedItem(null);
      setSummary(null);
      setSpec(null);
      setActiveTab('spec');
      setError(`Cannot find selection from URL: ${window.location.pathname}`);
      return;
    }

    loadSelection(item, { updateRoute: false, tab: route.tab });
  }, [tree, routeVersion]);

  async function loadSelection(item, options = {}) {
    const tab = item.responsePath ? normalizeTab(options.tab) : 'spec';
    setSelectedItem(item);
    setSummary(null);
    setSpec(null);
    setError('');
    setLoadingSelection(true);
    setActiveTab(tab);

    if (options.updateRoute !== false) {
      window.history.pushState({}, '', urlForSelection(item, tab));
    }

    try {
      const specPath = item.specPath;

      if (item.responsePath) {
        // Scenario with simulation response
        const [scenarioSummary, parsedSpec, specRes] = await Promise.all([
          api.scenarioSummary(item.responsePath),
          api.parseSpec(specPath).catch(() => null),
          api.readSpec(specPath).catch(() => null),
        ]);
        setSummary(scenarioSummary);
        if (parsedSpec && specRes) {
          setSpec({ path: specPath, content: specRes.content, parsed: parsedSpec });
        }
      } else {
        // Spec file or scenario without response — spec only
        const [parsedSpec, specRes] = await Promise.all([
          api.parseSpec(specPath),
          api.readSpec(specPath),
        ]);
        setSpec({ path: specPath, content: specRes.content, parsed: parsedSpec });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingSelection(false);
    }
  }

  function handleSelect(item) {
    loadSelection(item, { updateRoute: true, tab: 'spec' });
  }

  function handleTabChange(tab) {
    const nextTab = normalizeTab(tab);
    setActiveTab(nextTab);
    if (selectedItem) {
      window.history.replaceState({}, '', urlForSelection(selectedItem, nextTab));
    }
  }

  async function reloadSpec() {
    if (!selectedItem) return;
    try {
      const [parsedSpec, specRes] = await Promise.all([
        api.parseSpec(selectedItem.specPath),
        api.readSpec(selectedItem.specPath),
      ]);
      setSpec({ path: selectedItem.specPath, content: specRes.content, parsed: parsedSpec });
    } catch (_) {
      // ignore
    }
  }

  const hasSimData = Boolean(summary);
  const tabs = hasSimData ? SIM_TABS : SPEC_ONLY_TABS;
  const activePath = selectionKey(selectedItem);

  const title = selectedItem
    ? (selectedItem.name ?? '').replaceAll('_', ' ')
    : 'Select a scenario';

  return (
    <div className={`app-shell${sidebarHidden ? ' sidebar-hidden' : ''}`}>
      {!sidebarHidden && (
        <Sidebar tree={tree} loading={loadingTree} selectedPath={activePath} onSelect={handleSelect} />
      )}
      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="sidebar-toggle-btn"
              title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
              onClick={() => setSidebarHidden((v) => !v)}
            >
              {sidebarHidden ? '▶' : '◀'}
            </button>
            <div>
              <div className="eyebrow">Vault Simulation Viewer</div>
              <div className="title">{title}</div>
            </div>
          </div>
          <div className="badges">
            {summary && <span className="chip">{summary.events.length} events</span>}
            {summary && <span className="chip">{summary.accounts.length} accounts</span>}
            {spec && !summary && <span className="chip chip-ok">spec only</span>}
            {spec && summary && <span className="chip chip-ok">spec + response</span>}
            <button
              className="settings-gear-btn"
              title="Settings"
              onClick={() => setShowSettings(true)}
            >
              ⚙
            </button>
          </div>
        </header>
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

        {selectedItem && (
          <nav className="tabs">
            {tabs.map((tab) => (
              <button
                key={tab}
                className={`tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => handleTabChange(tab)}
              >
                {tab}
              </button>
            ))}
          </nav>
        )}

        <section className="content">
          {error && <div className="notice error">{error}</div>}
          {!selectedItem && !error && <EmptyState />}
          {loadingSelection && <div className="notice">Loading...</div>}
          {activeTab === 'spec' && selectedItem && (
            <SpecView
              scenario={selectedItem}
              spec={spec}
              summary={summary}
              onReload={reloadSpec}
              onSpecSaved={reloadSpec}
            />
          )}
          {hasSimData && activeTab === 'timeline' && <Timeline events={summary.events} spec={spec?.parsed} />}
          {hasSimData && activeTab === 'diagram' && <Diagram summary={summary} />}
          {hasSimData && activeTab === 'postings' && <Postings events={summary.events} spec={spec?.parsed} />}
          {hasSimData && activeTab === 'accounts' && <Accounts summary={summary} />}
        </section>
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-title">No scenario selected</div>
      <div className="muted">Pick a spec file or scenario from the sidebar.</div>
    </div>
  );
}
