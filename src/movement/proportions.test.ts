import { describe, expect, it } from 'vitest';
import { bodyDims } from '../model/bodyShape';
import { PATTERN_BY_ID, type PatternId } from './patterns';
import { BUILT_IN, describePercentile, liftMetrics, percentileOf, ratioAt, RATIOS, refRatio, validTable, withRatios } from './proportions';

const me = { height: 180 };
const inputsFor = (id: PatternId, load: number) => {
  const p = PATTERN_BY_ID.get(id)!;
  return { p, options: { ...Object.fromEntries(p.options.map((o) => [o.id, o.default])), variant: p.variants[0].value }, load };
};

describe('proportions against the population', () => {
  it('puts the reference body at the men’s median and reads percentiles both ways', () => {
    const ref = bodyDims({});
    for (const id of ['legs', 'thighShin', 'ape'] as const) {
      expect(percentileOf(BUILT_IN, id, ref, 'male')).toBeCloseTo(50, 5);
      expect(ratioAt(BUILT_IN, id, 50, 'male')).toBeCloseTo(refRatio(id), 6);
      const r90 = ratioAt(BUILT_IN, id, 90, 'male');
      expect(r90).toBeGreaterThan(refRatio(id));
      expect(percentileOf(BUILT_IN, id, { ...ref, ...(id === 'thighShin' ? { thigh: ref.shank * r90 } : {}) }, 'male')).toBeGreaterThan(id === 'thighShin' ? 89 : 49);
    }
    // the same arms are longer than most for a woman
    expect(percentileOf(BUILT_IN, 'ape', ref, 'female')).toBeGreaterThan(70);
    expect(describePercentile(50)).toBe('about average');
    expect(describePercentile(85)).toBe('higher than 85 in 100 people');
    expect(describePercentile(20)).toBe('lower than 80 in 100 people');
    expect(describePercentile(99)).toBe('among the highest few in 100');
  });

  it('checks tables loaded from a file', () => {
    expect(validTable(BUILT_IN)).toBe(true);
    expect(validTable({ ...BUILT_IN, ratios: { ...BUILT_IN.ratios, ape: { male: [1, 2], female: [] } } })).toBe(false);
    const falling = [...BUILT_IN.ratios.legs.male].reverse();
    expect(validTable({ ...BUILT_IN, ratios: { ...BUILT_IN.ratios, legs: { male: falling, female: falling } } })).toBe(false);
    expect(validTable(null)).toBe(false);
  });
});

describe('another build at the same height', () => {
  it('reaches the asked-for ratios and keeps the height', () => {
    const base = bodyDims(me);
    const target = { legs: RATIOS.legs.of(base) * 1.04, thighShin: RATIOS.thighShin.of(base) * 1.08, ape: RATIOS.ape.of(base) * 0.97 };
    const { input, dims } = withRatios(me, target);
    expect(dims.height).toBeCloseTo(base.height, 6);
    expect(input.height).toBeCloseTo(180, 6);
    expect(RATIOS.legs.of(dims)).toBeCloseTo(target.legs, 2);
    expect(RATIOS.thighShin.of(dims)).toBeCloseTo(target.thighShin, 2);
    expect(RATIOS.ape.of(dims)).toBeCloseTo(target.ape, 2);
    expect(dims.torso).toBeLessThan(base.torso); // longer legs, shorter torso
    // unchanged when nothing is asked
    const same = withRatios(me, {}).dims;
    expect(same.thigh).toBeCloseTo(base.thigh, 3); // within half a millimetre
    expect(same.upperArm).toBeCloseTo(base.upperArm, 3);
  });

  it('long thighs lean further forward in a squat; long arms pull a shorter deadlift', () => {
    const base = bodyDims(me);
    const sq = inputsFor('squat', 100);
    const longThighs = withRatios(me, { thighShin: ratioAt(BUILT_IN, 'thighShin', 95, 'male') }).dims;
    const shortThighs = withRatios(me, { thighShin: ratioAt(BUILT_IN, 'thighShin', 5, 'male') }).dims;
    const a = liftMetrics(sq.p, { dims: longThighs, mass: 80, load: sq.load, options: sq.options });
    const b = liftMetrics(sq.p, { dims: shortThighs, mass: 80, load: sq.load, options: sq.options });
    expect(a.trunkLean!).toBeGreaterThan(b.trunkLean! + 2);
    expect(a.peaks.hip!).toBeGreaterThan(b.peaks.hip!);
    expect(a.travel).toBeGreaterThan(0.3);
    expect(a.work).toBeCloseTo(100 * 9.81 * a.travel, 5);

    const dl = inputsFor('hinge', 140);
    const longArms = withRatios(me, { ape: ratioAt(BUILT_IN, 'ape', 95, 'male') }).dims;
    const shortArms = withRatios(me, { ape: ratioAt(BUILT_IN, 'ape', 5, 'male') }).dims;
    const la = liftMetrics(dl.p, { dims: longArms, mass: 80, load: dl.load, options: dl.options });
    const sa = liftMetrics(dl.p, { dims: shortArms, mass: 80, load: dl.load, options: dl.options });
    expect(la.travel).toBeLessThan(sa.travel);
    expect(la.sticking).not.toBeNull();
    expect(base.height).toBeCloseTo(1.8, 6);
  });
});
