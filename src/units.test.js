import {
  formatRain,
  formatWater,
  rainFromMm,
  rainUnit,
  waterFromMm,
  waterUnit,
} from './units';

test('metric shows water in m and rain in mm', () => {
  expect(waterUnit('metric')).toBe('m');
  expect(rainUnit('metric')).toBe('mm');
  expect(waterFromMm(1854.2, 'metric')).toBeCloseTo(1.8542);
  expect(rainFromMm(12.5, 'metric')).toBe(12.5);
  expect(formatWater(927.1, 'metric')).toBe('0.93 m');
  expect(formatRain(14, 'metric')).toBe('14.0 mm');
});

test('US shows water in ft and rain in in', () => {
  expect(waterUnit('us')).toBe('ft');
  expect(rainUnit('us')).toBe('in');
  expect(waterFromMm(304.8, 'us')).toBeCloseTo(1);
  expect(rainFromMm(25.4, 'us')).toBeCloseTo(1);
  expect(formatWater(1854.2, 'us')).toBe('6.08 ft');
  expect(formatRain(14, 'us')).toBe('0.55 in');
});

test('missing values format as a dash', () => {
  expect(formatWater(null, 'metric')).toBe('—');
  expect(formatRain(NaN, 'us')).toBe('—');
});
