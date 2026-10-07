import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  Filler,
  Interaction,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip,
} from 'chart.js';
import { getRelativePosition } from 'chart.js/helpers';
import { Chart } from 'react-chartjs-2';
import 'chartjs-adapter-date-fns';
import zoomPlugin from 'chartjs-plugin-zoom';
import { fetchDailyDocs, fetchDeviceStatus, fetchRainRows, fetchSensorLocation } from './sensorData';
import {
  formatRain,
  formatWater,
  rainDecimals,
  rainFromMm,
  rainUnit,
  UNIT_LABELS,
  UNIT_SYSTEMS,
  waterFromMm,
  waterUnit,
} from './units';
import {
  breakAtGaps,
  expandDailyDocs,
  FORECAST_HORIZON_HOURS,
  forecastSeries,
  maxByBucket,
  maxMm,
  normalizeRainRows,
  rainByBucket,
  rangeForView,
  sumMm,
  toDateInputValue,
  toMs,
  validateCustomRange,
  VIEW_ORDER,
  VIEWS,
} from './waterLevelQuery';
import './Dashboard.css';

const TOOLTIP_MAX_PX = 40;

/**
 * Hover picks the point nearest the cursor in x from each series separately.
 * The built-in 'index' mode pairs points by array position, which is wrong
 * when series have different timestamps.
 */
Interaction.modes.nearestPerDataset = (chart, e, options, useFinalPosition) => {
  const position = getRelativePosition(e, chart);
  const items = [];
  chart.data.datasets.forEach((dataset, datasetIndex) => {
    if (dataset.excludeFromTooltip || !chart.isDatasetVisible(datasetIndex)) return;
    let best = null;
    let bestDistance = TOOLTIP_MAX_PX;
    chart.getDatasetMeta(datasetIndex).data.forEach((element, index) => {
      if (element.skip) return;
      const { x } = element.getProps(['x'], useFinalPosition);
      const distance = Math.abs(x - position.x);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { element, datasetIndex, index };
      }
    });
    if (best) items.push(best);
  });
  return items;
};

ChartJS.register(
  BarController,
  BarElement,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip,
  zoomPlugin
);

const DEBUG = process.env.REACT_APP_DEBUG_MODE === 'true';
const REFRESH_MS = 5 * 60 * 1000;
const EMPTY_RAIN = { observed: [], forecast: [] };

const debugLog = (...args) => {
  if (DEBUG) console.log('[SensorDashboard]', ...args);
};

const defaultCustomRange = () => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 14);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
};

const formatTime = (ms) => (ms == null ? '—' : new Date(ms).toLocaleString());

const formatAxisNumber = (value) => String(Number(Number(value).toFixed(2)));

/** Rewrites "12.0 mm" in backend reason text into the selected rain unit. */
const convertRainText = (text, unitSystem) =>
  text.replace(/(\d+(?:\.\d+)?)\s*mm\b/g, (_, mm) => formatRain(Number(mm), unitSystem));

const describeAlert = (alert, unitSystem, crestMm) => {
  if (!alert || (alert.level !== 'yellow' && alert.level !== 'red')) return null;
  const isRed = alert.level === 'red';
  const reason = convertRainText(alert.reason || '', unitSystem);
  const details = [];
  if (crestMm != null) {
    details.push(
      `Estimated crest about ${formatWater(crestMm, unitSystem)}. The height model often runs low `
      + 'when rain timing is uncertain; use the rain alert as the warning.'
    );
  }
  if (alert.holdDown) {
    details.push('Rain has eased; the alert stays on for 6 hours after the rain rule clears.');
  }
  return {
    className: `alert-banner ${isRed ? 'alert-red' : 'alert-yellow'}`,
    title: `${isRed ? 'Red' : 'Yellow'} alert${reason ? ` — ${reason}` : ''}`,
    detail: details.join(' '),
    updatedMs: toMs(alert.updatedAt),
  };
};

