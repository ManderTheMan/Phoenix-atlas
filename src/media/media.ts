// Progress photos and form videos: storage, and the small amount of geometry
// used to measure angles on them and line them up over time. Files stay in
// this browser's IndexedDB like everything else.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, uid, type CameraAngle, type MeasurementEntry, type MediaItem, type MediaMark, type MediaPurpose, type PoseId } from '../db/db';
import { normalizeTag } from '../lib/feeling';
import type { MeasureKey } from '../profile/profile';

export const POSES: { id: PoseId; label: string; hint: string }[] = [
  { id: 'front', label: 'Front', hint: 'Facing the camera, arms a little away from your sides, feet hip-width.' },
  { id: 'side', label: 'Side', hint: 'Turn 90° to your right so your left side faces the camera, arms relaxed.' },
  { id: 'back', label: 'Back', hint: 'Back to the camera, arms a little away from your sides.' },
  { id: 'other', label: 'Other', hint: 'Any other pose, such as a flexed arm.' },
];
export const POSE_BY_ID = new Map(POSES.map((p) => [p.id, p]));
/** The poses of a standard set of progress photos, in order. */
export const POSE_SET: PoseId[] = ['front', 'side', 'back'];

export const CAMERA_ANGLES: { id: CameraAngle; label: string }[] = [
  { id: 'side', label: 'Side on' },
  { id: 'front', label: 'Front' },
  { id: 'back', label: 'Behind' },
  { id: 'angle', label: '45°' },
];

export const PURPOSES: { id: MediaPurpose; label: string; hint: string }[] = [
  { id: 'progress', label: 'Body progress', hint: 'The same pose, place and light each time, to see your body change.' },
  { id: 'form', label: 'Form check', hint: 'A lift or movement, to watch and measure your technique.' },
  { id: 'other', label: 'Other', hint: 'Anything else: a bruise, a swelling, posture, mobility.' },
];

/** Suggested names for measurements drawn on form media. */
export const MARK_LABELS: Record<MediaMark['type'], string[]> = {
  angle: ['Knee', 'Hip', 'Ankle', 'Elbow', 'Shoulder', 'Trunk to thigh'],
  line: ['Torso lean', 'Shin angle', 'Forearm', 'Neck'],
  path: ['Bar path', 'Hip path', 'Knee path'],
};

export const MARK_TYPE_LABEL: Record<MediaMark['type'], string> = { angle: 'Angle', line: 'Lean', path: 'Path' };

/** Longest video the camera records. */
export const MAX_VIDEO_SECONDS = 120;

// ---------------------------------------------------------------- storage

export interface NewMedia extends Partial<Omit<MediaItem, 'id' | 'createdAt' | 'updatedAt' | 'size' | 'mime'>> {
  blob: Blob;
  kind: MediaItem['kind'];
  width: number;
  height: number;
}

export async function addMedia(m: NewMedia): Promise<MediaItem> {
  const now = Date.now();
  const { blob, ...meta } = m;
  const item: MediaItem = {
    purpose: 'other',
    date: now,
    ...meta,
    id: uid(),
    createdAt: now,
    updatedAt: now,
    mime: blob.type || (m.kind === 'photo' ? 'image/jpeg' : 'video/mp4'),
    size: blob.size,
    tags: cleanTags(m.tags ?? []),
  };
  await db.transaction('rw', db.media, db.mediaBlobs, async () => {
    await db.mediaBlobs.put({ id: item.id, blob });
    await db.media.put(item);
  });
  return item;
}

export async function updateMedia(id: string, patch: Partial<Omit<MediaItem, 'id'>>): Promise<void> {
  const p = { ...patch, updatedAt: Date.now() };
  if (p.tags) p.tags = cleanTags(p.tags);
  await db.media.update(id, p);
}

export async function deleteMedia(id: string): Promise<void> {
  await db.transaction('rw', db.media, db.mediaBlobs, db.poses, async () => {
    await db.media.delete(id);
    await db.mediaBlobs.delete(id);
    await db.poses.delete(id);
  });
  dropThumb(id);
}

export async function getMediaBlob(id: string): Promise<Blob | undefined> {
  return (await db.mediaBlobs.get(id))?.blob;
}

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))];
}

/** Asks the browser not to evict stored files when space runs low. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageInfo(): Promise<{ usage?: number; quota?: number; persisted?: boolean }> {
  try {
    const [est, persisted] = await Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()]);
    return { usage: est?.usage, quota: est?.quota, persisted };
  } catch {
    return {};
  }
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function formatDuration(s: number | undefined): string {
  if (s === undefined || !Number.isFinite(s)) return '';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}:${String(r === 60 ? 59 : r).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- hooks

const NONE: MediaItem[] = [];

/** All photos and videos, newest first (live). */
export function useMedia(): MediaItem[] {
  return useLiveQuery(() => db.media.orderBy('date').reverse().toArray(), [], NONE);
}

