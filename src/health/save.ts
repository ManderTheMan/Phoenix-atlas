import { db, uid, type Activity, type Note } from '../db/db';
import type { ImportResult } from './metrics';

/** Persist an import. Existing values for the same metric+day are replaced. */
export async function saveImport(r: ImportResult, opts: { activityNotes?: boolean } = {}): Promise<{ metrics: number; activities: number; notes: number }> {
  let notes = 0;
  await db.transaction('rw', db.metrics, db.activities, db.notes, async () => {
    await db.metrics.bulkPut(r.metrics);
    const existing = new Map((await db.activities.bulkGet(r.activities.map((a) => a.id))).filter(Boolean).map((a) => [a!.id, a!]));
    const acts: Activity[] = r.activities.map((a) => ({ ...a, noteId: existing.get(a.id)?.noteId }));
    if (opts.activityNotes) {
      const now = Date.now();
      for (const a of acts) {
        if (a.noteId) continue;
        const id = uid();
        const parts = [
          a.durationMin ? `${a.durationMin} min` : '',
          a.distanceKm ? `${a.distanceKm} km` : '',
          a.calories ? `${a.calories} kcal` : '',
          a.avgHr ? `avg HR ${a.avgHr}` : '',
        ].filter(Boolean);
        const note: Note = {
          id,
          date: a.start,
          createdAt: now,
          updatedAt: now,
          title: a.name,
          body: `Imported from ${a.source}. ${parts.join(' · ')}`,
          category: 'workout',
          feeling: 0,
          sensations: [],
          tags: ['imported', a.type.toLowerCase().replace(/[^a-z0-9]+/g, '-')],
          locations: [],
          structureIds: [],
          links: [],
          workout: { exercises: [{ name: a.name, durationMin: a.durationMin, distanceKm: a.distanceKm }], durationMin: a.durationMin },
          source: a.source,
          sourceId: a.id,
        };
        await db.notes.put(note);
        a.noteId = id;
        notes++;
      }
    }
    await db.activities.bulkPut(acts);
  });
  return { metrics: r.metrics.length, activities: r.activities.length, notes };
}

export async function deleteSource(source: string): Promise<void> {
  await db.transaction('rw', db.metrics, db.activities, async () => {
    await db.metrics.filter((m) => m.source === source).delete();
    await db.activities.filter((a) => a.source === source).delete();
  });
}