const SensorDashboard = ({ deviceId, sensor: sensorFromList, unitSystem, onUnitSystemChange, onClose }) => {
  const [view, setView] = useState('day');
  const [customDraft, setCustomDraft] = useState(defaultCustomRange);
  const [customApplied, setCustomApplied] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [fetchedSensor, setFetchedSensor] = useState(null);
  const [status, setStatus] = useState({ latest: null, alert: null, forecast: null });
  const [history, setHistory] = useState({ key: null });
  const chartRef = useRef(null);

  const sensor = sensorFromList || fetchedSensor;
  const viewKey = view === 'custom'
    ? `${deviceId}|custom|${customApplied?.from}|${customApplied?.to}`
    : `${deviceId}|${view}`;
  const range = useMemo(
    () => rangeForView(view, { now, custom: customApplied }),
    [view, now, customApplied]
  );
  const customError = validateCustomRange(customDraft, new Date(now));

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (sensorFromList) return undefined;
    let cancelled = false;
    fetchSensorLocation(deviceId)
      .then((loc) => {
        if (!cancelled) setFetchedSensor(loc);
      })
      .catch((err) => console.error('[SensorDashboard] sensor_locations:', err));
    return () => {
      cancelled = true;
    };
  }, [deviceId, sensorFromList]);

  useEffect(() => {
    let cancelled = false;
    fetchDeviceStatus(deviceId)
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((err) => console.error('[SensorDashboard] status docs:', err));
    return () => {
      cancelled = true;
    };
  }, [deviceId, now]);

  useEffect(() => {
    if (!range) return undefined;
    let cancelled = false;
    debugLog('Loading', viewKey, new Date(range.startMs), new Date(range.xMaxMs));
    Promise.all([
      fetchDailyDocs(deviceId, range.startMs, range.endMs),
      fetchRainRows(deviceId, range.startMs, range.xMaxMs),
    ])
      .then(([dailyDocs, rainRows]) => {
        if (cancelled) return;
        debugLog(`${dailyDocs.length} daily docs, ${rainRows.length} rain rows`);
        setHistory({
          key: viewKey,
          range,
          water: expandDailyDocs(dailyDocs, range.startMs, range.endMs),
          rain: normalizeRainRows(rainRows, range.nowMs),
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[SensorDashboard] history:', err);
        // A failed background refresh keeps the chart that is already drawn.
        setHistory((prev) => (prev.key === viewKey && !prev.error ? prev : {
          key: viewKey,
          range,
          water: [],
          rain: EMPTY_RAIN,
          error: err.message || String(err),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, range, viewKey]);

  const ready = history.key === viewKey;
  const shown = ready ? history : null;

  const series = useMemo(() => {
    if (!shown) return null;
    const { range: r, water, rain } = shown;
    const forecast = r.showForecast ? forecastSeries(status.forecast, r.nowMs) : [];
    return {
      range: r,
      water,
      waterBuckets: breakAtGaps(maxByBucket(water, r.bucketMinutes), r.bucketMinutes),
      rainObserved: rainByBucket(rain.observed, r.bucketMinutes, r.startMs, Math.min(r.endMs, r.nowMs)),
      rainForecast: r.showForecast
        ? rainByBucket(rain.forecast, r.bucketMinutes, r.nowMs, r.xMaxMs)
        : [],
      forecast,
    };
  }, [shown, status.forecast]);

  const stats = useMemo(() => {
    const water = series ? series.water : [];
    const lastPoint = water.length ? water[water.length - 1] : null;
    return {
      currentMm: status.latest ? status.latest.levelMm : lastPoint?.mm ?? null,
      lastUpdateMs: status.latest ? status.latest.atMs : lastPoint?.t ?? null,
      maxMm: maxMm(water),
      avgMm: water.length ? sumMm(water) / water.length : null,
      rainMm: series ? sumMm(series.rainObserved) : null,
    };
  }, [series, status.latest]);

  const crestMm = series ? maxMm(series.forecast) : null;
  const alertBanner = describeAlert(status.alert, unitSystem, crestMm);

  const yellowMm = sensor?.yellowMm > 0 ? sensor.yellowMm : null;
  const redMm = sensor?.redMm > 0 ? sensor.redMm : null;

  const chartData = useMemo(() => {
    if (!series) return null;
    const { range: r } = series;
    const water = (mm) => (mm == null ? null : waterFromMm(mm, unitSystem));
    const rain = (mm) => rainFromMm(mm, unitSystem);
    const thresholdLine = (label, mm, color) => ({
      type: 'line',
      label,
      data: [{ x: r.startMs, y: water(mm) }, { x: r.xMaxMs, y: water(mm) }],
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      pointHoverRadius: 0,
      yAxisID: 'y',
      order: 0,
      excludeFromTooltip: true,
    });

    const datasets = [];
    if (yellowMm != null) datasets.push(thresholdLine('Yellow Alert', yellowMm, 'rgb(255, 204, 0)'));
    if (redMm != null) datasets.push(thresholdLine('Red Alert', redMm, 'rgb(255, 0, 0)'));
    datasets.push({
      type: 'line',
      label: 'Water Level',
      data: series.waterBuckets.map((p) => ({ x: p.t, y: water(p.mm) })),
      borderColor: 'rgb(0, 51, 102)',
      backgroundColor: 'rgb(0, 51, 102)',
      borderWidth: 2,
      tension: 0.15,
      pointRadius: 0,
      pointHoverRadius: 4,
      spanGaps: false,
      yAxisID: 'y',
      order: 1,
    });
    if (series.forecast.length) {
      datasets.push({
        type: 'line',
        label: `Estimated canal height (next ${FORECAST_HORIZON_HOURS} h)`,
        data: series.forecast.map((p) => ({ x: p.t, y: water(p.mm) })),
        borderColor: 'rgb(102, 51, 153)',
        backgroundColor: 'rgb(102, 51, 153)',
        borderWidth: 2,
        borderDash: [8, 5],
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4,
        yAxisID: 'y',
        order: 1,
      });
    }
    if (view !== 'year') {
      const barThickness = r.bucketMinutes <= 15 ? 10 : 4;
      if (series.rainObserved.length) {
        datasets.push({
          type: 'bar',
          label: 'Rainfall',
          data: series.rainObserved.map((p) => ({ x: p.t, y: rain(p.mm) })),
          backgroundColor: 'rgba(54, 162, 235, 0.55)',
          borderColor: 'rgb(54, 162, 235)',
          barThickness,
          grouped: false,
          yAxisID: 'y1',
          order: 2,
        });
      }
      if (series.rainForecast.length) {
        datasets.push({
          type: 'bar',
          label: 'Rain forecast',
          data: series.rainForecast.map((p) => ({ x: p.t, y: rain(p.mm) })),
          backgroundColor: 'rgba(54, 162, 235, 0.22)',
          borderColor: 'rgb(54, 162, 235)',
          borderWidth: 1,
          barThickness,
          grouped: false,
          yAxisID: 'y1',
          order: 2,
        });
      }
    }
    return { datasets };
  }, [series, unitSystem, view, yellowMm, redMm]);

  const chartOptions = useMemo(() => {
    if (!series) return null;
    const { range: r } = series;
    const wUnit = waterUnit(unitSystem);
    const rUnit = rainUnit(unitSystem);
    const rDecimals = rainDecimals(unitSystem);
    const peakMm = Math.max(
      maxMm(series.water) || 0,
      maxMm(series.forecast) || 0,
      yellowMm || 0,
      redMm || 0,
      100
    );
    const rainPeakMm = Math.max(maxMm(series.rainObserved) || 0, maxMm(series.rainForecast) || 0);
    const showRainAxis = view !== 'year';

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearestPerDataset', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { usePointStyle: true, padding: 16, boxWidth: 10 },
        },
        tooltip: {
          mode: 'nearestPerDataset',
          intersect: false,
          filter: (item) => item.parsed.y != null,
          callbacks: {
            title: (items) => (items.length ? new Date(items[0].parsed.x).toLocaleString() : ''),
            label: (ctx) => {
              const label = ctx.dataset.label || '';
              if (ctx.dataset.yAxisID === 'y1') {
                return `${label}: ${ctx.parsed.y.toFixed(rDecimals)} ${rUnit}`;
              }
              return `${label}: ${ctx.parsed.y.toFixed(2)} ${wUnit}`;
            },
          },
        },
        zoom: {
          pan: { enabled: true, mode: 'xy', modifierKey: 'shift' },
          zoom: {
            mode: 'xy',
            wheel: { enabled: true, modifierKey: 'ctrl' },
            pinch: { enabled: true },
            drag: {
              enabled: true,
              modifierKey: 'ctrl',
              backgroundColor: 'rgba(0, 0, 0, 0.1)',
              borderColor: 'rgba(0, 0, 0, 0.3)',
              borderWidth: 1,
            },
          },
          limits: {
            x: { min: 'original', max: 'original' },
            y: { min: 'original', max: 'original' },
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          min: r.startMs,
          max: r.xMaxMs,
          time: {
            unit: r.timeUnit,
            displayFormats: { hour: 'HH:mm', day: 'MMM d', month: 'MMM yyyy' },
          },
          title: { display: true, text: 'Time' },
          ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 20 },
        },
        y: {
          position: 'left',
          min: 0,
          max: waterFromMm(peakMm * 1.1, unitSystem),
          title: { display: true, text: `Water Level (${wUnit})` },
          ticks: { callback: (v) => `${formatAxisNumber(v)} ${wUnit}` },
        },
        y1: {
          display: showRainAxis,
          position: 'right',
          min: 0,
          max: rainFromMm(Math.max(rainPeakMm * 3, 1), unitSystem),
          grid: { drawOnChartArea: false },
          title: { display: showRainAxis, text: `Rainfall (${rUnit})` },
          ticks: { callback: (v) => `${formatAxisNumber(v)} ${rUnit}` },
        },
      },
    };
  }, [series, unitSystem, view, yellowMm, redMm]);

  const selectView = (next) => {
    setView(next);
    if (next === 'custom' && !customApplied && !customError) setCustomApplied({ ...customDraft });
  };

  const applyCustomRange = () => {
    if (customError) return;
    setCustomApplied({ ...customDraft });
    setView('custom');
  };

  const bucketMinutes = (shown?.range || range)?.bucketMinutes;
  const bucketLabel = bucketMinutes >= 24 * 60 ? '1 day' : `${bucketMinutes} min`;
  const viewNote = `${VIEWS[view].note}${bucketMinutes ? ` Display bucket ≈ ${bucketLabel}.` : ''}`;

  let forecastNote = 'forecast hidden on this view';
  if (series?.range.showForecast) {
    forecastNote = series.forecast.length ? 'forecast shown' : 'forecast unavailable';
  }
  const hasData = series && (series.water.length || series.rainObserved.length);

  let chartBody;
  if (view === 'custom' && !range) {
    chartBody = <div className="chart-message">Pick a valid From and To date, then Apply range.</div>;
  } else if (!ready) {
    chartBody = <div className="chart-message">Loading data...</div>;
  } else if (history.error) {
    chartBody = <div className="error-message">Could not load chart data: {history.error}</div>;
  } else if (!hasData) {
    chartBody = <div className="chart-message">No data available for this range</div>;
  } else {
    chartBody = (
      <Chart
        key={`${viewKey}|${unitSystem}`}
        ref={chartRef}
        type="line"
        data={chartData}
        options={chartOptions}
        aria-label="Water level chart"
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sensor-dashboard-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="sensor-dashboard-title" className="modal-title">
            {sensor && sensor.name !== deviceId ? `${sensor.name} · ${deviceId}` : deviceId}
            {sensor && sensor.latitude != null && (
              <span className="modal-meta">({sensor.latitude}, {sensor.longitude})</span>
            )}
            {stats.lastUpdateMs != null && (
              <span className="modal-meta">Last Update: {formatTime(stats.lastUpdateMs)}</span>
            )}
          </h2>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close">×</button>
        </div>

        {alertBanner && (
          <div
            className={`${alertBanner.className}${view === 'day' || view === 'custom' ? '' : ' alert-muted'}`}
            role="alert"
          >
            <strong>{alertBanner.title}</strong>
            {alertBanner.detail && <div className="alert-detail">{alertBanner.detail}</div>}
            {alertBanner.updatedMs != null && (
              <div className="alert-meta">Updated {formatTime(alertBanner.updatedMs)}</div>
            )}
          </div>
        )}

        <div className="stats-grid">
          <div className="stat-card">
            <h3>Current Level</h3>
            <p>{formatWater(stats.currentMm, unitSystem)}</p>
          </div>
          <div className="stat-card">
            <h3>Max (visible)</h3>
            <p>{formatWater(stats.maxMm, unitSystem)}</p>
          </div>
          <div className="stat-card">
            <h3>Average (visible)</h3>
            <p>{formatWater(stats.avgMm, unitSystem)}</p>
          </div>
          <div className="stat-card">
            <h3>Rainfall (visible)</h3>
            <p>{formatRain(stats.rainMm, unitSystem)}</p>
          </div>
        </div>

        <div className="chart-controls">
          <div className="view-by-bar">
            <span>View by:</span>
            {VIEW_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                className={view === key ? 'range-btn active' : 'range-btn'}
                aria-pressed={view === key}
                onClick={() => selectView(key)}
              >
                {VIEWS[key].label}
              </button>
            ))}
          </div>
          <div className="unit-bar">
            <span className="control-label">Units:</span>
            {UNIT_SYSTEMS.map((system) => (
              <button
                key={system}
                type="button"
                className={unitSystem === system ? 'range-btn active' : 'range-btn'}
                aria-pressed={unitSystem === system}
                onClick={() => onUnitSystemChange(system)}
              >
                {UNIT_LABELS[system]}
              </button>
            ))}
            <button
              type="button"
              className="range-btn"
              onClick={() => chartRef.current?.resetZoom()}
              disabled={!hasData}
            >
              Reset Zoom
            </button>
          </div>
        </div>

        {view === 'custom' && (
          <div className="custom-range-row">
            <label>
              From{' '}
              <input
                type="date"
                value={customDraft.from}
                max={customDraft.to || toDateInputValue(new Date(now))}
                onChange={(e) => setCustomDraft((d) => ({ ...d, from: e.target.value }))}
              />
            </label>
            <label>
              To{' '}
              <input
                type="date"
                value={customDraft.to}
                min={customDraft.from}
                max={toDateInputValue(new Date(now))}
                onChange={(e) => setCustomDraft((d) => ({ ...d, to: e.target.value }))}
              />
            </label>
            <button
              type="button"
              className="range-btn active"
              onClick={applyCustomRange}
              disabled={!!customError}
            >
              Apply range
            </button>
            {customError && <span className="custom-range-error">{customError}</span>}
          </div>
        )}

        <div className="view-note">{viewNote}</div>

        <div className="chart-container">{chartBody}</div>

        <div className="chart-footnote">
          {yellowMm != null && `Yellow ${formatWater(yellowMm, unitSystem)} · `}
          {redMm != null && `Red ${formatWater(redMm, unitSystem)} · `}
          {series && `points drawn: ${series.waterBuckets.filter((p) => p.mm != null).length} · ${forecastNote} · `}
          Ctrl + drag or Ctrl + scroll to zoom, Shift + drag to pan
        </div>
      </div>
    </div>
  );
};

export default SensorDashboard;
