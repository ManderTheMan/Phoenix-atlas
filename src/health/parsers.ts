// Parsers for health data exports:
//  • Google Takeout → Fit (daily metrics CSVs, sessions JSON)
//  • Google Takeout → Fitbit (Global Export Data JSON, newer CSVs)
//  • Any CSV with a date column (generic)
// All parsers feed a DailyAccumulator so mixed sources merge into one value per day.
import Papa from 'papaparse';
import type { Activity } from '../db/db';
import { DailyAccumulator, guessMetric, localDay, metricDef } from './metrics';

export function parseCsv(text: string): { fields: string[]; rows: Record<string, string>[] } {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: true });
  return { fields: (res.meta.fields ?? []).map((f) => f.trim()), rows: res.data };
}

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const s = v.trim().replace(/,/g, '');
  return s === '' ? NaN : Number(s);
};

/** Normalise many date spellings to YYYY-MM-DD (local). */
export function toDayKey(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/);
  if (m) {
    // full timestamps with zone → local day; plain dates stay as written
    if (/[T ]\d{2}:\d{2}/.test(s) && /(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
      const t = Date.parse(s);
      if (Number.isFinite(t)) return localDay(t);
    }
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); // Fitbit MM/DD/YY
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? localDay(t) : null;
}

// ---------------------------------------------------------------- Google Fit

/** Column header → [metric, transform] for Google Fit "Daily activity metrics" CSVs. */
function fitColumn(h: string): [string, (v: number) => number] | null {
  const s = h.toLowerCase();
  if (/^step count/.test(s)) return ['steps', (v) => v];
  if (/^calories/.test(s)) return ['calories_kcal', (v) => v];
  if (/^distance \(m\)/.test(s)) return ['distance_km', (v) => v / 1000];
  if (/^move minutes/.test(s)) return ['active_minutes', (v) => v];
  if (/^heart points/.test(s)) return ['heart_points', (v) => v];
  if (/^average heart rate/.test(s)) return ['heart_rate_avg', (v) => v];
  if (/^average weight/.test(s)) return ['weight_kg', (v) => v];
  if (/^sleep duration \(ms\)/.test(s)) return ['sleep_hours', (v) => v / 3_600_000];
  return null;
}

/** "Daily activity metrics.csv" / "Daily Summaries.csv": one row per day. */
export function parseFitDailySummary(text: string, acc: DailyAccumulator): number {
  const { fields, rows } = parseCsv(text);
  const dateCol = fields.find((f) => /^date$/i.test(f));
  if (!dateCol) return 0;
  const cols = fields.map((f) => [f, fitColumn(f)] as const).filter(([, m]) => m);
  let n = 0;
  for (const r of rows) {
    const day = toDayKey(r[dateCol] ?? '');
    if (!day) continue;
    for (const [f, m] of cols) {
      const v = num(r[f]);
      if (!Number.isFinite(v) || (v === 0 && m![0] !== 'steps')) continue;
      acc.set(m![0], day, m![1](v));
      n++;
    }
  }
  return n;
}

/** Per-day "YYYY-MM-DD.csv" files with 15-minute intervals. */
export function parseFitIntervals(text: string, day: string, acc: DailyAccumulator): number {
  const { fields, rows } = parseCsv(text);
  const cols = fields.map((f) => [f, fitColumn(f)] as const).filter(([, m]) => m);
  let n = 0;
  for (const r of rows)
    for (const [f, m] of cols) {
      const v = num(r[f]);
      if (!Number.isFinite(v)) continue;
      const metric = m![0];
      const agg = metricDef(metric).agg === 'sum' ? 'sum' : 'mean';
      if (agg === 'mean' && v === 0) continue;
      acc.add(metric, day, m![1](v), agg);
      n++;
    }
  return n;
}

const FIT_AGG: Record<string, string> = {
  'com.google.calories.expended': 'calories',
  'com.google.step_count.delta': 'steps',
  'com.google.distance.delta': 'distance',
  'com.google.heart_rate.summary': 'hr',
  'com.google.heart_minutes.summary': 'heart',
  'com.google.active_minutes': 'active',
};

