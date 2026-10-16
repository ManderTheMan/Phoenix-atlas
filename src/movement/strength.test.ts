import { describe, expect, it } from 'vitest';
import { bodyDims } from '../model/bodyShape';
import { capacity, personalScale, stickingPoint, sweep } from './activation';
import { CAPACITY } from './activation';
import type { JointResult } from './biomech';
import { PATTERN_BY_ID, type PatternId } from './patterns';
import { CURVES, jointAngles, kindOf, PEAK_FACTOR, strengthShare } from './strength';

const dims = bodyDims({ height: 178 });
const joint = (id: JointResult['id'], demand: number, positive: string, negative: string, angle?: number): JointResult =>
  ({ id, label: id, demand, positive, negative, arm: 0.1, perSide: true, view: 0, at: [0, 0], angle }) as JointResult;
const inputs = (id: PatternId, load: number) => {
  const p = PATTERN_BY_ID.get(id)!;
  return { p, inp: { dims, mass: 80, load, options: { ...Object.fromEntries(p.options.map((o) => [o.id, o.default])), variant: p.variants[0].value } } };
};

describe('strength through the range', () => {
  it('peaks at the strongest angle and falls off either side to a floor', () => {
    expect(strengthShare('kneeExt', CURVES.kneeExt.peak)).toBe(1);
    expect(strengthShare('kneeExt', 0)).toBeCloseTo(0.55, 1); // about half at a straight knee
    expect(strengthShare('kneeExt', 30)).toBeCloseTo(strengthShare('kneeExt', 100), 5);
    expect(strengthShare('hipExt', 0)).toBeLessThan(strengthShare('hipExt', 90));
    expect(strengthShare('elbowExt', 400)).toBe(0.35);
    // without a curve or an angle, the old flat typical value
    expect(strengthShare('flat', 50) * PEAK_FACTOR).toBeCloseTo(1, 5);
    expect(strengthShare('kneeExt', undefined) * PEAK_FACTOR).toBeCloseTo(1, 5);
  });

  it('picks the curve from the muscles working', () => {
    expect(kindOf(joint('elbow', 20, 'Triceps (elbow extensors)', 'Elbow flexors'))).toBe('elbowExt');
    expect(kindOf(joint('elbow', 20, 'Biceps & brachialis (elbow flexors)', 'Triceps'))).toBe('elbowFlex');
    expect(kindOf(joint('elbow', -20, 'Biceps & brachialis (elbow flexors)', 'Triceps'))).toBe('elbowExt');
    expect(kindOf(joint('shoulder', 30, 'Lats & rear delts (shoulder extensors)', ''))).toBe('shoulderExt');
    expect(kindOf(joint('shoulder', 30, 'Pecs & front delts', ''))).toBe('shoulderFlex');
    expect(kindOf(joint('knee', -30, 'Quadriceps (knee extensors)', 'Hamstrings (knee flexors)'))).toBe('kneeFlex');
    expect(kindOf(joint('hip', 30, 'Glutes & hamstrings (hip extensors)', 'Hip flexors'))).toBe('hipExt');
    expect(kindOf(joint('spineAxial', 30, 'Obliques', ''))).toBe('flat');
  });

  it('turns capacity into N·m at the angle', () => {
    const j = joint('knee', 100, 'Quadriceps (knee extensors)', '', CURVES.kneeExt.peak);
    expect(capacity(j, 80)).toBeCloseTo(CAPACITY.knee * 80 * PEAK_FACTOR, 5);
    expect(capacity({ ...j, angle: 130 }, 80)).toBeLessThan(capacity(j, 80));
    expect(capacity(j, 80, 1, 1.2)).toBeCloseTo(capacity(j, 80) * 1.2, 5);
  });

  it('reads joint angles from the model’s side view', () => {
    const { p, inp } = inputs('squat', 100);
    const pts = sweep(p, inp, 4);
    const top = pts[0].result.joints, bottom = pts[4].result.joints;
    const a = (js: JointResult[], id: string) => js.find((j) => j.id === id)!.angle!;
    expect(a(top, 'knee')).toBeLessThan(5);
    expect(a(bottom, 'knee')).toBeGreaterThan(100);
    expect(a(bottom, 'hip')).toBeGreaterThan(90);
    expect(a(bottom, 'ankle')).toBeGreaterThan(20);
    expect(jointAngles({ name: 'Side', points: { shoulder: [0, 1], elbow: [0, 0.7], hand: [0.3, 0.7], hip: [0, 0.5] }, bones: [], forces: [] })).toMatchObject({ elbow: 90, shoulder: 0 });
  });
});

describe('sticking points', () => {
  it('finds where each lift is hardest', () => {
    const at = (id: PatternId, load: number) => {
      const { p, inp } = inputs(id, load);
      return stickingPoint(sweep(p, inp, 24), 80)!;
    };
    const bench = at('pushH', 100);
    expect(bench.joint.id).toBe('elbow');
    expect(bench.phase).toBeGreaterThan(0.3); // off the chest, not at lockout
    expect(bench.phase).toBeLessThan(0.95);
    const pull = at('pullV', 0);
    expect(pull.phase).toBeGreaterThan(0.8); // at the top of a pull-up
    expect(at('squat', 140).joint.id).toBe('knee');
  });

  it('scales strength so your max is 100% at the hardest point', () => {
    const { p, inp } = inputs('squat', 150);
    const typical = stickingPoint(sweep(p, inp, 24), 80)!;
    const s = personalScale(p, { dims, mass: 80, options: inp.options }, 150);
    expect(s).toBeCloseTo(typical.rel, 5);
    expect(stickingPoint(sweep(p, inp, 24), 80, s)!.rel).toBeCloseTo(1, 5);
    expect(personalScale(p, { dims, mass: 80, options: inp.options }, 0)).toBe(1);
  });
});
