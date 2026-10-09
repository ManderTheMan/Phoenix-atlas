// Local-first storage in IndexedDB (via Dexie). Nothing leaves the device
// unless you export it.
import Dexie, { type Table } from 'dexie';
import type { CategoryId } from '../lib/feeling';
import type { PoseTrack } from '../vision/analysis';
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
  /** Further measurements from a body scan that the profile doesn't use, by label (cm, kg or %). */
  extra?: Record<string, { label: string; value: number; unit: string }>;
}

export type MediaKind = 'photo' | 'video';
/** Progress = body photos taken the same way over time; form = a movement filmed to check technique. */
export type MediaPurpose = 'progress' | 'form' | 'other';
export type PoseId = 'front' | 'side' | 'back' | 'other';
export type CameraAngle = 'side' | 'front' | 'back' | 'angle';

/** A measurement drawn on a photo or video frame. Points are fractions (0–1) of the frame's width and height. */
export interface MediaMark {
  id: string;
  type: 'angle' | 'line' | 'path';
  points: [number, number][];
  /** Video time (s) the mark was drawn at; a path has one time per point. */
  t?: number;
  times?: number[];
  label?: string;
  /** Placed by the pose tracker rather than by hand. */
  source?: 'pose';
  /** Drawn by your coach (arrived in their feedback). */
  by?: 'coach';
}

/** A photo or video. The file itself is in `mediaBlobs` so lists stay light. */
export interface MediaItem {
  id: string;
  kind: MediaKind;
  purpose: MediaPurpose;
  /** When it was taken. */
  date: number;
  createdAt: number;
  updatedAt: number;
  mime: string;
  size: number;
  width: number;
  height: number;
  /** Seconds (videos). */
  duration?: number;
  /** Small JPEG preview. */
  thumb?: Blob;
  title?: string;
  notes?: string;
  tags: string[];
  pose?: PoseId;
  pattern?: string;
  variant?: string;
  /** kg */
  load?: number;
  reps?: number;
  camera?: CameraAngle;
  noteId?: string;
  marks?: MediaMark[];
  /** Video times (s) of the pattern's start and end-range positions (e.g. standing and the bottom of a squat). */
  phase0?: number;
  phase1?: number;
  /** Shift and zoom that line this photo up with others of the same pose (fractions of the frame). */
  align?: { x: number; y: number; s: number };
  /** Kept out of coach reports. */
  private?: boolean;
  /** Where it came from; "archive:<id>" for clips brought in from the archive tool. */
  source?: string;
  /** The original file of an archive clip (the stored file is a small copy). */
  original?: { archiveId: string; name: string; width: number; height: number; bytes: number; fps?: number; codec?: string; dateSource: string; copies?: number; slowmo?: boolean };
  /** Reps and depth from the joint track for the clip's movement, kept so lists needn't load tracks. */
  tracked?: { pattern: string; joint: string; reps: number; deepest?: number; spread?: number; down?: number; up?: number };
  /** A suggested movement pattern, waiting to be confirmed. */
  suggestion?: { pattern: string | null; confidence: number; from: 'movement' | 'log' | 'both' | null; why: string; options: string[]; reps?: number };
  /** On a coach's device: the pairing of the athlete this clip belongs to (kept out of the coach's own lists). */
  owner?: string;
  /** On a coach's device: ids of the marks the athlete shared, so the coach's own can be told apart. */
  sharedMarks?: string[];
  /** The coach's comment: being written (coach's device) or received (athlete's device). */
  coachComment?: { text: string; at: number; by?: string };
}

/** A pairing with your coach or an athlete, made by scanning a QR code. */
export interface Pairing {
  id: string;
  /** Your side of it. */
  role: 'athlete' | 'coach';
  /** The shared secret (base64url), which opens files between the two devices. */
  secret: string;
  /** The other person's name. */
  name: string;
  created: number;
  lastSent?: number;
  lastReceived?: number;
}

/** A share received from an athlete (on the coach's device). */
export interface CoachShare {
  id: string;
  pairId: string;
  created: number;
  received: number;
  from: string;
  message?: string;
  period: { from: number | null; to: number };
  itemIds: string[];
  notes: Note[];
  measurements: MeasurementEntry[];
}

/** Feedback received from the coach (on the athlete's device). */
export interface CoachFeedback {
  id: string;
  pairId: string;
  created: number;
  received: number;
  from: string;
  message: string;
  itemIds: string[];
}

export interface MediaBlob {
  id: string;
  blob: Blob;
}

export class AtlasDB extends Dexie {
  notes!: Table<Note, string>;
  metrics!: Table<MetricPoint, string>;
  activities!: Table<Activity, string>;
  settings!: Table<Setting, string>;
  measurements!: Table<MeasurementEntry, string>;
  pairings!: Table<Pairing, string>;
  shares!: Table<CoachShare, string>;
  feedback!: Table<CoachFeedback, string>;
  media!: Table<MediaItem, string>;
  mediaBlobs!: Table<MediaBlob, string>;
  poses!: Table<PoseTrack, string>;

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
    // v4: progress photos and form videos
    this.version(4).stores({ media: 'id, date, purpose, pattern, pose, noteId, *tags', mediaBlobs: 'id' });
    // v5: joint positions found by the pose tracker, one track per photo or video
    this.version(5).stores({ poses: 'id' });
    this.version(6).stores({ pairings: 'id', shares: 'id, pairId', feedback: 'id, pairId' });
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
