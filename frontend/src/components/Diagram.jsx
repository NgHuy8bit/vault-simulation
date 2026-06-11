import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { LineChart } from '@mui/x-charts/LineChart';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import { addressColor, eventColor } from '../utils/colors.js';
import { amount, tsShort } from '../utils/format.js';

// Left/right offsets of the chart drawing area, in px. The MUI chart uses
// margin.left(0) + yAxis.width(50) on the left and margin.right(14) on the
// right; EventStrip mirrors the same values so event ticks line up exactly.
const AXIS_LEFT = 56;
const AXIS_RIGHT = 14;
const CHART_HEIGHT = 480;
// Above this many real data points, hide per-point marks — the step line
// already shows every change. Marks only help when zoomed into few points.
const MAX_POINT_MARKS = 150;

// 1_008_220 → "1M", 850_000 → "850K" — keeps y-axis labels short.
function compactAmount(value) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1e3) return `${Math.round(value / 1e3)}K`;
  return String(Math.round(value));
}

const darkTheme = createTheme({
  palette: { mode: 'dark', background: { default: '#050d1a', paper: '#0a1828' } },
  typography: { fontSize: 12 },
});

export function Diagram({ summary }) {
  const [account, setAccount] = useState(summary.accounts[0] || '');
  const accountHistory = summary.balance_history[account] || {};
  const denominations = Object.keys(accountHistory);
  const [denomination, setDenomination] = useState(denominations.includes('VND') ? 'VND' : denominations[0] || '');
  const denomHistory = accountHistory[denomination] || {};
  const addresses = Object.keys(denomHistory).sort();
  const [enabled, setEnabled] = useState(new Set(addresses.slice(0, Math.min(6, addresses.length))));
  const [zoom, setZoom] = useState(null);
  const denominationKey = denominations.join(' ');
  const addressKey = addresses.join(' ');
  const wheelRaf = useRef(0);

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

  useEffect(() => () => cancelAnimationFrame(wheelRaf.current), []);

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

  const { fullMin, fullMax } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const item of series) {
      for (const point of item.points) {
        if (point.ms < min) min = point.ms;
        if (point.ms > max) max = point.ms;
      }
    }
    for (const marker of markers) {
      if (marker.ms < min) min = marker.ms;
      if (marker.ms > max) max = marker.ms;
    }
    if (min === Infinity) return { fullMin: 0, fullMax: 1 };
    return { fullMin: min, fullMax: max };
  }, [series, markers]);

  const tMin = zoom?.min ?? fullMin;
  const tMax = zoom?.max ?? fullMax;
  const hasData = series.length > 0 || markers.length > 0;

  // MUI LineChart needs all series aligned on a shared x-axis. Build the
  // union of every timestamp, then forward-fill each series (step semantics
  // — a balance keeps its value until the next change, so filling forward is
  // exact, not interpolation).
  const { xData, muiSeries } = useMemo(() => {
    const unionSet = new Set();
    for (const item of series) {
      for (const point of item.points) unionSet.add(point.ms);
    }
    const union = [...unionSet].sort((a, b) => a - b);
    const indexOfMs = new Map(union.map((ms, i) => [ms, i]));

    const totalPoints = series.reduce((acc, item) => acc + item.points.length, 0);
    const showMarks = totalPoints <= MAX_POINT_MARKS;

    const built = series.map((item) => {
      const data = new Array(union.length).fill(null);
      const realIdx = new Set();
      let pi = 0;
      let current = null;
      for (let i = 0; i < union.length; i++) {
        while (pi < item.points.length && item.points[pi].ms <= union[i]) {
          current = item.points[pi];
          pi++;
        }
        data[i] = current ? current.amount : null;
        if (current && current.ms === union[i]) realIdx.add(i);
      }
      return {
        id: item.label,
        label: item.label,
        color: item.color,
        data,
        curve: 'stepAfter',
        area: true,
        showMark: showMarks ? ({ index }) => realIdx.has(index) : false,
        valueFormatter: (value) => (value == null ? '' : amount(value)),
      };
    });

    return { xData: union.map((ms) => new Date(ms)), muiSeries: built };
  }, [series]);

  function toggleAddress(address) {
    const next = new Set(enabled);
    next.has(address) ? next.delete(address) : next.add(address);
    setEnabled(next);
  }

  function onWheel(event) {
    event.preventDefault();
    if (!hasData) return;
    const { deltaY, clientX } = event;
    const rect = event.currentTarget.getBoundingClientRect();
    if (wheelRaf.current) return;
    wheelRaf.current = requestAnimationFrame(() => {
      wheelRaf.current = 0;
      setZoom((current) => {
        const curMin = current?.min ?? fullMin;
        const curMax = current?.max ?? fullMax;
        const range = curMax - curMin || 1;
        const nextRange = deltaY > 0 ? range * 1.4 : range / 1.4;
        if (nextRange < 3_600_000) return current;
        if (nextRange >= fullMax - fullMin) return null;
        const innerLeft = rect.left + AXIS_LEFT;
        const innerWidth = Math.max(1, rect.width - AXIS_LEFT - AXIS_RIGHT);
        const ratio = Math.max(0, Math.min(1, (clientX - innerLeft) / innerWidth));
        const center = curMin + range * ratio;
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
        return { min: Math.max(fullMin, min), max: Math.min(fullMax, max) };
      });
    });
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
            <ThemeProvider theme={darkTheme}>
              <LineChart
                height={CHART_HEIGHT}
                series={muiSeries}
                xAxis={[
                  {
                    data: xData,
                    scaleType: 'time',
                    min: new Date(tMin),
                    max: new Date(tMax),
                    tickNumber: 8,
                    disableTicks: true,
                    valueFormatter: (date, context) => {
                      if (context.location === 'tooltip') {
                        return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
                      }
                      const spanDays = (tMax - tMin) / 86_400_000;
                      const iso = date.toISOString();
                      return spanDays > 14 ? iso.slice(5, 10) : iso.slice(5, 16).replace('T', ' ');
                    },
                  },
                ]}
                yAxis={[
                  {
                    width: AXIS_LEFT,
                    disableTicks: true,
                    valueFormatter: (value) => compactAmount(value),
                  },
                ]}
                margin={{ top: 16, right: AXIS_RIGHT, bottom: 4, left: 0 }}
                grid={{ horizontal: true }}
                hideLegend
                skipAnimation
                axisHighlight={{ x: 'line' }}
                sx={{
                  '& .MuiChartsAxis-line': { stroke: '#1e293b' },
                  '& .MuiChartsAxis-tickLabel': { fill: '#5b6b82', fontSize: 11 },
                  '& .MuiChartsGrid-line': { stroke: 'rgba(30, 41, 59, 0.5)' },
                  '& .MuiLineElement-root': { strokeWidth: 2 },
                  '& .MuiAreaElement-root': { opacity: 0.1 },
                  '& .MuiMarkElement-root': { strokeWidth: 1.5 },
                  '& .MuiChartsAxisHighlight-root': { stroke: '#334155', strokeDasharray: '4 4' },
                  backgroundColor: 'transparent',
                }}
              />
            </ThemeProvider>
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

// Event timeline strip below the chart. Uses real pixel coordinates (via
// ResizeObserver) with the same left/right offsets as the MUI chart so the
// ticks align with the chart's time axis at any container width.
const EventStrip = memo(function EventStrip({ markers, tMin, tMax }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(1320);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect?.width;
      if (next) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const height = 72;
  const tRange = tMax - tMin || 1;
  const innerWidth = Math.max(1, width - AXIS_LEFT - AXIS_RIGHT);
  const xOf = (ms) => AXIS_LEFT + ((ms - tMin) / tRange) * innerWidth;

  const N_TICKS = 5;
  const ticks = Array.from({ length: N_TICKS }, (_, i) => {
    const ms = tMin + (tMax - tMin) * (i / (N_TICKS - 1));
    return { ms, x: xOf(ms), i };
  });

  function fmtTick(ms) {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }

  return (
    <div ref={wrapRef} className="event-strip-wrap">
      <svg className="event-strip-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <rect width={width} height={height} fill="#050b15" />
        {/* Baseline */}
        <line x1={AXIS_LEFT} y1={32} x2={width - AXIS_RIGHT} y2={32} className="event-strip-baseline" />
        {/* Event tick marks */}
        {markers.map((marker) => {
          const x = xOf(marker.ms);
          if (x < AXIS_LEFT - 2 || x > width - AXIS_RIGHT + 2) return null;
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
          <g key={kind} transform={`translate(${AXIS_LEFT + index * 94}, 63)`}>
            <rect width={8} height={4} rx={1} fill={eventColor(kind)} />
            <text x={12} y={4} className="event-key-label">
              {kind}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
});
