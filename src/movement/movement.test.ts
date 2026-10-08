import { describe, expect, it } from 'vitest';
import { STRUCTURE_BY_ID } from '../anatomy/catalog';
import type { Activity, Note } from '../db/db';
import { bodyDims } from '../model/bodyShape';
import { effortColors, groupEfforts } from './activation';
import { G, runModel, SEG, type JointId, type ModelId } from './biomech';
import { GROUPS, groupStructures, groupsOfStructure } from './groups';
import { classifyExercise, PATTERNS } from './patterns';
import { lastLoad, loggedExercises, summarizeTraining } from './training';

const dims = bodyDims({});
const demand = (id: ModelId, options: Record<string, string>, load: number, phase: number, joint: JointId) =>
  runModel(id, { phase, dims, mass: 80, load, options }).joints.find((j) => j.id === joint)!.demand;

describe('muscle groups', () => {
  it('maps every group onto atlas muscles', () => {
    for (const g of GROUPS) {
      expect(groupStructures(g.id).length, g.id).toBeGreaterThan(0);
      for (const m of g.members) expect(STRUCTURE_BY_ID.has(`muscular.${m}_l`) || STRUCTURE_BY_ID.has(`muscular.${m}`), m).toBe(true);
    }
    expect(groupsOfStructure('muscular.vastus_lateralis_muscle_r')).toEqual(['quads']);
  });

  it('only tags known groups in patterns', () => {
    const ids = new Set(GROUPS.map((g) => g.id));
    for (const p of PATTERNS) for (const t of p.groups) expect(ids.has(t.group), `${p.id}:${t.group}`).toBe(true);
  });
});

describe('exercise classifier', () => {
  it.each([
    ['Back squat', 'squat', 'highbar'],
    ['Front Squat', 'squat', 'front'],
    ['Split squat', 'lunge', undefined],
    ['Romanian deadlift', 'hinge', 'rdl'],
    ['Deadlift', 'hinge', 'conventional'],
    ['Bench press', 'pushH', 'bench'],
    ['Push-ups', 'pushH', 'pushup'],
    ['Overhead press', 'pushV', undefined],
    ['Landmine press', 'pushV', undefined],
    ['Pull-ups', 'pullV', 'pullup'],
    ['Lat pulldown', 'pullV', 'pulldown'],
    ['Barbell row', 'pullH', undefined],
    ['Farmer carry', 'carry', undefined],
    ['Pallof press', 'rotation', undefined],
    ['Easy run', 'gait', undefined],
  ])('%s → %s', (name, pattern, variant) => {
    const m = classifyExercise(name)!;
    expect(m.pattern).toBe(pattern);
    if (variant) expect(m.variant).toBe(variant);
  });

  it('credits isolation work to groups and leaves unknown names alone', () => {
    expect(classifyExercise('Hammer curl')!.groups?.[0].group).toBe('biceps');
    expect(classifyExercise('Leg curl')!.groups?.[0].group).toBe('hamstrings');
    expect(classifyExercise('Juggling')).toBeNull();
  });
});

describe('biomechanics', () => {
  it('keeps a squat balanced over mid-foot', () => {
    for (const phase of [0.2, 0.6, 1]) {
      const r = runModel('squat', { phase, dims, mass: 80, load: 100, options: { variant: 'highbar', depth: 'parallel', ankle: '38' } });
      expect(r.warnings).toEqual([]);
      const com = r.views[0].com!;
      const base = r.views[0].base!;
      expect(com[0]).toBeGreaterThan(base[0]);
      expect(com[0]).toBeLessThan(base[1]);
      // with everything balanced over mid-foot, the ankle carries the whole weight above it at that lever
      const above = 80 * (1 - 2 * SEG.foot.m) + 100;
      expect(r.joints.find((j) => j.id === 'ankle')!.demand).toBeCloseTo(0.5 * above * G * ((base[0] + base[1]) / 2), 0);
    }
  });

  it('shifts work between knees and hips the way coaches describe', () => {
    const at = (variant: string, joint: JointId) => demand('squat', { variant, depth: 'parallel', ankle: '38' }, 100, 0.5, joint);
    expect(at('lowbar', 'hip')).toBeGreaterThan(at('front', 'hip'));
    expect(at('front', 'knee')).toBeGreaterThan(at('lowbar', 'knee'));
    expect(demand('lunge', { variant: 'knee' }, 20, 1, 'knee')).toBeGreaterThan(demand('lunge', { variant: 'hip' }, 20, 1, 'knee'));
    expect(demand('lunge', { variant: 'hip' }, 20, 1, 'hip')).toBeGreaterThan(demand('lunge', { variant: 'knee' }, 20, 1, 'hip'));
  });

  it('loads the lower back more the deeper the hinge', () => {
    const l = [0, 0.5, 1].map((p) => demand('hinge', { variant: 'conventional' }, 120, p, 'lumbar'));
    expect(l[1]).toBeGreaterThan(l[0]);
    expect(l[2]).toBeGreaterThan(l[1]);
  });

  it('reflects grip choices in pressing and pulling', () => {
    const bench = (grip: string, j: JointId) => demand('bench', { variant: 'bench', grip, touch: 'mid', elbows: 'tucked' }, 80, 0.5, j);
    expect(bench('narrow', 'elbow')).toBeGreaterThan(bench('wide', 'elbow'));
    expect(bench('wide', 'shoulder')).toBeGreaterThan(bench('narrow', 'shoulder'));
    expect(demand('pullup', { variant: 'pullup', grip: 'chin' }, 0, 0.5, 'elbow')).toBeGreaterThan(demand('pullup', { variant: 'pullup', grip: 'wide' }, 0, 0.5, 'elbow'));
    expect(demand('pullup', { variant: 'pullup', grip: 'wide' }, 0, 0.5, 'shoulder')).toBeGreaterThan(demand('pullup', { variant: 'pullup', grip: 'chin' }, 0, 0.5, 'shoulder'));
  });

  it('makes the standing hip work harder when the load is in the other hand', () => {
    expect(demand('carry', { variant: 'suitcase' }, 30, 1, 'hipFrontal')).toBeGreaterThan(5 * demand('carry', { variant: 'suitcaseSame' }, 30, 1, 'hipFrontal'));
  });

  it('lengthens the anti-rotation lever as the arms extend', () => {
    const t = [0, 0.5, 1].map((p) => demand('pallof', {}, 10, p, 'spineAxial'));
    expect(t[1]).toBeGreaterThan(t[0]);
    expect(t[2]).toBeGreaterThan(t[1]);
    expect(t[2]).toBeCloseTo(10 * G * runModel('pallof', { phase: 1, dims, mass: 80, load: 10, options: {} }).joints[0].arm, 3);
  });

  it('peaks the knee before the ankle in running stance', () => {
    const series = (j: JointId) => Array.from({ length: 21 }, (_, i) => demand('gait', {}, 0, i / 20, j));
    const peak = (v: number[]) => v.indexOf(Math.max(...v));
    expect(peak(series('knee'))).toBeLessThan(peak(series('ankle')));
    expect(Math.max(...series('ankle')) / 80).toBeGreaterThan(1.5); // N·m per kg
  });

  it('scales with body proportions', () => {
    const longThighs = bodyDims({ height: 180, thigh: 47 });
    const r = (d: typeof dims) => runModel('squat', { phase: 1, dims: d, mass: 80, load: 100, options: { variant: 'highbar', depth: 'parallel', ankle: '38' } }).joints.find((j) => j.id === 'hip')!.arm;
    expect(r(longThighs)).toBeGreaterThan(r(bodyDims({ height: 180 })));
  });
});

