import { describe, expect, it } from 'vitest';
import type { MetricPoint, Note } from '../db/db';
import { DAY, dayKey } from '../lib/dates';
import { computeStatuses } from './status';
import { metricCorrelations, pearson, rollingMean, structureStats, tagCooccurrence, weeklyCounts } from './stats';

const base = new Date(2026, 0, 10, 12).getTime();
function note(i: number, feeling: number, extra: Partial<Note> = {}): Note {
  return {
    id: `n${i}`,
    date: base + i * DAY,
    createdAt: 0,
    updatedAt: 0,
    title: '',
    body: '',
    category: 'symptom',
    feeling,
    sensations: [],
    tags: [],
    locations: [{ structureId: 'knee' }],
    structureIds: ['knee'],
    links: [],
    ...extra,
  };
}

describe('pearson', () => {
  it('detects perfect and absent correlation', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
    expect(pearson([1, 2], [1, 2])).toBeNull();
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe('structure status', () => {
  it('weights recent notes more and computes an improving trend', () => {
    const notes = [note(0, -4), note(5, -2), note(10, 0), note(14, 2)];
    const st = computeStatuses(notes, { at: base + 14 * DAY, windowDays: 30 }).get('knee')!;
    expect(st.count).toBe(4);
    expect(st.score).toBeGreaterThan(-1); // mean is -1, recency pulls it up
    expect(st.slopePerWeek).toBeGreaterThan(2);
    expect(st.lastFeeling).toBe(2);
  });

  it('respects the window', () => {
    const notes = [note(0, -4), note(40, 3)];
    const st = computeStatuses(notes, { at: base + 41 * DAY, windowDays: 7 }).get('knee')!;
    expect(st.count).toBe(1);
    expect(st.score).toBe(3);
    expect(st.slopePerWeek).toBeNull();
  });
});

describe('stats', () => {
  it('correlates a metric with daily feeling (same day and next day)', () => {
    const notes: Note[] = [];
    const metrics: MetricPoint[] = [];
    for (let i = 0; i < 20; i++) {
      const sleep = 5 + (i % 5);
      metrics.push({ id: `s${i}`, date: dayKey(base + i * DAY), metric: 'sleep_hours', value: sleep, source: 't' });
      notes.push(note(i, sleep - 7, { structureIds: [], locations: [] }));
    }
    const c = metricCorrelations(notes, metrics).find((x) => x.metric === 'sleep_hours')!;
    expect(c.r0).toBeCloseTo(1);
    expect(c.n0).toBe(20);
    expect(c.n1).toBe(19);
  });

  it('summarises structures, tags and weeks', () => {
    const notes = [note(0, -3, { tags: ['a', 'b'] }), note(1, -1, { tags: ['a', 'b', 'c'] }), note(2, 1, { tags: ['a'] })];
    const s = structureStats(notes)[0];
    expect(s).toMatchObject({ structureId: 'knee', count: 3, latest: 1, first: -3 });
    expect(s.mean).toBeCloseTo(-1);
    const co = tagCooccurrence(notes, ['a', 'b', 'c']);
    expect(co.find((e) => e.a === 'a' && e.b === 'b')?.count).toBe(2);
    const w = weeklyCounts(notes, 4, base + 3 * DAY);
    expect(w.reduce((t, x) => t + x.count, 0)).toBe(3);
    const r = rollingMean([{ x: 0, y: 1 }, { x: DAY, y: 3 }, { x: 10 * DAY, y: 5 }], 7);
    expect(r.map((p) => p.y)).toEqual([1, 2, 5]);
  });
});
