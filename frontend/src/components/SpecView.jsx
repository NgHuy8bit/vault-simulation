import { useState } from 'react';

import { slug } from '../utils/format.js';
import { SpecNodeEditor } from './SpecNodeEditor.jsx';

export function SpecView({ scenario, spec, onReload, onSpecSaved }) {
  const [mode, setMode] = useState('visual');
  const [editing, setEditing] = useState(false);

  if (!spec) {
    return (
      <div className="tab-page">
        <div className="notice">No matching spec found for {scenario.name}.</div>
      </div>
    );
  }

  if (editing) {
    return (
      <SpecNodeEditor
        spec={spec}
        onCancel={() => setEditing(false)}
        onSaved={async () => {
          await onSpecSaved();
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="tab-page spec-page">
      <div className="toolbar">
        <span className="muted">{spec.path}</span>
        <div className="spacer" />
        <button className={`filter ${mode === 'visual' ? 'active' : ''}`} onClick={() => setMode('visual')}>
          Visual
        </button>
        <button className={`filter ${mode === 'source' ? 'active' : ''}`} onClick={() => setMode('source')}>
          Source
        </button>
        <button className="filter" onClick={onReload}>
          Reload
        </button>
        <button className="primary" onClick={() => setEditing(true)}>
          Edit spec
        </button>
      </div>
      {mode === 'source' ? <pre className="source-box">{spec.content}</pre> : <SpecVisual parsed={spec.parsed} scenario={scenario} />}
    </div>
  );
}

function SpecVisual({ parsed, scenario }) {
  const activeSlug = slug(scenario.name.replaceAll('_', ' '));
  const sections = [];
  if (parsed.setup_steps?.length) sections.push({ name: 'Setup', slug: 'setup', steps: parsed.setup_steps });
  for (const item of parsed.scenarios || []) sections.push({ ...item, slug: slug(item.name) });

  return (
    <div className="spec-visual">
      <h2>{parsed.title}</h2>
      {sections.map((section) => (
        <section className={`spec-section ${section.slug === activeSlug ? 'active' : ''}`} key={section.slug}>
          <header>
            <strong>{section.name}</strong>
            <span className="muted">{section.steps?.length || 0} steps</span>
          </header>
          <div className="spec-step-stack">
            {(section.steps || []).map((step, index) => (
              <div className="spec-step-card" key={`${step.type}-${index}`}>
                <span className={`node-type type-${step.type}`}>{step.type}</span>
                <span>{stepSummary(step)}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function stepSummary(step) {
  const data = step.data || {};
  if (step.type === 'config') return `${data.key}: ${data.value}`;
  if (step.type === 'product') return `${data.name} v${data.version_id}`;
  if (step.type === 'account') return `${data.account_id} v${data.version_id}`;
  if (step.type === 'balance_check') return `${data.rows?.length || 0} balance rows`;
  if (step.type === 'inbound' || step.type === 'outbound') return `${data.amount} ${data.denomination}`;
  if (step.type === 'rejected') return `${data.account_id} ${data.reason_code}`;
  if (step.type === 'notification') return `${data.account_id} ${data.notification_type}`;
  return step.raw || 'Step';
}