export function useMediaLoaded(): { media: MediaItem[]; loaded: boolean } {
  const media = useLiveQuery(() => db.media.orderBy('date').reverse().toArray(), []);
  return { media: media ?? NONE, loaded: media !== undefined };
}

const thumbs = new Map<string, { key: number; url: string }>();

/** Object URL for an item's thumbnail (cached until the item changes). */
export function thumbUrl(item: MediaItem): string | undefined {
  if (!item.thumb) return undefined;
  const hit = thumbs.get(item.id);
  if (hit && hit.key === item.updatedAt) return hit.url;
  if (hit) URL.revokeObjectURL(hit.url);
  const url = URL.createObjectURL(item.thumb);
  thumbs.set(item.id, { key: item.updatedAt, url });
  return url;
}

function dropThumb(id: string) {
  const hit = thumbs.get(id);
  if (hit && typeof URL !== 'undefined') URL.revokeObjectURL(hit.url);
  thumbs.delete(id);
}

/** Object URL for the full file while the component is mounted. */
export function useMediaUrl(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return setUrl(null);
    let u: string | null = null, live = true;
    getMediaBlob(id).then((b) => {
      if (!b || !live) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [id]);
  return url;
}

// ---------------------------------------------------------------- geometry

export type P = [number, number];

export interface MarkValue {
  value: number;
  unit: '°' | '%';
  text: string;
}

/** The number a mark measures, in the frame's real proportions (w × h pixels). */
export function markValue(m: MediaMark, w: number, h: number): MarkValue | null {
  const px = (p: P): P => [p[0] * w, p[1] * h];
  if (m.type === 'angle') {
    if (m.points.length < 3) return null;
    const [a, b, c] = m.points.map(px);
    const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
    const nu = Math.hypot(u[0], u[1]), nv = Math.hypot(v[0], v[1]);
    if (!nu || !nv) return null;
    const deg = (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (nu * nv)))) * 180) / Math.PI;
    return { value: deg, unit: '°', text: `${Math.round(deg)}°` };
  }
  if (m.type === 'line') {
    if (m.points.length < 2) return null;
    const [a, b] = m.points.map(px);
    const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
    if (!dx && !dy) return null;
    const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
    return { value: deg, unit: '°', text: `${Math.round(deg)}° from vertical` };
  }
  if (m.points.length < 2) return null;
  const xs = m.points.map((p) => p[0] * w), ys = m.points.map((p) => p[1] * h);
  const travel = Math.max(...ys) - Math.min(...ys);
  if (travel < 1e-6) return null;
  const drift = ((Math.max(...xs) - Math.min(...xs)) / travel) * 100;
  return { value: drift, unit: '%', text: `drifts ${Math.round(drift)}% of its travel` };
}

/** Name shown for a mark: its label, or its type. */
export function markName(m: MediaMark): string {
  return m.label?.trim() || MARK_TYPE_LABEL[m.type];
}

/**
 * Where in the pattern's range the video is at time t (0 = start position,
 * 1 = end of range), from the two positions you marked. Out and back again
 * mirror each other, so one rep reads 0 → 1 → 0.
 */
export function phaseAt(item: Pick<MediaItem, 'phase0' | 'phase1'>, t: number): number | null {
  const { phase0, phase1 } = item;
  if (phase0 === undefined || phase1 === undefined || phase0 === phase1) return null;
  const half = Math.abs(phase1 - phase0);
  return Math.max(0, Math.min(1, 1 - Math.abs(t - phase1) / half));
}

/** The time on the way into the end of range at which the phase is p. */
export function timeForPhase(item: Pick<MediaItem, 'phase0' | 'phase1'>, p: number): number | null {
  const { phase0, phase1 } = item;
  if (phase0 === undefined || phase1 === undefined) return null;
  return phase0 + Math.max(0, Math.min(1, p)) * (phase1 - phase0);
}

/** The moment two videos are lined up on: the end-range position if marked, else the start, else the first mark. */
export function syncTime(item: MediaItem): number {
  return item.phase1 ?? item.phase0 ?? item.marks?.find((m) => m.t !== undefined)?.t ?? 0;
}

