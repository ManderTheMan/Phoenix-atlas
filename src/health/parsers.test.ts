import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import initSqlJs from 'sql.js';
import { createRequire } from 'node:module';
import { DailyAccumulator } from './metrics';
import { parseFitDailySummary, parseFitSession, parseFitbitJson, parseGenericCsv, toDayKey, finishFitbit, type FitbitContext } from './parsers';
import { ImportSession } from './importer';
import { parseHealthConnect } from './healthConnect';
import { chunks, exerciseToActivity, syncGoogleHealth } from './googleHealthApi';
import type { Activity } from '../db/db';

const byId = (r: { id: string; value: number }[]) => Object.fromEntries(r.map((m) => [m.id, m.value]));

describe('dates', () => {
  it('normalises date spellings', () => {
    expect(toDayKey('2024-03-05')).toBe('2024-03-05');
    expect(toDayKey('03/05/24 00:00:00')).toBe('2024-03-05');
    expect(toDayKey('20240305')).toBe('2024-03-05');
    expect(toDayKey('nonsense')).toBeNull();
  });
});

describe('Google Fit takeout', () => {
  it('reads the daily activity metrics summary', () => {
    const csv = [
      'Date,Move Minutes count,Calories (kcal),Distance (m),Heart Points,Average heart rate (bpm),Step count,Average weight (kg)',
      '2024-03-05,42,2310.5,6250.0,18,71.2,8123,80.4',
      '2024-03-06,,2100,,,,5000,',
    ].join('\n');
    const acc = new DailyAccumulator();
    expect(parseFitDailySummary(csv, acc)).toBeGreaterThan(0);
    const v = byId(acc.points('fit'));
    expect(v['steps|2024-03-05']).toBe(8123);
    expect(v['distance_km|2024-03-05']).toBeCloseTo(6.25);
    expect(v['active_minutes|2024-03-05']).toBe(42);
    expect(v['weight_kg|2024-03-05']).toBeCloseTo(80.4);
    expect(v['steps|2024-03-06']).toBe(5000);
    expect(v['weight_kg|2024-03-06']).toBeUndefined();
  });

  it('reads a session json', () => {
    const a = parseFitSession(JSON.stringify({
      fitnessActivity: 'running', startTime: '2024-03-05T07:00:00.000Z', endTime: '2024-03-05T07:31:00.000Z', duration: '1860.000s',
      aggregate: [
        { metricName: 'com.google.calories.expended', floatValue: 321.4 },
        { metricName: 'com.google.step_count.delta', intValue: 4100 },
        { metricName: 'com.google.distance.delta', floatValue: 5230.0 },
      ],
    }))!;
    expect(a.name).toBe('Running');
    expect(a.durationMin).toBe(31);
    expect(a.distanceKm).toBeCloseTo(5.23);
    expect(a.calories).toBe(321);
    expect(a.steps).toBe(4100);
  });
});

describe('Fitbit takeout', () => {
  it('sums steps, averages heart rate, reads sleep, resting HR and exercise', () => {
    const acc = new DailyAccumulator();
    const ctx: FitbitContext = { weights: [] };
    const acts: Activity[] = [];
    parseFitbitJson('Takeout/Fitbit/Global Export Data/steps-2024-03-05.json', JSON.stringify([
      { dateTime: '03/05/24 08:00:00', value: '100' }, { dateTime: '03/05/24 08:01:00', value: '50' }, { dateTime: '03/06/24 08:00:00', value: '7' },
    ]), acc, ctx, acts);
    parseFitbitJson('Global Export Data/heart_rate-2024-03-05.json', JSON.stringify([
      { dateTime: '03/05/24 08:00:05', value: { bpm: 60, confidence: 2 } }, { dateTime: '03/05/24 08:00:10', value: { bpm: 80, confidence: 2 } },
    ]), acc, ctx, acts);
    parseFitbitJson('resting_heart_rate-2024-03-05.json', JSON.stringify([
      { dateTime: '03/05/24 00:00:00', value: { date: '03/05/24', value: 57.6, error: 6.2 } }, { dateTime: '03/06/24 00:00:00', value: { date: '03/06/24', value: 0, error: 0 } },
    ]), acc, ctx, acts);
    parseFitbitJson('sleep-2024-03-05.json', JSON.stringify([
      { dateOfSleep: '2024-03-05', minutesAsleep: 420, mainSleep: true }, { dateOfSleep: '2024-03-05', minutesAsleep: 30, mainSleep: false },
    ]), acc, ctx, acts);
    parseFitbitJson('weight-2024-03-05.json', JSON.stringify([{ weight: 176.4, date: '03/05/24', time: '07:00:00' }]), acc, ctx, acts);
    parseFitbitJson('exercise-0.json', JSON.stringify([
      { logId: 1, activityName: 'Run', averageHeartRate: 150, calories: 400, activeDuration: 1800000, steps: 4000, startTime: '03/05/24 07:00:00', distance: 3.1, distanceUnit: 'Mile' },
    ]), acc, ctx, acts);
    ctx.weightUnit = 'lb';
    finishFitbit(ctx, acc, []);
    const v = byId(acc.points('fitbit'));
    expect(v['steps|2024-03-05']).toBe(150);
    expect(v['steps|2024-03-06']).toBe(7);
    expect(v['heart_rate_avg|2024-03-05']).toBe(70);
    expect(v['resting_hr|2024-03-05']).toBeCloseTo(57.6);
    expect(v['resting_hr|2024-03-06']).toBeUndefined();
    expect(v['sleep_hours|2024-03-05']).toBeCloseTo(7.5);
    expect(v['weight_kg|2024-03-05']).toBeCloseTo(80.0, 0);
    expect(acts[0]).toMatchObject({ name: 'Run', durationMin: 30, avgHr: 150 });
    expect(acts[0].distanceKm).toBeCloseTo(4.99, 1);
  });
});

