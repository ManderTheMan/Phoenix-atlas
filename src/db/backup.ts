// Full backup / restore: a JSON file, or a ZIP with the JSON plus every photo
// and video when there are any.
import { strFromU8, strToU8 } from 'fflate';
import { db, type Activity, type MeasurementEntry, type MediaItem, type MetricPoint, type Note, type Setting } from './db';
import type { PoseTrack } from '../vision/analysis';
import { migrateNoteIds } from './migrate';
import { isZip, makeZip, readZip, type ZipEntry } from './zip';

export interface Backup {
  app: 'phoenix-atlas';
  version: 1;
  exportedAt: string;
  notes: Note[];
  metrics: MetricPoint[];
  activities: Activity[];
  settings: Setting[];
  measurements?: MeasurementEntry[];
  /** Photo and video details (files are next to the JSON in a ZIP backup). */
  media?: Omit<MediaItem, 'thumb'>[];
  /** Joint positions found by the pose tracker, per photo or video. */
  poses?: PoseTrack[];
}

/** Files that came with a ZIP backup, by media id. */
export interface BackupFiles {
  media: Map<string, Blob>;
  thumbs: Map<string, Blob>;
}

const SECRET_KEYS = new Set(['googleToken']);

export async function makeBackup(): Promise<Backup> {
  const [notes, metrics, activities, settings, measurements] = await Promise.all([
    db.notes.toArray(),
    db.metrics.toArray(),
    db.activities.toArray(),
    db.settings.toArray(),
    db.measurements.toArray(),
  ]);
  return {
    app: 'phoenix-atlas',
    version: 1,
    exportedAt: new Date().toISOString(),
    notes,
    metrics,
    activities,
    settings: settings.filter((s) => !SECRET_KEYS.has(s.key)),
    measurements,
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
    measurements: Array.isArray(data.measurements) ? data.measurements : [],
    media: Array.isArray(data.media) ? data.media : [],
    poses: Array.isArray(data.poses) ? data.poses : [],
  };
}

const MEDIA_EXT: [RegExp, string][] = [
  [/mp4/, 'mp4'],
  [/webm/, 'webm'],
  [/quicktime/, 'mov'],
  [/png/, 'png'],
  [/^video\//, 'mp4'],
];
const extOf = (mime: string) => MEDIA_EXT.find(([r]) => r.test(mime))?.[1] ?? 'jpg';

/** The size a backup with media will have, roughly. */
export async function mediaBackupSize(): Promise<{ count: number; bytes: number }> {
  let count = 0, bytes = 0;
  await db.media.each((m) => {
    if (m.owner) return;
    count++;
    bytes += m.size + (m.thumb?.size ?? 0);
  });
  return { count, bytes };
}

/** A ZIP with backup.json and every photo and video. */
export async function makeMediaBackup(onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const b = await makeBackup();
  // an athlete's shared clips (on a coach's device) aren't the coach's to back up; pairings aren't backed up either
  const items = (await db.media.toArray()).filter((m) => !m.owner);
  const entries: ZipEntry[] = [];
  const meta: Omit<MediaItem, 'thumb'>[] = [];
  for (const m of items) {
    const file = (await db.mediaBlobs.get(m.id))?.blob;
    if (!file) continue;
    const { thumb, ...rest } = m;
    meta.push(rest);
    entries.push({ name: `media/${m.id}.${extOf(m.mime)}`, data: file });
    if (thumb) entries.push({ name: `thumbs/${m.id}.jpg`, data: thumb });
  }
  const poses = (await db.poses.toArray()).filter((p) => meta.some((m) => m.id === p.id));
  entries.unshift({ name: 'backup.json', data: strToU8(JSON.stringify({ ...b, media: meta, poses })), compress: true });
  return makeZip(entries, onProgress);
}

/** Reads a .json or .zip backup. */
export async function readBackupFile(file: Blob): Promise<{ backup: Backup; files?: BackupFiles }> {
  if (!(await isZip(file))) return { backup: parseBackup(await file.text()) };
  const entries = await readZip(file);
  const json = entries.get('backup.json');
  if (!json) throw new Error('This ZIP is not a Phoenix Atlas backup.');
  const backup = parseBackup(strFromU8(new Uint8Array(await json.arrayBuffer())));
  const files: BackupFiles = { media: new Map(), thumbs: new Map() };
  for (const [name, blob] of entries) {
    const m = /^(media|thumbs)\/([^/]+?)\.[a-z0-9]+$/i.exec(name);
    if (m) files[m[1] as 'media' | 'thumbs'].set(m[2], blob);
  }
  return { backup, files };
}

/** Merge a backup into the database (existing items with the same id are replaced). */
export async function restoreBackup(b: Backup, mode: 'merge' | 'replace' = 'merge', files?: BackupFiles): Promise<{ notes: number; metrics: number; media: number }> {
  // only media whose file came with the backup
  const media = (b.media ?? [])
    .filter((m) => m && typeof m.id === 'string' && typeof m.date === 'number' && (m.kind === 'photo' || m.kind === 'video') && files?.media.has(m.id))
    .map((m) => {
      const blob = files!.media.get(m.id)!;
      const typed = blob.type ? blob : new Blob([blob], { type: m.mime });
      return { item: { ...m, tags: Array.isArray(m.tags) ? m.tags : [], thumb: files!.thumbs.get(m.id) ? new Blob([files!.thumbs.get(m.id)!], { type: 'image/jpeg' }) : undefined } as MediaItem, blob: typed };
    });
  await db.transaction('rw', [db.notes, db.metrics, db.activities, db.settings, db.measurements, db.media, db.mediaBlobs, db.poses], async () => {
    if (mode === 'replace') {
      await Promise.all([db.notes.clear(), db.metrics.clear(), db.activities.clear(), db.measurements.clear(), db.media.clear(), db.mediaBlobs.clear(), db.poses.clear()]);
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
    // backups made before the anatomical atlas use the old structure ids
    for (const n of notes) migrateNoteIds(n);
    await db.notes.bulkPut(notes);
    await db.metrics.bulkPut(b.metrics.filter((m) => m && m.id && m.date && m.metric && Number.isFinite(m.value)));
    await db.activities.bulkPut(b.activities.filter((a) => a && a.id));
    await db.settings.bulkPut(b.settings.filter((s) => s && s.key && !SECRET_KEYS.has(s.key)));
    await db.measurements.bulkPut((b.measurements ?? []).filter((m) => m && typeof m.id === 'string' && typeof m.date === 'number' && m.values && typeof m.values === 'object'));
    await db.mediaBlobs.bulkPut(media.map((m) => ({ id: m.item.id, blob: m.blob })));
    await db.media.bulkPut(media.map((m) => m.item));
    const restored = new Set(media.map((m) => m.item.id));
    await db.poses.bulkPut((b.poses ?? []).filter((p) => p && restored.has(p.id) && Array.isArray(p.frames)));
  });
  return { notes: b.notes.length, metrics: b.metrics.length, media: media.length };
}

export async function clearAll(): Promise<void> {
  await db.transaction('rw', [db.notes, db.metrics, db.activities, db.settings, db.measurements, db.media, db.mediaBlobs, db.poses], async () => {
    await Promise.all([db.notes.clear(), db.metrics.clear(), db.activities.clear(), db.settings.clear(), db.measurements.clear(), db.media.clear(), db.mediaBlobs.clear(), db.poses.clear()]);
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
