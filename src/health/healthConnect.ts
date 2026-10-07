// Android Health Connect export ("Health Connect.zip" → health_connect_export.db).
// The export is a SQLite database. Table/column names follow Health Connect's
// internal schema (e.g. steps_record_table.count); we look columns up by
// candidate names so small schema differences between versions don't break it.
import type { Database, SqlJsStatic } from 'sql.js';
import type { Activity } from '../db/db';
import { DailyAccumulator, localDay, type Agg } from './metrics';

interface Spec {
  table: RegExp;
  metric: string;
  value: string[];
  time: string[];
  offset: string[];
  agg: Agg;
  /** Convert the stored value to the metric unit; `values` lets us detect units. */
  scale?: (values: number[]) => number;
}

const START = ['start_time', 'time', 'epoch_millis'];
const OFFSET = ['start_zone_offset', 'zone_offset'];

const median = (vs: number[]) => {
  if (!vs.length) return 0;
  const s = [...vs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const SPECS: Spec[] = [
  { table: /^steps_record_table$/, metric: 'steps', value: ['count'], time: START, offset: OFFSET, agg: 'sum' },
  { table: /^distance_record_table$/, metric: 'distance_km', value: ['distance'], time: START, offset: OFFSET, agg: 'sum', scale: () => 0.001 },
  // energy is stored in small calories; fall back to kcal if values are already small
  { table: /^total_calories_burned_record_table$/, metric: 'calories_kcal', value: ['energy'], time: START, offset: OFFSET, agg: 'sum', scale: (v) => (median(v) > 5000 ? 0.001 : 1) },
  { table: /^active_calories_burned_record_table$/, metric: 'active_kcal', value: ['energy'], time: START, offset: OFFSET, agg: 'sum', scale: (v) => (median(v) > 2000 ? 0.001 : 1) },
  { table: /^resting_heart_rate_record_table$/, metric: 'resting_hr', value: ['beats_per_minute', 'bpm'], time: START, offset: OFFSET, agg: 'mean' },
  { table: /^heart_rate_variability_rmssd_record_table$/, metric: 'hrv_ms', value: ['heart_rate_variability_millis', 'rmssd'], time: START, offset: OFFSET, agg: 'mean' },
  // weight is stored in grams
  { table: /^weight_record_table$/, metric: 'weight_kg', value: ['weight'], time: START, offset: OFFSET, agg: 'mean', scale: (v) => (median(v) > 500 ? 0.001 : 1) },
  { table: /^oxygen_saturation_record_table$/, metric: 'spo2', value: ['percentage'], time: START, offset: OFFSET, agg: 'mean' },
  { table: /^respiratory_rate_record_table$/, metric: 'respiratory_rate', value: ['rate'], time: START, offset: OFFSET, agg: 'mean' },
];

// A few Health Connect ExerciseSessionRecord type constants.
const EXERCISE_TYPES: Record<number, string> = {
  8: 'Biking',
  25: 'Elliptical',
  36: 'HIIT',
  37: 'Hiking',
  56: 'Running',
  70: 'Strength training',
  74: 'Swimming (pool)',
  79: 'Walking',
  81: 'Weightlifting',
  83: 'Yoga',
};

function columns(db: Database, table: string): string[] {
  const r = db.exec(`PRAGMA table_info("${table.replace(/"/g, '')}")`);
  return r[0]?.values.map((v) => String(v[1])) ?? [];
}

function pick(cols: string[], cands: string[]): string | undefined {
  return cands.find((c) => cols.includes(c));
}

function each(db: Database, sql: string, fn: (row: Record<string, unknown>) => void): void {
  const st = db.prepare(sql);
  try {
    while (st.step()) fn(st.getAsObject());
  } finally {
    st.free();
  }
}

export function parseHealthConnect(SQL: SqlJsStatic, bytes: Uint8Array, acc: DailyAccumulator, activities: Activity[], log: string[]): void {
  const db = new SQL.Database(bytes);
  try {
    const tables = (db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]?.values ?? []).map((v) => String(v[0]));
    log.push(`Health Connect database with ${tables.length} tables`);

    for (const spec of SPECS) {
      const table = tables.find((t) => spec.table.test(t));
      if (!table) continue;
      const cols = columns(db, table);
      const vc = pick(cols, spec.value), tc = pick(cols, spec.time), oc = pick(cols, spec.offset);
      if (!vc || !tc) continue;
      const rows: { v: number; t: number; o: number | null }[] = [];
      each(db, `SELECT "${vc}" AS v, "${tc}" AS t${oc ? `, "${oc}" AS o` : ''} FROM "${table}"`, (r) => {
        const v = Number(r.v), t = Number(r.t);
        if (Number.isFinite(v) && Number.isFinite(t)) rows.push({ v, t, o: r.o === undefined || r.o === null ? null : Number(r.o) });
      });
      const k = spec.scale ? spec.scale(rows.map((r) => r.v)) : 1;
      for (const r of rows) acc.add(spec.metric, localDay(r.t, r.o), r.v * k, spec.agg, r.t);
      if (rows.length) log.push(`${table}: ${rows.length} records`);
    }

    // Heart rate samples live in a child "series" table.
    const hrSeries = tables.find((t) => /^heart_rate_record_series_table$/.test(t));
    if (hrSeries) {
      const cols = columns(db, hrSeries);
      const bc = pick(cols, ['beats_per_minute', 'bpm']), ec = pick(cols, ['epoch_millis', 'time']);
      if (bc && ec) {
        let n = 0;
        each(db, `SELECT "${bc}" AS v, "${ec}" AS t FROM "${hrSeries}"`, (r) => {
          const v = Number(r.v), t = Number(r.t);
          if (v > 0 && Number.isFinite(t)) {
            acc.add('heart_rate_avg', localDay(t), v, 'mean');
            n++;
          }
        });
        if (n) log.push(`${hrSeries}: ${n} samples`);
      }
    }

    // Sleep sessions → hours asleep credited to the wake-up day.
    const sleep = tables.find((t) => /^sleep_session_record_table$/.test(t));
    if (sleep) {
      const cols = columns(db, sleep);
      const sc = pick(cols, ['start_time']), ec = pick(cols, ['end_time']), oc = pick(cols, ['end_zone_offset', 'start_zone_offset']);
      if (sc && ec) {
        let n = 0;
        each(db, `SELECT "${sc}" AS s, "${ec}" AS e${oc ? `, "${oc}" AS o` : ''} FROM "${sleep}"`, (r) => {
          const s = Number(r.s), e = Number(r.e);
          if (e > s && e - s < 20 * 3_600_000) {
            acc.add('sleep_hours', localDay(e, r.o === undefined || r.o === null ? null : Number(r.o)), (e - s) / 3_600_000, 'sum');
            n++;
          }
        });
        if (n) log.push(`${sleep}: ${n} sessions`);
      }
    }

    const ex = tables.find((t) => /^exercise_session_record_table$/.test(t));
    if (ex) {
      const cols = columns(db, ex);
      const sc = pick(cols, ['start_time']), ec = pick(cols, ['end_time']);
      const tc = pick(cols, ['exercise_type']), nc = pick(cols, ['title']), ic = pick(cols, ['uuid', 'row_id']);
      if (sc && ec) {
        each(db, `SELECT * FROM "${ex}"`, (r) => {
          const s = Number(r[sc]), e = Number(r[ec]);
          if (!(e > s)) return;
          const type = tc ? Number(r[tc]) : NaN;
          const name = (nc && r[nc] ? String(r[nc]) : '') || EXERCISE_TYPES[type] || (Number.isFinite(type) ? `Workout (type ${type})` : 'Workout');
          const rawId = ic ? r[ic] : s;
          const id = rawId instanceof Uint8Array ? Array.from(rawId.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('') : String(rawId);
          activities.push({
            id: `hc-${id}`,
            start: s,
            end: e,
            type: (EXERCISE_TYPES[type] ?? 'WORKOUT').toUpperCase().replace(/\s+/g, '_'),
            name,
            durationMin: Math.round((e - s) / 60000),
            source: 'Health Connect',
          });
        });
      }
    }
  } finally {
    db.close();
  }
}
