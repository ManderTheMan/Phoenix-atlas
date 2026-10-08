// What your logged training adds up to: weekly sets per movement pattern and
// per muscle group (prime movers count a full set, synergists half, stabilisers
// a quarter), the balance between patterns, and how each group has felt.
import { computeStatuses } from '../analysis/status';
import type { Activity, Note } from '../db/db';
import { DAY, startOfDay } from '../lib/dates';
import { GROUPS, groupStructures, type GroupId } from './groups';
import { classifyExercise, PATTERN_BY_ID, PATTERNS, type PatternId, type Role } from './patterns';

export const ROLE_SETS: Record<Role, number> = { prime: 1, synergist: 0.5, stabiliser: 0.25 };

export interface LoggedExercise {
  date: number;
  noteId?: string;
  name: string;
  sets: number;
  setsLogged: boolean;
  reps?: number;
  load?: number;
  unit?: 'kg' | 'lb';
  pattern?: PatternId;
  variant?: string;
  groups: { group: GroupId; sets: number }[];
}

const GAIT_TYPES = /run|jog|walk|hik|trail|treadmill/i;

/** Every exercise in the notes (plus runs and walks from imported activities), classified. */
export function loggedExercises(notes: Note[], activities: Activity[] = []): { exercises: LoggedExercise[]; unclassified: string[] } {
  const out: LoggedExercise[] = [];
  const unclassified = new Map<string, number>();
  const gaitDays = new Set<number>();
  for (const n of notes) {
    for (const ex of n.workout?.exercises ?? []) {
      const m = classifyExercise(ex.name);
      if (!m) {
        unclassified.set(ex.name, (unclassified.get(ex.name) ?? 0) + 1);
        continue;
      }
      const setsLogged = typeof ex.sets === 'number' && ex.sets > 0;
      const sets = setsLogged ? ex.sets! : 1;
      const tags = m.pattern ? PATTERN_BY_ID.get(m.pattern)!.groups.map((g) => ({ group: g.group, role: g.role })) : m.groups ?? [];
      if (m.pattern === 'gait') gaitDays.add(startOfDay(n.date));
      out.push({
        date: n.date,
        noteId: n.id,
        name: ex.name,
        sets,
        setsLogged,
        reps: ex.reps,
        load: ex.load,
        unit: ex.unit,
        pattern: m.pattern,
        variant: m.variant,
        groups: m.pattern === 'gait' ? [] : tags.map((t) => ({ group: t.group, sets: sets * ROLE_SETS[t.role] })),
      });
    }
  }
  for (const a of activities) {
    if (a.noteId || !GAIT_TYPES.test(`${a.type} ${a.name}`) || gaitDays.has(startOfDay(a.start))) continue;
    out.push({ date: a.start, name: a.name || a.type, sets: 1, setsLogged: false, pattern: 'gait', variant: 'run', groups: [] });
  }
  out.sort((a, b) => a.date - b.date);
  return { exercises: out, unclassified: [...unclassified.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n) };
}

export interface TrainingSummary {
  weeks: number;
  from: number;
  to: number;
  /** Average sets per week (gait: sessions per week). */
  patternPerWeek: Record<PatternId, number>;
  groupPerWeek: Record<GroupId, number>;
  /** Weekly series for charts: [week start, sets per pattern]. */
  weekly: { start: number; byPattern: Record<PatternId, number> }[];
  balance: {
    pushPull: number | null;
    horizontal: number | null;
    vertical: number | null;
    kneeHip: number | null;
    upperLower: number | null;
  };
  /** Average feeling of each group's muscles in the window (only groups with notes). */
  groupFeeling: Partial<Record<GroupId, { score: number; count: number }>>;
  insights: { tone: 'good' | 'warn' | 'info'; text: string }[];
  unclassified: string[];
  sessions: number;
}

