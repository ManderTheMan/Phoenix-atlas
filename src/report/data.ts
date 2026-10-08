// Gathers everything a coach report needs for a date range.
import { STRUCTURE_BY_ID } from '../anatomy/catalog';
import { computeBodyColors } from '../analysis/colors';
import type { StructureStatus } from '../analysis/status';
import { dailyMeanFeeling, mean, rollingMean, structureStats, tagStats, type StructureStat, type TagStat } from '../analysis/stats';
import type { Activity, MetricPoint, Note } from '../db/db';
import { DAY, dayKey, parseDayKey, startOfDay } from '../lib/dates';
import type { CategoryId } from '../lib/feeling';
import { summarizeTraining, type TrainingSummary } from '../movement/training';

export interface ReportSections {
  summary: boolean;
  bodyMap: boolean;
  trend: boolean;
  areas: boolean;
  metrics: boolean;
  workouts: boolean;
  movement: boolean;
  notes: boolean;
}

export interface ReportOptions {
  title: string;
  recipient: string;
  author: string;
  from: number; // start of first day (local)
  to: number; // end of last day (local)
  categories: CategoryId[];
  tags: string[];
  includePrivate: boolean;
  sections: ReportSections;
  notesDetail: 'full' | 'brief';
  message: string;
}

export interface MetricSummary {
  metric: string;
  avg: number;
  min: number;
  max: number;
  days: number;
  prevAvg: number | null;
}

export interface ReportData {
  opts: ReportOptions;
  days: number;
  notes: Note[]; // ascending by date
  prevNotes: Note[];
  avg: number | null;
  prevAvg: number | null;
  workouts: Note[];
  statuses: Map<string, StructureStatus>;
  colors: Map<string, string>;
  areas: StructureStat[];
  improving: StructureStat[];
  worsening: StructureStat[];
  attention: StructureStatus[];
  tags: TagStat[];
  daily: { x: number; y: number; count: number }[];
  rolling: { x: number; y: number }[];
  metrics: MetricSummary[];
  activities: Activity[];
  layersWithNotes: Set<string>;
  /** Movement patterns and muscle-group volume over the period. */
  training: TrainingSummary;
}

export function defaultReportOptions(days = 30): ReportOptions {
  const today = startOfDay(Date.now());
  return {
    title: 'Body & training report',
    recipient: '',
    author: '',
    from: today - (days - 1) * DAY,
    to: today + DAY - 1,
    categories: [],
    tags: [],
    includePrivate: false,
    sections: { summary: true, bodyMap: true, trend: true, areas: true, metrics: true, workouts: true, movement: true, notes: true },
    notesDetail: 'full',
    message: '',
  };
}

export function filterNotes(notes: Note[], o: ReportOptions, from = o.from, to = o.to): Note[] {
  return notes
    .filter((n) => n.date >= from && n.date <= to)
    .filter((n) => o.includePrivate || !n.private)
    .filter((n) => !o.categories.length || o.categories.includes(n.category))
    .filter((n) => !o.tags.length || n.tags.some((t) => o.tags.includes(t)))
    .sort((a, b) => a.date - b.date);
}

export function buildReportData(allNotes: Note[], allMetrics: MetricPoint[], allActivities: Activity[], opts: ReportOptions): ReportData {
  const days = Math.max(1, Math.round((opts.to - opts.from) / DAY));
  const notes = filterNotes(allNotes, opts);
  const prevNotes = filterNotes(allNotes, opts, opts.from - days * DAY, opts.from - 1);
  const { statuses, colors } = computeBodyColors(notes, { at: opts.to, windowDays: days, mode: 'feeling' });
  const areas = structureStats(notes);
  const daily = [...dailyMeanFeeling(notes).entries()]
    .map(([k, v]) => ({ x: parseDayKey(k) + 12 * 3600_000, y: v.mean, count: v.count }))
    .sort((a, b) => a.x - b.x);
  const fromKey = dayKey(opts.from), toKey = dayKey(opts.to);
  const prevFromKey = dayKey(opts.from - days * DAY);
  const metricGroups = new Map<string, { cur: number[]; prev: number[] }>();
  for (const m of allMetrics) {
    const g = metricGroups.get(m.metric) ?? { cur: [], prev: [] };
    if (m.date >= fromKey && m.date <= toKey) g.cur.push(m.value);
    else if (m.date >= prevFromKey && m.date < fromKey) g.prev.push(m.value);
    metricGroups.set(m.metric, g);
  }
  const metrics: MetricSummary[] = [...metricGroups.entries()]
    .filter(([, g]) => g.cur.length)
    .map(([metric, g]) => ({ metric, avg: mean(g.cur)!, min: Math.min(...g.cur), max: Math.max(...g.cur), days: g.cur.length, prevAvg: mean(g.prev) }));
  const layersWithNotes = new Set<string>();
  for (const id of statuses.keys()) {
    const def = STRUCTURE_BY_ID.get(id);
    if (def) layersWithNotes.add(def.deep ? 'deep' : def.layer);
  }
  return {
    opts,
    days,
    notes,
    prevNotes,
    avg: mean(notes.map((n) => n.feeling)),
    prevAvg: mean(prevNotes.map((n) => n.feeling)),
    workouts: notes.filter((n) => n.category === 'workout'),
    statuses,
    colors,
    areas,
    improving: areas.filter((s) => (s.slopePerWeek ?? 0) > 0.15 && s.count >= 2).sort((a, b) => b.slopePerWeek! - a.slopePerWeek!).slice(0, 5),
    worsening: areas.filter((s) => (s.slopePerWeek ?? 0) < -0.15 && s.count >= 2).sort((a, b) => a.slopePerWeek! - b.slopePerWeek!).slice(0, 5),
    attention: [...statuses.values()].filter((s) => s.score < -0.5).sort((a, b) => a.score - b.score).slice(0, 6),
    tags: tagStats(notes),
    daily,
    rolling: rollingMean(daily, 7),
    metrics,
    activities: allActivities.filter((a) => a.start >= opts.from && a.start <= opts.to).sort((a, b) => a.start - b.start),
    layersWithNotes,
    training: summarizeTraining(notes, allActivities, { weeks: Math.max(1, Math.round(days / 7)), at: opts.to }),
  };
}
