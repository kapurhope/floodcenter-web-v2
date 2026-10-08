import {
  alertBands,
  breakAtGaps,
  dailyDocBounds,
  expandDailyDocs,
  forecastSeries,
  maxByBucket,
  maxMm,
  normalizeRainRows,
  rainByBucket,
  rangeForView,
  sumMm,
  validateCustomRange,
  VIEW_ORDER,
} from './waterLevelQuery';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Local times, so bucket alignment does not depend on the machine's time zone.
const NOW = new Date(2026, 9, 5, 14, 45).getTime();

test('views are ordered Day → Week → 2 Weeks → Month → Year → Custom', () => {
  expect(VIEW_ORDER).toEqual(['day', 'week', '2weeks', 'month', 'year', 'custom']);
});

test('day view covers 18 h back and a 6 h forecast', () => {
  const r = rangeForView('day', { now: NOW });
  expect(r.startMs).toBe(NOW - 18 * HOUR);
  expect(r.endMs).toBe(NOW);
  expect(r.xMaxMs).toBe(NOW + 6 * HOUR);
  expect(r.showForecast).toBe(true);
  expect(r.bucketMinutes).toBe(15);
});

test('longer views end at now without a forecast', () => {
  expect(rangeForView('week', { now: NOW })).toMatchObject({
    startMs: NOW - 7 * DAY, xMaxMs: NOW, showForecast: false, bucketMinutes: 30,
  });
  expect(rangeForView('year', { now: NOW })).toMatchObject({
    startMs: NOW - 365 * DAY, bucketMinutes: 1440, timeUnit: 'month',
  });
});

test('custom range uses local days, clamps to now and shows forecast only when short', () => {
  const today = rangeForView('custom', { now: NOW, custom: { from: '2026-10-05', to: '2026-10-05' } });
  expect(today.startMs).toBe(new Date(2026, 9, 5).getTime());
  expect(today.endMs).toBe(NOW);
  expect(today.showForecast).toBe(true);
  expect(today.xMaxMs).toBe(NOW + 6 * HOUR);

  const past = rangeForView('custom', { now: NOW, custom: { from: '2026-09-01', to: '2026-09-30' } });
  expect(past.endMs).toBe(new Date(2026, 8, 30, 23, 59, 59, 999).getTime());
  expect(past.showForecast).toBe(false);
  expect(past.bucketMinutes).toBe(60);

  expect(rangeForView('custom', { now: NOW, custom: { from: '2026-10-05', to: '2026-10-01' } })).toBeNull();
  expect(validateCustomRange({ from: '', to: '2026-10-01' }, new Date(NOW))).toMatch(/both/);
});

test('daily doc bounds are UTC midnights', () => {
  const { fromDayMs, toDayMs } = dailyDocBounds(Date.UTC(2026, 9, 4, 23), Date.UTC(2026, 9, 5, 1));
  expect(fromDayMs).toBe(Date.UTC(2026, 9, 4));
  expect(toDayMs).toBe(Date.UTC(2026, 9, 5));
});

test('daily docs expand from UTC bucket keys and are clipped to the range', () => {
  const docs = [
    { date: '2026-10-05', maxMm: { '10:05': 120, '10:00': 100, '23:55': 999 } },
    { date: '2026-10-04', maxMm: { '23:55': 90, bad: 1 } },
  ];
  const points = expandDailyDocs(docs, Date.UTC(2026, 9, 4, 12), Date.UTC(2026, 9, 5, 12));
  expect(points).toEqual([
    { t: Date.UTC(2026, 9, 4, 23, 55), mm: 90 },
    { t: Date.UTC(2026, 9, 5, 10, 0), mm: 100 },
    { t: Date.UTC(2026, 9, 5, 10, 5), mm: 120 },
  ]);
});

test('display buckets keep the peak and break the line over gaps', () => {
  const base = new Date(2026, 9, 5, 10, 0).getTime();
  const points = [
    { t: base, mm: 100 },
    { t: base + 5 * MIN, mm: 300 },
    { t: base + 10 * MIN, mm: 200 },
    { t: base + 3 * HOUR, mm: 50 },
  ];
  const buckets = maxByBucket(points, 15);
  expect(buckets).toEqual([{ t: base, mm: 300 }, { t: base + 3 * HOUR, mm: 50 }]);
  const withGaps = breakAtGaps(buckets, 15);
  expect(withGaps).toHaveLength(3);
  expect(withGaps[1].mm).toBeNull();
});

