// Analysis helpers for insights and reports.
import type { MetricPoint, Note } from '../db/db';
import { DAY, dayKey, parseDayKey, startOfDay } from '../lib/dates';
import { linearSlope } from './status';

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export function correlationStrength(r: number | null, n: number): string {
  if (r === null || n < 10) return 'Not enough data';
  const a = Math.abs(r);
  const dir = r > 0 ? 'positive' : 'negative';
  if (a < 0.1) return 'No clear link';
  if (a < 0.3) return `Weak ${dir}`;
  if (a < 0.5) return `Moderate ${dir}`;
  return `Strong ${dir}`;
}

/** Mean feeling per local day. */
export function dailyMeanFeeling(notes: Note[]): Map<string, { mean: number; count: number }> {
  const m = new Map<string, { s: number; c: number }>();
  for (const n of notes) {
    const k = dayKey(n.date);
    const e = m.get(k) ?? { s: 0, c: 0 };
    e.s += n.feeling;
    e.c++;
    m.set(k, e);
  }
  return new Map([...m.entries()].map(([k, e]) => [k, { mean: e.s / e.c, count: e.c }]));
}

/** Trailing rolling mean over `days` calendar days (only days with data contribute). */
export function rollingMean(points: { x: number; y: number }[], days: number): { x: number; y: number }[] {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  return sorted.map((p) => {
    const win = sorted.filter((q) => q.x <= p.x && q.x > p.x - days * DAY);
    return { x: p.x, y: win.reduce((s, q) => s + q.y, 0) / win.length };
  });
}

export interface MetricCorrelation {
  metric: string;
  /** Same-day correlation with daily feeling. */
  r0: number | null;
  n0: number;
  /** Metric on day D vs feeling on day D+1. */
  r1: number | null;
  n1: number;
}

export function metricCorrelations(notes: Note[], metrics: MetricPoint[]): MetricCorrelation[] {
  const feel = dailyMeanFeeling(notes);
  const byMetric = new Map<string, Map<string, number>>();
  for (const p of metrics) {
    let m = byMetric.get(p.metric);
    if (!m) byMetric.set(p.metric, (m = new Map()));
    m.set(p.date, p.value);
  }
  const out: MetricCorrelation[] = [];
  for (const [metric, vals] of byMetric) {
    const x0: number[] = [], y0: number[] = [], x1: number[] = [], y1: number[] = [];
    for (const [d, v] of vals) {
      const f = feel.get(d);
      if (f) { x0.push(v); y0.push(f.mean); }
      const next = feel.get(dayKey(parseDayKey(d) + DAY + 3_600_000));
      if (next) { x1.push(v); y1.push(next.mean); }
    }
    out.push({ metric, r0: pearson(x0, y0), n0: x0.length, r1: pearson(x1, y1), n1: x1.length });
  }
  return out.sort((a, b) => Math.abs(b.r0 ?? 0) - Math.abs(a.r0 ?? 0));
}

export interface StructureStat {
  structureId: string;
  count: number;
  mean: number;
  latest: number;
  latestDate: number;
  first: number;
  slopePerWeek: number | null;
}

export function structureStats(notes: Note[]): StructureStat[] {
  const m = new Map<string, Note[]>();
  for (const n of notes) for (const s of n.structureIds) m.set(s, [...(m.get(s) ?? []), n]);
  const out: StructureStat[] = [];
  for (const [structureId, ns] of m) {
    const sorted = [...ns].sort((a, b) => a.date - b.date);
    const xs = sorted.map((n) => n.date / DAY), ys = sorted.map((n) => n.feeling);
    const span = xs[xs.length - 1] - xs[0];
    const slope = linearSlope(xs, ys);
    out.push({
      structureId,
      count: ns.length,
      mean: ys.reduce((a, b) => a + b, 0) / ys.length,
      latest: ys[ys.length - 1],
      latestDate: sorted[sorted.length - 1].date,
      first: ys[0],
      slopePerWeek: slope !== null && span >= 1 ? slope * 7 : null,
    });
  }
  return out.sort((a, b) => b.count - a.count || a.mean - b.mean);
}

export interface TagStat {
  tag: string;
  count: number;
  mean: number;
}

export function tagStats(notes: Note[], exclude: string[] = ['demo']): TagStat[] {
  const m = new Map<string, { s: number; c: number }>();
  for (const n of notes)
    for (const t of n.tags) {
      if (exclude.includes(t)) continue;
      const e = m.get(t) ?? { s: 0, c: 0 };
      e.s += n.feeling;
      e.c++;
      m.set(t, e);
    }
  return [...m.entries()].map(([tag, e]) => ({ tag, count: e.c, mean: e.s / e.c })).sort((a, b) => b.count - a.count);
}

export function tagCooccurrence(notes: Note[], tags: string[]): { a: string; b: string; count: number }[] {
  const set = new Set(tags);
  const m = new Map<string, number>();
  for (const n of notes) {
    const ts = n.tags.filter((t) => set.has(t)).sort();
    for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++) {
        const k = `${ts[i]}\u0000${ts[j]}`;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
  }
  return [...m.entries()].map(([k, count]) => {
    const [a, b] = k.split('\u0000');
    return { a, b, count };
  });
}

/** Count notes per ISO-ish week (weeks start Monday), for the last `weeks` weeks. */
export function weeklyCounts(notes: Note[], weeks: number, now = Date.now()): { weekStart: number; count: number; minutes: number }[] {
  const today = startOfDay(now);
  const dow = (new Date(today).getDay() + 6) % 7;
  const thisWeek = today - dow * DAY;
  const out = Array.from({ length: weeks }, (_, i) => ({ weekStart: thisWeek - (weeks - 1 - i) * 7 * DAY, count: 0, minutes: 0 }));
  for (const n of notes) {
    const i = Math.floor((startOfDay(n.date) - out[0].weekStart) / (7 * DAY));
    if (i >= 0 && i < weeks) {
      out[i].count++;
      out[i].minutes += n.workout?.durationMin ?? 0;
    }
  }
  return out;
}

export function sensationCounts(notes: Note[]): { id: string; count: number }[] {
  const m = new Map<string, number>();
  for (const n of notes) for (const s of n.sensations) m.set(s, (m.get(s) ?? 0) + 1);
  return [...m.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
}

export function mean(vs: number[]): number | null {
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
}