const zero = <K extends string>(keys: K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const ratio = (a: number, b: number) => (a + b < 1 ? null : b === 0 ? Infinity : a / b);

export function summarizeTraining(notes: Note[], activities: Activity[], opts: { weeks: number; at?: number }): TrainingSummary {
  const to = startOfDay(opts.at ?? Date.now()) + DAY;
  const from = to - opts.weeks * 7 * DAY;
  const { exercises, unclassified } = loggedExercises(notes.filter((n) => n.date >= from && n.date < to), activities.filter((a) => a.start >= from && a.start < to));
  const patternIds = PATTERNS.map((p) => p.id);
  const groupIds = GROUPS.map((g) => g.id);
  const patternTotal = zero(patternIds), groupTotal = zero(groupIds);
  const weekly = Array.from({ length: opts.weeks }, (_, i) => ({ start: from + i * 7 * DAY, byPattern: zero(patternIds) }));
  const sessionDays = new Set<number>();
  for (const e of exercises) {
    const w = Math.min(opts.weeks - 1, Math.floor((e.date - from) / (7 * DAY)));
    if (e.pattern) {
      patternTotal[e.pattern] += e.sets;
      weekly[w].byPattern[e.pattern] += e.sets;
    }
    for (const g of e.groups) groupTotal[g.group] += g.sets;
    sessionDays.add(startOfDay(e.date));
  }
  const perWeek = <K extends string>(r: Record<K, number>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, (v as number) / opts.weeks])) as Record<K, number>;
  const patternPerWeek = perWeek(patternTotal);
  const groupPerWeek = perWeek(groupTotal);
  const push = patternPerWeek.pushH + patternPerWeek.pushV, pull = patternPerWeek.pullH + patternPerWeek.pullV;
  const knee = patternPerWeek.squat + patternPerWeek.lunge, hip = patternPerWeek.hinge;
  const upper = push + pull, lower = knee + hip;
  const balance = {
    pushPull: ratio(push, pull),
    horizontal: ratio(patternPerWeek.pushH, patternPerWeek.pullH),
    vertical: ratio(patternPerWeek.pushV, patternPerWeek.pullV),
    kneeHip: ratio(knee, hip),
    upperLower: ratio(upper, lower),
  };

  // how each group has felt
  const statuses = computeStatuses(notes, { at: to - 1, windowDays: opts.weeks * 7 });
  const groupFeeling: TrainingSummary['groupFeeling'] = {};
  for (const g of GROUPS) {
    let s = 0, c = 0;
    for (const id of groupStructures(g.id)) {
      const st = statuses.get(id);
      if (st) (s += st.score * st.count), (c += st.count);
    }
    if (c) groupFeeling[g.id] = { score: s / c, count: c };
  }

  const insights: TrainingSummary['insights'] = [];
  const r1 = (v: number) => Math.round(v * 10) / 10;
  if (balance.pushPull !== null) {
    if (balance.pushPull > 1.25)
      insights.push({ tone: 'warn', text: `You push more than you pull: ${r1(push)} vs ${r1(pull)} sets a week (${balance.pushPull === Infinity ? 'no pulling' : `${r1(balance.pushPull)}:1`}). Many coaches aim for at least as much pulling as pushing to keep the shoulders balanced.` });
    else if (balance.pushPull < 0.8) insights.push({ tone: 'info', text: `You pull more than you push (${r1(pull)} vs ${r1(push)} sets a week).` });
    else insights.push({ tone: 'good', text: `Pushing and pulling are balanced (${r1(push)} vs ${r1(pull)} sets a week).` });
  }
  if (balance.kneeHip !== null) {
    if (balance.kneeHip > 1.8) insights.push({ tone: 'warn', text: `Leg training is knee-dominant: ${r1(knee)} squat/lunge sets vs ${r1(hip)} hinge sets a week. More hinging would balance the hamstrings and glutes.` });
    else if (balance.kneeHip < 0.55) insights.push({ tone: 'warn', text: `Leg training is hip-dominant: ${r1(hip)} hinge sets vs ${r1(knee)} squat/lunge sets a week.` });
    else insights.push({ tone: 'good', text: `Knee- and hip-dominant leg work are balanced (${r1(knee)} vs ${r1(hip)} sets a week).` });
  }
  if (lower + upper > 0 && patternPerWeek.carry + patternPerWeek.rotation < 0.25)
    insights.push({ tone: 'info', text: 'No carries or anti-rotation work logged. They train the trunk and hips to resist sideways and twisting loads.' });
  if (lower > 0 && patternPerWeek.lunge < 0.25) insights.push({ tone: 'info', text: 'No single-leg work logged (lunges, split squats, step-ups).' });
  for (const g of GROUPS) {
    const f = groupFeeling[g.id];
    if (f && f.score <= -1 && groupPerWeek[g.id] >= 3)
      insights.push({ tone: 'warn', text: `${g.name}: ${r1(groupPerWeek[g.id])} sets a week while your notes on them average ${r1(f.score)}. Worth watching the load.` });
  }
  return { weeks: opts.weeks, from, to, patternPerWeek, groupPerWeek, weekly, balance, groupFeeling, insights, unclassified, sessions: sessionDays.size };
}

/** The most recent logged load for a pattern (kg), e.g. to start the leverage model from your own numbers. */
export function lastLoad(notes: Note[], pattern: PatternId): { load: number; name: string; variant?: string } | null {
  const sorted = [...notes].sort((a, b) => b.date - a.date);
  for (const n of sorted)
    for (const ex of n.workout?.exercises ?? []) {
      if (!ex.load) continue;
      const m = classifyExercise(ex.name);
      if (m?.pattern === pattern) return { load: ex.unit === 'lb' ? ex.load * 0.45359237 : ex.load, name: ex.name, variant: m.variant };
    }
  return null;
}
