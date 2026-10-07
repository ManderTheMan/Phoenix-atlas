// Turns notes into a per-structure status at a point in time: a recency-weighted
// feeling, a trend, and how much has been logged. This drives the body colours.
import type { Note } from '../db/db';
import { DAY } from '../lib/dates';

export interface StructureStatus {
  structureId: string;
  /** Recency-weighted mean feeling in the window (-5..5). */
  score: number;
  /** 0..1 — how much evidence (number and recency of notes). */
  confidence: number;
  count: number;
  lastDate: number;
  lastFeeling: number;
  /** Feeling change per week from a least-squares fit (positive = improving). */
  slopePerWeek: number | null;
}

export interface StatusOptions {
  /** End of the window (defaults to now). */
  at?: number;
  /** Window length in days; 0 = all time. */
  windowDays: number;
}

export function notesInWindow(notes: Note[], { at = Date.now(), windowDays }: StatusOptions): Note[] {
  const from = windowDays > 0 ? at - windowDays * DAY : -Infinity;
  return notes.filter((n) => n.date <= at && n.date >= from);
}

export function linearSlope(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

export function computeStatuses(notes: Note[], opts: StatusOptions): Map<string, StructureStatus> {
  const at = opts.at ?? Date.now();
  const inWin = notesInWindow(notes, { at, windowDays: opts.windowDays });
  // half-life: a third of the window (or 30 days for "all time")
  const tau = (opts.windowDays > 0 ? opts.windowDays / 3 : 30) * DAY;
  const acc = new Map<string, { w: number; ws: number; xs: number[]; ys: number[]; last: Note }>();
  for (const n of inWin) {
    const w = Math.exp(-(at - n.date) / tau);
    for (const sid of n.structureIds) {
      let a = acc.get(sid);
      if (!a) acc.set(sid, (a = { w: 0, ws: 0, xs: [], ys: [], last: n }));
      a.w += w;
      a.ws += w * n.feeling;
      a.xs.push(n.date / DAY);
      a.ys.push(n.feeling);
      if (n.date >= a.last.date) a.last = n;
    }
  }
  const out = new Map<string, StructureStatus>();
  for (const [sid, a] of acc) {
    const slope = linearSlope(a.xs, a.ys);
    const span = a.xs.length ? Math.max(...a.xs) - Math.min(...a.xs) : 0;
    out.set(sid, {
      structureId: sid,
      score: a.ws / a.w,
      confidence: 1 - Math.exp(-a.w * 1.6),
      count: a.xs.length,
      lastDate: a.last.date,
      lastFeeling: a.last.feeling,
      slopePerWeek: slope !== null && span >= 1 ? slope * 7 : null,
    });
  }
  return out;
}

/** Daily mean feeling for a set of notes, as [dayStart, mean, count]. */
export function dailyFeeling(notes: Note[]): { day: number; mean: number; count: number }[] {
  const m = new Map<number, { s: number; c: number }>();
  for (const n of notes) {
    const d = new Date(n.date);
    d.setHours(0, 0, 0, 0);
    const k = d.getTime();
    const e = m.get(k) ?? { s: 0, c: 0 };
    e.s += n.feeling;
    e.c++;
    m.set(k, e);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([day, e]) => ({ day, mean: e.s / e.c, count: e.c }));
}
