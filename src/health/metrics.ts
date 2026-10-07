// Health metrics Phoenix Atlas understands, and a daily accumulator used by
// every importer to turn raw samples into one value per day.
import type { Activity, MetricPoint } from '../db/db';

export type Agg = 'sum' | 'mean' | 'last' | 'max';

export interface MetricDef {
  key: string;
  label: string;
  unit: string;
  decimals: number;
  agg: Agg;
  /** Which direction is "better", if any (used for wording only). */
  better?: 'higher' | 'lower';
}

export const METRICS: MetricDef[] = [
  { key: 'steps', label: 'Steps', unit: 'steps', decimals: 0, agg: 'sum', better: 'higher' },
  { key: 'sleep_hours', label: 'Sleep', unit: 'h', decimals: 1, agg: 'sum', better: 'higher' },
  { key: 'resting_hr', label: 'Resting heart rate', unit: 'bpm', decimals: 0, agg: 'mean', better: 'lower' },
  { key: 'hrv_ms', label: 'Heart rate variability', unit: 'ms', decimals: 0, agg: 'mean', better: 'higher' },
  { key: 'heart_rate_avg', label: 'Average heart rate', unit: 'bpm', decimals: 0, agg: 'mean' },
  { key: 'active_minutes', label: 'Active minutes', unit: 'min', decimals: 0, agg: 'sum', better: 'higher' },
  { key: 'active_zone_minutes', label: 'Active zone minutes', unit: 'min', decimals: 0, agg: 'sum', better: 'higher' },
  { key: 'distance_km', label: 'Distance', unit: 'km', decimals: 1, agg: 'sum' },
  { key: 'calories_kcal', label: 'Calories burned', unit: 'kcal', decimals: 0, agg: 'sum' },
  { key: 'active_kcal', label: 'Active calories', unit: 'kcal', decimals: 0, agg: 'sum' },
  { key: 'weight_kg', label: 'Weight', unit: 'kg', decimals: 1, agg: 'mean' },
  { key: 'spo2', label: 'Blood oxygen', unit: '%', decimals: 1, agg: 'mean' },
  { key: 'respiratory_rate', label: 'Respiratory rate', unit: 'br/min', decimals: 1, agg: 'mean' },
  { key: 'heart_points', label: 'Heart points', unit: 'pts', decimals: 0, agg: 'sum', better: 'higher' },
];

export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

export function metricDef(key: string): MetricDef {
  return (
    METRIC_BY_KEY.get(key) ?? {
      key,
      label: key.replace(/^custom:/, '').replace(/_/g, ' '),
      unit: '',
      decimals: 1,
      agg: 'mean',
    }
  );
}

export function formatMetric(key: string, v: number): string {
  const d = metricDef(key);
  const n = v.toLocaleString(undefined, { maximumFractionDigits: d.decimals, minimumFractionDigits: 0 });
  return d.unit && d.unit !== 'steps' ? `${n} ${d.unit}` : n;
}

/** Guess a metric key from a column header or file name. */
export function guessMetric(name: string): string | null {
  const s = name.toLowerCase();
  if (/resting.?heart|resting.?hr|\brhr\b/.test(s)) return 'resting_hr';
  if (/rmssd|\bhrv\b|heart.?rate.?variability/.test(s)) return 'hrv_ms';
  if (/step/.test(s)) return 'steps';
  if (/sleep|asleep/.test(s)) return 'sleep_hours';
  if (/zone.?minutes|\bazm\b/.test(s)) return 'active_zone_minutes';
  if (/heart.?points/.test(s)) return 'heart_points';
  if (/move.?minutes|active.?minutes|very.?active|moderately.?active/.test(s)) return 'active_minutes';
  if (/active.?(calories|energy|kcal)/.test(s)) return 'active_kcal';
  if (/calorie|kcal|energy/.test(s)) return 'calories_kcal';
  if (/distance/.test(s)) return 'distance_km';
  if (/weight|body.?mass/.test(s)) return 'weight_kg';
  if (/spo2|oxygen|saturation/.test(s)) return 'spo2';
  if (/respirat|breath/.test(s)) return 'respiratory_rate';
  if (/heart.?rate|\bbpm\b|pulse/.test(s)) return 'heart_rate_avg';
  return null;
}

/** Collects samples per (metric, day) and reduces them with each metric's aggregation. */
export class DailyAccumulator {
  private cells = new Map<string, { metric: string; date: string; sum: number; n: number; last: number; lastT: number; max: number; agg: Agg }>();

  add(metric: string, date: string, value: number, agg: Agg = metricDef(metric).agg, t = 0): void {
    if (!Number.isFinite(value) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const k = `${metric}|${date}`;
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = { metric, date, sum: 0, n: 0, last: value, lastT: -Infinity, max: -Infinity, agg }));
    c.sum += value;
    c.n++;
    c.max = Math.max(c.max, value);
    if (t >= c.lastT) { c.last = value; c.lastT = t; }
  }

  /** Overwrite a day's value (for sources that already provide daily totals). */
  set(metric: string, date: string, value: number): void {
    if (!Number.isFinite(value) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    this.cells.set(`${metric}|${date}`, { metric, date, sum: value, n: 1, last: value, lastT: Infinity, max: value, agg: 'last' });
  }

  has(metric: string, date: string): boolean {
    return this.cells.has(`${metric}|${date}`);
  }

  get size(): number {
    return this.cells.size;
  }

  points(source: string): MetricPoint[] {
    const out: MetricPoint[] = [];
    for (const c of this.cells.values()) {
      const v = c.agg === 'sum' ? c.sum : c.agg === 'mean' ? c.sum / c.n : c.agg === 'max' ? c.max : c.last;
      const d = metricDef(c.metric).decimals;
      const r = Math.round(v * 10 ** (d + 1)) / 10 ** (d + 1);
      out.push({ id: `${c.metric}|${c.date}`, date: c.date, metric: c.metric, value: r, source });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.metric.localeCompare(b.metric));
  }
}

export interface ImportResult {
  source: string;
  metrics: MetricPoint[];
  activities: Activity[];
  /** Human-readable notes about what was found. */
  log: string[];
  warnings: string[];
}

/** Local calendar day for an epoch-ms time, optionally with an explicit UTC offset in seconds. */
export function localDay(ms: number, offsetSeconds?: number | null): string {
  if (offsetSeconds !== undefined && offsetSeconds !== null && Number.isFinite(offsetSeconds)) {
    const d = new Date(ms + offsetSeconds * 1000);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(ms);
  const m = d.getMonth() + 1, day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}

export function summarize(metrics: MetricPoint[], activities: Activity[]): string {
  if (!metrics.length && !activities.length) return 'No health data found.';
  const byMetric = new Map<string, number>();
  let min = '9999', max = '0000';
  for (const m of metrics) {
    byMetric.set(m.metric, (byMetric.get(m.metric) ?? 0) + 1);
    if (m.date < min) min = m.date;
    if (m.date > max) max = m.date;
  }
  const parts = [...byMetric.entries()].map(([k, n]) => `${metricDef(k).label} (${n} days)`);
  if (activities.length) parts.push(`${activities.length} workouts`);
  return `${parts.join(', ')}${metrics.length ? ` · ${min} → ${max}` : ''}`;
}
