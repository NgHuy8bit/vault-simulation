import { useMemo, useState } from 'react';

import { tsShort } from '../utils/format.js';
import { getScenarioDividers } from '../utils/scenario.js';
import { PostingBatchCard } from './PostingBatchCard.jsx';

export function Postings({ events, spec }) {
  const [query, setQuery] = useState('');

  const batches = useMemo(() => {
    const items = [];
    for (const event of events) {
      for (let bi = 0; bi < (event.pibs || []).length; bi++) {
        items.push({ event, batch: event.pibs[bi], batchIdx: bi });
      }
    }
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(({ event, batch }) => {
      const bid = (batch.client_batch_id || batch.id || '').toLowerCase();
      if (bid.includes(needle)) return true;
      if ((event.timestamp || '').toLowerCase().includes(needle)) return true;
      return (batch.posting_instructions || []).some((inst) =>
        (inst.committed_postings || inst.custom_instruction?.postings || []).some(
          (p) =>
            (p.account_id || '').toLowerCase().includes(needle) ||
            (p.account_address || '').toLowerCase().includes(needle) ||
            (p.denomination || '').toLowerCase().includes(needle),
        ),
      );
    });
  }, [events, query]);

  const dividers = useMemo(() => getScenarioDividers(events, spec), [events, spec]);
  const eventCount = new Set(batches.map((b) => b.event.id)).size;

  let currentScenario = null;

  return (
    <div className="tab-page">
      <div className="toolbar">
        <input
          className="search wide"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search account, address, batch id, timestamp…"
        />
        <span className="muted">
          {batches.length} batch{batches.length !== 1 ? 'es' : ''} across {eventCount} event{eventCount !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="postings-list">
        {batches.length === 0 && (
          <div className="notice muted">No posting batches found.</div>
        )}
        {batches.map(({ event, batch, batchIdx }) => {
          let divider = null;
          if (dividers.has(event.id) && dividers.get(event.id) !== currentScenario) {
            currentScenario = dividers.get(event.id);
            divider = (
              <div className="scenario-divider" key={`scen-${event.id}`}>
                <span>{currentScenario}</span>
              </div>
            );
          }

          return (
            <div key={`${event.id}-${batchIdx}`}>
              {divider}
              <div className="postings-group">
                <div className="postings-group-label">
                  Event #{event.id + 1} — {tsShort(event.timestamp)}
                </div>
                <PostingBatchCard
                  batch={batch}
                  eventId={event.id}
                  batchIdx={batchIdx}
                  defaultExpanded={false}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