describe('effort', () => {
  it('stays within 0–1 and colours the tagged muscles', () => {
    for (const p of PATTERNS) {
      const variant = p.variants[0];
      const load = variant.load === 'none' ? 0 : variant.load;
      const r = runModel(p.model, { phase: 0.8, dims, mass: 80, load, options: { variant: variant.value } });
      const e = groupEfforts(p, r, 80);
      for (const g of e) {
        expect(g.effort).toBeGreaterThanOrEqual(0);
        expect(g.effort).toBeLessThanOrEqual(1);
      }
      expect(effortColors(e).size).toBeGreaterThan(0);
    }
  });
});

describe('training analysis', () => {
  const DAY = 86_400_000;
  const now = Date.now();
  const workout = (ago: number, exercises: { name: string; sets?: number; load?: number }[]): Note =>
    ({ id: `w${ago}${exercises[0].name}`, date: now - ago * DAY, createdAt: 0, updatedAt: 0, title: 'w', body: '', category: 'workout', feeling: 1, sensations: [], tags: [], locations: [], structureIds: [], links: [], workout: { exercises } }) as Note;
  const notes = [0, 7, 14, 21].flatMap((ago) => [
    workout(ago, [{ name: 'Bench press', sets: 5, load: 80 }, { name: 'Overhead press', sets: 4 }, { name: 'Barbell row', sets: 3 }]),
    workout(ago + 1, [{ name: 'Back squat', sets: 5, load: 100 }, { name: 'Romanian deadlift', sets: 3 }, { name: 'Easy run' }]),
  ]);

  it('counts sets per pattern and per muscle group', () => {
    const s = summarizeTraining(notes, [], { weeks: 4 });
    expect(s.patternPerWeek.pushH).toBeCloseTo(5);
    expect(s.patternPerWeek.squat).toBeCloseTo(5);
    expect(s.patternPerWeek.gait).toBeCloseTo(1);
    expect(s.balance.pushPull).toBeCloseTo(3);
    // quads: prime in the squat (5) and synergist in the RDL (3 × 0.5)
    expect(s.groupPerWeek.quads).toBeCloseTo(6.5);
    expect(s.insights.some((i) => i.tone === 'warn' && /push more than you pull/.test(i.text))).toBe(true);
  });

  it('does not double count runs that were also imported', () => {
    const runActivity: Activity = { id: 'a1', start: now - 1 * DAY + 3600_000, end: now - DAY + 7200_000, type: 'RUNNING', name: 'Run', durationMin: 40, source: 'test' };
    const other: Activity = { ...runActivity, id: 'a2', start: now - 3 * DAY };
    const { exercises } = loggedExercises(notes, [runActivity, other]);
    expect(exercises.filter((e) => e.pattern === 'gait').length).toBe(4 + 1);
  });

  it('finds the last logged load for a pattern', () => {
    expect(lastLoad(notes, 'squat')).toMatchObject({ load: 100, name: 'Back squat', variant: 'highbar' });
    expect(lastLoad(notes, 'carry')).toBeNull();
  });
});