test('rain rows: observed vs forecast, newest forecast issue only', () => {
  const at = (ms) => ({ toMillis: () => ms });
  const rows = [
    // Observed hour ending 13:00, fetched just after.
    { timestamp: at(NOW - 105 * MIN), accumulationMinutes: 60, rainfall: 2, createdAt: at(NOW - 104 * MIN) },
    // Same future slot from two forecast issues; only the newer one counts.
    { timestamp: at(NOW + 3 * HOUR), accumulationMinutes: 180, rainfall: 9, createdAt: at(NOW - 4 * HOUR) },
    { timestamp: at(NOW + 3 * HOUR), accumulationMinutes: 180, rainfall: 6, createdAt: at(NOW - HOUR) },
  ];
  const { observed, forecast } = normalizeRainRows(rows, NOW);
  expect(observed).toHaveLength(1);
  expect(forecast).toEqual([{ startMs: NOW, endMs: NOW + 3 * HOUR, mm: 6 }]);

  const stale = normalizeRainRows(rows.slice(1, 2), NOW);
  expect(stale.forecast).toEqual([]);
});

test('rain accumulations are spread over their window and clipped', () => {
  const start = new Date(2026, 9, 5, 12, 0).getTime();
  const windows = [{ startMs: start, endMs: start + 3 * HOUR, mm: 6 }];
  const buckets = rainByBucket(windows, 15, start, start + 3 * HOUR);
  expect(buckets).toHaveLength(12);
  buckets.forEach((b) => expect(b.mm).toBeCloseTo(0.5));
  expect(sumMm(rainByBucket(windows, 60, start + HOUR, start + 2 * HOUR))).toBeCloseTo(2);
});

test('maxMm handles a year of 5-minute points', () => {
  const points = Array.from({ length: 365 * 288 }, (_, i) => ({ t: i, mm: i % 1000 }));
  expect(maxMm(points)).toBe(999);
  expect(maxMm([])).toBeNull();
});

test('alert bands split levels and hold-down, clip, and prefer live over replay', () => {
  const replay = {
    mode: 'replay-issued',
    startMs: NOW - 20 * HOUR,
    endMs: NOW - 8 * HOUR,
    ruleClearedMs: NOW - 14 * HOUR,
    levels: [{ atMs: NOW - 20 * HOUR, level: 'yellow' }, { atMs: NOW - 17 * HOUR, level: 'red' }],
    peakLevel: 'red',
  };
  expect(alertBands([replay], NOW - 18 * HOUR, NOW, NOW)).toEqual([
    { startMs: NOW - 18 * HOUR, endMs: NOW - 17 * HOUR, level: 'yellow', hold: false, replay: true },
    { startMs: NOW - 17 * HOUR, endMs: NOW - 14 * HOUR, level: 'red', hold: false, replay: true },
    { startMs: NOW - 14 * HOUR, endMs: NOW - 8 * HOUR, level: 'red', hold: true, replay: true },
  ]);

  const live = {
    mode: 'live',
    startMs: NOW - 10 * HOUR,
    endMs: null,
    ruleClearedMs: null,
    levels: [{ atMs: NOW - 10 * HOUR, level: 'yellow' }],
    peakLevel: 'yellow',
  };
  expect(alertBands([replay, live], NOW - 18 * HOUR, NOW, NOW)).toEqual([
    { startMs: NOW - 10 * HOUR, endMs: NOW, level: 'yellow', hold: false, replay: false },
  ]);
});

test('forecast series is clipped to 6 h and hidden when stale', () => {
  const doc = {
    issuedAt: new Date(NOW - 10 * MIN).toISOString(),
    points: [0, 3, 6, 9].map((h) => ({
      t: new Date(NOW - 10 * MIN + h * HOUR).toISOString(),
      waterLevelMm: 700 + h,
    })),
  };
  expect(forecastSeries(doc, NOW).map((p) => p.mm)).toEqual([700, 703, 706]);
  expect(forecastSeries({ ...doc, issuedAt: new Date(NOW - 5 * HOUR).toISOString() }, NOW)).toEqual([]);
  expect(forecastSeries(null, NOW)).toEqual([]);
});