function titleCase(s: string): string {
  return s
    .replace(/[_.]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Google Fit "All Sessions/*.json". */
export function parseFitSession(text: string, source = 'Google Fit'): Activity | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  const start = Date.parse(String(j.startTime ?? ''));
  const end = Date.parse(String(j.endTime ?? ''));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const type = String(j.fitnessActivity ?? 'workout');
  const a: Activity = {
    id: `fit-${start}-${type}`,
    start,
    end,
    type: type.toUpperCase(),
    name: titleCase(String(j.name ?? type)),
    durationMin: Math.round((end - start) / 60000),
    source,
  };
  const dur = String(j.duration ?? '').match(/^([\d.]+)s$/);
  if (dur) a.durationMin = Math.round(Number(dur[1]) / 60);
  for (const ag of (j.aggregate as { metricName: string; floatValue?: number; intValue?: number }[] | undefined) ?? []) {
    const k = FIT_AGG[ag.metricName];
    const v = ag.floatValue ?? ag.intValue;
    if (v === undefined) continue;
    if (k === 'calories') a.calories = Math.round(v);
    if (k === 'steps') a.steps = Math.round(v);
    if (k === 'distance') a.distanceKm = Math.round(v / 10) / 100;
    if (k === 'hr') a.avgHr = Math.round(v);
  }
  return a;
}

// ---------------------------------------------------------------- Fitbit

export interface FitbitContext {
  weightUnit?: 'kg' | 'lb';
  weights: { day: string; value: number; t: number }[];
}

const FITBIT_FILE = /(?:^|\/)(steps|distance|calories|heart_rate|resting_heart_rate|sleep|weight|exercise|very_active_minutes|moderately_active_minutes|altitude)-(?:\d{4}-\d{2}-\d{2}|\d+)\.json$/i;

export function isFitbitJson(path: string): boolean {
  return FITBIT_FILE.test(path);
}

type FitbitRow = { dateTime?: string; value?: unknown } & Record<string, unknown>;

/** One file from Fitbit's "Global Export Data" folder. Returns rows used. */
export function parseFitbitJson(path: string, text: string, acc: DailyAccumulator, ctx: FitbitContext, activities: Activity[]): number {
  const m = path.match(FITBIT_FILE);
  if (!m) return 0;
  const kind = m[1].toLowerCase();
  let rows: FitbitRow[];
  try {
    rows = JSON.parse(text);
  } catch {
    return 0;
  }
  if (!Array.isArray(rows)) return 0;
  let n = 0;
  for (const r of rows) {
    if (kind === 'sleep') {
      const day = toDayKey(String(r.dateOfSleep ?? ''));
      const mins = num(r.minutesAsleep);
      if (day && Number.isFinite(mins) && mins > 0) {
        acc.add('sleep_hours', day, mins / 60, 'sum');
        n++;
      }
      continue;
    }
    if (kind === 'weight') {
      const day = toDayKey(String(r.date ?? ''));
      const w = num(r.weight);
      if (day && Number.isFinite(w) && w > 0) {
        ctx.weights.push({ day, value: w, t: Date.parse(`${day}T${String(r.time ?? '00:00:00')}`) || 0 });
        n++;
      }
      continue;
    }
    if (kind === 'exercise') {
      const start = fitbitTime(String(r.startTime ?? ''));
      const durMs = num(r.activeDuration) || num(r.duration);
      if (!Number.isFinite(start) || !Number.isFinite(durMs)) continue;
      const distance = num(r.distance);
      const unit = String(r.distanceUnit ?? '').toLowerCase();
      activities.push({
        id: `fitbit-${String(r.logId ?? start)}`,
        start,
        end: start + durMs,
        type: String(r.activityName ?? 'Workout').toUpperCase().replace(/\s+/g, '_'),
        name: String(r.activityName ?? 'Workout'),
        durationMin: Math.round(durMs / 60000),
        calories: Number.isFinite(num(r.calories)) ? Math.round(num(r.calories)) : undefined,
        avgHr: Number.isFinite(num(r.averageHeartRate)) ? Math.round(num(r.averageHeartRate)) : undefined,
        steps: Number.isFinite(num(r.steps)) ? Math.round(num(r.steps)) : undefined,
        distanceKm: Number.isFinite(distance) ? Math.round((unit.startsWith('mile') ? distance * 1.609344 : distance) * 100) / 100 : undefined,
        source: 'Fitbit',
      });
      n++;
      continue;
    }
    const day = toDayKey(String(r.dateTime ?? ''));
    if (!day) continue;
    const v = r.value;
    if (kind === 'heart_rate') {
      const bpm = num((v as { bpm?: number })?.bpm);
      if (Number.isFinite(bpm) && bpm > 0) acc.add('heart_rate_avg', day, bpm, 'mean');
    } else if (kind === 'resting_heart_rate') {
      const val = num((v as { value?: number })?.value);
      const d = toDayKey(String((v as { date?: string })?.date ?? '')) ?? day;
      if (Number.isFinite(val) && val > 0) acc.add('resting_hr', d, val, 'mean');
    } else if (kind === 'steps') acc.add('steps', day, num(v), 'sum');
    else if (kind === 'calories') acc.add('calories_kcal', day, num(v), 'sum');
    else if (kind === 'distance') acc.add('distance_km', day, num(v) / 100_000, 'sum'); // centimetres
    else if (kind === 'very_active_minutes' || kind === 'moderately_active_minutes') acc.add('active_minutes', day, num(v), 'sum');
    else continue;
    n++;
  }
  return n;
}

function fitbitTime(s: string): number {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}) (\d{1,2}):(\d{2}):(\d{2})/);
  if (m) {
    const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    return new Date(y, Number(m[1]) - 1, Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
  }
  return Date.parse(s);
}

