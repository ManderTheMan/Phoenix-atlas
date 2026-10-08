// Local-first storage in IndexedDB (via Dexie). Nothing leaves the device
// unless you export it.
import Dexie, { type Table } from 'dexie';
import type { CategoryId } from '../lib/feeling';
import { migrateNoteIds } from './migrate';

export type Vec3 = [number, number, number];

export interface NoteLocation {
  structureId: string;
  /** Tap position on the model (model space, metres). Absent when picked from a list. */
  point?: Vec3;
  normal?: Vec3;
  /** The point was tapped on the first body model and still needs moving onto the atlas surface. */
  legacyPoint?: boolean;
}

export interface ExerciseEntry {
  name: string;
  sets?: number;
  reps?: number;
  load?: number;
  unit?: 'kg' | 'lb';
  durationMin?: number;
  distanceKm?: number;
  notes?: string;
}

export interface Measurement {
  label: string;
  value: number;
  unit?: string;
}

export interface Note {
  id: string;
  /** When it happened (editable). */
  date: number;
  createdAt: number;
  updatedAt: number;
  title: string;
  body: string;
  category: CategoryId;
  /** -5 (severe) … +5 (excellent). Drives the colour coding. */
  feeling: number;
  /** Optional 0–10 intensity of the sensation (e.g. pain scale). */
  intensity?: number;
  sensations: string[];
  tags: string[];
  locations: NoteLocation[];
  /** Derived from locations, indexed for fast lookups. */
  structureIds: string[];
  /** Explicit links to other notes (kept bidirectional). */
  links: string[];
  /** The note this one follows up on (tracking the same issue over time). */
  followUpOf?: string;
  workout?: { exercises: ExerciseEntry[]; durationMin?: number; rpe?: number };
  measurements?: Measurement[];
  /** Excluded from coach reports by default. */
  private?: boolean;
  source?: string;
  sourceId?: string;
}

/** One daily value of a health metric (steps, resting HR, sleep hours…). */
export interface MetricPoint {
  id: string; // `${metric}|${date}`
  date: string; // YYYY-MM-DD (local)
  metric: string;
  value: number;
  source: string;
}

/** A workout/exercise session imported from a health source. */
export interface Activity {
  id: string;
  start: number;
  end: number;
  type: string;
  name: string;
  durationMin: number;
  calories?: number;
  distanceKm?: number;
  avgHr?: number;
  steps?: number;
  source: string;
  noteId?: string;
}

export interface Setting {
  key: string;
  value: unknown;
}

/** A dated set of body measurements (cm, kg, %). Only the fields measured that day are present. */
export interface MeasurementEntry {
  id: string;
  date: number;
  values: Record<string, number>;
  source?: string;
}

export class AtlasDB extends Dexie {
  notes!: Table<Note, string>;
  metrics!: Table<MetricPoint, string>;
  activities!: Table<Activity, string>;
  settings!: Table<Setting, string>;
  measurements!: Table<MeasurementEntry, string>;

  constructor(name = 'phoenix-atlas') {
    super(name);
    this.version(1).stores({
      notes: 'id, date, category, *tags, *structureIds, followUpOf, sourceId',
      metrics: 'id, date, metric, [metric+date]',
      activities: 'id, start, type',
      settings: 'key',
    });
    // v2: the procedural body was replaced by the anatomical atlas
    this.version(2)
      .stores({})
      .upgrade((tx) => tx.table('notes').toCollection().modify((n: Note) => void migrateNoteIds(n)));
    // v3: body measurements for the profile
    this.version(3).stores({ measurements: 'id, date' });
  }
}

export const db = new AtlasDB();

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key);
  return (s?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}