/** Marks visible at time t: photo marks always; video marks near the time they were drawn; paths up to t. */
export function marksAt(item: MediaItem, t: number | null, window = 0.2): MediaMark[] {
  const marks = item.marks ?? [];
  if (item.kind === 'photo' || t === null) return marks;
  return marks.filter((m) => (m.type === 'path' ? true : m.t === undefined || Math.abs(m.t - t) <= window));
}

// ---------------------------------------------------------------- over time

export const byDateAsc = (a: MediaItem, b: MediaItem) => a.date - b.date;

/** Progress photos of one pose, oldest first. */
export function poseSeries(items: MediaItem[], pose: PoseId): MediaItem[] {
  return items.filter((m) => m.purpose === 'progress' && m.kind === 'photo' && (m.pose ?? 'other') === pose).sort(byDateAsc);
}

/** Form photos and videos for a movement pattern, oldest first. */
export function formSeries(items: MediaItem[], pattern?: string): MediaItem[] {
  return items.filter((m) => m.purpose === 'form' && (!pattern || m.pattern === pattern)).sort(byDateAsc);
}

/** The first and the latest of a series, the default pair to compare. */
export function firstAndLatest<T extends { date: number }>(series: T[]): [T, T] | null {
  if (series.length < 2) return null;
  return [series[0], series[series.length - 1]];
}

export interface MarkTrend {
  key: string;
  label: string;
  type: MediaMark['type'];
  unit: '°' | '%';
  points: { x: number; y: number; id: string }[];
}

/** Every named measurement across a series of form media, so you can see it change. */
export function markTrends(items: MediaItem[]): MarkTrend[] {
  const out = new Map<string, MarkTrend>();
  for (const it of [...items].sort(byDateAsc))
    for (const m of it.marks ?? []) {
      const v = markValue(m, it.width, it.height);
      if (!v) continue;
      const label = markName(m);
      const key = `${m.type}|${label.toLowerCase()}`;
      const t = out.get(key) ?? { key, label, type: m.type, unit: v.unit, points: [] };
      // one value per item: the first mark with this name
      if (!t.points.some((p) => p.id === it.id)) t.points.push({ x: it.date, y: Math.round(v.value * 10) / 10, id: it.id });
      out.set(key, t);
    }
  return [...out.values()].sort((a, b) => b.points.length - a.points.length);
}

/** Each measurement as it was around a date: the entry closest in time within `maxDays`. */
export function measurementsNear(entries: MeasurementEntry[], date: number, maxDays = 10): Partial<Record<MeasureKey, { value: number; date: number }>> {
  const out: Partial<Record<MeasureKey, { value: number; date: number }>> = {};
  const limit = maxDays * 86_400_000;
  for (const e of entries) {
    const d = Math.abs(e.date - date);
    if (d > limit) continue;
    for (const [k, v] of Object.entries(e.values)) {
      const cur = out[k as MeasureKey];
      if (!cur || d < Math.abs(cur.date - date)) out[k as MeasureKey] = { value: v, date: e.date };
    }
  }
  return out;
}

const DELTA_KEYS: MeasureKey[] = ['weight', 'bodyFat', 'chest', 'waist', 'hips', 'armL', 'armR', 'thighL', 'thighR', 'calfL', 'calfR', 'neck'];

/** How your measurements changed between the dates of two photos (only those measured near both). */
export function measurementChanges(entries: MeasurementEntry[], from: number, to: number): { key: MeasureKey; from: number; to: number; diff: number }[] {
  const a = measurementsNear(entries, from), b = measurementsNear(entries, to);
  const out: { key: MeasureKey; from: number; to: number; diff: number }[] = [];
  for (const k of DELTA_KEYS) {
    const x = a[k], y = b[k];
    if (!x || !y || x.date === y.date) continue;
    out.push({ key: k, from: x.value, to: y.value, diff: Math.round((y.value - x.value) * 10) / 10 });
  }
  return out;
}

/** The newest progress photo of each pose. */
export function latestByPose(items: MediaItem[]): Map<PoseId, MediaItem> {
  const out = new Map<PoseId, MediaItem>();
  for (const m of items) {
    if (m.purpose !== 'progress' || m.kind !== 'photo') continue;
    const p = m.pose ?? 'other';
    const cur = out.get(p);
    if (!cur || m.date > cur.date) out.set(p, m);
  }
  return out;
}

/** CSS transform for an item's alignment (shift in % of the frame, then zoom). */
export function alignTransform(a: MediaItem['align']): string | undefined {
  if (!a || (a.x === 0 && a.y === 0 && a.s === 1)) return undefined;
  return `translate(${a.x * 100}%, ${a.y * 100}%) scale(${a.s})`;
}