/** Fitbit "Profile.csv" tells us whether weights are in pounds. */
export function parseFitbitProfile(text: string, ctx: FitbitContext): void {
  const { fields, rows } = parseCsv(text);
  const col = fields.find((f) => /weight_unit/i.test(f));
  if (!col || !rows[0]) return;
  const u = String(rows[0][col]).toUpperCase();
  ctx.weightUnit = /POUND|US|LB/.test(u) ? 'lb' : 'kg';
}

export function finishFitbit(ctx: FitbitContext, acc: DailyAccumulator, warnings: string[]): void {
  if (!ctx.weights.length) return;
  let unit = ctx.weightUnit;
  if (!unit) {
    const sorted = ctx.weights.map((w) => w.value).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    unit = median > 150 ? 'lb' : 'kg';
    warnings.push(`Fitbit weight unit not found in the export; assumed ${unit === 'lb' ? 'pounds' : 'kilograms'}.`);
  }
  for (const w of ctx.weights) acc.add('weight_kg', w.day, unit === 'lb' ? w.value * 0.45359237 : w.value, 'last', w.t);
}

// ---------------------------------------------------------------- generic CSV

const SUMMABLE = new Set(['steps', 'calories_kcal', 'active_kcal', 'distance_km', 'active_minutes', 'active_zone_minutes', 'heart_points']);

/**
 * Any CSV with a date/time column. Each numeric column becomes a metric
 * (recognised names map to built-in metrics; others become custom metrics).
 * `hint` (usually the file name) picks the metric for single-value files.
 */
export function parseGenericCsv(text: string, acc: DailyAccumulator, hint = '', warnings: string[] = []): number {
  const { fields, rows } = parseCsv(text);
  if (!rows.length) return 0;
  const dateCol =
    fields.find((f) => /^(date|day)$/i.test(f)) ??
    fields.find((f) => /date|day|time(stamp)?|start/i.test(f) && rows.slice(0, 20).some((r) => toDayKey(String(r[f] ?? '')) !== null));
  if (!dateCol) {
    warnings.push(`${hint || 'CSV'}: no date column found — skipped.`);
    return 0;
  }
  const valueCols = fields.filter((f) => {
    if (f === dateCol || /time|date|zone|offset|id$|source|device|type/i.test(f)) return false;
    const sample = rows.slice(0, 50).map((r) => num(r[f]));
    return sample.filter((v) => Number.isFinite(v)).length >= Math.max(1, sample.length * 0.6);
  });
  const hintMetric = guessMetric(hint);
  let n = 0;
  for (const col of valueCols) {
    let metric = guessMetric(col);
    if (!metric && valueCols.length === 1 && hintMetric) metric = hintMetric;
    if (/^value$/i.test(col) && hintMetric) metric = hintMetric;
    if (!metric) metric = `custom:${col.toLowerCase().replace(/\s+/g, '_').slice(0, 40)}`;
    let factor = 1;
    const c = col.toLowerCase();
    if (metric === 'distance_km' && /\(m\)|meters|metres|_m$/.test(c)) factor = 0.001;
    if (metric === 'distance_km' && /mile/.test(c)) factor = 1.609344;
    if (metric === 'weight_kg' && /lb|pound/.test(c)) factor = 0.45359237;
    if (metric === 'weight_kg' && /\(g\)|gram/.test(c)) factor = 0.001;
    if (metric === 'sleep_hours' && /min/.test(c)) factor = 1 / 60;
    if (metric === 'sleep_hours' && /\(ms\)|millis/.test(c)) factor = 1 / 3_600_000;
    if (metric === 'sleep_hours' && /sec/.test(c)) factor = 1 / 3600;
    const agg = SUMMABLE.has(metric) || metric === 'sleep_hours' ? 'sum' : 'mean';
    for (const r of rows) {
      const day = toDayKey(String(r[dateCol] ?? ''));
      const v = num(r[col]);
      if (!day || !Number.isFinite(v)) continue;
      if (agg === 'mean' && v === 0) continue;
      acc.add(metric, day, v * factor, agg);
      n++;
    }
  }
  return n;
}
