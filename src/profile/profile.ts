// The profile: who you are and your body measurements. Measurements are kept
// as dated entries so they can be tracked over time; the "current" value of
// each one is its latest entry. They fit the 3D body to you and give the
// movement models your proportions.
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db, getSetting, setSetting, uid, type MeasurementEntry } from '../db/db';
import { computeBodyShape, REFERENCE, type BodyShape, type ShapeInput, type ShapeKey } from '../model/bodyShape';

export type Units = 'metric' | 'imperial';

export interface Profile {
  name?: string;
  sex?: 'male' | 'female' | 'other';
  birthYear?: number;
  units: Units;
  /** Fit the 3D body to the measurements everywhere in the app. */
  applyToModel: boolean;
}

export const DEFAULT_PROFILE: Profile = { units: 'metric', applyToModel: true };

export type MeasureKey = 'weight' | 'bodyFat' | ShapeKey;
export type MeasureGroup = 'body' | 'lengths' | 'girths';

export interface MeasureDef {
  key: MeasureKey;
  label: string;
  group: MeasureGroup;
  unit: 'cm' | 'kg' | '%';
  how: string;
  /** The reference body's value, when there is one. */
  ref?: number;
  min: number;
  max: number;
  /** Shown as a left/right pair. */
  pair?: 'L' | 'R';
}

const len = (key: ShapeKey, label: string, how: string, min: number, max: number): MeasureDef => ({ key, label, group: 'lengths', unit: 'cm', how, ref: REFERENCE[key], min, max });
const girth = (key: ShapeKey, label: string, how: string, min: number, max: number, pair?: 'L' | 'R'): MeasureDef => ({ key, label, group: 'girths', unit: 'cm', how, ref: REFERENCE[key], min, max, pair });

export const MEASURES: MeasureDef[] = [
  { key: 'height', label: 'Height', group: 'body', unit: 'cm', how: 'Barefoot, standing tall with your heels against a wall.', ref: REFERENCE.height, min: 120, max: 230 },
  { key: 'weight', label: 'Weight', group: 'body', unit: 'kg', how: 'Morning, before eating, for the most consistent trend.', min: 30, max: 250 },
  { key: 'bodyFat', label: 'Body fat', group: 'body', unit: '%', how: 'From a scale, calipers or a scan. Tracked only; it does not change the model.', min: 3, max: 60 },
  len('shoulderWidth', 'Shoulder width', 'Across the back, between the bony tips of the shoulders (acromions).', 25, 60),
  len('armSpan', 'Arm span', 'Fingertip to fingertip with your arms straight out to the sides. Used for the arms when their parts are not measured.', 120, 240),
  len('upperArm', 'Upper arm', 'From the bony tip of the shoulder to the bony point on the outside of the elbow, arm hanging.', 20, 45),
  len('forearm', 'Forearm', 'From the bony point on the outside of the elbow to the wrist bone on the thumb side.', 18, 40),
  len('hand', 'Hand', 'From the wrist crease to the tip of the middle finger.', 12, 26),
  len('thigh', 'Thigh', 'From the bony point on the outside of the hip (greater trochanter) to the knee joint line.', 28, 60),
  len('shank', 'Lower leg', 'From the knee joint line (inside of the knee) to the tip of the inner ankle bone.', 25, 55),
  len('foot', 'Foot', 'Heel to the tip of the longest toe, standing.', 18, 34),
  girth('neck', 'Neck', 'Just below the Adam’s apple, tape level.', 25, 60),
  girth('chest', 'Chest', 'Around the nipples, arms relaxed, after a normal breath out.', 60, 160),
  girth('waist', 'Waist', 'Around the navel, relaxed, after a normal breath out.', 50, 170),
  girth('hips', 'Hips', 'Around the widest part of the buttocks, feet together.', 60, 170),
  girth('armL', 'Upper arm', 'Halfway between shoulder and elbow, arm relaxed and hanging.', 18, 60, 'L'),
  girth('armR', 'Upper arm', 'Halfway between shoulder and elbow, arm relaxed and hanging.', 18, 60, 'R'),
  girth('forearmL', 'Forearm', 'The widest part, just below the elbow.', 15, 50, 'L'),
  girth('forearmR', 'Forearm', 'The widest part, just below the elbow.', 15, 50, 'R'),
  girth('thighL', 'Thigh', 'Halfway between the hip crease and the top of the kneecap.', 30, 95, 'L'),
  girth('thighR', 'Thigh', 'Halfway between the hip crease and the top of the kneecap.', 30, 95, 'R'),
  girth('calfL', 'Calf', 'The widest part, standing with your weight on both feet.', 20, 65, 'L'),
  girth('calfR', 'Calf', 'The widest part, standing with your weight on both feet.', 20, 65, 'R'),
];

export const MEASURE_BY_KEY = new Map(MEASURES.map((m) => [m.key, m])) as Map<MeasureKey, MeasureDef>;

