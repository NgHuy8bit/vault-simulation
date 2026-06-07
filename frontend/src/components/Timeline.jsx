import { useMemo, useState } from 'react';

import { eventColor } from '../utils/colors.js';
import { tsShort } from '../utils/format.js';
import { getScenarioDividers } from '../utils/scenario.js';
import { PostingBatchCard } from './PostingBatchCard.jsx';

export function Timeline({ events, spec }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(events[0]?.id ?? null);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return events.filter((event) => {
      if (filter === 'postings' && !event.has_postings) return false;
      if (filter === 'rejected' && event.status !== 'rejected') return false;
      if (filter === 'notification' && event.type !== 'notification') return false;
      if (filter === 'accrual' && event.type !== 'accrual') return false;
      if (!text) return true;
      const searchable = [
        event.timestamp,
        event.summary,
        event.notification_type,
        ...(event.logs || []),
        ...(event.pibs || []).map((b) => b.client_batch_id || b.id || ''),
      ];
      return searchable.join(' ').toLowerCase().includes(text);
    });
  }, [events, filter, query]);

  const dividers = useMemo(() => getScenarioDividers(events, spec), [events, spec]);

  const selected = events.find((event) => event.id === selectedId);

  return (
    <div className="split-view">
      <div className="list-panel">
        <div className="toolbar">
          {['all', 'postings', 'accrual', 'notification', 'rejected'].map((item) => (
            <button key={item} className={`filter ${filter === item ? 'active' : ''}`} onClick={() => setFilter(item)}>
              {item}
            </button>
          ))}
        </div>
        <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events or batch codes" />
        <div className="event-list">
          {filtered.map((event) => (
            <div key={event.id}>
              {dividers.has(event.id) && (
                <div className="scenario-divider">
                  <span>{dividers.get(event.id)}</span>
                </div>
              )}
              <button
                className={`event-row ${selectedId === event.id ? 'active' : ''}`}
                onClick={() => setSelectedId(event.id)}
                style={{ borderLeftColor: eventColor(event.status === 'rejected' ? 'rejected' : event.type) }}
              >
                <span className="event-dot" style={{ background: eventColor(event.status === 'rejected' ? 'rejected' : event.type) }} />
                <span className="event-num">#{event.id + 1}</span>
                <span className="event-time">{tsShort(event.timestamp)}</span>
                <span className="event-summary">{event.summary || event.type}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="detail-panel">{selected ? <EventDetail event={selected} /> : <div className="muted">Select an event.</div>}</div>
    </div>
  );
}

function EventDetail({ event }) {
  const statusColor = event.status === 'rejected' ? '#ef4444' : event.status === 'accepted' ? '#22c55e' : eventColor(event.type);
  return (
    <div className="stack">
      <section className="event-detail-header">
        <div className="event-detail-title">
          <span className="event-detail-num">Event #{event.id + 1}</span>
          <span className="event-detail-ts">{tsShort(event.timestamp)}</span>
        </div>
        <span className="event-detail-status" style={{ color: statusColor, borderColor: statusColor + '44', background: statusColor + '11' }}>
          {event.status || event.type}
        </span>
      </section>
      {event.logs?.length > 0 && (
        <section>
          <div className="section-title">Logs</div>
          {event.logs.map((log, index) => (
            <div className="log-line" key={`${log}-${index}`}>
              {log}
            </div>
          ))}
        </section>
      )}
      {event.notifications?.length > 0 && (
        <section>
          <div className="section-title">Notifications</div>
          <div className="notification-cards">
            {event.notifications.map((notif, ni) => (
              <div key={ni} className="notification-card">
                <div className="notification-type">{notif.notification_type || 'Notification'}</div>
                {notif.account_id && (
                  <div className="notification-row">
                    <span className="notif-label">Account</span>
                    <span className="notif-value">{notif.account_id}</span>
                  </div>
                )}
                {notif.notification_details && Object.keys(notif.notification_details).length > 0 && (
                  <div className="notification-details">
                    {Object.entries(notif.notification_details).map(([k, v]) => (
                      <div key={k} className="notification-row">
                        <span className="notif-label">{k}</span>
                        <span className="notif-value">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {event.pibs?.length > 0 && (
        <section>
          <div className="section-title">Posting batches</div>
          <div className="pib-list">
            {event.pibs.map((batch, bi) => (
              <PostingBatchCard
                key={`${event.id}-${bi}`}
                batch={batch}
                eventId={event.id}
                batchIdx={bi}
                defaultExpanded={event.pibs.length === 1}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
