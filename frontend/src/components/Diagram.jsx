import { useEffect, useMemo, useRef, useState } from 'react';

import { addressColor, eventColor } from '../utils/colors.js';
import { amount, tsShort } from '../utils/format.js';

const W = 1320;
const H = 500;
const ML = 50;
const MR = 14;
const MT = 28;
const MB = 38;

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
      <div className="toolbar diagram-toolbar">
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
        <span className="diagram-count-hint">
          {enabled.size}/{addresses.length} addresses · wheel to zoom
        </span>
      </div>
      <div className="address-bar diagram-address-bar">
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
        <div className="chart-card">
          <div className="chart-card-header">
            <div>
              <div className="section-title">Balance trend</div>
              <div className="chart-title">{account} · {denomination}</div>
            </div>
            <div className="chart-meta">
              <span>{series.length} visible series</span>
              <span>{markers.length} events</span>
            </div>
          </div>
          <div className="chart-group" onWheel={onWheel}>
            <BalanceChart series={series} markers={markers} tMin={tMin} tMax={tMax} denomination={denomination} />
            <EventStrip markers={markers} tMin={tMin} tMax={tMax} />
          </div>
          <div className="chart-legend">
            {series.map((item) => {
              const latest = item.points[item.points.length - 1];
              return (
                <span key={item.label} className="legend-item">
                  <span className="legend-swatch" style={{ background: item.color }} />
                  <span className="legend-label" style={{ color: item.color }}>{item.label}</span>
                  {latest && <span className="legend-value">{amount(latest.raw)} {denomination}</span>}
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="notice">Select at least one address with balance history.</div>
      )}
    </div>
  );
}

