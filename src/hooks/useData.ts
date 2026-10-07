import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Activity, type MetricPoint, type Note } from '../db/db';

const EMPTY: never[] = [];

/** All notes, newest first (live). */
export function useNotes(): Note[] {
  return useLiveQuery(() => db.notes.orderBy('date').reverse().toArray(), [], EMPTY as Note[]);
}

export function useNotesLoaded(): { notes: Note[]; loaded: boolean } {
  const notes = useLiveQuery(() => db.notes.orderBy('date').reverse().toArray(), []);
  return { notes: notes ?? (EMPTY as Note[]), loaded: notes !== undefined };
}

export function useMetrics(): MetricPoint[] {
  return useLiveQuery(() => db.metrics.orderBy('date').toArray(), [], EMPTY as MetricPoint[]);
}

export function useActivities(): Activity[] {
  return useLiveQuery(() => db.activities.orderBy('start').reverse().toArray(), [], EMPTY as Activity[]);
}

export function useTagCounts(notes: Note[]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const n of notes) for (const t of n.tags) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
