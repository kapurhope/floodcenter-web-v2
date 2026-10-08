/**
 * Firestore reads for the map and dashboard (floodcenter-backend-v2).
 *
 *   sensor_locations/{deviceId}   latitude, longitude, sensor_height, yellow_height, red_height (mm)
 *   waterLevel_daily/{id}_{date}  deviceId, date, day, maxMm { 'HH:MM': mm }
 *   waterLevel_latest/{deviceId}  levelMm, at
 *   rainfall_data                 deviceId, timestamp (window end), periodStart, accumulationMinutes, rainfall, createdAt
 *   alerts/{deviceId}             level, reason, rainFwd6h, rainPast12h, holdDown, since, ruleClearedAt, updatedAt
 *   alert_history/{episodeId}     deviceId, mode, startAt, ruleClearedAt, endAt, peakLevel, levels [{ at, level }]
 *   canal_forecasts/{deviceId}    issuedAt, modelId, points [{ t, waterLevelMm }]
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { dailyDocBounds, toMs } from './waterLevelQuery';

// Rain rows are keyed by window end; a 3-hour window ending this long after
// the range still overlaps it.
const MAX_RAIN_WINDOW_MS = 3 * 60 * 60 * 1000;
// Episodes are queried by startAt; one that started this long before the
// range can still overlap it. The longest replayed episode is about 3 days.
const MAX_EPISODE_MS = 7 * 24 * 60 * 60 * 1000;
const ALERT_HISTORY_MODES = ['live', 'replay-issued'];

const numberOrNull = (value) => {
  const n = Number(value);
  return value != null && Number.isFinite(n) ? n : null;
};

const toSensor = (snap) => {
  const data = snap.data();
  return {
    id: snap.id,
    name: data.name || snap.id,
    latitude: numberOrNull(data.latitude),
    longitude: numberOrNull(data.longitude),
    sensorHeightMm: numberOrNull(data.sensor_height),
    yellowMm: numberOrNull(data.yellow_height),
    redMm: numberOrNull(data.red_height),
  };
};

export const fetchSensorLocations = async () => {
  const snap = await getDocs(collection(db, 'sensor_locations'));
  return snap.docs.map(toSensor);
};

export const fetchSensorLocation = async (deviceId) => {
  const snap = await getDoc(doc(db, 'sensor_locations', deviceId));
  return snap.exists() ? toSensor(snap) : null;
};

const toLatest = (data) => {
  if (!data) return null;
  const levelMm = numberOrNull(data.levelMm);
  const atMs = data.at && typeof data.at.toMillis === 'function' ? data.at.toMillis() : null;
  return levelMm == null ? null : { levelMm, atMs };
};

/** Calls onChange with { [deviceId]: { levelMm, atMs } } on every update. */
export const subscribeLatestLevels = (onChange, onError) =>
  onSnapshot(
    collection(db, 'waterLevel_latest'),
    (snap) => {
      const byDevice = {};
      snap.forEach((d) => {
        const latest = toLatest(d.data());
        if (latest) byDevice[d.id] = latest;
      });
      onChange(byDevice);
    },
    onError
  );

/** waterLevel_latest, alerts and canal_forecasts docs for one device. */
export const fetchDeviceStatus = async (deviceId) => {
  const [latestSnap, alertSnap, forecastSnap] = await Promise.all([
    getDoc(doc(db, 'waterLevel_latest', deviceId)),
    getDoc(doc(db, 'alerts', deviceId)),
    getDoc(doc(db, 'canal_forecasts', deviceId)),
  ]);
  return {
    latest: latestSnap.exists() ? toLatest(latestSnap.data()) : null,
    alert: alertSnap.exists() ? alertSnap.data() : null,
    forecast: forecastSnap.exists() ? forecastSnap.data() : null,
  };
};

/** waterLevel_daily docs covering [startMs, endMs] (UTC days). */
export const fetchDailyDocs = async (deviceId, startMs, endMs) => {
  const { fromDayMs, toDayMs } = dailyDocBounds(startMs, endMs);
  const snap = await getDocs(query(
    collection(db, 'waterLevel_daily'),
    where('deviceId', '==', deviceId),
    where('day', '>=', Timestamp.fromMillis(fromDayMs)),
    where('day', '<=', Timestamp.fromMillis(toDayMs)),
    orderBy('day', 'asc')
  ));
  return snap.docs.map((d) => d.data());
};

/** rainfall_data rows whose accumulation window can overlap [startMs, endMs]. */
export const fetchRainRows = async (deviceId, startMs, endMs) => {
  const snap = await getDocs(query(
    collection(db, 'rainfall_data'),
    where('deviceId', '==', deviceId),
    where('timestamp', '>', Timestamp.fromMillis(startMs)),
    where('timestamp', '<=', Timestamp.fromMillis(endMs + MAX_RAIN_WINDOW_MS)),
    orderBy('timestamp', 'asc')
  ));
  return snap.docs.map((d) => d.data());
};

/**
 * alert_history episodes (live and replay-issued) that can overlap
 * [startMs, endMs], as { id, mode, startMs, endMs (null = open), ruleClearedMs,
 * levels [{ atMs, level }], peakLevel, dataQuality }.
 */
export const fetchAlertHistory = async (deviceId, startMs, endMs) => {
  const snap = await getDocs(query(
    collection(db, 'alert_history'),
    where('deviceId', '==', deviceId),
    where('mode', 'in', ALERT_HISTORY_MODES),
    where('startAt', '>=', Timestamp.fromMillis(startMs - MAX_EPISODE_MS)),
    where('startAt', '<=', Timestamp.fromMillis(endMs)),
    orderBy('startAt', 'asc')
  ));
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        mode: data.mode,
        startMs: toMs(data.startAt),
        endMs: toMs(data.endAt),
        ruleClearedMs: toMs(data.ruleClearedAt),
        levels: (data.levels || [])
          .map((l) => ({ atMs: toMs(l.at), level: l.level }))
          .filter((l) => l.atMs != null),
        peakLevel: data.peakLevel,
        dataQuality: data.dataQuality,
      };
    })
    .filter((e) => e.startMs != null && (e.endMs == null || e.endMs >= startMs));
};