describe('generic CSV', () => {
  it('maps known columns and keeps unknown ones as custom metrics', () => {
    const acc = new DailyAccumulator();
    const csv = 'date,steps,resting heart rate,sleep (min),mood score\n2024-01-01,9000,55,450,7\n2024-01-02,4000,58,390,5\n';
    const warnings: string[] = [];
    expect(parseGenericCsv(csv, acc, 'export', warnings)).toBe(8);
    const v = byId(acc.points('csv'));
    expect(v['steps|2024-01-01']).toBe(9000);
    expect(v['resting_hr|2024-01-02']).toBe(58);
    expect(v['sleep_hours|2024-01-01']).toBeCloseTo(7.5);
    expect(v['custom:mood_score|2024-01-02']).toBe(5);
  });

  it('aggregates intraday rows per day using the file name as a hint', () => {
    const acc = new DailyAccumulator();
    parseGenericCsv('timestamp,value\n2024-01-01 08:00:00,100\n2024-01-01 09:00:00,250\n', acc, 'steps_2024-01');
    expect(byId(acc.points('x'))['steps|2024-01-01']).toBe(350);
  });
});

describe('zip import session', () => {
  it('routes takeout entries to the right parsers', async () => {
    const zip = zipSync({
      'Takeout/Fit/Daily activity metrics/Daily activity metrics.csv': strToU8('Date,Step count\n2024-02-01,1234\n'),
      'Takeout/Fit/Daily activity metrics/2024-02-01.csv': strToU8('Start time,End time,Step count\n00:00:00.000+01:00,00:15:00.000+01:00,99999\n'),
      'Takeout/Fit/Daily activity metrics/2024-02-02.csv': strToU8('Start time,End time,Step count\n00:00:00.000+01:00,00:15:00.000+01:00,10\n08:00:00.000+01:00,08:15:00.000+01:00,20\n'),
      'Takeout/Fit/All Sessions/2024-02-01T07_00_00Z_RUNNING.json': strToU8(JSON.stringify({ fitnessActivity: 'running', startTime: '2024-02-01T07:00:00Z', endTime: '2024-02-01T07:20:00Z' })),
      'Takeout/Mail/All mail.mbox': strToU8('ignored'),
    });
    const s = new ImportSession();
    const { unzipSync } = await import('fflate');
    for (const [name, data] of Object.entries(unzipSync(zip))) if (ImportSession.wanted(name)) s.handle(name, data);
    const r = await s.finish();
    const v = byId(r.metrics);
    expect(v['steps|2024-02-01']).toBe(1234); // summary wins over the interval file
    expect(v['steps|2024-02-02']).toBe(30); // interval file fills the gap
    expect(r.activities).toHaveLength(1);
    expect(r.source).toBe('Google Fit');
  });
});

