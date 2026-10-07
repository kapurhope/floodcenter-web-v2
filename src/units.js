/**
 * Unit handling. Everything read from Firestore and held in state is in mm;
 * conversion happens only when values are drawn or printed.
 *
 *   metric: water level in m, rain in mm
 *   us:     water level in ft, rain in in
 */

export const MM_PER_M = 1000;
export const MM_PER_FT = 304.8;
export const MM_PER_IN = 25.4;

export const UNIT_SYSTEMS = ['metric', 'us'];
export const UNIT_LABELS = { metric: 'Metric', us: 'US' };

const STORAGE_KEY = 'floodcenter.unitSystem';

export const waterUnit = (system) => (system === 'us' ? 'ft' : 'm');
export const rainUnit = (system) => (system === 'us' ? 'in' : 'mm');

export const waterFromMm = (mm, system) => (system === 'us' ? mm / MM_PER_FT : mm / MM_PER_M);
export const rainFromMm = (mm, system) => (system === 'us' ? mm / MM_PER_IN : mm);

export const WATER_DECIMALS = 2;
export const rainDecimals = (system) => (system === 'us' ? 2 : 1);

export const formatWater = (mm, system, decimals = WATER_DECIMALS) => {
  if (mm == null || !Number.isFinite(mm)) return '—';
  return `${waterFromMm(mm, system).toFixed(decimals)} ${waterUnit(system)}`;
};

export const formatRain = (mm, system) => {
  if (mm == null || !Number.isFinite(mm)) return '—';
  return `${rainFromMm(mm, system).toFixed(rainDecimals(system))} ${rainUnit(system)}`;
};

export const loadUnitSystem = () => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return UNIT_SYSTEMS.includes(saved) ? saved : 'metric';
  } catch (err) {
    return 'metric';
  }
};

export const saveUnitSystem = (system) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, system);
  } catch (err) {
    // Private browsing or storage disabled; the choice just won't persist.
  }
};
