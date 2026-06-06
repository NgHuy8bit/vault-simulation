import { useMemo, useState } from 'react';

import { tsShort } from '../utils/format.js';
import { eventColor } from '../utils/colors.js';
import { PostingBatchCard } from './PostingBatchCard.jsx';

export function Timeline({ events }) {
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
      return [event.timestamp, event.summary, event.notification_type, ...(event.logs || [])]
        .join(' ')
        .toLowerCase()
        .includes(text);
    });
  }, [events, filter, query]);

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
        <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events" />
        <div className="event-list">
          {filtered.map((event) => (
            <button
              key={event.id}
              className={`event-row ${selectedId === event.id ? 'active' : ''}`}
              onClick={() => setSelectedId(event.id)}
              style={{ borderLeftColor: eventColor(event.status === 'rejected' ? 'rejected' : event.type) }}
            >
              <span className="badge">{event.type}</span>
              <span className="muted">#{event.id + 1}</span>
              <span className="event-time">{tsShort(event.timestamp)}</span>
              <span className="event-summary">{event.summary}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="detail-panel">{selected ? <EventDetail event={selected} /> : <div className="muted">Select an event.</div>}</div>
    </div>
  );
}

function EventDetail({ event }) {
  return (
    <div className="stack">
      <section>
        <div className="section-title">Event #{event.id + 1}</div>
        <div>{tsShort(event.timestamp)}</div>
        <span className="badge">{event.status || event.type}</span>
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