function BalanceChart({ series, markers, tMin, tMax, denomination }) {
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);

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
  const visibleMarkers = markers.filter((marker) => marker.ms >= tMin && marker.ms <= tMax);

  function getStepValueAt(points, ms) {
    let result = null;
    for (const p of points) {
      if (p.ms <= ms) result = p;
      else break;
    }
    return result;
  }

  function onMouseMove(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = Math.max(ML, Math.min(W - MR, ((e.clientX - rect.left) / rect.width) * W));
    const ms = tMin + ((svgX - ML) / pw) * tRange;
    const tooltipWidth = 320;
    const tooltipHeight = 180;
    const viewportWidth = window.innerWidth || tooltipWidth + 24;
    const viewportHeight = window.innerHeight || tooltipHeight + 24;
    const preferLeft = e.clientX > viewportWidth - tooltipWidth - 36;
    const rawLeft = preferLeft ? e.clientX - tooltipWidth - 14 : e.clientX + 14;
    const left = Math.max(12, Math.min(rawLeft, viewportWidth - tooltipWidth - 12));
    const top = Math.max(72, Math.min(e.clientY - 18, viewportHeight - tooltipHeight - 12));
    setHover({ svgX, ms, left, top });
  }

  const hoverRows = hover
    ? series.map((item) => ({ label: item.label, color: item.color, point: getStepValueAt(item.points, hover.ms) })).filter((r) => r.point)
    : [];
  const gridTicks = Array.from({ length: 5 }, (_, index) => index);

  return (
    <div className="balance-chart-wrap">
      <svg
        ref={svgRef}
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id="balanceChartClip">
            <rect x={ML} y={MT} width={pw} height={ph} />
          </clipPath>
          <linearGradient id="chartSurface" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#091422" />
            <stop offset="100%" stopColor="#040a13" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#chartSurface)" />
        {gridTicks.map((index) => {
          const value = yMin + (yRange * index) / (gridTicks.length - 1);
          const y = yOf(value);
          return (
            <g key={index}>
              <line x1={ML} y1={y} x2={W - MR} y2={y} className="chart-grid-line" />
              <text x={ML - 8} y={y + 4} textAnchor="end" className="chart-axis-label">
                {amount(Math.round(value))}
              </text>
            </g>
          );
        })}
        <line x1={ML} y1={MT} x2={ML} y2={MT + ph} className="chart-axis-line" />
        <line x1={ML} y1={MT + ph} x2={W - MR} y2={MT + ph} className="chart-axis-line" />
        <g clipPath="url(#balanceChartClip)">
          {visibleMarkers.map((marker) => {
            const x = xOf(marker.ms);
            return (
              <line
                key={`${marker.id}-${marker.ms}`}
                x1={x}
                y1={MT + ph - 14}
                x2={x}
                y2={MT + ph}
                stroke={eventColor(marker.type)}
                className="chart-event-tick"
              />
            );
          })}
          {series.map((item) => (
            <path key={item.label} d={stepPath(item.points, xOf, yOf, tMax)} fill="none" stroke={item.color} className="chart-series-line" />
          ))}
          {series.flatMap((item) =>
            item.points.map((point) => {
              const x = xOf(point.ms);
              if (x < ML || x > W - MR) return null;
              return (
                <circle key={`${item.label}-${point.timestamp}`} cx={x} cy={yOf(point.amount)} r="3.2" fill={item.color} className="chart-point" />
              );
            }),
          )}
          {hover && (
            <line x1={hover.svgX} y1={MT} x2={hover.svgX} y2={MT + ph} className="chart-hover-line" pointerEvents="none" />
          )}
          {hover &&
            hoverRows.map((row) => {
              const y = yOf(row.point.amount);
              return <circle key={row.label} cx={hover.svgX} cy={y} r="5" fill={row.color} className="chart-hover-point" pointerEvents="none" />;
            })}
        </g>
      </svg>
      {hover && hoverRows.length > 0 && (
        <div
          className="chart-tooltip"
          style={{ position: 'fixed', left: hover.left, top: hover.top, pointerEvents: 'none' }}
        >
          <div className="chart-tooltip-time">{new Date(hover.ms).toISOString().replace('T', ' ').slice(0, 19)} UTC</div>
          {hoverRows.map((row) => (
            <div key={row.label} className="chart-tooltip-row">
              <span className="chart-tooltip-swatch" style={{ background: row.color }} />
              <span className="chart-tooltip-label">{row.label}</span>
              <span className="chart-tooltip-value">{amount(row.point.raw)} {denomination}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventStrip({ markers, tMin, tMax }) {
  const height = 72;
  const tRange = tMax - tMin || 1;
  // x-coordinates match BalanceChart exactly (same ML, MR, W)
  const xOf = (ms) => ML + ((ms - tMin) / tRange) * (W - ML - MR);

  const N_TICKS = 5;
  const ticks = Array.from({ length: N_TICKS }, (_, i) => {
    const ms = tMin + (tMax - tMin) * (i / (N_TICKS - 1));
    return { ms, x: xOf(ms), i };
  });

  function fmtTick(ms) {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }

  return (
    <svg className="event-strip-svg" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
      <rect width={W} height={height} fill="#050b15" />
      {/* Baseline */}
      <line x1={ML} y1={32} x2={W - MR} y2={32} className="event-strip-baseline" />
      {/* Event tick marks */}
      {markers.map((marker) => {
        const x = xOf(marker.ms);
        if (x < ML - 2 || x > W - MR + 2) return null;
        return (
          <g key={`${marker.id ?? marker.summary}-${marker.ms}-${marker.type}`}>
            <line x1={x} y1={8} x2={x} y2={27} stroke={eventColor(marker.type)} className="event-strip-tick" />
            <title>{`${tsShort(marker.timestamp)} · ${marker.type}\n${marker.summary}`}</title>
          </g>
        );
      })}
      {/* Time axis tick marks */}
      {ticks.map(({ ms, x, i }) => (
        <g key={ms}>
          <line x1={x} y1={32} x2={x} y2={38} className="event-axis-tick" />
          <text
            x={x}
            y={50}
            textAnchor={i === 0 ? 'start' : i === N_TICKS - 1 ? 'end' : 'middle'}
            className="event-axis-label"
          >
            {fmtTick(ms)}
          </text>
        </g>
      ))}
      {/* Color key row — positioned below tick labels */}
      {['accepted', 'rejected', 'notification', 'accrual'].map((kind, index) => (
        <g key={kind} transform={`translate(${ML + index * 94}, 63)`}>
          <rect width={8} height={4} rx={1} fill={eventColor(kind)} />
          <text x={12} y={4} className="event-key-label">
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
