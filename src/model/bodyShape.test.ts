import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import landmarks from '../anatomy/landmarks.json';
import { db } from '../db/db';
import { currentValues, saveMeasurements } from '../profile/profile';
import { applyShape, buildLayerModel, raycastLayer, structureCentroid } from './atlasModel';
import { bodyDims, bodyPartOf, computeBodyShape, REFERENCE, type V3 } from './bodyShape';

const LM = landmarks as unknown as { joints: Record<string, V3>; lengths: Record<string, number> };
const layer = (id: string) => buildLayerModel(new Uint8Array(readFileSync(join(__dirname, '../../public/atlas', `${id}.bin`))));

describe('landmarks', () => {
  it('measures a plausible adult body', () => {
    const h = LM.lengths.height;
    expect(h).toBeGreaterThan(1.6);
    expect(h).toBeLessThan(1.85);
    // joint heights as a share of stature, close to Drillis & Contini's ratios
    expect(LM.joints.hip_l[1] / h).toBeCloseTo(0.51, 1);
    expect(LM.joints.knee_l[1] / h).toBeCloseTo(0.27, 1);
    expect(LM.joints.shoulder_l[1] / h).toBeCloseTo(0.81, 1);
    expect(LM.joints.hip_l[0]).toBeGreaterThan(0); // left is +x
    for (const k of ['chest', 'waist', 'hips', 'neck', 'thighL', 'calfL'] as const) expect(REFERENCE[k]).toBeGreaterThan(30);
  });
});

describe('body shape', () => {
  it('is the reference body when nothing is measured', () => {
    expect(computeBodyShape({})).toBeNull();
    expect(bodyDims({}).thigh).toBeCloseTo(LM.lengths.thigh, 4);
  });

  it('scales uniformly from height alone', () => {
    const s = computeBodyShape({ height: REFERENCE.height * 1.1 })!;
    expect(s.scale).toBeCloseTo(1.1, 3);
    for (const p of [LM.joints.knee_l, LM.joints.wrist_r, [0.05, 1.2, 0.1] as V3]) {
      const q = s.deformPoint(p);
      for (let a = 0; a < 3; a++) expect(q[a]).toBeCloseTo(p[a] * 1.1, 4);
    }
  });

  it('moves the joints for measured lengths and keeps the height', () => {
    const s = computeBodyShape({ height: 180, thigh: 46, upperArm: 34 })!;
    const ref = bodyDims({ height: 180 });
    expect(s.dims.thigh).toBeGreaterThan(ref.thigh * 1.05);
    expect(s.dims.upperArm).toBeGreaterThan(ref.upperArm * 1.05);
    expect(s.dims.height).toBeCloseTo(1.8, 2);
  });

  it('keeps hands and thighs apart, and trunk structures continuous', () => {
    expect(bodyPartOf('regions.dorsum_of_hand_l')).toBe('arm');
    expect(bodyPartOf('regions.anterior_region_of_thigh_l')).toBe('leg');
    expect(bodyPartOf('regions.deltoid_region_l')).toBe('trunk');
    expect(bodyPartOf('regions.lateral_region_of_neck_l')).toBe('trunk');
    expect(bodyPartOf('muscular.gluteus_maximus_muscle_l')).toBe('trunk');
  });

  it('widens the waist for a bigger girth and maps picks back to the reference body', () => {
    const skin = layer('skin');
    const i = skin.indexOf.get('regions.umbilical_region_l')!;
    const c = structureCentroid(skin, i);
    const ray = new Ray(new Vector3(c.x, c.y, 2), new Vector3(0, 0, -1));
    const before = raycastLayer(skin, ray, () => true)!;
    applyShape(skin, computeBodyShape({ waist: REFERENCE.waist * 1.25 }));
    const after = raycastLayer(skin, ray, () => true)!;
    expect(after.point.z).toBeGreaterThan(before.point.z + 0.01);
    // the stored point is on the reference body, wherever the fitted surface is
    expect(after.refPoint.distanceTo(before.point)).toBeLessThan(0.01);
    applyShape(skin, null);
    const reset = raycastLayer(skin, ray, () => true)!;
    expect(reset.point.distanceTo(before.point)).toBeLessThan(1e-4);
  });
});

describe('profile measurements', () => {
  it('keeps dated entries and reads the latest value of each', async () => {
    await db.measurements.clear();
    const day = 86_400_000;
    await saveMeasurements({ weight: 82, waist: 86 }, Date.now() - 10 * day);
    await saveMeasurements({ weight: 81 }, Date.now() - 2 * day);
    await saveMeasurements({ chest: 101 }, Date.now() - 2 * day); // same day: merged
    const entries = await db.measurements.toArray();
    expect(entries.length).toBe(2);
    expect(currentValues(entries)).toEqual({ weight: 81, waist: 86, chest: 101 });
    // weight is also a health metric
    expect((await db.metrics.where('metric').equals('weight_kg').toArray()).length).toBe(2);
  });
});