describe('Health Connect export', () => {
  it('reads records from the exported SQLite database', async () => {
    const require = createRequire(import.meta.url);
    const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) });
    const db = new SQL.Database();
    const t = Date.UTC(2024, 4, 10, 8, 0, 0);
    db.run(`CREATE TABLE steps_record_table (row_id INTEGER PRIMARY KEY, count INTEGER, start_time INTEGER, end_time INTEGER, start_zone_offset INTEGER)`);
    db.run(`INSERT INTO steps_record_table (count, start_time, end_time, start_zone_offset) VALUES (500, ${t}, ${t + 60000}, 0), (700, ${t + 3600000}, ${t + 3660000}, 0)`);
    db.run(`CREATE TABLE weight_record_table (row_id INTEGER PRIMARY KEY, weight REAL, time INTEGER, zone_offset INTEGER)`);
    db.run(`INSERT INTO weight_record_table (weight, time, zone_offset) VALUES (80500, ${t}, 0)`);
    db.run(`CREATE TABLE heart_rate_record_series_table (row_id INTEGER PRIMARY KEY, beats_per_minute INTEGER, epoch_millis INTEGER, parent_key INTEGER)`);
    db.run(`INSERT INTO heart_rate_record_series_table (beats_per_minute, epoch_millis, parent_key) VALUES (60, ${t}, 1), (90, ${t + 1000}, 1)`);
    db.run(`CREATE TABLE sleep_session_record_table (row_id INTEGER PRIMARY KEY, start_time INTEGER, end_time INTEGER, end_zone_offset INTEGER)`);
    db.run(`INSERT INTO sleep_session_record_table (start_time, end_time, end_zone_offset) VALUES (${t - 9 * 3600000}, ${t - 1800000}, 0)`);
    db.run(`CREATE TABLE exercise_session_record_table (row_id INTEGER PRIMARY KEY, uuid BLOB, start_time INTEGER, end_time INTEGER, exercise_type INTEGER, title TEXT)`);
    db.run(`INSERT INTO exercise_session_record_table (uuid, start_time, end_time, exercise_type, title) VALUES (x'0102030405060708', ${t}, ${t + 45 * 60000}, 56, NULL)`);
    const bytes = db.export();
    db.close();
    const acc = new DailyAccumulator();
    const acts: Activity[] = [];
    parseHealthConnect(SQL, bytes, acc, acts, []);
    const v = byId(acc.points('hc'));
    expect(v['steps|2024-05-10']).toBe(1200);
    expect(v['weight_kg|2024-05-10']).toBeCloseTo(80.5);
    expect(v['heart_rate_avg|2024-05-10']).toBe(75);
    expect(v['sleep_hours|2024-05-10']).toBeCloseTo(8.5);
    expect(acts[0]).toMatchObject({ name: 'Running', durationMin: 45, id: 'hc-0102030405060708' });
  });
});

describe('Google Health API', () => {
  it('splits ranges into API-sized chunks', () => {
    expect(chunks('2024-01-01', '2024-01-31', 14)).toEqual([
      ['2024-01-01', '2024-01-15'],
      ['2024-01-15', '2024-01-29'],
      ['2024-01-29', '2024-01-31'],
    ]);
  });

  it('maps exercise data points to activities', () => {
    const a = exerciseToActivity({
      name: 'users/me/dataTypes/exercise/dataPoints/abc123',
      exercise: {
        exerciseType: 'RUNNING', displayName: 'Run', activeDuration: '1800s',
        interval: { startTime: '2024-03-05T07:00:00Z', endTime: '2024-03-05T07:35:00Z' },
        metricsSummary: { caloriesKcal: 350.2, distanceMillimeters: 5012000, averageHeartRateBeatsPerMinute: '151', steps: '4800' },
      },
    })!;
    expect(a).toMatchObject({ id: 'ghealth-abc123', name: 'Run', durationMin: 30, calories: 350, avgHr: 151, steps: 4800 });
    expect(a.distanceKm).toBeCloseTo(5.01);
  });

  it('syncs rollups and lists with a mocked API', async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
      if (url.includes('/steps/dataPoints:dailyRollUp'))
        return ok({ rollupDataPoints: [{ civilStartTime: { date: { year: 2024, month: 3, day: 5 } }, steps: { countSum: '8123' } }] });
      if (url.includes('/heart-rate/dataPoints:dailyRollUp'))
        return ok({ rollupDataPoints: [{ civilStartTime: { date: { year: 2024, month: 3, day: 5 } }, heartRate: { beatsPerMinuteAvg: 72.4 } }] });
      if (url.includes('/daily-resting-heart-rate/dataPoints?'))
        return ok({ dataPoints: [{ dailyRestingHeartRate: { date: { year: 2024, month: 3, day: 5 }, beatsPerMinute: '54' } }] });
      if (url.includes('/sleep/dataPoints?'))
        return ok({ dataPoints: [{ sleep: { summary: { minutesAsleep: '432' }, interval: { civilEndTime: { date: { year: 2024, month: 3, day: 5 } } } } }] });
      if (url.includes('/weight/')) return new Response(JSON.stringify({ error: { message: 'Permission denied' } }), { status: 403 });
      return ok({});
    }) as unknown as typeof fetch;
    const r = await syncGoogleHealth('tok', '2024-03-01', '2024-03-08', undefined, fake);
    const v = byId(r.metrics);
    expect(v['steps|2024-03-05']).toBe(8123);
    expect(v['heart_rate_avg|2024-03-05']).toBeCloseTo(72.4);
    expect(v['resting_hr|2024-03-05']).toBe(54);
    expect(v['sleep_hours|2024-03-05']).toBeCloseTo(7.2);
    expect(r.warnings.some((w) => w.includes('weight') && w.includes('Permission denied'))).toBe(true);
    const rollup = calls.find((c) => c.url.includes('steps/dataPoints:dailyRollUp'))!;
    expect(rollup.body).toMatchObject({ range: { start: { date: { year: 2024, month: 3, day: 1 } }, end: { date: { year: 2024, month: 3, day: 8 } } }, windowSizeDays: 1 });
    const list = calls.find((c) => c.url.includes('daily-resting-heart-rate'))!;
    expect(list.url).not.toContain('+');
    expect(new URL(list.url).searchParams.get('filter')).toBe('daily_resting_heart_rate.date >= "2024-03-01" AND daily_resting_heart_rate.date < "2024-03-08"');
  });
});
