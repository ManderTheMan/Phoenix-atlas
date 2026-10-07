// Full backup / restore as a single JSON file.
import { db, type Activity, type MetricPoint, type Note, type Setting } from './db';

export interface Backup {
  app: 'phoenix-atlas';
  version: 1;
  exportedAt: string;
  notes: Note[];
  metrics: MetricPoint[];
  activities: Activity[];
  settings: Setting[];
}

const SECRET_KEYS = new Set(['googleToken']);

export async function makeBackup(): Promise<Backup> {
  const [notes, metrics, activities, settings] = await Promise.all([
    db.notes.toArray(),
    db.metrics.toArray(),
    db.activities.toArray(),
    db.settings.toArray(),
  ]);
  return {
    app: 'phoenix-atlas',
    version: 1,
    exportedAt: new Date().toISOString(),
    notes,
    metrics,
    activities,
    settings: settings.filter((s) => !SECRET_KEYS.has(s.key)),
  };
}

export function parseBackup(text: string): Backup {
  const data = JSON.parse(text);
  if (!data || data.app !== 'phoenix-atlas' || !Array.isArray(data.notes)) throw new Error('This is not a Phoenix Atlas backup file.');
  return {
    app: 'phoenix-atlas',
    version: 1,
    exportedAt: String(data.exportedAt ?? ''),
    notes: data.notes,
    metrics: Array.isArray(data.metrics) ? data.metrics : [],
    activities: Array.isArray(data.activities) ? data.activities : [],
    settings: Array.isArray(data.settings) ? data.settings : [],
  };
}

/** Merge a backup into the database (existing items with the same id are replaced). */
export async function restoreBackup(b: Backup, mode: 'merge' | 'replace' = 'merge'): Promise<{ notes: number; metrics: number }> {
  await db.transaction('rw', db.notes, db.metrics, db.activities, db.settings, async () => {
    if (mode === 'replace') {
      await Promise.all([db.notes.clear(), db.metrics.clear(), db.activities.clear()]);
    }
    const notes = b.notes
      .filter((n) => n && typeof n.id === 'string' && typeof n.date === 'number')
      .map((n) => ({
        ...n,
        tags: Array.isArray(n.tags) ? n.tags : [],
        locations: Array.isArray(n.locations) ? n.locations : [],
        structureIds: Array.isArray(n.locations) ? [...new Set(n.locations.map((l) => l.structureId))] : [],
        links: Array.isArray(n.links) ? n.links : [],
        sensations: Array.isArray(n.sensations) ? n.sensations : [],
        feeling: Number.isFinite(n.feeling) ? n.feeling : 0,
      }));
    await db.notes.bulkPut(notes);
    await db.metrics.bulkPut(b.metrics.filter((m) => m && m.id && m.date && m.metric && Number.isFinite(m.value)));
    await db.activities.bulkPut(b.activities.filter((a) => a && a.id));
    await db.settings.bulkPut(b.settings.filter((s) => s && s.key && !SECRET_KEYS.has(s.key)));
  });
  return { notes: b.notes.length, metrics: b.metrics.length };
}

export async function clearAll(): Promise<void> {
  await db.transaction('rw', db.notes, db.metrics, db.activities, db.settings, async () => {
    await Promise.all([db.notes.clear(), db.metrics.clear(), db.activities.clear(), db.settings.clear()]);
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