export function measureLabel(key: MeasureKey): string {
  const m = MEASURE_BY_KEY.get(key);
  if (!m) return key;
  return m.pair ? `${m.label} (${m.pair === 'L' ? 'left' : 'right'})` : m.label;
}

// ---------------------------------------------------------------- units

export function toDisplay(v: number, unit: MeasureDef['unit'], units: Units): number {
  if (units === 'imperial' && unit === 'cm') return v / 2.54;
  if (units === 'imperial' && unit === 'kg') return v / 0.45359237;
  return v;
}
export function fromDisplay(v: number, unit: MeasureDef['unit'], units: Units): number {
  if (units === 'imperial' && unit === 'cm') return v * 2.54;
  if (units === 'imperial' && unit === 'kg') return v * 0.45359237;
  return v;
}
export function unitLabel(unit: MeasureDef['unit'], units: Units): string {
  if (units === 'imperial') return unit === 'cm' ? 'in' : unit === 'kg' ? 'lb' : unit;
  return unit;
}
export function formatMeasure(v: number | undefined, unit: MeasureDef['unit'], units: Units): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const d = toDisplay(v, unit, units);
  return `${Math.round(d * 10) / 10} ${unitLabel(unit, units)}`;
}

// ---------------------------------------------------------------- storage

export async function getProfile(): Promise<Profile> {
  return { ...DEFAULT_PROFILE, ...(await getSetting<Partial<Profile>>('profile', {})) };
}

export async function saveProfile(p: Profile): Promise<void> {
  await setSetting('profile', p);
}

/** Latest value of every measurement. */
export function currentValues(entries: MeasurementEntry[]): Partial<Record<MeasureKey, number>> {
  const out: Partial<Record<MeasureKey, number>> = {};
  const seen = new Set<string>();
  for (const e of [...entries].sort((a, b) => b.date - a.date))
    for (const [k, v] of Object.entries(e.values))
      if (!seen.has(k) && Number.isFinite(v)) {
        seen.add(k);
        out[k as MeasureKey] = v;
      }
  return out;
}

/** Saves the measurements taken on a day (merging with an entry already saved that day). */
export async function saveMeasurements(values: Partial<Record<MeasureKey, number>>, date = Date.now(), source?: string): Promise<void> {
  const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0)) as Record<string, number>;
  if (!Object.keys(clean).length) return;
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const start = day.getTime(), end = start + 86_400_000;
  const same = await db.measurements.where('date').between(start, end, true, false).filter((e) => e.source === source).first();
  await db.transaction('rw', db.measurements, db.metrics, async () => {
    if (same) await db.measurements.put({ ...same, values: { ...same.values, ...clean } });
    else await db.measurements.put({ id: uid(), date, values: clean, ...(source ? { source } : {}) });
    // weight also lives with the other health metrics, so it shows in Health data and Insights
    if (clean.weight) {
      const d = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      await db.metrics.put({ id: `weight_kg|${d}`, date: d, metric: 'weight_kg', value: clean.weight, source: source ?? 'profile' });
    }
  });
}

export async function deleteMeasurement(id: string): Promise<void> {
  await db.measurements.delete(id);
}

export function shapeInputFrom(values: Partial<Record<MeasureKey, number>>): ShapeInput {
  const out: ShapeInput = {};
  for (const k of Object.keys(REFERENCE) as ShapeKey[]) if (values[k]) out[k] = values[k];
  return out;
}

// ---------------------------------------------------------------- hooks

const NONE: MeasurementEntry[] = [];

export function useMeasurements(): MeasurementEntry[] {
  return useLiveQuery(() => db.measurements.orderBy('date').toArray(), [], NONE);
}

export function useProfile(): Profile {
  const p = useLiveQuery(() => getProfile(), [], DEFAULT_PROFILE);
  return p ?? DEFAULT_PROFILE;
}

/** Current measurements, the profile and the fitted body shape (null when not applied). */
export function useBody(): { profile: Profile; values: Partial<Record<MeasureKey, number>>; shape: BodyShape | null; entries: MeasurementEntry[] } {
  const profile = useProfile();
  const entries = useMeasurements();
  const values = useMemo(() => currentValues(entries), [entries]);
  const shape = useMemo(() => (profile.applyToModel ? computeBodyShape(shapeInputFrom(values)) : null), [profile.applyToModel, values]);
  return { profile, values, shape, entries };
}

/** Body mass for the movement models: the profile's weight, or the latest weight from health data. */
export function useBodyMass(): number | undefined {
  const entries = useMeasurements();
  const metric = useLiveQuery(() => db.metrics.where('metric').equals('weight_kg').reverse().sortBy('date'), [], []);
  return useMemo(() => currentValues(entries).weight ?? metric?.[0]?.value, [entries, metric]);
}
