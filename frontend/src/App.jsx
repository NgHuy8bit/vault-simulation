import { useEffect, useState } from 'react';

import { api } from './api/client.js';
import { Accounts } from './components/Accounts.jsx';
import { Diagram } from './components/Diagram.jsx';
import { Postings } from './components/Postings.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { SpecView } from './components/SpecView.jsx';
import { Timeline } from './components/Timeline.jsx';

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

  useEffect(() => {
    api
      .tree()
      .then(setTree)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingTree(false));
  }, []);

  async function loadSelection(item) {
    setSelectedItem(item);
    setSummary(null);
    setSpec(null);
    setError('');
    setLoadingSelection(true);
    setActiveTab('spec');

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
  // For scenarios without a response, use specPath#lineNumber as a synthetic selection key
  const activePath = selectedItem?.responsePath
    ?? (selectedItem?.lineNumber != null
      ? `${selectedItem.specPath}#${selectedItem.lineNumber}`
      : selectedItem?.specPath);

  const title = selectedItem
    ? (selectedItem.name ?? '').replaceAll('_', ' ')
    : 'Select a scenario';

  return (
    <div className="app-shell">
      <Sidebar tree={tree} loading={loadingTree} selectedPath={activePath} onSelect={loadSelection} />
      <main className="main-shell">
        <header className="topbar">
          <div>
            <div className="eyebrow">Vault Simulation Viewer</div>
            <div className="title">{title}</div>
          </div>
          <div className="badges">
            {summary && <span className="chip">{summary.events.length} events</span>}
            {summary && <span className="chip">{summary.accounts.length} accounts</span>}
            {spec && !summary && <span className="chip chip-ok">spec only</span>}
            {spec && summary && <span className="chip chip-ok">spec + response</span>}
          </div>
        </header>

        {selectedItem && (
          <nav className="tabs">
            {tabs.map((tab) => (
              <button
                key={tab}
                className={`tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
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
