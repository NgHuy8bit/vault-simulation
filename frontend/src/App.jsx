import { useEffect, useState } from 'react';

import { api } from './api/client.js';
import { Accounts } from './components/Accounts.jsx';
import { Diagram } from './components/Diagram.jsx';
import { Postings } from './components/Postings.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { SpecView } from './components/SpecView.jsx';
import { Timeline } from './components/Timeline.jsx';

const TABS = ['timeline', 'diagram', 'postings', 'accounts', 'spec'];

export function App() {
  const [tree, setTree] = useState(null);
  const [loadingTree, setLoadingTree] = useState(true);
  const [scenario, setScenario] = useState(null);
  const [summary, setSummary] = useState(null);
  const [spec, setSpec] = useState(null);
  const [activeTab, setActiveTab] = useState('timeline');
  const [loadingScenario, setLoadingScenario] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .tree()
      .then(setTree)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingTree(false));
  }, []);

  async function loadScenario(file) {
    setScenario(file);
    setSummary(null);
    setSpec(null);
    setError('');
    setLoadingScenario(true);
    try {
      const [scenarioSummary, specLookup] = await Promise.all([
        api.scenarioSummary(file.responsePath),
        api.findSpec(file.responsePath).catch(() => ({ found: false })),
      ]);
      setSummary(scenarioSummary);
      if (specLookup?.found) {
        const parsed = await api.parseSpec(specLookup.path);
        setSpec({ path: specLookup.path, content: specLookup.content, parsed });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingScenario(false);
    }
  }

  async function reloadSpec() {
    if (!scenario) return;
    const specLookup = await api.findSpec(scenario.responsePath);
    if (!specLookup?.found) {
      setSpec(null);
      return;
    }
    const parsed = await api.parseSpec(specLookup.path);
    setSpec({ path: specLookup.path, content: specLookup.content, parsed });
  }

  return (
    <div className="app-shell">
      <Sidebar tree={tree} loading={loadingTree} selectedPath={scenario?.responsePath} onSelect={loadScenario} />
      <main className="main-shell">
        <header className="topbar">
          <div>
            <div className="eyebrow">Vault Simulation Viewer</div>
            <div className="title">{scenario ? scenario.name.replaceAll('_', ' ') : 'Select a scenario'}</div>
          </div>
          <div className="badges">
            {summary && <span className="chip">{summary.events.length} events</span>}
            {summary && <span className="chip">{summary.accounts.length} accounts</span>}
            {spec && <span className="chip chip-ok">spec loaded</span>}
          </div>
        </header>

        {scenario && (
          <nav className="tabs">
            {TABS.map((tab) => (
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
          {!scenario && !error && <EmptyState />}
          {loadingScenario && <div className="notice">Loading scenario...</div>}
          {summary && activeTab === 'timeline' && <Timeline events={summary.events} />}
          {summary && activeTab === 'diagram' && <Diagram summary={summary} />}
          {summary && activeTab === 'postings' && <Postings events={summary.events} />}
          {summary && activeTab === 'accounts' && <Accounts summary={summary} spec={spec?.parsed} />}
          {scenario && activeTab === 'spec' && (
            <SpecView scenario={scenario} spec={spec} onReload={reloadSpec} onSpecSaved={reloadSpec} />
          )}
        </section>
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-title">No scenario selected</div>
      <div className="muted">Pick a response file from the sidebar.</div>
    </div>
  );
}
