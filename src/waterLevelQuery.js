/**
 * View ranges and pure transforms for the sensor chart. Nothing in here talks
 * to Firestore (see sensorData.js); every level and rain amount is in mm and
 * every time is epoch milliseconds.
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const FORECAST_HORIZON_HOURS = 6;
const FORECAST_HORIZON_MS = FORECAST_HORIZON_HOURS * HOUR_MS;
// Scorers run every 15 minutes; an older forecast means they have stopped.
const FORECAST_MAX_AGE_MS = 2 * HOUR_MS;
// The rain forecast job runs every 3 hours and only writes rainy slots, so a
// newer dry issue leaves no rows. Past this age assume such an issue exists.
const RAIN_FORECAST_MAX_AGE_MS = 3.5 * HOUR_MS;
const DEFAULT_ACCUMULATION_MINUTES = 180;
const CUSTOM_FORECAST_MAX_SPAN_MS = 2 * DAY_MS;

export const VIEW_ORDER = ['day', 'week', '2weeks', 'month', 'year', 'custom'];

export const VIEWS = {
  day: {
    label: 'Day',
    note: 'Day: 5‑minute maxes from waterLevel_daily. Dashed line = physics forecast next 6 h. Alert banner from rain rule (~15 min refresh).',
    bucketMinutes: 15,
    hoursBack: 18,
    showForecast: true,
    timeUnit: 'hour',
  },
  week: {
    label: 'Week',
    note: 'Week: 5‑minute buckets from 7 daily docs, thinned to 30 min for display. No forecast beyond “now.”',
    bucketMinutes: 30,
    hoursBack: 24 * 7,
    showForecast: false,
    timeUnit: 'day',
  },
  '2weeks': {
    label: '2 Weeks',
    note: '2 Weeks: 14 daily docs. Coarser display buckets for readability.',
    bucketMinutes: 60,
    hoursBack: 24 * 14,
    showForecast: false,
    timeUnit: 'day',
  },
  month: {
    label: 'Month',
    note: 'Month: ~30 daily docs; chart shows 3‑hour maxes for speed.',
    bucketMinutes: 180,
    hoursBack: 24 * 30,
    showForecast: false,
    timeUnit: 'day',
  },
  year: {
    label: 'Year',
    note: 'Year: daily maxes from daily rollups. One point per day.',
    bucketMinutes: 24 * 60,
    hoursBack: 24 * 365,
    showForecast: false,
    timeUnit: 'month',
  },
  custom: {
    label: 'Custom',
    note: 'Custom: any From–To span; loads daily docs in range and downsamples for drawing if long.',
  },
};

/** Firestore Timestamp, Date, ISO string or epoch ms → epoch ms, else null. */
export const toMs = (value) => {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

const pad2 = (n) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD, the format of <input type="date">. */
export const toDateInputValue = (date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** YYYY-MM-DD → local midnight, or null. */
export const parseDateInput = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

const endOfLocalDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

export const customBucketMinutes = (days) => {
  if (days > 120) return 24 * 60;
  if (days > 40) return 180;
  if (days > 14) return 60;
  return 30;
};

/** Returns an error message for a From/To pair, or null if it is usable. */
export const validateCustomRange = ({ from, to }, now = new Date()) => {
  const start = parseDateInput(from);
  const end = parseDateInput(to);
  if (!start || !end) return 'Pick both a From and a To date.';
  if (start > end) return 'From must be on or before To.';
  if (start > now) return 'From is in the future.';
  return null;
};

/**
 * Time window for a view.
 * start/end bound the history; xMax extends past end when the forecast is
 * drawn. Returns null for an invalid custom range.
 */
export const rangeForView = (view, { now, custom } = {}) => {
  const nowMs = toMs(now) ?? Date.now();

  if (view === 'custom') {
    if (!custom || validateCustomRange(custom, new Date(nowMs))) return null;
    const startMs = parseDateInput(custom.from).getTime();
    const endMs = Math.min(endOfLocalDay(parseDateInput(custom.to)).getTime(), nowMs);
    const showForecast = endMs >= nowMs - MINUTE_MS && nowMs - startMs < CUSTOM_FORECAST_MAX_SPAN_MS;
    const xMaxMs = showForecast ? nowMs + FORECAST_HORIZON_MS : endMs;
    const spanMs = xMaxMs - startMs;
    let timeUnit = 'hour';
    if (spanMs > 90 * DAY_MS) timeUnit = 'month';
    else if (spanMs > 3 * DAY_MS) timeUnit = 'day';
    return {
      startMs,
      endMs,
      xMaxMs,
      nowMs,
      bucketMinutes: customBucketMinutes(Math.max(1, (endMs - startMs) / DAY_MS)),
      showForecast,
      timeUnit,
    };
  }

  const meta = VIEWS[view] || VIEWS.day;
  return {
    startMs: nowMs - meta.hoursBack * HOUR_MS,
    endMs: nowMs,
    xMaxMs: meta.showForecast ? nowMs + FORECAST_HORIZON_MS : nowMs,
    nowMs,
    bucketMinutes: meta.bucketMinutes,
    showForecast: meta.showForecast,
    timeUnit: meta.timeUnit,
  };
};

/** UTC midnights bracketing [startMs, endMs] for the waterLevel_daily `day` query. */
export const dailyDocBounds = (startMs, endMs) => {
  const utcMidnight = (ms) => {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  return { fromDayMs: utcMidnight(startMs), toDayMs: utcMidnight(endMs) };
};

/**
 * waterLevel_daily docs → sorted [{ t, mm }] inside [startMs, endMs].
 * maxMm keys are the UTC start ('HH:MM') of each 5-minute bucket.
 */
export const expandDailyDocs = (docs, startMs, endMs) => {
  const points = [];
  for (const data of docs) {
    if (!data || !data.date || !data.maxMm) continue;
    for (const [hhmm, level] of Object.entries(data.maxMm)) {
      const mm = Number(level);
      if (!Number.isFinite(mm)) continue;
      const t = Date.parse(`${data.date}T${hhmm}:00Z`);
      if (Number.isNaN(t) || t < startMs || t > endMs) continue;
      points.push({ t, mm });
    }
  }
  points.sort((a, b) => a.t - b.t);
  return points;
};

/** Start of the local-time display bucket containing ms. */
export const bucketStartMs = (ms, bucketMinutes) => {
  if (bucketMinutes >= 24 * 60) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const bucketMs = bucketMinutes * MINUTE_MS;
  const offsetMs = new Date(ms).getTimezoneOffset() * MINUTE_MS;
  return Math.floor((ms - offsetMs) / bucketMs) * bucketMs + offsetMs;
};

const nextBucketStartMs = (bucketMs, bucketMinutes) => {
  if (bucketMinutes >= 24 * 60) {
    const d = new Date(bucketMs);
    d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return bucketMs + bucketMinutes * MINUTE_MS;
};

/** Highest level per display bucket, so flood peaks survive thinning. */
export const maxByBucket = (points, bucketMinutes) => {
  if (bucketMinutes <= 5) return points;
  const buckets = new Map();
  for (const { t, mm } of points) {
    const key = bucketStartMs(t, bucketMinutes);
    const prev = buckets.get(key);
    if (prev == null || mm > prev) buckets.set(key, mm);
  }
  return Array.from(buckets, ([t, mm]) => ({ t, mm })).sort((a, b) => a.t - b.t);
};

/**
 * Inserts { t, mm: null } where consecutive points are far apart so the chart
 * breaks the line over sensor outages instead of drawing a straight ramp.
 */
export const breakAtGaps = (points, bucketMinutes) => {
  const maxGapMs = Math.max(3 * bucketMinutes, 30) * MINUTE_MS;
  const out = [];
  points.forEach((p, i) => {
    if (i > 0 && p.t - points[i - 1].t > maxGapMs) {
      out.push({ t: Math.round((p.t + points[i - 1].t) / 2), mm: null });
    }
    out.push(p);
  });
  return out;
};

/**
 * rainfall_data rows → { observed, forecast } windows of { startMs, endMs, mm }.
 *
 * `timestamp` is the END of the accumulation window. Observed rows are fetched
 * after their window closes; forecast rows before. Every 3-hour forecast issue
 * writes its own copy of each future slot, so forecast rows keep only the
 * newest issue, and only while it is recent.
 */
export const normalizeRainRows = (rows, nowMs = Date.now()) => {
  const observed = new Map();
  const forecastByIssue = new Map();

  for (const row of rows) {
    const endMs = toMs(row.timestamp);
    const mm = Number(row.rainfall);
    if (endMs == null || !Number.isFinite(mm) || mm < 0) continue;

    const periodStartMs = toMs(row.periodStart);
    const minutes = Number(row.accumulationMinutes)
      || (periodStartMs != null ? (endMs - periodStartMs) / MINUTE_MS : DEFAULT_ACCUMULATION_MINUTES);
    if (!(minutes > 0)) continue;
    const window = { startMs: endMs - minutes * MINUTE_MS, endMs, mm };

    const createdMs = toMs(row.createdAt);
    const isForecast = createdMs != null ? createdMs < endMs : minutes > 60;
    if (isForecast) {
      const issueKey = createdMs ?? 0;
      if (!forecastByIssue.has(issueKey)) forecastByIssue.set(issueKey, new Map());
      forecastByIssue.get(issueKey).set(`${window.startMs}|${endMs}`, window);
    } else {
      observed.set(`${window.startMs}|${endMs}`, window);
    }
  }

  let forecast = [];
  if (forecastByIssue.size) {
    const newestIssueMs = Math.max(...forecastByIssue.keys());
    if (nowMs - newestIssueMs <= RAIN_FORECAST_MAX_AGE_MS) {
      forecast = Array.from(forecastByIssue.get(newestIssueMs).values());
    }
  }
  return { observed: Array.from(observed.values()), forecast };
};

/**
 * Spreads each accumulation evenly over its window and sums it into display
 * buckets, clipped to [fromMs, toMs]. Returns [{ t, mm }] with mm > 0.
 */
export const rainByBucket = (windows, bucketMinutes, fromMs, toMs) => {
  const buckets = new Map();
  for (const w of windows) {
    const start = Math.max(w.startMs, fromMs);
    const end = Math.min(w.endMs, toMs);
    if (end <= start || w.mm <= 0) continue;
    const mmPerMs = w.mm / (w.endMs - w.startMs);
    for (let b = bucketStartMs(start, bucketMinutes); b < end;) {
      const next = nextBucketStartMs(b, bucketMinutes);
      const overlap = Math.min(next, end) - Math.max(b, start);
      if (overlap > 0) buckets.set(b, (buckets.get(b) || 0) + mmPerMs * overlap);
      b = next;
    }
  }
  return Array.from(buckets, ([t, mm]) => ({ t, mm }))
    .filter((p) => p.mm > 0)
    .sort((a, b) => a.t - b.t);
};

export const sumMm = (points) => points.reduce((sum, p) => sum + p.mm, 0);

/** Largest mm in points, or null. A Year view has ~100k points, too many to spread into Math.max. */
export const maxMm = (points) => points.reduce((max, p) => (max == null || p.mm > max ? p.mm : max), null);

/**
 * alert_history episodes → chart bands [{ startMs, endMs, level, hold, replay }]
 * clipped to [fromMs, toMs]. An open episode runs to nowMs. The 6 h hold-down
 * after the rain rule cleared is its own band (hold: true). Replayed episodes
 * that overlap a live one are dropped, so live history wins.
 */
export const alertBands = (episodes, fromMs, toMs, nowMs) => {
  const ends = (e) => e.endMs ?? nowMs;
  const live = episodes.filter((e) => e.mode === 'live');
  const bands = [];
  const push = (startMs, endMs, level, hold, replay) => {
    const s = Math.max(startMs, fromMs);
    const t = Math.min(endMs, toMs);
    if (t > s) bands.push({ startMs: s, endMs: t, level, hold, replay });
  };

  for (const e of episodes) {
    const endMs = ends(e);
    const replay = e.mode !== 'live';
    if (replay && live.some((l) => l.startMs < endMs && ends(l) > e.startMs)) continue;
    const levels = e.levels.length ? e.levels : [{ atMs: e.startMs, level: e.peakLevel }];
    levels.forEach((l, i) => {
      const segEnd = i + 1 < levels.length ? levels[i + 1].atMs : endMs;
      const clearedMs = e.ruleClearedMs;
      if (clearedMs != null && clearedMs > l.atMs && clearedMs < segEnd) {
        push(l.atMs, clearedMs, l.level, false, replay);
        push(clearedMs, segEnd, l.level, true, replay);
      } else {
        push(l.atMs, segEnd, l.level, false, replay);
      }
    });
  }
  return bands.sort((a, b) => a.startMs - b.startMs);
};

/**
 * canal_forecasts doc → [{ t, mm }] up to the 6 h horizon, or [] when the
 * doc is missing or stale.
 */
export const forecastSeries = (doc, nowMs) => {
  if (!doc || !Array.isArray(doc.points)) return [];
  const issuedMs = toMs(doc.issuedAt) ?? toMs(doc.updatedAt);
  if (issuedMs == null || nowMs - issuedMs > FORECAST_MAX_AGE_MS) return [];
  const untilMs = nowMs + FORECAST_HORIZON_MS;
  return doc.points
    .map((p) => ({ t: toMs(p.t), mm: Number(p.waterLevelMm) }))
    .filter((p) => p.t != null && Number.isFinite(p.mm) && p.t <= untilMs)
    .sort((a, b) => a.t - b.t);
};
