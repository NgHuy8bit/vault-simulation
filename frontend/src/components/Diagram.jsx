import { useEffect, useMemo, useState } from 'react';

import { addressColor, eventColor } from '../utils/colors.js';
import { amount, tsShort } from '../utils/format.js';

const W = 1000;
const H = 360;
const ML = 90;
const MR = 20;
const MT = 24;
const MB = 48;

export function Diagram({ summary }) {
  const [account, setAccount] = useState(summary.accounts[0] || '');
  const accountHistory = summary.balance_history[account] || {};
  const denominations = Object.keys(accountHistory);
  const [denomination, setDenomination] = useState(denominations.includes('VND') ? 'VND' : denominations[0] || '');
  const denomHistory = accountHistory[denomination] || {};
  const addresses = Object.keys(denomHistory).sort();
  const [enabled, setEnabled] = useState(new Set(addresses.slice(0, Math.min(6, addresses.length))));
  const [zoom, setZoom] = useState(null);
  const denominationKey = denominations.join('\u0000');
  const addressKey = addresses.join('\u0000');

  useEffect(() => {
    setAccount(summary.accounts[0] || '');
    setZoom(null);
  }, [summary]);

  useEffect(() => {
    setDenomination((current) => {
      if (denominations.includes(current)) return current;
      return denominations.includes('VND') ? 'VND' : denominations[0] || '';
    });
    setZoom(null);
  }, [account, denominationKey]);

  useEffect(() => {
    setEnabled(new Set(addresses.slice(0, Math.min(6, addresses.length))));
    setZoom(null);
  }, [account, denomination, addressKey]);

  const series = useMemo(
    () =>
      addresses
        .filter((address) => enabled.has(address))
        .map((address) => ({
          label: address,
          color: addressColor(address),
          points: (denomHistory[address] || [])
            .map((point) => ({
              ms: new Date(point.timestamp).getTime(),
              timestamp: point.timestamp,
              amount: Number(point.amount),
              raw: point.amount,
            }))
            .filter((point) => !Number.isNaN(point.ms))
            .sort((a, b) => a.ms - b.ms),
        }))
        .filter((item) => item.points.length > 0),
    [addresses, denomHistory, enabled],
  );

  const markers = useMemo(
    () =>
      summary.events
        .filter(
          (event) =>
            event.timestamp &&
            (event.status === 'accepted' ||
              event.status === 'rejected' ||
              event.type === 'notification' ||
              event.type === 'accrual' ||
              event.has_postings),
        )
        .map((event) => ({
          id: event.id,
          ms: new Date(event.timestamp).getTime(),
          timestamp: event.timestamp,
          type: event.status === 'rejected' ? 'rejected' : event.type === 'notification' ? 'notification' : event.type === 'accrual' ? 'accrual' : 'accepted',
          summary: event.notification_type || event.summary || event.type,
        }))
        .filter((marker) => !Number.isNaN(marker.ms)),
    [summary.events],
  );

  const allTimes = [...series.flatMap((item) => item.points.map((point) => point.ms)), ...markers.map((marker) => marker.ms)];
  const fullMin = allTimes.length ? Math.min(...allTimes) : 0;
  const fullMax = allTimes.length ? Math.max(...allTimes) : 1;
  const tMin = zoom?.min ?? fullMin;
  const tMax = zoom?.max ?? fullMax;

  function toggleAddress(address) {
    const next = new Set(enabled);
    next.has(address) ? next.delete(address) : next.add(address);
    setEnabled(next);
  }

  function onWheel(event) {
    event.preventDefault();
    if (!allTimes.length) return;
    const range = tMax - tMin || 1;
    const nextRange = event.deltaY > 0 ? range * 1.4 : range / 1.4;
    if (nextRange < 3_600_000) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const center = tMin + range * ratio;
    let min = center - nextRange * ratio;
    let max = center + nextRange * (1 - ratio);
    if (min < fullMin) {
      min = fullMin;
      max = min + nextRange;
    }
    if (max > fullMax) {
      max = fullMax;
      min = max - nextRange;
    }
    setZoom({ min: Math.max(fullMin, min), max: Math.min(fullMax, max) });
  }

  return (
    <div className="diagram-tab">
      <div className="toolbar">
        <label>
          Account
          <select value={account} onChange={(event) => setAccount(event.target.value)}>
            {summary.accounts.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Denomination
          <select value={denomination} onChange={(event) => setDenomination(event.target.value)}>
            {denominations.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        {zoom && (
          <button className="filter active" onClick={() => setZoom(null)}>
            Reset zoom
          </button>
        )}
      </div>
      <div className="address-bar">
        {addresses.map((address) => (
          <button
            key={address}
            className={`address-toggle ${enabled.has(address) ? 'active' : ''}`}
            style={{ color: enabled.has(address) ? addressColor(address) : undefined }}
            onClick={() => toggleAddress(address)}
          >
            {address}
          </button>
        ))}
      </div>
      {series.length ? (
        <div className="chart-group" onWheel={onWheel}>
          <BalanceChart series={series} markers={markers} tMin={tMin} tMax={tMax} denomination={denomination} />
          <EventStrip markers={markers} tMin={tMin} tMax={tMax} />
        </div>
      ) : (
        <div className="notice">Select at least one address with balance history.</div>
      )}
    </div>
  );
}

function BalanceChart({ series, markers, tMin, tMax, denomination }) {
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  const allPoints = series.flatMap((item) => item.points);
  const values = allPoints.map((point) => point.amount).filter((value) => !Number.isNaN(value));
  const yMin = Math.min(0, ...values);
  const yMax = Math.max(1, ...values) * 1.08;
  const yRange = yMax - yMin || 1;
  const tRange = tMax - tMin || 1;
  const xOf = (ms) => ML + ((ms - tMin) / tRange) * pw;
  const yOf = (value) => MT + ph - ((value - yMin) / yRange) * ph;

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`}>
      <rect width={W} height={H} fill="#0a0f1a" />
      {[0, 1, 2, 3, 4, 5].map((index) => {
        const value = yMin + (yRange * index) / 5;
        const y = yOf(value);
        return (
          <g key={index}>
            <line x1={ML} y1={y} x2={W - MR} y2={y} stroke="#1e293b" strokeDasharray="4 6" />
            <text x={ML - 8} y={y + 4} textAnchor="end" fill="#64748b" fontSize="10">
              {amount(Math.round(value))}
            </text>
          </g>
        );
      })}
      <line x1={ML} y1={MT} x2={ML} y2={MT + ph} stroke="#334155" />
      <line x1={ML} y1={MT + ph} x2={W - MR} y2={MT + ph} stroke="#334155" />
      <g clipPath="url(#chartClip)">
        <defs>
          <clipPath id="chartClip">
            <rect x={ML} y={MT} width={pw} height={ph} />
          </clipPath>
        </defs>
        {markers.map((marker) => {
          const x = xOf(marker.ms);
          if (x < ML || x > W - MR) return null;
          return <line key={marker.id} x1={x} y1={MT} x2={x} y2={MT + ph} stroke={eventColor(marker.type)} opacity="0.35" />;
        })}
        {series.map((item) => (
          <path key={item.label} d={stepPath(item.points, xOf, yOf, tMax)} fill="none" stroke={item.color} strokeWidth="2" />
        ))}
        {series.flatMap((item) =>
          item.points.map((point) => {
            const x = xOf(point.ms);
            if (x < ML || x > W - MR) return null;
            return (
              <circle key={`${item.label}-${point.timestamp}`} cx={x} cy={yOf(point.amount)} r="3" fill={item.color}>
                <title>{`${item.label}\n${amount(point.raw)} ${denomination}\n${tsShort(point.timestamp)}`}</title>
              </circle>
            );
          }),
        )}
      </g>
      {series.map((item, index) => (
        <g key={item.label} transform={`translate(${ML + (index % 4) * 210}, ${H - 15 - Math.floor(index / 4) * 14})`}>
          <rect width="18" height="3" fill={item.color} />
          <text x="24" y="4" fill="#94a3b8" fontSize="10">
            {item.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function EventStrip({ markers, tMin, tMax }) {
  const width = 1000;
  const height = 56;
  const left = 10;
  const right = 10;
  const tRange = tMax - tMin || 1;
  const xOf = (ms) => left + ((ms - tMin) / tRange) * (width - left - right);

  return (
    <svg className="event-strip-svg" viewBox={`0 0 ${width} ${height}`}>
      <rect width={width} height={height} fill="#0a0f1a" />
      <line x1={left} y1={34} x2={width - right} y2={34} stroke="#1e293b" />
      {markers.map((marker) => {
        const x = xOf(marker.ms);
        if (x < left || x > width - right) return null;
        return (
          <g key={marker.id}>
            <line x1={x} y1={12} x2={x} y2={30} stroke={eventColor(marker.type)} strokeWidth="2" strokeLinecap="round" />
            <title>{`${tsShort(marker.timestamp)} · ${marker.type}\n${marker.summary}`}</title>
          </g>
        );
      })}
      {['accepted', 'rejected', 'notification', 'accrual'].map((kind, index) => (
        <g key={kind} transform={`translate(${620 + index * 85}, 12)`}>
          <line y1="0" y2="13" stroke={eventColor(kind)} strokeWidth="2" />
          <text x="7" y="10" fill="#64748b" fontSize="9">
            {kind}
          </text>
        </g>
      ))}
    </svg>
  );
}

function stepPath(points, xOf, yOf, tMax) {
  if (!points.length) return '';
  let path = '';
  let previous = null;
  for (const point of points) {
    const x = xOf(point.ms);
    const y = yOf(point.amount);
    path += path ? ` H${x.toFixed(1)} V${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`;
    previous = point;
  }
  return previous ? `${path} H${xOf(tMax).toFixed(1)}` : path;
}
