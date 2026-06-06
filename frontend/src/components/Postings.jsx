import { useMemo, useState } from 'react';

import { tsShort } from '../utils/format.js';
import { PostingBatchCard } from './PostingBatchCard.jsx';

export function Postings({ events }) {
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

  const eventCount = new Set(batches.map((b) => b.event.id)).size;

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
        {batches.map(({ event, batch, batchIdx }) => (
          <div key={`${event.id}-${batchIdx}`} className="postings-group">
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
        ))}
      </div>
    </div>
  );
}
